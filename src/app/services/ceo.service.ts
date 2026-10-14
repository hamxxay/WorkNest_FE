import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Observable, catchError, map, throwError } from 'rxjs';
import { environment } from '../../environments/environment';

// ============================================================
// CEO dashboard API (GET api/ceo/*, read-only). Shared contract with the API and the mobile app:
// dashboard -> breakdown (drill level 2) -> records (drill level 3), plus the existing
// GET api/dashboard/forecast for the 3-month outlook. Every response is normalised here, so a
// missing field shows as an empty state on the page instead of breaking it.
// ============================================================

export type CeoPeriod = 'month' | 'quarter' | 'year';

export interface CeoLocation { locationId: number; name: string; }

export interface CeoMoneyMonth { month: string; invoiced: number; collected: number; }
export interface CeoAging { bucket: string; label: string; amount: number; count: number; }
export interface CeoTopCustomer { customerId: number; name: string; amount: number; invoices: number; }
export interface CeoMoney {
  invoiced: number; invoicedPrev: number;
  collected: number; collectedPrev: number;
  outstanding: number; outstandingCount: number;
  overdue: number; overdueCount: number;
  /** Collected / invoiced in the period, % (0-100). */
  collectionRate: number;
  /** Last 12 months, oldest first. */
  months: CeoMoneyMonth[];
  /** not_due, 1_30, 31_60, 61_90, 90_plus */
  aging: CeoAging[];
  /** Top 5 by amount invoiced, last 12 months. */
  topCustomers: CeoTopCustomer[];
}

export interface CeoOccupancyMonth { month: string; occupancyPct: number; newBookings: number; }
export interface CeoOccupancyType { spaceTypeId: number; name: string; total: number; occupied: number; }
export interface CeoOccupancyLocation { locationId: number; name: string; total: number; occupied: number; }
export interface CeoLeaseExpiring {
  bookingId: number; customer: string; space: string; location: string; endOn: string; monthlyAmount: number;
}
export interface CeoOccupancy {
  totalSpaces: number; occupiedSpaces: number;
  occupancyPct: number; occupancyPctPrev: number;
  activeBookings: number; newBookings: number; newBookingsPrev: number;
  months: CeoOccupancyMonth[];
  byType: CeoOccupancyType[];
  byLocation: CeoOccupancyLocation[];
  /** Next 90 days. */
  leasesExpiring: CeoLeaseExpiring[];
}

export type CeoFunnelStageKey = 'inquiries' | 'quotations' | 'accepted' | 'bookings';
export interface CeoFunnelStage { stage: string; label: string; count: number; }
export interface CeoInquiryType { type: string; label: string; count: number; }
export interface CeoSales {
  funnel: CeoFunnelStage[];
  /** Bookings / quotations, %. */
  conversionRate: number;
  inquiriesByType: CeoInquiryType[];
  quotationValue: number;
  bookingValue: number;
}

export interface CeoTeamLocation {
  locationId: number; name: string; admins: number; salesExecutives: number; quotations: number; converted: number;
}
export interface CeoPerson {
  userId: number; name: string; role: string; locations: string; quotations: number; converted: number; convertedValue: number;
}
export interface CeoTeam { perLocation: CeoTeamLocation[]; people: CeoPerson[]; }

export interface CeoDashboard {
  period: CeoPeriod;
  periodLabel: string;
  generatedAt: string | null;
  locations: CeoLocation[];
  /** null when the API sent no such section (the page shows an empty state). */
  money: CeoMoney | null;
  occupancy: CeoOccupancy | null;
  sales: CeoSales | null;
  team: CeoTeam | null;
}

// ---------- Drill-down level 2 ----------
export type CeoMetric =
  | 'revenue' | 'aging' | 'occupancy-type' | 'occupancy-location' | 'bookings-month' | 'inquiries-type' | 'staff';

export interface CeoBreakdownRow {
  key: string; label: string; value: number; value2: number | null; count: number | null;
}
export interface CeoBreakdown {
  title: string; subtitle: string; valueLabel: string; value2Label: string | null; rows: CeoBreakdownRow[];
}

// ---------- Drill-down level 3 ----------
export type CeoRecordKind = 'invoices' | 'spaces' | 'bookings' | 'inquiries' | 'quotations';

export interface CeoInvoiceRecord {
  invoiceId: number; invoiceNumber: string; customer: string; location: string;
  issuedOn: string | null; dueOn: string | null; total: number; paid: number; balance: number; status: string;
}
export interface CeoSpaceRecord {
  spaceId: number; name: string; spaceType: string; location: string; capacity: number | null;
  occupied: boolean; customer: string; bookingEndOn: string | null;
}
export interface CeoBookingRecord {
  bookingId: number; customer: string; space: string; location: string;
  startOn: string | null; endOn: string | null; status: string; totalAmount: number;
}
export interface CeoInquiryRecord {
  inquiryId: number; name: string; phone: string; type: string; referenceName: string;
  status: string; createdOn: string | null; feedback: string;
}
export interface CeoQuotationRecord {
  quotationId: number; quotationNumber: string; customer: string; location: string;
  createdBy: string; status: string; total: number; createdOn: string | null;
}
export interface CeoRecordRowMap {
  invoices: CeoInvoiceRecord; spaces: CeoSpaceRecord; bookings: CeoBookingRecord;
  inquiries: CeoInquiryRecord; quotations: CeoQuotationRecord;
}
export interface CeoRecords<K extends CeoRecordKind = CeoRecordKind> {
  title: string;
  /** Full count; rows holds at most 200 (newest first). */
  total: number;
  rows: CeoRecordRowMap[K][];
}

// ---------- 3-month outlook (GET api/dashboard/forecast) ----------
export interface CeoForecastMonth {
  month: string; label: string;
  expectedRent: number; confirmedRent: number;
  totalSpaces: number; occupiedSpaces: number; occupancyPct: number;
  leasesEnding: number; leasesStarting: number;
}

/** Query values; null / undefined / '' are left out of the request. */
export type CeoParams = Record<string, string | number | boolean | null | undefined>;

/** A failed CEO request, worded for the page. */
export interface CeoError {
  status: number;
  title: string;
  message: string;
  /** 503 from the API: the database script for the CEO dashboard has not been run yet. */
  needsDbUpdate: boolean;
}

// ---------- normalising helpers ----------
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : num(v));
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const strOrNull = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));
const arr = <T>(v: unknown, fn: (x: any) => T): T[] => (Array.isArray(v) ? v.filter(x => x != null).map(fn) : []);
const obj = (v: unknown): any | null => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);

/** Rates may arrive as a fraction (0.82) or a percentage (82): always returns a percentage. */
function percent(rate: unknown, part?: number, whole?: number): number {
  const r = num(rate);
  if (r > 0 && r <= 1 && part !== undefined && whole && whole > 0) {
    const expected = (part / whole) * 100;
    if (Math.abs(expected - r * 100) < Math.abs(expected - r)) return r * 100;
  }
  return r;
}

@Injectable({ providedIn: 'root' })
export class CeoService {
  private http = inject(HttpClient);
  private api = environment.apiUrl;

  /** GET api/ceo/dashboard: every section of the CEO dashboard for one period (and optionally one location). */
  getDashboard(period: CeoPeriod, locationId: number | null): Observable<CeoDashboard> {
    return this.get(`${this.api}/ceo/dashboard`, { period, locationId }).pipe(map(d => this.toDashboard(d, period)));
  }

  /** GET api/ceo/breakdown: drill-down level 2 (one row per location / space type / month). */
  getBreakdown(metric: CeoMetric, params: CeoParams): Observable<CeoBreakdown> {
    return this.get(`${this.api}/ceo/breakdown`, { ...params, metric }).pipe(map(d => this.toBreakdown(d)));
  }

  /** GET api/ceo/records/{kind}: drill-down level 3 (read-only list, newest first, at most 200 rows). */
  getRecords<K extends CeoRecordKind>(kind: K, params: CeoParams): Observable<CeoRecords<K>> {
    return this.get(`${this.api}/ceo/records/${kind}`, params).pipe(map(d => this.toRecords(kind, d)));
  }

  /** GET api/dashboard/forecast: expected rent and occupancy for the next months (all locations combined). */
  getForecast(locationId: number | null, months = 3): Observable<CeoForecastMonth[]> {
    return this.get(`${this.api}/dashboard/forecast`, { months, locationId }).pipe(
      map(d => arr(obj(d)?.totals, (m: any): CeoForecastMonth => ({
        month: str(m.month), label: str(m.label) || str(m.month),
        expectedRent: num(m.expectedRent), confirmedRent: num(m.confirmedRent),
        totalSpaces: num(m.totalSpaces), occupiedSpaces: num(m.occupiedSpaces), occupancyPct: num(m.occupancyPct),
        leasesEnding: num(m.leasesEnding), leasesStarting: num(m.leasesStarting)
      })))
    );
  }

  /** Wording for a failed request (used by every section and drill level). */
  static describeError(err: unknown): CeoError {
    if (err && typeof err === 'object' && 'needsDbUpdate' in (err as any) && 'title' in (err as any)) return err as CeoError;
    const http = err instanceof HttpErrorResponse ? err : null;
    const status = http?.status ?? (err as any)?.status ?? -1;
    const apiMessage: string = (http?.error && typeof http.error === 'object' ? http.error.message : null)
      ?? (err as any)?.message ?? '';

    if (status === 503) {
      const db = /database|db update|not set up|table|script/i.test(apiMessage) || !apiMessage;
      return db
        ? {
            status, needsDbUpdate: true, title: 'Database update needed',
            message: 'The CEO dashboard needs the database update before it can show figures. Ask the WorkNest team to run the latest database script, then refresh this page.'
          }
        : { status, needsDbUpdate: false, title: 'Temporarily unavailable', message: apiMessage || 'The service is temporarily unavailable. Please try again in a few minutes.' };
    }
    if (status === 403) {
      return { status, needsDbUpdate: false, title: 'No access', message: 'Your account cannot open the CEO dashboard. Ask a super admin to check your role.' };
    }
    if (status === 404) {
      return { status, needsDbUpdate: false, title: 'Not available yet', message: 'The server does not have the CEO dashboard yet. It will work once the API update is live.' };
    }
    if (status === 0) {
      return { status, needsDbUpdate: false, title: 'Cannot reach the server', message: 'Check your internet connection and try again.' };
    }
    return {
      status, needsDbUpdate: false, title: 'Could not load',
      message: apiMessage && apiMessage.length <= 300 ? apiMessage : 'Something went wrong. Please try again.'
    };
  }

  // ---------- transport ----------

  private get(url: string, params: CeoParams): Observable<any> {
    let p = new HttpParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === null || v === undefined || v === '') continue;
      p = p.set(k, String(v));
    }
    return this.http.get<any>(url, { params: p }).pipe(
      map(res => {
        // Envelope { isSuccessful, data } like the rest of WN_APIs; a bare body is accepted too.
        if (res && typeof res === 'object' && ('isSuccessful' in res || 'isSuccess' in res)) {
          if (res.isSuccessful === false || res.isSuccess === false) {
            throw { status: 200, needsDbUpdate: false, title: 'Could not load', message: str(res.message) || 'Something went wrong. Please try again.' } as CeoError;
          }
          return res.data ?? null;
        }
        return res ?? null;
      }),
      catchError(err => throwError(() => CeoService.describeError(err)))
    );
  }

  // ---------- normalising ----------

  private toDashboard(raw: any, period: CeoPeriod): CeoDashboard {
    const d = obj(raw) ?? {};
    const m = obj(d.money);
    const o = obj(d.occupancy);
    const s = obj(d.sales);
    const t = obj(d.team);

    const money: CeoMoney | null = m && {
      invoiced: num(m.invoiced), invoicedPrev: num(m.invoicedPrev),
      collected: num(m.collected), collectedPrev: num(m.collectedPrev),
      outstanding: num(m.outstanding), outstandingCount: num(m.outstandingCount),
      overdue: num(m.overdue), overdueCount: num(m.overdueCount),
      collectionRate: percent(m.collectionRate, num(m.collected), num(m.invoiced)),
      months: arr(m.months, (x: any) => ({ month: str(x.month), invoiced: num(x.invoiced), collected: num(x.collected) }))
        .filter(x => /^\d{4}-\d{2}/.test(x.month)),
      aging: arr(m.aging, (x: any) => ({ bucket: str(x.bucket), label: str(x.label) || str(x.bucket), amount: num(x.amount), count: num(x.count) })),
      topCustomers: arr(m.topCustomers, (x: any) => ({ customerId: num(x.customerId), name: str(x.name) || 'Customer', amount: num(x.amount), invoices: num(x.invoices) }))
    };

    const occupancy: CeoOccupancy | null = o && {
      totalSpaces: num(o.totalSpaces), occupiedSpaces: num(o.occupiedSpaces),
      occupancyPct: num(o.occupancyPct), occupancyPctPrev: num(o.occupancyPctPrev),
      activeBookings: num(o.activeBookings), newBookings: num(o.newBookings), newBookingsPrev: num(o.newBookingsPrev),
      months: arr(o.months, (x: any) => ({ month: str(x.month), occupancyPct: num(x.occupancyPct), newBookings: num(x.newBookings) }))
        .filter(x => /^\d{4}-\d{2}/.test(x.month)),
      byType: arr(o.byType, (x: any) => ({ spaceTypeId: num(x.spaceTypeId), name: str(x.name) || 'Space type', total: num(x.total), occupied: num(x.occupied) })),
      byLocation: arr(o.byLocation, (x: any) => ({ locationId: num(x.locationId), name: str(x.name) || 'Location', total: num(x.total), occupied: num(x.occupied) })),
      leasesExpiring: arr(o.leasesExpiring, (x: any) => ({
        bookingId: num(x.bookingId), customer: str(x.customer) || 'Customer', space: str(x.space), location: str(x.location),
        endOn: str(x.endOn), monthlyAmount: num(x.monthlyAmount)
      }))
    };

    const sales: CeoSales | null = s && {
      funnel: arr(s.funnel, (x: any) => ({ stage: str(x.stage), label: str(x.label) || str(x.stage), count: num(x.count) })),
      conversionRate: percent(s.conversionRate),
      inquiriesByType: arr(s.inquiriesByType, (x: any) => ({ type: str(x.type) || 'NotSet', label: str(x.label) || str(x.type) || 'Not set', count: num(x.count) })),
      quotationValue: num(s.quotationValue), bookingValue: num(s.bookingValue)
    };

    const team: CeoTeam | null = t && {
      perLocation: arr(t.perLocation, (x: any) => ({
        locationId: num(x.locationId), name: str(x.name) || 'Location', admins: num(x.admins), salesExecutives: num(x.salesExecutives),
        quotations: num(x.quotations), converted: num(x.converted)
      })),
      people: arr(t.people, (x: any) => ({
        userId: num(x.userId), name: str(x.name) || 'Team member', role: str(x.role), locations: str(x.locations),
        quotations: num(x.quotations), converted: num(x.converted), convertedValue: num(x.convertedValue)
      }))
    };

    const p = str(d.period);
    return {
      period: p === 'quarter' || p === 'year' || p === 'month' ? p : period,
      periodLabel: str(d.periodLabel),
      generatedAt: strOrNull(d.generatedAt),
      locations: arr(d.locations, (x: any) => ({ locationId: num(x.locationId), name: str(x.name) || 'Location' }))
        .filter(l => l.locationId > 0),
      money, occupancy, sales, team
    };
  }

  private toBreakdown(raw: any): CeoBreakdown {
    const d = obj(raw) ?? {};
    return {
      title: str(d.title), subtitle: str(d.subtitle),
      valueLabel: str(d.valueLabel) || 'Value', value2Label: strOrNull(d.value2Label),
      rows: arr(d.rows, (r: any) => ({
        key: str(r.key), label: str(r.label) || str(r.key), value: num(r.value), value2: numOrNull(r.value2), count: numOrNull(r.count)
      }))
    };
  }

  private toRecords<K extends CeoRecordKind>(kind: K, raw: any): CeoRecords<K> {
    const d = obj(raw) ?? {};
    const rows = arr(d.rows, (r: any) => this.toRecord(kind, r)) as CeoRecordRowMap[K][];
    return { title: str(d.title), total: Math.max(num(d.total), rows.length), rows };
  }

  private toRecord(kind: CeoRecordKind, r: any): CeoRecordRowMap[CeoRecordKind] {
    switch (kind) {
      case 'invoices': return {
        invoiceId: num(r.invoiceId), invoiceNumber: str(r.invoiceNumber) || (r.invoiceId ? `#${r.invoiceId}` : ''),
        customer: str(r.customer), location: str(r.location), issuedOn: strOrNull(r.issuedOn), dueOn: strOrNull(r.dueOn),
        total: num(r.total), paid: num(r.paid), balance: num(r.balance), status: str(r.status)
      };
      case 'spaces': return {
        spaceId: num(r.spaceId), name: str(r.name), spaceType: str(r.spaceType), location: str(r.location),
        capacity: numOrNull(r.capacity), occupied: r.occupied === true || r.occupied === 1 || r.occupied === 'true',
        customer: str(r.customer), bookingEndOn: strOrNull(r.bookingEndOn)
      };
      case 'bookings': return {
        bookingId: num(r.bookingId), customer: str(r.customer), space: str(r.space), location: str(r.location),
        startOn: strOrNull(r.startOn), endOn: strOrNull(r.endOn), status: str(r.status), totalAmount: num(r.totalAmount)
      };
      case 'inquiries': return {
        inquiryId: num(r.inquiryId), name: str(r.name), phone: str(r.phone), type: str(r.type), referenceName: str(r.referenceName),
        status: str(r.status), createdOn: strOrNull(r.createdOn), feedback: str(r.feedback)
      };
      case 'quotations': return {
        quotationId: num(r.quotationId), quotationNumber: str(r.quotationNumber) || (r.quotationId ? `#${r.quotationId}` : ''),
        customer: str(r.customer), location: str(r.location), createdBy: str(r.createdBy), status: str(r.status),
        total: num(r.total), createdOn: strOrNull(r.createdOn)
      };
    }
  }
}

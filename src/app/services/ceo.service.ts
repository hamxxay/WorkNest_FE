import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  DashError, DashErrorWording, DashParams, arr, describeDashboardError, getDashboardData, num, numOrNull, obj, percent, str,
  strOrNull
} from './dashboard-api';

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
export type CeoParams = DashParams;

/** A failed CEO request, worded for the page (needsDbUpdate: 503, the CEO database script has not been run yet). */
export type CeoError = DashError;

const CEO_WORDING: DashErrorWording = {
  name: 'CEO dashboard',
  dbMessage: 'The CEO dashboard needs the database update before it can show figures. Ask the WorkNest team to run the latest database script, then refresh this page.'
};

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
    return describeDashboardError(err, CEO_WORDING);
  }

  // ---------- transport ----------

  private get(url: string, params: CeoParams): Observable<any> {
    return getDashboardData(this.http, url, params, err => CeoService.describeError(err));
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

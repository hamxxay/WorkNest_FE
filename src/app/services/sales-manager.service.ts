import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  DashError, DashErrorWording, DashParams, arr, describeDashboardError, getDashboardData, isMonth, num, numOrNull, obj, percent,
  str, strOrNull
} from './dashboard-api';
import { CeoBreakdown, CeoInquiryRecord, CeoPeriod } from './ceo.service';

// ============================================================
// Sales Manager dashboard API (GET api/sales-manager/*, read-only). Shared contract with the API and the
// mobile app (salesmgr contract, 14 Oct 2026): dashboard -> breakdown (drill level 2) -> records (level 3).
// No money at all (sm-desks contract): every figure is a count of desks, quotations, bookings or leases.
// Desks of a booking / quotation = its capacity, else its space's capacity; meeting rooms count 0 desks.
// Everything is limited to the manager's locations (or the chosen locationId), except tour inquiries, which
// have no location and cover every branch. Every response is normalised here, so a missing field shows as
// an empty state on the page instead of breaking it.
// ============================================================

export type SmPeriod = CeoPeriod;
export type SmParams = DashParams;
export type SmError = DashError;

export interface SmLocation { locationId: number; name: string; }

// ---------- Sales funnel ----------
export interface SmFunnelStage { stage: string; label: string; count: number; }
export interface SmFunnelMonth { month: string; quotations: number; accepted: number; bookings: number; bookedDesks: number; }
export interface SmFunnel {
  /** inquiries, quotations, accepted, bookings: created in the period. */
  stages: SmFunnelStage[];
  /** Bookings / quotations, % (0-100). */
  conversionRate: number;
  conversionRatePrev: number;
  /** Desks on quotations created in the period. */
  quotedDesks: number;
  /** Desks on bookings created in the period (and the previous period). */
  bookedDesks: number;
  bookedDesksPrev: number;
  /** Last 12 months, oldest first. */
  months: SmFunnelMonth[];
}

// ---------- Team performance ----------
export interface SmPerson {
  userId: number; name: string; role: string; locations: string;
  inquiriesHandled: number; quotations: number; accepted: number; converted: number;
  /** Desks on their converted quotations created in the period. */
  desksSold: number;
  /** Converted / quotations, % (0-100). */
  conversionRate: number;
  /** Follow-ups due now (not period-bound). */
  followUpsDue: number;
}
export interface SmTeamLocation {
  locationId: number; name: string; salesExecutives: number; quotations: number; converted: number; desksSold: number;
}
export interface SmTeam { people: SmPerson[]; perLocation: SmTeamLocation[]; }

// ---------- Tour inquiries (every branch) ----------
export interface SmInquiryType { type: string; label: string; count: number; }
export interface SmReason { reason: string; count: number; }
export interface SmInquiryMonth {
  month: string; website: number; whatsApp: number; walkIn: number; reference: number; notSet: number;
}
export interface SmInquiries {
  total: number; totalPrev: number; followedUp: number; notInterested: number; converted: number;
  /** Future prospects whose follow-up date has come (today or earlier), still open. */
  followUpsDue: number;
  byType: SmInquiryType[];
  /** Top reasons, period. */
  notInterestedReasons: SmReason[];
  /** Last 12 months, oldest first. */
  months: SmInquiryMonth[];
}

// ---------- Renewals & desks ----------
export interface SmExpiringLease {
  bookingId: number; customer: string; space: string; location: string; endOn: string; desks: number;
  /** Days until endOn (0 = today). */
  daysLeft: number;
}
/** Desks booked (0 for future months), desks and leases ending. */
export interface SmRenewalMonth { month: string; bookedDesks: number; endingDesks: number; expiring: number; }
export interface SmRenewals {
  /** Leases ending in the next 90 days, soonest first. */
  expiring: SmExpiringLease[];
  expiringCount: number;
  /** Desks on the leases ending in the next 90 days. */
  expiringDesks: number;
  /** Leases ending in the next 30 days, and their desks. */
  expiring30Count: number;
  expiring30Desks: number;
  /** Desks booked in the period (the funnel's bookedDesks). */
  bookedDesks: number;
  /** Desks on bookings whose lease ended in the period. */
  endedDesks: number;
  /** bookedDesks - endedDesks, this period and the previous one. */
  netDesks: number;
  netDesksPrev: number;
  /** Last 12 months + the next 3 (desks / leases ending). */
  months: SmRenewalMonth[];
}

export interface SmDashboard {
  period: SmPeriod;
  periodLabel: string;
  generatedAt: string | null;
  /** The manager's locations (every location for a super admin). */
  locations: SmLocation[];
  /** null when the API sent no such section (the page shows an empty state). */
  funnel: SmFunnel | null;
  team: SmTeam | null;
  inquiries: SmInquiries | null;
  renewals: SmRenewals | null;
}

// ---------- Drill-down level 2 (same shape as the CEO breakdown) ----------
export type SmMetric = 'funnel-month' | 'staff' | 'inquiries-type' | 'renewals-month' | 'desks-month';
export type SmBreakdown = CeoBreakdown;

// ---------- Drill-down level 3 ----------
export type SmRecordKind = 'quotations' | 'bookings' | 'inquiries' | 'leases';

export interface SmQuotationRecord {
  quotationId: number; quotationNumber: string; customer: string; location: string;
  createdBy: string; status: string; desks: number; createdOn: string | null;
}
export interface SmBookingRecord {
  bookingId: number; customer: string; space: string; location: string;
  startOn: string | null; endOn: string | null; status: string; desks: number;
}
export interface SmInquiryRecord extends CeoInquiryRecord { followUpOn: string | null; }
export interface SmLeaseRecord {
  bookingId: number; customer: string; space: string; location: string;
  endOn: string | null; desks: number; daysLeft: number | null;
}
export interface SmRecordRowMap {
  quotations: SmQuotationRecord; bookings: SmBookingRecord; inquiries: SmInquiryRecord; leases: SmLeaseRecord;
}
export interface SmRecords<K extends SmRecordKind = SmRecordKind> {
  title: string;
  /** Full count; rows holds at most 200 (newest first). */
  total: number;
  rows: SmRecordRowMap[K][];
}

/** The sales dashboard's newest database script; named when the API's 503 does not say which one is missing. */
const SM_LATEST_SCRIPT = 'SM_02';

const smDbMessage = (script: string) =>
  `The sales dashboard needs the database update ${script} before it can show figures. Ask the WorkNest team to run it, then refresh this page.`;

const SM_WORDING: DashErrorWording = {
  name: 'sales dashboard',
  // The contract: a 503 from api/sales-manager/* always means a database script (SM_01, SM_02...) has not been run.
  any503IsDb: true,
  dbMessage: smDbMessage(SM_LATEST_SCRIPT)
};

/** The script a 503 names ("...needs the database update SM_02."), from the API's message. */
function dbScriptOf(err: unknown): string | null {
  const e = err as any;
  const message = [e?.error?.message, e?.message].filter(m => typeof m === 'string').join(' ');
  return /\bSM_\d+\b/i.exec(message)?.[0].toUpperCase() ?? null;
}

/** Days until an ISO date (0 = today, never negative); used when the API sends no daysLeft. */
function daysTo(date: string | null): number | null {
  if (!date) return null;
  const d = new Date(date.length <= 10 ? date + 'T00:00:00' : date);
  if (isNaN(d.getTime())) return null;
  const t = new Date(); t.setHours(0, 0, 0, 0); d.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((d.getTime() - t.getTime()) / 86400000));
}

/** First present value among a few spellings of one field (whatsApp / whatsapp / WhatsApp). */
function pick(x: any, ...keys: string[]): unknown {
  for (const k of keys) if (x?.[k] !== undefined && x?.[k] !== null) return x[k];
  return undefined;
}

@Injectable({ providedIn: 'root' })
export class SalesManagerService {
  private http = inject(HttpClient);
  private api = environment.apiUrl;

  /** GET api/sales-manager/dashboard: every section for one period (and optionally one of the manager's locations). */
  getDashboard(period: SmPeriod, locationId: number | null): Observable<SmDashboard> {
    return this.get(`${this.api}/sales-manager/dashboard`, { period, locationId }).pipe(map(d => this.toDashboard(d, period)));
  }

  /** GET api/sales-manager/breakdown: drill-down level 2. */
  getBreakdown(metric: SmMetric, params: SmParams): Observable<SmBreakdown> {
    return this.get(`${this.api}/sales-manager/breakdown`, { ...params, metric }).pipe(map(d => this.toBreakdown(d)));
  }

  /** GET api/sales-manager/records/{kind}: drill-down level 3 (read-only, newest first, at most 200 rows). */
  getRecords<K extends SmRecordKind>(kind: K, params: SmParams): Observable<SmRecords<K>> {
    return this.get(`${this.api}/sales-manager/records/${kind}`, params).pipe(map(d => this.toRecords(kind, d)));
  }

  /** Wording for a failed request (503 = a database update is missing: the one the API names, SM_01 / SM_02). */
  static describeError(err: unknown): SmError {
    const e = describeDashboardError(err, SM_WORDING);
    const script = e.needsDbUpdate ? dbScriptOf(err) : null;
    return script ? { ...e, message: smDbMessage(script) } : e;
  }

  private get(url: string, params: SmParams): Observable<any> {
    return getDashboardData(this.http, url, params, err => SalesManagerService.describeError(err));
  }

  // ---------- normalising ----------

  private toDashboard(raw: any, period: SmPeriod): SmDashboard {
    const d = obj(raw) ?? {};
    const p = str(d.period);
    const funnel = this.toFunnel(obj(d.funnel));
    return {
      period: p === 'quarter' || p === 'year' || p === 'month' ? p : period,
      periodLabel: str(d.periodLabel),
      generatedAt: strOrNull(d.generatedAt),
      locations: arr(d.locations, (x: any) => ({ locationId: num(x.locationId), name: str(x.name) || 'Location' }))
        .filter(l => l.locationId > 0),
      funnel,
      team: this.toTeam(obj(d.team)),
      inquiries: this.toInquiries(obj(d.inquiries)),
      renewals: this.toRenewals(obj(d.renewals), funnel?.bookedDesks ?? null)
    };
  }

  private toFunnel(f: any | null): SmFunnel | null {
    if (!f) return null;
    const stages = arr(f.stages, (x: any): SmFunnelStage => ({ stage: str(x.stage), label: str(x.label) || str(x.stage), count: num(x.count) }));
    const stageCount = (k: string) => stages.find(s => s.stage.toLowerCase() === k)?.count ?? 0;
    const quotations = stageCount('quotations');
    const bookings = stageCount('bookings');
    // Missing rate: worked out from the stages. A fraction (0.25) is turned into a percentage, and so is last period's.
    const rawRate = numOrNull(f.conversionRate);
    const rate = rawRate === null ? (quotations > 0 ? (bookings / quotations) * 100 : 0) : percent(rawRate, bookings, quotations);
    const scale = rawRate !== null && rawRate > 0 && rate !== rawRate ? 100 : 1;
    return {
      stages,
      conversionRate: rate,
      conversionRatePrev: num(f.conversionRatePrev) * scale,
      quotedDesks: num(f.quotedDesks), bookedDesks: num(f.bookedDesks), bookedDesksPrev: num(f.bookedDesksPrev),
      months: arr(f.months, (x: any): SmFunnelMonth => ({
        month: str(x.month), quotations: num(x.quotations), accepted: num(x.accepted), bookings: num(x.bookings), bookedDesks: num(x.bookedDesks)
      })).filter(x => isMonth(x.month))
    };
  }

  private toTeam(t: any | null): SmTeam | null {
    if (!t) return null;
    return {
      people: arr(t.people, (x: any): SmPerson => {
        const quotations = num(x.quotations), converted = num(x.converted);
        const rawRate = numOrNull(x.conversionRate);
        return {
          userId: num(x.userId), name: str(x.name) || 'Team member', role: str(x.role), locations: str(x.locations),
          inquiriesHandled: num(x.inquiriesHandled), quotations, accepted: num(x.accepted), converted,
          desksSold: num(x.desksSold),
          conversionRate: rawRate === null ? (quotations > 0 ? (converted / quotations) * 100 : 0) : percent(rawRate, converted, quotations),
          followUpsDue: num(x.followUpsDue)
        };
      }),
      perLocation: arr(t.perLocation, (x: any): SmTeamLocation => ({
        locationId: num(x.locationId), name: str(x.name) || 'Location', salesExecutives: num(x.salesExecutives),
        quotations: num(x.quotations), converted: num(x.converted), desksSold: num(x.desksSold)
      }))
    };
  }

  private toInquiries(q: any | null): SmInquiries | null {
    if (!q) return null;
    const byType = arr(q.byType, (x: any): SmInquiryType => ({
      type: str(x.type) || 'NotSet', label: str(x.label) || str(x.type) || 'Not set', count: num(x.count)
    }));
    const total = numOrNull(q.total) ?? byType.reduce((a, t) => a + t.count, 0);
    return {
      total, totalPrev: num(q.totalPrev), followedUp: num(q.followedUp), notInterested: num(q.notInterested),
      converted: num(q.converted), followUpsDue: num(q.followUpsDue),
      byType,
      notInterestedReasons: arr(q.notInterestedReasons, (x: any): SmReason => ({ reason: str(x.reason) || 'No reason given', count: num(x.count) }))
        .filter(r => r.count > 0),
      months: arr(q.months, (x: any): SmInquiryMonth => ({
        month: str(x.month),
        website: num(pick(x, 'website', 'Website')),
        whatsApp: num(pick(x, 'whatsApp', 'whatsapp', 'WhatsApp')),
        walkIn: num(pick(x, 'walkIn', 'walkin', 'WalkIn')),
        reference: num(pick(x, 'reference', 'Reference')),
        notSet: num(pick(x, 'notSet', 'notset', 'NotSet'))
      })).filter(x => isMonth(x.month))
    };
  }

  /** `funnelBooked`: the funnel's desks booked, for the net-desks sums when the API leaves one out. */
  private toRenewals(r: any | null, funnelBooked: number | null): SmRenewals | null {
    if (!r) return null;
    const expiring = arr(r.expiring, (x: any): SmExpiringLease => {
      const endOn = str(x.endOn);
      return {
        bookingId: num(x.bookingId), customer: str(x.customer) || 'Customer', space: str(x.space), location: str(x.location),
        endOn, desks: num(x.desks),
        daysLeft: numOrNull(x.daysLeft) ?? daysTo(endOn) ?? 0
      };
    }).sort((a, b) => a.daysLeft - b.daysLeft);
    const soon = expiring.filter(l => l.daysLeft <= 30);
    const desksOf = (list: SmExpiringLease[]) => list.reduce((a, l) => a + l.desks, 0);
    const endedDesks = num(r.endedDesks);
    const netRaw = numOrNull(r.netDesks);
    const bookedDesks = funnelBooked ?? (netRaw !== null ? netRaw + endedDesks : 0);
    return {
      expiring,
      expiringCount: numOrNull(r.expiringCount) ?? expiring.length,
      expiringDesks: numOrNull(r.expiringDesks) ?? desksOf(expiring),
      expiring30Count: numOrNull(r.expiring30Count) ?? soon.length,
      expiring30Desks: numOrNull(r.expiring30Desks) ?? desksOf(soon),
      bookedDesks,
      endedDesks,
      netDesks: netRaw ?? bookedDesks - endedDesks,
      netDesksPrev: num(r.netDesksPrev),
      months: arr(r.months, (x: any): SmRenewalMonth => ({
        month: str(x.month), bookedDesks: num(x.bookedDesks), endingDesks: num(x.endingDesks), expiring: num(x.expiring)
      })).filter(x => isMonth(x.month))
    };
  }

  private toBreakdown(raw: any): SmBreakdown {
    const d = obj(raw) ?? {};
    return {
      title: str(d.title), subtitle: str(d.subtitle),
      valueLabel: str(d.valueLabel) || 'Value', value2Label: strOrNull(d.value2Label),
      rows: arr(d.rows, (r: any) => ({
        key: str(r.key), label: str(r.label) || str(r.key), value: num(r.value), value2: numOrNull(r.value2), count: numOrNull(r.count)
      }))
    };
  }

  private toRecords<K extends SmRecordKind>(kind: K, raw: any): SmRecords<K> {
    const d = obj(raw) ?? {};
    const rows = arr(d.rows, (r: any) => this.toRecord(kind, r)) as SmRecordRowMap[K][];
    return { title: str(d.title), total: Math.max(num(d.total), rows.length), rows };
  }

  private toRecord(kind: SmRecordKind, r: any): SmRecordRowMap[SmRecordKind] {
    switch (kind) {
      case 'quotations': return {
        quotationId: num(r.quotationId), quotationNumber: str(r.quotationNumber) || (r.quotationId ? `#${r.quotationId}` : ''),
        customer: str(r.customer), location: str(r.location), createdBy: str(r.createdBy), status: str(r.status),
        desks: num(r.desks), createdOn: strOrNull(r.createdOn)
      };
      case 'bookings': return {
        bookingId: num(r.bookingId), customer: str(r.customer), space: str(r.space), location: str(r.location),
        startOn: strOrNull(r.startOn), endOn: strOrNull(r.endOn), status: str(r.status), desks: num(r.desks)
      };
      case 'inquiries': return {
        inquiryId: num(r.inquiryId), name: str(r.name), phone: str(r.phone), type: str(r.type), referenceName: str(r.referenceName),
        status: str(r.status), createdOn: strOrNull(r.createdOn), feedback: str(r.feedback), followUpOn: strOrNull(r.followUpOn)
      };
      case 'leases': {
        const endOn = strOrNull(r.endOn);
        return {
          bookingId: num(r.bookingId), customer: str(r.customer), space: str(r.space), location: str(r.location),
          endOn, desks: num(r.desks), daysLeft: numOrNull(r.daysLeft) ?? daysTo(endOn)
        };
      }
    }
  }
}

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
// Everything is limited to the manager's locations (or the chosen locationId). Tour inquiries too (by their branch,
// WN_Contacts.LocationId); inquiries without a branch count only when no location is chosen ("All my locations"),
// the same rule as complaints. Complaints (sm-complaints contract, 15 Oct 2026) have their own
// endpoint, so the rest of the dashboard keeps working when only they fail. Every response is normalised
// here, so a missing field shows as an empty state on the page instead of breaking it.
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

// ---------- Tour inquiries (the manager's locations; no branch = "All my locations" only) ----------
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

// ---------- Complaints (GET api/sales-manager/complaints, loaded on its own) ----------
/** Complaint status keys (API ComplaintStatus); 'open' is a new complaint, 'resolved' waits for the customer's reply. */
export type SmComplaintStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
/** Current counts of every complaint in scope (not period-bound). */
export interface SmComplaintStatusCounts { open: number; inProgress: number; resolved: number; closed: number; }
/** open / inProgress: now; total: created in the period. NULL category = "Other". */
export interface SmComplaintCategory { category: string; open: number; inProgress: number; total: number; }
/** branch '' = no branch (WhatsApp), label "No branch". */
export interface SmComplaintBranch { branch: string; label: string; open: number; inProgress: number; total: number; }
/** created: raised that month; resolved: resolved or closed that month (by UpdatedOn). */
export interface SmComplaintMonth { month: string; created: number; resolved: number; }
export interface SmOldComplaint {
  complaintId: number; complaintNo: string; customerName: string; category: string;
  /** '' = no branch (WhatsApp). */
  branch: string;
  status: SmComplaintStatus | string;
  createdOn: string | null;
  /** Days since it was raised. */
  ageDays: number;
}
export interface SmComplaints {
  period: SmPeriod;
  periodLabel: string;
  status: SmComplaintStatusCounts;
  /** open + inProgress. */
  activeTotal: number;
  /** Raised in the period / the previous period. */
  newInPeriod: number;
  newInPeriodPrev: number;
  /** Resolved or closed in the period. */
  resolvedInPeriod: number;
  /** Follow-ups (the customer said the problem persists) raised in the period. */
  reopenedInPeriod: number;
  /** Average days from raised to resolved, for resolvedInPeriod; null when none. */
  avgResolutionDays: number | null;
  /** Most active first (open + in progress), then most raised in the period. */
  byCategory: SmComplaintCategory[];
  byBranch: SmComplaintBranch[];
  /** Last 12 months, oldest first. */
  months: SmComplaintMonth[];
  /** Up to 8 open / in-progress complaints, oldest first. */
  oldestActive: SmOldComplaint[];
}

export interface SmDashboard {
  period: SmPeriod;
  periodLabel: string;
  generatedAt: string | null;
  /** The manager's locations (every location for a super admin). */
  locations: SmLocation[];
  /**
   * True: the database update BR_02 has not run yet, so the tour inquiry figures count every branch (not only the
   * manager's locations); the Tour inquiries section says so. False (or not sent): they follow the locations.
   */
  inquiriesAllBranches: boolean;
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
export type SmRecordKind = 'quotations' | 'bookings' | 'inquiries' | 'leases' | 'complaints';

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
export interface SmComplaintRecord {
  complaintId: number; complaintNo: string; customerName: string; phone: string; category: string;
  /** '' = no branch (WhatsApp). */
  branch: string;
  status: SmComplaintStatus | string;
  /** 'whatsapp' or staff. */
  source: string;
  /** Reopened: the customer said the problem persists. */
  isFollowUp: boolean;
  createdOn: string | null; updatedOn: string | null;
  /** Days since it was raised. */
  ageDays: number | null;
  /** First 200 characters. */
  description: string;
}
export interface SmRecordRowMap {
  quotations: SmQuotationRecord; bookings: SmBookingRecord; inquiries: SmInquiryRecord; leases: SmLeaseRecord;
  complaints: SmComplaintRecord;
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

/** The complaints section's database script (its procedures came after the rest of the dashboard's). */
const SM_COMPLAINTS_SCRIPT = 'SM_03';

const complaintsDbMessage = (script: string) =>
  `The complaints section needs the database update ${script}. Ask the WorkNest team to run it, then refresh this page.`;

const SM_COMPLAINTS_WORDING: DashErrorWording = {
  name: 'complaints section',
  any503IsDb: true,
  dbMessage: complaintsDbMessage(SM_COMPLAINTS_SCRIPT)
};

/** Already worded by a describe function (the transport words every failure once). */
const isDescribed = (err: unknown): err is SmError =>
  !!err && typeof err === 'object' && 'needsDbUpdate' in (err as any) && 'title' in (err as any);

/**
 * A complaint status as one of the four keys: lower case, spaces as '_' ("In Progress" -> in_progress),
 * 'new' -> open, 'inprogress' -> in_progress. Anything else is kept (lower case) and shows as it is.
 */
export function complaintStatusKey(v: unknown): SmComplaintStatus | string {
  const s = str(v).trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (s === 'open' || s === 'new') return 'open';
  if (s === 'in_progress' || s === 'inprogress') return 'in_progress';
  return s;
}

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

/** Whole days since an ISO date (never negative); used when the API sends no ageDays. */
function daysSince(date: string | null): number | null {
  if (!date) return null;
  const d = new Date(date.length <= 10 ? date + 'T00:00:00' : date);
  if (isNaN(d.getTime())) return null;
  const t = new Date(); t.setHours(0, 0, 0, 0); d.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((t.getTime() - d.getTime()) / 86400000));
}

/** true / 1 / "true" (flags may come as bit columns). */
const flag = (v: unknown): boolean => v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true';

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

  /**
   * GET api/sales-manager/complaints: the Complaints section (same period and location filter as the dashboard).
   * null when the API sent nothing. A 503 means the complaints update (SM_03) is missing.
   */
  getComplaints(period: SmPeriod, locationId: number | null): Observable<SmComplaints | null> {
    return this.get(`${this.api}/sales-manager/complaints`, { period, locationId }, err => SalesManagerService.describeComplaintsError(err))
      .pipe(map(d => this.toComplaints(d, period)));
  }

  /** GET api/sales-manager/breakdown: drill-down level 2. */
  getBreakdown(metric: SmMetric, params: SmParams): Observable<SmBreakdown> {
    return this.get(`${this.api}/sales-manager/breakdown`, { ...params, metric }).pipe(map(d => this.toBreakdown(d)));
  }

  /** GET api/sales-manager/records/{kind}: drill-down level 3 (read-only, newest first, at most 200 rows). */
  getRecords<K extends SmRecordKind>(kind: K, params: SmParams): Observable<SmRecords<K>> {
    const describe = kind === 'complaints' ? SalesManagerService.describeComplaintsError : SalesManagerService.describeError;
    return this.get(`${this.api}/sales-manager/records/${kind}`, params, describe).pipe(map(d => this.toRecords(kind, d)));
  }

  /** Wording for a failed request (503 = a database update is missing: the one the API names, SM_01 / SM_02). */
  static describeError(err: unknown): SmError {
    if (isDescribed(err)) return err;
    const e = describeDashboardError(err, SM_WORDING);
    const script = e.needsDbUpdate ? dbScriptOf(err) : null;
    return script ? { ...e, message: smDbMessage(script) } : e;
  }

  /** Wording for a failed complaints request (503 = the complaints update, SM_03, or the one the API names). */
  static describeComplaintsError(err: unknown): SmError {
    if (isDescribed(err)) return err;
    const e = describeDashboardError(err, SM_COMPLAINTS_WORDING);
    const script = e.needsDbUpdate ? dbScriptOf(err) : null;
    return script ? { ...e, message: complaintsDbMessage(script) } : e;
  }

  private get(url: string, params: SmParams, describe: (err: unknown) => SmError = SalesManagerService.describeError): Observable<any> {
    return getDashboardData(this.http, url, params, describe);
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
      inquiriesAllBranches: flag(d.inquiriesAllBranches),
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

  private toComplaints(raw: any, period: SmPeriod): SmComplaints | null {
    const d = obj(raw);
    if (!d) return null;
    const p = str(d.period);
    const s = obj(d.status) ?? {};
    const status: SmComplaintStatusCounts = {
      open: num(s.open), inProgress: num(pick(s, 'inProgress', 'in_progress')), resolved: num(s.resolved), closed: num(s.closed)
    };
    const active = (x: { open: number; inProgress: number }) => x.open + x.inProgress;
    return {
      period: p === 'quarter' || p === 'year' || p === 'month' ? p : period,
      periodLabel: str(d.periodLabel),
      status,
      activeTotal: numOrNull(d.activeTotal) ?? active(status),
      newInPeriod: num(d.newInPeriod), newInPeriodPrev: num(d.newInPeriodPrev),
      resolvedInPeriod: num(d.resolvedInPeriod), reopenedInPeriod: num(d.reopenedInPeriod),
      avgResolutionDays: numOrNull(d.avgResolutionDays),
      byCategory: arr(d.byCategory, (x: any): SmComplaintCategory => ({
        category: str(x.category).trim() || 'Other', open: num(x.open), inProgress: num(pick(x, 'inProgress', 'in_progress')), total: num(x.total)
      })).filter(c => c.open + c.inProgress + c.total > 0)
        .sort((a, b) => active(b) - active(a) || b.total - a.total || a.category.localeCompare(b.category)),
      byBranch: arr(d.byBranch, (x: any): SmComplaintBranch => ({
        branch: str(x.branch).trim(), label: str(x.label) || str(x.branch).trim() || 'No branch',
        open: num(x.open), inProgress: num(pick(x, 'inProgress', 'in_progress')), total: num(x.total)
      })),
      months: arr(d.months, (x: any): SmComplaintMonth => ({ month: str(x.month), created: num(x.created), resolved: num(x.resolved) }))
        .filter(x => isMonth(x.month)),
      oldestActive: arr(d.oldestActive, (x: any): SmOldComplaint => {
        const createdOn = strOrNull(x.createdOn);
        const id = num(x.complaintId);
        return {
          complaintId: id, complaintNo: str(x.complaintNo) || (id ? `#${id}` : ''), customerName: str(x.customerName),
          category: str(x.category).trim() || 'Other', branch: str(x.branch).trim(), status: complaintStatusKey(x.status),
          createdOn, ageDays: numOrNull(x.ageDays) ?? daysSince(createdOn) ?? 0
        };
      }).sort((a, b) => b.ageDays - a.ageDays)
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
      case 'complaints': {
        const createdOn = strOrNull(r.createdOn);
        return {
          complaintId: num(r.complaintId), complaintNo: str(r.complaintNo) || (r.complaintId ? `#${r.complaintId}` : ''),
          customerName: str(r.customerName), phone: str(pick(r, 'phone', 'phoneNumber')),
          category: str(r.category).trim() || 'Other', branch: str(r.branch).trim(), status: complaintStatusKey(r.status),
          source: str(r.source), isFollowUp: flag(r.isFollowUp), createdOn, updatedOn: strOrNull(r.updatedOn),
          ageDays: numOrNull(r.ageDays) ?? daysSince(createdOn), description: str(r.description)
        };
      }
    }
  }
}

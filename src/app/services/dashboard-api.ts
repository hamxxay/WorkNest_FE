import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Observable, catchError, map, throwError } from 'rxjs';
import { friendlyHttpMessage } from '../interceptors/error.interceptor';

// ============================================================
// Shared transport for the read-only dashboards (CEO: api/ceo/*, Sales Manager: api/sales-manager/*):
// query building, the { isSuccessful, data } envelope, error wording and the normalising helpers that
// turn a missing field into 0 / '' / [] instead of breaking the page.
// ============================================================

/** Query values; null / undefined / '' are left out of the request. */
export type DashParams = Record<string, string | number | boolean | null | undefined>;

/** A custom date range (yyyy-MM-dd, both days included): period = custom, API CS_01. */
export interface DashRange { from: string; to: string; }

/**
 * The period of a dashboard call (dashboard, rooms, complaints): period, plus from / to for a custom range. A calendar
 * period sends no dates, so those requests stay exactly as before (and work before the database update CS_01).
 */
export function periodQuery(period: string, range: DashRange | null | undefined): DashParams {
  return period === 'custom' && range ? { period, from: range.from, to: range.to } : { period };
}

/**
 * The period of a drill-down call (breakdown, records): a custom range goes as periodFrom / periodTo, since from / to
 * there narrow a list on their own (e.g. the bookings made since 2000 that run today).
 */
export function drillPeriodQuery(period: string, range: DashRange | null | undefined): DashParams {
  return period === 'custom' && range ? { period, periodFrom: range.from, periodTo: range.to } : { period };
}

/** The custom range a response covers (its from / to), or null. */
export function rangeOf(d: any): DashRange | null {
  const from = typeof d?.from === 'string' ? d.from : '';
  const to = typeof d?.to === 'string' ? d.to : '';
  return /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) ? { from, to } : null;
}

/** A period word from the API ("month" | "quarter" | "year" | "custom"), else the one asked for. */
export function periodOf<P extends string>(raw: unknown, asked: P): P {
  const p = typeof raw === 'string' ? raw : '';
  return (p === 'month' || p === 'quarter' || p === 'year' || p === 'custom' ? p : asked) as P;
}

/** A failed dashboard request, worded for the page. */
export interface DashError {
  status: number;
  title: string;
  message: string;
  /** 503 from the API: the dashboard's database script has not been run yet. */
  needsDbUpdate: boolean;
}

/** How one dashboard words its errors. */
export interface DashErrorWording {
  /** "CEO dashboard", "sales dashboard" (used in sentences). */
  name: string;
  /** Message for a 503 that means the database script is missing. */
  dbMessage: string;
  /** True: every 503 means the database update. False: only when the API's message says so. */
  any503IsDb?: boolean;
}

/**
 * The server's own message on a failed request ("Location mismatch. You aren't assigned to Location 3."), or null
 * when it sent none: the error interceptor fills an empty body with its plain wording for the status ("You don't
 * have permission to do this."), which is not the server's.
 */
export function serverMessageOf(err: unknown): string | null {
  if (!(err instanceof HttpErrorResponse)) return null;
  const body = err.error;
  const text = body && typeof body === 'object' && typeof body.message === 'string' ? body.message.trim() : '';
  if (!text || text.length > 300) return null;
  return text === friendlyHttpMessage(new HttpErrorResponse({ status: err.status })) ? null : text;
}

export function describeDashboardError(err: unknown, w: DashErrorWording): DashError {
  if (err && typeof err === 'object' && 'needsDbUpdate' in (err as any) && 'title' in (err as any)) return err as DashError;
  const http = err instanceof HttpErrorResponse ? err : null;
  const status = http?.status ?? (err as any)?.status ?? -1;
  const apiMessage: string = (http?.error && typeof http.error === 'object' ? http.error.message : null)
    ?? (err as any)?.message ?? '';

  if (status === 503) {
    const db = w.any503IsDb || /database|db update|not set up|table|script/i.test(apiMessage) || !apiMessage;
    return db
      ? { status, needsDbUpdate: true, title: 'Database update needed', message: w.dbMessage }
      : { status, needsDbUpdate: false, title: 'Temporarily unavailable', message: apiMessage || 'The service is temporarily unavailable. Please try again in a few minutes.' };
  }
  if (status === 403) {
    // The server's reason when it gave one (no locations yet, a location that is not theirs...), else the general one.
    return {
      status, needsDbUpdate: false, title: 'No access',
      message: serverMessageOf(err) ?? `Your account cannot open the ${w.name}. Ask a super admin to check your role.`
    };
  }
  if (status === 404) {
    return { status, needsDbUpdate: false, title: 'Not available yet', message: `The server does not have the ${w.name} yet. It will work once the API update is live.` };
  }
  if (status === 0) {
    return { status, needsDbUpdate: false, title: 'Cannot reach the server', message: 'Check your internet connection and try again.' };
  }
  return {
    status, needsDbUpdate: false, title: 'Could not load',
    message: apiMessage && apiMessage.length <= 300 ? apiMessage : 'Something went wrong. Please try again.'
  };
}

/**
 * GET with the dashboard query rules; unwraps { isSuccessful, data } (a bare body is accepted too) and turns
 * every failure into a worded DashError via `describe`.
 */
export function getDashboardData(
  http: HttpClient, url: string, params: DashParams, describe: (err: unknown) => DashError
): Observable<any> {
  let p = new HttpParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '') continue;
    p = p.set(k, String(v));
  }
  return http.get<any>(url, { params: p }).pipe(
    map(res => {
      if (res && typeof res === 'object' && ('isSuccessful' in res || 'isSuccess' in res)) {
        if (res.isSuccessful === false || res.isSuccess === false) {
          throw { status: 200, needsDbUpdate: false, title: 'Could not load', message: str(res.message) || 'Something went wrong. Please try again.' } as DashError;
        }
        return res.data ?? null;
      }
      return res ?? null;
    }),
    catchError(err => throwError(() => describe(err)))
  );
}

// ---------- normalising helpers ----------

export const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
};
export const numOrNull = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : num(v));
export const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
export const strOrNull = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));
export const arr = <T>(v: unknown, fn: (x: any) => T): T[] => (Array.isArray(v) ? v.filter(x => x != null).map(fn) : []);
export const obj = (v: unknown): any | null => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
/** True for a "yyyy-MM" month key. */
export const isMonth = (m: string): boolean => /^\d{4}-\d{2}/.test(m);

/** Rates may arrive as a fraction (0.82) or a percentage (82): always returns a percentage. */
export function percent(rate: unknown, part?: number, whole?: number): number {
  const r = num(rate);
  if (r > 0 && r <= 1 && part !== undefined && whole && whole > 0) {
    const expected = (part / whole) * 100;
    if (Math.abs(expected - r * 100) < Math.abs(expected - r)) return r * 100;
  }
  return r;
}

/** A percentage kept within 0-100. */
export const capPct = (n: number): number => Math.min(100, Math.max(0, n));

/**
 * Quotations created in the period that were booked (the API's quotationsBooked), never more than the quotations.
 * An older API does not send it: the bookings created in the period stand in for it, at most one per quotation.
 */
export function quotationsBookedOf(sent: unknown, bookings: number, quotations: number): number {
  return Math.max(0, Math.min(numOrNull(sent) ?? bookings, quotations));
}

/**
 * Sales conversion (owner's rule, 16 Oct 2026): of the quotations created in the period, the share that was booked,
 * so never above 100%. `rate` is the API's conversionRate (a fraction or a percentage; missing, it is worked out
 * from the counts). `scale` (100 or 1) turns the previous period's rate the same way when it came as a fraction.
 */
export function conversionOf(rate: unknown, sentBooked: unknown, bookings: number, quotations: number):
  { quotationsBooked: number; rate: number; scale: number } {
  const quotationsBooked = quotationsBookedOf(sentBooked, bookings, quotations);
  const rawRate = numOrNull(rate);
  const r = rawRate === null
    ? (quotations > 0 ? (quotationsBooked / quotations) * 100 : 0)
    : percent(rawRate, quotationsBooked, quotations);
  const scale = rawRate !== null && rawRate > 0 && r !== rawRate ? 100 : 1;
  return { quotationsBooked, rate: capPct(r), scale };
}

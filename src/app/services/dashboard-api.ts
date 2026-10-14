import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Observable, catchError, map, throwError } from 'rxjs';

// ============================================================
// Shared transport for the read-only dashboards (CEO: api/ceo/*, Sales Manager: api/sales-manager/*):
// query building, the { isSuccessful, data } envelope, error wording and the normalising helpers that
// turn a missing field into 0 / '' / [] instead of breaking the page.
// ============================================================

/** Query values; null / undefined / '' are left out of the request. */
export type DashParams = Record<string, string | number | boolean | null | undefined>;

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
    return { status, needsDbUpdate: false, title: 'No access', message: `Your account cannot open the ${w.name}. Ask a super admin to check your role.` };
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

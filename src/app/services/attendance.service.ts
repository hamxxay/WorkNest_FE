import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Observable, catchError, map, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { arr, num, numOrNull, obj, serverMessageOf, str, strOrNull } from './dashboard-api';
import type { XlsxCell, XlsxSheet } from '../utils/xlsx';

// ============================================================
// Customer attendance, staff side (contract: att/CONTRACT.md). Worked out by the API on request from the room
// machines' scans; staff only read it, and admins / super admins switch it on per customer:
//   GET admin/attendance/customers                         every customer of the user's locations (enabled first)
//   PUT admin/customers/{id}/attendance  { enabled }       admin / super admin / sales executive
//   GET admin/customers/{id}/attendance/status|shifts|holidays|employees
//   GET admin/attendance/report?customerId&from&to&personId (also for a customer that has it switched off)
// 503 = the database script ATT_01 has not run yet. Rows are normalised here (a missing field shows as "-").
// ============================================================

/** Shown while the API answers 503 (tables / procedures of ATT_01 missing). */
export const ATTENDANCE_NOT_INSTALLED = 'Attendance is not installed yet (run ATT_01)';

/** Longest range one report request may cover (days, both ends included). */
export const ATTENDANCE_MAX_DAYS = 62;

export type AttendanceStatusCode = 'Present' | 'Late' | 'HalfDay' | 'MissingOut' | 'Absent' | 'Holiday' | 'OffDay' | 'Pending';

export interface AttendanceError {
  status: number;
  message: string;
  /** 503: the database script ATT_01 has not run yet. */
  notInstalled: boolean;
}

export interface AttendanceCustomer { customerId: number; customerName: string; enabled: boolean; employeeCount: number; }

export interface AttendanceStatus { enabled: boolean; customerId: number | null; customerName: string | null; }

export interface AttendanceShift {
  id: number;
  name: string;
  startTime: string;
  endTime: string;
  graceMinutes: number;
  halfDayMinutes: number | null;
  workDays: string[];
  isDefault: boolean;
  crossesMidnight: boolean;
  employeeCount: number;
}

export interface AttendanceHoliday { id: number; date: string; name: string; }

export interface AttendanceEmployee {
  personId: number;
  name: string;
  idNumberMasked: string;
  rooms: string[];
  shiftId: number | null;
  shiftName: string | null;
  usesDefaultShift: boolean;
  active: boolean;
  enrolled: boolean;
}

export interface AttendanceDay {
  personId: number;
  name: string;
  date: string;
  checkIn: string | null;
  checkOut: string | null;
  workedMinutes: number | null;
  scans: number;
  status: AttendanceStatusCode;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  overtimeMinutes: number;
  onHoliday: boolean;
  onOffDay: boolean;
  shiftName: string | null;
  room: string | null;
}

export interface AttendanceSummary {
  personId: number;
  name: string;
  present: number;
  late: number;
  halfDay: number;
  missingOut: number;
  absent: number;
  holidays: number;
  offDays: number;
  workedMinutes: number;
  overtimeMinutes: number;
  lateMinutes: number;
}

export interface AttendanceReport {
  customerId: number;
  customerName: string;
  from: string;
  to: string;
  days: AttendanceDay[];
  summary: AttendanceSummary[];
}

const STATUSES: AttendanceStatusCode[] = ['Present', 'Late', 'HalfDay', 'MissingOut', 'Absent', 'Holiday', 'OffDay', 'Pending'];

/** Status words as the screens show them. */
export const ATTENDANCE_STATUS_LABEL: Record<AttendanceStatusCode, string> = {
  Present: 'Present', Late: 'Late', HalfDay: 'Half day', MissingOut: 'Missing out', Absent: 'Absent',
  Holiday: 'Holiday', OffDay: 'Off day', Pending: 'Pending'
};

const bool = (v: unknown): boolean => v === true || v === 1 || v === 'true';

function toStatus(v: unknown): AttendanceStatusCode {
  const s = str(v).replace(/[\s_-]/g, '').toLowerCase();
  return STATUSES.find(x => x.toLowerCase() === s) ?? 'Pending';
}

const toCustomer = (d: any): AttendanceCustomer => ({
  customerId: num(d.customerId),
  customerName: str(d.customerName) || `Customer #${num(d.customerId)}`,
  enabled: bool(d.enabled),
  employeeCount: num(d.employeeCount)
});

const toStatusInfo = (d: any): AttendanceStatus => ({
  enabled: bool(d?.enabled),
  customerId: numOrNull(d?.customerId),
  customerName: strOrNull(d?.customerName)
});

/** "09:00:00" -> "09:00". */
const hhmm = (v: unknown): string => str(v).slice(0, 5);

const toShift = (d: any): AttendanceShift => ({
  id: num(d.id),
  name: str(d.name),
  startTime: hhmm(d.startTime),
  endTime: hhmm(d.endTime),
  graceMinutes: num(d.graceMinutes),
  halfDayMinutes: numOrNull(d.halfDayMinutes),
  // Normally an array; a comma list ("Mon,Tue") is accepted too.
  workDays: Array.isArray(d.workDays) ? d.workDays.map(str) : str(d.workDays).split(',').map(s => s.trim()).filter(Boolean),
  isDefault: bool(d.isDefault),
  crossesMidnight: bool(d.crossesMidnight),
  employeeCount: num(d.employeeCount)
});

const toHoliday = (d: any): AttendanceHoliday => ({ id: num(d.id), date: str(d.date).slice(0, 10), name: str(d.name) });

const toEmployee = (d: any): AttendanceEmployee => ({
  personId: num(d.personId),
  name: str(d.name) || `Person #${num(d.personId)}`,
  idNumberMasked: str(d.idNumberMasked),
  rooms: arr(d.rooms, str),
  shiftId: numOrNull(d.shiftId),
  shiftName: strOrNull(d.shiftName),
  usesDefaultShift: bool(d.usesDefaultShift),
  active: d.active === undefined ? true : bool(d.active),
  enrolled: bool(d.enrolled)
});

const toDay = (d: any): AttendanceDay => ({
  personId: num(d.personId),
  name: str(d.name),
  date: str(d.date).slice(0, 10),
  checkIn: strOrNull(d.checkIn),
  checkOut: strOrNull(d.checkOut),
  workedMinutes: numOrNull(d.workedMinutes),
  scans: num(d.scans),
  status: toStatus(d.status),
  lateMinutes: num(d.lateMinutes),
  earlyLeaveMinutes: num(d.earlyLeaveMinutes),
  overtimeMinutes: num(d.overtimeMinutes),
  onHoliday: bool(d.onHoliday),
  onOffDay: bool(d.onOffDay),
  shiftName: strOrNull(d.shiftName),
  room: strOrNull(d.room)
});

const toSummary = (d: any): AttendanceSummary => ({
  personId: num(d.personId),
  name: str(d.name),
  present: num(d.present),
  late: num(d.late),
  halfDay: num(d.halfDay),
  missingOut: num(d.missingOut),
  absent: num(d.absent),
  holidays: num(d.holidays),
  offDays: num(d.offDays),
  workedMinutes: num(d.workedMinutes),
  overtimeMinutes: num(d.overtimeMinutes),
  lateMinutes: num(d.lateMinutes)
});

/** A failed attendance request, worded for the page. */
export function describeAttendanceError(err: unknown): AttendanceError {
  if (err && typeof err === 'object' && 'notInstalled' in (err as any)) return err as AttendanceError;
  const http = err instanceof HttpErrorResponse ? err : null;
  const status = http?.status ?? -1;
  if (status === 503) return { status, notInstalled: true, message: ATTENDANCE_NOT_INSTALLED };
  if (status === 0) return { status, notInstalled: false, message: 'Cannot reach the server. Check your internet connection and try again.' };
  if (status === 403) return { status, notInstalled: false, message: serverMessageOf(err) ?? 'Your account cannot do this. Ask a super admin to check your role.' };
  if (status === 404) {
    return { status, notInstalled: false, message: serverMessageOf(err) ?? 'Not available on this server yet. It will work once the API update is live.' };
  }
  // The error interceptor puts a readable message in error.message (never technical text).
  const msg = (http?.error && typeof http.error === 'object' ? str(http.error.message) : '') || str((err as any)?.message);
  return { status, notInstalled: false, message: msg && msg.length <= 300 ? msg : 'Something went wrong. Please try again.' };
}

/** Unwraps { isSuccessful, data }; isSuccessful false becomes an AttendanceError (the API's message). */
function unwrap(res: any): any {
  if (res && typeof res === 'object' && 'isSuccessful' in res && res.isSuccessful === false) {
    throw { status: 200, notInstalled: false, message: str(res.message) || 'Something went wrong. Please try again.' } as AttendanceError;
  }
  return res && typeof res === 'object' && 'data' in res ? res.data : res;
}

@Injectable({ providedIn: 'root' })
export class AttendanceService {
  private http = inject(HttpClient);
  private api = environment.apiUrl;

  private get<T>(path: string, fn: (data: any) => T, params?: HttpParams): Observable<T> {
    return this.http.get<any>(`${this.api}/${path}`, { params }).pipe(
      map(res => fn(unwrap(res))),
      catchError(err => throwError(() => describeAttendanceError(err)))
    );
  }

  /** Customers with attendance switched on first, then by name. */
  getCustomers(): Observable<AttendanceCustomer[]> {
    return this.get('admin/attendance/customers', d => arr(d, toCustomer)
      .sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.customerName.localeCompare(b.customerName)));
  }

  getStatus(customerId: number): Observable<AttendanceStatus> {
    return this.get(`admin/customers/${customerId}/attendance/status`, d => toStatusInfo(obj(d)));
  }

  /** Switches attendance on / off (admin / super admin). Answers the new status (the asked one when the API sends none). */
  setEnabled(customerId: number, enabled: boolean): Observable<AttendanceStatus> {
    return this.http.put<any>(`${this.api}/admin/customers/${customerId}/attendance`, { enabled }).pipe(
      map(res => {
        const d = obj(unwrap(res));
        return d && 'enabled' in d ? toStatusInfo(d) : { enabled, customerId, customerName: null };
      }),
      catchError(err => throwError(() => describeAttendanceError(err)))
    );
  }

  getShifts(customerId: number): Observable<AttendanceShift[]> {
    return this.get(`admin/customers/${customerId}/attendance/shifts`, d => arr(d, toShift));
  }

  getHolidays(customerId: number): Observable<AttendanceHoliday[]> {
    return this.get(`admin/customers/${customerId}/attendance/holidays`,
      d => arr(d, toHoliday).sort((a, b) => a.date.localeCompare(b.date)));
  }

  getEmployees(customerId: number): Observable<AttendanceEmployee[]> {
    return this.get(`admin/customers/${customerId}/attendance/employees`, d => arr(d, toEmployee));
  }

  getReport(customerId: number, from: string, to: string, personId?: number | null): Observable<AttendanceReport> {
    let params = new HttpParams().set('customerId', customerId).set('from', from).set('to', to);
    if (personId) params = params.set('personId', personId);
    return this.get('admin/attendance/report', raw => {
      const d = obj(raw) ?? {};
      return {
        customerId: num(d.customerId) || customerId,
        customerName: str(d.customerName),
        from: str(d.from).slice(0, 10) || from,
        to: str(d.to).slice(0, 10) || to,
        days: arr(d.days, toDay),
        summary: arr(d.summary, toSummary)
      };
    }, params);
  }
}

// ---------- display helpers (shared by the report page, the customer detail tab and the exports) ----------

/** The first and last day of the current month (yyyy-MM-dd); the API lists no future days. */
export function thisMonthRange(today = new Date()): { from: string; to: string } {
  const pad = (n: number) => String(n).padStart(2, '0');
  const y = today.getFullYear(), m = today.getMonth() + 1;
  const last = new Date(y, m, 0).getDate();
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(last)}` };
}

/** Why a range cannot be asked for (empty, reversed, longer than 62 days), or '' when it is fine. */
export function rangeProblem(from: string, to: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return 'Choose both dates.';
  if (from > to) return 'From date cannot be later than To date.';
  const days = Math.round((Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10))
    - Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))) / 86_400_000) + 1;
  return days > ATTENDANCE_MAX_DAYS ? `Choose at most ${ATTENDANCE_MAX_DAYS} days at a time.` : '';
}

/** Machine time as it was on the machine (no time zone conversion): "2026-10-28T09:04:11" -> "09:04 AM". */
export function attTime(v: string | null | undefined): string {
  const s = str(v);
  const m = /^(\d{1,2}):(\d{2})/.exec((s.includes('T') ? s.split('T')[1] : s).trim());
  if (!m) return '-';
  const h = Number(m[1]);
  return `${String(h % 12 || 12).padStart(2, '0')}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

/** True when the check-out is on a later calendar day than the work date (night shift). */
export function nextDay(day: AttendanceDay): boolean {
  return !!day.checkOut && day.checkOut.slice(0, 10) > day.date;
}

/** 485 -> "8h 05m"; null -> "-". */
export function attHours(min: number | null | undefined): string {
  if (min === null || min === undefined) return '-';
  const m = Math.max(0, Math.round(min));
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/** Short minutes for late / early / overtime: 12 -> "12m", 70 -> "1h 10m". */
export function attMinutes(min: number): string {
  const m = Math.max(0, Math.round(min));
  return m < 60 ? `${m}m` : attHours(m);
}

/** "Late 12m · Early 5m · OT 1h 10m", '' when none. */
export function attExtras(d: AttendanceDay): string {
  return [
    d.lateMinutes > 0 ? `Late ${attMinutes(d.lateMinutes)}` : '',
    d.earlyLeaveMinutes > 0 ? `Early ${attMinutes(d.earlyLeaveMinutes)}` : '',
    d.overtimeMinutes > 0 ? `OT ${attMinutes(d.overtimeMinutes)}` : ''
  ].filter(Boolean).join(' · ');
}

/** Status with the holiday / off-day note ("Present (holiday)"). */
export function attStatusText(d: AttendanceDay): string {
  const base = ATTENDANCE_STATUS_LABEL[d.status];
  return d.onHoliday ? `${base} (holiday)` : d.onOffDay ? `${base} (off day)` : base;
}

/** The report as two sheets (Daily, Summary) for downloadXlsx. */
export function attendanceSheets(r: AttendanceReport): XlsxSheet[] {
  const daily: XlsxCell[][] = [
    ['Name', 'Date', 'Shift', 'Room', 'In', 'Out', 'Hours', 'Worked minutes', 'Status', 'Late (min)', 'Early leave (min)', 'Overtime (min)', 'Scans'],
    ...r.days.map(d => [
      d.name, d.date, d.shiftName ?? '', d.room ?? '', d.checkIn ? attTime(d.checkIn) : '',
      d.checkOut ? attTime(d.checkOut) + (nextDay(d) ? ' (+1)' : '') : '',
      d.workedMinutes !== null ? attHours(d.workedMinutes) : '', d.workedMinutes,
      attStatusText(d), d.lateMinutes || null, d.earlyLeaveMinutes || null, d.overtimeMinutes || null, d.scans
    ])
  ];
  const summary: XlsxCell[][] = [
    ['Name', 'Present', 'Late', 'Half day', 'Missing out', 'Absent', 'Holidays', 'Off days', 'Worked', 'Worked minutes', 'Overtime', 'Late (min)'],
    ...r.summary.map(s => [
      s.name, s.present, s.late, s.halfDay, s.missingOut, s.absent, s.holidays, s.offDays,
      attHours(s.workedMinutes), s.workedMinutes, attHours(s.overtimeMinutes), s.lateMinutes
    ])
  ];
  return [{ name: 'Daily', rows: daily }, { name: 'Summary', rows: summary }];
}

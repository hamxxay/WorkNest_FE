import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Observable, TimeoutError, catchError, map, of, throwError, timeout } from 'rxjs';
import { environment } from '../../environments/environment';
import { arr, num, numOrNull, obj, str } from './dashboard-api';

// ============================================================
// Access page API (api/access-officer/*): door access by CNIC for the Access Officer (role access_officer) and
// super admins. Shared contract with the API and the mobile app (access-officer contract, 15 Oct 2026):
//   lookup (GET ?cnic=) -> add-to-room (pending match) -> enroll/face | enroll/fingerprint (assigned, access on)
//   -> remove-access / restore-access. Envelope { isSuccessful, message, data }, camelCase.
// Every response is normalised here, so a missing field shows as an empty value on the page instead of breaking it.
// ============================================================

/** pending = the customer added this CNIC and staff have not checked it yet; assigned = on the room. */
export type AoMatchState = 'pending' | 'assigned';
export type AoEnrollType = 'face' | 'fingerprint';

export interface AoPerson {
  personId: number | null;
  name: string;
  email: string;
  phone: string;
  idType: string;
  idNumber: string;
}

export interface AoCredentials { face: boolean; fingerprint: boolean; card: boolean; }

/** The booked room's door machine; null on the match when no machine is linked to the room. */
export interface AoRoomMachine { name: string; online: boolean; }

export interface AoMatch {
  bookingDetailId: number;
  bookingId: number | null;
  room: string;
  spaceCode: string;
  location: string;
  locationId: number | null;
  /** The booking owner (customer / company name). */
  customer: string;
  bookingStatus: string;
  startOn: string | null;
  endOn: string | null;
  state: AoMatchState;
  /** Assigned and the person's access status is on (false after Remove access). */
  accessEnabled: boolean;
  credentials: AoCredentials;
  roomMachine: AoRoomMachine | null;
  seats: { used: number; total: number } | null;
  /** Sent with an add-to-room answer (the person may not have existed before the CNIC check). */
  personId: number | null;
}

export interface AoLookup {
  cnic: string;
  /** null when only pending requests exist and the person has no record yet (it is made by Add to room). */
  person: AoPerson | null;
  matches: AoMatch[];
}

/** One machine's part of an enrolment / access change (HikEnrollDeviceResultDto). */
export interface AoDeviceResult {
  deviceId: number;
  device: string;
  ok: boolean;
  /** The machine was offline: the change applies when it reconnects. */
  queued: boolean;
  error: string;
  /** Read back from the machine: true = found there, false = missing, null = not checked. */
  verified: boolean | null;
}

/** POST enroll/{face|fingerprint} answer (HikEnrollResultDto). */
export interface AoEnrollResult {
  ok: boolean;
  type: string;
  machineId: string;
  error: string;
  quality: string;
  /** E.g. "Saved on 3 of 3 machines · 1 machine offline (queued)". */
  summary: string;
  devices: AoDeviceResult[];
}

/** POST add-to-room answer: the updated match and the API's sentence ("Ali is on Office 349 now. ..."). */
export interface AoAddResult {
  match: AoMatch | null;
  message: string;
}

/** POST remove-access / restore-access answer: { match, machines } (machines = HikAccessSyncResultDto). */
export interface AoAccessResult {
  match: AoMatch | null;
  /** Machines that were updated (empty when the person was never enrolled). */
  devices: AoDeviceResult[];
  /** The API's sentence ("Ali's door access to Office 349 and the entrances is removed. ..."). */
  message: string;
  /** The machines could not be updated right away (the access status itself is saved). */
  machineError: string;
}

export type AoErrorKind = 'not-found' | 'db' | 'forbidden' | 'conflict' | 'invalid' | 'timeout' | 'offline' | 'missing-api' | 'other';

/** A failed request, worded for the page. */
export interface AoError {
  status: number;
  kind: AoErrorKind;
  title: string;
  message: string;
  /** Enrolment only: the per-machine results the API sent with the failure, if any. */
  enroll?: AoEnrollResult | null;
}

/** Lookups and access changes (an access change also updates the door machines). */
const REQUEST_TIMEOUT_MS = 45_000;
/** The room machine waits up to ~90 s for the face / finger, then the credential is copied to the entrances. */
export const ENROLL_TIMEOUT_MS = 130_000;

export const NOT_FOUND_MESSAGE = 'No customer has added this CNIC to a confirmed booking at your locations. '
  + 'Ask the customer to add them under My Bookings > Employees, or ask the sales team.';
export const DB_UPDATE_MESSAGE = 'The Access page needs the database update AO_01.';

@Injectable({ providedIn: 'root' })
export class AccessOfficerService {
  private http = inject(HttpClient);
  private api = `${environment.apiUrl}/access-officer`;

  /** GET api/access-officer/lookup?cnic=: the person and every room they are on (or waiting for) at my locations. */
  lookup(cnic: string): Observable<AoLookup> {
    const params = new HttpParams().set('cnic', cnic.trim());
    return this.http.get<any>(`${this.api}/lookup`, { params }).pipe(
      timeout(REQUEST_TIMEOUT_MS),
      map(res => normaliseLookup(unwrap(res), cnic)),
      catchError(err => throwError(() => describeError(err, 'lookup')))
    );
  }

  /** POST add-to-room: the CNIC check for a pending match (the person is put on the room). Returns the updated match. */
  addToRoom(bookingDetailId: number, cnic: string): Observable<AoAddResult> {
    return this.http.post<any>(`${this.api}/add-to-room`, { bookingDetailId, cnic: cnic.trim() }).pipe(
      timeout(REQUEST_TIMEOUT_MS),
      map(res => {
        const d = obj(unwrap(res));
        const m = obj(d?.match) ?? d;
        return {
          match: m && m.bookingDetailId != null ? normaliseMatch(m) : null,
          message: isEnvelope(res) ? str(res.message).trim() : ''
        };
      }),
      catchError(err => throwError(() => describeError(err, 'write')))
    );
  }

  /**
   * POST enroll/{face|fingerprint}: captured on the room machine, then copied to every Entrance machine. The request
   * stays open while the machine waits for the person (up to ~90 s).
   */
  enroll(type: AoEnrollType, bookingDetailId: number, personId: number, fingerNo = 1): Observable<AoEnrollResult> {
    const body: Record<string, number> = { bookingDetailId, personId };
    if (type === 'fingerprint') body['fingerNo'] = fingerNo;
    return this.http.post<any>(`${this.api}/enroll/${type}`, body).pipe(
      timeout(ENROLL_TIMEOUT_MS),
      map(res => {
        const data = isEnvelope(res) ? res.data : res;
        const result = normaliseEnroll(data);
        // An envelope that says it failed without a result body: carry its message as the error.
        if (isEnvelope(res) && res.isSuccessful === false && !result.error) result.error = str(res.message);
        if (isEnvelope(res) && res.isSuccessful === false) result.ok = false;
        return result;
      }),
      catchError(err => throwError(() => describeError(err, 'enroll')))
    );
  }

  /** POST remove-access: door access off on the room + Entrance machines; the person stays on the booking. */
  removeAccess(bookingDetailId: number, personId: number): Observable<AoAccessResult> {
    return this.access('remove-access', bookingDetailId, personId);
  }

  /** POST restore-access: door access back on. */
  restoreAccess(bookingDetailId: number, personId: number): Observable<AoAccessResult> {
    return this.access('restore-access', bookingDetailId, personId);
  }

  /**
   * Names of the signed-in officer's locations (GET api/location/all, which the API limits to the caller's
   * locations; `ids` narrows it again). [] when the call fails: the header then leaves the locations out.
   */
  locationNames(ids: number[] | null): Observable<string[]> {
    return this.http.get<any>(`${environment.apiUrl}/location/all`).pipe(
      timeout(REQUEST_TIMEOUT_MS),
      map(res => {
        const rows: any[] = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
        return rows
          .filter(l => (l?.name ?? l?.Name) && (!ids || ids.includes(Number(l.id ?? l.Id))))
          .map(l => String(l.name ?? l.Name))
          .sort((a, b) => a.localeCompare(b));
      }),
      catchError(() => of([] as string[]))
    );
  }

  private access(action: 'remove-access' | 'restore-access', bookingDetailId: number, personId: number): Observable<AoAccessResult> {
    return this.http.post<any>(`${this.api}/${action}`, { bookingDetailId, personId }).pipe(
      timeout(REQUEST_TIMEOUT_MS),
      map(res => {
        const d = obj(unwrap(res));
        const m = obj(d?.match) ?? (d?.bookingDetailId != null ? d : null);
        const machines = obj(d?.machines) ?? (Array.isArray(d?.devices) ? d : null);
        return {
          match: m ? normaliseMatch(m) : null,
          devices: arr(machines?.devices, normaliseDevice),
          message: isEnvelope(res) ? str(res.message).trim() : '',
          machineError: str(machines?.error).trim()
        };
      }),
      catchError(err => throwError(() => describeError(err, 'write')))
    );
  }
}

// ---------- transport helpers ----------

function isEnvelope(res: any): boolean {
  return !!res && typeof res === 'object' && ('isSuccessful' in res || 'isSuccess' in res);
}

/** Unwraps { isSuccessful, data }; a bare body is accepted too. An envelope that says it failed becomes an error. */
function unwrap(res: any): any {
  if (!isEnvelope(res)) return res ?? null;
  if (res.isSuccessful === false || res.isSuccess === false) {
    throw { status: 200, kind: 'other', title: 'Could not finish', message: str(res.message) || 'Something went wrong. Please try again.' } as AoError;
  }
  return res.data ?? null;
}

function isAoError(err: unknown): err is AoError {
  return !!err && typeof err === 'object' && 'kind' in (err as any) && 'title' in (err as any);
}

/** Plain-language wording for a failed request. `what` picks the wording of a 404 and keeps enrolment results. */
export function describeError(err: unknown, what: 'lookup' | 'write' | 'enroll'): AoError {
  if (isAoError(err)) return err;
  if (err instanceof TimeoutError) {
    return what === 'enroll'
      ? { status: 0, kind: 'timeout', title: 'The machine did not answer in time', message: 'Nothing came back from the room machine. Check that the person is at the machine and that it is switched on, then try again.' }
      : { status: 0, kind: 'timeout', title: 'The server took too long', message: 'The request took too long. Please try again.' };
  }
  const http = err instanceof HttpErrorResponse ? err : null;
  const status = http?.status ?? (err as any)?.status ?? -1;
  const body = http?.error && typeof http.error === 'object' ? http.error : null;
  // The API answered with its envelope (as opposed to a server that does not have these endpoints yet).
  const fromApi = !!body && ('isSuccessful' in body || 'isSuccess' in body || 'data' in body || 'devices' in body);
  // error.interceptor puts a readable message on every failure (the API's own words first).
  const message: string = str(body?.message) || str((err as any)?.message);
  const enroll = what === 'enroll' && body ? enrollFromBody(body) : null;

  if (status === 0) {
    return { status, kind: 'offline', title: 'Cannot reach the server', message: 'Check the internet connection and try again.', enroll };
  }
  if (status === 503) {
    // The API answers 503 "The Access page needs the database update AO_01." until the script is run (or names the
    // customer employees update it depends on); its own words name the script.
    if (/AO_01|database/i.test(message)) {
      return { status, kind: 'db', title: 'Database update needed', message: fromApi ? message : DB_UPDATE_MESSAGE };
    }
    return {
      status, kind: 'other', title: 'Temporarily unavailable',
      message: fromApi && message ? message : 'The service is temporarily unavailable. Please try again in a few minutes.', enroll
    };
  }
  if (status === 404) {
    if (!fromApi) {
      return { status, kind: 'missing-api', title: 'Not available yet', message: 'The server does not have the Access page yet. It will work once the API update is live.' };
    }
    return what === 'lookup'
      ? { status, kind: 'not-found', title: 'No match found', message: message || NOT_FOUND_MESSAGE }
      : { status, kind: 'not-found', title: 'Not found', message: message || 'This person or room was not found. Search the CNIC again.', enroll };
  }
  if (status === 403) {
    return {
      status, kind: 'forbidden', title: 'Not allowed',
      message: fromApi && message ? message : 'Your account cannot do this here. This room may not be at your locations.', enroll
    };
  }
  if (status === 409) {
    // "Ali is already on Office 349.", "... is already removed.", "Restore access before enrolling."
    return { status, kind: 'conflict', title: 'Not possible right now', message: message || 'This was already done. Search the CNIC again to see the latest.', enroll };
  }
  if (status === 400 && enroll) {
    // A failed enrolment: 400 with the HikEnrollResultDto (per-machine results) and its error as the message.
    return { status, kind: 'other', title: 'Enrolment failed', message: message || enroll.error || 'The machine did not save it. Please try again.', enroll };
  }
  if (status === 400 || status === 422) {
    return { status, kind: 'invalid', title: 'Check the details', message: message || 'Some of the details are not valid.', enroll };
  }
  return {
    status, kind: 'other', title: what === 'enroll' ? 'Enrolment failed' : 'Something went wrong',
    message: message || 'Something went wrong. Please try again.', enroll
  };
}

/** HikEnrollResultDto from an error body: bare, or inside the envelope's data. */
function enrollFromBody(body: any): AoEnrollResult | null {
  const d = obj(body?.data) ?? body;
  if (!d || !(Array.isArray(d.devices) || 'machineId' in d || 'summary' in d)) return null;
  const r = normaliseEnroll(d);
  r.ok = false;
  return r;
}

// ---------- normalisers ----------

const bool = (v: unknown): boolean => v === true || v === 1 || v === 'true' || v === '1';
const dateOrNull = (v: unknown): string | null => {
  const s = str(v).trim();
  return s ? s : null;
};

function normaliseLookup(d: any, typed: string): AoLookup {
  const p = obj(d?.person);
  return {
    cnic: str(d?.cnic) || typed.trim(),
    person: p ? {
      personId: numOrNull(p.personId),
      name: str(p.name).trim(),
      email: str(p.email).trim(),
      phone: str(p.phone).trim(),
      idType: str(p.idType).trim() || 'CNIC',
      idNumber: str(p.idNumber).trim()
    } : null,
    matches: arr(d?.matches, normaliseMatch)
  };
}

export function normaliseMatch(m: any): AoMatch {
  const c = obj(m?.credentials);
  const rm = obj(m?.roomMachine);
  const seats = obj(m?.seats);
  const state: AoMatchState = str(m?.state).toLowerCase() === 'assigned' ? 'assigned' : 'pending';
  return {
    bookingDetailId: num(m?.bookingDetailId),
    bookingId: numOrNull(m?.bookingId),
    room: str(m?.room).trim(),
    spaceCode: str(m?.spaceCode).trim(),
    location: str(m?.location).trim(),
    locationId: numOrNull(m?.locationId),
    customer: str(m?.customer).trim(),
    bookingStatus: str(m?.bookingStatus).trim(),
    startOn: dateOrNull(m?.startOn),
    endOn: dateOrNull(m?.endOn),
    state,
    accessEnabled: state === 'assigned' && bool(m?.accessEnabled),
    credentials: { face: bool(c?.face), fingerprint: bool(c?.fingerprint), card: bool(c?.card) },
    roomMachine: rm ? { name: str(rm.name).trim(), online: bool(rm.online) } : null,
    seats: seats && num(seats.total) > 0 ? { used: num(seats.used), total: num(seats.total) } : null,
    personId: numOrNull(m?.personId)
  };
}

function normaliseDevice(x: any): AoDeviceResult {
  return {
    deviceId: num(x?.deviceId),
    device: str(x?.device).trim() || 'Machine',
    ok: bool(x?.ok),
    queued: bool(x?.queued),
    error: str(x?.error).trim(),
    verified: x?.verified === true ? true : x?.verified === false ? false : null
  };
}

function normaliseEnroll(d: any): AoEnrollResult {
  return {
    ok: bool(d?.ok),
    type: str(d?.type),
    machineId: str(d?.machineId),
    error: str(d?.error).trim(),
    quality: str(d?.quality),
    summary: str(d?.summary).trim(),
    devices: arr(d?.devices, normaliseDevice)
  };
}

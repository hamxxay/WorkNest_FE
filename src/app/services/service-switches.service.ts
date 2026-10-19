import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { ApiResponse } from '../models/admin.model';

// ============================================================
// Background service switches (super admin only):
//   GET  api/admin/services          -> every background service with its switch
//   POST api/admin/services/{name}   -> { isEnabled } turns one on or off, returns the updated service
// The list, names and display names come from the API; nothing here is hard-coded per service.
// ============================================================

export interface ServiceSwitch {
  /** Stable identifier used in the URL (e.g. BillingAutomation). */
  name: string;
  displayName: string;
  description: string;
  /** The switch on this page. */
  isEnabled: boolean;
  /** The server's appsettings key for this service, if it has one. */
  configKey: string | null;
  /** The server's appsettings flag: false = off in server settings, whatever the switch says. */
  configEnabled: boolean;
  /** isEnabled && configEnabled. */
  running: boolean;
  updatedBy: string | null;
  /** ISO 8601, UTC. */
  updatedAt: string | null;
}

export interface ServiceSwitchChange {
  /** The service as saved (null if the API sent none: keep what the page already shows). */
  item: ServiceSwitch | null;
  /** The API's message, e.g. "Billing automation turned off." */
  message: string;
}

/** A failed call (or an answer with isSuccessful: false), with a message that is safe to show. */
export class ServiceSwitchError extends Error {
  constructor(message: string, readonly status: number | null = null) {
    super(message);
  }
}

@Injectable({ providedIn: 'root' })
export class ServiceSwitchesService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/admin/services`;

  list(): Observable<ServiceSwitch[]> {
    return this.http.get<ApiResponse<unknown>>(this.baseUrl).pipe(
      map(res => {
        if (!res || res.isSuccessful === false) {
          throw new ServiceSwitchError(res?.message || "The services couldn't be loaded. Please try again.");
        }
        const data = Array.isArray(res.data) ? res.data : [];
        return data.map(toServiceSwitch).filter((s): s is ServiceSwitch => s !== null);
      })
    );
  }

  setEnabled(name: string, isEnabled: boolean): Observable<ServiceSwitchChange> {
    if (!name) return throwError(() => new ServiceSwitchError('This service has no name.'));
    return this.http.post<ApiResponse<unknown>>(`${this.baseUrl}/${encodeURIComponent(name)}`, { isEnabled }).pipe(
      map(res => {
        if (!res || res.isSuccessful === false) {
          throw new ServiceSwitchError(res?.message || "The change wasn't saved. Please try again.");
        }
        return { item: toServiceSwitch(res.data), message: res.message ?? '' };
      })
    );
  }
}

/**
 * The message to show for a failed load or change. The error interceptor already put a readable message on
 * HTTP errors (the API's own text first, e.g. the 503 "Database update needed: ..."); a 403 always gets ours.
 */
export function serviceSwitchErrorMessage(err: unknown, action: 'load' | 'change'): string {
  const e = err as { status?: number; message?: string; error?: { message?: string } } | null;
  if (e?.status === 403) {
    return action === 'change' ? 'Only a super admin can change services.' : 'Only a super admin can see and change services.';
  }
  const text = e?.error?.message || e?.message;
  if (typeof text === 'string' && text.trim()) return text.trim();
  return action === 'change' ? "The change wasn't saved. Please try again." : "The services couldn't be loaded. Please try again.";
}

function toServiceSwitch(raw: unknown): ServiceSwitch | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const name = typeof r['name'] === 'string' ? r['name'].trim() : '';
  if (!name) return null;
  const isEnabled = r['isEnabled'] === true;
  // Missing flag = no server setting holding it off.
  const configEnabled = r['configEnabled'] !== false;
  const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return {
    name,
    displayName: text(r['displayName']) ?? name,
    description: text(r['description']) ?? '',
    isEnabled,
    configKey: text(r['configKey']),
    configEnabled,
    running: typeof r['running'] === 'boolean' ? r['running'] : isEnabled && configEnabled,
    updatedBy: text(r['updatedBy']),
    updatedAt: text(r['updatedAt']),
  };
}

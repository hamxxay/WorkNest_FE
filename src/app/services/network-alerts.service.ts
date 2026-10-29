import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../environments/environment';
import { ApiResponse } from '../models/admin.model';

// ============================================================
// Network outage e-mail alerts (super admin only), script NET_ALERT_01_network_alerts:
//   GET    api/admin/network-alerts/recipients[?locationId=]  -> every recipient, location by location
//   POST   api/admin/network-alerts/recipients { locationId, email }
//   PUT    api/admin/network-alerts/recipients/{id} { isActive }
//   DELETE api/admin/network-alerts/recipients/{id}
//   POST   api/admin/network-alerts/test { locationId }        -> test e-mail to the location's active recipients
//   GET    api/admin/network-alerts/log                        -> the last 50 alert e-mails, newest first
// ============================================================

export interface AlertRecipient {
  id: number;
  locationId: number;
  locationName: string;
  email: string;
  isActive: boolean;
  /** ISO 8601, UTC. */
  createdOn: string | null;
  createdBy: string | null;
}

export interface AlertLogRow {
  id: number;
  locationId: number;
  locationName: string;
  /** alert | reminder | recovery | test */
  kind: string;
  subject: string;
  summary: string;
  /** Comma separated addresses. */
  recipients: string;
  /** Sent | Held (Email Sending was off: waits in Pending emails) */
  status: string;
  error: string | null;
  /** ISO 8601, UTC. */
  sentAt: string | null;
}

@Injectable({ providedIn: 'root' })
export class NetworkAlertsService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/admin/network-alerts`;

  recipients(): Observable<AlertRecipient[]> {
    return this.http.get<ApiResponse<any[]>>(`${this.baseUrl}/recipients`).pipe(map(res => {
      this.check(res, "The recipients couldn't be loaded.");
      return (Array.isArray(res?.data) ? res.data : []).map((r): AlertRecipient => ({
        id: Number(r.id), locationId: Number(r.locationId), locationName: String(r.locationName ?? `Location ${r.locationId}`),
        email: String(r.email ?? ''), isActive: r.isActive !== false, createdOn: r.createdOn ?? null, createdBy: r.createdBy ?? null
      }));
    }));
  }

  log(): Observable<AlertLogRow[]> {
    return this.http.get<ApiResponse<any[]>>(`${this.baseUrl}/log`).pipe(map(res => {
      this.check(res, "The recent alerts couldn't be loaded.");
      return (Array.isArray(res?.data) ? res.data : []).map((r): AlertLogRow => ({
        id: Number(r.id), locationId: Number(r.locationId), locationName: String(r.locationName ?? `Location ${r.locationId}`),
        kind: String(r.kind ?? ''), subject: String(r.subject ?? ''), summary: String(r.summary ?? ''),
        recipients: String(r.recipients ?? ''), status: String(r.status ?? ''), error: r.error ?? null, sentAt: r.sentAt ?? null
      }));
    }));
  }

  add(locationId: number, email: string): Observable<string> {
    return this.http.post<ApiResponse<unknown>>(`${this.baseUrl}/recipients`, { locationId, email }).pipe(map(res => this.message(res)));
  }

  setActive(id: number, isActive: boolean): Observable<string> {
    return this.http.put<ApiResponse<unknown>>(`${this.baseUrl}/recipients/${id}`, { isActive }).pipe(map(res => this.message(res)));
  }

  remove(id: number): Observable<string> {
    return this.http.delete<ApiResponse<unknown>>(`${this.baseUrl}/recipients/${id}`).pipe(map(res => this.message(res)));
  }

  test(locationId: number): Observable<string> {
    return this.http.post<ApiResponse<unknown>>(`${this.baseUrl}/test`, { locationId }).pipe(map(res => this.message(res)));
  }

  private check(res: ApiResponse<unknown> | null, fallback: string): void {
    if (!res || res.isSuccessful === false) throw new Error(res?.message || fallback);
  }

  private message(res: ApiResponse<unknown>): string {
    this.check(res, 'That did not work. Please try again.');
    return res?.message ?? '';
  }
}

/** A readable message for a failed call (the API's own text first). */
export function networkAlertsErrorMessage(err: unknown, fallback: string): string {
  const e = err as { status?: number; message?: string; error?: { message?: string } } | null;
  if (e?.status === 403) return 'Only a super admin can manage network alerts.';
  const text = e?.error?.message || e?.message;
  return typeof text === 'string' && text.trim() ? text.trim() : fallback;
}

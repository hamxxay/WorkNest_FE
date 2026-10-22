import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../environments/environment';
import { ApiResponse } from '../models/admin.model';

// ============================================================
// Pending emails (super admin only): the e-mails asked for while the Email Sending switch was off.
//   GET  api/admin/email-outbox?status=      -> { counts, items, emailSendingOn }
//   POST api/admin/email-outbox/{id}/send    -> sends one now (only while Email Sending is on)
//   POST api/admin/email-outbox/{id}/discard -> stops one for good
//   POST api/admin/email-outbox/discard-all  -> stops every pending / failed one for good
// ============================================================

export type OutboxStatus = 'Pending' | 'Sending' | 'Sent' | 'Failed' | 'Discarded';

export interface OutboxItem {
  id: number;
  /** What it is, e.g. "Agreement e-mail". */
  kind: string;
  toEmail: string;
  subject: string;
  status: OutboxStatus;
  attempts: number;
  lastError: string | null;
  /** ISO 8601, UTC. */
  createdOn: string | null;
  sentOn: string | null;
  discardedOn: string | null;
  discardedBy: string | null;
}

export interface OutboxCounts { pending: number; sending: number; sent: number; failed: number; discarded: number; }

export interface OutboxList { counts: OutboxCounts; items: OutboxItem[]; emailSendingOn: boolean; }

@Injectable({ providedIn: 'root' })
export class EmailOutboxService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/admin/email-outbox`;

  list(status: OutboxStatus | null): Observable<OutboxList> {
    const url = status ? `${this.baseUrl}?status=${status}` : this.baseUrl;
    return this.http.get<ApiResponse<any>>(url).pipe(map(res => {
      if (!res || res.isSuccessful === false) throw new Error(res?.message || "The pending e-mails couldn't be loaded.");
      const d = res.data ?? {};
      const c = d.counts ?? {};
      const n = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0);
      return {
        counts: { pending: n(c.pending), sending: n(c.sending), sent: n(c.sent), failed: n(c.failed), discarded: n(c.discarded) },
        items: (Array.isArray(d.items) ? d.items : []).map((r: any): OutboxItem => ({
          id: n(r.id), kind: String(r.kind ?? ''), toEmail: String(r.toEmail ?? ''), subject: String(r.subject ?? ''),
          status: r.status as OutboxStatus, attempts: n(r.attempts), lastError: r.lastError ?? null,
          createdOn: r.createdOn ?? null, sentOn: r.sentOn ?? null, discardedOn: r.discardedOn ?? null, discardedBy: r.discardedBy ?? null
        })),
        emailSendingOn: d.emailSendingOn !== false
      };
    }));
  }

  send(id: number): Observable<string> { return this.post(`${this.baseUrl}/${id}/send`); }
  discard(id: number): Observable<string> { return this.post(`${this.baseUrl}/${id}/discard`); }
  discardAll(): Observable<string> { return this.post(`${this.baseUrl}/discard-all`); }

  private post(url: string): Observable<string> {
    return this.http.post<ApiResponse<unknown>>(url, {}).pipe(map(res => {
      if (!res || res.isSuccessful === false) throw new Error(res?.message || 'That did not work. Please try again.');
      return res.message ?? '';
    }));
  }
}

/** A readable message for a failed call (the API's own text first). */
export function outboxErrorMessage(err: unknown, fallback: string): string {
  const e = err as { status?: number; message?: string; error?: { message?: string } } | null;
  if (e?.status === 403) return 'Only a super admin can manage pending e-mails.';
  const text = e?.error?.message || e?.message;
  return typeof text === 'string' && text.trim() ? text.trim() : fallback;
}

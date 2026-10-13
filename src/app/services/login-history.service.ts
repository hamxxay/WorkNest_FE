import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface LoginHistoryItem {
  loginId: number;
  userId?: number;
  email?: string;
  eventType: string; // LOGIN, FAILED, LOGOUT
  failureReason?: string;
  ipAddress?: string;
  userAgent?: string;
  deviceSummary: string;
  eventAt: string;
  eventAtUtc: string;
}

export interface LoginHistoryStats {
  loginsToday: number;
  failedToday: number;
  distinctUsersToday: number;
}

export interface LoginHistoryPagedResult {
  items: LoginHistoryItem[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  stats: LoginHistoryStats;
}

export interface LoginHistoryFilter {
  page?: number;
  pageSize?: number;
  fromDate?: string;
  toDate?: string;
  email?: string;
  eventType?: string;
  ipAddress?: string;
  latestOnly?: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class LoginHistoryService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/login-history`;

  getPagedLoginHistory(filter: LoginHistoryFilter): Observable<{ isSuccessful: boolean; data: LoginHistoryPagedResult }> {
    let params = new HttpParams();
    if (filter.page) params = params.set('page', filter.page.toString());
    if (filter.pageSize) params = params.set('pageSize', filter.pageSize.toString());
    if (filter.fromDate) params = params.set('fromDate', filter.fromDate);
    if (filter.toDate) params = params.set('toDate', filter.toDate);
    if (filter.email) params = params.set('email', filter.email.trim());
    if (filter.eventType) params = params.set('eventType', filter.eventType.trim());
    if (filter.ipAddress) params = params.set('ipAddress', filter.ipAddress.trim());
    if (filter.latestOnly) params = params.set('latestOnly', 'true');

    return this.http.get<{ isSuccessful: boolean; data: LoginHistoryPagedResult }>(this.baseUrl, { params });
  }

  getStats(): Observable<{ isSuccessful: boolean; data: LoginHistoryStats }> {
    return this.http.get<{ isSuccessful: boolean; data: LoginHistoryStats }>(`${this.baseUrl}/stats`);
  }
}

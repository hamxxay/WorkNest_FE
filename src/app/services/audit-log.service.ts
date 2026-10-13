import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface AuditLogItem {
  auditId: number;
  entityName?: string;
  recordId?: string;
  operation: string;
  operationLabel: string;
  changedByUserId?: number;
  changedByUserEmail?: string;
  changedAt: string;
  changedAtUtc: string;
  sourceApp?: string;
  hasError: boolean;
  errorSeverity?: string;
}

export interface AuditLogDetail extends AuditLogItem {
  oldValues?: string;
  newValues?: string;
  errorMessage?: string;
  stackTrace?: string;
}

export interface AuditLogPagedResult {
  items: AuditLogItem[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface AuditLogFilterOptions {
  entityNames: string[];
  sourceApps: string[];
  operations: string[];
}

export interface AuditLogFilter {
  page?: number;
  pageSize?: number;
  fromDate?: string;
  toDate?: string;
  operation?: string;
  entityName?: string;
  changedByUserEmail?: string;
  recordId?: string;
  sourceApp?: string;
  errorsOnly?: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class AuditLogService {
  private http = inject(HttpClient);
  private baseUrl = `${environment.apiUrl}/audit-log`;

  getAuditLogs(filter: AuditLogFilter): Observable<{ isSuccessful: boolean; data: AuditLogPagedResult }> {
    let params = new HttpParams();
    if (filter.page) params = params.set('page', filter.page.toString());
    if (filter.pageSize) params = params.set('pageSize', filter.pageSize.toString());
    if (filter.fromDate) params = params.set('fromDate', filter.fromDate);
    if (filter.toDate) params = params.set('toDate', filter.toDate);
    if (filter.operation) params = params.set('operation', filter.operation);
    if (filter.entityName) params = params.set('entityName', filter.entityName);
    if (filter.changedByUserEmail) params = params.set('changedByUserEmail', filter.changedByUserEmail.trim());
    if (filter.recordId) params = params.set('recordId', filter.recordId.trim());
    if (filter.sourceApp) params = params.set('sourceApp', filter.sourceApp);
    if (filter.errorsOnly) params = params.set('errorsOnly', 'true');

    return this.http.get<{ isSuccessful: boolean; data: AuditLogPagedResult }>(this.baseUrl, { params });
  }

  getAuditLogDetail(auditId: number): Observable<{ isSuccessful: boolean; data: AuditLogDetail }> {
    return this.http.get<{ isSuccessful: boolean; data: AuditLogDetail }>(`${this.baseUrl}/${auditId}`);
  }

  getFilterOptions(): Observable<{ isSuccessful: boolean; data: AuditLogFilterOptions }> {
    return this.http.get<{ isSuccessful: boolean; data: AuditLogFilterOptions }>(`${this.baseUrl}/filter-options`);
  }
}
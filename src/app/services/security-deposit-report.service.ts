import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface SecurityDepositSummary {
  customerId: number;
  customerCode: string;
  customerName: string;
  company?: string;
  depositCount: number;
  totalReceived: number;
  totalReleased: number;
  totalForfeited: number;
  balanceHeld: number;
  lastHeldOn?: string;
}

export interface SecurityDepositDetail {
  id: number;
  bookingId: number;
  refNo?: string;
  amount: number;
  state: 'Held' | 'Released' | 'Forfeited' | string;
  heldOn: string;
  releasedOn?: string;
  forfeitedOn?: string;
  forfeitReason?: string;
  notes?: string;
}

export interface CustomerLookup {
  id: number;
  code: string;
  displayText: string;
}

@Injectable({
  providedIn: 'root'
})
export class SecurityDepositReportService {
  private http = inject(HttpClient);
  private baseUrl = `${environment.apiUrl}/reports/security-deposits`;

  getSummary(filter: { customerId?: number; fromDate?: string; toDate?: string }): Observable<any> {
    let params = new HttpParams();
    if (filter.customerId) params = params.set('customerId', filter.customerId.toString());
    if (filter.fromDate) params = params.set('fromDate', filter.fromDate);
    if (filter.toDate) params = params.set('toDate', filter.toDate);

    return this.http.get<any>(`${this.baseUrl}/summary`, { params });
  }

  getDetail(customerId: number, fromDate?: string, toDate?: string): Observable<any> {
    let params = new HttpParams();
    if (fromDate) params = params.set('fromDate', fromDate);
    if (toDate) params = params.set('toDate', toDate);

    return this.http.get<any>(`${this.baseUrl}/detail/${customerId}`, { params });
  }

  getCustomerLookup(): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/customer-lookup`);
  }

  exportExcel(filter: { customerId?: number; fromDate?: string; toDate?: string }): Observable<Blob> {
    let params = new HttpParams();
    if (filter.customerId) params = params.set('customerId', filter.customerId.toString());
    if (filter.fromDate) params = params.set('fromDate', filter.fromDate);
    if (filter.toDate) params = params.set('toDate', filter.toDate);

    return this.http.get(`${this.baseUrl}/export`, {
      params,
      responseType: 'blob'
    });
  }

  exportCustomerDetailExcel(customerId: number, fromDate?: string, toDate?: string): Observable<Blob> {
    let params = new HttpParams();
    if (fromDate) params = params.set('fromDate', fromDate);
    if (toDate) params = params.set('toDate', toDate);

    return this.http.get(`${this.baseUrl}/detail/${customerId}/export`, {
      params,
      responseType: 'blob'
    });
  }
}
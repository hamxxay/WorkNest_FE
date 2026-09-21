import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface SendAgreementRequest {
  quotationId?: number;
  entityType: 'Individual' | 'Company' | 'AOP';
  fullName?: string;
  cnic?: string;
  phoneNumber?: string;
  address?: string;
  companyName?: string;
  ntn?: string;
  secpRegistrationNo?: string;
  refundDays?: number;
  feeAmount?: number;
  monthlyFee?: number;
  securityDeposit?: number;
  contractStartDate?: string | null;
  contractEndDate?: string | null;
  operatingHours?: string;
  billingFrequency?: string;
  overrideEmail?: string;
  customerFullName?: string;
  customerCnic?: string;
  customerPhone?: string;
  customerAddress?: string;
  companyNtn?: string;
  companySecpRegNo?: string;
}

export interface MarkAgreementSignedRequest {
  signedBy?: string;
  note?: string;
}

@Injectable({
  providedIn: 'root'
})
export class AgreementService {
  private apiUrl = `${environment.apiUrl}/agreement`;
  private leaseApiUrl = `${environment.apiUrl}/leases`;

  constructor(private http: HttpClient) {}

  sendAgreement(req: SendAgreementRequest): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/send`, req);
  }

  generateLease(req: any): Observable<Blob> {
    return this.http.post(`${this.leaseApiUrl}/generate`, req, { responseType: 'blob' });
  }

  getAgreements(page: number = 1, limit: number = 50, search?: string, status?: string): Observable<any> {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', String(limit));
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    return this.http.get<any>(`${this.apiUrl}?${params.toString()}`);
  }

  getAgreementPdf(agreementId: number): Observable<Blob> {
    return this.http.get(`${this.apiUrl}/${agreementId}/pdf`, { responseType: 'blob' });
  }

  markAgreementSigned(agreementId: number, req?: MarkAgreementSignedRequest): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/${agreementId}/mark-signed`, req || {});
  }
}

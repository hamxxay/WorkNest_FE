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

/** Customer e-signature (POST agreement/my/{id}/esign). */
export interface ESignAgreementRequest {
  signerName: string;
  /** "data:image/png;base64,..." of the drawn or typed signature. */
  signatureImage: string;
  consent: boolean;
}

/** Staff view of how an agreement was e-signed (GET agreement/{id}/esignature). */
export interface AgreementESignature {
  agreementId: number;
  signerName?: string;
  signerEmail?: string;
  signedAt: string;
  ipAddress?: string;
  userAgent?: string;
  documentSha256?: string;
  signatureImage?: string;
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

  // ---- Customer portal (own agreements only) ----
  getMyAgreements(): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/my`);
  }
  getMyAgreementPdf(agreementId: number): Observable<Blob> {
    return this.http.get(`${this.apiUrl}/my/${agreementId}/pdf`, { responseType: 'blob' });
  }
  getMySignedPdf(agreementId: number): Observable<Blob> {
    return this.http.get(`${this.apiUrl}/my/${agreementId}/signed-pdf`, { responseType: 'blob' });
  }
  /** Customer uploads the signed copy + the date they signed; held for admin verification. */
  uploadMySignedAgreement(agreementId: number, file: File, signedDate: string): Observable<any> {
    const formData = new FormData();
    formData.append('file', file, file.name);
    formData.append('signedDate', signedDate);
    return this.http.post<any>(`${this.apiUrl}/my/${agreementId}/upload-signed`, formData);
  }

  /** Customer signs electronically; creates the booking (or leaves it for staff to confirm). */
  eSignMyAgreement(agreementId: number, req: ESignAgreementRequest): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/my/${agreementId}/esign`, req);
  }

  /** Staff: e-signature evidence of an agreement (data is null when it was not e-signed). */
  getESignature(agreementId: number): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/${agreementId}/esignature`);
  }

  /** Signed agreement came back: upload the scan + the date on it; creates the booking dated on that date. */
  signAgreement(agreementId: number, file: File | null, signedDate: string, note?: string): Observable<any> {
    const formData = new FormData();
    if (file) formData.append('file', file, file.name); // optional when the customer already uploaded it
    formData.append('signedDate', signedDate);
    if (note) formData.append('note', note);
    return this.http.post<any>(`${this.apiUrl}/${agreementId}/sign`, formData);
  }

  uploadSignedAgreement(agreementId: number, file: File): Observable<any> {
    const formData = new FormData();
    formData.append('file', file, file.name);
    return this.http.post<any>(`${this.apiUrl}/${agreementId}/upload-signed`, formData);
  }

  getSignedAgreementPdf(agreementId: number): Observable<Blob> {
    return this.http.get(`${this.apiUrl}/${agreementId}/signed-pdf`, { responseType: 'blob' });
  }

  getSignedPdfDownloadUrl(agreementId: number): string {
    return `${this.apiUrl}/${agreementId}/signed-pdf`;
  }

  deleteAgreement(agreementId: number): Observable<any> {
    return this.http.delete<any>(`${this.apiUrl}/${agreementId}`);
  }

  deleteSignedPdf(agreementId: number): Observable<any> {
    return this.http.delete<any>(`${this.apiUrl}/${agreementId}/signed-pdf`);
  }
}

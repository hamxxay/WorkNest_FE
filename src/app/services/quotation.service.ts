import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class QuotationService {
  private apiUrl = `${environment.apiUrl}/quotation`;

  constructor(private http: HttpClient) {}

  /**
   * Create a new quotation version
   */
  createQuotation(quotation: any): Observable<any> {
    return this.http.post<any>(this.apiUrl, quotation);
  }

  /**
   * Retrieve a quotation by its ID
   */
  getQuotationById(id: number): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/${id}`);
  }

  /**
   * Get paginated list of quotations (admin only)
   */
  getQuotations(page: number, limit: number, search?: string): Observable<any> {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', String(limit));
    if (search) params.set('search', search);
    return this.http.get<any>(`${this.apiUrl}?${params.toString()}`);
  }

  /**
   * Get version history of quotations for a customer and space
   */
  getQuotationHistory(customerId: number, spaceId: number): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/history?customerId=${customerId}&spaceId=${spaceId}`);
  }

  /**
   * Email a quotation PDF to the customer
   */
  sendQuotationEmail(id: number, email: string, pdfBase64: string, quotationNumber?: string): Observable<any> {
    const quotationLink = quotationNumber
      ? `https://work-nest-3936a.web.app/quotation/${quotationNumber}`
      : undefined;
    return this.http.post<any>(`${this.apiUrl}/${id}/send-email`, { email, pdfBase64, quotationLink });
  }

  /**
   * Convert an approved quotation to a confirmed booking (with optional versionId)
   */
  convertToBooking(id: number, versionId?: number): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/${id}/convert`, { versionId });
  }

  /**
   * Get version history list for a quotation
   */
  getQuotationVersions(quotationId: number): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/${quotationId}/versions`);
  }

  /**
   * Get specific version snapshot of a quotation
   */
  getQuotationVersionById(quotationId: number, versionId: number): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/${quotationId}/versions/${versionId}`);
  }

  /**
   * Create a new quotation version from an existing quotation version
   */
  createQuotationVersion(quotationId: number, versionData: any): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/${quotationId}/versions`, versionData);
  }

  /**
   * Update an existing draft version
   */
  updateQuotationVersion(quotationId: number, versionId: number, versionData: any): Observable<any> {
    return this.http.put<any>(`${this.apiUrl}/${quotationId}/versions/${versionId}`, versionData);
  }

  /**
   * Transition quotation version status to Sent
   */
  sendQuotationVersion(quotationId: number, versionId: number): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/${quotationId}/versions/${versionId}/send`, {});
  }

  /**
   * Customer Accept Endpoint (Optional note)
   */
  acceptQuotation(quotationId: number, versionId: number, note?: string): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/${quotationId}/versions/${versionId}/accept`, { note: note || '' });
  }

  /**
   * Customer Decline Endpoint (Mandatory note)
   */
  declineQuotation(quotationId: number, versionId: number, note: string): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/${quotationId}/versions/${versionId}/decline`, { note });
  }

  /**
   * Get active quotation for current logged in customer
   */
  getCustomerActiveQuotation(quotationId?: number): Observable<any> {
    if (quotationId) {
      return this.http.get<any>(`${this.apiUrl}/${quotationId}/active`);
    }
    return this.http.get<any>(`${this.apiUrl}/my-active`);
  }

  /**
   * Get quotation response activities for admin dashboard feed
   */
  getQuotationActivities(limit: number = 20): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/activities?limit=${limit}`);
  }
}


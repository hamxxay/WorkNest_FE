import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface LeaseTemplateDto {
  id: number;
  name: string;
  contentHtml: string;
  isActive: boolean;
  createdAt: string;
  createdBy?: number | null;
  createdByName?: string | null;
}

export interface PublishLeaseTemplateRequest {
  name: string;
  contentHtml: string;
}

@Injectable({
  providedIn: 'root'
})
export class LeaseTemplateService {
  private apiUrl = `${environment.apiUrl}/lease-templates`;

  constructor(private http: HttpClient) {}

  getActiveTemplate(name: string = 'StandardLeaseAgreement'): Observable<{ isSuccessful: boolean; data: LeaseTemplateDto }> {
    return this.http.get<{ isSuccessful: boolean; data: LeaseTemplateDto }>(`${this.apiUrl}/active?name=${encodeURIComponent(name)}`);
  }

  publishTemplate(name: string, contentHtml: string): Observable<{ isSuccessful: boolean; data: LeaseTemplateDto; message: string }> {
    const payload: PublishLeaseTemplateRequest = { name, contentHtml };
    return this.http.post<{ isSuccessful: boolean; data: LeaseTemplateDto; message: string }>(this.apiUrl, payload);
  }
}

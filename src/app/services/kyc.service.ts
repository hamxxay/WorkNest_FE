import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface KycCustomerListItem {
  id: number;
  idGUID: string;
  code: string;
  fullName: string;
  company?: string;
  email: string;
  phoneNumber?: string;
  category: string;
  totalActiveDocs: number;
  verifiedDocsCount: number;
  pendingDocsCount: number;
  rejectedDocsCount: number;
  completenessPercentage: number;
  completenessStatus: string;
  overallStatus: string;
  overallBadgeClass: string;
  createdAt: string;
}

export interface KycDocumentTypeOption {
  id: number;
  code: string;
  name: string;
  displayLabel: string;
  groupCode?: string;
  alternativeCode?: string;
  allowMultiple: boolean;
  requiresHolderName: boolean;
  requiresExpiry: boolean;
  isRequired: boolean;
  isUploaded: boolean;
  existingDocumentId?: number;
  sortOrder: number;
}

export interface KycPersonSlot {
  slotNo: number;
  displayName: string;
  holderName?: string;
}

export interface KycChecklistItem {
  documentTypeId: number;
  code: string;
  name: string;
  requirementLevel: number;
  isUploaded: boolean;
  status?: number;
  statusLabel?: string;
  statusBadgeClass?: string;
  documentId?: number;
  slotNo: number;
  holderName?: string;
  expiryDate?: string;
}

export interface KycChecklistGroup {
  groupCode?: string;
  title: string;
  isRequired: boolean;
  isSatisfied: boolean;
  statusSummary: string;
  items: KycChecklistItem[];
}

export interface CustomerKycDocument {
  id: number;
  customerId: number;
  folderName: string;
  documentTypeId: number;
  documentTypeCode?: string;
  documentTypeName?: string;
  groupCode?: string;
  alternativeCode?: string;
  allowMultiple: boolean;
  requiresHolderName: boolean;
  requiresExpiry: boolean;
  slotNo: number;
  holderName?: string;
  storedPath: string;
  originalFileName: string;
  fileHash: string;
  expiryDate?: string;
  versionNo: number;
  isActive: boolean;
  status: number;
  remarks?: string;
  verifiedBy?: number;
  verifiedByName?: string;
  verifiedOn?: string;
  uploadedBy: number;
  uploadedByName?: string;
  uploadedOn: string;
  replacedBy?: number;
  replacedOn?: string;
}

export interface CustomerKycPortalData {
  customerId: number;
  customerGuid: string;
  customerCode: string;
  fullName: string;
  company?: string;
  email: string;
  phoneNumber?: string;
  cnicOrPassport?: string;
  address?: string;
  cityName?: string;
  category: string;
  isCategoryUnrecognized: boolean;
  warningMessage?: string;
  folderName: string;
  canVerifyAndReject: boolean;
  completenessPercentage: number;
  overallStatus: string;
  overallBadgeClass: string;
  availableDocumentTypes: KycDocumentTypeOption[];
  existingPersonSlots: KycPersonSlot[];
  checklistGroups: KycChecklistGroup[];
  uploadedDocuments: CustomerKycDocument[];
}

@Injectable({
  providedIn: 'root'
})
export class KycService {
  private apiUrl = `${environment.apiUrl}/kyc`;

  constructor(private http: HttpClient) {}

  getCustomers(page: number = 1, limit: number = 20, search: string = ''): Observable<{ items: KycCustomerListItem[]; total: number; page: number; limit: number }> {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', String(limit));
    if (search) params.set('search', search);
    return this.http.get<{ items: KycCustomerListItem[]; total: number; page: number; limit: number }>(`${this.apiUrl}?${params.toString()}`);
  }

  getCustomerKyc(id: string | number): Observable<CustomerKycPortalData> {
    return this.http.get<CustomerKycPortalData>(`${this.apiUrl}/${id}`);
  }

  uploadDocument(formData: FormData): Observable<{ success: boolean; message: string; documentId?: number }> {
    return this.http.post<{ success: boolean; message: string; documentId?: number }>(`${this.apiUrl}/upload`, formData);
  }

  verifyDocument(documentId: number): Observable<{ success: boolean; message: string }> {
    return this.http.post<{ success: boolean; message: string }>(`${this.apiUrl}/verify`, {
      documentId,
      status: 1
    });
  }

  rejectDocument(documentId: number, remarks: string): Observable<{ success: boolean; message: string }> {
    return this.http.post<{ success: boolean; message: string }>(`${this.apiUrl}/reject`, {
      documentId,
      status: 2,
      remarks
    });
  }

  getDocumentHistory(customerId: number, documentTypeId: number, slotNo: number = 1): Observable<CustomerKycDocument[]> {
    return this.http.get<CustomerKycDocument[]>(`${this.apiUrl}/history/${customerId}/${documentTypeId}/${slotNo}`);
  }

  /** Document file, fetched with the login token (a plain link can't send it, and the endpoint needs a login). */
  getDocumentBlob(documentId: number, inline: boolean = false): Observable<Blob> {
    return this.http.get(`${this.apiUrl}/document/${documentId}/${inline ? 'view?inline=true' : 'download'}`, { responseType: 'blob' });
  }
}

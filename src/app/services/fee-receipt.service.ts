import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../environments/environment';

/** Matches the API rule (fee receipt SPs): an invoice is a WHT invoice when its type is 6 or it carries WHT. */
const isWhtInvoice = (invoiceTypeId: number, whtAmount: number) => invoiceTypeId === 6 || whtAmount > 0;
const invoiceTypeLabel = (invoiceTypeId: number, whtAmount: number) =>
  isWhtInvoice(invoiceTypeId, whtAmount) ? 'WHT Invoice' : 'Standard Invoice';

export interface UnpaidInvoiceDto {
  invoiceId: number;
  invoiceIdGuid: string;
  invoiceNumber: string;
  invoiceTypeId: number;
  invoiceTypeName: string;
  customerIdGuid: string;
  customerName: string;
  customerCode: string;
  customerEmail: string;
  customerPhone: string;
  bookingId: number | null;
  locationId: number | null;
  locationName: string;
  companyId: number;
  branchId: number;
  issuedOn: string;
  dueOn: string;
  roomRentExclTax: number;
  serviceCharges: number;
  taxOnServiceCharges: number;
  whtAmount: number;
  securityDepositAmount: number;
  grandTotal: number;
  netReceivableAmount: number;
  dropdownDisplay: string;
}

export interface FeeReceiptAccountDto {
  accountId: number;
  description: string;
  shortDesc: string;
  accountNature: string;
  companyId: number;
  isCashInHand: boolean;
}

/** Body of POST /fee-receipts (FeeReceiptCreateDto). */
export interface CreateFeeReceiptDto {
  invoiceIdGUID: string;
  cashInHandAccountId: number;
  receiptDate: string; // YYYY-MM-DD
  paymentType: string;
  remarks?: string | null;
  depositorName: string;
  depositorCnic: string; // 12345-1234567-1
}

/** Body of POST /fee-receipts/void (FeeReceiptVoidDto). */
export interface VoidFeeReceiptDto {
  id: number;
  voidReason: string;
}

export interface FeeReceiptListItemDto {
  id: number;
  idGuid: string;
  code: string;
  receiptDate: string;
  customerIdGuid: string;
  customerName: string;
  customerCode: string;
  invoiceIdGuid: string;
  invoiceNumber: string;
  locationId: number | null;
  locationName: string;
  totalAmount: number;
  paymentType: string;
  cashInHandAccountId: number;
  accountTitle: string;
  status: number;
  statusLabel: string;
  remarks: string;
  voidReason: string;
  createdOn: string;
  createdByName: string;
}

export interface FeeReceiptDetailDto extends FeeReceiptListItemDto {
  invoiceTypeId: number;
  invoiceTypeName: string;
  roomRentExclTax: number;
  serviceCharges: number;
  taxOnServiceCharges: number;
  whtAmount: number;
  securityDepositAmount: number;
  grandTotal: number;
  companyId: number;
  branchId: number;
  invoiceIssuedOn: string | null;
  invoiceDueOn: string | null;
  customerEmail: string;
  customerPhone: string;
  locationCity: string;
  updatedOn: string | null;
  updatedByName: string;
  /** Empty on receipts saved before the depositor fields were added. */
  depositorName: string;
  depositorCnic: string;
}

export interface FeeReceiptListResponse {
  total: number;
  page: number;
  limit: number;
  items: FeeReceiptListItemDto[];
}

export interface ApiResponse<T> {
  isSuccessful: boolean;
  message: string;
  data: T;
  errors?: string[];
}

/** Maps a FeeReceiptDto (camelCase JSON) from list / get-by-id / create into the view model. */
function mapReceipt(r: any): FeeReceiptDetailDto {
  r = r ?? {};
  const roomRentExclTax = Number(r.roomRentExclTax ?? 0);
  const serviceCharges = Number(r.serviceCharges ?? 0);
  const taxOnServiceCharges = Number(r.taxOnServiceCharges ?? 0);
  const securityDepositAmount = Number(r.securityDepositAmount ?? 0);
  const whtAmount = Number(r.whtAmount ?? 0);
  const invoiceTypeId = Number(r.invoiceTypeId ?? 0);
  return {
    id: r.id ?? 0,
    idGuid: r.idGUID ?? '',
    code: r.code ?? '',
    receiptDate: r.receiptDate ?? '',
    customerIdGuid: r.customerIdGUID ?? '',
    customerName: r.customerName ?? '',
    customerCode: r.customerCode ?? '',
    invoiceIdGuid: r.invoiceIdGUID ?? '',
    invoiceNumber: r.invoiceNumber ?? '',
    locationId: r.locationId ?? null,
    locationName: r.locationName ?? '',
    totalAmount: Number(r.totalAmount ?? 0),
    paymentType: r.paymentType ?? 'Cash',
    cashInHandAccountId: r.cashInHandAccountId ?? 0,
    accountTitle: r.cashInHandAccountName ?? '',
    status: Number(r.status ?? 1),
    statusLabel: r.statusLabel ?? 'Active',
    remarks: r.remarks ?? '',
    voidReason: r.voidReason ?? '',
    createdOn: r.createdOn ?? '',
    createdByName: r.createdByName ?? '',
    invoiceTypeId,
    invoiceTypeName: invoiceTypeLabel(invoiceTypeId, whtAmount),
    roomRentExclTax,
    serviceCharges,
    taxOnServiceCharges,
    whtAmount,
    securityDepositAmount,
    // Fallback (invoice row missing): rebuild the gross total from its parts.
    grandTotal: Number(r.invoiceGrandTotal ?? (roomRentExclTax + serviceCharges + taxOnServiceCharges + securityDepositAmount)),
    companyId: Number(r.companyId ?? 0),
    branchId: Number(r.branchId ?? 0),
    invoiceIssuedOn: r.invoiceIssuedOn ?? null,
    invoiceDueOn: r.invoiceDueOn ?? null,
    customerEmail: r.customerEmail ?? '',
    customerPhone: r.customerPhone ?? '',
    locationCity: r.locationCity ?? '',
    updatedOn: r.updatedOn ?? null,
    updatedByName: r.updatedByName ?? '',
    depositorName: r.depositorName ?? '',
    depositorCnic: r.depositorCnic ?? ''
  };
}

@Injectable({
  providedIn: 'root'
})
export class FeeReceiptService {
  private http = inject(HttpClient);
  private baseUrl = `${environment.apiUrl}/fee-receipts`;

  /** locationId is optional: the API already limits location-bound users to their own locations. */
  getUnpaidInvoices(search?: string, locationId?: number | null, top: number = 30): Observable<UnpaidInvoiceDto[]> {
    let params = new HttpParams().set('top', top.toString());
    if (search && search.trim()) {
      params = params.set('search', search.trim());
    }
    if (locationId) {
      params = params.set('locationId', locationId.toString());
    }
    return this.http.get<ApiResponse<any>>(`${this.baseUrl}/unpaid-invoices`, { params }).pipe(
      map(res => {
        const list = Array.isArray(res?.data) ? res.data : [];
        return list.map((r: any): UnpaidInvoiceDto => {
          const custName = r.customerName ?? '';
          const custCode = r.customerCode ?? '';
          const invNum = r.invoiceNumber ?? '';
          const invoiceTypeId = Number(r.invoiceTypeId ?? 0);
          const whtAmount = Number(r.whtAmount ?? 0);
          return {
            invoiceId: r.invoiceId ?? 0,
            invoiceIdGuid: r.invoiceIdGUID ?? '',
            invoiceNumber: invNum,
            invoiceTypeId,
            invoiceTypeName: invoiceTypeLabel(invoiceTypeId, whtAmount),
            customerIdGuid: r.customerIdGUID ?? '',
            customerName: custName,
            customerCode: custCode,
            customerEmail: r.customerEmail ?? '',
            customerPhone: r.customerPhone ?? '',
            bookingId: r.bookingId ?? null,
            locationId: r.locationId ?? null,
            locationName: r.locationName ?? '',
            companyId: Number(r.companyId ?? 0),
            branchId: Number(r.branchId ?? 0),
            issuedOn: r.issuedOn ?? '',
            dueOn: r.dueOn ?? '',
            roomRentExclTax: Number(r.roomRentExclTax ?? 0),
            serviceCharges: Number(r.serviceCharges ?? 0),
            taxOnServiceCharges: Number(r.taxOnServiceCharges ?? 0),
            whtAmount,
            securityDepositAmount: Number(r.securityDepositAmount ?? 0),
            grandTotal: Number(r.grandTotal ?? 0),
            netReceivableAmount: Number(r.netReceivableAmount ?? 0),
            dropdownDisplay: r.displayName || `${custName}-${custCode}-${invNum}`
          };
        });
      })
    );
  }

  getAccounts(companyId?: number): Observable<FeeReceiptAccountDto[]> {
    let params = new HttpParams();
    if (companyId) {
      params = params.set('companyId', companyId.toString());
    }
    return this.http.get<ApiResponse<any>>(`${this.baseUrl}/accounts`, { params }).pipe(
      map(res => {
        const list = Array.isArray(res?.data) ? res.data : [];
        return list.map((r: any): FeeReceiptAccountDto => ({
          accountId: r.accountId ?? 0,
          description: r.description ?? '',
          shortDesc: r.shortDesc ?? '',
          accountNature: r.accountNature ?? '',
          companyId: Number(r.companyId ?? 0),
          isCashInHand: !!r.isCashInHand
        }));
      })
    );
  }

  /** Creates the receipt and returns it mapped like getReceiptById (ready for the print view). */
  createReceipt(body: CreateFeeReceiptDto): Observable<FeeReceiptDetailDto> {
    return this.http.post<ApiResponse<any>>(this.baseUrl, body).pipe(map(res => mapReceipt(res?.data)));
  }

  voidReceipt(body: VoidFeeReceiptDto): Observable<ApiResponse<any>> {
    return this.http.post<ApiResponse<any>>(`${this.baseUrl}/void`, body);
  }

  getReceipts(params: { page: number; limit: number; search?: string; locationId?: number | null; status?: number | null }): Observable<FeeReceiptListResponse> {
    let httpParams = new HttpParams()
      .set('page', params.page.toString())
      .set('limit', params.limit.toString());
    if (params.search && params.search.trim()) {
      httpParams = httpParams.set('search', params.search.trim());
    }
    if (params.locationId) {
      httpParams = httpParams.set('locationId', params.locationId.toString());
    }
    if (params.status !== undefined && params.status !== null) {
      httpParams = httpParams.set('status', params.status.toString());
    }
    return this.http.get<ApiResponse<any>>(this.baseUrl, { params: httpParams }).pipe(
      map(res => {
        const payload = res?.data;
        const items: any[] = Array.isArray(payload?.data) ? payload.data : [];
        return {
          total: Number(payload?.totalCount ?? items.length),
          page: payload?.page ?? params.page,
          limit: payload?.limit ?? params.limit,
          items: items.map(mapReceipt)
        };
      })
    );
  }

  getReceiptById(id: number): Observable<FeeReceiptDetailDto> {
    return this.http.get<ApiResponse<any>>(`${this.baseUrl}/${id}`).pipe(map(res => mapReceipt(res?.data)));
  }
}

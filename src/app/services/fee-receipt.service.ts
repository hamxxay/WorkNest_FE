import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export interface UnpaidInvoiceDto {
  invoiceId: number;
  invoiceIdGuid: string;
  invoiceIdGUID?: string;
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
  dueDate: string;
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
  title: string;
  description: string;
  code: string;
  shortDesc: string;
  accountNature: string;
  companyId: number;
  isCashInHand: boolean;
}

export interface CreateFeeReceiptDto {
  invoiceIdGUID?: string;
  invoiceIdGuid?: string;
  cashInHandAccountId?: number;
  accountId?: number;
  receiptDate: string; // YYYY-MM-DD
  paymentType: string;
  remarks?: string | null;
}

export interface VoidFeeReceiptDto {
  id?: number;
  receiptId?: number;
  receiptGUID?: string;
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
  companyName: string;
  branchId: number;
  branchName: string;
  invoiceIssuedOn: string | null;
  invoiceDueDate: string | null;
  customerEmail: string;
  customerPhone: string;
  spaceName: string;
  spaceTypeName: string;
  updatedOn: string | null;
  updatedByName: string;
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

@Injectable({
  providedIn: 'root'
})
export class FeeReceiptService {
  private http = inject(HttpClient);
  private baseUrl = `${environment.apiUrl}/fee-receipts`;

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
        return list.map((r: any) => {
          const guid = r.invoiceIdGUID ?? r.invoiceIdGuid ?? r.InvoiceIdGUID ?? r.InvoiceIdGuid ?? '';
          const custName = r.customerName ?? r.CustomerName ?? '';
          const custCode = r.customerCode ?? r.CustomerCode ?? '';
          const invNum = r.invoiceNumber ?? r.InvoiceNumber ?? '';
          const display = r.displayName ?? r.DisplayName ?? `${custName}-${custCode}-${invNum}`;

          return {
            invoiceId: r.invoiceId ?? r.InvoiceId ?? 0,
            invoiceIdGuid: guid,
            invoiceIdGUID: guid,
            invoiceNumber: invNum,
            invoiceTypeId: Number(r.invoiceTypeId ?? r.InvoiceTypeId ?? 1),
            invoiceTypeName: r.invoiceTypeName ?? r.InvoiceTypeName ?? 'Standard Invoice',
            customerIdGuid: r.customerIdGUID ?? r.customerIdGuid ?? r.CustomerIdGUID ?? '',
            customerName: custName,
            customerCode: custCode,
            customerEmail: r.customerEmail ?? r.CustomerEmail ?? '',
            customerPhone: r.customerPhone ?? r.CustomerPhone ?? '',
            bookingId: r.bookingId ?? r.BookingId ?? null,
            locationId: r.locationId ?? r.LocationId ?? null,
            locationName: r.locationName ?? r.LocationName ?? '',
            companyId: Number(r.companyId ?? r.CompanyId ?? 0),
            branchId: Number(r.branchId ?? r.BranchId ?? 0),
            issuedOn: r.issuedOn ?? r.IssuedOn ?? '',
            dueDate: r.dueOn ?? r.DueOn ?? r.dueDate ?? '',
            dueOn: r.dueOn ?? r.DueOn ?? r.dueDate ?? '',
            roomRentExclTax: Number(r.roomRentExclTax ?? r.RoomRentExclTax ?? 0),
            serviceCharges: Number(r.serviceCharges ?? r.ServiceCharges ?? 0),
            taxOnServiceCharges: Number(r.taxOnServiceCharges ?? r.TaxOnServiceCharges ?? 0),
            whtAmount: Number(r.whtAmount ?? r.WHTAmount ?? 0),
            securityDepositAmount: Number(r.securityDepositAmount ?? r.SecurityDepositAmount ?? 0),
            grandTotal: Number(r.grandTotal ?? r.GrandTotal ?? 0),
            netReceivableAmount: Number(r.netReceivableAmount ?? r.NetReceivableAmount ?? 0),
            dropdownDisplay: display
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
        return list.map((r: any) => ({
          accountId: r.accountId ?? r.AccountId ?? 0,
          description: r.description ?? r.Description ?? '',
          title: r.description ?? r.Description ?? r.title ?? '',
          shortDesc: r.shortDesc ?? r.ShortDesc ?? '',
          code: r.shortDesc ?? r.ShortDesc ?? r.code ?? '',
          accountNature: r.accountNature ?? r.AccountNature ?? '',
          companyId: Number(r.companyId ?? r.CompanyId ?? 0),
          isCashInHand: !!(r.isCashInHand ?? r.IsCashInHand)
        }));
      })
    );
  }

  createReceipt(payload: CreateFeeReceiptDto): Observable<ApiResponse<FeeReceiptDetailDto>> {
    const body = {
      invoiceIdGUID: payload.invoiceIdGUID ?? payload.invoiceIdGuid,
      invoiceIdGuid: payload.invoiceIdGUID ?? payload.invoiceIdGuid,
      cashInHandAccountId: payload.cashInHandAccountId ?? payload.accountId,
      accountId: payload.cashInHandAccountId ?? payload.accountId,
      receiptDate: payload.receiptDate,
      paymentType: payload.paymentType,
      remarks: payload.remarks
    };
    return this.http.post<ApiResponse<FeeReceiptDetailDto>>(this.baseUrl, body);
  }

  voidReceipt(payload: VoidFeeReceiptDto): Observable<ApiResponse<any>> {
    const body = {
      id: payload.id ?? payload.receiptId,
      receiptId: payload.receiptId ?? payload.id,
      receiptGUID: payload.receiptGUID,
      voidReason: payload.voidReason
    };
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
        const items = payload?.data ?? payload?.items ?? (Array.isArray(payload) ? payload : []);
        const total = payload?.totalCount ?? payload?.total ?? items.length;
        return {
          total,
          page: payload?.page ?? params.page,
          limit: payload?.limit ?? params.limit,
          items: items.map((r: any) => ({
            id: r.id ?? r.Id ?? 0,
            idGuid: r.idGUID ?? r.idGuid ?? r.IdGUID ?? '',
            code: r.code ?? r.Code ?? '',
            receiptDate: r.receiptDate ?? r.ReceiptDate ?? '',
            customerIdGuid: r.customerIdGUID ?? r.customerIdGuid ?? '',
            customerName: r.customerName ?? r.CustomerName ?? '',
            customerCode: r.customerCode ?? r.CustomerCode ?? '',
            invoiceIdGuid: r.invoiceIdGUID ?? r.invoiceIdGuid ?? '',
            invoiceNumber: r.invoiceNumber ?? r.InvoiceNumber ?? '',
            locationId: r.locationId ?? r.LocationId ?? null,
            locationName: r.locationName ?? r.LocationName ?? '',
            totalAmount: Number(r.totalAmount ?? r.TotalAmount ?? 0),
            paymentType: r.paymentType ?? r.PaymentType ?? 'Cash',
            cashInHandAccountId: r.cashInHandAccountId ?? r.CashInHandAccountId ?? 0,
            accountTitle: r.cashInHandAccountName ?? r.accountTitle ?? r.AccountTitle ?? '',
            status: Number(r.status ?? r.Status ?? 1),
            statusLabel: r.statusLabel ?? r.StatusLabel ?? 'Active',
            remarks: r.remarks ?? r.Remarks ?? '',
            voidReason: r.voidReason ?? r.VoidReason ?? '',
            createdOn: r.createdOn ?? r.CreatedOn ?? '',
            createdByName: r.createdByName ?? r.CreatedByName ?? ''
          }))
        };
      })
    );
  }

  getReceiptById(id: number): Observable<FeeReceiptDetailDto> {
    return this.http.get<ApiResponse<any>>(`${this.baseUrl}/${id}`).pipe(
      map(res => {
        const r = res?.data ?? {};
        return {
          id: r.id ?? r.Id ?? 0,
          idGuid: r.idGUID ?? r.idGuid ?? r.IdGUID ?? '',
          code: r.code ?? r.Code ?? '',
          receiptDate: r.receiptDate ?? r.ReceiptDate ?? '',
          customerIdGuid: r.customerIdGUID ?? r.customerIdGuid ?? '',
          customerName: r.customerName ?? r.CustomerName ?? '',
          customerCode: r.customerCode ?? r.CustomerCode ?? '',
          invoiceIdGuid: r.invoiceIdGUID ?? r.invoiceIdGuid ?? '',
          invoiceNumber: r.invoiceNumber ?? r.InvoiceNumber ?? '',
          locationId: r.locationId ?? r.LocationId ?? null,
          locationName: r.locationName ?? r.LocationName ?? '',
          totalAmount: Number(r.totalAmount ?? r.TotalAmount ?? 0),
          paymentType: r.paymentType ?? r.PaymentType ?? 'Cash',
          cashInHandAccountId: r.cashInHandAccountId ?? r.CashInHandAccountId ?? 0,
          accountTitle: r.cashInHandAccountName ?? r.accountTitle ?? r.AccountTitle ?? '',
          status: Number(r.status ?? r.Status ?? 1),
          statusLabel: r.statusLabel ?? r.StatusLabel ?? 'Active',
          remarks: r.remarks ?? r.Remarks ?? '',
          voidReason: r.voidReason ?? r.VoidReason ?? '',
          createdOn: r.createdOn ?? r.CreatedOn ?? '',
          createdByName: r.createdByName ?? r.CreatedByName ?? '',
          invoiceTypeId: Number(r.invoiceTypeId ?? r.InvoiceTypeId ?? 1),
          invoiceTypeName: r.invoiceTypeName ?? r.InvoiceTypeName ?? 'Standard Invoice',
          roomRentExclTax: Number(r.roomRentExclTax ?? r.RoomRentExclTax ?? 0),
          serviceCharges: Number(r.serviceCharges ?? r.ServiceCharges ?? 0),
          taxOnServiceCharges: Number(r.taxOnServiceCharges ?? r.TaxOnServiceCharges ?? 0),
          whtAmount: Number(r.whtAmount ?? r.WHTAmount ?? 0),
          securityDepositAmount: Number(r.securityDepositAmount ?? r.SecurityDepositAmount ?? 0),
          grandTotal: Number(r.grandTotal ?? r.GrandTotal ?? 0),
          companyId: Number(r.companyId ?? r.CompanyId ?? 0),
          companyName: r.companyName ?? r.CompanyName ?? 'WorkNest',
          branchId: Number(r.branchId ?? r.BranchId ?? 0),
          branchName: r.branchName ?? r.BranchName ?? '',
          invoiceIssuedOn: r.invoiceIssuedOn ?? r.InvoiceIssuedOn ?? null,
          invoiceDueDate: r.invoiceDueOn ?? r.InvoiceDueOn ?? null,
          customerEmail: r.customerEmail ?? r.CustomerEmail ?? '',
          customerPhone: r.customerPhone ?? r.CustomerPhone ?? '',
          spaceName: r.spaceName ?? r.SpaceName ?? '',
          spaceTypeName: r.spaceTypeName ?? r.SpaceTypeName ?? '',
          updatedOn: r.updatedOn ?? r.UpdatedOn ?? null,
          updatedByName: r.updatedByName ?? r.UpdatedByName ?? ''
        };
      })
    );
  }

  getReceiptByGuid(guid: string): Observable<FeeReceiptDetailDto> {
    return this.http.get<ApiResponse<any>>(`${this.baseUrl}/guid/${guid}`).pipe(
      map(res => res.data)
    );
  }
}

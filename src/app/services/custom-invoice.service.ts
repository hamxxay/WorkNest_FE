import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map, tap, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { ApiResponse } from '../models/admin.model';

// ============================================================
// Custom invoices (super admin, and admins a super admin has given access):
//   GET  api/custom-invoices/access/me              -> { canUse, isSuperAdmin }
//   GET  api/custom-invoices/access                 -> admin users and whether each may use the page (super admin)
//   POST api/custom-invoices/access/{userId}        -> { hasAccess } turns one admin's access on / off (super admin)
//   GET  api/custom-invoices/customers?search=      -> customers to invoice
//   GET  api/custom-invoices/bookings?userId=       -> that customer's bookings
//   GET  api/custom-invoices/replaceable?bookingId= -> unpaid invoices of the booking that may be replaced
//   GET  api/custom-invoices/locations              -> locations (for an invoice without a booking)
//   GET  api/custom-invoices/spaces?locationId=     -> spaces of a location (optional assignment)
//   GET  api/custom-invoices/ledger-defaults?locationId=&date= -> default accounts of the location
//   GET  api/custom-invoices/accounts?search=       -> accounts for the ledger lines
//   POST api/custom-invoices                        -> creates the invoice and posts its voucher
//   GET  api/custom-invoices?page=&search=          -> recent custom invoices
// The API enforces who may call these; the CMS only hides what the user cannot use.
// ============================================================

export interface CustomInvoiceAccessMe {
  canUse: boolean;
  isSuperAdmin: boolean;
}

export interface CustomInvoiceAccessItem {
  userId: number;
  name: string;
  email: string;
  locationNames: string[];
  hasAccess: boolean;
  grantedBy: string | null;
  /** ISO 8601 (UTC when it carries no zone). */
  grantedAt: string | null;
}

export interface CiCustomer {
  userId: number;
  customerId: number;
  name: string;
  email: string;
  code: string;
  phone: string;
}

export interface CiBooking {
  bookingId: number;
  spaceId: number | null;
  label: string;
  spaceName: string;
  locationId: number;
  locationName: string;
  startOn: string | null;
  endOn: string | null;
  status: string;
}

export interface CiSpace {
  spaceId: number;
  code: string;
  name: string;
  label: string;
  locationId: number;
}

export interface CiReplaceableInvoice {
  invoiceId: number;
  invoiceNumber: string;
  issuedOn: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  grandTotal: number;
  invoiceTypeId: number;
}

export interface CiLocation {
  id: number;
  name: string;
}

export interface CiAccount {
  accountId: number;
  code: string;
  name: string;
}

export interface CiLedgerDefaults {
  accountReceivable: CiAccount | null;
  rent: CiAccount | null;
  servicesIncome: CiAccount | null;
  salesTax: CiAccount | null;
  securityReceived: CiAccount | null;
}

export interface CreateCustomInvoiceRequest {
  userId: number;
  bookingId: number | null;
  locationId: number;
  /** Optional: the space (WN_Spaces.Id) the invoice is assigned to. */
  spaceId: number | null;
  replaceInvoiceId: number | null;
  /** yyyy-MM-dd */
  issuedOn: string;
  dueOn: string;
  periodFrom: string;
  periodTo: string;
  rentAmount: number;
  serviceCharge: number;
  taxPercent: number;
  taxAmount: number;
  securityDeposit: number;
  grandTotal: number;
  reason: string;
  voucher: { date: string; description: string };
  customerLedger: { debit: number; narration: string };
  lines: { accountId: number; debit: number; credit: number; narration: string }[];
  overrideTotalMismatch: boolean;
}

export interface CreateCustomInvoiceResult {
  invoiceId: number;
  invoiceNumber: string;
  publicId: string | null;
  voucherId: number | null;
  voucherCode: string;
  replacedInvoiceNumber: string | null;
  reversalVoucherCode: string | null;
  /** The API's message, e.g. "Custom invoice CI-0001 created." */
  message: string;
}

export interface CiRecentItem {
  invoiceId: number;
  invoiceNumber: string;
  customerName: string;
  bookingLabel: string;
  grandTotal: number;
  issuedOn: string | null;
  statusLabel: string;
  reason: string;
  createdBy: string;
  voucherCode: string;
  replacedInvoiceNumber: string | null;
}

export interface CiRecentPage {
  items: CiRecentItem[];
  total: number;
}

/** The location's sales tax on service charges (api/tax-rate): 0 when the tax does not apply there. */
export interface CiTaxRate {
  taxPercentage: number;
  taxApplicable: boolean;
}

/** A failed call (or an answer with isSuccessful: false), with a message that is safe to show. */
export class CustomInvoiceError extends Error {
  constructor(message: string, readonly status: number | null = null) {
    super(message);
  }
}

@Injectable({ providedIn: 'root' })
export class CustomInvoiceService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/custom-invoices`;

  /** The signed-in user's last known access (from access/me); null until it has been asked. Used by the sidebar. */
  readonly myAccess = signal<CustomInvoiceAccessMe | null>(null);

  getMyAccess(): Observable<CustomInvoiceAccessMe> {
    return this.http.get<ApiResponse<unknown>>(`${this.baseUrl}/access/me`).pipe(
      map(res => {
        const d = unwrap(res, "Your access couldn't be checked. Please try again.") as Record<string, unknown> | null;
        return { canUse: d?.['canUse'] === true, isSuperAdmin: d?.['isSuperAdmin'] === true };
      }),
      tap(me => this.myAccess.set(me))
    );
  }

  getAccessList(): Observable<CustomInvoiceAccessItem[]> {
    return this.http.get<ApiResponse<unknown>>(`${this.baseUrl}/access`).pipe(
      map(res => list(unwrap(res, "The admin users couldn't be loaded. Please try again.")).map(toAccessItem)
        .filter((x): x is CustomInvoiceAccessItem => x !== null))
    );
  }

  setAccess(userId: number, hasAccess: boolean): Observable<{ item: CustomInvoiceAccessItem | null; message: string }> {
    if (!(userId > 0)) return throwError(() => new CustomInvoiceError('This user has no id.'));
    return this.http.post<ApiResponse<unknown>>(`${this.baseUrl}/access/${userId}`, { hasAccess }).pipe(
      map(res => ({ item: toAccessItem(unwrap(res, "The change wasn't saved. Please try again.")), message: res?.message ?? '' }))
    );
  }

  searchCustomers(search: string): Observable<CiCustomer[]> {
    const params = new HttpParams().set('search', search.trim());
    return this.http.get<ApiResponse<unknown>>(`${this.baseUrl}/customers`, { params }).pipe(
      map(res => list(unwrap(res, "Customers couldn't be loaded. Please try again.")).map(toCustomer)
        .filter((x): x is CiCustomer => x !== null))
    );
  }

  getBookings(userId: number): Observable<CiBooking[]> {
    const params = new HttpParams().set('userId', String(userId));
    return this.http.get<ApiResponse<unknown>>(`${this.baseUrl}/bookings`, { params }).pipe(
      map(res => list(unwrap(res, "Bookings couldn't be loaded. Please try again.")).map(toBooking)
        .filter((x): x is CiBooking => x !== null))
    );
  }

  getReplaceable(bookingId: number): Observable<CiReplaceableInvoice[]> {
    const params = new HttpParams().set('bookingId', String(bookingId));
    return this.http.get<ApiResponse<unknown>>(`${this.baseUrl}/replaceable`, { params }).pipe(
      map(res => list(unwrap(res, "Unpaid invoices couldn't be loaded. Please try again.")).map(toReplaceable)
        .filter((x): x is CiReplaceableInvoice => x !== null))
    );
  }

  getLocations(): Observable<CiLocation[]> {
    return this.http.get<ApiResponse<unknown>>(`${this.baseUrl}/locations`).pipe(
      map(res => list(unwrap(res, "Locations couldn't be loaded. Please try again.")).map(r => {
        const o = obj(r);
        const id = num(o?.['id']);
        return id > 0 ? { id, name: str(o?.['name']) || `Location ${id}` } : null;
      }).filter((x): x is CiLocation => x !== null))
    );
  }

  getSpaces(locationId: number): Observable<CiSpace[]> {
    const params = new HttpParams().set('locationId', String(locationId));
    return this.http.get<ApiResponse<unknown>>(`/spaces`, { params }).pipe(
      map(res => list(unwrap(res, "Spaces couldn't be loaded. Please try again.")).map(r => {
        const o = obj(r);
        const spaceId = num(o?.['spaceId']);
        if (!(spaceId > 0)) return null;
        const name = str(o?.['name']), code = str(o?.['code']);
        return { spaceId, code, name, label: str(o?.['label']) || name || code || `Space ${spaceId}`, locationId: num(o?.['locationId']) };
      }).filter((x): x is CiSpace => x !== null))
    );
  }

  getLedgerDefaults(locationId: number, date: string): Observable<CiLedgerDefaults> {
    const params = new HttpParams().set('locationId', String(locationId)).set('date', date);
    return this.http.get<ApiResponse<unknown>>(`${this.baseUrl}/ledger-defaults`, { params }).pipe(
      map(res => {
        const o = obj(unwrap(res, "The location's default accounts couldn't be loaded. Please try again."));
        return {
          accountReceivable: toAccount(o?.['accountReceivable']),
          rent: toAccount(o?.['rent']),
          servicesIncome: toAccount(o?.['servicesIncome']),
          salesTax: toAccount(o?.['salesTax']),
          securityReceived: toAccount(o?.['securityReceived']),
        };
      })
    );
  }

  searchAccounts(search: string): Observable<CiAccount[]> {
    const params = new HttpParams().set('search', search.trim());
    return this.http.get<ApiResponse<unknown>>(`${this.baseUrl}/accounts`, { params }).pipe(
      map(res => list(unwrap(res, "Accounts couldn't be loaded. Please try again.")).map(toAccount)
        .filter((x): x is CiAccount => x !== null))
    );
  }

  /** The location's configured sales tax on service charges (same call the quotation form makes). */
  getTaxRate(locationId: number): Observable<CiTaxRate> {
    const params = new HttpParams().set('locationId', String(locationId));
    return this.http.get<ApiResponse<unknown>>(`${environment.apiUrl}/tax-rate`, { params }).pipe(
      map(res => {
        const o = obj((res as any)?.data ?? res);
        const rate = num(o?.['taxPercentage']);
        return { taxPercentage: rate, taxApplicable: o?.['taxApplicable'] !== false && rate > 0 };
      })
    );
  }

  create(body: CreateCustomInvoiceRequest): Observable<CreateCustomInvoiceResult> {
    return this.http.post<ApiResponse<unknown>>(this.baseUrl, body).pipe(
      map(res => {
        const o = obj(unwrap(res, "The custom invoice wasn't created. Please try again."));
        return {
          invoiceId: num(o?.['invoiceId']),
          invoiceNumber: str(o?.['invoiceNumber']),
          publicId: str(o?.['publicId']) || null,
          voucherId: o?.['voucherId'] != null ? num(o['voucherId']) : null,
          voucherCode: str(o?.['voucherCode']),
          replacedInvoiceNumber: str(o?.['replacedInvoiceNumber']) || null,
          reversalVoucherCode: str(o?.['reversalVoucherCode']) || null,
          message: res?.message ?? '',
        };
      })
    );
  }

  getRecent(page: number, search: string): Observable<CiRecentPage> {
    let params = new HttpParams().set('page', String(page));
    if (search.trim()) params = params.set('search', search.trim());
    return this.http.get<ApiResponse<unknown>>(this.baseUrl, { params }).pipe(
      map(res => {
        const o = obj(unwrap(res, "Recent custom invoices couldn't be loaded. Please try again."));
        const items = list(o?.['items']).map(toRecent).filter((x): x is CiRecentItem => x !== null);
        const total = num(o?.['total'] ?? (res as any)?.total);
        return { items, total: Math.max(total, items.length) };
      })
    );
  }
}

/**
 * The message to show for a failed call. The error interceptor already put a readable message on HTTP errors (the
 * API's own text first, e.g. the 503 "Database update needed: ..."); a 403 always gets ours.
 */
export function customInvoiceErrorMessage(err: unknown, fallback: string): string {
  const e = err as { status?: number; message?: string; error?: { message?: string } } | null;
  if (e?.status === 403) {
    return "You don't have access to custom invoices. A super admin can give it on the Custom Invoice page.";
  }
  const text = e?.error?.message || e?.message;
  if (typeof text === 'string' && text.trim()) return text.trim();
  return fallback;
}

// ---------- mapping helpers (camelCase from the API; anything missing gets a safe default) ----------

function unwrap(res: ApiResponse<unknown> | null | undefined, fallback: string): unknown {
  if (!res || res.isSuccessful === false) throw new CustomInvoiceError(res?.message || fallback);
  return res.data ?? null;
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function list(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
}

function dateOnly(v: unknown): string | null {
  const s = str(v);
  return s ? s.slice(0, 10) : null;
}

function toAccount(v: unknown): CiAccount | null {
  const o = obj(v);
  const accountId = num(o?.['accountId']);
  if (!(accountId > 0)) return null;
  return { accountId, code: str(o?.['code']), name: str(o?.['name']) };
}

function toAccessItem(v: unknown): CustomInvoiceAccessItem | null {
  const o = obj(v);
  const userId = num(o?.['userId']);
  if (!(userId > 0)) return null;
  return {
    userId,
    name: str(o?.['name']),
    email: str(o?.['email']),
    locationNames: list(o?.['locationNames']).map(str).filter(Boolean),
    hasAccess: o?.['hasAccess'] === true,
    grantedBy: str(o?.['grantedBy']) || null,
    grantedAt: str(o?.['grantedAt']) || null,
  };
}

function toCustomer(v: unknown): CiCustomer | null {
  const o = obj(v);
  const userId = num(o?.['userId']);
  if (!(userId > 0)) return null;
  return {
    userId,
    customerId: num(o?.['customerId']),
    name: str(o?.['name']),
    email: str(o?.['email']),
    code: str(o?.['code']),
    phone: str(o?.['phone']),
  };
}

function toBooking(v: unknown): CiBooking | null {
  const o = obj(v);
  const bookingId = num(o?.['bookingId']);
  if (!(bookingId > 0)) return null;
  return {
    bookingId,
    spaceId: num(o?.['spaceId']) > 0 ? num(o?.['spaceId']) : null,
    label: str(o?.['label']),
    spaceName: str(o?.['spaceName']),
    locationId: num(o?.['locationId']),
    locationName: str(o?.['locationName']),
    startOn: dateOnly(o?.['startOn']),
    endOn: dateOnly(o?.['endOn']),
    status: str(o?.['status']),
  };
}

function toReplaceable(v: unknown): CiReplaceableInvoice | null {
  const o = obj(v);
  const invoiceId = num(o?.['invoiceId']);
  if (!(invoiceId > 0)) return null;
  return {
    invoiceId,
    invoiceNumber: str(o?.['invoiceNumber']) || `#${invoiceId}`,
    issuedOn: dateOnly(o?.['issuedOn']),
    periodStart: dateOnly(o?.['periodStart']),
    periodEnd: dateOnly(o?.['periodEnd']),
    grandTotal: num(o?.['grandTotal']),
    invoiceTypeId: num(o?.['invoiceTypeId']),
  };
}

function toRecent(v: unknown): CiRecentItem | null {
  const o = obj(v);
  const invoiceId = num(o?.['invoiceId']);
  if (!(invoiceId > 0)) return null;
  return {
    invoiceId,
    invoiceNumber: str(o?.['invoiceNumber']),
    customerName: str(o?.['customerName']),
    bookingLabel: str(o?.['bookingLabel']),
    grandTotal: num(o?.['grandTotal']),
    issuedOn: dateOnly(o?.['issuedOn']),
    statusLabel: str(o?.['statusLabel']),
    reason: str(o?.['reason']),
    createdBy: str(o?.['createdBy']),
    voucherCode: str(o?.['voucherCode']),
    replacedInvoiceNumber: str(o?.['replacedInvoiceNumber']) || null,
  };
}

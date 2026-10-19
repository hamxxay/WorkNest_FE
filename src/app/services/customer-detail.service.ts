import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Observable, catchError, map, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { arr, num, numOrNull, obj, serverMessageOf, str, strOrNull } from './dashboard-api';

// ============================================================
// Customer detail page (/admin/customers/:id). Every section loads on its own, so one failing section never blanks
// the page:
//   profile     GET customer/{id}/detail               (isSuccessful false = no such customer; an API without this
//                                                       endpoint yet: GET customer/{id})
//   overview    GET customer/{id}/overview             (summary, bookings, receipts, payments, agreements, deposits,
//                                                       timeline; 503 until the database script CD_01 has run)
//   invoices    GET customer/{id}/invoices?page&limit  (as the mobile app's customer screen)
//   quotations  GET quotation/by-customer/{id}?page&limit
// Owner's rule: the page shows every customer the Customers list shows (profile and overview have no location
// check); invoices and quotations keep their endpoints' own check (404 for a customer outside the user's
// locations). Rows are normalised here, so a missing field shows as "-" instead of breaking the page.
// ============================================================

/** Shown in the overview sections until the database script has been run (the API answers 503). */
export const CUSTOMER_DETAIL_DB_MESSAGE = 'Database update needed: run the script CD_01_customer_detail_TEST';

export interface SectionError {
  status: number;
  message: string;
  /** The overview procedure is missing (503): the database script CD_01 has not run yet. */
  needsDbUpdate: boolean;
  /** 404 or isSuccessful false: no such customer, or one of a location this user is not assigned to. */
  notFound: boolean;
}

export interface CustomerProfile {
  id: number;
  code: string;
  fullName: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  cnic: string | null;
  ntn: string | null;
  secp: string | null;
  address: string | null;
  city: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string | null;
}

export interface CustomerSummary {
  totalBookings: number;
  activeBookings: number;
  invoiceCount: number;
  totalInvoiced: number;
  totalPaid: number;
  outstanding: number;
  outstandingCount: number;
  overdue: number;
  overdueCount: number;
  depositHeld: number;
  depositCount: number;
  quotationCount: number;
  /** Location names of the customer's bookings and user account ("I-8, Blue Area"), '' when none. */
  locations: string;
}

export interface CustomerBooking {
  bookingId: number;
  status: string;
  spaceName: string;
  spaceType: string;
  locationName: string;
  startOn: string | null;
  endOn: string | null;
  createdOn: string | null;
  monthlyRent: number | null;
  billingPeriod: string;
  contractTotal: number | null;
  paid: number | null;
  balance: number | null;
  nextBillingDate: string | null;
  securityDeposit: number | null;
  challanNumber: string;
  isActive: boolean;
  createdByName: string | null;
}

export interface CustomerReceipt {
  id: number;
  code: string;
  receiptDate: string | null;
  amount: number;
  paymentType: string;
  status: string;
  isVoid: boolean;
  voidReason: string | null;
  invoiceId: number | null;
  invoiceNumber: string;
  account: string;
  locationName: string;
  createdByName: string | null;
}

export interface CustomerPayment {
  id: number;
  amount: number;
  currency: string;
  method: string;
  status: string;
  paidOn: string | null;
  createdOn: string | null;
  reference: string;
  invoiceId: number | null;
  invoiceNumber: string;
  bookingId: number | null;
}

export interface CustomerAgreement {
  id: number;
  status: string;
  sentAt: string | null;
  signedDate: string | null;
  createdOn: string | null;
  feeAmount: number | null;
  securityDeposit: number | null;
  quotationNumber: string;
  quotationVersion: number | null;
  bookingId: number | null;
  spaceName: string;
  locationName: string;
  hasSignedPdf: boolean;
  createdByName: string | null;
}

export interface CustomerDeposit {
  id: number;
  bookingId: number | null;
  refNo: string;
  amount: number;
  state: string;
  createdOn: string | null;
  releasedOn: string | null;
  forfeitedOn: string | null;
  forfeitReason: string | null;
}

export type TimelineKind = 'customer' | 'quotation' | 'booking' | 'invoice' | 'receipt' | 'payment' | 'agreement' | 'deposit' | 'other';

export interface TimelineEvent {
  kind: TimelineKind;
  action: string;
  /** What happened, ready to show (a quotation activity is worded from its type: "AgreementSent" -> "Agreement sent"). */
  title: string;
  reference: string;
  detail: string | null;
  note: string | null;
  amount: number | null;
  actorName: string | null;
  refId: number | null;
  /** An instant (UTC from the API) or, for events known by date only, the date. */
  at: string | null;
  dateOnly: boolean;
}

export interface CustomerOverview {
  summary: CustomerSummary;
  bookings: CustomerBooking[];
  receipts: CustomerReceipt[];
  payments: CustomerPayment[];
  agreements: CustomerAgreement[];
  deposits: CustomerDeposit[];
  timeline: TimelineEvent[];
}

export interface CustomerInvoice {
  id: number;
  invoiceNumber: string;
  bookingId: number | null;
  issuedOn: string | null;
  dueOn: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  grandTotal: number;
  paidTotal: number;
  balanceDue: number;
  currency: string;
  status: string;
}

export interface CustomerQuotation {
  id: number;
  quotationNumber: string;
  version: number;
  status: string;
  spaceName: string;
  locationName: string;
  quotationDate: string | null;
  validUntil: string | null;
  totalAmount: number;
  isExpired: boolean;
}

export interface PagedRows<T> { rows: T[]; total: number; page: number; limit: number; }

/** "AgreementSent" -> "Agreement sent", "VersionCreated" -> "Version created". */
export function humanize(code: string): string {
  const words = code.replace(/[_-]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  return words.map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w.toLowerCase())).join(' ');
}

const KINDS: TimelineKind[] = ['customer', 'quotation', 'booking', 'invoice', 'receipt', 'payment', 'agreement', 'deposit'];

function toProfile(d: any): CustomerProfile {
  const first = str(d.firstName).trim();
  const last = str(d.lastName).trim();
  const company = str(d.company).trim();
  return {
    id: num(d.id),
    code: str(d.code),
    fullName: str(d.fullName).trim() || [first, last].filter(Boolean).join(' ') || company || str(d.email),
    // Older rows store "Individual" in the company column for people (same rule as the Customers list).
    company: company && company.toLowerCase() !== 'individual' ? company : null,
    email: strOrNull(d.email),
    phone: strOrNull(d.phoneNumber),
    cnic: strOrNull(d.cnicOrPassport),
    ntn: strOrNull(d.ntn),
    secp: strOrNull(d.secpRegistrationNo),
    address: strOrNull(d.address),
    city: strOrNull(d.cityName),
    notes: strOrNull(d.notes),
    isActive: d.isActive !== false && d.isActive !== 0,
    createdAt: strOrNull(d.createdAt)
  };
}

function toSummary(d: any): CustomerSummary {
  return {
    totalBookings: num(d.totalBookings),
    activeBookings: num(d.activeBookings),
    invoiceCount: num(d.invoiceCount),
    totalInvoiced: num(d.totalInvoiced),
    totalPaid: num(d.totalPaid),
    outstanding: num(d.outstanding),
    outstandingCount: num(d.outstandingCount),
    overdue: num(d.overdue),
    overdueCount: num(d.overdueCount),
    depositHeld: num(d.depositHeld),
    depositCount: num(d.depositCount),
    quotationCount: num(d.quotationCount),
    locations: str(d.locations)
  };
}

const toBooking = (d: any): CustomerBooking => ({
  bookingId: num(d.bookingId),
  status: str(d.bookingStatusLabel),
  spaceName: str(d.spaceName) || str(d.spaceCode),
  spaceType: str(d.spaceTypeName),
  locationName: str(d.locationName),
  startOn: strOrNull(d.startOn),
  endOn: strOrNull(d.endOn),
  createdOn: strOrNull(d.createdOn),
  monthlyRent: numOrNull(d.monthlyRent),
  billingPeriod: str(d.billingPeriodLabel),
  contractTotal: numOrNull(d.totalContractAmount),
  paid: numOrNull(d.totalPaidAmount),
  balance: numOrNull(d.balanceLeft),
  nextBillingDate: strOrNull(d.nextBillingDate),
  securityDeposit: numOrNull(d.securityDeposit),
  challanNumber: str(d.challanNumber),
  isActive: d.isActive === true || d.isActive === 1,
  createdByName: strOrNull(d.createdByName)
});

const toReceipt = (d: any): CustomerReceipt => ({
  id: num(d.id),
  code: str(d.code),
  receiptDate: strOrNull(d.receiptDate),
  amount: num(d.totalAmount),
  paymentType: str(d.paymentType),
  status: str(d.statusLabel),
  isVoid: num(d.status) === 0,
  voidReason: strOrNull(d.voidReason),
  invoiceId: numOrNull(d.invoiceId),
  invoiceNumber: str(d.invoiceNumber),
  account: str(d.cashInHandAccountName),
  locationName: str(d.locationName),
  createdByName: strOrNull(d.createdByName)
});

const toPayment = (d: any): CustomerPayment => ({
  id: num(d.id),
  amount: num(d.amount),
  currency: str(d.currencyCode),
  method: str(d.paymentMethodLabel),
  status: str(d.paymentStatus),
  paidOn: strOrNull(d.paidOn),
  createdOn: strOrNull(d.createdOn),
  reference: str(d.transactionRef),
  invoiceId: numOrNull(d.invoiceId),
  invoiceNumber: str(d.invoiceNumber),
  bookingId: numOrNull(d.bookingId)
});

const toAgreement = (d: any): CustomerAgreement => ({
  id: num(d.id),
  status: str(d.status),
  sentAt: strOrNull(d.sentAt),
  signedDate: strOrNull(d.signedDate),
  createdOn: strOrNull(d.createdOn),
  feeAmount: numOrNull(d.feeAmount),
  securityDeposit: numOrNull(d.securityDeposit),
  quotationNumber: str(d.quotationNumber),
  quotationVersion: numOrNull(d.quotationVersion),
  bookingId: numOrNull(d.bookingId),
  spaceName: str(d.spaceName),
  locationName: str(d.locationName),
  hasSignedPdf: d.hasSignedPdf === true || d.hasSignedPdf === 1,
  createdByName: strOrNull(d.createdByName)
});

const toDeposit = (d: any): CustomerDeposit => ({
  id: num(d.id),
  bookingId: numOrNull(d.bookingId),
  refNo: str(d.refNo),
  amount: num(d.amount),
  state: str(d.state),
  createdOn: strOrNull(d.createdOn),
  releasedOn: strOrNull(d.releasedOn),
  forfeitedOn: strOrNull(d.forfeitedOn),
  forfeitReason: strOrNull(d.forfeitReason)
});

function toEvent(d: any): TimelineEvent {
  const kind = str(d.kind).toLowerCase() as TimelineKind;
  const action = str(d.action);
  const createdOn = strOrNull(d.createdOn);
  return {
    kind: KINDS.includes(kind) ? kind : 'other',
    action,
    title: str(d.title) || humanize(action) || 'Update',
    reference: str(d.reference),
    detail: strOrNull(d.detail),
    note: strOrNull(d.note),
    amount: numOrNull(d.amount),
    actorName: strOrNull(d.actorName),
    refId: numOrNull(d.refId),
    at: createdOn ?? strOrNull(d.eventDate),
    dateOnly: !createdOn
  };
}

const toInvoice = (d: any): CustomerInvoice => ({
  id: num(d.id),
  invoiceNumber: str(d.invoiceNumber) || `#${num(d.id)}`,
  bookingId: numOrNull(d.bookingId),
  issuedOn: strOrNull(d.issuedOn),
  dueOn: strOrNull(d.dueOn),
  periodStart: strOrNull(d.billingPeriodStart),
  periodEnd: strOrNull(d.billingPeriodEnd),
  grandTotal: num(d.grandTotal),
  paidTotal: num(d.paidTotal),
  balanceDue: num(d.balanceDue),
  currency: str(d.currencyCode),
  status: str(d.statusLabel)
});

const toQuotation = (d: any): CustomerQuotation => ({
  id: num(d.id),
  quotationNumber: str(d.quotationNumber) || `#${num(d.id)}`,
  version: num(d.version) || 1,
  status: str(d.status),
  spaceName: str(d.spaceName) || str(d.spaceCode),
  locationName: str(d.locationName),
  quotationDate: strOrNull(d.quotationDate),
  validUntil: strOrNull(d.validUntil),
  totalAmount: num(d.totalAmount),
  isExpired: d.isExpired === true
});

/** A failed section request, worded for the page. */
export function describeSectionError(err: unknown): SectionError {
  if (err && typeof err === 'object' && 'needsDbUpdate' in (err as any) && 'notFound' in (err as any)) return err as SectionError;
  const http = err instanceof HttpErrorResponse ? err : null;
  const status = http?.status ?? -1;
  if (status === 503) return { status, needsDbUpdate: true, notFound: false, message: CUSTOMER_DETAIL_DB_MESSAGE };
  if (status === 404) {
    // A 404 with the API's own message ("Customer not found.") is the customer; one without a message is an API that
    // does not have this endpoint yet (e.g. the overview before the API update is live).
    return serverMessageOf(err)
      ? { status, needsDbUpdate: false, notFound: true, message: 'Customer not found.' }
      : { status, needsDbUpdate: false, notFound: false, message: 'Not available on this server yet. It will work once the API update is live.' };
  }
  if (status === 0) return { status, needsDbUpdate: false, notFound: false, message: 'Cannot reach the server. Check your internet connection and try again.' };
  if (status === 403) return { status, needsDbUpdate: false, notFound: false, message: 'Your account cannot open this customer.' };
  // The error interceptor puts a readable message in error.message (never technical text).
  const msg = (http?.error && typeof http.error === 'object' ? str(http.error.message) : '') || str((err as any)?.message);
  return { status, needsDbUpdate: false, notFound: false, message: msg && msg.length <= 300 ? msg : 'Something went wrong. Please try again.' };
}

/** Unwraps { isSuccessful, data }; isSuccessful false becomes a SectionError (the API's message). */
function unwrap(res: any, notFoundOnFail = false): any {
  if (res && typeof res === 'object' && 'isSuccessful' in res && res.isSuccessful === false) {
    const message = str(res.message) || 'Something went wrong. Please try again.';
    throw { status: 200, needsDbUpdate: false, notFound: notFoundOnFail, message } as SectionError;
  }
  return res && typeof res === 'object' && 'data' in res ? res.data : res;
}

@Injectable({ providedIn: 'root' })
export class CustomerDetailService {
  private http = inject(HttpClient);
  private api = environment.apiUrl;

  getProfile(id: number): Observable<CustomerProfile> {
    return this.http.get<any>(`${this.api}/customer/${id}/detail`).pipe(
      // An API without the detail endpoint yet (404 with no message of its own): the customer record endpoint.
      catchError(err => err instanceof HttpErrorResponse && err.status === 404 && !serverMessageOf(err)
        ? this.http.get<any>(`${this.api}/customer/${id}`)
        : throwError(() => err)),
      map(res => {
        const d = obj(unwrap(res, true));
        if (!d || !num(d.id)) throw { status: 404, needsDbUpdate: false, notFound: true, message: 'Customer not found.' } as SectionError;
        return toProfile(d);
      }),
      catchError(err => throwError(() => describeSectionError(err)))
    );
  }

  getOverview(id: number): Observable<CustomerOverview> {
    return this.http.get<any>(`${this.api}/customer/${id}/overview`).pipe(
      map(res => {
        const d = obj(unwrap(res, true)) ?? {};
        return {
          summary: toSummary(obj(d.summary) ?? {}),
          bookings: arr(d.bookings, toBooking),
          receipts: arr(d.receipts, toReceipt),
          payments: arr(d.payments, toPayment),
          agreements: arr(d.agreements, toAgreement),
          deposits: arr(d.deposits, toDeposit),
          timeline: arr(d.timeline, toEvent)
        };
      }),
      catchError(err => throwError(() => describeSectionError(err)))
    );
  }

  getInvoices(id: number, page: number, limit: number): Observable<PagedRows<CustomerInvoice>> {
    const params = new HttpParams().set('page', page).set('limit', limit);
    return this.http.get<any>(`${this.api}/customer/${id}/invoices`, { params }).pipe(
      map(res => {
        const data = unwrap(res);
        return { rows: arr(data, toInvoice), total: num(res?.totalCount ?? res?.total), page, limit };
      }),
      catchError(err => throwError(() => describeSectionError(err)))
    );
  }

  getQuotations(id: number, page: number, limit: number): Observable<PagedRows<CustomerQuotation>> {
    const params = new HttpParams().set('page', page).set('limit', limit);
    return this.http.get<any>(`${this.api}/quotation/by-customer/${id}`, { params }).pipe(
      map(res => {
        const rows = arr(unwrap(res), toQuotation);
        const total = num(res?.totalCount ?? res?.total) || rows.length;
        // An API without paging answers with every row: cut the asked-for page out here (as the mobile app does).
        return { rows: rows.length > limit ? rows.slice((page - 1) * limit, page * limit) : rows, total, page, limit };
      }),
      catchError(err => throwError(() => describeSectionError(err)))
    );
  }

  invoicePdf(invoiceId: number): Observable<Blob> {
    return this.http.get(`${this.api}/invoice/${invoiceId}/statement-pdf`, { responseType: 'blob' });
  }

  quotationPdf(quotationId: number, version?: number): Observable<Blob> {
    const url = version
      ? `${this.api}/quotation/${quotationId}/versions/${version}/pdf`
      : `${this.api}/quotation/${quotationId}/pdf`;
    return this.http.get(url, { responseType: 'blob' });
  }

  agreementPdf(agreementId: number, signed: boolean): Observable<Blob> {
    return this.http.get(`${this.api}/agreement/${agreementId}/${signed ? 'signed-pdf' : 'pdf'}`, { responseType: 'blob' });
  }
}

import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  DashError, DashErrorWording, DashParams, arr, describeDashboardError, getDashboardData, num, numOrNull, obj, serverMessageOf,
  str, strOrNull
} from './dashboard-api';

// ============================================================
// Admin dashboard chart drill-down: GET api/dashboard/overview-details/{kind} (read-only, database update DASH_02).
// The records behind one bar / slice / point of the overview charts, on exactly the overview's rules, so the
// totals here are the chart's figure. Every response is normalised here (a missing field shows as 0 / '' / []).
// ============================================================

/**
 * revenue-month (month) | aging-bucket (bucket) | top-customer (customer; period or from / to) | new-bookings (month) |
 * leases-ending (month) | space-type (spaceType) | occupied-month (month).
 */
export type OverviewDetailKind =
  | 'revenue-month' | 'aging-bucket' | 'top-customer' | 'new-bookings' | 'leases-ending' | 'space-type' | 'occupied-month';

/** Row shape of a list (the drawer's invoices / bookings / spaces tables). */
export type OverviewDetailRecords = 'invoices' | 'bookings' | 'spaces';

export interface OverviewInvoiceRow {
  invoiceId: number; invoiceNumber: string; bookingId: number | null; customer: string; space: string; location: string;
  issuedOn: string | null; dueOn: string | null;
  /** GrandTotal; paid = PaidTotal; balance = still owed (GrandTotal - WHT - paid) of an open invoice, else 0. */
  total: number; paid: number; wht: number; balance: number;
  isOpen: boolean; isPaid: boolean; daysOverdue: number; status: string;
}
export interface OverviewBookingRow {
  bookingId: number; customer: string; space: string; spaceType: string; location: string;
  createdOn: string | null; startOn: string | null; endOn: string | null; status: string; totalAmount: number; seats: number | null;
}
export interface OverviewSpaceRow {
  spaceId: number; name: string; spaceType: string; location: string; capacity: number | null; occupied: boolean;
  bookingId: number | null; customer: string; bookingStartOn: string | null; bookingEndOn: string | null; status: string;
  bookingCount: number;
}

export interface OverviewDetails {
  kind: string;
  records: OverviewDetailRecords;
  title: string;
  /** Every matching record; rows holds the first 200 (spaces: 500). */
  total: number;
  /** Invoices: invoiced (GrandTotal) of all; bookings: their TotalAmount. */
  amount: number;
  /** Invoices: invoiced and now paid (the chart's Paid). */
  paidAmount: number;
  /** Invoices: still owed (the aging amount). */
  balance: number;
  /** Spaces: in use at the moment the list is for, of totalSpaces active spaces. */
  occupied: number;
  totalSpaces: number;
  rows: (OverviewInvoiceRow | OverviewBookingRow | OverviewSpaceRow)[];
}

/** Shown when the API says the database update is missing and gives no wording of its own. */
export const OVERVIEW_DETAILS_DB_MESSAGE = 'Database update needed: run the script DASH_02_main_dashboard_drilldown_TEST.';

const WORDING: DashErrorWording = { name: 'dashboard details', dbMessage: OVERVIEW_DETAILS_DB_MESSAGE };

const flag = (v: unknown): boolean => v === true || v === 1 || str(v).toLowerCase() === 'true';

@Injectable({ providedIn: 'root' })
export class DashboardDetailsService {
  private http = inject(HttpClient);
  private api = environment.apiUrl;

  /**
   * GET api/dashboard/overview-details/{kind}. params: locationIds (comma-separated), period, from / to (yyyy-MM-dd,
   * both or neither), month (yyyy-MM), bucket, spaceType, customer; empty values are left out.
   */
  getDetails(kind: OverviewDetailKind, params: DashParams): Observable<OverviewDetails> {
    return getDashboardData(this.http, `${this.api}/dashboard/overview-details/${kind}`, params, err => DashboardDetailsService.describeError(err))
      .pipe(map(d => this.toDetails(d)));
  }

  /** Wording for a failed request; a missing database update shows the API's own message (it names the script). */
  static describeError(err: unknown): DashError {
    const described = !!err && typeof err === 'object' && 'needsDbUpdate' in err;
    const e = describeDashboardError(err, WORDING);
    return e.needsDbUpdate && !described ? { ...e, message: serverMessageOf(err) ?? e.message } : e;
  }

  private toDetails(raw: unknown): OverviewDetails {
    const d = obj(raw) ?? {};
    const records = (['invoices', 'bookings', 'spaces'].includes(str(d.records)) ? str(d.records) : 'invoices') as OverviewDetailRecords;
    const rows = arr(d.rows, (r: any) => records === 'invoices' ? this.toInvoice(r) : records === 'bookings' ? this.toBooking(r) : this.toSpace(r));
    return {
      kind: str(d.kind), records, title: str(d.title), total: Math.max(num(d.total), rows.length),
      amount: num(d.amount), paidAmount: num(d.paidAmount), balance: num(d.balance),
      occupied: num(d.occupied), totalSpaces: num(d.totalSpaces), rows
    };
  }

  private toInvoice(r: any): OverviewInvoiceRow {
    return {
      invoiceId: num(r.invoiceId), invoiceNumber: str(r.invoiceNumber) || (r.invoiceId ? `#${r.invoiceId}` : ''),
      bookingId: numOrNull(r.bookingId), customer: str(r.customer) || 'Customer', space: str(r.space), location: str(r.location),
      issuedOn: strOrNull(r.issuedOn), dueOn: strOrNull(r.dueOn),
      total: num(r.total), paid: num(r.paid), wht: num(r.wht), balance: num(r.balance),
      isOpen: flag(r.isOpen), isPaid: flag(r.isPaid), daysOverdue: num(r.daysOverdue), status: str(r.status)
    };
  }

  private toBooking(r: any): OverviewBookingRow {
    return {
      bookingId: num(r.bookingId), customer: str(r.customer) || 'Customer', space: str(r.space), spaceType: str(r.spaceType),
      location: str(r.location), createdOn: strOrNull(r.createdOn), startOn: strOrNull(r.startOn), endOn: strOrNull(r.endOn),
      status: str(r.status), totalAmount: num(r.totalAmount), seats: numOrNull(r.seats)
    };
  }

  private toSpace(r: any): OverviewSpaceRow {
    return {
      spaceId: num(r.spaceId), name: str(r.name) || `Space ${num(r.spaceId)}`, spaceType: str(r.spaceType), location: str(r.location),
      capacity: numOrNull(r.capacity), occupied: flag(r.occupied), bookingId: numOrNull(r.bookingId), customer: str(r.customer),
      bookingStartOn: strOrNull(r.bookingStartOn), bookingEndOn: strOrNull(r.bookingEndOn), status: str(r.status),
      bookingCount: num(r.bookingCount)
    };
  }
}

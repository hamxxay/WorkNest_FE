import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../environments/environment';
import { CeoError, CeoPeriod, CeoService, CeoShift, normalizeShift } from './ceo.service';
import {
  DashParams, DashRange, arr, drillPeriodQuery, getDashboardData, num, numOrNull, obj, periodOf, periodQuery, rangeOf, str, strOrNull
} from './dashboard-api';

// ============================================================
// CEO dashboard, Discounts section (GET api/ceo/discounts and api/ceo/discounts/records/{kind}, read-only, database
// update DD_01). Discount a month of a booking = how far it was sold below its expected price (24/7: the room's list
// price x seats; Morning / Evening: that price less the location's shift discount; only what the Rooms section calls
// "under") + its fixed PKR discount a month. Invoices: the discount on the invoices whose billing period starts in the
// period (real money, it lowered the invoice total), shown on its own. Every response is normalised here.
// ============================================================

export type CeoPricingKey = 'under' | 'at' | 'over' | 'unpriced';

export interface CeoDiscountSummary {
  bookings: number; priced: number; unpriced: number; discounted: number;
  expectedMonthly: number; baseMonthly: number; soldMonthly: number;
  discountMonthly: number; discountPct: number; averageDiscountPct: number;
  belowPriceMonthly: number; belowPriceBookings: number; fixedMonthly: number; fixedBookings: number;
  newBookings: number; newDiscounted: number; newDiscountMonthly: number;
  invoiceDiscount: number; invoicesDiscounted: number; invoiceDiscountPaid: number;
}

/** A location, a seller or a shift (key null: no location / no salesperson recorded). */
export interface CeoDiscountGroup {
  key: string | null; name: string; role: string | null;
  bookings: number; discounted: number; baseMonthly: number; discountMonthly: number; discountPct: number; largestMonthly: number;
  invoiceDiscount: number; invoicesDiscounted: number;
}

export interface CeoDiscountBooking {
  bookingId: number; customer: string; spaceId: number; room: string; code: string; locationId: number | null; location: string;
  spaceType: string; shift: CeoShift; seats: number; startOn: string | null; endOn: string | null; startedInPeriod: boolean;
  listSeatPrice: number | null; listMonthly: number | null; shiftDiscountCapPct: number; expectedMonthly: number | null;
  rentMonthly: number; soldMonthly: number; pricing: CeoPricingKey; belowPriceMonthly: number; fixedMonthly: number;
  discountMonthly: number; discountPct: number; baseMonthly: number; bookingDiscountPct: number;
  sellerId: number | null; seller: string | null; sellerRole: string | null;
}

export interface CeoDiscountInvoice {
  invoiceId: number; invoiceNumber: string; bookingId: number | null; customer: string; locationId: number | null; location: string;
  room: string; issuedOn: string | null; subTotal: number; discount: number; total: number; status: string; paid: boolean;
  /** CP_02: the billing period (yyyy-MM-dd) that places the invoice in the period; null before CP_02 / when not set. */
  periodStart: string | null; periodEnd: string | null;
}

export interface CeoDiscounts {
  /** false: the database update DD_01 has not run; only `message` is set. */
  available: boolean;
  message: string;
  period: CeoPeriod;
  periodLabel: string;
  generatedAt: string | null;
  range: DashRange | null;
  summary: CeoDiscountSummary;
  byLocation: CeoDiscountGroup[];
  bySeller: CeoDiscountGroup[];
  byShift: CeoDiscountGroup[];
  biggest: CeoDiscountBooking[];
}

export type CeoDiscountRecordKind = 'bookings' | 'invoices';

export interface CeoDiscountRecords<R = CeoDiscountBooking | CeoDiscountInvoice> {
  title: string; total: number; discountTotal: number; baseTotal: number; discountPct: number; rows: R[];
}

/** Shown when the API answers without a message (it always sends one). */
export const DISCOUNTS_NOT_SET_UP = 'Database update needed: run the script DD_01_ceo_discounts_TEST to see the discounts.';

const SHIFTS: CeoShift[] = ['24/7', 'Morning', 'Evening'];

export function emptyDiscountSummary(): CeoDiscountSummary {
  return {
    bookings: 0, priced: 0, unpriced: 0, discounted: 0, expectedMonthly: 0, baseMonthly: 0, soldMonthly: 0, discountMonthly: 0,
    discountPct: 0, averageDiscountPct: 0, belowPriceMonthly: 0, belowPriceBookings: 0, fixedMonthly: 0, fixedBookings: 0,
    newBookings: 0, newDiscounted: 0, newDiscountMonthly: 0, invoiceDiscount: 0, invoicesDiscounted: 0, invoiceDiscountPaid: 0
  };
}

const pctOf = (part: number, whole: number) => (whole > 0 ? Math.round((part * 1000) / whole) / 10 : 0);
const intOrNull = (v: unknown): number | null => { const n = numOrNull(v); return n === null ? null : Math.trunc(n); };

export function toDiscountGroup(x: any): CeoDiscountGroup {
  const discountMonthly = Math.max(0, num(x?.discountMonthly));
  const baseMonthly = Math.max(0, num(x?.baseMonthly));
  return {
    key: strOrNull(x?.key), name: str(x?.name) || '-', role: strOrNull(x?.role),
    bookings: num(x?.bookings), discounted: num(x?.discounted), baseMonthly, discountMonthly,
    discountPct: numOrNull(x?.discountPct) ?? pctOf(discountMonthly, baseMonthly),
    largestMonthly: num(x?.largestMonthly), invoiceDiscount: num(x?.invoiceDiscount), invoicesDiscounted: num(x?.invoicesDiscounted)
  };
}

export function toDiscountBooking(x: any): CeoDiscountBooking {
  const below = Math.max(0, num(x?.belowPriceMonthly));
  const fixed = Math.max(0, num(x?.fixedMonthly));
  const discountMonthly = numOrNull(x?.discountMonthly) ?? below + fixed;
  const baseMonthly = num(x?.baseMonthly);
  const pricing = str(x?.pricing).toLowerCase();
  return {
    bookingId: num(x?.bookingId), customer: str(x?.customer) || '-', spaceId: num(x?.spaceId), room: str(x?.room), code: str(x?.code),
    locationId: intOrNull(x?.locationId), location: str(x?.location), spaceType: str(x?.spaceType), shift: normalizeShift(x?.shift),
    seats: num(x?.seats), startOn: strOrNull(x?.startOn), endOn: strOrNull(x?.endOn), startedInPeriod: x?.startedInPeriod === true,
    listSeatPrice: numOrNull(x?.listSeatPrice), listMonthly: numOrNull(x?.listMonthly), shiftDiscountCapPct: num(x?.shiftDiscountCapPct),
    expectedMonthly: numOrNull(x?.expectedMonthly), rentMonthly: num(x?.rentMonthly), soldMonthly: num(x?.soldMonthly),
    pricing: pricing === 'under' || pricing === 'at' || pricing === 'over' ? pricing : 'unpriced',
    belowPriceMonthly: below, fixedMonthly: fixed, discountMonthly,
    discountPct: numOrNull(x?.discountPct) ?? pctOf(discountMonthly, baseMonthly), baseMonthly,
    bookingDiscountPct: num(x?.bookingDiscountPct),
    sellerId: intOrNull(x?.sellerId), seller: strOrNull(x?.seller), sellerRole: strOrNull(x?.sellerRole)
  };
}

export function toDiscountInvoice(x: any): CeoDiscountInvoice {
  return {
    invoiceId: num(x?.invoiceId), invoiceNumber: str(x?.invoiceNumber), bookingId: intOrNull(x?.bookingId), customer: str(x?.customer) || '-',
    locationId: intOrNull(x?.locationId), location: str(x?.location), room: str(x?.room), issuedOn: strOrNull(x?.issuedOn),
    subTotal: num(x?.subTotal), discount: num(x?.discount), total: num(x?.total), status: str(x?.status), paid: x?.paid === true,
    periodStart: strOrNull(x?.periodStart), periodEnd: strOrNull(x?.periodEnd)
  };
}

/**
 * GET api/ceo/discounts (data of the { isSuccessful, data } envelope) as the page uses it: every field defaulted, the
 * shifts always 24/7, Morning, Evening. available: false (DD_01 not run) keeps only the message.
 */
export function toCeoDiscounts(raw: unknown, period: CeoPeriod): CeoDiscounts {
  const d = obj(raw);
  const head = {
    period: periodOf<CeoPeriod>(d?.period, period),
    periodLabel: str(d?.periodLabel),
    generatedAt: strOrNull(d?.generatedAt),
    range: rangeOf(d)
  };
  const off = !d || d.available === false || d.available === 0 || str(d.available).toLowerCase() === 'false';
  const empty = { summary: emptyDiscountSummary(), byLocation: [], bySeller: [], byShift: [], biggest: [] };
  if (off) return { available: false, message: str(d?.message) || DISCOUNTS_NOT_SET_UP, ...head, ...empty };

  const s = obj(d.summary) ?? {};
  const base = emptyDiscountSummary();
  const summary = Object.fromEntries(Object.keys(base).map(k => [k, num(s[k])])) as unknown as CeoDiscountSummary;
  const sentShifts = new Map(arr(d.byShift, toDiscountGroup).map(g => [normalizeShift(g.key ?? g.name), g]));
  return {
    available: true, message: '', ...head,
    summary,
    byLocation: arr(d.byLocation, toDiscountGroup),
    bySeller: arr(d.bySeller, toDiscountGroup),
    byShift: SHIFTS.map(sh => sentShifts.get(sh) ?? { ...toDiscountGroup({ key: sh, name: sh }) }),
    biggest: arr(d.biggest, toDiscountBooking).sort((a, b) => b.discountMonthly - a.discountMonthly)
  };
}

export function toDiscountRecords(kind: CeoDiscountRecordKind, raw: unknown): CeoDiscountRecords {
  const d = obj(raw) ?? {};
  const rows = kind === 'invoices' ? arr(d.rows, toDiscountInvoice) : arr(d.rows, toDiscountBooking);
  return {
    title: str(d.title), total: numOrNull(d.total) ?? rows.length,
    discountTotal: num(d.discountTotal), baseTotal: num(d.baseTotal), discountPct: num(d.discountPct), rows
  };
}

@Injectable({ providedIn: 'root' })
export class CeoDiscountsService {
  private http = inject(HttpClient);
  private api = environment.apiUrl;

  /** GET api/ceo/discounts: the section for one period (a custom one as from / to) and location. */
  getDiscounts(period: CeoPeriod, locationId: number | null, range: DashRange | null = null): Observable<CeoDiscounts> {
    return this.get(`${this.api}/ceo/discounts`, { ...periodQuery(period, range), locationId }).pipe(map(d => toCeoDiscounts(d, period)));
  }

  /**
   * GET api/ceo/discounts/records/{kind}: bookings (the discounted ones, biggest first; locationId id | none, sellerId
   * id | none, shift, newOnly) or invoices (with a discount, billing period starting in the period). A custom period goes as periodFrom /
   * periodTo, as the other drill-downs.
   */
  getRecords(kind: CeoDiscountRecordKind, period: CeoPeriod, range: DashRange | null, params: DashParams): Observable<CeoDiscountRecords> {
    return this.get(`${this.api}/ceo/discounts/records/${kind}`, { ...drillPeriodQuery(period, range), ...params })
      .pipe(map(d => toDiscountRecords(kind, d)));
  }

  static describeError(err: unknown): CeoError {
    return CeoService.describeError(err);
  }

  private get(url: string, params: DashParams): Observable<any> {
    return getDashboardData(this.http, url, params, err => CeoService.describeError(err));
  }
}

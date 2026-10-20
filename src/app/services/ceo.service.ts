import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  DashError, DashErrorWording, DashParams, DashRange, arr, conversionOf, describeDashboardError, getDashboardData, num, numOrNull, obj,
  percent, periodOf, periodQuery, rangeOf, str, strOrNull
} from './dashboard-api';

// ============================================================
// CEO dashboard API (GET api/ceo/*, read-only). Shared contract with the API and the mobile app:
// dashboard -> breakdown (drill level 2) -> records (drill level 3), the rooms report (rooms), plus the
// existing GET api/dashboard/forecast for the 3-month outlook. Every response is normalised here, so a
// missing field shows as an empty state on the page instead of breaking it.
// ============================================================

/** custom: a day range (from / to, API CS_01), compared with the same number of days just before it. */
export type CeoPeriod = 'month' | 'quarter' | 'year' | 'custom';

export interface CeoLocation { locationId: number; name: string; }

export interface CeoMoneyMonth { month: string; invoiced: number; collected: number; }
export interface CeoAging { bucket: string; label: string; amount: number; count: number; }
export interface CeoTopCustomer { customerId: number; name: string; amount: number; invoices: number; }
export interface CeoMoney {
  invoiced: number; invoicedPrev: number;
  collected: number; collectedPrev: number;
  /** Unpaid now, without the invoices billed in advance (as the aging buckets). */
  outstanding: number; outstandingCount: number;
  overdue: number; overdueCount: number;
  /**
   * Unpaid invoices for a billing period that has not started yet (and not past due), kept out of outstanding; null
   * when the API did not send them (before the database update CP_01: the page then leaves the figure out).
   */
  billedInAdvance: number | null; billedInAdvanceCount: number | null;
  /**
   * Collected / invoiced in the period, % (0-100). Invoiced, collected, the 12 months and the top customers place an
   * invoice in the month its billing period starts (CP_01; before it, the month it was issued).
   */
  collectionRate: number;
  /** Last 12 months, oldest first. */
  months: CeoMoneyMonth[];
  /** not_due, 1_30, 31_60, 61_90, 90_plus */
  aging: CeoAging[];
  /** Top 5 by amount invoiced, last 12 months. */
  topCustomers: CeoTopCustomer[];
}

export interface CeoOccupancyMonth { month: string; occupancyPct: number; newBookings: number; }
export interface CeoOccupancyType { spaceTypeId: number; name: string; total: number; occupied: number; }
export interface CeoOccupancyLocation { locationId: number; name: string; total: number; occupied: number; }
export interface CeoLeaseExpiring {
  bookingId: number; customer: string; space: string; location: string; endOn: string; monthlyAmount: number;
}
export interface CeoOccupancy {
  totalSpaces: number; occupiedSpaces: number;
  occupancyPct: number; occupancyPctPrev: number;
  activeBookings: number; newBookings: number; newBookingsPrev: number;
  months: CeoOccupancyMonth[];
  byType: CeoOccupancyType[];
  byLocation: CeoOccupancyLocation[];
  /** Next 90 days, soonest first (the API sends the first 50). */
  leasesExpiring: CeoLeaseExpiring[];
  /**
   * Every lease ending in the next 90 days and their monthly rent; null when the API did not send them (before the
   * database update QA_07: only the list is known, and the full list (records/leases) cannot be opened yet).
   */
  leasesExpiringCount: number | null;
  leasesExpiringMonthly: number | null;
}

export type CeoFunnelStageKey = 'inquiries' | 'quotations' | 'accepted' | 'bookings';
export interface CeoFunnelStage { stage: string; label: string; count: number; }
export interface CeoInquiryType { type: string; label: string; count: number; }
export interface CeoSales {
  funnel: CeoFunnelStage[];
  /** Quotations created in the period that were booked / quotations created in the period, % (0-100, never above). */
  conversionRate: number;
  /** Quotations created in the period (the funnel's quotations stage). */
  quotations: number;
  /**
   * Quotations created in the period that were booked (never more than the quotations). An older API does not send
   * it: then the period's bookings, at most one per quotation.
   */
  quotationsBooked: number;
  inquiriesByType: CeoInquiryType[];
  quotationValue: number;
  bookingValue: number;
  /**
   * Tour inquiries follow the location filter by their branch. True when a location is chosen but the inquiry
   * figures (funnel stage, by type) still count every location: the database update QA_07 has not run, or an older
   * API that never narrowed them (no flag sent). The page then labels them "all locations".
   */
  inquiriesAllLocations: boolean;
}

/** A location: its sales executives and the quotations made on its spaces in the period (by anyone, as the funnel). */
export interface CeoTeamLocation {
  locationId: number; name: string; salesExecutives: number; quotations: number; converted: number;
}
/**
 * A sales executive (the API sends no other role). revenue = the dashboard's converted value: the total of the
 * quotations they created in the period that were converted to a booking (PKR).
 */
export interface CeoPerson {
  userId: number; name: string; role: string; locations: string; quotations: number; converted: number; revenue: number;
}
/** Team section: only the sales executives (filtered by the API), highest revenue first, and their totals. */
export interface CeoTeam { perLocation: CeoTeamLocation[]; people: CeoPerson[]; salesExecutives: number; revenue: number; }

export interface CeoDashboard {
  period: CeoPeriod;
  periodLabel: string;
  generatedAt: string | null;
  /** A custom period: the range the figures cover, and the one the "previous" figures cover; else null. */
  range: DashRange | null;
  previousRange: DashRange | null;
  locations: CeoLocation[];
  /** null when the API sent no such section (the page shows an empty state). */
  money: CeoMoney | null;
  occupancy: CeoOccupancy | null;
  sales: CeoSales | null;
  team: CeoTeam | null;
}

// ---------- Drill-down level 2 ----------
export type CeoMetric =
  | 'revenue' | 'aging' | 'occupancy-type' | 'occupancy-location' | 'bookings-month' | 'inquiries-type' | 'staff';
/**
 * Level 2 lists the dashboard builds from its own figures (no request): the months of the period (invoiced /
 * collected), the receivables aging buckets, occupancy by location. Their rows lead to the API breakdowns above.
 */
export type CeoLocalMetric = 'revenue-months' | 'aging-buckets' | 'occupancy-locations';

export interface CeoBreakdownRow {
  key: string; label: string; value: number; value2: number | null; count: number | null;
}
export interface CeoBreakdown {
  title: string; subtitle: string; valueLabel: string; value2Label: string | null; rows: CeoBreakdownRow[];
}

// ---------- Drill-down level 3 ----------
export type CeoRecordKind = 'invoices' | 'spaces' | 'bookings' | 'inquiries' | 'quotations' | 'leases';

export interface CeoInvoiceRecord {
  invoiceId: number; invoiceNumber: string; customer: string; location: string;
  issuedOn: string | null;
  /**
   * The billing period the invoice is for (yyyy-MM-dd); left out when the API does not send them (before the
   * database update CP_01), null when the invoice has none: the list then shows the issue date.
   */
  periodStart?: string | null; periodEnd?: string | null;
  dueOn: string | null; total: number; paid: number; balance: number; status: string;
}
export interface CeoSpaceRecord {
  spaceId: number; name: string; spaceType: string; location: string; capacity: number | null;
  occupied: boolean; customer: string; bookingEndOn: string | null;
}
export interface CeoBookingRecord {
  bookingId: number; customer: string; space: string; location: string;
  startOn: string | null; endOn: string | null; status: string; totalAmount: number;
}
export interface CeoInquiryRecord {
  inquiryId: number; name: string; phone: string; type: string; referenceName: string;
  status: string; createdOn: string | null; feedback: string;
}
export interface CeoQuotationRecord {
  quotationId: number; quotationNumber: string; customer: string; location: string;
  createdBy: string; status: string; total: number; createdOn: string | null;
}
/** records/leases (QA_07): a confirmed lease ending in the window, soonest first. */
export interface CeoLeaseRecord {
  bookingId: number; customer: string; space: string; location: string; endOn: string | null; monthlyAmount: number;
  /** Days from today to the end date (negative = already ended); null when not known. */
  daysLeft: number | null;
}
export interface CeoRecordRowMap {
  invoices: CeoInvoiceRecord; spaces: CeoSpaceRecord; bookings: CeoBookingRecord;
  inquiries: CeoInquiryRecord; quotations: CeoQuotationRecord; leases: CeoLeaseRecord;
}
export interface CeoRecords<K extends CeoRecordKind = CeoRecordKind> {
  title: string;
  /** Full count; rows holds at most 200 (newest first). */
  total: number;
  rows: CeoRecordRowMap[K][];
}

// ---------- 3-month outlook (GET api/dashboard/forecast) ----------
export interface CeoForecastMonth {
  month: string; label: string;
  expectedRent: number; confirmedRent: number;
  totalSpaces: number; occupiedSpaces: number; occupancyPct: number;
  leasesEnding: number; leasesStarting: number;
}

// ---------- Rooms report (GET api/ceo/rooms, database update CEO_02) ----------

/** A booking's shift: 24/7 is compared with the list price, Morning / Evening with the list less the shift's cap. */
export type CeoShift = '24/7' | 'Morning' | 'Evening';
export const CEO_SHIFTS: readonly CeoShift[] = ['24/7', 'Morning', 'Evening'];
/**
 * Sold per seat against the expected per seat (0.5% either way counts as "at"); unpriced = the room has no list
 * price, so the sale cannot be judged ("No list price").
 */
export type CeoPricing = 'under' | 'at' | 'over' | 'unpriced';

/** One confirmed booking on a room that overlaps the period. Money is PKR a month. */
export interface CeoRoomSale {
  bookingId: number;
  customer: string;
  shift: CeoShift;
  seatsSold: number;
  startOn: string | null;
  endOn: string | null;
  /** The booking's own price row, else today's list per seat (0 = none). */
  listSeatPriceAtSale: number;
  /** The location's stored cap for the shift; applied to Morning / Evening only (24/7 is compared with the full list). */
  shiftDiscountCapPct: number;
  /** Expected per seat and a month; 0 for an unpriced sale (as its variance figures). */
  expectedSeatPrice: number;
  expectedMonthly: number;
  soldMonthly: number;
  soldSeatPrice: number;
  /** Sold less expected, a month (negative = under). */
  varianceMonthly: number;
  /** Sold per seat vs expected, % (-12.5 = 12.5% under). */
  variancePct: number;
  pricing: CeoPricing;
  /** CP_02: the booking's fixed PKR discount a month, already off soldMonthly (0 when none / before CP_02). */
  fixedMonthly: number;
}

/** A private office or shared space (sold monthly). */
export interface CeoRoom {
  spaceId: number;
  name: string;
  code: string;
  locationId: number;
  location: string;
  spaceType: string;
  categoryCode: string;
  seats: number;
  /** Today's monthly list price per seat; the room's = per seat x seats. */
  listSeatPrice: number;
  listRoomPrice: number;
  occupiedNow: boolean;
  /** Days of the period so far with a confirmed booking, % (0-100). */
  periodOccupancyPct: number;
  /** The days behind periodOccupancyPct (null when the API does not send them). */
  occupiedDays: number | null;
  periodDays: number | null;
  sales: CeoRoomSale[];
  /** CP_02: start (yyyy-MM-dd) of the next confirmed booking that starts after the period; null when none. */
  upcomingStartOn: string | null;
}

/** Occupancy of one room category (private offices, shared spaces): the API's summary.byCategory. */
export interface CeoRoomCategory {
  /** WN_SpaceCategories.Code: PrivateOffice | SharedSpace ('' = rooms without one). */
  categoryCode: string;
  /** The category's label from the database (e.g. "Private Office"). */
  label: string;
  rooms: number; occupiedNow: number; vacantNow: number;
  /** Occupied now / rooms, %. */
  occupancyNowPct: number;
  /** Days occupied: room-days with a confirmed booking / room-days of the period so far, %. */
  periodOccupancyPct: number;
}

export interface CeoShiftSummary {
  shift: CeoShift;
  /** sales = under + at + over + unpriced */
  sales: number; under: number; at: number; over: number; unpriced: number;
  expectedMonthly: number; soldMonthly: number; varianceMonthly: number;
}

export interface CeoRoomsSummary {
  rooms: number; occupiedNow: number; vacantNow: number;
  occupancyNowPct: number; periodOccupancyPct: number;
  /** sales = under + at + over + unpriced (no list price) */
  sales: number; under: number; at: number; over: number; unpriced: number;
  /** Expected monthly of the sales (list, less the shift cap for Morning / Evening). */
  listMonthly: number;
  soldMonthly: number;
  /** Net: sold less expected. */
  varianceMonthly: number;
  /** What the under-priced sales miss a month, as a positive amount (the API's underMonthly is <= 0). */
  underGapMonthly: number;
  /** What the over-priced sales add a month (overMonthly). */
  overPremiumMonthly: number;
  /** Always 24/7, Morning, Evening (in that order). */
  byShift: CeoShiftSummary[];
  /**
   * Always Private Office then Shared Space (zeros when there are none), then any other category the rooms carry;
   * the same rooms as the totals above, so they add up to them.
   */
  byCategory: CeoRoomCategory[];
}

export interface CeoRooms {
  /** False before the database update CEO_02: only `message` is shown. */
  available: boolean;
  message: string;
  period: CeoPeriod;
  periodLabel: string;
  generatedAt: string | null;
  /** A custom period: the range the report covers; else null. */
  range: DashRange | null;
  summary: CeoRoomsSummary;
  /** By location, then room code / name. */
  rooms: CeoRoom[];
}

/** Shown when the API says the room report is not set up and sends no message of its own. */
export const ROOMS_NOT_SET_UP = 'Run CEO_02_room_report on the database to see the room report.';

/**
 * A booking's shift as the CEO pages show it (WN_Bookings.ShiftType: '24/7', '24_7', '24/7-I8', empty -> 24/7;
 * 'morning...', 'shift_morning' -> Morning; 'evening', 'night', 'shift_evening' -> Evening).
 */
export function normalizeShift(value: unknown): CeoShift {
  const s = str(value).trim().toLowerCase();
  if (!s) return '24/7';
  if (/^(shift_)?morning/.test(s)) return 'Morning';
  if (/evening|night/.test(s)) return 'Evening';
  return '24/7';
}

/**
 * Under / at / over: the API's word, else sold per seat against expected (more than 0.5% either way); unpriced when
 * there is no expected price to compare with.
 */
export function pricingOf(raw: unknown, soldSeatPrice: number, expectedSeatPrice: number): CeoPricing {
  const word = str(raw).trim().toLowerCase();
  if (word === 'under' || word === 'at' || word === 'over' || word === 'unpriced') return word;
  if (!(expectedSeatPrice > 0)) return 'unpriced';
  const diff = soldSeatPrice / expectedSeatPrice - 1;
  return diff < -0.005 ? 'under' : diff > 0.005 ? 'over' : 'at';
}

/** A % that may arrive as a fraction (-0.125) or a percentage (-12.5): whichever is nearer the computed one. */
function pctNear(raw: unknown, computed: number): number {
  const r = num(raw);
  return Math.abs(r * 100 - computed) < Math.abs(r - computed) ? r * 100 : r;
}

const flag = (v: unknown): boolean => v === true || v === 1 || str(v).toLowerCase() === 'true' || v === '1';
const clampPct = (n: number): number => Math.min(100, Math.max(0, n));
const sumOf = <T>(xs: T[], f: (x: T) => number): number => xs.reduce((a, x) => a + f(x), 0);

function toRoomSale(s: any, room: { seats: number; listSeatPrice: number }): CeoRoomSale {
  const shift = normalizeShift(s.shift ?? s.shiftRaw);
  const seatsSold = num(s.seatsSold) > 0 ? num(s.seatsSold) : room.seats;
  const perSeat = (monthly: number) => (seatsSold > 0 ? monthly / seatsSold : monthly);
  const soldMonthly = num(s.soldMonthly);
  const soldSeatPrice = numOrNull(s.soldSeatPrice) ?? perSeat(soldMonthly);
  const listSeatPriceAtSale = numOrNull(s.listSeatPriceAtSale) ?? room.listSeatPrice;
  const cap = num(s.shiftDiscountCapPct);
  const base = {
    bookingId: num(s.bookingId), customer: str(s.customer) || 'Customer', shift, seatsSold,
    startOn: strOrNull(s.startOn), endOn: strOrNull(s.endOn), listSeatPriceAtSale, shiftDiscountCapPct: cap,
    soldMonthly, soldSeatPrice, fixedMonthly: Math.max(0, num(s.fixedMonthly))
  };
  // No list price: the API sends pricing and the expected / variance figures as null; nothing to compare with.
  const sentUnpriced = str(s.pricing).toLowerCase() === 'unpriced'
    || ('pricing' in s && s.pricing == null && 'expectedSeatPrice' in s && s.expectedSeatPrice == null);
  if (sentUnpriced) {
    return { ...base, expectedSeatPrice: 0, expectedMonthly: 0, varianceMonthly: 0, variancePct: 0, pricing: 'unpriced' };
  }
  const expectedSeatPrice = numOrNull(s.expectedSeatPrice)
    ?? (shift === '24/7' ? listSeatPriceAtSale : listSeatPriceAtSale * (1 - cap / 100));
  const expectedMonthly = numOrNull(s.expectedMonthly) ?? expectedSeatPrice * (seatsSold || 1);
  const pricing = pricingOf(s.pricing, soldSeatPrice, expectedSeatPrice);
  if (pricing === 'unpriced') {
    return { ...base, expectedSeatPrice: 0, expectedMonthly: 0, varianceMonthly: 0, variancePct: 0, pricing };
  }
  const computedPct = expectedSeatPrice > 0 ? (soldSeatPrice / expectedSeatPrice - 1) * 100 : 0;
  return {
    ...base, expectedSeatPrice, expectedMonthly,
    varianceMonthly: numOrNull(s.varianceMonthly) ?? (soldSeatPrice - expectedSeatPrice) * (seatsSold || 1),
    variancePct: numOrNull(s.variancePct) === null ? computedPct : pctNear(s.variancePct, computedPct),
    pricing
  };
}

function toRoom(r: any): CeoRoom {
  const seats = Math.max(0, num(r.seats ?? r.capacity));
  const listSeatPrice = num(r.listSeatPrice);
  const spaceId = num(r.spaceId);
  const occupiedDays = numOrNull(r.occupiedDays);
  const periodDays = numOrNull(r.periodDays);
  const sentPct = numOrNull(r.periodOccupancyPct);
  return {
    spaceId, name: str(r.name) || str(r.code) || `Room ${spaceId}`, code: str(r.code),
    locationId: num(r.locationId), location: str(r.location), spaceType: str(r.spaceType), categoryCode: str(r.categoryCode),
    seats, listSeatPrice, listRoomPrice: numOrNull(r.listRoomPrice) ?? listSeatPrice * seats,
    occupiedNow: flag(r.occupiedNow),
    periodOccupancyPct: clampPct(sentPct ?? (occupiedDays !== null && periodDays ? (occupiedDays / periodDays) * 100 : 0)),
    occupiedDays, periodDays,
    sales: arr(r.sales, (s: any) => toRoomSale(s, { seats, listSeatPrice })),
    upcomingStartOn: strOrNull(r.upcomingStartOn)
  };
}

// ---------- room categories (private offices, shared spaces) ----------

/** The categories of the report's rooms, in the order the cards show them (always both, as the API). */
export const ROOM_CATEGORIES: readonly string[] = ['PrivateOffice', 'SharedSpace'];

/**
 * A category's label only when the API sends none (an API from before byCategory): the words of its code
 * ("PrivateOffice" -> "Private Office"), "Other" for rooms without one. The API's label (the database's) always wins.
 */
export function roomCategoryLabel(code: string): string {
  const c = (code || '').trim();
  if (!c) return 'Other';
  return c.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, ch => ch.toUpperCase());
}

const sameCode = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** A room's category as the cards and the room map group it: a known code in the report's spelling, else as sent. */
export function roomCategoryOf(room: Pick<CeoRoom, 'categoryCode'>): string {
  const c = (room.categoryCode || '').trim();
  return ROOM_CATEGORIES.find(k => sameCode(k, c)) ?? c;
}

/**
 * Occupancy per category worked out from the rooms, by the API's rule: both report categories first (zeros when
 * there are none), then any other code; days occupied from the rooms' days (room-days), else their mean %.
 */
export function summarizeRoomCategories(rooms: CeoRoom[]): CeoRoomCategory[] {
  const codes = [...ROOM_CATEGORIES];
  for (const r of rooms) {
    const c = roomCategoryOf(r);
    if (!codes.some(k => sameCode(k, c))) codes.push(c);
  }
  return codes.map(code => {
    const g = rooms.filter(r => sameCode(roomCategoryOf(r), code));
    const occupied = g.filter(r => r.occupiedNow).length;
    const days = sumOf(g, r => r.periodDays ?? 0);
    return {
      categoryCode: code, label: roomCategoryLabel(code),
      rooms: g.length, occupiedNow: occupied, vacantNow: g.length - occupied,
      occupancyNowPct: ratioPct(occupied, g.length),
      periodOccupancyPct: g.length && g.every(r => r.periodDays)
        ? ratioPct(sumOf(g, r => r.occupiedDays ?? 0), days)
        : g.length ? sumOf(g, r => r.periodOccupancyPct) / g.length : 0
    };
  });
}

/** The API's byCategory (its labels and figures), a missing figure from the rooms; none sent = worked out from them. */
function categoriesOf(sent: unknown, calc: CeoRoomCategory[]): CeoRoomCategory[] {
  const rows = arr(sent, (x: any) => obj(x)).filter((x): x is Record<string, any> => !!x);
  if (!rows.length) return calc;
  return rows.map(x => {
    const code = str(x['categoryCode'] ?? x['code']).trim();
    const c = calc.find(k => sameCode(k.categoryCode, code));
    const n = (k: keyof CeoRoomCategory): number => numOrNull(x[k]) ?? (c ? (c[k] as number) : 0);
    return {
      categoryCode: c?.categoryCode ?? code,
      label: str(x['label']).trim() || c?.label || roomCategoryLabel(code),
      rooms: n('rooms'), occupiedNow: n('occupiedNow'), vacantNow: n('vacantNow'),
      occupancyNowPct: clampPct(n('occupancyNowPct')), periodOccupancyPct: clampPct(n('periodOccupancyPct'))
    };
  });
}

/** The summary worked out from the rooms (used for whatever the API leaves out). */
export function summarizeRooms(rooms: CeoRoom[]): CeoRoomsSummary {
  const sales = rooms.flatMap(r => r.sales);
  const occupied = rooms.filter(r => r.occupiedNow).length;
  const tally = (xs: CeoRoomSale[]) => ({
    sales: xs.length,
    under: xs.filter(s => s.pricing === 'under').length,
    at: xs.filter(s => s.pricing === 'at').length,
    over: xs.filter(s => s.pricing === 'over').length,
    unpriced: xs.filter(s => s.pricing === 'unpriced').length
  });
  return {
    rooms: rooms.length, occupiedNow: occupied, vacantNow: rooms.length - occupied,
    occupancyNowPct: ratioPct(occupied, rooms.length),
    periodOccupancyPct: rooms.length ? sumOf(rooms, r => r.periodOccupancyPct) / rooms.length : 0,
    ...tally(sales),
    listMonthly: sumOf(sales, s => s.expectedMonthly),
    soldMonthly: sumOf(sales, s => s.soldMonthly),
    varianceMonthly: sumOf(sales, s => s.varianceMonthly),
    underGapMonthly: Math.abs(sumOf(sales.filter(s => s.pricing === 'under'), s => Math.min(0, s.varianceMonthly))),
    overPremiumMonthly: sumOf(sales.filter(s => s.pricing === 'over'), s => Math.max(0, s.varianceMonthly)),
    byShift: CEO_SHIFTS.map(shift => {
      const xs = sales.filter(s => s.shift === shift);
      return {
        shift, ...tally(xs),
        expectedMonthly: sumOf(xs, s => s.expectedMonthly),
        soldMonthly: sumOf(xs, s => s.soldMonthly),
        varianceMonthly: sumOf(xs, s => s.varianceMonthly)
      };
    }),
    byCategory: summarizeRoomCategories(rooms)
  };
}

function ratioPct(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}

/**
 * GET api/ceo/rooms (data of the { isSuccessful, data } envelope) as the page uses it: every field defaulted, rooms
 * in location / code order, a sale's per-seat, expected and variance figures worked out when the API leaves them
 * out, and the summary filled from the rooms where it is missing. available: false (database update CEO_02 not
 * run) keeps only the message.
 */
export function toCeoRooms(raw: unknown, period: CeoPeriod): CeoRooms {
  const d = obj(raw);
  const head = {
    period: periodOf<CeoPeriod>(d?.period, period),
    periodLabel: str(d?.periodLabel),
    generatedAt: strOrNull(d?.generatedAt),
    range: rangeOf(d)
  };
  const off = !d || d.available === false || d.available === 0 || str(d.available).toLowerCase() === 'false';
  if (off) {
    return { available: false, message: str(d?.message) || ROOMS_NOT_SET_UP, ...head, summary: summarizeRooms([]), rooms: [] };
  }

  const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  const rooms = arr(d.rooms, toRoom)
    .sort((a, b) => byName(a.location, b.location) || byName(a.code || a.name, b.code || b.name));
  const calc = summarizeRooms(rooms);
  const s = obj(d.summary);
  if (!s) return { available: true, message: '', ...head, summary: calc, rooms };

  const pick = (k: keyof CeoRoomsSummary): number => numOrNull(s[k]) ?? (calc[k] as number);
  const sentShifts = new Map<CeoShift, any>();
  arr(s.byShift, (x: any) => x).forEach(x => sentShifts.set(normalizeShift(x.shift), x));
  return {
    available: true, message: '', ...head, rooms,
    summary: {
      rooms: pick('rooms'), occupiedNow: pick('occupiedNow'), vacantNow: pick('vacantNow'),
      occupancyNowPct: clampPct(pick('occupancyNowPct')), periodOccupancyPct: clampPct(pick('periodOccupancyPct')),
      sales: pick('sales'), under: pick('under'), at: pick('at'), over: pick('over'), unpriced: pick('unpriced'),
      listMonthly: pick('listMonthly'), soldMonthly: pick('soldMonthly'), varianceMonthly: pick('varianceMonthly'),
      // underMonthly is the gap as sent (<= 0); shown as a positive amount.
      underGapMonthly: Math.abs(numOrNull(s.underMonthly) ?? calc.underGapMonthly),
      overPremiumMonthly: Math.max(0, numOrNull(s.overMonthly) ?? calc.overPremiumMonthly),
      byShift: calc.byShift.map(c => {
        const x = sentShifts.get(c.shift);
        if (!x) return c;
        const n = (k: keyof CeoShiftSummary): number => numOrNull(x[k]) ?? (c[k] as number);
        return {
          shift: c.shift, sales: n('sales'), under: n('under'), at: n('at'), over: n('over'), unpriced: n('unpriced'),
          expectedMonthly: n('expectedMonthly'), soldMonthly: n('soldMonthly'), varianceMonthly: n('varianceMonthly')
        };
      }),
      byCategory: categoriesOf(s['byCategory'], calc.byCategory)
    }
  };
}

/** Query values; null / undefined / '' are left out of the request. */
export type CeoParams = DashParams;

/** A failed CEO request, worded for the page (needsDbUpdate: 503, the CEO database script has not been run yet). */
export type CeoError = DashError;

const CEO_WORDING: DashErrorWording = {
  name: 'CEO dashboard',
  dbMessage: 'The CEO dashboard needs the database update before it can show figures. Ask the WorkNest team to run the latest database script, then refresh this page.'
};

/** The CEO dashboard's own database update: a 503 naming it keeps the general wording above. */
const CEO_BASE_UPDATE = 'CEO_01';

/**
 * A later database update a 503 names ("The full list of leases expiring needs the database update QA_07."), from
 * the API's message; null for none or for the dashboard's own update (CEO_01).
 */
function laterUpdateOf(err: unknown): string | null {
  const e = err as any;
  const message = [e?.error?.message, e?.message].filter(m => typeof m === 'string').join(' ');
  // "CS_01_ceo_sales_dates_TEST.sql" names CS_01 too (no word boundary before its underscore).
  const update = /\b([A-Z]{2,4}_\d{2})(?![A-Za-z0-9])/i.exec(message)?.[1].toUpperCase() ?? null;
  return update && update !== CEO_BASE_UPDATE ? update : null;
}

/** Days from today to an ISO date (negative = past); null when there is no valid date. */
function daysFromToday(date: string | null): number | null {
  if (!date) return null;
  const d = new Date(date.length <= 10 ? date + 'T00:00:00' : date);
  if (isNaN(d.getTime())) return null;
  const t = new Date(); t.setHours(0, 0, 0, 0); d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - t.getTime()) / 86400000);
}

@Injectable({ providedIn: 'root' })
export class CeoService {
  private http = inject(HttpClient);
  private api = environment.apiUrl;

  /**
   * GET api/ceo/dashboard: every section of the CEO dashboard for one period (and optionally one location); a custom
   * period sends its range as from / to.
   */
  getDashboard(period: CeoPeriod, locationId: number | null, range: DashRange | null = null): Observable<CeoDashboard> {
    return this.get(`${this.api}/ceo/dashboard`, { ...periodQuery(period, range), locationId }).pipe(map(d => this.toDashboard(d, period)));
  }

  /** GET api/ceo/breakdown: drill-down level 2 (one row per location / space type / month). */
  getBreakdown(metric: CeoMetric, params: CeoParams): Observable<CeoBreakdown> {
    return this.get(`${this.api}/ceo/breakdown`, { ...params, metric }).pipe(map(d => this.toBreakdown(d)));
  }

  /**
   * GET api/ceo/records/{kind}: drill-down level 3 (read-only list, newest first, at most 200 rows). leases: every
   * confirmed lease ending in the next 90 days (or month / from / to), soonest first; needs QA_07 (503 before it).
   */
  getRecords<K extends CeoRecordKind>(kind: K, params: CeoParams): Observable<CeoRecords<K>> {
    return this.get(`${this.api}/ceo/records/${kind}`, params).pipe(map(d => this.toRecords(kind, d)));
  }

  /**
   * GET api/ceo/rooms: private offices and shared spaces with their occupancy (now and in the period) and every
   * confirmed booking in the period priced against the list (Morning / Evening against the shift price).
   * available: false until the database update CEO_02 is run.
   */
  getRooms(period: CeoPeriod, locationId: number | null, range: DashRange | null = null): Observable<CeoRooms> {
    return this.get(`${this.api}/ceo/rooms`, { ...periodQuery(period, range), locationId }).pipe(map(d => toCeoRooms(d, period)));
  }

  /** GET api/dashboard/forecast: expected rent and occupancy for the next months (all locations combined). */
  getForecast(locationId: number | null, months = 3): Observable<CeoForecastMonth[]> {
    return this.get(`${this.api}/dashboard/forecast`, { months, locationId }).pipe(
      map(d => arr(obj(d)?.totals, (m: any): CeoForecastMonth => ({
        month: str(m.month), label: str(m.label) || str(m.month),
        expectedRent: num(m.expectedRent), confirmedRent: num(m.confirmedRent),
        totalSpaces: num(m.totalSpaces), occupiedSpaces: num(m.occupiedSpaces), occupancyPct: num(m.occupancyPct),
        leasesEnding: num(m.leasesEnding), leasesStarting: num(m.leasesStarting)
      })))
    );
  }

  /**
   * Wording for a failed request (used by every section and drill level). A 503 naming a later database update
   * (QA_07 for the full list of leases expiring) names it; the dashboard's own (CEO_01) keeps the general wording.
   */
  static describeError(err: unknown): CeoError {
    if (err && typeof err === 'object' && 'needsDbUpdate' in (err as any) && 'title' in (err as any)) return err as CeoError;
    const e = describeDashboardError(err, CEO_WORDING);
    const update = e.needsDbUpdate ? laterUpdateOf(err) : null;
    return update
      ? { ...e, message: `This part of the CEO dashboard needs the database update ${update} before it can show it. Ask the WorkNest team to run it, then refresh this page.` }
      : e;
  }

  // ---------- transport ----------

  private get(url: string, params: CeoParams): Observable<any> {
    return getDashboardData(this.http, url, params, err => CeoService.describeError(err));
  }

  // ---------- normalising ----------

  private toDashboard(raw: any, period: CeoPeriod): CeoDashboard {
    const d = obj(raw) ?? {};
    const m = obj(d.money);
    const o = obj(d.occupancy);
    const s = obj(d.sales);
    const t = obj(d.team);

    const money: CeoMoney | null = m && {
      invoiced: num(m.invoiced), invoicedPrev: num(m.invoicedPrev),
      collected: num(m.collected), collectedPrev: num(m.collectedPrev),
      outstanding: num(m.outstanding), outstandingCount: num(m.outstandingCount),
      overdue: num(m.overdue), overdueCount: num(m.overdueCount),
      billedInAdvance: numOrNull(m.billedInAdvance),
      billedInAdvanceCount: numOrNull(m.billedInAdvance) === null ? null : num(m.billedInAdvanceCount),
      collectionRate: percent(m.collectionRate, num(m.collected), num(m.invoiced)),
      months: arr(m.months, (x: any) => ({ month: str(x.month), invoiced: num(x.invoiced), collected: num(x.collected) }))
        .filter(x => /^\d{4}-\d{2}/.test(x.month)),
      aging: arr(m.aging, (x: any) => ({ bucket: str(x.bucket), label: str(x.label) || str(x.bucket), amount: num(x.amount), count: num(x.count) })),
      topCustomers: arr(m.topCustomers, (x: any) => ({ customerId: num(x.customerId), name: str(x.name) || 'Customer', amount: num(x.amount), invoices: num(x.invoices) }))
    };

    const leasesExpiring = arr(o?.leasesExpiring, (x: any): CeoLeaseExpiring => ({
      bookingId: num(x.bookingId), customer: str(x.customer) || 'Customer', space: str(x.space), location: str(x.location),
      endOn: str(x.endOn), monthlyAmount: num(x.monthlyAmount)
    }));
    const leasesCount = numOrNull(o?.leasesExpiringCount);
    const occupancy: CeoOccupancy | null = o && {
      totalSpaces: num(o.totalSpaces), occupiedSpaces: num(o.occupiedSpaces),
      occupancyPct: num(o.occupancyPct), occupancyPctPrev: num(o.occupancyPctPrev),
      activeBookings: num(o.activeBookings), newBookings: num(o.newBookings), newBookingsPrev: num(o.newBookingsPrev),
      months: arr(o.months, (x: any) => ({ month: str(x.month), occupancyPct: num(x.occupancyPct), newBookings: num(x.newBookings) }))
        .filter(x => /^\d{4}-\d{2}/.test(x.month)),
      byType: arr(o.byType, (x: any) => ({ spaceTypeId: num(x.spaceTypeId), name: str(x.name) || 'Space type', total: num(x.total), occupied: num(x.occupied) })),
      byLocation: arr(o.byLocation, (x: any) => ({ locationId: num(x.locationId), name: str(x.name) || 'Location', total: num(x.total), occupied: num(x.occupied) })),
      leasesExpiring,
      // The full count when sent (never below the list it came with); null = only the list is known.
      leasesExpiringCount: leasesCount === null ? null : Math.max(leasesExpiring.length, Math.floor(leasesCount)),
      leasesExpiringMonthly: numOrNull(o.leasesExpiringMonthly)
    };

    const funnel = arr(s?.funnel, (x: any): CeoFunnelStage => ({ stage: str(x.stage), label: str(x.label) || str(x.stage), count: num(x.count) }));
    const stageCount = (k: CeoFunnelStageKey) => funnel.find(f => f.stage.toLowerCase() === k)?.count ?? 0;
    const quotations = stageCount('quotations');
    const conv = conversionOf(s?.conversionRate, s?.quotationsBooked, stageCount('bookings'), quotations);
    const sales: CeoSales | null = s && {
      funnel,
      conversionRate: conv.rate, quotations, quotationsBooked: conv.quotationsBooked,
      inquiriesByType: arr(s.inquiriesByType, (x: any) => ({ type: str(x.type) || 'NotSet', label: str(x.label) || str(x.type) || 'Not set', count: num(x.count) })),
      quotationValue: num(s.quotationValue), bookingValue: num(s.bookingValue),
      // Not sent (an older API): its inquiry figures never followed the location.
      inquiriesAllLocations: s.inquiriesAllLocations === undefined || s.inquiriesAllLocations === null
        ? true
        : s.inquiriesAllLocations === true || s.inquiriesAllLocations === 1 || String(s.inquiriesAllLocations).toLowerCase() === 'true'
    };

    // The API lists only the sales executives (19 Oct 2026); revenue is their converted value (an older API: convertedValue).
    const people: CeoPerson[] = t ? arr(t.people, (x: any) => ({
      userId: num(x.userId), name: str(x.name) || 'Team member', role: str(x.role), locations: str(x.locations),
      quotations: num(x.quotations), converted: num(x.converted), revenue: num(x.revenue ?? x.convertedValue)
    })) : [];
    const team: CeoTeam | null = t && {
      perLocation: arr(t.perLocation, (x: any) => ({
        locationId: num(x.locationId), name: str(x.name) || 'Location', salesExecutives: num(x.salesExecutives),
        quotations: num(x.quotations), converted: num(x.converted)
      })),
      people,
      salesExecutives: t.salesExecutives != null ? num(t.salesExecutives) : people.length,
      revenue: t.revenue != null ? num(t.revenue) : people.reduce((a, p) => a + p.revenue, 0)
    };

    return {
      period: periodOf<CeoPeriod>(d.period, period),
      periodLabel: str(d.periodLabel),
      generatedAt: strOrNull(d.generatedAt),
      range: rangeOf(d),
      previousRange: rangeOf({ from: d.previousFrom, to: d.previousTo }),
      locations: arr(d.locations, (x: any) => ({ locationId: num(x.locationId), name: str(x.name) || 'Location' }))
        .filter(l => l.locationId > 0),
      money, occupancy, sales, team
    };
  }

  private toBreakdown(raw: any): CeoBreakdown {
    const d = obj(raw) ?? {};
    return {
      title: str(d.title), subtitle: str(d.subtitle),
      valueLabel: str(d.valueLabel) || 'Value', value2Label: strOrNull(d.value2Label),
      rows: arr(d.rows, (r: any) => ({
        key: str(r.key), label: str(r.label) || str(r.key), value: num(r.value), value2: numOrNull(r.value2), count: numOrNull(r.count)
      }))
    };
  }

  private toRecords<K extends CeoRecordKind>(kind: K, raw: any): CeoRecords<K> {
    const d = obj(raw) ?? {};
    const rows = arr(d.rows, (r: any) => this.toRecord(kind, r)) as CeoRecordRowMap[K][];
    return { title: str(d.title), total: Math.max(num(d.total), rows.length), rows };
  }

  private toRecord(kind: CeoRecordKind, r: any): CeoRecordRowMap[CeoRecordKind] {
    switch (kind) {
      case 'invoices': return {
        invoiceId: num(r.invoiceId), invoiceNumber: str(r.invoiceNumber) || (r.invoiceId ? `#${r.invoiceId}` : ''),
        customer: str(r.customer), location: str(r.location), issuedOn: strOrNull(r.issuedOn),
        ...(r.periodStart !== undefined || r.periodEnd !== undefined ? { periodStart: strOrNull(r.periodStart), periodEnd: strOrNull(r.periodEnd) } : {}),
        dueOn: strOrNull(r.dueOn), total: num(r.total), paid: num(r.paid), balance: num(r.balance), status: str(r.status)
      };
      case 'spaces': return {
        spaceId: num(r.spaceId), name: str(r.name), spaceType: str(r.spaceType), location: str(r.location),
        capacity: numOrNull(r.capacity), occupied: r.occupied === true || r.occupied === 1 || r.occupied === 'true',
        customer: str(r.customer), bookingEndOn: strOrNull(r.bookingEndOn)
      };
      case 'bookings': return {
        bookingId: num(r.bookingId), customer: str(r.customer), space: str(r.space), location: str(r.location),
        startOn: strOrNull(r.startOn), endOn: strOrNull(r.endOn), status: str(r.status), totalAmount: num(r.totalAmount)
      };
      case 'inquiries': return {
        inquiryId: num(r.inquiryId), name: str(r.name), phone: str(r.phone), type: str(r.type), referenceName: str(r.referenceName),
        status: str(r.status), createdOn: strOrNull(r.createdOn), feedback: str(r.feedback)
      };
      case 'quotations': return {
        quotationId: num(r.quotationId), quotationNumber: str(r.quotationNumber) || (r.quotationId ? `#${r.quotationId}` : ''),
        customer: str(r.customer), location: str(r.location), createdBy: str(r.createdBy), status: str(r.status),
        total: num(r.total), createdOn: strOrNull(r.createdOn)
      };
      case 'leases': {
        const endOn = strOrNull(r.endOn);
        return {
          bookingId: num(r.bookingId), customer: str(r.customer) || 'Customer', space: str(r.space), location: str(r.location),
          endOn, monthlyAmount: num(r.monthlyAmount), daysLeft: numOrNull(r.daysLeft) ?? daysFromToday(endOn)
        };
      }
    }
  }
}

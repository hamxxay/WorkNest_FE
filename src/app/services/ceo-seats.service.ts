import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../environments/environment';
import {
  DashError, DashErrorWording, DashRange, arr, describeDashboardError, getDashboardData, num, numOrNull, obj, periodOf, periodQuery,
  rangeOf, str, strOrNull
} from './dashboard-api';
import { CeoPeriod, normalizeShift } from './ceo.service';

// ============================================================
// Seats section of the CEO dashboard: GET api/ceo/seats (read-only, SEAT_01). Seat occupancy against room occupancy,
// revenue per seat against the list price and the rent the empty seats could earn, now (Pakistan time, follows the
// location picker only), in the period, and month by month for 12 months. A seat counts as sold when any shift on it
// is sold (24/7 + the larger of Morning and Evening, up to the room's seats). Every field is defaulted here, so a
// missing one shows as 0 / empty instead of breaking the section.
// ============================================================

export type SeatShift = '24/7' | 'Morning' | 'Evening';
export const SEAT_SHIFTS: SeatShift[] = ['24/7', 'Morning', 'Evening'];

/** The rule in one line (subtitles, notes, the export). */
export const SEAT_RULE = "A seat is sold when any shift on it is sold (24/7 + the larger of Morning and Evening, up to the room's seats).";

/** Seat and room figures of a set of rooms: all of them (summary), a location or a space type. */
export interface SeatGroup {
  /** byLocation rows only (null there = rooms with no location); null elsewhere. */
  locationId: number | null;
  /** bySpaceType rows only; null elsewhere. */
  spaceTypeId: number | null;
  /** Location / space type name from the database; '' for the summary. */
  name: string;
  rooms: number;
  roomsOccupied: number;
  roomOccupancyPct: number;
  seats: number;
  seatsSold: number;
  emptySeats: number;
  seatOccupancyPct: number;
  /** Room occupancy % - seat occupancy % (points): how much fuller the rooms look than the seats are. */
  gapPts: number;
  /** Rooms with a booking now that still have empty seats, and those empty seats. */
  partlyFilledRooms: number;
  partlyFilledEmptySeats: number;
  /** Seats sold for only one of Morning / Evening (the other shift is free to sell). */
  oneShiftSeats: number;
  /** Monthly rent of the bookings running now, after the booking discount (PKR). */
  soldMonthly: number;
  revenuePerSeat: number;
  /** Average list price a seat of the sold seats (null: none has a list price). */
  listSeatPriceSold: number | null;
  /** Average list price a seat over every seat with a list price (null: none). */
  listSeatPriceAll: number | null;
  /** Revenue per seat against the list of the sold seats, % (null: no list price). */
  revenueVsListPct: number | null;
  /** Empty seats at their room's list price a seat, a month (PKR). */
  rentNotEarned: number;
  /** Empty seats in rooms without a list price (not in rentNotEarned). */
  emptySeatsUnpriced: number;
  periodSeatOccupancyPct: number;
  periodRoomOccupancyPct: number;
  periodDays: number;
}

/** Seats sold now on one shift. */
export interface SeatShiftNow { shift: SeatShift; seats: number; bookings: number; }

/** Seat and room occupancy at a month end (this month: now). */
export interface SeatMonth {
  month: string;
  rooms: number;
  roomsOccupied: number;
  roomOccupancyPct: number;
  seats: number;
  seatsSold: number;
  seatOccupancyPct: number;
}

export interface SeatRoom {
  spaceId: number;
  name: string;
  code: string;
  /** null = no location. */
  locationId: number | null;
  location: string;
  spaceTypeId: number | null;
  spaceType: string;
  categoryCode: string;
  seats: number;
  seatsSold: number;
  emptySeats: number;
  seatOccupancyPct: number;
  seats247: number;
  seatsMorning: number;
  seatsEvening: number;
  oneShiftSeats: number;
  bookingsNow: number;
  /** Any confirmed booking now. */
  occupiedNow: boolean;
  /** null = no list price. */
  listSeatPrice: number | null;
  soldMonthly: number;
  revenuePerSeat: number;
  /** null when the room has no list price. */
  rentNotEarned: number | null;
  periodSeatOccupancyPct: number;
  periodRoomOccupancyPct: number;
}

export interface CeoSeats {
  /** False before the database script SEAT_01 has run: only `message` is shown. */
  available: boolean;
  message: string;
  period: CeoPeriod;
  periodLabel: string;
  /** A custom period: the range the figures cover; else null. */
  range: DashRange | null;
  generatedAt: string | null;
  /** The Pakistan day of the "now" figures (yyyy-MM-dd). */
  asOf: string | null;
  /** All rooms in scope; null when not available. */
  summary: SeatGroup | null;
  /** Always 24/7, Morning, Evening (in that order). */
  byShift: SeatShiftNow[];
  byLocation: SeatGroup[];
  bySpaceType: SeatGroup[];
  /** 12 months, oldest first. */
  months: SeatMonth[];
  /** Every room in scope, by location then room code. */
  rooms: SeatRoom[];
}

/** Shown when the API says the seat figures are not set up and sends no message of its own. */
export const SEATS_NOT_SET_UP = 'Database update needed: run the script SEAT_01_ceo_seats to see the seat figures.';

const SEATS_WORDING: DashErrorWording = {
  name: 'seat figures',
  dbMessage: 'The seat figures need a database update. Ask the WorkNest team to run the script SEAT_01, then refresh this page.'
};

// ---------- normalising ----------

const round1 = (v: number) => Math.round(v * 10) / 10;
const clampPct = (v: number) => Math.min(100, Math.max(0, v));
const ratioPct = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);
const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

function toRoom(raw: unknown): SeatRoom {
  const r = obj(raw) ?? {};
  const seats = Math.max(0, num(r.seats));
  const seatsSold = Math.max(0, num(r.seatsSold));
  return {
    spaceId: num(r.spaceId), name: str(r.name) || str(r.code), code: str(r.code),
    locationId: numOrNull(r.locationId), location: str(r.location),
    spaceTypeId: numOrNull(r.spaceTypeId), spaceType: str(r.spaceType), categoryCode: str(r.categoryCode),
    seats, seatsSold,
    emptySeats: Math.max(0, numOrNull(r.emptySeats) ?? seats - seatsSold),
    seatOccupancyPct: clampPct(numOrNull(r.seatOccupancyPct) ?? ratioPct(seatsSold, seats)),
    seats247: num(r.seats247), seatsMorning: num(r.seatsMorning), seatsEvening: num(r.seatsEvening),
    oneShiftSeats: num(r.oneShiftSeats), bookingsNow: num(r.bookingsNow),
    occupiedNow: r.occupiedNow === true || r.occupiedNow === 1 || str(r.occupiedNow).toLowerCase() === 'true',
    listSeatPrice: numOrNull(r.listSeatPrice),
    soldMonthly: num(r.soldMonthly),
    revenuePerSeat: numOrNull(r.revenuePerSeat) ?? (seatsSold > 0 ? num(r.soldMonthly) / seatsSold : 0),
    rentNotEarned: numOrNull(r.rentNotEarned),
    periodSeatOccupancyPct: clampPct(num(r.periodSeatOccupancyPct)),
    periodRoomOccupancyPct: clampPct(num(r.periodRoomOccupancyPct))
  };
}

/** A room is partly filled when it has a booking now (or seats sold) and still has empty seats. */
export function isPartlyFilled(r: SeatRoom): boolean {
  return r.emptySeats > 0 && (r.occupiedNow || r.seatsSold > 0);
}

/**
 * The figures of a set of rooms worked out from the rooms themselves: the drill-down's totals, and the stand-in for a
 * summary / location / space type the API leaves out. Period figures are weighted by seats (seat-days) and by room
 * (room-days), as the API counts them.
 */
export function seatGroupOf(rooms: SeatRoom[], head: Partial<Pick<SeatGroup, 'locationId' | 'spaceTypeId' | 'name' | 'periodDays'>> = {}): SeatGroup {
  let seats = 0, sold = 0, empty = 0, occupied = 0, partly = 0, partlyEmpty = 0, oneShift = 0, soldMonthly = 0;
  let rent = 0, unpriced = 0, periodSeatDays = 0, periodRoomDays = 0;
  let pricedSold = 0, pricedSoldMonthly = 0, listOfSold = 0, pricedSeats = 0, listOfAll = 0;
  for (const r of rooms) {
    seats += r.seats; sold += r.seatsSold; empty += r.emptySeats; oneShift += r.oneShiftSeats; soldMonthly += r.soldMonthly;
    if (r.occupiedNow) occupied++;
    if (isPartlyFilled(r)) { partly++; partlyEmpty += r.emptySeats; }
    if (r.listSeatPrice !== null && r.listSeatPrice > 0) {
      rent += r.rentNotEarned ?? r.emptySeats * r.listSeatPrice;
      pricedSeats += r.seats; listOfAll += r.seats * r.listSeatPrice;
      pricedSold += r.seatsSold; pricedSoldMonthly += r.soldMonthly; listOfSold += r.seatsSold * r.listSeatPrice;
    } else {
      unpriced += r.emptySeats;
    }
    periodSeatDays += r.periodSeatOccupancyPct * r.seats;
    periodRoomDays += r.periodRoomOccupancyPct;
  }
  const seatPct = round1(ratioPct(sold, seats));
  const roomPct = round1(ratioPct(occupied, rooms.length));
  const listSold = pricedSold > 0 ? listOfSold / pricedSold : null;
  return {
    locationId: head.locationId ?? null, spaceTypeId: head.spaceTypeId ?? null, name: head.name ?? '',
    rooms: rooms.length, roomsOccupied: occupied, roomOccupancyPct: roomPct,
    seats, seatsSold: sold, emptySeats: empty, seatOccupancyPct: seatPct, gapPts: round1(roomPct - seatPct),
    partlyFilledRooms: partly, partlyFilledEmptySeats: partlyEmpty, oneShiftSeats: oneShift,
    soldMonthly, revenuePerSeat: sold > 0 ? soldMonthly / sold : 0,
    listSeatPriceSold: listSold,
    listSeatPriceAll: pricedSeats > 0 ? listOfAll / pricedSeats : null,
    revenueVsListPct: listSold ? round1(((pricedSoldMonthly / pricedSold) / listSold - 1) * 100) : null,
    rentNotEarned: rent, emptySeatsUnpriced: unpriced,
    periodSeatOccupancyPct: round1(seats > 0 ? periodSeatDays / seats : 0),
    periodRoomOccupancyPct: round1(rooms.length ? periodRoomDays / rooms.length : 0),
    periodDays: head.periodDays ?? 0
  };
}

/** A group as sent, every missing figure taken from `calc` (worked out from its rooms) or 0. */
function toGroup(raw: unknown, calc: SeatGroup): SeatGroup {
  const g = obj(raw) ?? {};
  const n = (k: keyof SeatGroup): number => numOrNull(g[k]) ?? ((calc[k] as number | null) ?? 0);
  const orNull = (k: keyof SeatGroup): number | null => (k in g ? numOrNull(g[k]) : (calc[k] as number | null));
  const seats = n('seats'), seatsSold = n('seatsSold');
  const seatPct = clampPct(numOrNull(g.seatOccupancyPct) ?? ratioPct(seatsSold, seats));
  const roomPct = clampPct(n('roomOccupancyPct'));
  return {
    locationId: 'locationId' in g ? numOrNull(g.locationId) : calc.locationId,
    spaceTypeId: 'spaceTypeId' in g ? numOrNull(g.spaceTypeId) : calc.spaceTypeId,
    name: str(g.name) || calc.name,
    rooms: n('rooms'), roomsOccupied: n('roomsOccupied'), roomOccupancyPct: roomPct,
    seats, seatsSold, emptySeats: Math.max(0, numOrNull(g.emptySeats) ?? seats - seatsSold), seatOccupancyPct: seatPct,
    gapPts: numOrNull(g.gapPts) ?? round1(roomPct - seatPct),
    partlyFilledRooms: n('partlyFilledRooms'), partlyFilledEmptySeats: n('partlyFilledEmptySeats'), oneShiftSeats: n('oneShiftSeats'),
    soldMonthly: n('soldMonthly'), revenuePerSeat: n('revenuePerSeat'),
    listSeatPriceSold: orNull('listSeatPriceSold'), listSeatPriceAll: orNull('listSeatPriceAll'), revenueVsListPct: orNull('revenueVsListPct'),
    rentNotEarned: n('rentNotEarned'), emptySeatsUnpriced: n('emptySeatsUnpriced'),
    periodSeatOccupancyPct: clampPct(n('periodSeatOccupancyPct')), periodRoomOccupancyPct: clampPct(n('periodRoomOccupancyPct')),
    periodDays: n('periodDays')
  };
}

/**
 * GET api/ceo/seats (data of the { isSuccessful, data } envelope) as the page uses it: every field defaulted, the
 * shifts always 24/7, Morning, Evening, the months oldest first, the rooms by location then code, and a summary /
 * location / space type the API leaves out worked out from the rooms. available: false (SEAT_01 not run) keeps only
 * the message. Never throws.
 */
export function toCeoSeats(raw: unknown, period: CeoPeriod): CeoSeats {
  const d = obj(raw);
  const head = {
    period: periodOf<CeoPeriod>(d?.period, period),
    periodLabel: str(d?.periodLabel),
    range: rangeOf(d),
    generatedAt: strOrNull(d?.generatedAt),
    asOf: strOrNull(d?.asOf)
  };
  const empty = { summary: null, byShift: SEAT_SHIFTS.map(shift => ({ shift, seats: 0, bookings: 0 })), byLocation: [], bySpaceType: [], months: [], rooms: [] };
  const off = !d || d.available === false || d.available === 0 || str(d.available).toLowerCase() === 'false';
  if (off) return { available: false, message: str(d?.message) || SEATS_NOT_SET_UP, ...head, ...empty };

  const rooms = arr(d.rooms, obj).filter(r => r !== null).map(toRoom)
    .sort((a, b) => byName(a.location, b.location) || byName(a.code || a.name, b.code || b.name));
  const sentSummary = obj(d.summary);
  const periodDays = num(sentSummary?.periodDays);
  const calc = seatGroupOf(rooms, { periodDays });
  const summary = sentSummary ? toGroup(sentSummary, calc) : (rooms.length ? calc : null);

  const sentShifts = new Map<SeatShift, any>();
  arr(d.byShift, obj).forEach(x => { if (x) sentShifts.set(normalizeShift(x.shift), x); });
  const byShift = SEAT_SHIFTS.map(shift => {
    const x = sentShifts.get(shift);
    return { shift, seats: num(x?.seats), bookings: num(x?.bookings) };
  });

  const groupsOf = (key: 'locationId' | 'spaceTypeId', label: (r: SeatRoom) => string): SeatGroup[] => {
    const map = new Map<number | null, SeatRoom[]>();
    rooms.forEach(r => { const k = r[key]; map.set(k, [...(map.get(k) ?? []), r]); });
    return [...map.entries()].map(([k, list]) => seatGroupOf(list, key === 'locationId'
      ? { locationId: k, name: label(list[0]), periodDays }
      : { spaceTypeId: k, name: label(list[0]), periodDays }));
  };
  const roomsOf = (key: 'locationId' | 'spaceTypeId', id: number | null) => rooms.filter(r => r[key] === id);

  const byLocation = Array.isArray(d.byLocation)
    ? arr(d.byLocation, (g: any) => {
        const id = numOrNull(obj(g)?.locationId);
        return toGroup(g, seatGroupOf(roomsOf('locationId', id), { locationId: id, periodDays }));
      })
    : groupsOf('locationId', r => r.location).sort((a, b) => byName(a.name, b.name));
  const bySpaceType = Array.isArray(d.bySpaceType)
    ? arr(d.bySpaceType, (g: any) => {
        const id = numOrNull(obj(g)?.spaceTypeId);
        return toGroup(g, seatGroupOf(roomsOf('spaceTypeId', id), { spaceTypeId: id, periodDays }));
      })
    : groupsOf('spaceTypeId', r => r.spaceType).sort((a, b) => b.seats - a.seats || byName(a.name, b.name));

  const months = arr(d.months, (x: unknown): SeatMonth => {
    const m = obj(x) ?? {};
    const seats = num(m.seats), seatsSold = num(m.seatsSold), roomsN = num(m.rooms), occ = num(m.roomsOccupied);
    return {
      month: str(m.month), rooms: roomsN, roomsOccupied: occ,
      roomOccupancyPct: clampPct(numOrNull(m.roomOccupancyPct) ?? ratioPct(occ, roomsN)),
      seats, seatsSold, seatOccupancyPct: clampPct(numOrNull(m.seatOccupancyPct) ?? ratioPct(seatsSold, seats))
    };
  }).filter(m => m.month).sort((a, b) => a.month.localeCompare(b.month));

  return { available: true, message: '', ...head, summary, byShift, byLocation, bySpaceType, months, rooms };
}

@Injectable({ providedIn: 'root' })
export class CeoSeatsService {
  private http = inject(HttpClient);
  private api = environment.apiUrl;

  /**
   * GET api/ceo/seats for the dashboard's period (a custom one with from / to) and location (null = all). available:
   * false until the database script SEAT_01 has run.
   */
  get(period: CeoPeriod, locationId: number | null, range: DashRange | null = null): Observable<CeoSeats> {
    return getDashboardData(this.http, `${this.api}/ceo/seats`, { ...periodQuery(period, range), locationId },
      err => CeoSeatsService.describeError(err)).pipe(map(d => toCeoSeats(d, period)));
  }

  /** Wording for a failed request; an API without the seats endpoint yet (404) names the seat figures. */
  static describeError(err: unknown): DashError {
    const e = describeDashboardError(err, SEATS_WORDING);
    return e.status === 404
      ? { ...e, message: 'The server does not have the seat figures yet. They show here once the API update is live.' }
      : e;
  }
}

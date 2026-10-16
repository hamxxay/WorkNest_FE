import { CEO_SHIFTS, CeoPricing, CeoRoom, CeoRoomSale, CeoShift } from '../../../../services/ceo.service';

// ============================================================
// Rooms section of the CEO dashboard: the table rows, filters and chart orders (pure, no Angular).
// ============================================================

export type ShiftFilter = 'all' | CeoShift;
/** Vacant = a room with no sale in the period (one row, no tenant); unpriced = a sale with no list price. */
export type PricingFilter = 'all' | CeoPricing | 'vacant';
/** The room's state today (occupied = a confirmed booking covers now). */
export type NowFilter = 'all' | 'occupied' | 'vacant';

export const SHIFT_FILTERS: { key: ShiftFilter; label: string }[] = [
  { key: 'all', label: 'All' }, ...CEO_SHIFTS.map(s => ({ key: s as ShiftFilter, label: s }))
];
export const PRICING_FILTERS: { key: PricingFilter; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'under', label: 'Under' }, { key: 'at', label: 'At' },
  { key: 'over', label: 'Over' }, { key: 'vacant', label: 'Vacant' },
  // Offered only while there are such sales.
  { key: 'unpriced', label: 'No list price' }
];

export const NOW_FILTERS: { key: NowFilter; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'occupied', label: 'Occupied' }, { key: 'vacant', label: 'Vacant' }
];

export const PRICING_LABELS: Record<CeoPricing, string> = { under: 'Under', at: 'At', over: 'Over', unpriced: 'No list price' };

/**
 * Under / at / over: red, slate (the neutral middle), teal; the same on every chart, pill and legend. No list price:
 * a pale slate (always with its label).
 */
export const PRICING_COLORS: Record<CeoPricing, string> = { under: '#dc2626', at: '#94a3b8', over: '#0f766e', unpriced: '#e2e8f0' };
export const PRICING_HOVER: Record<CeoPricing, string> = { under: '#b91c1c', at: '#64748b', over: '#115e59', unpriced: '#cbd5e1' };

/** One table row: a sale, or a room with none (vacant). */
export interface RoomRow {
  /** s<bookingId>-<n> for a sale, r<spaceId> for a vacant room (the row's element id). */
  key: string;
  room: CeoRoom;
  sale: CeoRoomSale | null;
}

/** A sale with its room (charts). */
export interface RoomSale { key: string; room: CeoRoom; sale: CeoRoomSale; }

const saleKey = (room: CeoRoom, sale: CeoRoomSale, i: number) => `s${sale.bookingId || room.spaceId}-${i}`;
export const roomKey = (room: CeoRoom) => `r${room.spaceId}`;

/** Every sale as a row, and one row for each room without a sale; in the rooms' order. */
export function roomRows(rooms: CeoRoom[]): RoomRow[] {
  return rooms.flatMap<RoomRow>(room => room.sales.length
    ? room.sales.map((sale, i) => ({ key: saleKey(room, sale, i), room, sale }))
    : [{ key: roomKey(room), room, sale: null }]);
}

/** A vacant row (no sale) has no shift: it shows only under "All" shifts. */
export function rowMatches(row: RoomRow, shift: ShiftFilter, pricing: PricingFilter, now: NowFilter = 'all'): boolean {
  if (now !== 'all' && row.room.occupiedNow !== (now === 'occupied')) return false;
  if (!row.sale) return shift === 'all' && (pricing === 'all' || pricing === 'vacant');
  if (shift !== 'all' && row.sale.shift !== shift) return false;
  return pricing === 'all' || row.sale.pricing === pricing;
}

export function filterRows(rows: RoomRow[], shift: ShiftFilter, pricing: PricingFilter, now: NowFilter = 'all'): RoomRow[] {
  return rows.filter(r => rowMatches(r, shift, pricing, now));
}

/** How many rows each price option shows under the chosen shift and now filters (the counts on its buttons). */
export function pricingCounts(rows: RoomRow[], shift: ShiftFilter, now: NowFilter = 'all'): Record<PricingFilter, number> {
  const counts = { all: 0, under: 0, at: 0, over: 0, vacant: 0, unpriced: 0 } as Record<PricingFilter, number>;
  for (const p of PRICING_FILTERS) counts[p.key] = rows.filter(r => rowMatches(r, shift, p.key, now)).length;
  return counts;
}

/**
 * Every sale with a list price, worst under first (variance % low to high), then the larger shortfall a month.
 * A sale without a list price has nothing to compare with and is left out.
 */
export function salesWorstFirst(rooms: CeoRoom[]): RoomSale[] {
  return rooms
    .flatMap(room => room.sales.map((sale, i) => ({ key: saleKey(room, sale, i), room, sale })))
    .filter(x => x.sale.pricing !== 'unpriced')
    .sort((a, b) => a.sale.variancePct - b.sale.variancePct || a.sale.varianceMonthly - b.sale.varianceMonthly);
}

/** Rooms, least occupied in the period first (rooms that sat empty lead). */
export function roomsLeastOccupied(rooms: CeoRoom[]): CeoRoom[] {
  return [...rooms].sort((a, b) => a.periodOccupancyPct - b.periodOccupancyPct
    || Number(a.occupiedNow) - Number(b.occupiedNow));
}

/** Short name on chart axes: the room code, else its name. */
export function roomLabel(room: CeoRoom): string {
  return room.code || room.name;
}

/** Axis label for a sale: room, plus the shift when it is not 24/7 ("PO-12 Morning"). */
export function saleLabel(room: CeoRoom, sale: CeoRoomSale): string {
  return sale.shift === '24/7' ? roomLabel(room) : `${roomLabel(room)} ${sale.shift}`;
}

/** Cut a label to fit a narrow axis ("Private Office 1..."). */
export function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, Math.max(1, max - 1)).trimEnd() + '…' : text;
}

/** "35,000" (PKR, no decimals; tables). */
export function amount(v: number | null | undefined): string {
  return Math.round(Number(v || 0)).toLocaleString('en-US');
}

/** "+2,500" / "-15,000" / "0". */
export function signedAmount(v: number | null | undefined): string {
  const n = Math.round(Number(v || 0));
  return n > 0 ? `+${n.toLocaleString('en-US')}` : n < 0 ? `-${Math.abs(n).toLocaleString('en-US')}` : '0';
}

/** "+3%" / "-12.5%" / "0%" (one decimal only when it matters). */
export function signedPct(v: number | null | undefined): string {
  const n = Number(v || 0);
  const r = Math.round(n * 10) / 10;
  if (r === 0) return '0%';
  const text = Math.abs(r - Math.round(r)) < 0.05 ? String(Math.abs(Math.round(r))) : Math.abs(r).toFixed(1);
  return `${r > 0 ? '+' : '-'}${text}%`;
}

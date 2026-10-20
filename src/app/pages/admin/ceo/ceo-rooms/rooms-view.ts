import { CEO_SHIFTS, CeoPricing, CeoRoom, CeoRoomSale, CeoShift } from '../../../../services/ceo.service';

// ============================================================
// Rooms section of the CEO dashboard: the room map, its filters and the chart orders (pure, no Angular).
// ============================================================

export type ShiftFilter = 'all' | CeoShift;

export const SHIFT_FILTERS: { key: ShiftFilter; label: string }[] = [
  { key: 'all', label: 'All' }, ...CEO_SHIFTS.map(s => ({ key: s as ShiftFilter, label: s }))
];

export const PRICING_LABELS: Record<CeoPricing, string> = { under: 'Under', at: 'At', over: 'Over', unpriced: 'No list price' };

/**
 * Under / at / over: red, teal, dark teal; the same on every chart, tile, pill and legend. No list price: a pale
 * slate (always with its label).
 */
export const PRICING_COLORS: Record<CeoPricing, string> = { under: '#dc2626', at: '#2dd4bf', over: '#0f766e', unpriced: '#cbd5e1' };
export const PRICING_HOVER: Record<CeoPricing, string> = { under: '#b91c1c', at: '#14b8a6', over: '#115e59', unpriced: '#94a3b8' };
/** Rooms not let in the period (the rent chart's last part, the map's empty tiles). */
export const NOT_LET_COLOR = '#e2e8f0';

/** A sale with its room (charts). */
export interface RoomSale { key: string; room: CeoRoom; sale: CeoRoomSale; }

const saleKey = (room: CeoRoom, sale: CeoRoomSale, i: number) => `s${sale.bookingId || room.spaceId}-${i}`;

// ---------- room map ----------

/** A tile's colour: how the room's bookings in the period were priced (the worst first), or none (not let). */
export type TileState = CeoPricing | 'none';
/** What the map highlights; the other tiles are dimmed. */
export type MapFilter = 'all' | 'inuse' | 'vacantnow' | TileState;

export const MAP_FILTERS: { key: MapFilter; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'inuse', label: 'In use now' }, { key: 'vacantnow', label: 'Vacant now' },
  { key: 'under', label: 'Under' }, { key: 'at', label: 'At' }, { key: 'over', label: 'Over' },
  // Offered only while there are such sales.
  { key: 'unpriced', label: 'No list price' },
  { key: 'none', label: 'Not let' }
];

/** One room on the map: its bookings in the period (of the chosen shift), and its colour. `i`: order on the map. */
export interface RoomTile { i: number; room: CeoRoom; sales: CeoRoomSale[]; state: TileState; }

/** The map's blocks: one per location and space type, in the rooms' order. */
export interface RoomGroup { key: string; location: string; spaceType: string; tiles: RoomTile[]; let: number; inUse: number; }

const STATE_ORDER: CeoPricing[] = ['under', 'at', 'over', 'unpriced'];

/** Under before at before over: a room with one booking under the price shows red. */
export function tileState(sales: CeoRoomSale[]): TileState {
  return STATE_ORDER.find(p => sales.some(x => x.pricing === p)) ?? 'none';
}

/**
 * Under / at / over / no list price: every room with a booking at that price (a room with an under and an over
 * booking shows under both), so the chips count ROOMS while the KPI cards count bookings.
 */
export function tileMatches(t: RoomTile, f: MapFilter): boolean {
  if (f === 'all') return true;
  if (f === 'inuse') return t.room.occupiedNow;
  if (f === 'vacantnow') return !t.room.occupiedNow;
  if (f === 'none') return !t.sales.length;
  return t.sales.some(x => x.pricing === f);
}

/** The rooms by location and space type; with a shift chosen, only that shift's bookings count. */
export function roomGroups(rooms: CeoRoom[], shift: ShiftFilter): RoomGroup[] {
  const groups = new Map<string, RoomGroup>();
  rooms.forEach((room, i) => {
    const key = `${room.locationId}|${room.spaceType}`;
    let g = groups.get(key);
    if (!g) groups.set(key, g = { key, location: room.location, spaceType: room.spaceType, tiles: [], let: 0, inUse: 0 });
    const sales = shift === 'all' ? room.sales : room.sales.filter(x => x.shift === shift);
    g.tiles.push({ i, room, sales, state: tileState(sales) });
    if (sales.length) g.let++;
    if (room.occupiedNow) g.inUse++;
  });
  return [...groups.values()];
}

/** How many tiles each filter highlights (the counts on its chips). */
export function mapCounts(tiles: RoomTile[]): Record<MapFilter, number> {
  const counts = {} as Record<MapFilter, number>;
  for (const f of MAP_FILTERS) counts[f.key] = tiles.filter(t => tileMatches(t, f.key)).length;
  return counts;
}

/** The text on a tile: the room code, else its name, short. */
export function tileText(room: CeoRoom): string {
  return clip(room.code || room.name, 7);
}

// ---------- rent by location and space type ----------

/**
 * A month's rent per block: what was sold, what the under-priced bookings miss against their price, and the list
 * rent of the rooms not let in the period. premium: what over-priced bookings add (inside sold). A room let to one
 * tenant after another in the period (or over a quarter / year) leaves out a booking that a later booking of the same
 * shift follows, so a month's rent is never two tenants' rent added up; bookings at the same time all count.
 */
export interface RentRow { key: string; label: string; sold: number; below: number; notLet: number; premium: number; }

export function rentByGroup(groups: RoomGroup[]): RentRow[] {
  return groups.map(g => {
    const row: RentRow = { key: g.key, label: `${g.spaceType} · ${g.location}`, sold: 0, below: 0, notLet: 0, premium: 0 };
    for (const t of g.tiles) {
      if (!t.sales.length) { row.notLet += t.room.listRoomPrice || 0; continue; }
      for (const x of currentSales(t.sales)) {
        row.sold += x.soldMonthly;
        if (x.pricing === 'under') row.below += -x.varianceMonthly;
        if (x.pricing === 'over') row.premium += x.varianceMonthly;
      }
    }
    return row;
  });
}

/**
 * What the room is let for a month now / at the end of the period: every sale except one followed by a later sale of
 * the same shift that starts on or after its end (one tenant after another). Sales that overlap (a shared space or an
 * office sold by the seat, several bookings at once) all count, as the Rooms "Sold" figure.
 */
export function currentSales(sales: CeoRoomSale[]): CeoRoomSale[] {
  const day = (d: string | null) => (d ?? '').slice(0, 10);
  return sales.filter(x => !x.endOn || !sales.some(y => y !== x && y.shift === x.shift && !!y.startOn && day(y.startOn) >= day(x.endOn)));
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

/**
 * Rooms that had a tenant in the period (or have one now), most occupied first. The empty ones are on the room map;
 * a chart of bars at 0% says nothing.
 */
export function roomsMostOccupied(rooms: CeoRoom[]): CeoRoom[] {
  return rooms.filter(r => r.periodOccupancyPct > 0 || r.occupiedNow)
    .sort((a, b) => b.periodOccupancyPct - a.periodOccupancyPct || Number(b.occupiedNow) - Number(a.occupiedNow));
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

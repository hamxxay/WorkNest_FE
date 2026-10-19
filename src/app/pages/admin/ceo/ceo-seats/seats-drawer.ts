import { Component, ElementRef, HostListener, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { SEAT_RULE, SeatRoom, isPartlyFilled, seatGroupOf } from '../../../../services/ceo-seats.service';
import { XlsxCell, downloadXlsx } from '../../../../utils/xlsx';
import { fileDate, fileSlug } from '../../../../utils/page-pdf';
import { count, fullMoney, money, pct } from '../ceo-shared';

/** Rooms of a location, of a space type, or every room in scope. */
export type SeatsScope = 'location' | 'spaceType' | 'all';
/** Partly filled: a booking now and empty seats; empty: no seat sold; full: no empty seat. */
export type SeatFilter = 'all' | 'partly' | 'empty' | 'full';

/** Opens the drawer (a new id opens it again). */
export interface SeatsDrill {
  id: number;
  scope: SeatsScope;
  /** locationId / spaceTypeId of the row (null = the rooms with none); unused for 'all'. */
  key: number | null;
  /** The location / space type name from the API (breadcrumb and title); '' for 'all'. */
  name: string;
  /** The filter it opens with (default all). */
  filter?: SeatFilter;
}

const FILTERS: { key: SeatFilter; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'partly', label: 'Partly filled' }, { key: 'empty', label: 'Empty' }, { key: 'full', label: 'Full' }
];

export function seatState(r: SeatRoom): Exclude<SeatFilter, 'all'> {
  if (r.emptySeats <= 0) return 'full';
  return isPartlyFilled(r) ? 'partly' : 'empty';
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

/**
 * The Seats section's drill-down: the rooms of a location / space type (or every room) with their seats now, the
 * shifts sold on them, the list price a seat and the rent their empty seats do not earn, most first. Built from the
 * section's own figures (no request); follows them when they reload. Same look and keyboard rules as the CEO drawer
 * (Escape closes, Tab stays inside, focus goes back to the row that opened it). Export Excel of the list on screen.
 */
@Component({
  selector: 'app-ceo-seats-drawer',
  standalone: true,
  templateUrl: './seats-drawer.html',
  styleUrls: ['../ceo-drawer/ceo-drawer.css', './seats-drawer.css']
})
export class SeatsDrawer {
  private host = inject(ElementRef<HTMLElement>);

  request = input<SeatsDrill | null>(null);
  /** Every room of the section (the drawer picks those of its scope). */
  rooms = input<SeatRoom[]>([]);
  /** The dashboard's period, for the export ("This month", "1 Oct - 15 Oct 2026"). */
  periodTitle = input('');
  closed = output<void>();

  readonly money = money;
  readonly fullMoney = fullMoney;
  readonly pct = pct;
  readonly count = count;
  readonly rule = SEAT_RULE;

  filter = signal<SeatFilter>('all');
  open = computed(() => !!this.request());

  private returnFocus: HTMLElement | null = null;
  private panel = viewChild<ElementRef<HTMLElement>>('panel');
  private heading = viewChild<ElementRef<HTMLElement>>('heading');

  constructor() {
    // A new request: its filter, and focus moves into the drawer (it goes back to the opener on close).
    effect(() => {
      const req = this.request();
      untracked(() => {
        if (!req) { this.returnFocus = null; return; }
        if (!this.returnFocus) {
          const active = document.activeElement as HTMLElement | null;
          this.returnFocus = active && !this.host.nativeElement.contains(active) ? active : null;
        }
        this.filter.set(req.filter ?? 'all');
        setTimeout(() => (this.heading()?.nativeElement ?? this.panel()?.nativeElement)?.focus({ preventScroll: true }));
      });
    });
  }

  // ---------- rooms ----------

  /** The rooms of the location / space type (null = none set), or all of them. */
  scoped = computed<SeatRoom[]>(() => {
    const req = this.request();
    if (!req) return [];
    const all = this.rooms();
    if (req.scope === 'all') return all;
    return all.filter(r => (req.scope === 'location' ? r.locationId : r.spaceTypeId) === req.key);
  });

  counts = computed<Record<SeatFilter, number>>(() => {
    const c: Record<SeatFilter, number> = { all: 0, partly: 0, empty: 0, full: 0 };
    for (const r of this.scoped()) { c.all++; c[seatState(r)]++; }
    return c;
  });
  /** The filter is offered only when the rooms are not all of one kind. */
  mixed = computed(() => (['partly', 'empty', 'full'] as SeatFilter[]).filter(f => this.counts()[f] > 0).length > 1);
  filters = computed(() => FILTERS.filter(f => f.key === 'all' || this.counts()[f.key] > 0 || this.filter() === f.key));

  /** The rooms shown: the filter's, most rent not earned first (no list price last), then by name. */
  shown = computed<SeatRoom[]>(() => {
    const f = this.mixed() ? this.filter() : 'all';
    return this.scoped()
      .filter(r => f === 'all' || seatState(r) === f)
      .sort((a, b) => (b.rentNotEarned ?? -1) - (a.rentNotEarned ?? -1) || byName(a.code || a.name, b.code || b.name));
  });

  /** Figures of the whole scope (header) and of the rooms shown (totals row). */
  scopeTotals = computed(() => seatGroupOf(this.scoped()));
  totals = computed(() => {
    const list = this.shown();
    return {
      ...seatGroupOf(list),
      seats247: list.reduce((a, r) => a + r.seats247, 0),
      seatsMorning: list.reduce((a, r) => a + r.seatsMorning, 0),
      seatsEvening: list.reduce((a, r) => a + r.seatsEvening, 0)
    };
  });

  /** The Shifts column only when some room has Morning or Evening seats (else every seat is 24/7). */
  hasShifts = computed(() => this.scoped().some(r => r.seatsMorning > 0 || r.seatsEvening > 0));

  crumb = computed(() => {
    const req = this.request();
    if (!req) return '';
    if (req.scope === 'all') return 'All rooms';
    return req.name || (req.scope === 'location' ? 'No location' : 'No space type');
  });
  title = computed(() => (this.request()?.scope === 'all' ? 'Seats by room' : `${this.crumb()}: seats by room`));
  sub = computed(() => {
    const t = this.scopeTotals();
    return `${count(t.rooms)} room${t.rooms === 1 ? '' : 's'} · ${count(t.seatsSold)} of ${count(t.seats)} seats sold now (${pct(t.seatOccupancyPct)})`
      + ` · ${money(t.rentNotEarned)} a month not earned · view only`;
  });

  setFilter(f: SeatFilter) { this.filter.set(f); }

  /** Under the room's name: its code (when it differs), space type and location, without what the scope already says. */
  roomSub(r: SeatRoom): string {
    const scope = this.request()?.scope;
    return [
      r.code && r.code !== r.name ? r.code : '',
      scope !== 'spaceType' ? r.spaceType : '',
      scope !== 'location' ? r.location : ''
    ].filter(Boolean).join(' · ');
  }

  /** "24/7 5", "Morning 2"... only the shifts sold. */
  shiftParts(x: { seats247: number; seatsMorning: number; seatsEvening: number }): string[] {
    return [
      x.seats247 ? `24/7 ${count(x.seats247)}` : '',
      x.seatsMorning ? `Morning ${count(x.seatsMorning)}` : '',
      x.seatsEvening ? `Evening ${count(x.seatsEvening)}` : ''
    ].filter(Boolean);
  }

  stateLabel(r: SeatRoom): string {
    const s = seatState(r);
    return s === 'full' ? 'Full' : s === 'partly' ? 'Partly filled' : 'Empty';
  }

  // ---------- close ----------

  close() {
    if (!this.request()) return;
    const target = this.returnFocus;
    this.returnFocus = null;
    this.closed.emit();
    if (target && document.contains(target)) setTimeout(() => target.focus({ preventScroll: true }));
  }

  // ---------- export ----------

  canExport = computed(() => this.shown().length > 0);

  /** The rooms on screen (with the filter) and their totals as an .xlsx; a second sheet says what it is. */
  exportExcel() {
    if (!this.canExport()) return;
    const m2 = (v: number | null) => (v === null ? null : Math.round(v * 100) / 100);
    const p1 = (v: number) => Math.round(v * 10) / 10;
    const t = this.totals();
    const table: XlsxCell[][] = [
      ['Room', 'Code', 'Location', 'Space type', 'Seats', 'Sold', 'Empty', 'Seat occupancy (%)', 'State',
        '24/7 seats', 'Morning seats', 'Evening seats', 'One shift free', 'Bookings now', 'List a seat (PKR)', 'Sold a month (PKR)',
        'Revenue per seat (PKR)', 'Rent not earned a month (PKR)'],
      ...this.shown().map(r => [r.name, r.code, r.location, r.spaceType, r.seats, r.seatsSold, r.emptySeats, p1(r.seatOccupancyPct),
        this.stateLabel(r), r.seats247, r.seatsMorning, r.seatsEvening, r.oneShiftSeats, r.bookingsNow, m2(r.listSeatPrice),
        m2(r.soldMonthly), m2(r.revenuePerSeat), m2(r.rentNotEarned)]),
      [],
      [`Total (${t.rooms} rooms)`, null, null, null, t.seats, t.seatsSold, t.emptySeats, p1(t.seatOccupancyPct), null,
        t.seats247, t.seatsMorning, t.seatsEvening, t.oneShiftSeats, null, m2(t.listSeatPriceAll), m2(t.soldMonthly),
        m2(t.revenuePerSeat), m2(t.rentNotEarned)]
    ];
    const f = this.mixed() ? this.filter() : 'all';
    const about: XlsxCell[][] = [
      [this.title()],
      ['Path', ['Seats', this.crumb()].join(' / ')],
      ['Rooms', f === 'all' ? 'All' : FILTERS.find(x => x.key === f)?.label ?? f],
      ['Period of the dashboard', this.periodTitle()],
      ['Seats now', 'Pakistan time, today'],
      ['Rule', SEAT_RULE],
      ['Rent not earned', "Empty seats x the room's list price a seat (rooms with a list price)"],
      ['Total list a seat', 'Average list price a seat over the seats with a list price'],
      ['Money in PKR'],
      ['Generated', new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })]
    ];
    downloadXlsx(`${fileSlug('WorkNest', 'Seats', this.crumb())}-${fileDate()}.xlsx`, [
      { name: 'Rooms', rows: table },
      { name: 'About', header: 0, rows: about }
    ]);
  }

  // ---------- keyboard: Escape closes, Tab stays inside ----------

  @HostListener('document:keydown', ['$event'])
  onKeydown(e: KeyboardEvent) {
    if (!this.open()) return;
    if (e.key === 'Escape') { e.preventDefault(); this.close(); return; }
    if (e.key !== 'Tab') return;
    const panel = this.panel()?.nativeElement;
    if (!panel) return;
    const focusable = Array.from(panel.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"]), select, input'
    )).filter(el => el.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey && (active === first || !panel.contains(active))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (active === last || !panel.contains(active))) { e.preventDefault(); first.focus(); }
  }
}

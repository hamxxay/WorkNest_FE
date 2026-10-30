import {
  Component, DestroyRef, ElementRef, Injector, afterNextRender, afterRenderEffect, computed, effect, inject, input, signal,
  untracked, viewChild
} from '@angular/core';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { Subscription } from 'rxjs';
import { SalesManagerService } from '../../../../services/sales-manager.service';
import {
  CEO_SHIFTS, CeoError, CeoPeriod, CeoPricing, CeoRoomCategory, CeoRooms, CeoService, roomCategoryOf
} from '../../../../services/ceo.service';
import {
  AXIS_MONEY, Chart, ChartKeyNav, DashKpi, GRID, LEGEND, TEAL, TEAL_DARK, TOOLTIP,
  applyChartDefaults, count, fullMoney, money, pct, pointerOnHover
} from '../ceo-shared';
import { periodTitleOf, periodWords } from '../period-range';
import type { DashRange } from '../../../../services/dashboard-api';
import {
  MAP_FILTERS, MapFilter, NOT_LET_COLOR, PRICING_COLORS, PRICING_HOVER, PRICING_LABELS, RoomSale, RoomTile, SHIFT_FILTERS,
  ShiftFilter, amount, clip, mapCounts, rentByGroup, roomGroups, roomLabel, saleLabel, salesWorstFirst,
  signedAmount, signedPct, tileMatches, tileText
} from './rooms-view';
import type { CeoRoom, CeoRoomSale } from '../../../../services/ceo.service';

type ChartKey = 'mix' | 'off' | 'rent';

/** A KPI card of this section: a category card has a second line (days occupied) and its own grid placement. */
type RoomKpi = DashKpi & { sub2?: string; cat?: boolean };

/** The next round number at or above v (1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8 x 10^n): axis ends people can read. */
function niceCeil(v: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  return ([1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find(f => f * p >= v) ?? 10) * p;
}

/** Bars a room chart shows before "Show all". */
const CHART_LIMIT = 12;
/** Height of one bar row on the per-room charts, and room for the axis. */
const AXIS_PX = 44;

/**
 * Rooms section of the CEO dashboard: private offices and shared spaces, their occupancy (now and in the period) and
 * the price each confirmed booking was sold at against the list (Morning / Evening against the shift price). KPI
 * cards (occupancy per room category, then under / at / over), three charts and a room map (every room as a tile
 * coloured by its price, a card with the selected room's tenant and price); a category card shows its rooms in use
 * on the map, a chart mark selects its room on the map. Follows the dashboard's
 * period and location. Data: GET api/ceo/rooms (database update CEO_02; before it, only the API's message shows).
 */
@Component({
  selector: 'app-ceo-rooms',
  standalone: true,
  imports: [DatePipe, NgTemplateOutlet],
  templateUrl: './ceo-rooms.html',
  styleUrls: ['../ceo-dashboard.css', './ceo-rooms.css']
})
export class CeoRoomsSection {
  private ceo = inject(CeoService);
  private sm = inject(SalesManagerService);
  private host = inject(ElementRef<HTMLElement>);
  private injector = inject(Injector);

  period = input.required<CeoPeriod>();
  /** The dashboard's custom range (period custom). */
  range = input<DashRange | null>(null);
  locationId = input<number | null>(null);
  /** Bumped by the dashboard's refresh button. */
  reload = input(0);
  /** Bumped by the dashboard's auto refresh: reload without dimming the section (selection and filters stay). */
  quietReload = input(0);
  source = input<'ceo' | 'sales-manager'>('ceo');
  mapOnly = input(false);

  readonly money = money;
  readonly fullMoney = fullMoney;
  readonly pct = pct;
  readonly count = count;
  readonly amount = amount;
  readonly signedAmount = signedAmount;
  readonly signedPct = signedPct;
  readonly roomLabel = roomLabel;
  readonly shifts = CEO_SHIFTS;
  readonly shiftFilters = SHIFT_FILTERS;
  readonly pricingLabels = PRICING_LABELS;
  readonly pricingColors = PRICING_COLORS;
  readonly notLetColor = NOT_LET_COLOR;
  readonly tileText = tileText;
  readonly limit = CHART_LIMIT;

  data = signal<CeoRooms | null>(null);
  loading = signal(true);
  refreshing = signal(false);
  error = signal<CeoError | null>(null);

  /** Room map: the room category shown (null = all), the shift whose bookings colour the tiles, the tiles highlighted, the room in the card. */
  category = signal<string | null>(null);
  shift = signal<ShiftFilter>('all');
  mapFilter = signal<MapFilter>('all');
  selectedId = signal<number | null>(null);
  showAllPrices = signal(false);
  chartAnnounce = signal('');

  private sub: Subscription | null = null;
  private dataKey = '';
  private charts = new Map<ChartKey, Chart>();

  private mixCanvas = viewChild<ElementRef<HTMLCanvasElement>>('mixCanvas');
  private offCanvas = viewChild<ElementRef<HTMLCanvasElement>>('offCanvas');
  private rentCanvas = viewChild<ElementRef<HTMLCanvasElement>>('rentCanvas');

  constructor() {
    inject(DestroyRef).onDestroy(() => { this.sub?.unsubscribe(); this.destroyCharts(); });
    effect(() => {
      this.period();
      this.range();
      this.locationId();
      this.reload();
      untracked(() => this.load());
    });
    effect(() => {
      if (this.quietReload()) untracked(() => this.load(true));
    });
    // Draws (or updates) the charts once their canvases are on the page and whenever their data changes.
    afterRenderEffect(() => this.renderCharts());
  }

  // ---------- loading ----------

  /** quiet: the auto refresh (the figures on screen stay as they are until the new ones arrive). */
  load(quiet = false) {
    this.sub?.unsubscribe();
    if (!quiet) { if (this.data()) this.refreshing.set(true); else this.loading.set(true); }
    const range = this.period() === 'custom' ? this.range() : null;
    const key = `${this.period()}|${range?.from ?? ''}|${range?.to ?? ''}|${this.locationId() ?? ''}`;
    const req$ = this.source() === 'sales-manager'
      ? this.sm.getRooms(this.period(), this.locationId(), range)
      : this.ceo.getRooms(this.period(), this.locationId(), range);
    this.sub = req$.subscribe({
      next: (d: CeoRooms) => {
        this.data.set(d);
        this.dataKey = key;
        this.error.set(null);
        this.loading.set(false);
        this.refreshing.set(false);
      },
      error: (err: CeoError) => {
        const e = CeoService.describeError(err);
        // An API without the rooms endpoint yet: name the report, not the whole dashboard.
        this.error.set(e.status === 404
          ? { ...e, message: 'The server does not have the room report yet. It will work once the API update is live.' }
          : e);
        // Rooms of another period / location would be misleading: keep them only for a plain refresh.
        if (this.dataKey !== key) { this.data.set(null); this.dataKey = ''; this.destroyCharts(); }
        this.loading.set(false);
        this.refreshing.set(false);
      }
    });
  }

  // ---------- figures ----------

  s = computed(() => this.data()?.summary ?? null);
  rooms = computed(() => this.data()?.rooms ?? []);
  available = computed(() => this.data()?.available !== false);

  private shownPeriod = computed<CeoPeriod>(() => this.data()?.period ?? this.period());
  private shownRange = computed(() => this.data()?.range ?? this.range());
  periodTitle = computed(() => this.data()?.periodLabel || periodTitleOf(this.shownPeriod(), this.shownRange()));
  /** "this month" / "in this range" (the figures on screen). */
  thisWord = computed(() => periodWords(this.shownPeriod(), this.shownRange()).thisP);

  /** Occupancy per room category (the API's byCategory, else worked out from the rooms): Private Office, Shared Space. */
  categories = computed<CeoRoomCategory[]>(() => this.s()?.byCategory ?? []);
  /** The categories that have rooms: the room map's switch. */
  mapCategories = computed(() => this.categories().filter(c => c.rooms > 0));
  /** Two categories and under / at / over fill one row of five (two rows below 1400px); any other count the six grid. */
  kpiLayout = computed(() => (this.categories().length === 2 ? 'kpi-rooms' : 'kpi-6'));

  kpis = computed<RoomKpi[]>(() => {
    const s = this.s();
    if (!s) return [];
    const custom = this.shownPeriod() === 'custom';
    const sales = (n: number) => `${count(n)} sale${n === 1 ? '' : 's'}`;
    const occTone = (rooms: number, p: number): DashKpi['tone'] => (!rooms ? 'neutral' : p >= 70 ? 'ok' : p >= 40 ? 'neutral' : 'warn');
    const sofar = custom ? 'in the range' : `${this.thisWord()} so far`;
    // One card per category, never the two mixed: in use now of its rooms, vacant, and its days occupied in the period.
    const cats: RoomKpi[] = this.categories().map(c => ({
      key: `cat-${c.categoryCode || 'other'}`, cat: true, label: c.label,
      value: `${count(c.occupiedNow)} of ${count(c.rooms)}`,
      sub: c.rooms ? `${pct(c.occupancyNowPct)} occupied now · ${count(c.vacantNow)} vacant` : 'No rooms',
      sub2: c.rooms ? `Days occupied ${pct(c.periodOccupancyPct)}` : '',
      full: c.rooms
        ? `${c.label}: ${count(c.occupiedNow)} of ${count(c.rooms)} occupied now (${pct(c.occupancyNowPct)}), ${count(c.vacantNow)} vacant; days occupied ${sofar}: ${pct(c.periodOccupancyPct)}`
        : '',
      tone: occTone(c.rooms, c.occupancyNowPct),
      action: c.rooms ? () => this.showMap({ category: c.categoryCode, filter: 'inuse' }) : undefined,
      actionLabel: `Show the ${c.label} rooms in use now on the room map`
    }));
    return [
      ...cats,
      {
        key: 'under', label: 'Under price', value: sales(s.under), full: `${fullMoney(s.underGapMonthly)} a month short`,
        sub: s.under ? `-${money(s.underGapMonthly)} a month` : 'No gap', tone: s.under ? 'danger' : 'ok',
        action: () => this.showMap({ filter: 'under' }), actionLabel: 'Show the rooms sold under the price on the room map'
      },
      {
        key: 'at', label: 'At price', value: sales(s.at), sub: 'Within 0.5% of the price', tone: 'neutral',
        action: () => this.showMap({ filter: 'at' }), actionLabel: 'Show the rooms sold at the price on the room map'
      },
      {
        key: 'over', label: 'Over price', value: sales(s.over), full: `${fullMoney(s.overPremiumMonthly)} a month extra`,
        sub: s.over ? `+${money(s.overPremiumMonthly)} a month` : 'No premium', tone: s.over ? 'ok' : 'neutral',
        action: () => this.showMap({ filter: 'over' }), actionLabel: 'Show the rooms sold over the price on the room map'
      }
    ];
  });

  /** Sold / expected / difference of every sale (panel header of the shift chart). */
  totals = computed(() => {
    const s = this.s();
    return { expected: s?.listMonthly ?? 0, sold: s?.soldMonthly ?? 0, variance: s?.varianceMonthly ?? 0 };
  });
  noSales = computed(() => !(this.s()?.sales));
  /** Sales without a list price (left out of the per-seat chart). */
  unpricedCount = computed(() => this.rooms().reduce((a, r) => a + r.sales.filter(x => x.pricing === 'unpriced').length, 0));

  // ---------- room map ----------

  /** The rooms on the map: the chosen category's, else all. */
  private mapRooms = computed(() => {
    const c = this.category();
    return c === null ? this.rooms() : this.rooms().filter(r => roomCategoryOf(r) === c);
  });
  groups = computed(() => roomGroups(this.mapRooms(), this.shift()));
  tiles = computed(() => this.groups().flatMap(g => g.tiles));
  mapCounts = computed(() => mapCounts(this.tiles()));
  /** "No list price" is offered only while there are such bookings (or it is the chosen filter). */
  mapFilters = computed(() => MAP_FILTERS.filter(f => f.key !== 'unpriced' || this.mapCounts().unpriced > 0 || this.mapFilter() === 'unpriced'));
  mapFiltered = computed(() => this.category() !== null || this.shift() !== 'all' || this.mapFilter() !== 'all');
  letRooms = computed(() => this.tiles().filter(t => t.sales.length).length);
  /** The room in the card (null: none chosen, or it left with a new period / location). */
  selected = computed<RoomTile | null>(() => {
    const id = this.selectedId();
    return id === null ? null : this.tiles().find(t => t.room.spaceId === id) ?? null;
  });
  /** The tile that takes Tab (the chosen one, else the first); arrow keys move from there. */
  tabStop = computed(() => this.selected()?.i ?? this.tiles()[0]?.i ?? -1);

  setCategory(c: string | null) { this.category.set(c); }
  setShift(f: ShiftFilter) { this.shift.set(f); }
  setMapFilter(f: MapFilter) { this.mapFilter.set(this.mapFilter() === f && f !== 'all' ? 'all' : f); }
  clearMap() { this.category.set(null); this.shift.set('all'); this.mapFilter.set('all'); }
  matches(t: RoomTile) { return tileMatches(t, this.mapFilter()); }
  select(t: RoomTile) { this.selectedId.set(this.selectedId() === t.room.spaceId ? null : t.room.spaceId); }
  chipColor(f: MapFilter): string | null {
    return f === 'none' ? NOT_LET_COLOR : f in PRICING_COLORS ? PRICING_COLORS[f as CeoPricing] : null;
  }

  /** What a tile says to a screen reader: room, place, now, and how it was sold. */
  tileAria(t: RoomTile): string {
    const r = t.room;
    const sold = t.sales.length
      ? t.sales.map(x => `${x.customer}, ${x.shift}, ${x.pricing === 'unpriced' ? 'no list price' : PRICING_LABELS[x.pricing].toLowerCase() + ' the price'}`).join('; ')
      : `not let ${this.thisWord()}`;
    return `${r.name}, ${r.spaceType}, ${r.location}, ${r.seats} seats, ${r.occupiedNow ? 'in use' : 'vacant'} now: ${sold}`;
  }

  /** Arrow keys move along the map (Home / End: first / last room); Enter or Space opens the card. */
  tileKey(e: KeyboardEvent, t: RoomTile) {
    if (e.key === 'Escape' && this.selectedId() !== null) { e.preventDefault(); this.selectedId.set(null); return; }
    const last = this.tiles().length - 1;
    const to = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? t.i + 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? t.i - 1
      : e.key === 'Home' ? 0 : e.key === 'End' ? last : null;
    if (to === null) return;
    e.preventDefault();
    const next = Math.max(0, Math.min(last, to));
    (this.host.nativeElement.querySelector(`[data-tile="${next}"]`) as HTMLElement | null)?.focus();
  }

  /** The selected room's bookings with the bar widths of their price graphic (sold against expected per seat). */
  selectedSales = computed(() => {
    const t = this.selected();
    if (!t) return [];
    return t.sales.map(x => {
      const top = Math.max(x.soldSeatPrice, x.expectedSeatPrice, 1) * 1.12;
      return { sale: x, soldW: (x.soldSeatPrice / top) * 100, expL: (x.expectedSeatPrice / top) * 100 };
    });
  });

  /** Expected per seat explained for a shift booking ("35,000 less the Morning cap of 20%"). */
  expectedNote(s: CeoRoomSale): string {
    if (s.pricing === 'unpriced') return 'The room has no list price';
    // 24/7 is compared with the full list (a cap stored for 24/7 is not applied).
    if (s.shift === '24/7') return `List ${amount(s.listSeatPriceAtSale)} a seat`;
    return s.shiftDiscountCapPct
      ? `List ${amount(s.listSeatPriceAtSale)} less the ${s.shift} cap of ${pct(s.shiftDiscountCapPct)}`
      : `List ${amount(s.listSeatPriceAtSale)}, no ${s.shift} cap set`;
  }

  // ---------- charts: data ----------

  /** Under / at / over (and no list price, when any): the donut and its rows. */
  mix = computed(() => {
    const s = this.s();
    if (!s) return [];
    const parts: { key: CeoPricing; label: string; count: number; amount: number | null }[] = [
      { key: 'under', label: 'Under the price', count: s.under, amount: s.under ? -s.underGapMonthly : null },
      { key: 'at', label: 'At the price', count: s.at, amount: null },
      { key: 'over', label: 'Over the price', count: s.over, amount: s.over ? s.overPremiumMonthly : null }
    ];
    if (s.unpriced) parts.push({ key: 'unpriced', label: 'No list price', count: s.unpriced, amount: null });
    return parts;
  });
  mixAria = computed(() => this.mix().map(m => `${m.label}: ${m.count}`).join(', '));
  /** Each shift's bookings as a bar split under / at / over (% widths). */
  shiftBars = computed(() => (this.s()?.byShift ?? []).map(x => {
    const w = (n: number) => (x.sales ? (n / x.sales) * 100 : 0);
    return { ...x, parts: (['under', 'at', 'over', 'unpriced'] as CeoPricing[]).filter(p => x[p] > 0).map(p => ({ key: p, n: x[p], w: w(x[p]) })) };
  }));

  /** Bookings sold off the price (under or over), most under first; the ones at the price are counted, not drawn. */
  private off = computed(() => salesWorstFirst(this.rooms())
    .filter(x => x.sale.pricing === 'under' || x.sale.pricing === 'over')
    .sort((a, b) => a.sale.varianceMonthly - b.sale.varianceMonthly));
  offShown = computed<RoomSale[]>(() => this.showAllPrices() ? this.off() : this.off().slice(0, CHART_LIMIT));
  offCount = computed(() => this.off().length);
  offHeight = computed(() => Math.max(120, this.offShown().length * 38 + AXIS_PX));

  /** Rent per location and space type (every shift). */
  rent = computed(() => rentByGroup(roomGroups(this.rooms(), 'all')));
  rentEmpty = computed(() => !this.rent().some(r => r.sold || r.below || r.notLet));
  rentHeight = computed(() => Math.max(170, this.rent().length * 46 + 70));
  rentTotals = computed(() => this.rent().reduce((a, r) => ({ sold: a.sold + r.sold, below: a.below + r.below, notLet: a.notLet + r.notLet }), { sold: 0, below: 0, notLet: 0 }));

  // ---------- leading to the map ----------

  /**
   * Sets the map's category, shift and highlight (the rest back to All) and brings the map into view; with a group
   * (location and space type, the rent chart's bar) that block of the map.
   */
  showMap(f: { category?: string; shift?: ShiftFilter; filter?: MapFilter; group?: string }) {
    this.category.set(f.category ?? null);
    this.shift.set(f.shift ?? 'all');
    this.mapFilter.set(f.filter ?? 'all');
    afterNextRender(() => {
      const block = f.group ? [...this.host.nativeElement.querySelectorAll('.map-group[data-group]') as NodeListOf<HTMLElement>]
        .find(el => el.dataset['group'] === f.group) : null;
      if (!block) { this.focusEl('panel-rooms-map'); return; }
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      block.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
      block.focus({ preventScroll: true });
      this.flash(block);
    }, { injector: this.injector });
  }

  /** Opens a room's card on the map and brings its tile into view. */
  showRoomOnMap(room: CeoRoom) {
    // A room of another category than the one shown: the map shows every category again.
    if (this.category() !== null && roomCategoryOf(room) !== this.category()) this.category.set(null);
    this.selectedId.set(room.spaceId);
    afterNextRender(() => {
      const t = this.selected();
      const el = t ? this.host.nativeElement.querySelector(`[data-tile="${t.i}"]`) as HTMLElement | null : null;
      if (!el) return;
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
      el.focus({ preventScroll: true });
      this.flash(el);
    }, { injector: this.injector });
  }

  showSale(i: number) { const x = this.offShown()[i]; if (x) this.showRoomOnMap(x.room); }

  focusEl(id: string) {
    const el = this.host.nativeElement.querySelector(`#${id}`) as HTMLElement | null;
    if (!el) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    el.focus({ preventScroll: true });
    this.flash(el);
  }

  private flash(el: HTMLElement) {
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1600);
  }

  // ---------- charts: keyboard ----------

  readonly offNav = new ChartKeyNav({
    charts: () => [this.charts.get('off')],
    count: () => this.offShown().length,
    describe: i => {
      const x = this.offShown()[i];
      return x ? `${x.room.name}, ${x.sale.customer}, ${x.sale.shift}: ${PRICING_LABELS[x.sale.pricing].toLowerCase()} the price by ${fullMoney(Math.abs(x.sale.varianceMonthly))} a month (${signedPct(x.sale.variancePct)}), sold ${fullMoney(x.sale.soldSeatPrice)} a seat against ${fullMoney(x.sale.expectedSeatPrice)}. Press Enter for the room.` : '';
    },
    pick: i => this.showSale(i),
    announce: t => this.chartAnnounce.set(t)
  });


  // ---------- charts: drawing ----------

  private destroyCharts() {
    this.charts.forEach(c => c.destroy());
    this.charts.clear();
  }

  /** Creates a chart, or updates it in place (no flash) when it already sits on the same canvas. */
  private upsert(key: ChartKey, ref: ElementRef<HTMLCanvasElement> | undefined, config: any) {
    const existing = this.charts.get(key);
    if (!ref) { existing?.destroy(); this.charts.delete(key); return; }
    if (existing && existing.canvas === ref.nativeElement) {
      existing.data = config.data;
      existing.options = config.options;
      existing.update();
      return;
    }
    existing?.destroy();
    this.charts.set(key, new Chart(ref.nativeElement, config));
  }

  private renderCharts() {
    if (this.mapOnly()) { this.destroyCharts(); return; }
    const d = this.data();
    const mixCanvas = this.mixCanvas();
    const offCanvas = this.offCanvas();
    const rentCanvas = this.rentCanvas();
    const off = this.offShown();
    if (!d || !d.available) { this.destroyCharts(); return; }
    applyChartDefaults();
    const noSales = this.noSales();

    /** A tick label cut to the chart's width (phones get short names). */
    const yLabel = (labels: string[]) => function (this: any, _v: any, i: number) {
      return clip(labels[i] ?? '', this.chart.width < 420 ? 14 : 26);
    };

    // 1. Under / at / over: a donut of the bookings; a part shows those rooms on the map.
    const mix = this.mix();
    this.upsert('mix', noSales ? undefined : mixCanvas, {
      type: 'doughnut',
      data: {
        labels: mix.map(m => m.label),
        datasets: [{
          data: mix.map(m => m.count), backgroundColor: mix.map(m => PRICING_COLORS[m.key]),
          hoverBackgroundColor: mix.map(m => PRICING_HOVER[m.key]),
          borderColor: '#fff', borderWidth: 2, hoverOffset: 6, hoverBorderColor: '#fff'
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '72%', layout: { padding: 8 },
        onHover: pointerOnHover,
        onClick: (_e: any, els: any[]) => { const m = mix[els[0]?.index]; if (m) this.showMap({ filter: m.key }); },
        plugins: {
          legend: { display: false },
          tooltip: {
            ...TOOLTIP,
            callbacks: {
              label: (c: any) => ` ${c.label}: ${c.parsed} booking${c.parsed === 1 ? '' : 's'}`,
              footer: (items: any[]) => {
                const m = mix[items[0]?.dataIndex];
                return m ? [...(m.amount ? [`${signedAmount(m.amount)} a month`] : []), 'Click to show them on the room map'] : '';
              }
            }
          }
        }
      }
    });

    // 2. Bookings off the price: how far under (left, red) or over (right, teal) a month, from 0.
    const offLabels = off.map(x => `${saleLabel(x.room, x.sale)} · ${x.sale.customer}`);
    const reach = niceCeil(Math.max(1, ...off.map(x => Math.abs(x.sale.varianceMonthly))) * 1.1);
    this.upsert('off', off.length ? offCanvas : undefined, {
      type: 'bar',
      data: {
        labels: offLabels,
        datasets: [{
          label: 'Difference a month', data: off.map(x => x.sale.varianceMonthly),
          backgroundColor: off.map(x => PRICING_COLORS[x.sale.pricing]),
          hoverBackgroundColor: off.map(x => PRICING_HOVER[x.sale.pricing]),
          borderRadius: 4, borderSkipped: 'start', maxBarThickness: 20, categoryPercentage: 0.8, barPercentage: 0.9
        }]
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', axis: 'y', intersect: false },
        onHover: pointerOnHover,
        onClick: (_e: any, els: any[]) => { if (els.length) this.showSale(els[0].index); },
        plugins: {
          legend: { display: false },
          tooltip: {
            ...TOOLTIP,
            callbacks: {
              title: (items: any[]) => {
                const x = off[items[0]?.dataIndex];
                return x ? `${x.room.name}${x.room.location ? ' · ' + x.room.location : ''}` : '';
              },
              label: (c: any) => {
                const s = off[c.dataIndex]?.sale;
                return s ? ` ${PRICING_LABELS[s.pricing]} the price: ${signedAmount(s.varianceMonthly)} a month (${signedPct(s.variancePct)})` : '';
              },
              afterLabel: (c: any) => {
                const s = off[c.dataIndex]?.sale;
                return s ? ` Sold ${fullMoney(s.soldSeatPrice)} a seat, expected ${fullMoney(s.expectedSeatPrice)}` : '';
              },
              footer: (items: any[]) => {
                const x = off[items[0]?.dataIndex];
                return x ? [`${x.sale.customer} · ${x.sale.shift} · ${x.sale.seatsSold} seat${x.sale.seatsSold === 1 ? '' : 's'}`, 'Click for the room'] : '';
              }
            }
          }
        },
        scales: {
          // symmetric around 0, so under and over read against the same middle line
          x: {
            min: -reach, max: reach, grid: { ...GRID, color: (c: any) => (c.tick?.value === 0 ? '#94a3b8' : GRID.color) },
            border: { display: false }, ticks: { padding: 8, stepSize: reach / 2, callback: (v: any) => signedAmount(Number(v)) }
          },
          y: { grid: { display: false }, border: { display: false }, ticks: { autoSkip: false, callback: yLabel(offLabels) } }
        }
      }
    });

    // 3. A month's rent per location and space type: sold, missed below the price, rooms not let (at list).
    const rent = this.rent();
    const parts: { key: 'sold' | 'below' | 'notLet'; label: string; color: string; hover: string }[] = [
      { key: 'sold', label: 'Sold', color: TEAL, hover: TEAL_DARK },
      { key: 'below', label: 'Missed below the price', color: PRICING_COLORS.under, hover: PRICING_HOVER.under },
      { key: 'notLet', label: 'Rooms not let, at list', color: NOT_LET_COLOR, hover: '#cbd5e1' }
    ];
    const rentLabels = rent.map(r => r.label);
    this.upsert('rent', this.rentEmpty() ? undefined : rentCanvas, {
      type: 'bar',
      data: {
        labels: rentLabels,
        datasets: parts.map(p => ({
          label: p.label, data: rent.map(r => r[p.key]), stack: 'rent',
          backgroundColor: p.color, hoverBackgroundColor: p.hover,
          borderColor: '#fff', borderWidth: { top: 0, right: 2, bottom: 0, left: 0 }, borderSkipped: false, borderRadius: 4,
          maxBarThickness: 24, categoryPercentage: 0.8, barPercentage: 0.9
        }))
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', axis: 'y', intersect: false },
        onHover: pointerOnHover,
        onClick: (e: any, els: any[], chart: Chart) => {
          if (!els.length) return;
          const hit = chart.getElementsAtEventForMode(e, 'nearest', { intersect: true }, false)[0];
          const part = hit ? parts[hit.datasetIndex].key : null;
          // That block of the map (its location and space type), with the part highlighted.
          this.showMap({ filter: part === 'below' ? 'under' : part === 'notLet' ? 'none' : 'all', group: rent[els[0].index]?.key });
        },
        plugins: {
          legend: LEGEND,
          tooltip: {
            ...TOOLTIP,
            callbacks: {
              title: (items: any[]) => rentLabels[items[0]?.dataIndex] ?? '',
              label: (c: any) => ` ${c.dataset.label}: ${fullMoney(c.parsed.x)}`,
              footer: (items: any[]) => {
                const r = rent[items[0]?.dataIndex];
                if (!r) return '';
                return [...(r.premium ? [`Over the price: +${fullMoney(r.premium)} (inside sold)`] : []), 'Click to show it on the room map'];
              }
            }
          }
        },
        scales: {
          x: { stacked: true, beginAtZero: true, grid: GRID, border: { display: false }, ticks: { ...AXIS_MONEY, maxTicksLimit: 5 } },
          y: { stacked: true, grid: { display: false }, border: { display: false }, ticks: { autoSkip: false, callback: yLabel(rentLabels) } }
        }
      }
    });
  }
}

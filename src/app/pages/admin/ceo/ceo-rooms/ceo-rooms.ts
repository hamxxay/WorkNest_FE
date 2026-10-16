import {
  Component, DestroyRef, ElementRef, Injector, afterNextRender, afterRenderEffect, computed, effect, inject, input, signal,
  untracked, viewChild
} from '@angular/core';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { Subscription } from 'rxjs';
import { CEO_SHIFTS, CeoError, CeoPeriod, CeoPricing, CeoRooms, CeoService } from '../../../../services/ceo.service';
import {
  AXIS_MONEY, Chart, ChartKeyNav, DashKpi, GRID, LEGEND, TEAL, TEAL_DARK, TEAL_LIGHT, TEAL_LIGHT_HOVER, TOOLTIP,
  applyChartDefaults, count, fullMoney, money, pct, periodWord, pointerOnHover
} from '../ceo-shared';
import {
  NOW_FILTERS, NowFilter, PRICING_COLORS, PRICING_FILTERS, PRICING_HOVER, PRICING_LABELS, PricingFilter, RoomRow, RoomSale,
  SHIFT_FILTERS, ShiftFilter, amount, clip, filterRows, pricingCounts, roomKey, roomLabel, roomRows, roomsLeastOccupied, rowMatches,
  saleLabel, salesWorstFirst, signedAmount, signedPct
} from './rooms-view';

type ChartKey = 'shift' | 'price' | 'occ';

/** Bars a room chart shows before "Show all". */
const CHART_LIMIT = 12;
/** Height of one bar row on the per-room charts, and room for the axis. */
const ROW_PX = 30;
const AXIS_PX = 44;

/**
 * Rooms section of the CEO dashboard: private offices and shared spaces, their occupancy (now and in the period) and
 * the price each confirmed booking was sold at against the list (Morning / Evening against the shift price). KPI
 * cards, three charts and a filterable table; a chart mark leads to its row in the table. Follows the dashboard's
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
  private host = inject(ElementRef<HTMLElement>);
  private injector = inject(Injector);

  period = input.required<CeoPeriod>();
  locationId = input<number | null>(null);
  /** Bumped by the dashboard's refresh button. */
  reload = input(0);

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
  readonly nowFilters = NOW_FILTERS;
  readonly pricingLabels = PRICING_LABELS;
  readonly pricingColors = PRICING_COLORS;
  readonly limit = CHART_LIMIT;

  data = signal<CeoRooms | null>(null);
  loading = signal(true);
  refreshing = signal(false);
  error = signal<CeoError | null>(null);

  shift = signal<ShiftFilter>('all');
  pricing = signal<PricingFilter>('all');
  now = signal<NowFilter>('all');
  showAllPrices = signal(false);
  showAllOcc = signal(false);
  shiftTable = signal(false);
  chartAnnounce = signal('');

  private sub: Subscription | null = null;
  private dataKey = '';
  private charts = new Map<ChartKey, Chart>();

  private shiftCanvas = viewChild<ElementRef<HTMLCanvasElement>>('shiftCanvas');
  private priceCanvas = viewChild<ElementRef<HTMLCanvasElement>>('priceCanvas');
  private occCanvas = viewChild<ElementRef<HTMLCanvasElement>>('occCanvas');

  constructor() {
    inject(DestroyRef).onDestroy(() => { this.sub?.unsubscribe(); this.destroyCharts(); });
    effect(() => {
      this.period();
      this.locationId();
      this.reload();
      untracked(() => this.load());
    });
    // Draws (or updates) the charts once their canvases are on the page and whenever their data changes.
    afterRenderEffect(() => this.renderCharts());
  }

  // ---------- loading ----------

  load() {
    this.sub?.unsubscribe();
    if (this.data()) this.refreshing.set(true); else this.loading.set(true);
    const key = `${this.period()}|${this.locationId() ?? ''}`;
    this.sub = this.ceo.getRooms(this.period(), this.locationId()).subscribe({
      next: d => {
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
  periodTitle = computed(() => this.data()?.periodLabel
    || { month: 'This month', quarter: 'This quarter', year: 'This year' }[this.shownPeriod()]);
  word = computed(() => periodWord(this.shownPeriod()));

  kpis = computed<DashKpi[]>(() => {
    const s = this.s();
    if (!s) return [];
    const w = this.word();
    const sales = (n: number) => `${count(n)} sale${n === 1 ? '' : 's'}`;
    const occTone = (p: number): DashKpi['tone'] => (!s.rooms ? 'neutral' : p >= 70 ? 'ok' : p >= 40 ? 'neutral' : 'warn');
    return [
      {
        key: 'occupied', label: 'Occupied now', value: `${count(s.occupiedNow)} of ${count(s.rooms)}`,
        sub: `${pct(s.occupancyNowPct)} of the rooms`, tone: occTone(s.occupancyNowPct),
        action: () => this.showRows({ now: 'occupied' }), actionLabel: 'Open the rooms occupied now'
      },
      {
        key: 'vacant', label: 'Vacant now', value: count(s.vacantNow),
        sub: s.vacantNow ? 'No tenant today' : 'Every room is let', tone: s.vacantNow ? 'warn' : 'ok',
        action: () => this.showRows({ now: 'vacant' }), actionLabel: 'Open the rooms vacant now'
      },
      {
        key: 'period', label: 'Days occupied', value: pct(s.periodOccupancyPct),
        sub: `This ${w} so far`, tone: occTone(s.periodOccupancyPct),
        action: () => this.focusEl('panel-rooms-occ'), actionLabel: 'Show occupancy by room'
      },
      {
        key: 'under', label: 'Under price', value: sales(s.under), full: `${fullMoney(s.underGapMonthly)} a month short`,
        sub: s.under ? `-${money(s.underGapMonthly)} a month` : 'No gap', tone: s.under ? 'danger' : 'ok',
        action: () => this.showRows({ pricing: 'under' }), actionLabel: 'Open the sales under the price'
      },
      {
        key: 'at', label: 'At price', value: sales(s.at), sub: 'Within 0.5% of the price', tone: 'neutral',
        action: () => this.showRows({ pricing: 'at' }), actionLabel: 'Open the sales at the price'
      },
      {
        key: 'over', label: 'Over price', value: sales(s.over), full: `${fullMoney(s.overPremiumMonthly)} a month extra`,
        sub: s.over ? `+${money(s.overPremiumMonthly)} a month` : 'No premium', tone: s.over ? 'ok' : 'neutral',
        action: () => this.showRows({ pricing: 'over' }), actionLabel: 'Open the sales over the price'
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

  // ---------- table ----------

  allRows = computed(() => roomRows(this.rooms()));
  rows = computed(() => filterRows(this.allRows(), this.shift(), this.pricing(), this.now()));
  counts = computed(() => pricingCounts(this.allRows(), this.shift(), this.now()));
  /** "No list price" is offered only while there are such sales. */
  pricingFilters = computed(() => PRICING_FILTERS.filter(f => f.key !== 'unpriced'
    || this.allRows().some(r => r.sale?.pricing === 'unpriced') || this.pricing() === 'unpriced'));
  filtered = computed(() => this.shift() !== 'all' || this.pricing() !== 'all' || this.now() !== 'all');

  setShift(f: ShiftFilter) { this.shift.set(f); }
  setPricing(f: PricingFilter) { this.pricing.set(f); }
  setNow(f: NowFilter) { this.now.set(f); }
  clearFilters() { this.shift.set('all'); this.pricing.set('all'); this.now.set('all'); }

  /** Expected per seat explained for a shift booking ("35,000 less the Morning cap of 20%"). */
  expectedNote(row: RoomRow): string {
    const s = row.sale;
    if (!s) return '';
    if (s.pricing === 'unpriced') return 'The room has no list price';
    // 24/7 is compared with the full list (a cap stored for 24/7 is not applied).
    if (s.shift === '24/7') return `List ${amount(s.listSeatPriceAtSale)} a seat`;
    return s.shiftDiscountCapPct
      ? `List ${amount(s.listSeatPriceAtSale)} less the ${s.shift} cap of ${pct(s.shiftDiscountCapPct)}`
      : `List ${amount(s.listSeatPriceAtSale)}, no ${s.shift} cap set`;
  }

  // ---------- charts: data ----------

  /** Every sale, worst under first. */
  private worst = computed(() => salesWorstFirst(this.rooms()));
  worstShown = computed<RoomSale[]>(() => this.showAllPrices() ? this.worst() : this.worst().slice(0, CHART_LIMIT));
  worstCount = computed(() => this.worst().length);
  priceHeight = computed(() => Math.max(150, this.worstShown().length * ROW_PX + AXIS_PX));

  private leastOccupied = computed(() => roomsLeastOccupied(this.rooms()));
  occShown = computed(() => this.showAllOcc() ? this.leastOccupied() : this.leastOccupied().slice(0, CHART_LIMIT));
  occHeight = computed(() => Math.max(150, this.occShown().length * ROW_PX + AXIS_PX));

  // ---------- leading to the rows ----------

  /** Sets the table filters (the rest back to All) and brings the table into view. */
  showRows(f: { shift?: ShiftFilter; pricing?: PricingFilter; now?: NowFilter }) {
    this.shift.set(f.shift ?? 'all');
    this.pricing.set(f.pricing ?? 'all');
    this.now.set(f.now ?? 'all');
    afterNextRender(() => this.focusEl('panel-rooms-table'), { injector: this.injector });
  }

  /** Brings one row into view (clearing filters that hide it) and marks it for a moment. */
  showRow(key: string) {
    const row = this.allRows().find(r => r.key === key);
    if (!row) return;
    if (!rowMatches(row, this.shift(), this.pricing(), this.now())) this.clearFilters();
    afterNextRender(() => {
      const el = this.host.nativeElement.querySelector(`#rooms-row-${key}`) as HTMLElement | null;
      if (!el) return;
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
      el.setAttribute('tabindex', '-1');
      el.focus({ preventScroll: true });
      this.flash(el);
    }, { injector: this.injector });
  }

  showSale(i: number) { const x = this.worstShown()[i]; if (x) this.showRow(x.key); }
  showRoom(i: number) {
    const room = this.occShown()[i];
    if (!room) return;
    const first = this.allRows().find(r => r.room === room);
    this.showRow(first?.key ?? roomKey(room));
  }

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

  readonly shiftNav = new ChartKeyNav({
    charts: () => [this.charts.get('shift')],
    count: () => (this.s()?.byShift.length ?? 0),
    describe: i => {
      const x = this.s()?.byShift[i];
      return x ? `${x.shift}: ${x.under} under, ${x.at} at, ${x.over} over the price${x.unpriced ? `, ${x.unpriced} with no list price` : ''}. Press Enter for the rows.` : '';
    },
    pick: i => { const x = this.s()?.byShift[i]; if (x) this.showRows({ shift: x.shift }); },
    announce: t => this.chartAnnounce.set(t)
  });

  readonly priceNav = new ChartKeyNav({
    charts: () => [this.charts.get('price')],
    count: () => this.worstShown().length,
    describe: i => {
      const x = this.worstShown()[i];
      return x ? `${x.room.name}, ${x.sale.customer}, ${x.sale.shift}: sold ${fullMoney(x.sale.soldSeatPrice)} a seat, expected ${fullMoney(x.sale.expectedSeatPrice)}, ${PRICING_LABELS[x.sale.pricing].toLowerCase()} the price. Press Enter for the row.` : '';
    },
    pick: i => this.showSale(i),
    announce: t => this.chartAnnounce.set(t)
  });

  readonly occNav = new ChartKeyNav({
    charts: () => [this.charts.get('occ')],
    count: () => this.occShown().length,
    describe: i => {
      const r = this.occShown()[i];
      return r ? `${r.name}: occupied ${pct(r.periodOccupancyPct)} of the days so far, ${r.occupiedNow ? 'occupied' : 'vacant'} now. Press Enter for the row.` : '';
    },
    pick: i => this.showRoom(i),
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
    const d = this.data();
    const shiftCanvas = this.shiftCanvas();
    const priceCanvas = this.priceCanvas();
    const occCanvas = this.occCanvas();
    const worst = this.worstShown();
    const occ = this.occShown();
    if (!d || !d.available) { this.destroyCharts(); return; }
    applyChartDefaults();
    const noSales = this.noSales();
    const noPriced = !worst.length;

    /** A tick label cut to the chart's width (phones get short names). */
    const yLabel = (labels: string[]) => function (this: any, _v: any, i: number) {
      return clip(labels[i] ?? '', this.chart.width < 420 ? 13 : 22);
    };

    // 1. Under / at / over by shift (stacked counts).
    const byShift = d.summary.byShift;
    const pricings: CeoPricing[] = d.summary.unpriced ? ['under', 'at', 'over', 'unpriced'] : ['under', 'at', 'over'];
    this.upsert('shift', noSales ? undefined : shiftCanvas, {
      type: 'bar',
      data: {
        labels: byShift.map(x => x.shift),
        datasets: pricings.map(p => ({
          label: p === 'unpriced' ? PRICING_LABELS[p] : `${PRICING_LABELS[p]} the price`, data: byShift.map(x => x[p]), stack: 'pricing',
          backgroundColor: PRICING_COLORS[p], hoverBackgroundColor: PRICING_HOVER[p],
          // a 2px white gap between the stacked parts
          borderColor: '#fff', borderWidth: { top: 2, right: 0, bottom: 0, left: 0 }, borderRadius: 3, borderSkipped: false,
          maxBarThickness: 56
        }))
      },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        onHover: pointerOnHover,
        onClick: (e: any, els: any[], chart: Chart) => {
          if (!els.length) return;
          const hit = chart.getElementsAtEventForMode(e, 'nearest', { intersect: true }, false)[0];
          const x = byShift[els[0].index];
          if (x) this.showRows({ shift: x.shift, pricing: hit ? pricings[hit.datasetIndex] : 'all' });
        },
        plugins: {
          legend: LEGEND,
          tooltip: {
            ...TOOLTIP,
            callbacks: {
              title: (items: any[]) => `${byShift[items[0]?.dataIndex]?.shift ?? ''} bookings`,
              label: (c: any) => ` ${c.dataset.label}: ${c.parsed.y}`,
              footer: (items: any[]) => {
                const x = byShift[items[0]?.dataIndex];
                return x && x.sales
                  ? [`Sold ${fullMoney(x.soldMonthly)} vs ${fullMoney(x.expectedMonthly)} a month`, 'Click for the rows']
                  : '';
              }
            }
          }
        },
        scales: {
          x: { stacked: true, grid: { display: false }, border: { display: false } },
          y: { stacked: true, beginAtZero: true, grid: GRID, border: { display: false }, ticks: { precision: 0, padding: 8, maxTicksLimit: 5 } }
        }
      }
    });

    // 2. Sold per seat (bar, coloured by under / at / over) against expected per seat (marker), worst under first.
    const priceLabels = worst.map(x => saleLabel(x.room, x.sale));
    const expected = worst.map(x => x.sale.expectedSeatPrice || null);
    const marker = { type: 'line', showLine: false, indexAxis: 'y', pointStyle: 'line', rotation: 90, data: expected };
    this.upsert('price', noPriced ? undefined : priceCanvas, {
      type: 'bar',
      data: {
        labels: priceLabels,
        datasets: [
          {
            ...marker, label: 'Expected per seat', order: 0, pointRadius: 9, pointHoverRadius: 10,
            pointBorderWidth: 2.5, pointHoverBorderWidth: 3, borderColor: '#0f172a', pointBorderColor: '#0f172a',
            pointHoverBorderColor: '#0f172a', pointHitRadius: 0
          },
          {
            // A white halo under the marker, so it stays clear on a dark bar.
            ...marker, label: 'halo', order: 1, pointRadius: 10, pointHoverRadius: 11,
            pointBorderWidth: 6, pointHoverBorderWidth: 7, borderColor: '#fff', pointBorderColor: '#fff',
            pointHoverBorderColor: '#fff', pointHitRadius: 0
          },
          {
            type: 'bar', label: 'Sold per seat', order: 2, indexAxis: 'y', data: worst.map(x => x.sale.soldSeatPrice),
            backgroundColor: worst.map(x => PRICING_COLORS[x.sale.pricing]),
            hoverBackgroundColor: worst.map(x => PRICING_HOVER[x.sale.pricing]),
            borderRadius: 4, borderSkipped: 'start', maxBarThickness: 18, categoryPercentage: 0.8, barPercentage: 0.9
          }
        ]
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
            filter: (item: any) => item.datasetIndex === 2,
            callbacks: {
              title: (items: any[]) => {
                const x = worst[items[0]?.dataIndex];
                return x ? `${x.room.name}${x.room.location ? ' · ' + x.room.location : ''}` : '';
              },
              label: (c: any) => ` Sold ${fullMoney(c.parsed.x)} a seat`,
              afterLabel: (c: any) => {
                const s = worst[c.dataIndex]?.sale;
                if (!s) return '';
                return [
                  ` Expected ${fullMoney(s.expectedSeatPrice)} a seat`,
                  ` ${PRICING_LABELS[s.pricing]} the price: ${signedAmount(s.varianceMonthly)} a month (${signedPct(s.variancePct)})`
                ];
              },
              footer: (items: any[]) => {
                const x = worst[items[0]?.dataIndex];
                return x ? [`${x.sale.customer} · ${x.sale.shift} · ${x.sale.seatsSold} seat${x.sale.seatsSold === 1 ? '' : 's'}`, 'Click for the row'] : '';
              }
            }
          }
        },
        scales: {
          x: { beginAtZero: true, grid: GRID, border: { display: false }, ticks: { ...AXIS_MONEY, maxTicksLimit: 5 } },
          y: { grid: { display: false }, border: { display: false }, ticks: { autoSkip: false, callback: yLabel(priceLabels) } }
        }
      }
    });

    // 3. Occupancy in the period per room (%), least occupied first; dark = occupied now, light = vacant now.
    const occLabels = occ.map(r => roomLabel(r));
    this.upsert('occ', occ.length ? occCanvas : undefined, {
      type: 'bar',
      data: {
        labels: occLabels,
        datasets: [{
          label: 'Occupancy', data: occ.map(r => r.periodOccupancyPct),
          backgroundColor: occ.map(r => r.occupiedNow ? TEAL : TEAL_LIGHT),
          hoverBackgroundColor: occ.map(r => r.occupiedNow ? TEAL_DARK : TEAL_LIGHT_HOVER),
          borderRadius: 4, borderSkipped: 'start', maxBarThickness: 18, categoryPercentage: 0.8, barPercentage: 0.9,
          minBarLength: 2
        }]
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', axis: 'y', intersect: false },
        onHover: pointerOnHover,
        onClick: (_e: any, els: any[]) => { if (els.length) this.showRoom(els[0].index); },
        plugins: {
          legend: { display: false },
          tooltip: {
            ...TOOLTIP,
            callbacks: {
              title: (items: any[]) => {
                const r = occ[items[0]?.dataIndex];
                return r ? `${r.name}${r.location ? ' · ' + r.location : ''}` : '';
              },
              label: (c: any) => ` Occupied ${pct(c.parsed.x)} of the days so far`,
              afterLabel: (c: any) => {
                const r = occ[c.dataIndex];
                return r ? ` ${r.occupiedNow ? 'Occupied' : 'Vacant'} now · ${r.seats} seat${r.seats === 1 ? '' : 's'}` : '';
              },
              footer: () => 'Click for the row'
            }
          }
        },
        scales: {
          x: { min: 0, max: 100, grid: GRID, border: { display: false }, ticks: { stepSize: 25, padding: 6, callback: (v: any) => v + '%' } },
          y: { grid: { display: false }, border: { display: false }, ticks: { autoSkip: false, callback: yLabel(occLabels) } }
        }
      }
    });
  }
}

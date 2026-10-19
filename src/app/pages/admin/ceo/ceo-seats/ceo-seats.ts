import {
  Component, DestroyRef, ElementRef, afterRenderEffect, computed, effect, inject, input, signal, untracked, viewChild
} from '@angular/core';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { Subscription } from 'rxjs';
import type { CeoPeriod } from '../../../../services/ceo.service';
import { CeoSeats, CeoSeatsService, SEAT_RULE, SeatGroup } from '../../../../services/ceo-seats.service';
import type { DashError, DashRange } from '../../../../services/dashboard-api';
import {
  Chart, ChartKeyNav, DashKpi, GRID, LEGEND, TEAL, TEAL_DARK, TOOLTIP, applyChartDefaults, count, fullMoney, money, monthLong,
  monthShort, pct
} from '../ceo-shared';
import { periodTitleOf, periodWords } from '../period-range';
import { signedPct } from '../ceo-rooms/rooms-view';
import { SeatFilter, SeatsDrawer, SeatsDrill, SeatsScope } from './seats-drawer';

/** Room occupancy line on the 12-month chart: a muted slate beside the teal seat line (ceo-shared has no slate line colour). */
const ROOM_LINE = '#94a3b8';

/** "12.3" / "-4" (percentage points, one decimal only when it matters). */
export function pts(v: number | null | undefined): string {
  return pct(v).replace('%', '');
}

/**
 * Seats section of the CEO dashboard: seat occupancy against room occupancy (a 9-seat office sold for 5 seats is
 * full by rooms, 5 of 9 by seats), revenue per seat against the list price, and the rent the empty seats could earn.
 * KPI cards, seats sold now per shift, seats against rooms over 12 months (chart or table), and by location / space
 * type; a row opens its rooms in a drawer. "Now" figures follow the location picker only; the period figures follow
 * the period too. Data: GET api/ceo/seats (database script SEAT_01; before it, only the API's message shows).
 */
@Component({
  selector: 'app-ceo-seats',
  standalone: true,
  imports: [DatePipe, NgTemplateOutlet, SeatsDrawer],
  templateUrl: './ceo-seats.html',
  styleUrls: ['../ceo-dashboard.css', './ceo-seats.css']
})
export class CeoSeatsSection {
  private seatsApi = inject(CeoSeatsService);
  private host = inject(ElementRef<HTMLElement>);

  period = input.required<CeoPeriod>();
  /** The dashboard's custom range (period custom). */
  range = input<DashRange | null>(null);
  locationId = input<number | null>(null);
  /** Bumped by the dashboard's refresh button. */
  reload = input(0);
  /** Bumped by the dashboard's auto refresh: reload without dimming the section (an open drawer stays). */
  quietReload = input(0);

  readonly money = money;
  readonly fullMoney = fullMoney;
  readonly pct = pct;
  readonly pts = pts;
  readonly count = count;
  readonly monthLong = monthLong;
  readonly rule = SEAT_RULE;

  data = signal<CeoSeats | null>(null);
  loading = signal(true);
  refreshing = signal(false);
  error = signal<DashError | null>(null);

  /** 12-month panel: the table instead of the chart. */
  trendTable = signal(false);
  /** The rooms drawer (null = closed). */
  drill = signal<SeatsDrill | null>(null);
  chartAnnounce = signal('');

  private sub: Subscription | null = null;
  private dataKey = '';
  private drillId = 0;
  private chart: Chart | null = null;
  private trendCanvas = viewChild<ElementRef<HTMLCanvasElement>>('trendCanvas');

  constructor() {
    inject(DestroyRef).onDestroy(() => { this.sub?.unsubscribe(); this.destroyChart(); });
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
    // Draws (or updates) the chart once its canvas is on the page and whenever its data changes.
    afterRenderEffect(() => this.renderChart());
  }

  // ---------- loading ----------

  /** quiet: the auto refresh (the figures on screen stay as they are until the new ones arrive). */
  load(quiet = false) {
    this.sub?.unsubscribe();
    if (!quiet) { if (this.data()) this.refreshing.set(true); else this.loading.set(true); }
    const range = this.period() === 'custom' ? this.range() : null;
    const key = `${this.period()}|${range?.from ?? ''}|${range?.to ?? ''}|${this.locationId() ?? ''}`;
    this.sub = this.seatsApi.get(this.period(), this.locationId(), range).subscribe({
      next: d => {
        this.data.set(d);
        this.dataKey = key;
        this.error.set(null);
        this.loading.set(false);
        this.refreshing.set(false);
      },
      error: (err: unknown) => {
        this.error.set(CeoSeatsService.describeError(err));
        // Seats of another period / location would be misleading: keep them only for a plain refresh.
        if (this.dataKey !== key) { this.data.set(null); this.dataKey = ''; this.drill.set(null); this.destroyChart(); }
        this.loading.set(false);
        this.refreshing.set(false);
      }
    });
  }

  // ---------- figures ----------

  s = computed(() => this.data()?.summary ?? null);
  rooms = computed(() => this.data()?.rooms ?? []);
  months = computed(() => this.data()?.months ?? []);
  noRooms = computed(() => !this.rooms().length && !(this.s()?.rooms));

  private shownPeriod = computed<CeoPeriod>(() => this.data()?.period ?? this.period());
  private shownRange = computed(() => this.data()?.range ?? this.range());
  periodTitle = computed(() => this.data()?.periodLabel || periodTitleOf(this.shownPeriod(), this.shownRange()));
  /** "this month" / "in this range" (the figures on screen). */
  thisWord = computed(() => periodWords(this.shownPeriod(), this.shownRange()).thisP);

  kpis = computed<DashKpi[]>(() => {
    const s = this.s();
    if (!s) return [];
    const occTone = (p: number): DashKpi['tone'] => (!s.seats ? 'neutral' : p >= 70 ? 'ok' : p >= 40 ? 'neutral' : 'warn');
    const custom = this.shownPeriod() === 'custom';
    const thisWord = this.thisWord();
    const soFar = custom ? 'Days of the range' : `${thisWord.charAt(0).toUpperCase()}${thisWord.slice(1)} so far`;
    const list = s.listSeatPriceSold;
    const vs = s.revenueVsListPct;
    const unpriced = s.emptySeatsUnpriced
      ? `${count(s.emptySeatsUnpriced)} empty seat${s.emptySeatsUnpriced === 1 ? '' : 's'} without a list price, not counted`
      : '';
    return [
      {
        key: 'seats', label: 'Seat occupancy now', value: pct(s.seatOccupancyPct),
        sub: `${count(s.seatsSold)} of ${count(s.seats)} seats`, tone: occTone(s.seatOccupancyPct),
        full: `${count(s.seatsSold)} of ${count(s.seats)} seats sold now. ${SEAT_RULE}`,
        action: () => this.focusEl('panel-seats-trend'), actionLabel: 'Show seats against rooms over 12 months'
      },
      {
        key: 'rooms', label: 'Rooms occupied now', value: pct(s.roomOccupancyPct),
        sub: `Seats ${pct(s.seatOccupancyPct)} · gap ${pts(s.gapPts)} pts`,
        tone: s.gapPts >= 10 ? 'warn' : 'neutral',
        full: `${count(s.roomsOccupied)} of ${count(s.rooms)} rooms have a booking now; the rooms look ${pts(s.gapPts)} points fuller than the seats are`,
        action: () => this.focusEl('panel-seats-trend'), actionLabel: 'Show seats against rooms over 12 months'
      },
      {
        key: 'empty', label: 'Empty seats', value: count(s.emptySeats),
        sub: s.partlyFilledRooms
          ? `${count(s.partlyFilledEmptySeats)} in ${count(s.partlyFilledRooms)} room${s.partlyFilledRooms === 1 ? '' : 's'} already let`
          : 'None in rooms already let',
        full: s.partlyFilledRooms
          ? `${count(s.partlyFilledEmptySeats)} empty seats are in ${count(s.partlyFilledRooms)} rooms that have a booking now`
          : '',
        tone: !s.emptySeats ? 'ok' : s.partlyFilledEmptySeats ? 'warn' : 'neutral',
        action: () => this.openAll(s.partlyFilledRooms ? 'partly' : 'all'),
        actionLabel: s.partlyFilledRooms ? 'Open the rooms already let that have empty seats' : 'Open every room'
      },
      {
        key: 'rps', label: 'Revenue per seat a month', value: money(s.revenuePerSeat),
        sub: list !== null ? `List ${money(list)} a seat${vs !== null ? ' · ' + signedPct(vs) : ''}` : 'No list price to compare',
        full: `${fullMoney(s.revenuePerSeat)} a month per seat sold (${fullMoney(s.soldMonthly)} a month for ${count(s.seatsSold)} seats)`
          + (list !== null ? `; list ${fullMoney(list)} a seat` : ''),
        tone: vs === null ? 'neutral' : vs < -0.5 ? 'warn' : vs > 0.5 ? 'ok' : 'neutral',
        action: () => this.focusEl('panel-seats-loc'), actionLabel: 'Show seats by location'
      },
      {
        key: 'rent', label: 'Rent not earned a month', value: money(s.rentNotEarned),
        sub: `Empty seats at list price${unpriced ? ' · ' + count(s.emptySeatsUnpriced) + ' unpriced' : ''}`,
        full: `${fullMoney(s.rentNotEarned)} a month: the empty seats at their room's list price a seat${unpriced ? '. ' + unpriced : ''}`,
        tone: s.rentNotEarned > 0 ? 'warn' : 'ok',
        action: () => this.openAll('all'), actionLabel: 'Open every room, most rent not earned first'
      },
      {
        key: 'period', label: custom ? 'Seats in the range' : `Seats ${thisWord}`, value: pct(s.periodSeatOccupancyPct),
        sub: `${soFar} · rooms ${pct(s.periodRoomOccupancyPct)}`,
        full: `Seat-days sold ${pct(s.periodSeatOccupancyPct)} against room-days with a booking ${pct(s.periodRoomOccupancyPct)}`
          + (s.periodDays ? ` (${count(s.periodDays)} day${s.periodDays === 1 ? '' : 's'})` : ''),
        tone: occTone(s.periodSeatOccupancyPct)
      }
    ];
  });

  /** Seats sold now per shift, bars against the largest. */
  shiftRows = computed(() => {
    const list = this.data()?.byShift ?? [];
    const top = Math.max(1, ...list.map(x => x.seats));
    return list.map(x => ({ ...x, w: (x.seats / top) * 100 }));
  });
  noShiftSeats = computed(() => !this.shiftRows().some(x => x.seats > 0) && !this.s()?.seatsSold);

  byLocation = computed(() => this.data()?.byLocation ?? []);
  bySpaceType = computed(() => this.data()?.bySpaceType ?? []);

  trendEmpty = computed(() => !this.months().some(m => m.seats > 0 || m.rooms > 0));

  // ---------- drill-down ----------

  /** A location / space type row: its rooms in the drawer. */
  openGroup(scope: Exclude<SeatsScope, 'all'>, g: SeatGroup) {
    this.drill.set({
      id: ++this.drillId, scope, key: scope === 'location' ? g.locationId : g.spaceTypeId, name: this.groupName(scope, g)
    });
  }

  openAll(filter: SeatFilter) {
    this.drill.set({ id: ++this.drillId, scope: 'all', key: null, name: '', filter });
  }

  /** The name from the API; a group without one is the rooms with no location / space type. */
  groupName(scope: Exclude<SeatsScope, 'all'>, g: SeatGroup): string {
    return g.name || (scope === 'location' ? 'No location' : 'No space type');
  }

  groupAria(scope: Exclude<SeatsScope, 'all'>, g: SeatGroup): string {
    return `${this.groupName(scope, g)}: ${pct(g.seatOccupancyPct)} of seats sold, ${count(g.seatsSold)} of ${count(g.seats)}; `
      + `rooms ${pct(g.roomOccupancyPct)} occupied; ${fullMoney(g.rentNotEarned)} a month not earned. Open its rooms`;
  }

  // ---------- leading to a panel ----------

  focusEl(id: string) {
    const el = this.host.nativeElement.querySelector(`#${id}`) as HTMLElement | null;
    if (!el) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    el.focus({ preventScroll: true });
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1600);
  }

  // ---------- chart ----------

  readonly trendNav = new ChartKeyNav({
    charts: () => [this.chart ?? undefined],
    count: () => this.months().length,
    describe: i => {
      const m = this.months()[i];
      return m ? `${monthLong(m.month)}: seats ${pct(m.seatOccupancyPct)} sold (${count(m.seatsSold)} of ${count(m.seats)}), `
        + `rooms ${pct(m.roomOccupancyPct)} occupied (${count(m.roomsOccupied)} of ${count(m.rooms)}).` : '';
    },
    // A month opens nothing; the table view has every figure.
    pick: () => {},
    announce: t => this.chartAnnounce.set(t)
  });

  private destroyChart() {
    this.chart?.destroy();
    this.chart = null;
  }

  private renderChart() {
    const d = this.data();
    const ref = this.trendCanvas();
    const months = this.months();
    const empty = this.trendEmpty();
    if (!d || !d.available || !ref || empty) { this.destroyChart(); return; }
    applyChartDefaults();
    const last = months.length - 1;
    const config: any = {
      type: 'line',
      data: {
        labels: months.map((m, i) => monthShort(m.month, i === 0)),
        datasets: [
          {
            label: 'Seats sold', data: months.map(m => m.seatOccupancyPct),
            borderColor: TEAL, backgroundColor: TEAL, borderWidth: 2.5, tension: 0.3, fill: false,
            pointRadius: 3.5, pointHoverRadius: 6, pointHitRadius: 14, pointBackgroundColor: TEAL_DARK, pointBorderColor: '#fff',
            pointBorderWidth: 1.5, pointHoverBackgroundColor: TEAL_DARK, pointHoverBorderColor: '#fff', pointHoverBorderWidth: 2
          },
          {
            label: 'Rooms occupied', data: months.map(m => m.roomOccupancyPct),
            borderColor: ROOM_LINE, backgroundColor: ROOM_LINE, borderWidth: 2, borderDash: [6, 4], tension: 0.3, fill: false,
            pointRadius: 3, pointHoverRadius: 5, pointHitRadius: 14, pointBackgroundColor: ROOM_LINE, pointBorderColor: '#fff',
            pointBorderWidth: 1.5, pointHoverBackgroundColor: ROOM_LINE, pointHoverBorderColor: '#fff', pointHoverBorderWidth: 2
          }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: LEGEND,
          tooltip: {
            ...TOOLTIP,
            callbacks: {
              title: (items: any[]) => {
                const i = items[0]?.dataIndex;
                const m = months[i];
                return m ? `${monthLong(m.month)}${i === last ? ' (now)' : ''}` : '';
              },
              label: (c: any) => {
                const m = months[c.dataIndex];
                if (!m) return '';
                return c.datasetIndex === 0
                  ? ` Seats sold: ${pct(c.parsed.y)} (${count(m.seatsSold)} of ${count(m.seats)})`
                  : ` Rooms occupied: ${pct(c.parsed.y)} (${count(m.roomsOccupied)} of ${count(m.rooms)})`;
              },
              footer: (items: any[]) => {
                const m = months[items[0]?.dataIndex];
                return m ? `Gap ${pts(m.roomOccupancyPct - m.seatOccupancyPct)} pts` : '';
              }
            }
          }
        },
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 8 } },
          y: {
            min: 0, max: 100, grid: GRID, border: { display: false },
            ticks: { stepSize: 25, padding: 8, callback: (v: any) => v + '%' }
          }
        }
      }
    };
    // Updated in place (no flash) while it sits on the same canvas.
    if (this.chart && this.chart.canvas === ref.nativeElement) {
      this.chart.data = config.data;
      this.chart.options = config.options;
      this.chart.update();
      return;
    }
    this.destroyChart();
    this.chart = new Chart(ref.nativeElement, config);
  }
}

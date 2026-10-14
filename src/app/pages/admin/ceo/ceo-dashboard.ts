import { Component, DestroyRef, ElementRef, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { Subscription } from 'rxjs';
import { AuthService } from '../../../services/auth.service';
import {
  CeoDashboard as CeoDashboardData, CeoError, CeoForecastMonth, CeoFunnelStage, CeoLocation, CeoPeriod, CeoService
} from '../../../services/ceo.service';
import { CeoDrawer } from './ceo-drawer/ceo-drawer';
import {
  AGING_COLORS, AGING_FALLBACK, AXIS_MONEY, Chart, ChartKeyNav, DrillLevel, DrillRequest, GRID, INQUIRY_TYPES, LEGEND, TEAL,
  TEAL_DARK, TEAL_LIGHT, TEAL_LIGHT_HOVER, TOOLTIP, Trend, applyChartDefaults, count, fullMoney, inquiryTypeKey, money,
  monthLong, monthShort, pct, periodWord, pointerOnHover, ratio, trend
} from './ceo-shared';

interface Kpi {
  key: string;
  label: string;
  value: string;
  full?: string;
  sub: string;
  tone: 'ok' | 'warn' | 'danger' | 'neutral';
  trend?: Trend | null;
  vs?: string;
  /** What a click does; none = a plain figure. */
  action?: () => void;
  actionLabel?: string;
}

type ChartKey = 'revenue' | 'aging' | 'occupancy' | 'bookings';

/** Same y-axis width on the stacked occupancy / new bookings charts, so their months line up. */
const Y_AXIS_WIDTH = (scale: any) => { scale.width = 46; };

/**
 * CEO dashboard (/admin/ceo): company-wide money, occupancy, sales and team figures for this month / quarter /
 * year, all locations or one. Every chart and list drills down in a side drawer (breakdown, then records).
 * Read-only. Data: GET api/ceo/dashboard (+ GET api/dashboard/forecast for the 3-month outlook).
 */
@Component({
  selector: 'app-ceo-dashboard',
  standalone: true,
  imports: [DatePipe, NgTemplateOutlet, CeoDrawer],
  templateUrl: './ceo-dashboard.html',
  styleUrl: './ceo-dashboard.css'
})
export class CeoDashboard {
  private ceo = inject(CeoService);
  private auth = inject(AuthService);
  private host = inject(ElementRef<HTMLElement>);

  readonly money = money;
  readonly fullMoney = fullMoney;
  readonly pct = pct;
  readonly count = count;
  readonly monthLong = monthLong;
  readonly isCeo = this.auth.isCeoOnly();

  readonly periods: { key: CeoPeriod; label: string }[] = [
    { key: 'month', label: 'This month' }, { key: 'quarter', label: 'Quarter' }, { key: 'year', label: 'Year' }
  ];
  period = signal<CeoPeriod>('month');
  locationId = signal<number | null>(null);

  data = signal<CeoDashboardData | null>(null);
  /** First load (skeletons); later loads keep the current figures dimmed instead. */
  loading = signal(true);
  refreshing = signal(false);
  error = signal<CeoError | null>(null);
  lastUpdated = signal<Date | null>(null);

  forecast = signal<CeoForecastMonth[] | null>(null);
  forecastLoading = signal(true);
  forecastError = signal<CeoError | null>(null);

  drill = signal<DrillRequest | null>(null);
  /** Screen reader text for the chart that has keyboard focus. */
  chartAnnounce = signal('');

  /** Every location seen so far (the list stays complete while one location is selected). */
  private knownLocations = signal<CeoLocation[]>([]);
  locations = computed(() => this.knownLocations());

  private sub: Subscription | null = null;
  private forecastSub: Subscription | null = null;
  private drillId = 0;
  private charts = new Map<ChartKey, Chart>();
  private clock?: ReturnType<typeof setInterval>;
  private nowTick = signal(Date.now());

  private revenueCanvas = viewChild<ElementRef<HTMLCanvasElement>>('revenueCanvas');
  private agingCanvas = viewChild<ElementRef<HTMLCanvasElement>>('agingCanvas');
  private occCanvas = viewChild<ElementRef<HTMLCanvasElement>>('occCanvas');
  private bookingsCanvas = viewChild<ElementRef<HTMLCanvasElement>>('bookingsCanvas');

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.sub?.unsubscribe();
      this.forecastSub?.unsubscribe();
      this.destroyCharts();
      if (this.clock) clearInterval(this.clock);
    });
    this.clock = setInterval(() => this.nowTick.set(Date.now()), 30_000);

    effect(() => {
      this.period();
      this.locationId();
      untracked(() => { this.load(); this.loadForecast(); });
    });
  }

  // ---------- loading ----------

  load() {
    this.sub?.unsubscribe();
    if (this.data()) this.refreshing.set(true); else this.loading.set(true);
    this.sub = this.ceo.getDashboard(this.period(), this.locationId()).subscribe({
      next: d => {
        this.data.set(d);
        this.error.set(null);
        this.loading.set(false);
        this.refreshing.set(false);
        this.lastUpdated.set(new Date());
        if (d.locations.length) {
          const byId = new Map(this.knownLocations().map(l => [l.locationId, l]));
          d.locations.forEach(l => byId.set(l.locationId, l));
          this.knownLocations.set([...byId.values()].sort((a, b) => a.name.localeCompare(b.name)));
        }
        setTimeout(() => this.renderCharts());
      },
      error: (err: CeoError) => {
        this.error.set(CeoService.describeError(err));
        this.loading.set(false);
        this.refreshing.set(false);
      }
    });
  }

  loadForecast() {
    this.forecastSub?.unsubscribe();
    this.forecastLoading.set(true);
    this.forecastSub = this.ceo.getForecast(this.locationId(), 3).subscribe({
      next: f => { this.forecast.set(f); this.forecastError.set(null); this.forecastLoading.set(false); },
      error: (err: CeoError) => { this.forecastError.set(CeoService.describeError(err)); this.forecastLoading.set(false); }
    });
  }

  refresh() {
    this.load();
    this.loadForecast();
  }

  setPeriod(p: CeoPeriod) { if (p !== this.period()) this.period.set(p); }

  setLocation(value: string) {
    const id = Number(value);
    this.locationId.set(id > 0 ? id : null);
  }

  // ---------- header ----------

  readonly today = new Date();

  greeting = computed(() => {
    this.nowTick();
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  });

  firstName = computed(() => {
    const u = this.auth.user();
    const raw = (u?.displayName || u?.email?.split('@')[0] || 'there').trim();
    const first = raw.split(/[\s._-]+/)[0].replace(/\d+$/, '') || raw;
    return first.charAt(0).toUpperCase() + first.slice(1);
  });

  locationName = computed(() => {
    const id = this.locationId();
    if (!id) return 'All locations';
    return this.locations().find(l => l.locationId === id)?.name ?? 'Selected location';
  });

  periodTitle = computed(() => this.data()?.periodLabel
    || { month: 'This month', quarter: 'This quarter', year: 'This year' }[this.period()]);
  word = computed(() => periodWord(this.period()));

  updatedAgo = computed(() => {
    const at = this.lastUpdated();
    if (!at) return '';
    const mins = Math.floor((this.nowTick() - at.getTime()) / 60000);
    return mins < 1 ? 'just now' : mins === 1 ? '1 min ago' : mins < 60 ? `${mins} min ago` : at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  });

  // ---------- Money ----------

  m = computed(() => this.data()?.money ?? null);

  moneyKpis = computed<Kpi[]>(() => {
    const m = this.m();
    if (!m) return [];
    const w = this.word();
    const rate = m.collectionRate;
    return [
      {
        key: 'invoiced', label: `Invoiced this ${w}`, value: money(m.invoiced), full: fullMoney(m.invoiced),
        sub: `${money(m.invoicedPrev)} last ${w}`, tone: 'neutral',
        trend: trend(m.invoiced, m.invoicedPrev, '%'), vs: `vs last ${w}`,
        action: () => this.focusPanel('panel-revenue'), actionLabel: 'Show the revenue chart'
      },
      {
        key: 'collected', label: `Collected this ${w}`, value: money(m.collected), full: fullMoney(m.collected),
        sub: `${money(m.collectedPrev)} last ${w}`, tone: 'neutral',
        trend: trend(m.collected, m.collectedPrev, '%'), vs: `vs last ${w}`,
        action: () => this.focusPanel('panel-revenue'), actionLabel: 'Show the revenue chart'
      },
      {
        key: 'rate', label: 'Collection rate', value: pct(rate),
        sub: m.invoiced > 0 ? `of ${money(m.invoiced)} invoiced` : 'Nothing invoiced yet',
        tone: m.invoiced <= 0 ? 'neutral' : rate >= 80 ? 'ok' : rate >= 50 ? 'warn' : 'danger',
        action: () => this.focusPanel('panel-revenue'), actionLabel: 'Show the revenue chart'
      },
      {
        key: 'outstanding', label: 'Outstanding', value: money(m.outstanding), full: fullMoney(m.outstanding),
        sub: `${count(m.outstandingCount)} unpaid invoice${m.outstandingCount === 1 ? '' : 's'}`,
        tone: m.outstanding > 0 ? 'neutral' : 'ok',
        action: () => this.focusPanel('panel-aging'), actionLabel: 'Show receivables aging'
      },
      {
        key: 'overdue', label: 'Overdue', value: money(m.overdue), full: fullMoney(m.overdue),
        sub: m.overdueCount ? `${count(m.overdueCount)} past due date` : 'Nothing overdue',
        tone: m.overdueCount ? 'danger' : 'ok',
        action: () => this.openRecords('Invoices', 'Overdue', 'invoices', { status: 'overdue' }), actionLabel: 'Open the overdue invoices'
      }
    ];
  });

  revenueTotals = computed(() => {
    const months = this.m()?.months ?? [];
    const invoiced = months.reduce((a, x) => a + x.invoiced, 0);
    const collected = months.reduce((a, x) => a + x.collected, 0);
    return { invoiced, collected, rate: ratio(collected, invoiced) };
  });
  revenueEmpty = computed(() => !(this.m()?.months ?? []).some(x => x.invoiced > 0 || x.collected > 0));
  agingTotal = computed(() => (this.m()?.aging ?? []).reduce((a, b) => a + b.amount, 0));
  agingEmpty = computed(() => !(this.m()?.aging ?? []).some(a => a.amount > 0));
  agingColor(bucket: string, i: number): string { return AGING_COLORS[bucket] ?? AGING_FALLBACK[i % AGING_FALLBACK.length]; }
  topMax = computed(() => Math.max(1, ...(this.m()?.topCustomers ?? []).map(c => c.amount)));

  /** Table view of the 12-month charts (toggle). */
  revenueTable = signal(false);
  occTable = signal(false);

  forecastMaxRent = computed(() => Math.max(1, ...(this.forecast() ?? []).map(f => f.expectedRent)));
  forecastTotals = computed(() => {
    const f = this.forecast() ?? [];
    return {
      rent: f.reduce((a, x) => a + x.expectedRent, 0),
      ending: f.reduce((a, x) => a + x.leasesEnding, 0),
      starting: f.reduce((a, x) => a + x.leasesStarting, 0)
    };
  });
  forecastEmpty = computed(() => !(this.forecast() ?? []).some(f => f.expectedRent > 0 || f.occupiedSpaces > 0 || f.leasesStarting > 0));

  // ---------- Occupancy ----------

  o = computed(() => this.data()?.occupancy ?? null);

  occupancyKpis = computed<Kpi[]>(() => {
    const o = this.o();
    if (!o) return [];
    const w = this.word();
    return [
      {
        key: 'occupancy', label: 'Occupancy', value: pct(o.occupancyPct),
        sub: `${count(o.occupiedSpaces)} of ${count(o.totalSpaces)} spaces in use`,
        tone: o.totalSpaces === 0 ? 'neutral' : o.occupancyPct >= 70 ? 'ok' : o.occupancyPct >= 40 ? 'neutral' : 'warn',
        trend: trend(o.occupancyPct, o.occupancyPctPrev, 'pts'), vs: `vs a ${w} ago`,
        action: () => this.focusPanel('panel-by-location'), actionLabel: 'Show occupancy by location'
      },
      {
        key: 'active', label: 'Active bookings', value: count(o.activeBookings), sub: 'Running today', tone: 'neutral'
      },
      {
        key: 'new', label: `New bookings this ${w}`, value: count(o.newBookings),
        sub: `${count(o.newBookingsPrev)} last ${w}`, tone: 'neutral',
        trend: trend(o.newBookings, o.newBookingsPrev, 'n'), vs: `vs last ${w}`,
        action: () => this.openRecords('New bookings', this.periodTitle(), 'bookings', {}), actionLabel: 'Open the new bookings'
      }
    ];
  });

  occEmpty = computed(() => !(this.o()?.months ?? []).some(x => x.occupancyPct > 0 || x.newBookings > 0));
  byTypeEmpty = computed(() => !(this.o()?.byType ?? []).some(t => t.total > 0));
  byLocationEmpty = computed(() => !(this.o()?.byLocation ?? []).some(t => t.total > 0));

  /** Days until a lease ends (0 = today). */
  daysLeft(date: string): number {
    const d = new Date(date.length <= 10 ? date + 'T00:00:00' : date);
    if (isNaN(d.getTime())) return 0;
    const t = new Date(); t.setHours(0, 0, 0, 0); d.setHours(0, 0, 0, 0);
    return Math.max(0, Math.round((d.getTime() - t.getTime()) / 86400000));
  }
  expiringTotal = computed(() => (this.o()?.leasesExpiring ?? []).reduce((a, l) => a + l.monthlyAmount, 0));

  // ---------- Sales ----------

  s = computed(() => this.data()?.sales ?? null);
  funnelMax = computed(() => Math.max(1, ...(this.s()?.funnel ?? []).map(f => f.count)));
  funnelEmpty = computed(() => !(this.s()?.funnel ?? []).some(f => f.count > 0));
  inquiryTotal = computed(() => (this.s()?.inquiriesByType ?? []).reduce((a, t) => a + t.count, 0));
  inquiryMax = computed(() => Math.max(1, ...(this.s()?.inquiriesByType ?? []).map(t => t.count)));
  typeStyle(type: string) { return INQUIRY_TYPES[inquiryTypeKey(type)]; }
  /** Teal steps for the funnel stages (ordered, light to dark). */
  private readonly funnelColors = ['#99f6e4', '#5eead4', '#14b8a6', '#0f766e'];
  funnelColor(i: number): string { return this.funnelColors[Math.min(i, this.funnelColors.length - 1)]; }

  /** Share of the previous stage that reached this one ("62% of quotations"). */
  stepText(i: number): string {
    const f = this.s()?.funnel ?? [];
    if (i === 0) return '';
    if (!f[i - 1]?.count) return '-';
    return `${pct(ratio(f[i].count, f[i - 1].count))} of ${f[i - 1].label.toLowerCase()}`;
  }

  // ---------- Team ----------

  t = computed(() => this.data()?.team ?? null);
  people = computed(() => [...(this.t()?.people ?? [])].sort((a, b) => b.convertedValue - a.convertedValue || b.converted - a.converted || b.quotations - a.quotations));
  teamEmpty = computed(() => !(this.t()?.perLocation ?? []).length && !(this.t()?.people ?? []).length);

  // ---------- drill-down ----------

  private openDrill(root: string, level: DrillLevel) {
    this.drill.set({ id: ++this.drillId, root, level });
  }

  private openRecords(root: string, crumb: string, kind: Extract<DrillLevel, { kind: 'records' }>['records'], params: Record<string, string | number>) {
    this.openDrill(root, { kind: 'records', records: kind, params, crumb });
  }

  closeDrill() { this.drill.set(null); }

  openRevenueMonth(i: number) {
    const month = this.m()?.months[i];
    if (month) this.openDrill('Revenue', { kind: 'breakdown', metric: 'revenue', params: { month: month.month }, crumb: monthLong(month.month) });
  }

  openAging(i: number) {
    const a = this.m()?.aging[i];
    if (a) this.openDrill('Receivables aging', { kind: 'breakdown', metric: 'aging', params: { bucket: a.bucket }, crumb: a.label });
  }

  openCustomer(customerId: number, name: string) {
    this.openRecords('Top customers', name, 'invoices', { customerId });
  }

  openBookingsMonth(i: number) {
    const month = this.o()?.months[i];
    if (month) this.openDrill('New bookings', { kind: 'breakdown', metric: 'bookings-month', params: { month: month.month }, crumb: monthLong(month.month) });
  }

  openSpaceType(spaceTypeId: number, name: string) {
    this.openDrill('Occupancy by space type', { kind: 'breakdown', metric: 'occupancy-type', params: { spaceTypeId }, crumb: name });
  }

  openOccLocation(locationId: number, name: string) {
    this.openDrill('Occupancy by location', { kind: 'breakdown', metric: 'occupancy-location', params: { locationId }, crumb: name });
  }

  openFunnel(stage: CeoFunnelStage) {
    const key = stage.stage.toLowerCase();
    if (key === 'inquiries') this.openRecords('Sales funnel', stage.label, 'inquiries', {});
    else if (key === 'quotations' || key === 'accepted') this.openRecords('Sales funnel', stage.label, 'quotations', { stage: key });
    else if (key === 'bookings') this.openRecords('Sales funnel', stage.label, 'bookings', {});
  }

  openInquiryType(type: string, label: string) {
    this.openDrill('Tour inquiries', { kind: 'breakdown', metric: 'inquiries-type', params: { type }, crumb: label });
  }

  openPerson(userId: number, name: string) {
    this.openDrill('Team', { kind: 'breakdown', metric: 'staff', params: { userId }, crumb: name });
  }

  /** KPI that points at a chart: scroll it into view and move focus there. */
  focusPanel(id: string) {
    const el = this.host.nativeElement.querySelector(`#${id}`) as HTMLElement | null;
    if (!el) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
    el.focus({ preventScroll: true });
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1600);
  }

  // ---------- charts ----------

  readonly revenueNav = new ChartKeyNav({
    charts: () => [this.charts.get('revenue')],
    count: () => this.m()?.months.length ?? 0,
    describe: i => {
      const x = this.m()?.months[i];
      return x ? `${monthLong(x.month)}: invoiced ${fullMoney(x.invoiced)}, collected ${fullMoney(x.collected)}. Press Enter for the breakdown by location.` : '';
    },
    pick: i => this.openRevenueMonth(i),
    announce: t => this.chartAnnounce.set(t)
  });

  readonly agingNav = new ChartKeyNav({
    charts: () => [this.charts.get('aging')],
    count: () => this.m()?.aging.length ?? 0,
    describe: i => {
      const a = this.m()?.aging[i];
      return a ? `${a.label}: ${fullMoney(a.amount)}, ${a.count} invoice${a.count === 1 ? '' : 's'}. Press Enter for the breakdown by location.` : '';
    },
    pick: i => this.openAging(i),
    announce: t => this.chartAnnounce.set(t)
  });

  readonly occNav = new ChartKeyNav({
    charts: () => [this.charts.get('occupancy'), this.charts.get('bookings')],
    count: () => this.o()?.months.length ?? 0,
    describe: i => {
      const x = this.o()?.months[i];
      return x ? `${monthLong(x.month)}: occupancy ${pct(x.occupancyPct)}, ${x.newBookings} new booking${x.newBookings === 1 ? '' : 's'}. Press Enter for the new bookings by location.` : '';
    },
    pick: i => this.openBookingsMonth(i),
    announce: t => this.chartAnnounce.set(t)
  });

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
    if (!d) return;
    applyChartDefaults();
    const months = d.money?.months ?? [];
    const occ = d.occupancy?.months ?? [];

    // Revenue & collections: invoiced vs collected, one PKR axis (the collection rate is in the panel header).
    this.upsert('revenue', this.revenueEmpty() ? undefined : this.revenueCanvas(), {
      type: 'bar',
      data: {
        labels: months.map((x, i) => monthShort(x.month, i === 0)),
        datasets: [
          { label: 'Invoiced', data: months.map(x => x.invoiced), backgroundColor: TEAL_LIGHT, hoverBackgroundColor: TEAL_LIGHT_HOVER, borderRadius: 4, maxBarThickness: 22, borderSkipped: 'start' },
          { label: 'Collected', data: months.map(x => x.collected), backgroundColor: TEAL, hoverBackgroundColor: TEAL_DARK, borderRadius: 4, maxBarThickness: 22, borderSkipped: 'start' }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        onHover: pointerOnHover,
        onClick: (_e: any, els: any[]) => { if (els.length) this.openRevenueMonth(els[0].index); },
        plugins: {
          legend: LEGEND,
          tooltip: {
            ...TOOLTIP,
            callbacks: {
              title: (items: any[]) => monthLong(months[items[0]?.dataIndex]?.month ?? ''),
              label: (c: any) => ` ${c.dataset.label}: ${fullMoney(c.parsed.y)}`,
              footer: (items: any[]) => {
                const x = months[items[0]?.dataIndex];
                return x && x.invoiced > 0 ? `Collection rate ${pct(ratio(x.collected, x.invoiced))} · click for locations` : 'Click for locations';
              }
            }
          }
        },
        scales: {
          x: { grid: { display: false }, border: { display: false } },
          y: { beginAtZero: true, grid: GRID, border: { display: false }, ticks: AXIS_MONEY }
        }
      }
    });

    // Receivables aging: part-to-whole by days past due.
    const aging = d.money?.aging ?? [];
    this.upsert('aging', this.agingEmpty() ? undefined : this.agingCanvas(), {
      type: 'doughnut',
      data: {
        labels: aging.map(a => a.label),
        datasets: [{
          data: aging.map(a => a.amount), backgroundColor: aging.map((a, i) => this.agingColor(a.bucket, i)),
          borderColor: '#fff', borderWidth: 2, hoverOffset: 8, hoverBorderColor: '#fff'
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '70%', layout: { padding: 8 },
        onHover: pointerOnHover,
        onClick: (_e: any, els: any[]) => { if (els.length) this.openAging(els[0].index); },
        plugins: {
          legend: { display: false },
          tooltip: {
            ...TOOLTIP,
            callbacks: {
              label: (c: any) => ` ${c.label}: ${fullMoney(c.parsed)}`,
              footer: (items: any[]) => { const a = aging[items[0]?.dataIndex]; return a ? `${a.count} invoice${a.count === 1 ? '' : 's'} · click for locations` : ''; }
            }
          }
        }
      }
    });

    // Occupancy (line, %) and new bookings (bars, count): two small charts on one time axis, never two y-scales.
    const occEmpty = this.occEmpty();
    this.upsert('occupancy', occEmpty ? undefined : this.occCanvas(), {
      type: 'line',
      data: {
        labels: occ.map((x, i) => monthShort(x.month, i === 0)),
        datasets: [{
          label: 'Occupancy', data: occ.map(x => x.occupancyPct), borderColor: TEAL, borderWidth: 2, tension: 0.35,
          fill: true, backgroundColor: (ctx: any) => {
            const { chart } = ctx; const area = chart.chartArea;
            if (!area) return 'rgba(13,148,136,0.10)';
            const g = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
            g.addColorStop(0, 'rgba(13,148,136,0.22)'); g.addColorStop(1, 'rgba(13,148,136,0.02)');
            return g;
          },
          pointRadius: 3, pointHoverRadius: 6, pointHitRadius: 14, pointBackgroundColor: '#fff', pointBorderColor: TEAL, pointBorderWidth: 2,
          pointHoverBackgroundColor: TEAL, pointHoverBorderColor: '#fff'
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        onHover: pointerOnHover,
        onClick: (_e: any, els: any[]) => { if (els.length) this.openBookingsMonth(els[0].index); },
        plugins: {
          legend: { display: false },
          tooltip: {
            ...TOOLTIP,
            callbacks: {
              title: (items: any[]) => monthLong(occ[items[0]?.dataIndex]?.month ?? ''),
              label: (c: any) => ` Occupancy: ${pct(c.parsed.y)}`,
              footer: (items: any[]) => { const x = occ[items[0]?.dataIndex]; return x ? `${x.newBookings} new booking${x.newBookings === 1 ? '' : 's'} · click for locations` : ''; }
            }
          }
        },
        scales: {
          // offset + fixed axis width: the points sit exactly above the new-bookings bars below.
          x: { offset: true, grid: { display: false }, border: { display: false }, ticks: { display: false } },
          y: { beginAtZero: true, max: 100, grid: GRID, border: { display: false }, afterFit: Y_AXIS_WIDTH, ticks: { callback: (v: any) => v + '%', stepSize: 25, padding: 8 } }
        }
      }
    });
    this.upsert('bookings', occEmpty ? undefined : this.bookingsCanvas(), {
      type: 'bar',
      data: {
        labels: occ.map((x, i) => monthShort(x.month, i === 0)),
        datasets: [{ label: 'New bookings', data: occ.map(x => x.newBookings), backgroundColor: '#5eead4', hoverBackgroundColor: TEAL, borderRadius: 4, maxBarThickness: 22 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        onHover: pointerOnHover,
        onClick: (_e: any, els: any[]) => { if (els.length) this.openBookingsMonth(els[0].index); },
        plugins: {
          legend: { display: false },
          tooltip: {
            ...TOOLTIP,
            callbacks: {
              title: (items: any[]) => monthLong(occ[items[0]?.dataIndex]?.month ?? ''),
              label: (c: any) => ` New bookings: ${c.parsed.y}`,
              footer: () => 'Click for locations'
            }
          }
        },
        scales: {
          x: { grid: { display: false }, border: { display: false } },
          y: { beginAtZero: true, grid: GRID, border: { display: false }, afterFit: Y_AXIS_WIDTH, ticks: { precision: 0, padding: 8, maxTicksLimit: 4 } }
        }
      }
    });
  }
}

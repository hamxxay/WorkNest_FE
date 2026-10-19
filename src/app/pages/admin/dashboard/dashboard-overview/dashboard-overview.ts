import { Component, DestroyRef, ElementRef, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { AdminService } from '../../../../services/admin.service';
import { DashboardDetailsService, OverviewDetailKind } from '../../../../services/dashboard-details.service';
import { CeoParams } from '../../../../services/ceo.service';
import { Chart } from '../../access/access-shared';
import { CeoDrawer } from '../../ceo/ceo-drawer/ceo-drawer';
import { ChartKeyNav, DrillRequest, monthLong, pointerOnHover } from '../../ceo/ceo-shared';
import { OccupiedRoomsDrawer } from '../occupied-rooms-drawer/occupied-rooms-drawer';
import { AGING_KEYS, overviewDrillSource, overviewLevel, spacesInUseLabel } from './overview-drill';

type AttentionTab = 'overdue' | 'ending' | 'pending';
export type DashPeriod = 'month' | 'quarter' | 'year';
/** The six overview charts. */
type ChartKey = 'revenue' | 'aging' | 'occupancy' | 'types' | 'customers' | 'expiries';

interface Kpi {
  key: string;
  label: string;
  value: string;
  sub: string;
  link: string;
  tone: 'ok' | 'warn' | 'danger' | 'neutral';
  trend?: { text: string; dir: 'up' | 'down' | 'flat'; good: boolean } | null;
  vs?: string;
  full?: string;
  /** Opens a list on the dashboard instead of following link (Occupancy: the rooms in use). */
  opens?: 'rooms';
}

/**
 * Admin dashboard top section: headline numbers (with last-month comparison), a "Needs attention"
 * panel and a 6-month invoiced / paid / occupancy chart. One request (GET api/dashboard/overview);
 * shows placeholder blocks while loading, independent of the rest of the dashboard.
 * The Occupancy card opens the rooms in use right now (OccupiedRoomsDrawer) instead of a page.
 * Every chart drills down: a click on a bar / slice / point (or Enter / Space on the focused chart) opens the
 * records behind it in the CEO drawer (CeoDrawer with overviewDrillSource: GET api/dashboard/overview-details/{kind},
 * database update DASH_02); arrow keys move between the chart's points, Escape closes the drawer.
 */
@Component({
  selector: 'app-dashboard-overview',
  standalone: true,
  imports: [RouterLink, DatePipe, NgTemplateOutlet, OccupiedRoomsDrawer, CeoDrawer],
  templateUrl: './dashboard-overview.html',
  styleUrl: './dashboard-overview.css'
})
export class DashboardOverview {
  private admin = inject(AdminService);
  private details = inject(DashboardDetailsService);

  /** 'ALL' or a location id (as the dashboard's location filter holds it). */
  locationId = input<string>('ALL');
  /** Locations to total (one or several); empty = all the user may see. Takes precedence over locationId. */
  locationIds = input<number[]>([]);
  /** Bumped by the dashboard to reload. */
  refreshTick = input<number>(0);
  /** This month / quarter / year — every number and chart follows it. */
  period = input<DashPeriod>('month');
  customFrom = input<string | null>(null);
  customTo = input<string | null>(null);

  periodWord = computed(() => this.period());
  seriesLabel = computed(() => `Last ${this.period() === 'year' ? 24 : this.period() === 'quarter' ? 12 : 6} months`);
  aheadLabel = computed(() => `Next ${this.period() === 'year' ? 12 : this.period() === 'quarter' ? 6 : 3} months`);

  loading = signal(true);
  failed = signal(false);
  data = signal<any | null>(null);
  tab = signal<AttentionTab>('overdue');
  /** The rooms-in-use drawer (Occupancy card). */
  roomsOpen = signal(false);
  /** The locations the card counts, for its list of rooms (as load() asks the overview). */
  roomsLocationIds = computed<number[]>(() => {
    if (this.locationIds().length) return this.locationIds();
    const loc = this.locationId();
    return loc && loc !== 'ALL' && !isNaN(Number(loc)) ? [Number(loc)] : [];
  });

  // Chart canvases (always in the DOM; a placeholder covers them while loading)
  private revenueCanvas = viewChild<ElementRef<HTMLCanvasElement>>('revenueCanvas');
  private agingCanvas = viewChild<ElementRef<HTMLCanvasElement>>('agingCanvas');
  private occCanvas = viewChild<ElementRef<HTMLCanvasElement>>('occCanvas');
  private typeCanvas = viewChild<ElementRef<HTMLCanvasElement>>('typeCanvas');
  private custCanvas = viewChild<ElementRef<HTMLCanvasElement>>('custCanvas');
  private expCanvas = viewChild<ElementRef<HTMLCanvasElement>>('expCanvas');
  private charts = new Map<ChartKey, Chart>();

  // ---------- chart drill-down (CeoDrawer) ----------

  /** What the drawer shows; null = closed. */
  drill = signal<DrillRequest<string, string> | null>(null);
  private drillId = 0;
  /** The drawer's lists follow the dashboard's locations and custom range (read when a list loads). */
  readonly drillSource = overviewDrillSource(this.details, () => ({
    locationIds: this.locationIds(),
    locationId: this.locationIdNumber(),
    customFrom: this.customFrom(),
    customTo: this.customTo()
  }));
  /** Screen reader text for the chart point that has keyboard focus. */
  chartAnnounce = signal('');

  private locationIdNumber(): number | null {
    const loc = this.locationId();
    return loc && loc !== 'ALL' && !isNaN(Number(loc)) ? Number(loc) : null;
  }

  private openDetail(root: string, kind: OverviewDetailKind, params: CeoParams, crumb: string) {
    this.drill.set({ id: ++this.drillId, root, level: overviewLevel(kind, params, crumb) });
  }

  closeDrill() { this.drill.set(null); }

  /** Revenue & collections: the invoices issued that month. */
  openRevenueMonth(i: number) {
    const m = this.data()?.months?.[i];
    if (m) this.openDetail('Revenue & collections', 'revenue-month', { month: m.month }, monthLong(m.month));
  }

  /** Receivables aging: the open invoices of that bucket. */
  openAging(i: number) {
    const a = this.data()?.aging?.[i];
    const bucket = AGING_KEYS[i];
    if (a && bucket) this.openDetail('Receivables aging', 'aging-bucket', { bucket }, a.label);
  }

  /** Occupancy & new bookings, a bar: the bookings made that month (with a link to the spaces in use). */
  openNewBookings(i: number) {
    const m = this.data()?.months?.[i];
    if (m) this.openDetail('Occupancy & new bookings', 'new-bookings', { month: m.month }, `New bookings, ${monthLong(m.month)}`);
  }

  /** Occupancy & new bookings, a point of the line: the spaces in use that month (with a link to its new bookings). */
  openOccupiedMonth(i: number) {
    const m = this.data()?.months?.[i];
    if (m) this.openDetail('Occupancy & new bookings', 'occupied-month', { month: m.month }, spacesInUseLabel(m.month));
  }

  /** Occupancy by space type: the type's spaces, booked and vacant. */
  openSpaceType(i: number) {
    const t = this.data()?.spaceTypes?.[i];
    if (t) this.openDetail('Occupancy by space type', 'space-type', { spaceType: t.spaceType }, t.spaceType);
  }

  /** Top customers: the customer's invoices in the period. */
  openCustomer(i: number) {
    const c = this.data()?.topCustomers?.[i];
    if (c) this.openDetail('Top customers', 'top-customer', { customer: c.label }, c.label);
  }

  /** Leases expiring: the leases ending that month. */
  openExpiry(i: number) {
    const e = this.data()?.leaseExpiries?.[i];
    if (e) this.openDetail('Leases expiring', 'leases-ending', { month: e.label }, monthLong(e.label));
  }

  /** What Enter / Space opens on each chart, and how many points it has. */
  private readonly picks: Record<ChartKey, { open: (i: number) => void; count: () => number }> = {
    revenue: { open: i => this.openRevenueMonth(i), count: () => this.data()?.months?.length ?? 0 },
    aging: { open: i => this.openAging(i), count: () => this.data()?.aging?.length ?? 0 },
    occupancy: { open: i => this.openNewBookings(i), count: () => this.data()?.months?.length ?? 0 },
    types: { open: i => this.openSpaceType(i), count: () => this.data()?.spaceTypes?.length ?? 0 },
    customers: { open: i => this.openCustomer(i), count: () => this.data()?.topCustomers?.length ?? 0 },
    expiries: { open: i => this.openExpiry(i), count: () => this.data()?.leaseExpiries?.length ?? 0 }
  };

  private nav(key: ChartKey, describe: (i: number) => string, start: 'first' | 'last'): ChartKeyNav {
    return new ChartKeyNav({
      charts: () => [this.charts.get(key)],
      count: () => this.picks[key].count(),
      describe,
      pick: i => this.picks[key].open(i),
      announce: t => this.chartAnnounce.set(t),
      start
    });
  }

  /** Arrow keys move between a chart's points (months start on the latest, rankings on the first). */
  readonly navs: Record<ChartKey, ChartKeyNav> = {
    revenue: this.nav('revenue', i => {
      const m = this.data()?.months?.[i];
      return m ? `${monthLong(m.month)}: invoiced ${this.fullMoney(m.invoiced)}, paid ${this.fullMoney(m.paid)}. Press Enter for the invoices.` : '';
    }, 'last'),
    aging: this.nav('aging', i => {
      const a = this.data()?.aging?.[i];
      return a ? `${a.label}: ${this.fullMoney(a.amount)} owed, ${a.count} invoice${a.count === 1 ? '' : 's'}. Press Enter for the invoices.` : '';
    }, 'first'),
    occupancy: this.nav('occupancy', i => {
      const m = this.data()?.months?.[i];
      return m ? `${monthLong(m.month)}: occupancy ${m.occupancyPct}%, ${m.newBookings} new booking${m.newBookings === 1 ? '' : 's'}. Press Enter for the new bookings.` : '';
    }, 'last'),
    types: this.nav('types', i => {
      const t = this.data()?.spaceTypes?.[i];
      return t ? `${t.spaceType}: ${t.occupied} of ${t.total} spaces booked. Press Enter for the spaces.` : '';
    }, 'first'),
    customers: this.nav('customers', i => {
      const c = this.data()?.topCustomers?.[i];
      return c ? `${c.label}: ${this.fullMoney(c.amount)} invoiced, ${c.count} invoice${c.count === 1 ? '' : 's'}. Press Enter for the invoices.` : '';
    }, 'first'),
    expiries: this.nav('expiries', i => {
      const e = this.data()?.leaseExpiries?.[i];
      return e ? `${monthLong(e.label)}: ${e.count} lease${e.count === 1 ? '' : 's'} ending, ${this.fullMoney(e.amount)}. Press Enter for the leases.` : '';
    }, 'first')
  };

  /** A chart takes keyboard focus once it shows data. */
  canNav(key: ChartKey): boolean {
    return !this.loading() && !this.empty()[key];
  }

  /** Keyboard focus (not a mouse click) highlights the chart's first point to visit. */
  chartFocus(key: ChartKey, e: FocusEvent) {
    if ((e.target as HTMLElement | null)?.matches(':focus-visible')) this.navs[key].focus();
  }

  /** Enter / Space opens the highlighted point, or the first one when none is; the rest is ChartKeyNav. */
  chartKey(key: ChartKey, e: KeyboardEvent) {
    const nav = this.navs[key];
    if ((e.key === 'Enter' || e.key === ' ') && nav.index < 0) {
      if (!this.picks[key].count()) return;
      e.preventDefault();
      e.stopPropagation();
      this.picks[key].open(0);
      return;
    }
    nav.keydown(e);
  }

  /** What each canvas shows, for screen readers (the chart's figures in words). */
  chartLabels = computed<Record<ChartKey, string>>(() => {
    const d = this.data();
    const e = this.empty();
    const months: any[] = d?.months ?? [];
    const latest = months.at(-1);
    const y = this.yearTotals();
    const list = (xs: string[]) => xs.filter(Boolean).join('; ');
    if (!d) {
      const wait = 'Loading the chart.';
      return { revenue: wait, aging: wait, occupancy: wait, types: wait, customers: wait, expiries: wait };
    }
    return {
      revenue: e.revenue ? 'Revenue and collections: no invoices in this range yet.'
        : `Revenue and collections, ${this.seriesLabel().toLowerCase()}: bars of the amount invoiced and paid each month and a line of the collection rate. `
          + `In total ${this.fullMoney(y.invoiced)} invoiced and ${this.fullMoney(y.paid)} paid, ${y.rate}% collected.`,
      aging: e.aging ? 'Receivables aging: nothing outstanding.'
        : `Receivables aging, as of today: ${this.fullMoney(this.agingTotal())} outstanding. `
          + list((d.aging ?? []).map((a: any) => `${a.label} ${this.fullMoney(a.amount)}, ${a.count} invoice${a.count === 1 ? '' : 's'}`)) + '.',
      occupancy: e.occupancy ? 'Occupancy and new bookings: no occupancy or bookings in this range yet.'
        : `Occupancy and new bookings, ${this.seriesLabel().toLowerCase()}: a line of the share of spaces in use and bars of the bookings made each month.`
          + (latest ? ` ${monthLong(latest.month)}: ${latest.occupancyPct}% occupancy, ${latest.newBookings} new booking${latest.newBookings === 1 ? '' : 's'}.` : ''),
      types: e.types ? 'Occupancy by space type: no spaces set up yet.'
        : 'Occupancy by space type, as of today: '
          + list((d.spaceTypes ?? []).map((t: any) => `${t.spaceType} ${t.occupied} of ${t.total} booked`)) + '.',
      customers: e.customers ? 'Top customers: no invoices this period yet.'
        : `Top customers by amount invoiced this ${this.periodWord()}: `
          + list((d.topCustomers ?? []).map((c: any) => `${c.label} ${this.fullMoney(c.amount)}`)) + '.',
      expiries: e.expiries ? 'Leases expiring: no leases end in this window.'
        : `Leases expiring, ${this.aheadLabel().toLowerCase()}: `
          + list((d.leaseExpiries ?? []).map((x: any) => `${monthLong(x.label)} ${x.count} lease${x.count === 1 ? '' : 's'}`)) + '.'
    };
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.destroyCharts());
    effect(() => {
      const loc = this.locationId();
      this.locationIds();
      this.refreshTick();
      this.period();
      untracked(() => this.load(loc));
    });
  }

  load(loc: string) {
    if (!this.data()) this.loading.set(true);
    const id = loc && loc !== 'ALL' && !isNaN(Number(loc)) ? Number(loc) : null;
    this.admin.getDashboardOverview(id, this.period(), this.locationIds()).subscribe({
      next: (res) => {
        this.data.set(res); this.failed.set(false); this.loading.set(false);
        setTimeout(() => this.renderCharts(res));
      },
      error: () => { this.failed.set(true); this.loading.set(false); }
    });
  }

  // ---------- formatting ----------
  static money(v: number | null | undefined): string {
    const n = Number(v || 0);
    const a = Math.abs(n);
    if (a >= 1_000_000) return `PKR ${(n / 1_000_000).toFixed(a >= 10_000_000 ? 1 : 2).replace(/\.0+$/, '')}M`;
    if (a >= 1_000) return `PKR ${(n / 1_000).toFixed(a >= 100_000 ? 0 : 1).replace(/\.0$/, '')}K`;
    return `PKR ${Math.round(n).toLocaleString()}`;
  }
  money = DashboardOverview.money;
  fullMoney(v: number | null | undefined): string {
    return 'PKR ' + Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
  }

  private trend(now: number, prev: number, unit: '%' | 'pts' | 'n', higherIsGood = true): Kpi['trend'] {
    if (!prev && !now) return null;
    let diff: number; let text: string;
    if (unit === '%') {
      if (!prev) return { text: 'new', dir: 'up', good: higherIsGood };
      diff = ((now - prev) / prev) * 100;
      text = `${Math.abs(diff).toFixed(0)}%`;
    } else if (unit === 'pts') {
      diff = now - prev;
      text = `${Math.abs(diff).toFixed(1)} pts`;
    } else {
      diff = now - prev;
      text = `${Math.abs(diff)}`;
    }
    if (Math.abs(diff) < 0.05) return { text: 'no change', dir: 'flat', good: true };
    const up = diff > 0;
    return { text, dir: up ? 'up' : 'down', good: up === higherIsGood };
  }

  kpis = computed<Kpi[]>(() => {
    const d = this.data();
    if (!d) return [];
    return [
      {
        key: 'occupancy', label: 'Occupancy', value: `${d.occupancyPct}%`,
        sub: `${d.occupiedSpaces} of ${d.totalSpaces} spaces in use`, link: '/admin/spaces', opens: 'rooms',
        tone: d.occupancyPct >= 70 ? 'ok' : d.occupancyPct >= 40 ? 'neutral' : 'warn',
        trend: this.trend(d.occupancyPct, d.occupancyPctLastMonth, 'pts'), vs: `vs a ${this.periodWord()} ago`
      },
      {
        key: 'active', label: 'Active bookings', value: `${d.activeBookings}`,
        sub: 'Running today', link: '/admin/bookings', tone: 'neutral',
        trend: this.trend(d.activeBookings, d.activeBookingsLastMonth, 'n'), vs: `vs a ${this.periodWord()} ago`
      },
      {
        key: 'pending', label: 'Awaiting confirmation', value: `${d.pendingConfirmations}`,
        sub: d.pendingConfirmations ? 'Bookings not yet confirmed' : 'Nothing waiting', link: '/admin/bookings',
        tone: d.pendingConfirmations ? 'warn' : 'ok'
      },
      {
        key: 'outstanding', label: 'Outstanding', value: this.money(d.outstanding), full: this.fullMoney(d.outstanding),
        sub: `${d.outstandingCount} unpaid invoice${d.outstandingCount === 1 ? '' : 's'}`, link: '/admin/invoices',
        tone: d.outstanding > 0 ? 'neutral' : 'ok'
      },
      {
        key: 'overdue', label: 'Overdue', value: this.money(d.overdueAmount), full: this.fullMoney(d.overdueAmount),
        sub: d.overdueCount ? `${d.overdueCount} past due date` : 'Nothing overdue', link: '/admin/invoices',
        tone: d.overdueCount ? 'danger' : 'ok'
      },
      {
        key: 'invoiced', label: `Invoiced this ${this.periodWord()}`, value: this.money(d.invoicedThisPeriod), full: this.fullMoney(d.invoicedThisPeriod),
        sub: `${this.money(d.paidThisPeriod)} of it paid`, link: '/admin/invoices', tone: 'neutral',
        trend: this.trend(d.invoicedThisPeriod, d.invoicedPrevPeriod, '%'), vs: `vs last ${this.periodWord()} to date`
      }
    ];
  });

  attentionItems = computed<any[]>(() => {
    const d = this.data();
    if (!d) return [];
    const list: any[] = this.tab() === 'overdue' ? d.overdueInvoices : this.tab() === 'ending' ? d.endingLeases : d.pendingBookings;
    return (list || []).map(item => ({
      ...item,
      customer: (item?.customer || item?.customerName || item?.customerFullName || '').trim() || 'Customer'
    }));
  });

  attentionTotal = computed(() => {
    const d = this.data();
    return d ? (d.overdueCount || 0) + (d.leasesEndingSoon || 0) + (d.pendingConfirmations || 0) : 0;
  });

  daysFrom(date: string | null | undefined): number | null {
    if (!date) return null;
    const t = new Date(); t.setHours(0, 0, 0, 0);
    const d = new Date(date + 'T00:00:00');
    return Math.round((d.getTime() - t.getTime()) / 86400000);
  }

  overdueDays(date: string | null | undefined): number {
    return Math.max(0, -(this.daysFrom(date) ?? 0));
  }

  // ---------- 12-month totals shown above the revenue chart ----------
  yearTotals = computed(() => {
    const months: any[] = this.data()?.months ?? [];
    const invoiced = months.reduce((a, m) => a + (m.invoiced || 0), 0);
    const paid = months.reduce((a, m) => a + (m.paid || 0), 0);
    return { invoiced, paid, rate: invoiced > 0 ? Math.round((paid / invoiced) * 100) : 0 };
  });

  // "No data yet" overlays instead of bare axes
  empty = computed(() => {
    const d = this.data();
    const months: any[] = d?.months ?? [];
    return {
      revenue: !months.some(m => m.invoiced > 0 || m.paid > 0),
      aging: !(d?.aging ?? []).some((a: any) => a.amount > 0),
      occupancy: !months.some(m => m.occupancyPct > 0 || m.newBookings > 0),
      types: !(d?.spaceTypes ?? []).some((t: any) => t.total > 0),
      customers: !(d?.topCustomers ?? []).length,
      expiries: !(d?.leaseExpiries ?? []).some((e: any) => e.count > 0)
    };
  });

  agingTotal = computed(() => (this.data()?.aging ?? []).reduce((a: number, b: any) => a + (b.amount || 0), 0));
  readonly agingColors = ['#10b981', '#fbbf24', '#f97316', '#ef4444', '#991b1b'];

  // ---------- One-page PDF report (A4 landscape) ----------
  exporting = signal(false);

  async downloadReport(meta: { location: string; preparedBy: string }) {
    const d = this.data();
    if (!d || this.exporting()) return;
    this.exporting.set(true);
    try {
      const { jsPDF } = await import('jspdf');
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const W = 297, M = 12;
      const periodTitle = { month: 'This month', quarter: 'This quarter', year: 'This year' }[this.period()];
      const now = new Date();

      // Header band
      pdf.setFillColor(15, 23, 42); pdf.rect(0, 0, W, 24, 'F');
      pdf.setFillColor(13, 148, 136); pdf.rect(0, 24, W, 1.2, 'F');
      pdf.setTextColor(255, 255, 255); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(16);
      pdf.text('WorkNest  ·  Executive Summary', M, 11);
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(203, 213, 225);
      pdf.text(`${periodTitle}  ·  ${meta.location}  ·  ${now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`, M, 18);
      pdf.text(`Prepared by ${meta.preparedBy}`, W - M, 18, { align: 'right' });

      // Headline numbers
      const kpis = this.kpis();
      const gap = 4, boxW = (W - 2 * M - gap * (kpis.length - 1)) / kpis.length, boxH = 22, y0 = 31;
      const toneRgb: Record<string, [number, number, number]> = { ok: [16, 185, 129], warn: [245, 158, 11], danger: [239, 68, 68], neutral: [13, 148, 136] };
      kpis.forEach((k, i) => {
        const x = M + i * (boxW + gap);
        pdf.setDrawColor(226, 232, 240); pdf.setFillColor(255, 255, 255); pdf.roundedRect(x, y0, boxW, boxH, 2, 2, 'FD');
        const c = toneRgb[k.tone] ?? toneRgb['neutral']; pdf.setFillColor(c[0], c[1], c[2]); pdf.rect(x, y0 + 2, 1.1, boxH - 4, 'F');
        pdf.setFont('helvetica', 'bold'); pdf.setFontSize(6.5); pdf.setTextColor(100, 116, 139);
        pdf.text(k.label.toUpperCase(), x + 4, y0 + 6);
        pdf.setFontSize(13); pdf.setTextColor(15, 23, 42);
        pdf.text(k.value, x + 4, y0 + 13.5);
        pdf.setFont('helvetica', 'normal'); pdf.setFontSize(6.5); pdf.setTextColor(100, 116, 139);
        const foot = k.trend ? `${k.trend.dir === 'up' ? '+' : k.trend.dir === 'down' ? '-' : ''}${k.trend.text} ${k.vs ?? ''}` : k.sub;
        pdf.text(pdf.splitTextToSize(foot, boxW - 6)[0] ?? '', x + 4, y0 + 18.5);
      });

      // Charts: 3 x 2 grid
      const e = this.empty();
      const charts: { title: string; canvas?: ElementRef<HTMLCanvasElement>; empty: boolean; note?: string }[] = [
        { title: `Revenue & collections (${this.seriesLabel().toLowerCase()})`, canvas: this.revenueCanvas(), empty: e.revenue },
        { title: 'Receivables aging (as of today)', canvas: this.agingCanvas(), empty: e.aging, note: `Outstanding ${this.fullMoney(this.agingTotal())}` },
        { title: `Occupancy & new bookings (${this.seriesLabel().toLowerCase()})`, canvas: this.occCanvas(), empty: e.occupancy },
        { title: 'Occupancy by space type (today)', canvas: this.typeCanvas(), empty: e.types },
        { title: `Top customers (this ${this.periodWord()})`, canvas: this.custCanvas(), empty: e.customers },
        { title: `Leases expiring (${this.aheadLabel().toLowerCase()})`, canvas: this.expCanvas(), empty: e.expiries }
      ];
      const cols = 3, cg = 5, rg = 5, top = y0 + boxH + 6;
      const cw = (W - 2 * M - cg * (cols - 1)) / cols, ch = (210 - top - 12 - rg) / 2;
      charts.forEach((c, i) => {
        const x = M + (i % cols) * (cw + cg), y = top + Math.floor(i / cols) * (ch + rg);
        pdf.setDrawColor(226, 232, 240); pdf.setFillColor(255, 255, 255); pdf.roundedRect(x, y, cw, ch, 2, 2, 'FD');
        pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8.5); pdf.setTextColor(15, 23, 42); pdf.text(c.title, x + 4, y + 6);
        if (c.note) { pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7); pdf.setTextColor(100, 116, 139); pdf.text(c.note, x + cw - 4, y + 6, { align: 'right' }); }
        const ax = x + 3, ay = y + 9, aw = cw - 6, ah = ch - 12;
        if (c.empty || !c.canvas) {
          pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(148, 163, 184);
          pdf.text('No data yet', x + cw / 2, y + ch / 2, { align: 'center' });
          return;
        }
        const el = c.canvas.nativeElement;
        const ratio = el.width / el.height || 2;
        let w = aw, h = aw / ratio;
        if (h > ah) { h = ah; w = ah * ratio; }
        pdf.addImage(el.toDataURL('image/png', 1), 'PNG', ax + (aw - w) / 2, ay + (ah - h) / 2, w, h);
      });

      // Footer
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7); pdf.setTextColor(148, 163, 184);
      pdf.text(`Generated ${now.toLocaleString('en-GB')}  ·  Figures in PKR  ·  Occupancy = spaces with a live booking`, M, 205);
      pdf.text('WorkNest', W - M, 205, { align: 'right' });

      const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      pdf.save(`WorkNest-Executive-Summary-${this.period()}-${stamp}.pdf`);
    } finally {
      this.exporting.set(false);
    }
  }

  // ---------- Chart.js ----------
  private destroyCharts() {
    this.charts.forEach(c => c.destroy());
    this.charts.clear();
  }

  private monthLabel(ym: string): string {
    const [y, m] = ym.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'short' }) + (m === 1 ? ` ${String(y).slice(2)}` : '');
  }

  private renderCharts(d: any) {
    this.destroyCharts();
    if (!d) return;
    Chart.defaults.font.family = "'Inter', system-ui, -apple-system, sans-serif";
    Chart.defaults.color = '#64748b';

    const tooltip = {
      backgroundColor: '#0f172a', titleColor: '#fff', bodyColor: '#e2e8f0', footerColor: '#94a3b8', padding: 10, cornerRadius: 8,
      titleFont: { weight: 600 as const }, boxPadding: 4, usePointStyle: true
    };
    const grid = { color: '#eef2f6', drawTicks: false };
    const axisMoney = { callback: (v: any) => this.money(Number(v)).replace('PKR ', ''), padding: 8 };
    const legend = { position: 'bottom' as const, labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 8, boxHeight: 8, padding: 16 } };
    const months: any[] = d.months ?? [];
    const labels = months.map(m => this.monthLabel(m.month));
    const add = (key: ChartKey, el: ElementRef<HTMLCanvasElement> | undefined, cfg: any) => { if (el) this.charts.set(key, new Chart(el.nativeElement, cfg)); };
    // A click on a bar / slice / point opens its records (the first element under the pointer, or its column).
    const clickOpens = (open: (i: number) => void) => (_e: any, els: any[]) => { if (els.length) open(els[0].index); };

    // 1. Revenue & collections — invoiced vs paid bars, collection-rate line; a month opens its invoices
    add('revenue', this.revenueCanvas(), {
      data: {
        labels,
        datasets: [
          { type: 'bar', label: 'Invoiced', data: months.map(m => m.invoiced), backgroundColor: '#99f6e4', borderRadius: 6, maxBarThickness: 26, order: 2 },
          { type: 'bar', label: 'Paid', data: months.map(m => m.paid), backgroundColor: '#0d9488', borderRadius: 6, maxBarThickness: 26, order: 2 },
          { type: 'line', label: 'Collection rate', data: months.map(m => m.invoiced > 0 ? Math.round((m.paid / m.invoiced) * 100) : null),
            yAxisID: 'pct', borderColor: '#6366f1', backgroundColor: '#6366f1', borderWidth: 2.5, tension: 0.35, pointRadius: 3, pointHoverRadius: 5, spanGaps: true, order: 1 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        onHover: pointerOnHover, onClick: clickOpens(i => this.openRevenueMonth(i)),
        plugins: {
          legend,
          tooltip: { ...tooltip, callbacks: {
            label: (c: any) => c.dataset.yAxisID === 'pct' ? ` ${c.dataset.label}: ${c.parsed.y ?? 0}%` : ` ${c.dataset.label}: ${this.fullMoney(c.parsed.y)}`,
            footer: () => 'Click for the invoices'
          } }
        },
        scales: {
          x: { grid: { display: false }, border: { display: false } },
          y: { beginAtZero: true, grid, border: { display: false }, ticks: axisMoney },
          pct: { position: 'right', beginAtZero: true, max: 100, grid: { display: false }, border: { display: false }, ticks: { callback: (v: any) => v + '%', stepSize: 25 } }
        }
      }
    });

    // 2. Receivables aging — doughnut
    const aging: any[] = d.aging ?? [];
    add('aging', this.agingCanvas(), {
      type: 'doughnut',
      data: {
        labels: aging.map(a => a.label),
        datasets: [{ data: aging.map(a => a.amount), backgroundColor: this.agingColors, borderColor: '#fff', borderWidth: 3, hoverOffset: 6 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '72%',
        onHover: pointerOnHover, onClick: clickOpens(i => this.openAging(i)),
        plugins: {
          legend: { display: false },
          tooltip: { ...tooltip, callbacks: {
            label: (c: any) => ` ${c.label}: ${this.fullMoney(c.parsed)} (${aging[c.dataIndex]?.count ?? 0} invoices)`,
            footer: () => 'Click for the invoices'
          } }
        }
      }
    });

    // 3. Occupancy & new bookings — bars + line; a point of the line opens the spaces in use, the rest of a month its new bookings
    add('occupancy', this.occCanvas(), {
      data: {
        labels,
        datasets: [
          { type: 'line', label: 'Occupancy', data: months.map(m => m.occupancyPct), yAxisID: 'pct', borderColor: '#0d9488', borderWidth: 2.5, tension: 0.35,
            fill: true, backgroundColor: (ctx: any) => {
              const { chart } = ctx; const area = chart.chartArea;
              if (!area) return 'rgba(13,148,136,0.12)';
              const g = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
              g.addColorStop(0, 'rgba(13,148,136,0.28)'); g.addColorStop(1, 'rgba(13,148,136,0.02)');
              return g;
            }, pointRadius: 3, pointHitRadius: 10, pointBackgroundColor: '#fff', pointBorderColor: '#0d9488', pointBorderWidth: 2, order: 1 },
          { type: 'bar', label: 'New bookings', data: months.map(m => m.newBookings), yAxisID: 'n', backgroundColor: '#c7d2fe', borderRadius: 6, maxBarThickness: 22, order: 2 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        onHover: pointerOnHover,
        onClick: (e: any, els: any[], chart: any) => {
          const i = els[0]?.index;
          if (i === undefined) return;
          // Right on a point of the occupancy line (dataset 0): the spaces in use; anywhere else in the month: its new bookings.
          const hit: any[] = chart.getElementsAtEventForMode(e.native ?? e, 'nearest', { intersect: true }, false);
          if (hit.some(h => h.datasetIndex === 0)) this.openOccupiedMonth(i); else this.openNewBookings(i);
        },
        plugins: {
          legend,
          tooltip: { ...tooltip, callbacks: {
            label: (c: any) => c.dataset.yAxisID === 'pct' ? ` Occupancy: ${c.parsed.y}%` : ` New bookings: ${c.parsed.y}`,
            footer: () => 'Click a point for the spaces in use, a bar for the new bookings'
          } }
        },
        scales: {
          x: { grid: { display: false }, border: { display: false } },
          pct: { position: 'left', beginAtZero: true, max: 100, grid, border: { display: false }, ticks: { callback: (v: any) => v + '%', stepSize: 25, padding: 8 } },
          n: { position: 'right', beginAtZero: true, grid: { display: false }, border: { display: false }, ticks: { precision: 0 } }
        }
      }
    });

    // 4. Occupancy by space type — stacked horizontal bars
    const types: any[] = d.spaceTypes ?? [];
    add('types', this.typeCanvas(), {
      type: 'bar',
      data: {
        labels: types.map(t => t.spaceType),
        datasets: [
          { label: 'Booked', data: types.map(t => t.occupied), backgroundColor: '#0d9488', borderRadius: 4, maxBarThickness: 18 },
          { label: 'Vacant', data: types.map(t => Math.max(0, t.total - t.occupied)), backgroundColor: '#e2e8f0', borderRadius: 4, maxBarThickness: 18 }
        ]
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', axis: 'y', intersect: false },
        onHover: pointerOnHover, onClick: clickOpens(i => this.openSpaceType(i)),
        plugins: {
          legend,
          tooltip: { ...tooltip, callbacks: { footer: (items: any[]) => { const t = types[items[0]?.dataIndex]; return t ? `${t.total ? Math.round(t.occupied * 100 / t.total) : 0}% occupied · click for the spaces` : ''; } } }
        },
        scales: {
          x: { stacked: true, beginAtZero: true, grid, border: { display: false }, ticks: { precision: 0 } },
          y: { stacked: true, grid: { display: false }, border: { display: false } }
        }
      }
    });

    // 5. Top customers — horizontal bars
    const cust: any[] = d.topCustomers ?? [];
    add('customers', this.custCanvas(), {
      type: 'bar',
      data: {
        labels: cust.map(c => c.label.length > 22 ? c.label.slice(0, 21) + '…' : c.label),
        datasets: [{ label: 'Invoiced (12 months)', data: cust.map(c => c.amount), backgroundColor: ['#0d9488', '#14b8a6', '#2dd4bf', '#5eead4', '#99f6e4'], borderRadius: 6, maxBarThickness: 20 }]
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', axis: 'y', intersect: false },
        onHover: pointerOnHover, onClick: clickOpens(i => this.openCustomer(i)),
        plugins: {
          legend: { display: false },
          tooltip: { ...tooltip, callbacks: {
            title: (i: any[]) => cust[i[0]?.dataIndex]?.label ?? '',
            label: (c: any) => ` ${this.fullMoney(c.parsed.x)} · ${cust[c.dataIndex]?.count ?? 0} invoices`,
            footer: () => 'Click for the invoices'
          } }
        },
        scales: {
          x: { beginAtZero: true, grid, border: { display: false }, ticks: axisMoney },
          y: { grid: { display: false }, border: { display: false } }
        }
      }
    });

    // 6. Lease expiries — next 6 months
    const exp: any[] = d.leaseExpiries ?? [];
    add('expiries', this.expCanvas(), {
      type: 'bar',
      data: {
        labels: exp.map(e => this.monthLabel(e.label)),
        datasets: [{ label: 'Leases ending', data: exp.map(e => e.count),
          backgroundColor: exp.map((_, i) => i === 0 ? '#f59e0b' : i === 1 ? '#fbbf24' : '#fde68a'), borderRadius: 6, maxBarThickness: 30 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        onHover: pointerOnHover, onClick: clickOpens(i => this.openExpiry(i)),
        plugins: {
          legend: { display: false },
          tooltip: { ...tooltip, callbacks: {
            label: (c: any) => ` ${c.parsed.y} lease${c.parsed.y === 1 ? '' : 's'} · ${this.fullMoney(exp[c.dataIndex]?.amount)}`,
            footer: () => 'Click for the leases'
          } }
        },
        scales: {
          x: { grid: { display: false }, border: { display: false } },
          y: { beginAtZero: true, grid, border: { display: false }, ticks: { precision: 0 } }
        }
      }
    });
  }
}

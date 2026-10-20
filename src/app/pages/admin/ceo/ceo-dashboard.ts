import { Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { Subscription } from 'rxjs';
import { AuthService } from '../../../services/auth.service';
import {
  CeoBreakdown, CeoDashboard as CeoDashboardData, CeoError, CeoForecastMonth, CeoFunnelStage, CeoLocation, CeoPeriod, CeoService,
  CeoTeamLocation
} from '../../../services/ceo.service';
import { CeoDrawer } from './ceo-drawer/ceo-drawer';
import { CeoRoomsSection } from './ceo-rooms/ceo-rooms';
import { CeoDiscountsSection, discountSheets } from './ceo-discounts/ceo-discounts';
import { CeoSeatsSection } from './ceo-seats/ceo-seats';
import { seatsSheets } from './ceo-seats/seats-export';
import { DashNetworkSection } from './dash-network/dash-network';
import { networkSheets } from './dash-network/network-export';
import {
  AGING_COLORS, AGING_FALLBACK, AXIS_MONEY, Chart, ChartKeyNav, DrillLevel, DrillRequest, GRID, INQUIRY_TYPES, LEGEND, TEAL,
  TEAL_DARK, TEAL_LIGHT, TEAL_LIGHT_HOVER, TOOLTIP, Trend, applyChartDefaults, count, displayNameOf, firstNameOf, fullMoney,
  inquiryTypeKey, money, monthLong, monthShort, pct, pointerOnHover, ratio, trend
} from './ceo-shared';
import { RangeEditor, periodTitleOf, periodWords, previousRange } from './period-range';
import { ceoWorkbook } from './ceo-export';
import type { DashRange } from '../../../services/dashboard-api';
import { AutoRefresh } from '../../../utils/auto-refresh';
import { exportPagePdf, fileDate, fileSlug } from '../../../utils/page-pdf';
import { downloadXlsx } from '../../../utils/xlsx';

interface Kpi {
  key: string;
  label: string;
  value: string;
  full?: string;
  sub: string;
  /** A second line under sub (a figure without a trend). */
  sub2?: string;
  /** Added to the card's tooltip, e.g. how the figure places invoices in a month. */
  hint?: string;
  tone: 'ok' | 'warn' | 'danger' | 'neutral';
  trend?: Trend | null;
  vs?: string;
  /** What a click does; none = a plain figure. */
  action?: () => void;
  actionLabel?: string;
}

type ChartKey = 'revenue' | 'aging' | 'occupancy';

/** CP_02: line colour per room category on the occupancy chart (Private Office, Shared Space; others after). */
const CATEGORY_LINE: Record<string, string> = { PrivateOffice: TEAL_DARK, SharedSpace: '#7c3aed' };
const CATEGORY_LINE_FALLBACK = ['#0369a1', '#b45309'];

/**
 * CEO dashboard (/admin/ceo): company-wide money, occupancy, sales and team figures for this month / quarter /
 * year or a custom date range (compared with the same number of days before it), all locations or one. Every chart
 * and list drills down in a side drawer (breakdown, then records, for the same period). Read-only. Reloads quietly
 * every 5 minutes while the tab is visible (not while a drawer is open); Export PDF (the page as shown) and Export
 * Excel (the figures behind it). Data: GET api/ceo/dashboard (+ GET api/dashboard/forecast for the 3-month outlook,
 * GET api/ceo/rooms for the Rooms section and GET api/ceo/network for the Network section, which load on their own).
 */
@Component({
  selector: 'app-ceo-dashboard',
  standalone: true,
  imports: [DatePipe, NgTemplateOutlet, CeoDrawer, CeoRoomsSection, CeoSeatsSection, DashNetworkSection, CeoDiscountsSection],
  templateUrl: './ceo-dashboard.html',
  styleUrl: './ceo-dashboard.css'
})
export class CeoDashboard {
  private ceo = inject(CeoService);
  private auth = inject(AuthService);

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
  /** The custom range (period custom); kept when another period is chosen, so Custom opens with it again. */
  range = signal<DashRange | null>(null);
  /** The range the requests use: only with period custom. */
  activeRange = computed(() => (this.period() === 'custom' ? this.range() : null));
  readonly rangeEditor = new RangeEditor();
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
  /** Bumped by the refresh button: the Rooms section reloads too. */
  roomsReload = signal(0);
  /** Bumped by the auto refresh: the Rooms section reloads quietly. */
  roomsQuietReload = signal(0);
  /** The same for the Network section (UniFi; loads on its own, follows the location picker). */
  networkReload = signal(0);
  networkQuietReload = signal(0);
  /** Export running ('pdf' | 'xlsx'); null = none. */
  exporting = signal<'pdf' | 'xlsx' | null>(null);
  exportError = signal('');
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
  /** What Export PDF prints: the sections under the header. */
  private exportRoot = viewChild<ElementRef<HTMLElement>>('exportRoot');
  private roomsSection = viewChild(CeoRoomsSection);
  private seatsSection = viewChild(CeoSeatsSection);
  private networkSection = viewChild(DashNetworkSection);
  private discountsSection = viewChild(CeoDiscountsSection);
  private host = inject(ElementRef<HTMLElement>);

  /** Every 5 minutes while the tab is visible; waits while a drawer, the range editor or an export is open. */
  private auto = new AutoRefresh({
    run: () => this.autoRefresh(),
    paused: () => !!this.drill() || this.rangeEditor.open() || !!this.exporting() || this.loading() || this.refreshing()
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.sub?.unsubscribe();
      this.forecastSub?.unsubscribe();
      this.destroyCharts();
      this.auto.stop();
      if (this.clock) clearInterval(this.clock);
    });
    this.clock = setInterval(() => this.nowTick.set(Date.now()), 30_000);

    effect(() => {
      this.period();
      this.activeRange();
      this.locationId();
      untracked(() => { this.load(); this.loadForecast(); });
    });

    this.setupSectionNav();
  }

  // ---------- loading ----------

  /** quiet: the auto refresh (no dimming; the figures on screen stay until the new ones arrive). */
  load(quiet = false) {
    this.sub?.unsubscribe();
    if (!quiet) { if (this.data()) this.refreshing.set(true); else this.loading.set(true); }
    const key = this.selectionKey();
    const locationId = this.locationId();
    this.sub = this.ceo.getDashboard(this.period(), locationId, this.activeRange()).subscribe({
      next: d => {
        this.data.set(d);
        this.dataKey = key;
        this.shownLocationId.set(locationId);
        this.error.set(null);
        this.loading.set(false);
        this.refreshing.set(false);
        this.lastUpdated.set(new Date());
        this.auto.markFresh();
        if (d.locations.length) {
          const byId = new Map(this.knownLocations().map(l => [l.locationId, l]));
          d.locations.forEach(l => byId.set(l.locationId, l));
          this.knownLocations.set([...byId.values()].sort((a, b) => a.name.localeCompare(b.name)));
        }
        setTimeout(() => this.renderCharts());
      },
      error: (err: CeoError) => {
        this.error.set(CeoService.describeError(err));
        // Figures of another period / location would be misleading: keep them only for a plain refresh.
        if (this.dataKey !== key) { this.data.set(null); this.dataKey = ''; this.destroyCharts(); }
        this.loading.set(false);
        this.refreshing.set(false);
      }
    });
  }

  /** Period + location the figures on screen belong to. */
  private dataKey = '';
  /** The location the figures on screen belong to (null = all locations). */
  private shownLocationId = signal<number | null>(null);
  private selectionKey(): string {
    const r = this.activeRange();
    return `${this.period()}|${r?.from ?? ''}|${r?.to ?? ''}|${this.locationId() ?? ''}`;
  }

  loadForecast(quiet = false) {
    this.forecastSub?.unsubscribe();
    if (!quiet) this.forecastLoading.set(true);
    this.forecastSub = this.ceo.getForecast(this.locationId(), 3).subscribe({
      next: f => { this.forecast.set(f); this.forecastError.set(null); this.forecastLoading.set(false); },
      error: (err: CeoError) => { this.forecastError.set(CeoService.describeError(err)); this.forecastLoading.set(false); }
    });
  }

  refresh() {
    this.load();
    this.loadForecast();
    this.roomsReload.update(n => n + 1);
    this.networkReload.update(n => n + 1);
  }

  /** The 5-minute refresh: every section, quietly (an open drawer is never reached: the refresh waits for it). */
  private autoRefresh() {
    this.load(true);
    this.loadForecast(true);
    this.roomsQuietReload.update(n => n + 1);
    this.networkQuietReload.update(n => n + 1);
  }

  setPeriod(p: CeoPeriod) {
    this.rangeEditor.close();
    if (p !== this.period()) this.period.set(p);
  }

  /** "Custom": the From / To editor (with the range on screen, or the current period to today). */
  openRange() {
    if (this.rangeEditor.open()) { this.rangeEditor.close(); return; }
    this.rangeEditor.show(this.period(), this.range());
    setTimeout(() => (this.host.nativeElement as HTMLElement).querySelector<HTMLInputElement>('#ceo-range-from')?.focus());
  }

  applyRange(e: Event) {
    e.preventDefault();
    const r = this.rangeEditor.apply();
    if (!r) return;
    this.range.set(r);
    this.period.set('custom');
  }

  closeRange() {
    this.rangeEditor.close();
    setTimeout(() => (this.host.nativeElement as HTMLElement).querySelector<HTMLElement>('#ceo-range-btn')?.focus());
  }

  // ---------- export ----------

  canExport = computed(() => !!this.data() && !this.loading() && !this.exporting());

  /** File name stem: "WorkNest-CEO-dashboard-1-Oct-15-Oct-2026-I-8-2026-10-19". */
  private exportName(): string {
    const loc = this.shownLocationId() ? this.locationName() : '';
    return `${fileSlug('WorkNest CEO dashboard', this.periodTitle(), loc)}-${fileDate()}`;
  }

  private exportMeta() {
    const range = this.shownPeriod() === 'custom' ? this.shownRange() : null;
    return {
      periodTitle: this.periodTitle(),
      range,
      previousRange: range ? this.data()?.previousRange ?? previousRange(range) : null,
      location: this.locationName(),
      preparedBy: displayNameOf(this.auth.user()),
      previousWords: this.words().last
    };
  }

  /** Export PDF: the dashboard as it is on screen (charts included), A4 pages. */
  async exportPdf() {
    const el = this.exportRoot()?.nativeElement;
    if (!el || !this.canExport()) return;
    this.exporting.set('pdf');
    this.exportError.set('');
    try {
      const meta = this.exportMeta();
      await exportPagePdf(el, {
        fileName: `${this.exportName()}.pdf`,
        title: 'WorkNest CEO dashboard',
        lines: [
          meta.previousRange ? `${meta.periodTitle} (compared with ${meta.previousRange.from} to ${meta.previousRange.to})` : meta.periodTitle,
          meta.location,
          meta.preparedBy ? `Prepared by ${meta.preparedBy}` : ''
        ],
        hide: '.view-toggle, .kpi-go, .row-go, .net-seg'
      });
    } catch {
      this.exportError.set('The PDF could not be made. Please try again.');
    } finally {
      this.exporting.set(null);
    }
  }

  /** Export Excel: the KPIs, chart and table figures, one sheet per section (.xlsx). */
  exportExcel() {
    const d = this.data();
    if (!d || !this.canExport()) return;
    this.exporting.set('xlsx');
    this.exportError.set('');
    try {
      const rooms = this.roomsSection()?.data() ?? null;
      const network = networkSheets(this.networkSection()?.data() ?? null);
      downloadXlsx(`${this.exportName()}.xlsx`, [...ceoWorkbook(d, this.forecast(), rooms, this.exportMeta()), ...discountSheets(this.discountsSection()?.data() ?? null), ...seatsSheets(this.seatsSection()?.data() ?? null), ...network]);
    } catch {
      this.exportError.set('The Excel file could not be made. Please try again.');
    } finally {
      this.exporting.set(null);
    }
  }

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

  /** The WorkNest name's first word as it is ("CEO1"); a tidied email prefix only when there is no name. */
  firstName = computed(() => firstNameOf(this.auth.user()));

  locationName = computed(() => {
    const id = this.locationId();
    if (!id) return 'All locations';
    return this.locations().find(l => l.locationId === id)?.name ?? 'Selected location';
  });

  /** Labels follow the figures on screen (while a new period loads, the old figures keep their own words). */
  private shownPeriod = computed<CeoPeriod>(() => this.data()?.period ?? this.period());
  private shownRange = computed(() => this.data()?.range ?? this.activeRange());
  periodTitle = computed(() => this.data()?.periodLabel || periodTitleOf(this.shownPeriod(), this.shownRange()));
  /** "this month" / "last month" / "a month ago"; a custom range: "in this range" / "previous 15 days" / "15 days earlier". */
  words = computed(() => periodWords(this.shownPeriod(), this.shownRange()));
  thisWord = computed(() => this.words().thisP);

  updatedAgo = computed(() => {
    const at = this.lastUpdated();
    if (!at) return '';
    const mins = Math.floor((this.nowTick() - at.getTime()) / 60000);
    return mins < 1 ? 'just now' : mins === 1 ? '1 min ago' : mins < 60 ? `${mins} min ago` : at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  });

  // ---------- Money ----------

  m = computed(() => this.data()?.money ?? null);
  /**
   * The month figures place an invoice in the month its billing period starts (database update CP_01, which also
   * sends billed in advance); an older API places it in the month it was issued, so the labels say nothing then.
   */
  byPeriod = computed(() => this.m()?.billedInAdvance != null);
  /**
   * Database update CP_02 (it sends the security deposits): invoiced leaves the deposits out and collected is what was
   * paid so far on the period's invoices (part payments count); an older API: GrandTotal and the paid invoices.
   */
  noDeposits = computed(() => this.m()?.securityDeposits != null);

  moneyKpis = computed<Kpi[]>(() => {
    const m = this.m();
    if (!m) return [];
    const w = this.words();
    const rate = m.collectionRate;
    const hint = this.byPeriod() ? 'By billing period' : undefined;
    // CP_02: what each figure counts, in the card's tooltip.
    const cp02 = this.noDeposits();
    const invoicedHint = cp02 ? 'By billing period, without security deposits' : hint;
    const collectedHint = cp02 ? 'Paid so far on the invoices for these billing periods (part payments count), without security deposits' : hint;
    const kpis: Kpi[] = [
      {
        key: 'invoiced', label: `Invoiced ${w.thisP}`, value: money(m.invoiced), full: fullMoney(m.invoiced),
        sub: `${money(m.invoicedPrev)} ${w.last}`, tone: 'neutral',
        trend: trend(m.invoiced, m.invoicedPrev, '%'), vs: `vs ${w.last}`, hint: invoicedHint,
        action: () => this.openRevenue('Invoiced', null), actionLabel: `Open invoiced ${w.thisP} by ${this.revenueBy()}`
      },
      {
        key: 'collected', label: `Collected ${w.thisP}`, value: money(m.collected), full: fullMoney(m.collected),
        sub: `${money(m.collectedPrev)} ${w.last}`, sub2: cp02 ? 'Paid so far on this billing' : undefined, tone: 'neutral',
        trend: trend(m.collected, m.collectedPrev, '%'), vs: `vs ${w.last}`, hint: collectedHint,
        action: () => this.openRevenue('Collected', 'collected'), actionLabel: `Open collected ${w.thisP} by ${this.revenueBy()}`
      },
      {
        key: 'rate', label: 'Collection rate', value: pct(rate),
        sub: m.invoiced > 0 ? `of ${money(m.invoiced)} invoiced` : 'Nothing invoiced yet',
        tone: m.invoiced <= 0 ? 'neutral' : rate >= 80 ? 'ok' : rate >= 50 ? 'warn' : 'danger',
        hint: cp02 ? 'Share of the period\'s billing paid so far' : hint,
        action: () => this.openRevenue('Collection rate', null), actionLabel: `Open the collection rate ${w.thisP} by ${this.revenueBy()}`
      },
      {
        key: 'outstanding', label: 'Outstanding', value: money(m.outstanding), full: fullMoney(m.outstanding),
        sub: `${count(m.outstandingCount)} unpaid invoice${m.outstandingCount === 1 ? '' : 's'}`,
        tone: m.outstanding > 0 ? 'neutral' : 'ok',
        hint: this.byPeriod() ? 'Not counting invoices billed in advance' : undefined,
        action: () => this.openOutstanding(), actionLabel: 'Open outstanding by days past due'
      },
      {
        key: 'overdue', label: 'Overdue', value: money(m.overdue), full: fullMoney(m.overdue),
        sub: m.overdueCount ? `${count(m.overdueCount)} past due date` : 'Nothing overdue',
        tone: m.overdueCount ? 'danger' : 'ok',
        action: () => this.openRecords('Invoices', 'Overdue', 'invoices', { status: 'overdue' }), actionLabel: 'Open the overdue invoices'
      }
    ];
    // Billed in advance (CP_01): unpaid invoices for billing periods not started yet, next to outstanding (which leaves
    // them out), before overdue.
    if (m.billedInAdvance != null) {
      const n = m.billedInAdvanceCount ?? 0;
      kpis.splice(kpis.findIndex(k => k.key === 'overdue'), 0, {
        key: 'advance', label: 'Billed in advance', value: money(m.billedInAdvance), full: fullMoney(m.billedInAdvance),
        sub: n ? `${count(n)} unpaid invoice${n === 1 ? '' : 's'}` : 'No invoices', sub2: 'Unpaid, for billing periods not started yet',
        tone: 'neutral',
        action: () => this.openBilledInAdvance(), actionLabel: 'Open the invoices billed in advance'
      });
    }
    // Security deposits (CP_02): billed on the period's invoices, kept out of invoiced; after the collection rate.
    if (m.securityDeposits != null) {
      const n = m.securityDepositsCount ?? 0;
      kpis.splice(kpis.findIndex(k => k.key === 'rate') + 1, 0, {
        key: 'deposits', label: `Security deposits ${w.thisP}`, value: money(m.securityDeposits), full: fullMoney(m.securityDeposits),
        sub: `${money(m.securityDepositsPrev ?? 0)} ${w.last}`,
        sub2: n ? `${count(n)} invoice${n === 1 ? '' : 's'}, not in Invoiced` : 'No deposits billed',
        tone: 'neutral', trend: trend(m.securityDeposits, m.securityDepositsPrev ?? 0, '%'), vs: `vs ${w.last}`,
        hint: 'Refundable security deposits billed, by billing period',
        action: () => this.openDeposits(), actionLabel: `Open the invoices with a security deposit ${w.thisP}`
      });
    }
    return kpis;
  });

  /** A KPI card's tooltip: the full amount and the hint, when there is one. */
  kpiTitle(k: Kpi): string {
    return [k.full, k.hint].filter(Boolean).join(' · ');
  }

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

  /** CP_02: occupancy per room category (Private Office, Shared Space); empty before the database update CP_02. */
  occCategories = computed(() => this.o()?.categories ?? []);

  occupancyKpis = computed<Kpi[]>(() => {
    const o = this.o();
    if (!o) return [];
    const w = this.words();
    // CP_02: one card per room category (rooms with a confirmed booking now, and their seats), never one mixed figure.
    const perCategory: Kpi[] = o.categories.map(c => ({
      key: `occ-${c.categoryCode}`, label: `${c.label} occupancy`, value: pct(c.occupancyPct),
      // The card shows sub under the trend: rooms now, then the seats sold of those rooms.
      sub: `${count(c.occupied)} of ${count(c.rooms)} rooms now · seats ${count(c.seatsSold)} of ${count(c.seats)} (${pct(c.seatOccupancyPct)})`,
      hint: 'Rooms with a confirmed booking right now; the change is against the rooms that existed one period ago.',
      tone: c.rooms === 0 ? 'neutral' : c.occupancyPct >= 70 ? 'ok' : c.occupancyPct >= 40 ? 'neutral' : 'warn',
      trend: trend(c.occupancyPct, c.occupancyPctPrev, 'pts'), vs: `vs ${w.ago}`,
      action: () => this.openOccupancyCategory(c.categoryCode, c.label, true),
      actionLabel: `Open the occupied ${c.label} rooms by location`
    }));
    return [
      ...(perCategory.length ? perCategory : [{
        key: 'occupancy', label: 'Occupancy', value: pct(o.occupancyPct),
        sub: `${count(o.occupiedSpaces)} of ${count(o.totalSpaces)} spaces in use`,
        tone: o.totalSpaces === 0 ? 'neutral' : o.occupancyPct >= 70 ? 'ok' : o.occupancyPct >= 40 ? 'neutral' : 'warn',
        trend: trend(o.occupancyPct, o.occupancyPctPrev, 'pts'), vs: `vs ${w.ago}`,
        action: () => this.openOccupancy(), actionLabel: 'Open the occupied rooms by location'
      } as Kpi]),
      {
        key: 'active', label: 'Active bookings', value: count(o.activeBookings),
        sub: o.categories.length ? 'Confirmed, running today' : 'Running today', tone: 'neutral',
        // records/bookings filters by the day a booking was made: from 2000-01-01 keeps the older ones that still run.
        action: () => this.openRecords('Active bookings', 'Running today', 'bookings', { status: 'active', from: '2000-01-01' }),
        actionLabel: 'Open the bookings running today'
      },
      {
        key: 'new', label: `New bookings ${w.thisP}`, value: count(o.newBookings),
        sub: `${count(o.newBookingsPrev)} ${w.last}`, tone: 'neutral',
        trend: trend(o.newBookings, o.newBookingsPrev, 'n'), vs: `vs ${w.last}`,
        action: () => this.openRecords('New bookings', this.periodTitle(), 'bookings', {}), actionLabel: 'Open the new bookings'
      }
    ];
  });

  occEmpty = computed(() => !(this.o()?.months ?? []).some(x => x.occupancyPct > 0 || x.newBookings > 0 || x.categories.some(c => c.occupancyPct > 0)));
  byTypeEmpty = computed(() => !(this.o()?.byType ?? []).some(t => t.total > 0));
  byCategoryEmpty = computed(() => !this.occCategories().some(c => c.rooms > 0));
  /** CP_02: the room categories the 12 months carry (Private Office, Shared Space), in order. */
  occMonthCategories = computed(() => {
    const seen = new Map<string, string>();
    for (const m of this.o()?.months ?? []) for (const c of m.categories) if (!seen.has(c.categoryCode)) seen.set(c.categoryCode, c.label);
    return [...seen].map(([code, label]) => ({ code, label }));
  });
  /** A month's occupancy of one category (0 when the month does not carry it). */
  monthCategoryPct(x: { categories: { categoryCode: string; occupancyPct: number }[] }, code: string): number {
    return x.categories.find(c => c.categoryCode === code)?.occupancyPct ?? 0;
  }
  byLocationEmpty = computed(() => !(this.o()?.byLocation ?? []).some(t => t.total > 0));

  /** Days until a lease ends (0 = today). */
  daysLeft(date: string): number {
    const d = new Date(date.length <= 10 ? date + 'T00:00:00' : date);
    if (isNaN(d.getTime())) return 0;
    const t = new Date(); t.setHours(0, 0, 0, 0); d.setHours(0, 0, 0, 0);
    return Math.max(0, Math.round((d.getTime() - t.getTime()) / 86400000));
  }
  /** Every lease ending in the next 90 days: the API's full count (QA_07), else what its list holds (the first 50). */
  leasesCount = computed(() => this.o()?.leasesExpiringCount ?? this.o()?.leasesExpiring.length ?? 0);
  /** Their monthly rent: the API's total when sent, else the sum of the list. */
  expiringTotal = computed(() => this.o()?.leasesExpiringMonthly
    ?? (this.o()?.leasesExpiring ?? []).reduce((a, l) => a + l.monthlyAmount, 0));
  /** Leases the list does not hold ("and 14 more"). */
  moreLeases = computed(() => Math.max(0, this.leasesCount() - (this.o()?.leasesExpiring.length ?? 0)));
  /** The full list (records/leases) comes with the update that counts them all: only then can it be opened. */
  canOpenAllLeases = computed(() => this.o()?.leasesExpiringCount != null && this.leasesCount() > 0);
  allLeasesText = computed(() => {
    const n = this.leasesCount();
    return n === 1 ? 'Open the lease expiring' : `All ${count(n)} leases expiring`;
  });

  // ---------- Sales ----------

  s = computed(() => this.data()?.sales ?? null);
  /**
   * One location is chosen but the tour inquiry figures still count every location (the database update QA_07 has
   * not run): the inquiry stage, the by-type panel and a note on the Sales section say "all locations".
   */
  inquiriesAllLocations = computed(() => !!this.shownLocationId() && !!this.s()?.inquiriesAllLocations);
  funnelMax = computed(() => Math.max(1, ...(this.s()?.funnel ?? []).map(f => f.count)));
  funnelEmpty = computed(() => !(this.s()?.funnel ?? []).some(f => f.count > 0));
  /** "3 of 10 quotations booked": this period's quotations that were booked (never more than the quotations). */
  conversionText = computed(() => {
    const s = this.s();
    if (!s) return '';
    return s.quotations ? `${count(s.quotationsBooked)} of ${count(s.quotations)} quotations booked` : 'No quotations yet';
  });
  inquiryTotal = computed(() => (this.s()?.inquiriesByType ?? []).reduce((a, t) => a + t.count, 0));
  inquiryMax = computed(() => Math.max(1, ...(this.s()?.inquiriesByType ?? []).map(t => t.count)));
  typeStyle(type: string) { return INQUIRY_TYPES[inquiryTypeKey(type)]; }
  /** Teal steps for the funnel stages (ordered, light to dark). */
  private readonly funnelColors = ['#99f6e4', '#5eead4', '#14b8a6', '#0f766e'];
  funnelColor(i: number): string { return this.funnelColors[Math.min(i, this.funnelColors.length - 1)]; }

  /** Booked = the contract value of the period's bookings (CP_02), else their first invoices (older database). */
  bookedContract = computed(() => this.s()?.bookingValueBasis === 'contract');
  bookedTitle = computed(() => {
    const s = this.s();
    if (!s) return '';
    const what = this.bookedContract() ? 'Contract value' : 'First invoices';
    return `${what} of the bookings made ${this.thisWord()}: ${fullMoney(s.bookingValue)}`;
  });
  /** One location chosen: "+3 without a branch (not included)" for the period's tour inquiries with no branch. */
  noBranchNote = computed(() => {
    const n = this.s()?.inquiriesNoBranch ?? 0;
    return n > 0 ? `+${count(n)} without a branch (not included)` : '';
  });

  /**
   * Share of the previous stage that reached this one ("62% of quotations"). Bookings include direct bookings (no
   * quotation), so that stage shows how many came from quotations instead of a share of accepted (CP_02).
   */
  stepText(i: number): string {
    const f = this.s()?.funnel ?? [];
    if (i === 0) return '';
    if (f[i]?.stage.toLowerCase() === 'bookings') {
      const fromQuotations = this.s()?.bookingsFromQuotations;
      return fromQuotations == null ? '' : `${count(fromQuotations)} from quotations`;
    }
    if (!f[i - 1]?.count) return '-';
    // A later stage can be bigger than the one before it (most quotations don't start as tour inquiries):
    // a share over 100% would only confuse, so none is shown then.
    if (f[i].count > f[i - 1].count) return '';
    return `${pct(ratio(f[i].count, f[i - 1].count))} of ${f[i - 1].label.toLowerCase()}`;
  }

  // ---------- Team ----------

  t = computed(() => this.data()?.team ?? null);
  /** The sales executives (the API sends no other role), highest revenue first. */
  people = computed(() => [...(this.t()?.people ?? [])].sort((a, b) => b.revenue - a.revenue || b.converted - a.converted || b.quotations - a.quotations));
  teamEmpty = computed(() => !(this.t()?.perLocation ?? []).length && !(this.t()?.people ?? []).length);
  /** The highest revenue of a sales executive (the revenue bars' 100%). */
  revenueMax = computed(() => Math.max(0, ...this.people().map(p => p.revenue)));

  // ---------- drill-down ----------

  private openDrill(root: string, level: DrillLevel) {
    this.drill.set({ id: ++this.drillId, root, level });
  }

  private openRecords(root: string, crumb: string, kind: Extract<DrillLevel, { kind: 'records' }>['records'], params: Record<string, string | number>) {
    this.openDrill(root, { kind: 'records', records: kind, params, crumb });
  }

  closeDrill() {
    this.drill.set(null);
    // A refresh that waited for the drawer runs now.
    this.auto.resume();
  }

  // KPI drill-downs. Level 2 lists built from the dashboard's own figures (the months of the period, the aging
  // buckets, occupancy by location) lead to the API breakdowns and then the records, as the charts do.

  /** The month the figures run to (the last of the 12-month series), "yyyy-MM". */
  private currentMonth(): string {
    const last = this.m()?.months.at(-1)?.month;
    if (last) return last.slice(0, 7);
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  /** What Invoiced / Collected open first: this month or a custom range by location, a quarter or year by month. */
  revenueBy = computed(() => (this.shownPeriod() === 'month' || this.shownPeriod() === 'custom' ? 'location' : 'month'));

  /** The months of the period so far (calendar quarter / year to date), invoiced and collected. */
  private periodMonths = computed<CeoBreakdown>(() => {
    const months = this.m()?.months ?? [];
    const [y, mo] = this.currentMonth().split('-').map(Number);
    const first = this.shownPeriod() === 'year' ? 1 : this.shownPeriod() === 'quarter' ? Math.floor((mo - 1) / 3) * 3 + 1 : mo;
    const rows = months
      .filter(x => { const [yy, mm] = x.month.split('-').map(Number); return yy === y && mm >= first && mm <= mo; })
      .map(x => ({ key: x.month.slice(0, 7), label: monthLong(x.month), value: x.invoiced, value2: x.collected, count: null }));
    return { title: 'Invoiced and collected by month', subtitle: this.periodTitle(), valueLabel: 'Invoiced', value2Label: 'Collected', rows };
  });

  /** Outstanding by days past due (the aging buckets). */
  private agingBuckets = computed<CeoBreakdown>(() => ({
    title: 'Outstanding by days past due', subtitle: 'Unpaid invoices, as of today', valueLabel: 'Outstanding', value2Label: null,
    rows: (this.m()?.aging ?? []).map(a => ({ key: a.bucket, label: a.label, value: a.amount, value2: null, count: a.count }))
  }));

  /** Occupancy by location, as of today. */
  private occupancyLocations = computed<CeoBreakdown>(() => ({
    title: 'Occupancy by location', subtitle: 'Occupied of all spaces, as of today', valueLabel: 'Occupied', value2Label: 'Spaces',
    rows: (this.o()?.byLocation ?? []).map(l => ({
      key: l.locationId > 0 ? String(l.locationId) : '', label: l.name, value: l.occupied, value2: l.total, count: null
    }))
  }));

  /**
   * Invoiced / Collected / Collection rate: by location (this month) or by month (quarter, year), then invoices.
   * status collected (Collected, CP_02): the invoices with something paid (an older API answers with the paid ones).
   */
  openRevenue(root: string, status: 'collected' | null) {
    const extra = status ? { status } : {};
    const range = this.shownRange();
    if (this.shownPeriod() === 'custom' && range) {
      // A custom range: its invoices by location (billing period from / to), then a location's invoices.
      this.openDrill(root, { kind: 'breakdown', metric: 'revenue', params: { from: range.from, to: range.to, ...extra }, crumb: this.periodTitle() });
    } else if (this.shownPeriod() === 'month') {
      const month = this.currentMonth();
      this.openDrill(root, { kind: 'breakdown', metric: 'revenue', params: { month, ...extra }, crumb: monthLong(month) });
    } else {
      this.openDrill(root, {
        kind: 'breakdown', metric: 'revenue-months', params: extra, crumb: this.periodTitle(), local: () => this.periodMonths()
      });
    }
  }

  /** Outstanding: the aging buckets, then a bucket by location, then its invoices. */
  openOutstanding() {
    this.openDrill('Outstanding', { kind: 'breakdown', metric: 'aging-buckets', params: {}, crumb: 'By days past due', local: () => this.agingBuckets() });
  }

  /**
   * Security deposits (CP_02): the invoices with a deposit whose billing period starts in the period's invoice window
   * (this month; a quarter / year: from its first day to the end of this month; a custom range: the range).
   */
  openDeposits() {
    const range = this.shownRange();
    let from: string, to: string;
    if (this.shownPeriod() === 'custom' && range) {
      from = range.from; to = range.to;
    } else {
      const [y, mo] = this.currentMonth().split('-').map(Number);
      const first = this.shownPeriod() === 'year' ? 1 : this.shownPeriod() === 'quarter' ? Math.floor((mo - 1) / 3) * 3 + 1 : mo;
      const last = new Date(y, mo, 0).getDate();
      from = `${y}-${String(first).padStart(2, '0')}-01`;
      to = `${y}-${String(mo).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
    }
    this.openRecords('Security deposits', this.periodTitle(), 'invoices', { status: 'deposit', from, to });
  }

  /** Billed in advance: the unpaid invoices for billing periods not started yet. */
  openBilledInAdvance() {
    this.openRecords('Invoices', 'Billed in advance', 'invoices', { status: 'advance' });
  }

  /** Occupancy: by location, then a location by space type, then its spaces. */
  openOccupancy() {
    // Only the occupied rooms (the chart's location / type drills still show occupied and vacant).
    this.openDrill('Occupancy', {
      kind: 'breakdown', metric: 'occupancy-locations', params: { occupied: true }, crumb: 'Occupied rooms by location',
      local: () => this.occupancyLocations()
    });
  }

  /**
   * Sales figures in the funnel header: conversion (converted quotations with a live booking), quoted (quotations),
   * booked (the period's bookings at their contract value, with who sold each: records/bookings?sales=true).
   */
  openSalesFigure(which: 'conversion' | 'quoted' | 'booked') {
    if (which === 'conversion') this.openRecords('Sales funnel', 'Converted quotations', 'quotations', { stage: 'converted' });
    else if (which === 'quoted') this.openRecords('Sales funnel', 'Quotations', 'quotations', { stage: 'quotations' });
    else this.openRecords('Sales funnel', 'Bookings', 'bookings', { sales: 'true' });
  }

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

  /**
   * CP_02: one room category by location (rooms with a confirmed booking now), then a location's rooms of it. From the
   * KPI card only the occupied rooms (occupied = true).
   */
  openOccupancyCategory(category: string, label: string, occupied = false) {
    const params: Record<string, string | number | boolean> = occupied ? { category, occupied: true } : { category };
    this.openDrill(occupied ? `${label} occupancy` : 'Occupancy by room category', {
      kind: 'breakdown', metric: 'occupancy-category', params, crumb: occupied ? `Occupied ${label} rooms by location` : label
    });
  }

  /** CP_02: one location's rooms of one category (location 0 = rooms not tied to a location). */
  openOccLocationCategory(locationId: number, name: string, category: string, label: string) {
    this.openRecords('Occupancy by location', `${name} · ${label}`, 'spaces', { locationId: locationId > 0 ? locationId : 'none', category });
  }

  openSpaceType(spaceTypeId: number, name: string) {
    this.openDrill('Occupancy by space type', { kind: 'breakdown', metric: 'occupancy-type', params: { spaceTypeId }, crumb: name });
  }

  openOccLocation(locationId: number, name: string) {
    // CP_02: rooms not tied to a location have no breakdown: their rooms straight away.
    if (locationId <= 0) { this.openRecords('Occupancy by location', name, 'spaces', { locationId: 'none', rooms: 'true' }); return; }
    this.openDrill('Occupancy by location', { kind: 'breakdown', metric: 'occupancy-location', params: { locationId }, crumb: name });
  }

  /** Every lease ending in the next 90 days (records/leases, soonest first), with the location filter. */
  openAllLeases() {
    this.openRecords('Leases expiring', 'Next 90 days', 'leases', {});
  }

  openFunnel(stage: CeoFunnelStage) {
    const key = stage.stage.toLowerCase();
    if (key === 'inquiries') this.openRecords('Sales funnel', stage.label, 'inquiries', {});
    else if (key === 'quotations' || key === 'accepted') this.openRecords('Sales funnel', stage.label, 'quotations', { stage: key });
    else if (key === 'bookings') this.openRecords('Sales funnel', stage.label, 'bookings', { sales: 'true' });
  }

  openInquiryType(type: string, label: string) {
    this.openDrill('Tour inquiries', { kind: 'breakdown', metric: 'inquiries-type', params: { type }, crumb: label });
  }

  openPerson(userId: number, name: string) {
    this.openDrill('Sales executives', { kind: 'breakdown', metric: 'staff', params: { userId }, crumb: name });
  }

  /**
   * A sales executive's revenue: the bookings they sold in the period (records/bookings?sellerId, CP_02), or with an
   * older database the quotations they created in the period that were converted (records/quotations).
   */
  openPersonRevenue(userId: number, name: string) {
    if (!userId) return;
    if (this.t()?.revenueBasis === 'bookings') this.openRecords('Sales executives', `${name}: revenue`, 'bookings', { sellerId: userId });
    else this.openRecords('Sales executives', `${name}: revenue`, 'quotations', { userId, stage: 'converted' });
  }
  /** What a revenue opens: the bookings sold (CP_02) or the converted quotations (older database). */
  revenueRecords = computed(() => (this.t()?.revenueBasis === 'bookings' ? 'the bookings sold' : 'the converted quotations'));
  /** Per-location card line: whose quotations the card counts. */
  teamCardSub(l: CeoTeamLocation): string {
    const execs = `${l.salesExecutives} sales executive${l.salesExecutives === 1 ? '' : 's'}`;
    return `${execs} · ${l.salesExecutivesOnly ? 'their quotations at this location' : 'all quotations at this location'}`;
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
    charts: () => [this.charts.get('occupancy')],
    count: () => this.o()?.months.length ?? 0,
    describe: i => {
      const x = this.o()?.months[i];
      if (!x) return '';
      const occ = x.categories.length
        ? x.categories.map(c => `${c.label} ${pct(c.occupancyPct)}`).join(', ')
        : `occupancy ${pct(x.occupancyPct)}`;
      return `${monthLong(x.month)}: ${occ} at month end, ${x.newBookings} new booking${x.newBookings === 1 ? '' : 's'}. Press Enter for the new bookings by location.`;
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
          // Rounded data ends, square on the baseline; a small gap between the pair.
          { label: 'Invoiced', data: months.map(x => x.invoiced), backgroundColor: TEAL_LIGHT, hoverBackgroundColor: TEAL_LIGHT_HOVER, borderRadius: 4, maxBarThickness: 20, borderSkipped: 'start', categoryPercentage: 0.72, barPercentage: 0.86 },
          { label: 'Collected', data: months.map(x => x.collected), backgroundColor: TEAL, hoverBackgroundColor: TEAL_DARK, borderRadius: 4, maxBarThickness: 20, borderSkipped: 'start', categoryPercentage: 0.72, barPercentage: 0.86 }
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
          x: { grid: { display: false }, border: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 12 } },
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
          borderColor: '#fff', borderWidth: 2, hoverOffset: 6, hoverBorderColor: '#fff'
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '72%', layout: { padding: 8 },
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

    // Occupancy & new bookings: one chart per month, new bookings as bars (left axis, count) and occupancy as a
    // line drawn on top of them (right axis, 0-100%). A bar or a point opens the new bookings by location.
    const occEmpty = this.occEmpty();
    const occCats = this.occMonthCategories();
    // Four steps on the bookings axis, so its grid lines meet the 0 / 25 / 50 / 75 / 100% ticks on the right.
    const maxNew = Math.max(0, ...occ.map(x => x.newBookings));
    const raw = Math.max(1, Math.ceil(maxNew / 4));
    const step = raw > 10 ? Math.ceil(raw / 5) * 5 : raw;
    this.upsert('occupancy', occEmpty ? undefined : this.occCanvas(), {
      type: 'bar',
      data: {
        labels: occ.map((x, i) => monthShort(x.month, i === 0)),
        datasets: [
          {
            type: 'bar', label: 'New bookings', yAxisID: 'y', order: 2, data: occ.map(x => x.newBookings),
            backgroundColor: TEAL_LIGHT, hoverBackgroundColor: TEAL_LIGHT_HOVER, borderRadius: 4, maxBarThickness: 20, borderSkipped: 'start'
          },
          // order 1: drawn over the bars. CP_02: one line per room category (Private Office, Shared Space); before it one
          // occupancy line.
          ...(occCats.length ? occCats.map((c, i) => ({ code: c.code, label: c.label, color: CATEGORY_LINE[c.code] ?? CATEGORY_LINE_FALLBACK[i % 2] }))
            : [{ code: '', label: 'Occupancy', color: TEAL }]).map(l => ({
            type: 'line', label: l.label, yAxisID: 'pct', order: 1,
            data: occ.map(x => (l.code ? this.monthCategoryPct(x, l.code) : x.occupancyPct)),
            borderColor: l.color, borderWidth: 2, tension: 0.3, fill: false,
            pointRadius: 4, pointHoverRadius: 6, pointHitRadius: 14, pointBackgroundColor: l.code ? l.color : TEAL_DARK, pointBorderColor: '#fff',
            pointBorderWidth: 2, pointHoverBackgroundColor: l.code ? l.color : TEAL_DARK, pointHoverBorderColor: '#fff', pointHoverBorderWidth: 2
          }))
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        onHover: pointerOnHover,
        onClick: (_e: any, els: any[]) => { if (els.length) this.openBookingsMonth(els[0].index); },
        plugins: {
          // New bookings first in the legend and the tooltip, whatever the drawing order.
          legend: { ...LEGEND, labels: { ...LEGEND.labels, sort: (a: any, b: any) => a.datasetIndex - b.datasetIndex } },
          tooltip: {
            ...TOOLTIP,
            itemSort: (a: any, b: any) => a.datasetIndex - b.datasetIndex,
            callbacks: {
              title: (items: any[]) => monthLong(occ[items[0]?.dataIndex]?.month ?? ''),
              label: (c: any) => c.dataset.yAxisID === 'pct' ? ` ${c.dataset.label} at month end: ${pct(c.parsed.y)}` : ` New bookings: ${c.parsed.y}`,
              footer: () => 'Click for locations'
            }
          }
        },
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 12 } },
          y: {
            position: 'left', min: 0, max: step * 4, grid: GRID, border: { display: false },
            ticks: { stepSize: step, precision: 0, padding: 8 }
          },
          pct: {
            position: 'right', min: 0, max: 100, grid: { drawOnChartArea: false }, border: { display: false },
            ticks: { stepSize: 25, padding: 8, callback: (v: any) => v + '%' }
          }
        }
      }
    });
  }

  // ---------- section nav ----------

  /**
   * The sticky nav under the header: one entry per dashboard section on the page (section.dash-section and the heading
   * it is labelled by), read from the page itself, so a section another component adds shows up on its own. The
   * section in view is highlighted; a click scrolls to it (below the sticky nav) and moves focus to it.
   */
  navItems = signal<{ id: string; label: string }[]>([]);
  /** The heading id of the section in view. */
  activeNav = signal('');
  private secNav = viewChild<ElementRef<HTMLElement>>('secNav');
  private navKey = '';
  private navFrame = 0;
  private navRescan = false;
  /** Until then (ms) the highlight stays on the clicked entry while the page scrolls to it. */
  private navLock = 0;
  private scroller: HTMLElement | null = null;

  /** Called once from the constructor (needs the injection context). */
  private setupSectionNav() {
    const destroyRef = inject(DestroyRef);
    const onScroll = () => {
      if (Date.now() < this.navLock) { this.navLock = Date.now() + 200; return; }
      this.queueNav();
    };
    // Sections come and go with the data (and with the sections other components render): rescan on change.
    effect(onCleanup => {
      const root = this.exportRoot()?.nativeElement;
      if (!root) { this.navKey = ''; this.navItems.set([]); return; }
      const watch = new MutationObserver(() => this.queueNav(true));
      watch.observe(root, { childList: true, subtree: true });
      this.queueNav(true);
      onCleanup(() => watch.disconnect());
    });
    // Keep the highlighted entry visible in the nav when it scrolls sideways (phones).
    effect(() => {
      const id = this.activeNav();
      const track = this.secNav()?.nativeElement.querySelector<HTMLElement>('.sec-nav-track');
      const btn = id ? track?.querySelector<HTMLElement>(`[data-nav="${CSS.escape(id)}"]`) : null;
      if (!track || !btn) return;
      const left = btn.offsetLeft, right = left + btn.offsetWidth;
      if (left < track.scrollLeft) track.scrollLeft = left - 16;
      else if (right > track.scrollLeft + track.clientWidth) track.scrollLeft = right - track.clientWidth + 16;
    });
    afterNextRender(() => {
      this.scroller = this.findScroller();
      const target: HTMLElement | Window = this.scroller ?? window;
      target.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onScroll, { passive: true });
      destroyRef.onDestroy(() => {
        target.removeEventListener('scroll', onScroll);
        window.removeEventListener('resize', onScroll);
        cancelAnimationFrame(this.navFrame);
      });
    });
  }

  goToSection(id: string) {
    const section = this.sectionOf(id);
    if (!section) return;
    this.activeNav.set(id);
    this.navLock = Date.now() + 1000;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    section.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    // Focus follows (screen readers read the section's name); the section loses its tabindex again when focus leaves.
    if (!section.hasAttribute('tabindex')) {
      section.setAttribute('tabindex', '-1');
      section.addEventListener('blur', () => section.removeAttribute('tabindex'), { once: true });
    }
    section.focus({ preventScroll: true });
  }

  /** The admin layout scrolls its main area, not the window: the nearest scrolling ancestor (null = the window). */
  private findScroller(): HTMLElement | null {
    let el = (this.host.nativeElement as HTMLElement).parentElement;
    while (el && el !== document.body) {
      if (/(auto|scroll)/.test(getComputedStyle(el).overflowY)) return el;
      el = el.parentElement;
    }
    return null;
  }

  private sectionOf(id: string): HTMLElement | null {
    const root = this.exportRoot()?.nativeElement;
    return root?.querySelector<HTMLElement>(`#${CSS.escape(id)}`)?.closest<HTMLElement>('section.dash-section') ?? null;
  }

  /** One update per frame: rescan the sections (when they changed), then the highlight. */
  private queueNav(rescan = false) {
    if (rescan) this.navRescan = true;
    if (this.navFrame) return;
    this.navFrame = requestAnimationFrame(() => {
      this.navFrame = 0;
      if (this.navRescan) { this.navRescan = false; this.scanSections(); }
      this.spySection();
    });
  }

  private scanSections() {
    const root = this.exportRoot()?.nativeElement;
    const items = !root ? [] : Array.from(root.querySelectorAll<HTMLElement>('section.dash-section[aria-labelledby]'))
      .map(s => {
        const id = s.getAttribute('aria-labelledby') ?? '';
        const label = (id && root.querySelector(`#${CSS.escape(id)}`)?.textContent?.trim()) || '';
        return { id, label };
      })
      .filter(x => x.id && x.label);
    const key = items.map(x => `${x.id}:${x.label}`).join('|');
    if (key !== this.navKey) { this.navKey = key; this.navItems.set(items); }
  }

  /** The section in view: the last one whose top has passed just below the nav; the last one at the end of the page. */
  private spySection() {
    const items = this.navItems();
    if (!items.length || Date.now() < this.navLock) return;
    const sc = this.scroller;
    const atEnd = sc
      ? sc.scrollTop > 0 && sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 2
      : window.scrollY > 0 && window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
    const line = (this.secNav()?.nativeElement.getBoundingClientRect().bottom ?? 0) + 24;
    let current = items[0].id;
    if (atEnd) current = items[items.length - 1].id;
    else for (const it of items) {
      const top = this.sectionOf(it.id)?.getBoundingClientRect().top;
      if (top != null && top <= line) current = it.id;
    }
    if (current !== this.activeNav()) this.activeNav.set(current);
  }
}

import { Component, DestroyRef, ElementRef, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { Subscription } from 'rxjs';
import { AuthService } from '../../../services/auth.service';
import {
  SalesManagerService, SmComplaintBranch, SmComplaintCategory, SmComplaints, SmDashboard, SmError, SmFunnelStage, SmInquiryMonth,
  SmLocation, SmMetric, SmOldComplaint, SmPeriod, SmRecordKind
} from '../../../services/sales-manager.service';
import { CeoDrawer } from '../ceo/ceo-drawer/ceo-drawer';
import {
  COMPLAINT_STATUSES, Chart, ChartKeyNav, DashKpi, DrillRequest, DrillSource, GRID, INQUIRY_TYPES, LEGEND, TEAL, TEAL_DARK, TOOLTIP,
  Trend, applyChartDefaults, complaintStatusStyle, count, firstNameOf, greetingNow, inquiryTypeKey, monthLong, monthShort, pct,
  periodWord, pointerOnHover, ratio, trend
} from '../ceo/ceo-shared';
import { SM_METRICS, SmDrillLevel, desks } from './sales-manager-drill';

type ChartKey = 'funnel' | 'inquiries' | 'desks' | 'complaints';
/** Charts drawn from GET api/sales-manager/dashboard (the complaints chart has its own endpoint). */
const DASHBOARD_CHARTS: ChartKey[] = ['funnel', 'inquiries', 'desks'];

/**
 * A KPI card; `unit` follows the figure in smaller type when the label does not say what it counts ("6 desks");
 * `accent` colours the card's edge (a complaint status colour) instead of its tone.
 */
interface SmKpi extends DashKpi { unit?: string; accent?: string; }

/** "+85", "-3", "0" (net desks). */
function signed(n: number): string {
  return n > 0 ? `+${count(n)}` : n < 0 ? `-${count(-n)}` : '0';
}

/** Change in desks vs the previous period ("12 desks" up / down). */
function deskTrend(now: number, prev: number): Trend | null {
  const t = trend(now, prev, 'n');
  return t && t.dir !== 'flat' ? { ...t, text: desks(Math.abs(now - prev)) } : t;
}

/** The inquiry types of the stacked chart, in the Tour Inquiries order, with the month field each one reads. */
const INQUIRY_SERIES: { key: string; field: Exclude<keyof SmInquiryMonth, 'month'> }[] = [
  { key: 'website', field: 'website' },
  { key: 'whatsapp', field: 'whatsApp' },
  { key: 'walkin', field: 'walkIn' },
  { key: 'reference', field: 'reference' },
  { key: 'notset', field: 'notSet' }
];

/** Desks booked & desks ending by month: teal for booked, amber for ending (as the lease pills). */
const DESK_SERIES = [
  { field: 'bookedDesks' as const, label: 'Desks booked', color: TEAL, hover: TEAL_DARK },
  { field: 'endingDesks' as const, label: 'Desks ending', color: '#fcd34d', hover: '#f59e0b' }
];

/** Funnel chart series (counts): light to dark teal, as the funnel stages. */
const FUNNEL_SERIES = [
  { field: 'quotations' as const, label: 'Quotations', color: '#99f6e4', hover: '#5eead4' },
  { field: 'accepted' as const, label: 'Accepted', color: '#2dd4bf', hover: '#14b8a6' },
  { field: 'bookings' as const, label: 'Bookings', color: '#0f766e', hover: '#115e59' }
];

/** Complaints by month: orange for raised (as Open), green for resolved (as Resolved). */
const COMPLAINT_SERIES = [
  { field: 'created' as const, label: 'Raised', color: '#fb923c', hover: '#ea580c' },
  { field: 'resolved' as const, label: 'Resolved', color: '#10b981', hover: '#047857' }
];

/** The status bar's order: still to do first, then done. */
const COMPLAINT_ORDER = [
  { key: 'open', field: 'open' as const },
  { key: 'in_progress', field: 'inProgress' as const },
  { key: 'resolved', field: 'resolved' as const },
  { key: 'closed', field: 'closed' as const }
];

/** "1 day", "1.5 days" (one decimal only when it matters). */
function dayCount(n: number): string {
  const v = Math.round(n * 10) / 10;
  return v === 1 ? '1 day' : `${v.toLocaleString(undefined, { maximumFractionDigits: 1 })} days`;
}

/**
 * Sales dashboard (/admin/sales-manager): the Sales Manager's funnel, team, tour inquiries and renewals for this
 * month / quarter / year, all their locations or one (super admins: every location). Tour inquiries follow the
 * same scope; those without a branch count under "All my locations" (as complaints do). Every chart and list
 * drills down in the shared side drawer (breakdown, then records). Read-only, and no money anywhere: sales are
 * counted in desks.
 * The Complaints section (last) loads on its own from GET api/sales-manager/complaints, with the same period and
 * location, so the rest of the page keeps working when only it fails.
 * Data: GET api/sales-manager/dashboard, GET api/sales-manager/complaints.
 */
@Component({
  selector: 'app-sales-manager-dashboard',
  standalone: true,
  imports: [DatePipe, NgTemplateOutlet, CeoDrawer],
  templateUrl: './sales-manager-dashboard.html',
  // Same look as the CEO dashboard: its stylesheet, plus the few sales-only pieces.
  styleUrls: ['../ceo/ceo-dashboard.css', './sales-manager-dashboard.css']
})
export class SalesManagerDashboard {
  private sm = inject(SalesManagerService);
  private auth = inject(AuthService);
  private host = inject(ElementRef<HTMLElement>);

  readonly desks = desks;
  readonly pct = pct;
  readonly count = count;
  readonly monthLong = monthLong;
  readonly ratio = ratio;
  readonly complaintStyle = complaintStatusStyle;
  readonly isSuperAdmin = this.auth.hasRole('super_admin');
  /** "All my locations" for a manager; a super admin sees every location. */
  readonly allLabel = this.isSuperAdmin ? 'All locations' : 'All my locations';

  readonly periods: { key: SmPeriod; label: string }[] = [
    { key: 'month', label: 'This month' }, { key: 'quarter', label: 'Quarter' }, { key: 'year', label: 'Year' }
  ];
  period = signal<SmPeriod>('month');
  locationId = signal<number | null>(null);

  data = signal<SmDashboard | null>(null);
  /** First load (skeletons); later loads keep the current figures dimmed instead. */
  loading = signal(true);
  refreshing = signal(false);
  error = signal<SmError | null>(null);
  lastUpdated = signal<Date | null>(null);

  drill = signal<DrillRequest<SmMetric, SmRecordKind> | null>(null);
  /** Screen reader text for the chart that has keyboard focus. */
  chartAnnounce = signal('');

  /** The drawer reads the Sales Manager API with these breakdowns. */
  readonly drillSource: DrillSource = {
    metrics: SM_METRICS,
    breakdown: (metric, params) => this.sm.getBreakdown(metric as SmMetric, params),
    records: (kind, params) => this.sm.getRecords(kind as SmRecordKind, params),
    describeError: err => SalesManagerService.describeError(err),
    desks: true
  };

  /** Every location seen so far (the list stays complete while one location is selected). */
  private knownLocations = signal<SmLocation[]>([]);
  locations = computed(() => this.knownLocations());

  private sub: Subscription | null = null;
  private drillId = 0;
  private charts = new Map<ChartKey, Chart>();
  private clock?: ReturnType<typeof setInterval>;
  private nowTick = signal(Date.now());

  // Complaints: own request, own states (first load, refresh, error) and own selection key.
  cmp = signal<SmComplaints | null>(null);
  cmpLoading = signal(true);
  cmpRefreshing = signal(false);
  cmpError = signal<SmError | null>(null);
  cmpUpdated = signal<Date | null>(null);
  private cmpSub: Subscription | null = null;
  private cmpKey = '';

  private funnelCanvas = viewChild<ElementRef<HTMLCanvasElement>>('funnelCanvas');
  private inquiriesCanvas = viewChild<ElementRef<HTMLCanvasElement>>('inquiriesCanvas');
  private desksCanvas = viewChild<ElementRef<HTMLCanvasElement>>('desksCanvas');
  private complaintsCanvas = viewChild<ElementRef<HTMLCanvasElement>>('complaintsCanvas');

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.sub?.unsubscribe();
      this.cmpSub?.unsubscribe();
      this.destroyCharts();
      if (this.clock) clearInterval(this.clock);
    });
    this.clock = setInterval(() => this.nowTick.set(Date.now()), 30_000);

    effect(() => {
      this.period();
      this.locationId();
      untracked(() => { this.load(); this.loadComplaints(); });
    });
  }

  // ---------- loading ----------

  load() {
    this.sub?.unsubscribe();
    if (this.data()) this.refreshing.set(true); else this.loading.set(true);
    const key = this.selectionKey();
    this.sub = this.sm.getDashboard(this.period(), this.locationId()).subscribe({
      next: d => {
        this.data.set(d);
        this.dataKey = key;
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
      error: (err: SmError) => {
        this.error.set(SalesManagerService.describeError(err));
        // Figures of another period / location would be misleading: keep them only for a plain refresh.
        if (this.dataKey !== key) { this.data.set(null); this.dataKey = ''; this.destroyCharts(DASHBOARD_CHARTS); }
        this.loading.set(false);
        this.refreshing.set(false);
      }
    });
  }

  /** Period + location the figures on screen belong to. */
  private dataKey = '';
  private selectionKey(): string { return `${this.period()}|${this.locationId() ?? ''}`; }

  /** Complaints section: same period and location as the rest; a failure stays inside the section. */
  loadComplaints() {
    this.cmpSub?.unsubscribe();
    if (this.cmp()) this.cmpRefreshing.set(true); else this.cmpLoading.set(true);
    const key = this.selectionKey();
    this.cmpSub = this.sm.getComplaints(this.period(), this.locationId()).subscribe({
      next: c => {
        this.cmp.set(c);
        this.cmpKey = key;
        this.cmpError.set(null);
        this.cmpLoading.set(false);
        this.cmpRefreshing.set(false);
        this.cmpUpdated.set(new Date());
        setTimeout(() => this.renderComplaintsChart());
      },
      error: (err: SmError) => {
        this.cmpError.set(SalesManagerService.describeComplaintsError(err));
        if (this.cmpKey !== key) { this.cmp.set(null); this.cmpKey = ''; this.destroyCharts(['complaints']); }
        this.cmpLoading.set(false);
        this.cmpRefreshing.set(false);
      }
    });
  }

  refresh() { this.load(); this.loadComplaints(); }

  setPeriod(p: SmPeriod) { if (p !== this.period()) this.period.set(p); }

  setLocation(value: string) {
    const id = Number(value);
    this.locationId.set(id > 0 ? id : null);
  }

  // ---------- header ----------

  readonly today = new Date();

  greeting = computed(() => { this.nowTick(); return greetingNow(); });
  firstName = computed(() => firstNameOf(this.auth.user()));

  locationName = computed(() => {
    const id = this.locationId();
    if (!id) return this.allLabel;
    return this.locations().find(l => l.locationId === id)?.name ?? 'Selected location';
  });

  /** Labels follow the figures on screen (while a new period loads, the old figures keep their own words). */
  private shownPeriod = computed<SmPeriod>(() => this.data()?.period ?? this.period());
  periodTitle = computed(() => this.data()?.periodLabel
    || { month: 'This month', quarter: 'This quarter', year: 'This year' }[this.shownPeriod()]);
  word = computed(() => periodWord(this.shownPeriod()));

  updatedAgo = computed(() => this.ago(this.lastUpdated()));

  /** "just now", "5 min ago", "3:40 PM". */
  private ago(at: Date | null): string {
    if (!at) return '';
    const mins = Math.floor((this.nowTick() - at.getTime()) / 60000);
    return mins < 1 ? 'just now' : mins === 1 ? '1 min ago' : mins < 60 ? `${mins} min ago` : at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  // ---------- Sales funnel ----------

  f = computed(() => this.data()?.funnel ?? null);

  private stageCount(key: string): number {
    return this.f()?.stages.find(s => s.stage.toLowerCase() === key)?.count ?? 0;
  }

  funnelKpis = computed<SmKpi[]>(() => {
    const f = this.f();
    if (!f) return [];
    const w = this.word();
    const quotations = this.stageCount('quotations');
    const bookings = this.stageCount('bookings');
    // Of this period's quotations, the ones booked (never above 100%).
    const rate = f.conversionRate;
    return [
      {
        key: 'conversion', label: 'Conversion', value: pct(rate),
        sub: quotations ? `${count(f.quotationsBooked)} of ${count(quotations)} quotations booked` : 'No quotations yet',
        tone: quotations === 0 ? 'neutral' : rate >= 30 ? 'ok' : rate >= 15 ? 'neutral' : 'warn',
        trend: trend(rate, f.conversionRatePrev, 'pts'), vs: `vs ${pct(f.conversionRatePrev)} last ${w}`,
        action: () => this.focusPanel('panel-funnel'), actionLabel: 'Show the sales funnel'
      },
      {
        key: 'quoted', label: `Desks quoted this ${w}`, value: count(f.quotedDesks), full: desks(f.quotedDesks),
        sub: `${count(quotations)} quotation${quotations === 1 ? '' : 's'}`, tone: 'neutral',
        action: () => this.openRecords('Sales funnel', 'Quotations', 'quotations', { stage: 'quotations' }),
        actionLabel: 'Open the quotations'
      },
      {
        key: 'booked', label: `Desks booked this ${w}`, value: count(f.bookedDesks), full: desks(f.bookedDesks),
        sub: `${count(bookings)} booking${bookings === 1 ? '' : 's'}`, tone: 'neutral',
        trend: trend(f.bookedDesks, f.bookedDesksPrev, '%'), vs: `vs ${desks(f.bookedDesksPrev)} last ${w}`,
        action: () => this.openRecords('Sales funnel', 'Bookings', 'bookings', {}), actionLabel: 'Open the bookings'
      }
    ];
  });

  funnelMax = computed(() => Math.max(1, ...(this.f()?.stages ?? []).map(s => s.count)));
  funnelEmpty = computed(() => !(this.f()?.stages ?? []).some(s => s.count > 0));
  /** Teal steps for the funnel stages (ordered, light to dark). */
  private readonly funnelColors = ['#99f6e4', '#5eead4', '#14b8a6', '#0f766e'];
  funnelColor(i: number): string { return this.funnelColors[Math.min(i, this.funnelColors.length - 1)]; }

  /** Share of the previous stage that reached this one ("62% of quotations"); none over 100%. */
  stepText(i: number): string {
    const s = this.f()?.stages ?? [];
    if (i === 0 || !s[i]) return '';
    if (!s[i - 1]?.count) return '';
    if (s[i].count > s[i - 1].count) return '';
    return `${pct(ratio(s[i].count, s[i - 1].count))} of ${s[i - 1].label.toLowerCase()}`;
  }

  funnelChartEmpty = computed(() => !(this.f()?.months ?? []).some(x => x.quotations > 0 || x.accepted > 0 || x.bookings > 0));
  funnelTotals = computed(() => {
    const m = this.f()?.months ?? [];
    return {
      quotations: m.reduce((a, x) => a + x.quotations, 0),
      bookings: m.reduce((a, x) => a + x.bookings, 0),
      desks: m.reduce((a, x) => a + x.bookedDesks, 0)
    };
  });
  funnelTable = signal(false);

  // ---------- Team performance ----------

  t = computed(() => this.data()?.team ?? null);
  /** Ranked by desks sold (then conversions, then quotations, then name). */
  people = computed(() => [...(this.t()?.people ?? [])]
    .sort((a, b) => b.desksSold - a.desksSold || b.converted - a.converted || b.quotations - a.quotations || a.name.localeCompare(b.name)));
  teamEmpty = computed(() => !(this.t()?.perLocation ?? []).length && !(this.t()?.people ?? []).length);
  teamFollowUps = computed(() => (this.t()?.people ?? []).reduce((a, p) => a + p.followUpsDue, 0));

  // ---------- Tour inquiries (the manager's locations; no branch = "All my locations" only) ----------

  q = computed(() => this.data()?.inquiries ?? null);
  /** The note under the Tour inquiries heading: before the database update BR_02 the figures count every branch. */
  inquiriesNote = computed(() => this.data()?.inquiriesAllBranches
    ? 'Counts inquiries from every branch until database update BR_02 is run'
    : `Inquiries without a branch show under ${this.allLabel}`);

  inquiryKpis = computed<SmKpi[]>(() => {
    const q = this.q();
    if (!q) return [];
    const w = this.word();
    const share = (n: number) => (q.total ? `${pct(ratio(n, q.total))} of inquiries` : 'No inquiries yet');
    return [
      {
        key: 'total', label: `Tour inquiries this ${w}`, value: count(q.total),
        sub: `${count(q.totalPrev)} last ${w}`, tone: 'neutral',
        trend: trend(q.total, q.totalPrev, '%'), vs: `vs last ${w}`,
        action: () => this.openRecords('Tour inquiries', this.periodTitle(), 'inquiries', {}), actionLabel: 'Open the tour inquiries'
      },
      { key: 'followed', label: 'Followed up', value: count(q.followedUp), sub: share(q.followedUp), tone: 'neutral' },
      {
        key: 'converted', label: 'Converted', value: count(q.converted), sub: share(q.converted),
        tone: q.converted > 0 ? 'ok' : 'neutral',
        action: () => this.openRecords('Tour inquiries', 'Converted', 'inquiries', { outcome: 'converted' }),
        actionLabel: 'Open the converted inquiries'
      },
      {
        key: 'not-interested', label: 'Not interested', value: count(q.notInterested), sub: share(q.notInterested), tone: 'neutral',
        action: () => this.openRecords('Tour inquiries', 'Not interested', 'inquiries', { outcome: 'not_interested' }),
        actionLabel: 'Open the not-interested inquiries'
      },
      {
        key: 'due', label: 'Follow-ups due', value: count(q.followUpsDue),
        sub: q.followUpsDue ? 'Due today or earlier' : 'Nothing due', tone: q.followUpsDue ? 'warn' : 'ok',
        action: () => this.openFollowUps(), actionLabel: 'Open the follow-ups due'
      }
    ];
  });

  inquiryTypeTotal = computed(() => (this.q()?.byType ?? []).reduce((a, t) => a + t.count, 0));
  inquiryTypeMax = computed(() => Math.max(1, ...(this.q()?.byType ?? []).map(t => t.count)));
  reasonMax = computed(() => Math.max(1, ...(this.q()?.notInterestedReasons ?? []).map(r => r.count)));
  inquiryChartEmpty = computed(() => !(this.q()?.months ?? []).some(m => INQUIRY_SERIES.some(s => m[s.field] > 0)));
  inquiryTable = signal(false);
  inquiryMonthTotal(m: SmInquiryMonth): number { return INQUIRY_SERIES.reduce((a, s) => a + m[s.field], 0); }
  typeStyle(type: string) { return INQUIRY_TYPES[inquiryTypeKey(type)]; }
  /** People with follow-ups due, most first (the follow-ups panel). */
  peopleWithFollowUps = computed(() => this.people().filter(p => p.followUpsDue > 0)
    .sort((a, b) => b.followUpsDue - a.followUpsDue).slice(0, 5));
  followUpMax = computed(() => Math.max(1, ...this.peopleWithFollowUps().map(p => p.followUpsDue)));

  // ---------- Renewals & desks ----------

  r = computed(() => this.data()?.renewals ?? null);

  renewalKpis = computed<SmKpi[]>(() => {
    const r = this.r();
    if (!r) return [];
    const w = this.word();
    const leases = (n: number) => `${count(n)} lease${n === 1 ? '' : 's'}`;
    return [
      {
        key: 'expiring', label: 'Desks ending in 90 days', value: count(r.expiringDesks), full: desks(r.expiringDesks),
        sub: r.expiringCount ? leases(r.expiringCount) : 'No leases end in the next 90 days',
        tone: r.expiringCount ? 'warn' : 'ok',
        action: () => this.focusPanel('panel-expiring'), actionLabel: 'Show the expiring leases'
      },
      {
        key: 'soon', label: 'Ending within 30 days', value: count(r.expiring30Desks),
        unit: r.expiring30Desks === 1 ? 'desk' : 'desks', full: desks(r.expiring30Desks),
        sub: r.expiring30Count ? leases(r.expiring30Count) : 'No leases end in the next 30 days',
        tone: r.expiring30Count ? 'danger' : 'ok',
        action: () => this.focusPanel('panel-expiring'), actionLabel: 'Show the expiring leases'
      },
      {
        key: 'net', label: `Net desks this ${w}`, value: signed(r.netDesks), full: `${signed(r.netDesks)} desks`,
        sub: `${count(r.bookedDesks)} booked, ${count(r.endedDesks)} ended`,
        tone: r.netDesks < 0 ? 'warn' : 'neutral',
        trend: deskTrend(r.netDesks, r.netDesksPrev), vs: `vs ${signed(r.netDesksPrev)} last ${w}`,
        action: () => this.focusPanel('panel-desks'), actionLabel: 'Show desks booked and ending by month'
      }
    ];
  });

  desksChartEmpty = computed(() => !(this.r()?.months ?? []).some(m => m.bookedDesks > 0 || m.endingDesks > 0 || m.expiring > 0));
  renewTable = signal(false);

  daysText(d: number): string {
    return d <= 0 ? 'Ends today' : d === 1 ? '1 day left' : `${d} days left`;
  }

  // ---------- Complaints ----------

  /** Period words of the complaint figures on screen. */
  cmpWord = computed(() => periodWord(this.cmp()?.period ?? this.period()));
  cmpPeriodTitle = computed(() => this.cmp()?.periodLabel || this.periodTitle());
  cmpUpdatedAgo = computed(() => this.ago(this.cmpUpdated()));

  /** Every complaint in scope, whatever its status. */
  cmpTotal = computed(() => {
    const s = this.cmp()?.status;
    return s ? s.open + s.inProgress + s.resolved + s.closed : 0;
  });
  /** Nothing at all to show: no complaints now, none in the period and none in the last 12 months. */
  cmpEmpty = computed(() => {
    const c = this.cmp();
    if (!c) return true;
    return this.cmpTotal() === 0 && c.newInPeriod === 0 && c.resolvedInPeriod === 0 && !c.byCategory.length
      && !c.oldestActive.length && !c.months.some(m => m.created > 0 || m.resolved > 0);
  });

  cmpKpis = computed<SmKpi[]>(() => {
    const c = this.cmp();
    if (!c) return [];
    const w = this.cmpWord();
    const st = COMPLAINT_STATUSES;
    return [
      {
        key: 'new', label: `New this ${w}`, value: count(c.newInPeriod),
        sub: c.reopenedInPeriod ? `${count(c.reopenedInPeriod)} reopened` : 'None reopened',
        tone: 'neutral', trend: trend(c.newInPeriod, c.newInPeriodPrev, 'n', false), vs: `vs ${count(c.newInPeriodPrev)} last ${w}`,
        action: () => this.openComplaints(`New this ${w}`, { status: 'new_period' }), actionLabel: `Open the complaints raised this ${w}`
      },
      {
        key: 'open', label: 'Open', value: count(c.status.open), sub: st['open'].hint,
        tone: c.status.open ? 'warn' : 'ok', accent: st['open'].bar,
        action: () => this.openComplaints('Open', { status: 'open' }), actionLabel: 'Open the open complaints'
      },
      {
        key: 'progress', label: 'In progress', value: count(c.status.inProgress), sub: st['in_progress'].hint,
        tone: 'neutral', accent: st['in_progress'].bar,
        action: () => this.openComplaints('In progress', { status: 'in_progress' }), actionLabel: 'Open the complaints in progress'
      },
      {
        key: 'resolved', label: `Resolved this ${w}`, value: count(c.resolvedInPeriod),
        sub: c.avgResolutionDays !== null ? `avg ${dayCount(c.avgResolutionDays)} to resolve`
          : c.resolvedInPeriod ? 'Resolved or closed' : `None resolved this ${w}`,
        tone: c.resolvedInPeriod ? 'ok' : 'neutral', accent: st['resolved'].bar,
        action: () => this.openComplaints(`Resolved this ${w}`, { status: 'resolved_period' }), actionLabel: `Open the complaints resolved this ${w}`
      }
    ];
  });

  /** Status bar segments and legend, in order (open, in progress, resolved, closed). */
  cmpStatuses = computed(() => {
    const s = this.cmp()?.status;
    const total = this.cmpTotal();
    return COMPLAINT_ORDER.map(o => {
      const n = s ? s[o.field] : 0;
      return { key: o.key, ...complaintStatusStyle(o.key), count: n, share: total ? (n / total) * 100 : 0 };
    });
  });

  /** Bars of the category list: open + in progress, against the busiest category. */
  cmpCategoryMax = computed(() => Math.max(1, ...(this.cmp()?.byCategory ?? []).map(c => c.open + c.inProgress)));
  cmpCategoryLabel(c: SmComplaintCategory): string {
    return `${c.category}: ${c.open} open, ${c.inProgress} in progress, ${c.total} new this ${this.cmpWord()}. Open its complaints`;
  }

  /**
   * By branch ('' = no branch, WhatsApp): worth showing when the complaints span more than one branch or include some
   * without a branch (with one location chosen it would only repeat that branch).
   */
  cmpShowsBranches = computed(() => {
    const b = this.cmp()?.byBranch ?? [];
    return b.filter(x => x.branch).length > 1 || b.some(x => !x.branch);
  });
  /** Bars of the branch list: open + in progress, against the busiest branch. */
  cmpBranchMax = computed(() => Math.max(1, ...(this.cmp()?.byBranch ?? []).map(b => b.open + b.inProgress)));
  cmpBranchLabel(b: SmComplaintBranch): string {
    return `${b.label}: ${b.open} open, ${b.inProgress} in progress, ${b.total} new this ${this.cmpWord()}. Open its complaints`;
  }

  cmpChartEmpty = computed(() => !(this.cmp()?.months ?? []).some(m => m.created > 0 || m.resolved > 0));
  cmpMonthTotals = computed(() => {
    const m = this.cmp()?.months ?? [];
    return { created: m.reduce((a, x) => a + x.created, 0), resolved: m.reduce((a, x) => a + x.resolved, 0) };
  });
  cmpTable = signal(false);

  /** "Today", "1 day", "12 days". */
  ageText(days: number): string { return days <= 0 ? 'Today' : days === 1 ? '1 day' : `${count(days)} days`; }

  // ---------- drill-down ----------

  private openDrill(root: string, level: SmDrillLevel) {
    this.drill.set({ id: ++this.drillId, root, level });
  }

  private openRecords(root: string, crumb: string, kind: SmRecordKind, params: Record<string, string | number>) {
    this.openDrill(root, { kind: 'records', records: kind, params, crumb });
  }

  closeDrill() { this.drill.set(null); }

  /** A funnel stage: its records for the period. */
  openStage(stage: SmFunnelStage) {
    const key = stage.stage.toLowerCase();
    if (key === 'inquiries') this.openRecords('Sales funnel', stage.label, 'inquiries', {});
    else if (key === 'quotations' || key === 'accepted') this.openRecords('Sales funnel', stage.label, 'quotations', { stage: key });
    else if (key === 'bookings') this.openRecords('Sales funnel', stage.label, 'bookings', {});
  }

  openFunnelMonth(i: number) {
    const m = this.f()?.months[i];
    if (m) this.openDrill('Sales funnel', { kind: 'breakdown', metric: 'funnel-month', params: { month: m.month }, crumb: monthLong(m.month) });
  }

  openPerson(userId: number, name: string) {
    if (userId) this.openDrill('Team performance', { kind: 'breakdown', metric: 'staff', params: { userId }, crumb: name });
  }

  openInquiryType(type: string, label: string) {
    this.openDrill('Tour inquiries', { kind: 'breakdown', metric: 'inquiries-type', params: { type }, crumb: label });
  }

  /** A month of the stacked inquiries chart: that month's inquiries, every type. */
  openInquiryMonth(i: number) {
    const m = this.q()?.months[i];
    if (m) this.openRecords('Tour inquiries', monthLong(m.month), 'inquiries', { month: m.month });
  }

  openFollowUps() {
    this.openRecords('Tour inquiries', 'Follow-ups due', 'inquiries', { outcome: 'followup_due' });
  }

  /** A reason opens only the inquiries closed with that reason (the API groups reasons case-insensitively). */
  openNotInterested(reason?: string) {
    this.openRecords('Tour inquiries', reason ? `Not interested: ${reason}` : 'Not interested', 'inquiries',
      reason ? { outcome: 'not_interested', reason } : { outcome: 'not_interested' });
  }

  /** A month of the desks chart: desks booked and ending per location. */
  openDesksMonth(i: number) {
    const m = this.r()?.months[i];
    if (m) this.openDrill('Desks booked & ending', { kind: 'breakdown', metric: 'desks-month', params: { month: m.month }, crumb: monthLong(m.month) });
  }

  openRenewalsMonth(i: number) {
    const m = this.r()?.months[i];
    if (m) this.openDrill('Expiring leases', { kind: 'breakdown', metric: 'renewals-month', params: { month: m.month }, crumb: monthLong(m.month) });
  }

  /** Complaints records (GET api/sales-manager/records/complaints) with the contract's filters. */
  openComplaints(crumb: string, params: Record<string, string | number>, highlight?: number) {
    this.openDrill('Complaints', { kind: 'records', records: 'complaints', params, crumb, highlight });
  }

  openComplaintStatus(key: string) {
    this.openComplaints(complaintStatusStyle(key).label, { status: key });
  }

  openComplaintCategory(category: string) {
    this.openComplaints(category, { category });
  }

  /** A branch: every complaint of it (branch=none for the complaints without a branch). */
  openComplaintBranch(b: SmComplaintBranch) {
    this.openComplaints(b.label, { branch: b.branch || 'none' });
  }

  /** A month of the complaints chart: the complaints raised that month. */
  openComplaintMonth(i: number) {
    const m = this.cmp()?.months[i];
    if (m) this.openComplaints(`Raised in ${monthLong(m.month)}`, { month: m.month });
  }

  /** An old complaint: the complaints with its status, category and branch, with it marked. */
  openOldComplaint(c: SmOldComplaint) {
    const branch = c.branch || 'none';
    const crumb = `${complaintStatusStyle(c.status).label}: ${c.category} · ${c.branch || 'No branch'}`;
    this.openComplaints(crumb, { status: c.status, category: c.category, branch }, c.complaintId || undefined);
  }

  /** KPI that points at a panel: scroll it into view and move focus there. */
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

  // ---------- charts: keyboard ----------

  readonly funnelNav = new ChartKeyNav({
    charts: () => [this.charts.get('funnel')],
    count: () => this.f()?.months.length ?? 0,
    describe: i => {
      const x = this.f()?.months[i];
      return x ? `${monthLong(x.month)}: ${x.quotations} quotations, ${x.accepted} accepted, ${x.bookings} bookings, ${desks(x.bookedDesks)} booked. Press Enter for the locations.` : '';
    },
    pick: i => this.openFunnelMonth(i),
    announce: t => this.chartAnnounce.set(t)
  });

  readonly inquiriesNav = new ChartKeyNav({
    charts: () => [this.charts.get('inquiries')],
    count: () => this.q()?.months.length ?? 0,
    describe: i => {
      const x = this.q()?.months[i];
      if (!x) return '';
      const parts = INQUIRY_SERIES.filter(s => x[s.field] > 0).map(s => `${INQUIRY_TYPES[s.key].label} ${x[s.field]}`);
      return `${monthLong(x.month)}: ${this.inquiryMonthTotal(x)} inquiries${parts.length ? ' (' + parts.join(', ') + ')' : ''}. Press Enter for the inquiries.`;
    },
    pick: i => this.openInquiryMonth(i),
    announce: t => this.chartAnnounce.set(t)
  });

  readonly desksNav = new ChartKeyNav({
    charts: () => [this.charts.get('desks')],
    count: () => this.r()?.months.length ?? 0,
    describe: i => {
      const x = this.r()?.months[i];
      return x
        ? `${monthLong(x.month)}: ${desks(x.bookedDesks)} booked, ${desks(x.endingDesks)} ending (${x.expiring} lease${x.expiring === 1 ? '' : 's'}). Press Enter for the locations.`
        : '';
    },
    pick: i => this.openDesksMonth(i),
    announce: t => this.chartAnnounce.set(t)
  });

  readonly complaintsNav = new ChartKeyNav({
    charts: () => [this.charts.get('complaints')],
    count: () => this.cmp()?.months.length ?? 0,
    describe: i => {
      const x = this.cmp()?.months[i];
      return x ? `${monthLong(x.month)}: ${x.created} raised, ${x.resolved} resolved. Press Enter for the complaints raised that month.` : '';
    },
    pick: i => this.openComplaintMonth(i),
    announce: t => this.chartAnnounce.set(t)
  });

  // ---------- charts: drawing ----------

  /** Destroys the given charts (all by default). */
  private destroyCharts(keys?: ChartKey[]) {
    for (const k of keys ?? [...this.charts.keys()]) {
      this.charts.get(k)?.destroy();
      this.charts.delete(k);
    }
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
    const xAxis = { grid: { display: false }, border: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 8 } };

    // Funnel: quotations, accepted and bookings per month (one count axis; the desks booked are in the tooltip).
    const fm = d.funnel?.months ?? [];
    this.upsert('funnel', this.funnelChartEmpty() ? undefined : this.funnelCanvas(), {
      type: 'bar',
      data: {
        labels: fm.map((x, i) => monthShort(x.month, i === 0)),
        datasets: FUNNEL_SERIES.map(s => ({
          label: s.label, data: fm.map(x => x[s.field]), backgroundColor: s.color, hoverBackgroundColor: s.hover,
          borderRadius: 4, maxBarThickness: 16, borderSkipped: 'start'
        }))
      },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        onHover: pointerOnHover,
        onClick: (_e: any, els: any[]) => { if (els.length) this.openFunnelMonth(els[0].index); },
        plugins: {
          legend: LEGEND,
          tooltip: {
            ...TOOLTIP,
            callbacks: {
              title: (items: any[]) => monthLong(fm[items[0]?.dataIndex]?.month ?? ''),
              label: (c: any) => ` ${c.dataset.label}: ${count(c.parsed.y)}`,
              footer: (items: any[]) => {
                const x = fm[items[0]?.dataIndex];
                if (!x) return '';
                const conv = x.quotations > 0 ? ` · conversion ${pct(ratio(x.quotationsBooked, x.quotations))}` : '';
                return `${desks(x.bookedDesks)} booked${conv}\nClick for locations`;
              }
            }
          }
        },
        scales: { x: xAxis, y: { beginAtZero: true, grid: GRID, border: { display: false }, ticks: { precision: 0, padding: 8 } } }
      }
    });

    // Tour inquiries: one stacked column per month, a segment per type (Tour Inquiries colours).
    const im = d.inquiries?.months ?? [];
    this.upsert('inquiries', this.inquiryChartEmpty() ? undefined : this.inquiriesCanvas(), {
      type: 'bar',
      data: {
        labels: im.map((x, i) => monthShort(x.month, i === 0)),
        datasets: INQUIRY_SERIES.map(s => ({
          label: INQUIRY_TYPES[s.key].label, data: im.map(x => x[s.field]),
          backgroundColor: INQUIRY_TYPES[s.key].fg, hoverBackgroundColor: INQUIRY_TYPES[s.key].fg,
          borderColor: '#fff', borderWidth: { top: 1 }, borderSkipped: false, maxBarThickness: 26, stack: 'types'
        }))
      },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        onHover: pointerOnHover,
        onClick: (_e: any, els: any[]) => { if (els.length) this.openInquiryMonth(els[0].index); },
        plugins: {
          legend: LEGEND,
          tooltip: {
            ...TOOLTIP,
            filter: (item: any) => item.parsed.y > 0,
            callbacks: {
              title: (items: any[]) => monthLong(im[items[0]?.dataIndex]?.month ?? ''),
              label: (c: any) => ` ${c.dataset.label}: ${count(c.parsed.y)}`,
              footer: (items: any[]) => {
                const x = im[items[0]?.dataIndex];
                return x ? `${count(this.inquiryMonthTotal(x))} in all · click for the inquiries` : '';
              }
            }
          }
        },
        scales: {
          x: { ...xAxis, stacked: true },
          y: { stacked: true, beginAtZero: true, grid: GRID, border: { display: false }, ticks: { precision: 0, padding: 8 } }
        }
      }
    });

    // Renewals & desks: desks booked and desks ending per month, side by side (the next 3 months show what ends).
    const rm = d.renewals?.months ?? [];
    this.upsert('desks', this.desksChartEmpty() ? undefined : this.desksCanvas(), {
      type: 'bar',
      data: {
        labels: rm.map((x, i) => monthShort(x.month, i === 0)),
        datasets: DESK_SERIES.map(s => ({
          label: s.label, data: rm.map(x => x[s.field]), backgroundColor: s.color, hoverBackgroundColor: s.hover,
          borderRadius: 4, maxBarThickness: 16, borderSkipped: 'start'
        }))
      },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        onHover: pointerOnHover,
        onClick: (_e: any, els: any[]) => { if (els.length) this.openDesksMonth(els[0].index); },
        plugins: {
          legend: LEGEND,
          tooltip: {
            ...TOOLTIP,
            callbacks: {
              title: (items: any[]) => monthLong(rm[items[0]?.dataIndex]?.month ?? ''),
              label: (c: any) => ` ${c.dataset.label}: ${count(c.parsed.y)}`,
              footer: (items: any[]) => {
                const x = rm[items[0]?.dataIndex];
                if (!x) return '';
                return `${count(x.expiring)} lease${x.expiring === 1 ? '' : 's'} ending\nClick for locations`;
              }
            }
          }
        },
        scales: { x: xAxis, y: { beginAtZero: true, grid: GRID, border: { display: false }, ticks: { precision: 0, padding: 8 } } }
      }
    });
  }

  /** Complaints raised and resolved per month, side by side (its own data, drawn when it arrives). */
  private renderComplaintsChart() {
    const c = this.cmp();
    const ref = c && !this.cmpEmpty() && !this.cmpChartEmpty() ? this.complaintsCanvas() : undefined;
    applyChartDefaults();
    const cm = c?.months ?? [];
    this.upsert('complaints', ref, {
      type: 'bar',
      data: {
        labels: cm.map((x, i) => monthShort(x.month, i === 0)),
        datasets: COMPLAINT_SERIES.map(s => ({
          label: s.label, data: cm.map(x => x[s.field]), backgroundColor: s.color, hoverBackgroundColor: s.hover,
          borderRadius: 4, maxBarThickness: 16, borderSkipped: 'start'
        }))
      },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        onHover: pointerOnHover,
        onClick: (_e: any, els: any[]) => { if (els.length) this.openComplaintMonth(els[0].index); },
        plugins: {
          legend: LEGEND,
          tooltip: {
            ...TOOLTIP,
            callbacks: {
              title: (items: any[]) => monthLong(cm[items[0]?.dataIndex]?.month ?? ''),
              label: (ctx: any) => ` ${ctx.dataset.label}: ${count(ctx.parsed.y)}`,
              footer: () => 'Click for the complaints raised that month'
            }
          }
        },
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 8 } },
          y: { beginAtZero: true, grid: GRID, border: { display: false }, ticks: { precision: 0, padding: 8 } }
        }
      }
    });
  }
}

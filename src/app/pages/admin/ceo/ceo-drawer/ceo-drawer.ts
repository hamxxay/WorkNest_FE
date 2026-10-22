import {
  Component, DestroyRef, ElementRef, HostListener, computed, effect, inject, input, output, signal, untracked, viewChild
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Subscription, map } from 'rxjs';
import {
  CeoBreakdown, CeoBreakdownRow, CeoBookingRecord, CeoError, CeoInquiryRecord, CeoInvoiceRecord, CeoInvoiceTotals, CeoLeaseRecord, CeoLocalMetric,
  CeoMetric, CeoParams, CeoPeriod, CeoQuotationRecord, CeoReceiptRecord, CeoRecordKind, CeoService, CeoSpaceRecord
} from '../../../../services/ceo.service';
import type {
  SmBookingRecord, SmComplaintRecord, SmLeaseRecord, SmQuotationRecord
} from '../../../../services/sales-manager.service';
import { DashRange, drillPeriodQuery } from '../../../../services/dashboard-api';
import { XlsxCell, downloadXlsx } from '../../../../utils/xlsx';
import { fileDate, fileSlug } from '../../../../utils/page-pdf';
import {
  AGING_COLORS, AXIS_MONEY, Chart, DrillLevel, DrillMetricSpec, DrillRecords, DrillRequest, DrillSource, GRID, INQUIRY_TYPES,
  LEGEND, SLATE_TRACK, TEAL, TEAL_DARK, TEAL_LIGHT, TEAL_LIGHT_HOVER, TOOLTIP, applyChartDefaults, complaintStatusStyle, count,
  fullMoney, inquiryTypeKey, money, pct, pointerOnHover, ratio, statusTone
} from '../ceo-shared';

type AnyLevel = DrillLevel<string, string>;
type SpaceFilter = 'all' | 'occupied' | 'vacant';

interface Entry {
  uid: number;
  level: AnyLevel;
  status: 'loading' | 'ok' | 'error';
  breakdown?: CeoBreakdown;
  records?: DrillRecords;
  error?: CeoError;
}

/** Inquiry record; the Sales Manager API adds the follow-up date. */
type InquiryRow = CeoInquiryRecord & { followUpOn?: string | null };
/** Booking / quotation record: an amount from the CEO API, desks from the Sales Manager API. */
type BookingRow = Omit<CeoBookingRecord, 'totalAmount'> & Partial<Pick<CeoBookingRecord, 'totalAmount'> & Pick<SmBookingRecord, 'desks'>>;
type QuotationRow = Omit<CeoQuotationRecord, 'total'> & Partial<Pick<CeoQuotationRecord, 'total'> & Pick<SmQuotationRecord, 'desks'>>;
/** Lease record: desks from the Sales Manager API, the monthly rent from the CEO API (records/leases). */
type LeaseRow = Omit<SmLeaseRecord, 'desks'> & Partial<Pick<SmLeaseRecord, 'desks'> & Pick<CeoLeaseRecord, 'monthlyAmount'>>;
/** Invoice record; the admin dashboard source adds its booking and space. */
type InvoiceRow = CeoInvoiceRecord & { bookingId?: number | null; space?: string | null };
/** Space record; the admin dashboard source adds the booking that holds it. */
type SpaceRow = CeoSpaceRecord & { bookingId?: number | null };
/** A link to another list about the same selection (DrillRecords.related). */
type RelatedList = NonNullable<DrillRecords['related']>[number];

/** "01 Nov 2026" from "yyyy-MM-dd" (no year: "01 Nov"); null when it is not a date. */
function dayText(iso: string | null | undefined, withYear = true): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  if (isNaN(d.getTime())) return null;
  const month = d.toLocaleString('en-US', { month: 'short' });
  return `${m[3]} ${month}${withYear ? ' ' + m[1] : ''}`;
}

/** An invoice's billing period: "01 Nov - 30 Nov 2026", "21 Oct 2026 - 31 Jan 2027", "From 01 Nov 2026"; null = none. */
function billingPeriodText(start: string | null | undefined, end: string | null | undefined): string | null {
  const from = dayText(start);
  if (!from) return null;
  const to = dayText(end);
  if (!to) return `From ${from}`;
  const sameYear = start!.slice(0, 4) === end!.slice(0, 4);
  return `${sameYear ? dayText(start, false) : from} - ${to}`;
}

/**
 * The line under an invoice list's title (CP_02): the totals of every invoice in it, as the dashboard counts them
 * (revenue and paid without security deposits). A list with a period (RC_05 sends its receivable): receivable = the
 * period's revenue - paid - the WHT customers withhold, as the Receivable card; else owed = what is left to pay on the
 * whole invoices. Undefined = none sent.
 */
function invoiceSummary(t: CeoInvoiceTotals | null | undefined): string | undefined {
  if (!t) return undefined;
  if (t.receivable !== null && t.receivable !== undefined)
    return `Revenue ${fullMoney(t.billed)} · paid ${fullMoney(t.collected)} · receivable ${fullMoney(Math.max(0, t.receivable))} (without security deposits and WHT withheld)`;
  return `Revenue ${fullMoney(t.billed)} · paid ${fullMoney(t.collected)} (without security deposits) · owed ${fullMoney(t.balance)}`;
}

/** Receivable of a revenue row (RC_05): revenue - paid - the WHT customers withhold (wht; 0 before RC_05), never below 0. */
function receivableOf(r: CeoBreakdownRow): number {
  return Math.max(0, r.value - (r.value2 ?? 0) - (r.wht ?? 0));
}
/** The Receivable column of the revenue breakdowns when they were opened from the Receivable card (status receivable). */
function receivableColumn(p: CeoParams) {
  return p['status'] === 'receivable' ? { label: 'Receivable', of: receivableOf } : null;
}

/** The CEO breakdowns: what their rows are, number format, and where a row leads (level 3). */
const METRICS: Record<CeoMetric | CeoLocalMetric, DrillMetricSpec> = {
  'revenue': {
    rowLabel: 'Location', money: true, chart: 'grouped', vertical: false,
    derived: { label: 'Rate', of: r => (r.value ? ratio(r.value2 ?? 0, r.value) : null) },
    amount: receivableColumn,
    // status: 'collected' when opened from Paid (CP_02: the invoices with something paid; the API's breakdown leaves
    // it out, the invoices use it); 'receivable' from Receivable (RC_05: the invoices with something left to pay for the
    // period). A custom period opens it with from / to instead of a month (the invoices whose billing period starts in
    // that range, CP_01).
    next: (p, r) => ({
      kind: 'records', records: 'invoices',
      params: { month: p['month'], from: p['from'], to: p['to'], locationId: r.key, status: p['status'] }, crumb: r.label
    }),
    nextLabel: (p, r) => p['status'] === 'collected' || p['status'] === 'paid' ? `Open the invoices of ${r.label} with payments`
      : p['status'] === 'receivable' ? `Open the invoices of ${r.label} with something left to pay` : `Open the invoices of ${r.label}`
  },
  // ----- level 2 lists built from the dashboard's own figures (DrillLevel.local) -----
  'revenue-months': {
    rowLabel: 'Month', money: true, chart: 'grouped', vertical: true,
    derived: { label: 'Rate', of: r => (r.value ? ratio(r.value2 ?? 0, r.value) : null) },
    amount: receivableColumn,
    next: (p, r) => ({ kind: 'breakdown', metric: 'revenue', params: { month: r.key, status: p['status'] }, crumb: r.label }),
    nextLabel: (_p, r) => `Open ${r.label} by location`,
    hint: () => 'Select a month for its locations.'
  },
  'aging-buckets': {
    rowLabel: 'Days past due', money: true, chart: 'single', vertical: false,
    next: (_p, r) => ({ kind: 'breakdown', metric: 'aging', params: { bucket: r.key }, crumb: r.label }),
    nextLabel: (_p, r) => `Open ${r.label} by location`,
    hint: () => 'Select a bucket for its locations.'
  },
  'occupancy-locations': {
    rowLabel: 'Location', money: false, chart: 'stacked-occupancy', vertical: false,
    derived: { label: 'Occupancy', of: r => (r.value2 ? ratio(r.value, r.value2) : null) },
    // occupied: true when opened from the Occupancy KPI: only the occupied rooms, down to the list of spaces.
    next: (p, r) => ({ kind: 'breakdown', metric: 'occupancy-location', params: { locationId: r.key, occupied: p['occupied'] }, crumb: r.label }),
    nextLabel: (p, r) => p['occupied'] ? `Open the occupied rooms of ${r.label} by space type` : `Open ${r.label} by space type`,
    hint: () => 'Select a location for its space types.',
    keep: (p, r) => !p['occupied'] || r.value > 0
  },
  'aging': {
    rowLabel: 'Location', money: true, chart: 'single', vertical: false,
    next: (p, r) => ({ kind: 'records', records: 'invoices', params: { bucket: p['bucket'], locationId: r.key }, crumb: r.label })
  },
  'occupancy-type': {
    rowLabel: 'Location', money: false, chart: 'stacked-occupancy', vertical: false,
    derived: { label: 'Occupancy', of: r => (r.value2 ? ratio(r.value, r.value2) : null) },
    next: (p, r) => ({ kind: 'records', records: 'spaces', params: { spaceTypeId: p['spaceTypeId'], locationId: r.key }, crumb: r.label })
  },
  'occupancy-location': {
    rowLabel: 'Room category', money: false, chart: 'stacked-occupancy', vertical: false,
    derived: { label: 'Occupancy', of: r => (r.value2 ? ratio(r.value, r.value2) : null) },
    // CP_02: rows per room category (key PrivateOffice | SharedSpace); before it per space type (numeric key).
    next: (p, r) => ({
      kind: 'records', records: 'spaces',
      params: /^\d+$/.test(r.key)
        ? { locationId: p['locationId'], spaceTypeId: r.key, occupied: p['occupied'] }
        : { locationId: p['locationId'], category: r.key, occupied: p['occupied'] },
      crumb: r.label
    }),
    nextLabel: (p, r) => p['occupied'] ? `Open the occupied ${r.label} rooms` : `Open ${r.label}`,
    keep: (p, r) => !p['occupied'] || r.value > 0
  },
  // CP_02: one room category (Private Office / Shared Space) by location, rooms with a confirmed booking now; from the
  // category's KPI card only the occupied rooms (occupied: true).
  'occupancy-category': {
    rowLabel: 'Location', money: false, chart: 'stacked-occupancy', vertical: false,
    derived: { label: 'Occupancy', of: r => (r.value2 ? ratio(r.value, r.value2) : null) },
    next: (p, r) => ({ kind: 'records', records: 'spaces', params: { category: p['category'], locationId: r.key, occupied: p['occupied'] }, crumb: r.label }),
    nextLabel: (p, r) => p['occupied'] ? `Open the occupied rooms of ${r.label}` : `Open the rooms of ${r.label}`,
    hint: () => 'Select a location for its rooms.',
    keep: (p, r) => !p['occupied'] || r.value > 0
  },
  'bookings-month': {
    rowLabel: 'Location', money: false, chart: 'single', vertical: false,
    next: (p, r) => ({ kind: 'records', records: 'bookings', params: { month: p['month'], locationId: r.key }, crumb: r.label })
  },
  'inquiries-type': {
    rowLabel: 'Month', money: false, chart: 'single', vertical: true,
    next: (p, r) => ({ kind: 'records', records: 'inquiries', params: { type: p['type'], month: r.key }, crumb: r.label })
  },
  'staff': {
    rowLabel: 'Month', money: false, chart: 'grouped', vertical: true,
    derived: { label: 'Conversion', of: r => (r.value ? ratio(r.value2 ?? 0, r.value) : null) },
    next: (p, r) => ({ kind: 'records', records: 'quotations', params: { userId: p['userId'], month: r.key }, crumb: r.label })
  }
};

const RECORD_TITLES: Record<string, string> = {
  invoices: 'Invoices', spaces: 'Spaces', bookings: 'Bookings', inquiries: 'Tour inquiries', quotations: 'Quotations',
  leases: 'Expiring leases', complaints: 'Complaints', receipts: 'Money received'
};

/**
 * Right-side drill-down drawer of the CEO and Sales Manager dashboards. Level 2: a breakdown (small bar chart +
 * table) from GET api/ceo/breakdown (or the `source` the page passes, e.g. api/sales-manager/breakdown); a row
 * opens level 3: the matching records. Breadcrumb, Back, Close and Escape. Read-only: no actions on any record.
 */
@Component({
  selector: 'app-ceo-drawer',
  standalone: true,
  imports: [DatePipe, RouterLink],
  templateUrl: './ceo-drawer.html',
  styleUrl: './ceo-drawer.css'
})
export class CeoDrawer {
  private ceo = inject(CeoService);
  private host = inject(ElementRef<HTMLElement>);

  /** What to open (a new id opens it again from its first level); null = closed. */
  request = input<DrillRequest<string, string> | null>(null);
  /** Where the levels come from; null = the CEO API. */
  source = input<DrillSource | null>(null);
  period = input<CeoPeriod>('month');
  /** The dashboard's custom range (period custom); every level asks for the same range. */
  range = input<DashRange | null>(null);
  /** The dashboard's location filter; a level's own locationId wins. */
  locationId = input<number | null>(null);
  closed = output<void>();

  readonly money = money;
  readonly fullMoney = fullMoney;
  readonly pct = pct;
  readonly count = count;
  readonly statusTone = statusTone;

  entries = signal<Entry[]>([]);
  current = computed<Entry | null>(() => this.entries().at(-1) ?? null);
  open = computed(() => !!this.request() && this.entries().length > 0);
  crumbs = computed(() => [this.request()?.root ?? '', ...this.entries().map(e => e.level.crumb)].filter(Boolean));

  private readonly ceoSource: DrillSource = {
    metrics: METRICS,
    breakdown: (metric, params) => this.ceo.getBreakdown(metric as CeoMetric, params),
    records: (kind, params) => this.ceo.getRecords(kind as CeoRecordKind, params).pipe(map(r => ({ ...r, summary: invoiceSummary(r.invoiceTotals) }))),
    describeError: err => CeoService.describeError(err)
  };
  private src = computed<DrillSource>(() => this.source() ?? this.ceoSource);
  /** Records count desks instead of amounts (Sales Manager). */
  desks = computed(() => !!this.src().desks);

  spec = computed<DrillMetricSpec | null>(() => {
    const e = this.current();
    return e?.level.kind === 'breakdown' ? this.src().metrics[e.level.metric] ?? null : null;
  });

  title = computed(() => {
    const e = this.current();
    if (!e) return '';
    if (e.level.kind === 'breakdown') return e.breakdown?.title || `${this.request()?.root ?? ''}: ${e.level.crumb}`;
    const base = RECORD_TITLES[e.level.records] ?? 'Records';
    return e.records?.title || (e.level.crumb.toLowerCase() === base.toLowerCase() ? base : `${base}: ${e.level.crumb}`);
  });

  private uid = 0;
  private sub: Subscription | null = null;
  private chart: Chart | null = null;
  private returnFocus: HTMLElement | null = null;
  private panel = viewChild<ElementRef<HTMLElement>>('panel');
  private heading = viewChild<ElementRef<HTMLElement>>('heading');
  private bdCanvas = viewChild<ElementRef<HTMLCanvasElement>>('bdCanvas');

  constructor() {
    inject(DestroyRef).onDestroy(() => { this.sub?.unsubscribe(); this.destroyChart(); });

    // A new request: start again from its first level.
    effect(() => {
      const req = this.request();
      untracked(() => {
        if (!req) { this.reset(); return; }
        if (!this.entries().length) {
          const active = document.activeElement as HTMLElement | null;
          this.returnFocus = active && !this.host.nativeElement.contains(active) ? active : null;
        }
        this.sub?.unsubscribe();
        this.entries.set([]);
        this.push(req.level);
      });
    });

    // A level built from the dashboard's figures follows them (e.g. once the new period's figures arrive).
    effect(() => {
      const e = this.current();
      if (!e || e.level.kind !== 'breakdown' || !e.level.local) return;
      const b = e.level.local();
      untracked(() => {
        if (e.status !== 'ok' || e.breakdown !== b) this.patch(e.uid, { status: 'ok', breakdown: b, error: undefined });
      });
    });

    // Period, range or location changed under an open drawer: reload what is on screen.
    effect(() => {
      this.period(); this.range(); this.locationId();
      untracked(() => { const e = this.current(); if (e) this.load(e); });
    });

    // Level 2 chart: (re)drawn once its canvas is on screen with data.
    effect(() => {
      const canvas = this.bdCanvas();
      const e = this.current();
      untracked(() => {
        this.destroyChart();
        if (canvas && e?.status === 'ok' && e.breakdown && e.level.kind === 'breakdown') {
          const metric = e.level.metric;
          const data = e.breakdown;
          setTimeout(() => { if (this.current()?.uid === e.uid) this.renderChart(canvas.nativeElement, metric, data); });
        }
      });
    });
  }

  // ---------- navigation ----------

  private push(level: AnyLevel) {
    const entry: Entry = { uid: ++this.uid, level, status: 'loading' };
    this.entries.update(list => [...list, entry]);
    this.load(entry);
    this.focusHeading();
  }

  back() {
    if (this.entries().length <= 1) return;
    this.sub?.unsubscribe();
    this.entries.update(list => list.slice(0, -1));
    const e = this.current();
    if (e && e.status !== 'ok') this.load(e);
    this.focusHeading();
  }

  /** Breadcrumb: 0 is the root label (not a level); 1..n are levels. */
  goTo(crumbIndex: number) {
    const keep = crumbIndex; // levels 0..crumbIndex-1 stay
    if (keep < 1 || keep >= this.entries().length) return;
    this.sub?.unsubscribe();
    this.entries.update(list => list.slice(0, keep));
    const e = this.current();
    if (e && e.status !== 'ok') this.load(e);
    this.focusHeading();
  }

  close() {
    if (!this.entries().length) return;
    this.reset();
    this.closed.emit();
    const target = this.returnFocus;
    this.returnFocus = null;
    if (target && document.contains(target)) setTimeout(() => target.focus({ preventScroll: true }));
  }

  retry() {
    const e = this.current();
    if (e) this.load(e);
  }

  /** Level 2 row (or chart bar) -> level 3. */
  openRow(row: CeoBreakdownRow) {
    const e = this.current();
    if (!e || e.level.kind !== 'breakdown' || !row.key) return;
    const spec = this.src().metrics[e.level.metric];
    if (spec) this.push(spec.next(e.level.params, row));
  }

  /** A related list offered above a records list (DrillRecords.related) -> that list. */
  openRelated(x: RelatedList) {
    if (this.current()?.level.kind === 'records') this.push(x.level);
  }

  /** The second list a level 2 row offers (its link under the row) -> level 3. */
  openSecondary(row: CeoBreakdownRow) {
    const e = this.current();
    if (!e || e.level.kind !== 'breakdown' || !row.key) return;
    const alt = this.src().metrics[e.level.metric]?.secondary?.(e.level.params, row);
    if (alt) this.push(alt.level);
  }

  private reset() {
    this.sub?.unsubscribe();
    this.destroyChart();
    this.entries.set([]);
  }

  private focusHeading() {
    setTimeout(() => (this.heading()?.nativeElement ?? this.panel()?.nativeElement)?.focus({ preventScroll: true }));
  }

  // ---------- data ----------

  private load(entry: Entry) {
    this.sub?.unsubscribe();
    this.patch(entry.uid, { status: 'loading', error: undefined });
    // The dashboard's period (a custom one as periodFrom / periodTo) and location; the level's own params win.
    const params: CeoParams = { ...drillPeriodQuery(this.period(), this.range()), locationId: this.locationId(), ...entry.level.params };
    const src = this.src();
    if (entry.level.kind === 'breakdown' && entry.level.local) {
      this.patch(entry.uid, { status: 'ok', breakdown: entry.level.local() });
      return;
    }
    if (entry.level.kind === 'breakdown') {
      this.sub = src.breakdown(entry.level.metric, params).subscribe({
        next: b => this.patch(entry.uid, { status: 'ok', breakdown: b }),
        error: (err: unknown) => this.patch(entry.uid, { status: 'error', error: src.describeError(err) })
      });
    } else {
      this.sub = src.records(entry.level.records, params).subscribe({
        next: r => this.patch(entry.uid, { status: 'ok', records: r }),
        error: (err: unknown) => this.patch(entry.uid, { status: 'error', error: src.describeError(err) })
      });
    }
  }

  private patch(uid: number, change: Partial<Entry>) {
    this.entries.update(list => list.map(e => (e.uid === uid ? { ...e, ...change } : e)));
  }

  // ---------- level 2 helpers ----------

  rows = computed<CeoBreakdownRow[]>(() => {
    const e = this.current();
    const rows = e?.breakdown?.rows ?? [];
    const keep = this.spec()?.keep;
    return keep && e?.level.kind === 'breakdown' ? rows.filter(r => keep(e.level.params, r)) : rows;
  });
  hasValue2 = computed(() => !!this.current()?.breakdown?.value2Label || this.rows().some(r => r.value2 !== null));
  hasCount = computed(() => this.rows().some(r => r.count !== null));
  /** The extra amount column of this breakdown (e.g. Receivable), null = none. */
  amountCol = computed(() => {
    const e = this.current();
    return e?.level.kind === 'breakdown' ? this.spec()?.amount?.(e.level.params) ?? null : null;
  });
  canOpenRows = computed(() => this.rows().some(r => !!r.key));
  /** The second list each row offers (same order as rows), null where none. */
  secondaries = computed(() => {
    const e = this.current();
    const spec = this.spec();
    if (!spec?.secondary || e?.level.kind !== 'breakdown') return this.rows().map(() => null);
    const params = e.level.params;
    return this.rows().map(r => (r.key ? spec.secondary!(params, r) : null));
  });
  /** The line under the table. */
  hintText = computed(() => {
    const e = this.current();
    const spec = this.spec();
    return spec?.hint && e?.level.kind === 'breakdown' ? spec.hint(e.level.params) : 'Select a row to see the records behind it.';
  });
  /** What a row opens, for screen readers. */
  rowAction(r: CeoBreakdownRow): string {
    const e = this.current();
    const spec = this.spec();
    return spec?.nextLabel && e?.level.kind === 'breakdown' ? spec.nextLabel(e.level.params, r) : 'Open ' + r.label;
  }
  totals = computed(() => {
    const rows = this.rows();
    return {
      value: rows.reduce((a, r) => a + r.value, 0),
      value2: rows.reduce((a, r) => a + (r.value2 ?? 0), 0),
      count: rows.reduce((a, r) => a + (r.count ?? 0), 0),
      wht: rows.reduce((a, r) => a + (r.wht ?? 0), 0)
    };
  });
  /** The extra amount column's total: the sum of its rows. */
  amountTotal(): number | null {
    const a = this.amountCol();
    return a ? this.rows().reduce((t, r) => t + a.of(r), 0) : null;
  }
  /** The two values are in different units (a count and an amount): only the first one sets the bar widths. */
  private mixedUnits = computed(() => {
    const s = this.spec();
    return !!s && (!!s.separateUnits || (s.money2 !== undefined && s.money2 !== s.money));
  });
  /** Bar widths in the table, relative to the biggest row. */
  maxValue = computed(() => Math.max(1, ...this.rows().map(r => (this.mixedUnits() ? r.value : Math.max(r.value, r.value2 ?? 0)))));

  fmt(v: number | null | undefined): string {
    if (v === null || v === undefined) return '-';
    return this.spec()?.money ? money(v) : count(v);
  }
  fmtFull(v: number | null | undefined): string {
    if (v === null || v === undefined) return '';
    return this.spec()?.money ? fullMoney(v) : count(v);
  }
  /** Second value: its own format when the metric says so, else the same as the first. */
  private money2(): boolean { const s = this.spec(); return !!(s?.money2 ?? s?.money); }
  fmt2(v: number | null | undefined): string {
    if (v === null || v === undefined) return '-';
    return this.money2() ? money(v) : count(v);
  }
  fmtFull2(v: number | null | undefined): string {
    if (v === null || v === undefined) return '';
    return this.money2() ? fullMoney(v) : count(v);
  }
  derivedText(v: number | null | undefined): string {
    return v === null || v === undefined ? '-' : pct(v);
  }
  /** Level 2 chart: months stand as columns; locations / space types as rows (taller with more rows). */
  chartHeight = computed(() => (this.spec()?.vertical ? 200 : Math.min(280, 70 + this.rows().length * 30)));
  derivedTotal(): number | null {
    const s = this.spec();
    if (!s?.derived) return null;
    const t = this.totals();
    return s.derived.of({ key: '', label: '', value: t.value, value2: t.value2, count: t.count });
  }

  // ---------- level 3 helpers ----------

  /**
   * RC_05: an invoice list with a period (the API sends each row's receivable): the rows show the period's revenue /
   * paid / receivable, the whole invoice's total / paid / balance as a second line.
   */
  invoiceWindowed = computed(() => this.invoiceRows().some(r => r.receivable !== null && r.receivable !== undefined));

  invoiceRows = computed(() => this.recordsOf<InvoiceRow>('invoices'));
  /** A Security deposit column when any invoice in the list has one (kept out of the Revenue / Amount column). */
  invoiceDeposits = computed(() => this.invoiceRows().some(r => !!r.deposit));
  spaceRows = computed(() => this.recordsOf<SpaceRow>('spaces'));
  bookingRows = computed(() => this.recordsOf<BookingRow>('bookings'));
  inquiryRows = computed(() => this.recordsOf<InquiryRow>('inquiries'));
  quotationRows = computed(() => this.recordsOf<QuotationRow>('quotations'));
  leaseRows = computed(() => this.recordsOf<LeaseRow>('leases'));
  complaintRows = computed(() => this.recordsOf<SmComplaintRecord>('complaints'));
  /** CP_02: fee receipts and payments (records/receipts). */
  receiptRows = computed(() => this.recordsOf<CeoReceiptRecord>('receipts'));
  /** The record the level marks (e.g. the complaint selected on the dashboard); null = none. */
  highlight = computed<number | null>(() => {
    const e = this.current();
    return e?.level.kind === 'records' ? e.level.highlight ?? null : null;
  });
  /** Follow-up column on inquiry lists that carry a follow-up date (Sales Manager API). */
  inquiryFollowUp = computed(() => this.inquiryRows().some(r => !!r.followUpOn));

  // Spaces: a filter (all / occupied / vacant) when the list has both, and no column that repeats one value on every
  // row (the location or space type the list was opened for, or the status of an occupied-only list).
  private spaceFilterOf = signal<{ uid: number; show: SpaceFilter }>({ uid: -1, show: 'all' });
  spaceFilter = computed<SpaceFilter>(() => {
    const f = this.spaceFilterOf();
    return this.spaceMixed() && f.uid === this.current()?.uid ? f.show : 'all';
  });
  spaceStats = computed(() => {
    const rows = this.spaceRows();
    const occupied = rows.filter(r => r.occupied);
    return {
      all: rows.length, occupied: occupied.length, vacant: rows.length - occupied.length,
      // CP_02: the seats sold of the confirmed bookings when the API sends them, else the rooms' seats.
      seatsInUse: occupied.reduce((a, r) => a + (r.seatsSold ?? r.capacity ?? 0), 0)
    };
  });
  spaceMixed = computed(() => this.spaceStats().occupied > 0 && this.spaceStats().vacant > 0);
  spaceShown = computed(() => {
    const show = this.spaceFilter();
    return show === 'all' ? this.spaceRows() : this.spaceRows().filter(r => r.occupied === (show === 'occupied'));
  });
  spaceManyLocations = computed(() => new Set(this.spaceRows().map(r => r.location)).size > 1);
  spaceManyTypes = computed(() => new Set(this.spaceRows().map(r => r.spaceType)).size > 1);
  setSpaceFilter(show: SpaceFilter) {
    const uid = this.current()?.uid;
    if (uid !== undefined) this.spaceFilterOf.set({ uid, show });
  }
  /** The line under a space's name: its type and location, when the list has more than one. */
  spaceSub(r: CeoSpaceRecord): string {
    return [this.spaceManyTypes() ? r.spaceType : '', this.spaceManyLocations() ? r.location : ''].filter(Boolean).join(' · ');
  }

  private recordsOf<T>(kind: string): T[] {
    const e = this.current();
    return e?.level.kind === 'records' && e.level.records === kind ? ((e.records?.rows ?? []) as unknown as T[]) : [];
  }

  recordKind = computed(() => {
    const e = this.current();
    return e?.level.kind === 'records' ? e.level.records : null;
  });
  recordTotal = computed(() => this.current()?.records?.total ?? 0);
  /** Other lists about the same selection (links above the table), from the source; none on the CEO pages. */
  related = computed<RelatedList[]>(() => {
    const e = this.current();
    return e?.level.kind === 'records' && e.status === 'ok' ? e.records?.related ?? [] : [];
  });
  /** Where a booking number links to (the source decides); null = plain text. */
  bookingLink(bookingId: number | null | undefined) {
    return bookingId ? this.src().bookingLink?.(bookingId) ?? null : null;
  }
  /** The billing period under an invoice number (CP_01); null = not sent: the list shows the issue date only. */
  periodOf(r: InvoiceRow): string | null {
    return billingPeriodText(r.periodStart, r.periodEnd);
  }

  /** The line under an invoice's customer: its space and location (the CEO records have only the location). */
  placeOf(r: InvoiceRow): string {
    return [r.space, r.location].filter(Boolean).join(' · ');
  }
  recordShown = computed(() => this.current()?.records?.rows.length ?? 0);

  typeStyle(type: string) { return INQUIRY_TYPES[inquiryTypeKey(type)]; }
  complaintStyle(status: string) { return complaintStatusStyle(status); }
  /** Open or in progress (its age matters). */
  isActiveComplaint(status: string): boolean { return status === 'open' || status === 'in_progress'; }
  /** "Today", "1 day", "12 days". */
  ageText(days: number | null): string {
    return days === null ? '' : days <= 0 ? 'Today' : days === 1 ? '1 day' : `${count(days)} days`;
  }

  /** "Ends today", "1 day left", "12 days left", "Ended 3 days ago". */
  leaseDaysText(days: number): string {
    if (days === 0) return 'Ends today';
    if (days < 0) return `Ended ${count(-days)} day${days === -1 ? '' : 's'} ago`;
    return `${count(days)} day${days === 1 ? '' : 's'} left`;
  }

  /** Whole days from today to an ISO date (negative = past). */
  daysFrom(date: string | null): number | null {
    if (!date) return null;
    const d = new Date(date.length <= 10 ? date + 'T00:00:00' : date);
    if (isNaN(d.getTime())) return null;
    const t = new Date(); t.setHours(0, 0, 0, 0); d.setHours(0, 0, 0, 0);
    return Math.round((d.getTime() - t.getTime()) / 86400000);
  }

  // ---------- Excel: the level on screen ----------

  canExport = computed(() => {
    const e = this.current();
    if (e?.status !== 'ok') return false;
    return e.level.kind === 'breakdown' ? this.rows().length > 0 : (e.records?.rows.length ?? 0) > 0;
  });

  /**
   * The breakdown (its rows with both values, the derived % and the count) or the records list (every field but the
   * ids, as the API sends them) as an .xlsx; a second sheet says what it is.
   */
  exportExcel() {
    const e = this.current();
    if (!e || !this.canExport()) return;
    let table: XlsxCell[][];
    if (e.level.kind === 'breakdown' && e.breakdown) {
      const spec = this.spec();
      const b = e.breakdown;
      const v2 = this.hasValue2(), cnt = this.hasCount(), derived = spec?.derived, amount = this.amountCol();
      const unit = spec?.money ? ' (PKR)' : '';
      const unit2 = (spec?.money2 ?? spec?.money) ? ' (PKR)' : '';
      table = [
        [spec?.rowLabel ?? 'Row', `${b.valueLabel}${unit}`, ...(v2 ? [`${b.value2Label || 'Second value'}${unit2}`] : []),
          ...(amount ? [`${amount.label}${unit}`] : []), ...(derived ? [`${derived.label} (%)`] : []), ...(cnt ? ['Items'] : [])],
        ...this.rows().map(r => {
          const d = derived?.of(r);
          return [r.label, r.value, ...(v2 ? [r.value2] : []), ...(amount ? [Math.round(amount.of(r) * 100) / 100] : []),
            ...(derived ? [d === null || d === undefined ? null : Math.round(d * 10) / 10] : []),
            ...(cnt ? [r.count] : [])];
        })
      ];
    } else {
      const list = (e.records?.rows ?? []) as Record<string, unknown>[];
      const keys = Object.keys(list[0] ?? {}).filter(k => !/Id$/.test(k));
      const head = (k: string) => {
        const words = k.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
        return words.charAt(0).toUpperCase() + words.slice(1);
      };
      const cell = (v: unknown): XlsxCell =>
        typeof v === 'boolean' ? (v ? 'Yes' : 'No') : typeof v === 'number' || typeof v === 'string' ? v : v === null || v === undefined ? null : String(v);
      table = [keys.map(head), ...list.map(r => keys.map(k => cell(r[k])))];
    }
    const sub = e.breakdown?.subtitle;
    const about: XlsxCell[][] = [
      [this.title()],
      ...(sub ? [[sub]] : []),
      ['Path', this.crumbs().join(' / ')],
      ...(e.level.kind === 'records' ? [['Rows', `${this.recordShown()} of ${this.recordTotal()}`]] : []),
      ...(this.desks() ? [] : [['Money in PKR']]),
      ['Generated', new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })]
    ];
    downloadXlsx(`${fileSlug('WorkNest', this.request()?.root ?? '', e.level.crumb)}-${fileDate()}.xlsx`, [
      { name: e.level.kind === 'records' ? RECORD_TITLES[e.level.records] ?? 'Records' : 'Breakdown', rows: table },
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

  // ---------- level 2 chart ----------

  private destroyChart() {
    this.chart?.destroy();
    this.chart = null;
  }

  private renderChart(canvas: HTMLCanvasElement, metric: string, data: CeoBreakdown) {
    this.destroyChart();
    const spec = this.src().metrics[metric];
    if (!canvas.isConnected || !data.rows.length || !spec) return;
    applyChartDefaults();
    const rows = data.rows;
    const labels = rows.map(r => (r.label.length > 18 ? r.label.slice(0, 17) + '…' : r.label));
    const fmt = (v: number) => (spec.money ? fullMoney(v) : count(v));
    const vertical = spec.vertical;
    const valueAxis = { beginAtZero: true, grid: GRID, border: { display: false }, ticks: spec.money ? AXIS_MONEY : { precision: 0 } };
    const catAxis = { grid: { display: false }, border: { display: false } };

    let datasets: any[];
    if (spec.chart === 'stacked-occupancy') {
      datasets = [
        { label: data.valueLabel || 'Occupied', data: rows.map(r => r.value), backgroundColor: TEAL, hoverBackgroundColor: TEAL_DARK, borderRadius: 4, maxBarThickness: 18, borderSkipped: false },
        { label: 'Vacant', data: rows.map(r => Math.max(0, (r.value2 ?? 0) - r.value)), backgroundColor: SLATE_TRACK, hoverBackgroundColor: '#cbd5e1', borderRadius: 4, maxBarThickness: 18, borderSkipped: false }
      ];
    } else if (spec.chart === 'grouped' && rows.some(r => r.value2 !== null)) {
      datasets = [
        { label: data.valueLabel, data: rows.map(r => r.value), backgroundColor: TEAL_LIGHT, hoverBackgroundColor: TEAL_LIGHT_HOVER, borderRadius: 4, maxBarThickness: 18 },
        { label: data.value2Label || 'Second value', data: rows.map(r => r.value2 ?? 0), backgroundColor: TEAL, hoverBackgroundColor: TEAL_DARK, borderRadius: 4, maxBarThickness: 18 }
      ];
    } else {
      const req = this.current()?.level;
      let color: string | string[] = TEAL, hover: string | string[] = TEAL_DARK;
      if (metric === 'aging' && req?.kind === 'breakdown') { color = AGING_COLORS[String(req.params['bucket'])] ?? TEAL; hover = color; }
      if (metric === 'aging-buckets') { color = rows.map(r => AGING_COLORS[r.key] ?? TEAL); hover = color; }
      if (metric === 'inquiries-type' && req?.kind === 'breakdown') { color = INQUIRY_TYPES[inquiryTypeKey(String(req.params['type']))].fg; hover = color; }
      datasets = [{ label: data.valueLabel, data: rows.map(r => r.value), backgroundColor: color, hoverBackgroundColor: hover, borderRadius: 4, maxBarThickness: vertical ? 28 : 18 }];
    }

    const stacked = spec.chart === 'stacked-occupancy';
    this.chart = new Chart(canvas, {
      type: 'bar',
      data: { labels, datasets },
      options: {
        indexAxis: vertical ? 'x' : 'y',
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false, axis: vertical ? 'x' : 'y' },
        onHover: pointerOnHover as any,
        onClick: (_e: any, els: any[]) => { const i = els[0]?.index; if (i !== undefined && rows[i]) this.openRow(rows[i]); },
        plugins: {
          legend: datasets.length > 1 ? LEGEND : { display: false },
          tooltip: {
            ...TOOLTIP,
            callbacks: {
              title: (items: any[]) => rows[items[0]?.dataIndex]?.label ?? '',
              label: (c: any) => ` ${c.dataset.label}: ${fmt(vertical ? c.parsed.y : c.parsed.x)}`,
              footer: (items: any[]) => {
                const r = rows[items[0]?.dataIndex];
                if (!r) return '';
                const d = spec.derived?.of(r);
                const parts = [];
                if (d !== null && d !== undefined && spec.derived) parts.push(`${spec.derived.label}: ${pct(d)}`);
                if (r.count !== null) parts.push(`${count(r.count)} item${r.count === 1 ? '' : 's'}`);
                return parts.join(' · ');
              }
            }
          }
        },
        scales: vertical
          ? { x: { ...catAxis, stacked }, y: { ...valueAxis, stacked } }
          : { x: { ...valueAxis, stacked }, y: { ...catAxis, stacked } }
      } as any
    });
  }
}

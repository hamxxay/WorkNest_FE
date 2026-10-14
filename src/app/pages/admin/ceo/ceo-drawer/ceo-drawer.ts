import {
  Component, DestroyRef, ElementRef, HostListener, computed, effect, inject, input, output, signal, untracked, viewChild
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { Subscription } from 'rxjs';
import {
  CeoBreakdown, CeoBreakdownRow, CeoBookingRecord, CeoError, CeoInquiryRecord, CeoInvoiceRecord, CeoMetric, CeoParams,
  CeoPeriod, CeoQuotationRecord, CeoRecordKind, CeoService, CeoSpaceRecord
} from '../../../../services/ceo.service';
import type { SmLeaseRecord } from '../../../../services/sales-manager.service';
import {
  AGING_COLORS, AXIS_MONEY, Chart, DrillLevel, DrillMetricSpec, DrillRecords, DrillRequest, DrillSource, GRID, INQUIRY_TYPES,
  LEGEND, SLATE_TRACK, TEAL, TEAL_DARK, TEAL_LIGHT, TEAL_LIGHT_HOVER, TOOLTIP, applyChartDefaults, count, fullMoney,
  inquiryTypeKey, money, pct, pointerOnHover, ratio, statusTone
} from '../ceo-shared';

type AnyLevel = DrillLevel<string, string>;

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

/** The CEO breakdowns: what their rows are, number format, and where a row leads (level 3). */
const METRICS: Record<CeoMetric, DrillMetricSpec> = {
  'revenue': {
    rowLabel: 'Location', money: true, chart: 'grouped', vertical: false,
    derived: { label: 'Rate', of: r => (r.value ? ratio(r.value2 ?? 0, r.value) : null) },
    next: (p, r) => ({ kind: 'records', records: 'invoices', params: { month: p['month'], locationId: r.key }, crumb: r.label })
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
    rowLabel: 'Space type', money: false, chart: 'stacked-occupancy', vertical: false,
    derived: { label: 'Occupancy', of: r => (r.value2 ? ratio(r.value, r.value2) : null) },
    next: (p, r) => ({ kind: 'records', records: 'spaces', params: { locationId: p['locationId'], spaceTypeId: r.key }, crumb: r.label })
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
  leases: 'Expiring leases'
};

/**
 * Right-side drill-down drawer of the CEO and Sales Manager dashboards. Level 2: a breakdown (small bar chart +
 * table) from GET api/ceo/breakdown (or the `source` the page passes, e.g. api/sales-manager/breakdown); a row
 * opens level 3: the matching records. Breadcrumb, Back, Close and Escape. Read-only: no actions on any record.
 */
@Component({
  selector: 'app-ceo-drawer',
  standalone: true,
  imports: [DatePipe],
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
    records: (kind, params) => this.ceo.getRecords(kind as CeoRecordKind, params),
    describeError: err => CeoService.describeError(err)
  };
  private src = computed<DrillSource>(() => this.source() ?? this.ceoSource);

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

    // Period or location changed under an open drawer: reload what is on screen.
    effect(() => {
      this.period(); this.locationId();
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
    const params: CeoParams = { period: this.period(), locationId: this.locationId(), ...entry.level.params };
    const src = this.src();
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

  rows = computed<CeoBreakdownRow[]>(() => this.current()?.breakdown?.rows ?? []);
  hasValue2 = computed(() => !!this.current()?.breakdown?.value2Label || this.rows().some(r => r.value2 !== null));
  hasCount = computed(() => this.rows().some(r => r.count !== null));
  canOpenRows = computed(() => this.rows().some(r => !!r.key));
  totals = computed(() => {
    const rows = this.rows();
    return {
      value: rows.reduce((a, r) => a + r.value, 0),
      value2: rows.reduce((a, r) => a + (r.value2 ?? 0), 0),
      count: rows.reduce((a, r) => a + (r.count ?? 0), 0)
    };
  });
  /** The two values are in different units (a count and an amount): only the first one sets the bar widths. */
  private mixedUnits = computed(() => {
    const s = this.spec();
    return !!s && s.money2 !== undefined && s.money2 !== s.money;
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

  invoiceRows = computed(() => this.recordsOf<CeoInvoiceRecord>('invoices'));
  spaceRows = computed(() => this.recordsOf<CeoSpaceRecord>('spaces'));
  bookingRows = computed(() => this.recordsOf<CeoBookingRecord>('bookings'));
  inquiryRows = computed(() => this.recordsOf<InquiryRow>('inquiries'));
  quotationRows = computed(() => this.recordsOf<CeoQuotationRecord>('quotations'));
  leaseRows = computed(() => this.recordsOf<SmLeaseRecord>('leases'));
  /** Follow-up column on inquiry lists that carry a follow-up date (Sales Manager API). */
  inquiryFollowUp = computed(() => this.inquiryRows().some(r => !!r.followUpOn));

  private recordsOf<T>(kind: string): T[] {
    const e = this.current();
    return e?.level.kind === 'records' && e.level.records === kind ? ((e.records?.rows ?? []) as unknown as T[]) : [];
  }

  recordKind = computed(() => {
    const e = this.current();
    return e?.level.kind === 'records' ? e.level.records : null;
  });
  recordTotal = computed(() => this.current()?.records?.total ?? 0);
  recordShown = computed(() => this.current()?.records?.rows.length ?? 0);

  typeStyle(type: string) { return INQUIRY_TYPES[inquiryTypeKey(type)]; }

  /** Whole days from today to an ISO date (negative = past). */
  daysFrom(date: string | null): number | null {
    if (!date) return null;
    const d = new Date(date.length <= 10 ? date + 'T00:00:00' : date);
    if (isNaN(d.getTime())) return null;
    const t = new Date(); t.setHours(0, 0, 0, 0); d.setHours(0, 0, 0, 0);
    return Math.round((d.getTime() - t.getTime()) / 86400000);
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
      let color = TEAL, hover = TEAL_DARK;
      if (metric === 'aging' && req?.kind === 'breakdown') { color = AGING_COLORS[String(req.params['bucket'])] ?? TEAL; hover = color; }
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

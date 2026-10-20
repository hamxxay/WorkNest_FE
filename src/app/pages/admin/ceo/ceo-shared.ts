import { Observable } from 'rxjs';
import { Chart } from '../access/access-shared';
import {
  CeoBreakdown, CeoBreakdownRow, CeoError, CeoLocalMetric, CeoMetric, CeoParams, CeoPeriod, CeoRecordKind
} from '../../../services/ceo.service';

export { Chart };

// ---------- drill-down (shared by the CEO and Sales Manager dashboards) ----------

/**
 * One drawer level: a breakdown (level 2) or a records list (level 3). M / R are the dashboard's metric and
 * record names (the CEO ones by default).
 */
export type DrillLevel<M extends string = CeoMetric | CeoLocalMetric, R extends string = CeoRecordKind> =
  | {
      kind: 'breakdown'; metric: M; params: CeoParams; crumb: string;
      /**
       * A level built from the dashboard's own figures instead of a request (e.g. the months of the period); read
       * again whenever they change (keep it a computed so the same figures give the same object).
       */
      local?: () => CeoBreakdown;
    }
  | {
      kind: 'records'; records: R; params: CeoParams; crumb: string;
      /** A row to mark in the list (its id), e.g. the complaint that was selected on the dashboard. */
      highlight?: number;
    };

/** Opens the drawer: `root` is the first breadcrumb ("Revenue"), `level` the first level shown. */
export interface DrillRequest<M extends string = CeoMetric | CeoLocalMetric, R extends string = CeoRecordKind> {
  id: number; root: string; level: DrillLevel<M, R>;
}

/** How a breakdown (level 2) reads: what its rows are, number format, and where a row leads (level 3). */
export interface DrillMetricSpec {
  rowLabel: string;
  money: boolean;
  /** Format of the second value when it differs from the first (e.g. lease count vs their monthly rent). */
  money2?: boolean;
  /** The two values count different things (e.g. leases and their desks): only the first sets the bar widths. */
  separateUnits?: boolean;
  /** Derived % column (value2 / value or value / value2). */
  derived?: { label: string; of: (r: CeoBreakdownRow) => number | null };
  chart: 'grouped' | 'stacked-occupancy' | 'single';
  vertical: boolean;
  next: (params: CeoParams, row: CeoBreakdownRow) => DrillLevel<string, string>;
  /** What a row opens, for screen readers ("Open the leases ending in Nov 2026 at I-8"); default "Open <row>". */
  nextLabel?: (params: CeoParams, row: CeoBreakdownRow) => string;
  /**
   * A second list a row offers next to the one it opens (e.g. the leases ending that month next to its bookings),
   * shown as a link under the row; null for none.
   */
  secondary?: (params: CeoParams, row: CeoBreakdownRow) => { label: string; level: DrillLevel<string, string> } | null;
  /** The line under the table; default "Select a row to see the records behind it." */
  hint?: (params: CeoParams) => string;
  /** Rows to show (default all), e.g. only the locations with an occupied room when the list is occupied rooms only. */
  keep?: (params: CeoParams, row: CeoBreakdownRow) => boolean;
}

/** A records list (level 3): rows hold at most 200 (newest first), total is the full count. */
export interface DrillRecords {
  title: string; total: number; rows: unknown[];
  /** A line on the totals of every record (e.g. "PKR 1,250,000 invoiced"), shown under the title; none = no line. */
  summary?: string;
  /** Other lists about the same selection, offered as links above the table (e.g. the spaces in use that month). */
  related?: { label: string; level: DrillLevel<string, string> }[];
}

/** Where the drawer gets its data: the CEO API by default, the Sales Manager API on that dashboard. */
export interface DrillSource {
  metrics: Record<string, DrillMetricSpec>;
  breakdown(metric: string, params: CeoParams): Observable<CeoBreakdown>;
  records(kind: string, params: CeoParams): Observable<DrillRecords>;
  describeError(err: unknown): CeoError;
  /** Records show desks instead of amounts (the Sales Manager dashboard shows no money). */
  desks?: boolean;
  /** Where a record's booking opens (e.g. /admin/bookings?booking=12); none = booking numbers stay plain text. */
  bookingLink?: (bookingId: number) => { path: string; queryParams: Record<string, string | number> } | null;
}

/** KPI card on a dashboard. */
export interface DashKpi {
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

// ---------- formatting (same format as the admin dashboard) ----------

/** "PKR 1.25M", "PKR 840K", "PKR 950" (as DashboardOverview.money). */
export function money(v: number | null | undefined): string {
  const n = Number(v || 0);
  const a = Math.abs(n);
  if (a >= 1_000_000) return `PKR ${parseFloat((n / 1_000_000).toFixed(a >= 10_000_000 ? 1 : 2))}M`;
  if (a >= 1_000) return `PKR ${(n / 1_000).toFixed(a >= 100_000 ? 0 : 1).replace(/\.0$/, '')}K`;
  return `PKR ${Math.round(n).toLocaleString()}`;
}

/** "PKR 1,250,000" for titles and tables. */
export function fullMoney(v: number | null | undefined): string {
  return 'PKR ' + Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

/** "82%" / "82.5%" (one decimal only when it matters). */
export function pct(v: number | null | undefined): string {
  const n = Number(v || 0);
  return `${Math.abs(n - Math.round(n)) < 0.05 ? Math.round(n) : n.toFixed(1)}%`;
}

export function ratio(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}

export function count(v: number | null | undefined): string {
  return Number(v || 0).toLocaleString();
}

/** "2026-10" -> "Oct" on chart axes ("Jan 26" at a year start or on the first label). */
export function monthShort(ym: string, first = false): string {
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return ym;
  const name = new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'short' });
  return m === 1 || first ? `${name} ${String(y).slice(2)}` : name;
}

/** "2026-10" -> "Oct 2026" (breadcrumbs, tooltips). */
export function monthLong(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return ym;
  return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'short' }) + ' ' + y;
}

export function periodWord(p: CeoPeriod): string {
  return p === 'year' ? 'year' : p === 'quarter' ? 'quarter' : 'month';
}

/** "Good morning" / "Good afternoon" / "Good evening" for the current hour. */
export function greetingNow(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

/**
 * First name for the greeting. The WorkNest name's first word as it is ("CEO1", "Luqman"); only when there is
 * no name and the email has to stand in is it tidied ("ahmad.luqman205@..." -> "Ahmad").
 */
export function firstNameOf(user: { displayName?: string; email?: string } | null | undefined): string {
  const name = (user?.displayName || '').trim();
  const prefix = (user?.email || '').split('@')[0].trim();
  if (name && name.toLowerCase() !== prefix.toLowerCase()) return name.split(/\s+/)[0];
  const raw = prefix || name || 'there';
  const first = raw.split(/[\s._-]+/)[0].replace(/\d+$/, '') || raw;
  return first.charAt(0).toUpperCase() + first.slice(1);
}

/**
 * The person's WorkNest name (WN_Users.Name) for "Prepared by" on an export; '' when only the email is known (an email
 * prefix is never shown as a name).
 */
export function displayNameOf(user: { displayName?: string; email?: string } | null | undefined): string {
  const name = (user?.displayName || '').trim();
  const prefix = (user?.email || '').split('@')[0].trim();
  return name && name.toLowerCase() !== prefix.toLowerCase() ? name : '';
}

/** Whole days from today to an ISO date (negative = past); null when there is no valid date. */
export function daysUntil(date: string | null | undefined): number | null {
  if (!date) return null;
  const d = new Date(date.length <= 10 ? date + 'T00:00:00' : date);
  if (isNaN(d.getTime())) return null;
  const t = new Date(); t.setHours(0, 0, 0, 0); d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - t.getTime()) / 86400000);
}

export interface Trend { text: string; dir: 'up' | 'down' | 'flat'; good: boolean; }

/** Change vs the previous period: '%' (relative), 'pts' (percentage points) or 'n' (count). */
export function trend(now: number, prev: number, unit: '%' | 'pts' | 'n', higherIsGood = true): Trend | null {
  if (!prev && !now) return null;
  let diff: number; let text: string;
  if (unit === '%') {
    if (!prev) return { text: 'new', dir: 'up', good: higherIsGood };
    diff = ((now - prev) / Math.abs(prev)) * 100;
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

// ---------- colours ----------

export const TEAL = '#0d9488';
export const TEAL_DARK = '#0f766e';
export const TEAL_LIGHT = '#99f6e4';
export const TEAL_LIGHT_HOVER = '#5eead4';
export const SLATE_TRACK = '#e2e8f0';

/** Receivables aging, by bucket (same colours as the admin dashboard). */
export const AGING_COLORS: Record<string, string> = {
  not_due: '#10b981', '1_30': '#fbbf24', '31_60': '#f97316', '61_90': '#ef4444', '90_plus': '#991b1b'
};
export const AGING_FALLBACK = ['#10b981', '#fbbf24', '#f97316', '#ef4444', '#991b1b'];

/** Tour inquiry types (same colours as the Tour Inquiries page). */
export const INQUIRY_TYPES: Record<string, { fg: string; bg: string; label: string }> = {
  website: { fg: '#1d4ed8', bg: '#eff6ff', label: 'Website' },
  whatsapp: { fg: '#047857', bg: '#ecfdf5', label: 'WhatsApp' },
  walkin: { fg: '#c2410c', bg: '#fff7ed', label: 'Walk-In' },
  reference: { fg: '#6d28d9', bg: '#f5f3ff', label: 'Reference' },
  notset: { fg: '#64748b', bg: '#f1f5f9', label: 'Not set' }
};

export function inquiryTypeKey(type: string | null | undefined): string {
  const k = String(type || '').toLowerCase().replace(/[^a-z]/g, '');
  return k in INQUIRY_TYPES ? k : 'notset';
}

/**
 * Complaint statuses (Sales Manager dashboard): chip colours and the status bar colour. Open = new, Resolved =
 * fixed and waiting for the customer's reply.
 */
export const COMPLAINT_STATUSES: Record<string, { fg: string; bg: string; bar: string; label: string; hint: string }> = {
  open: { fg: '#c2410c', bg: '#fff7ed', bar: '#c2410c', label: 'Open', hint: 'waiting for action' },
  in_progress: { fg: '#1d4ed8', bg: '#eff6ff', bar: '#1d4ed8', label: 'In progress', hint: 'being worked on' },
  resolved: { fg: '#047857', bg: '#ecfdf5', bar: '#047857', label: 'Resolved', hint: 'awaiting customer' },
  closed: { fg: '#475569', bg: '#f1f5f9', bar: '#94a3b8', label: 'Closed', hint: 'done' }
};

/** Colours and label of a complaint status key (an unknown status shows as it is, in slate). */
export function complaintStatusStyle(status: string | null | undefined) {
  const s = String(status || '');
  return COMPLAINT_STATUSES[s]
    ?? { fg: '#475569', bg: '#f1f5f9', bar: '#94a3b8', label: s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') : 'Unknown', hint: '' };
}

/** Pill tone for a status word from the API. */
export function statusTone(status: string | null | undefined): 'ok' | 'bad' | 'warn' | 'neutral' {
  const s = String(status || '').toLowerCase();
  if (!s) return 'neutral';
  // Negative words first: "unpaid" contains "paid" and "inactive" contains "active".
  if (/unpaid|un paid|not paid|partial/.test(s)) return 'warn';
  if (/inactive|unconfirm/.test(s)) return 'neutral';
  if (/overdue|reject|cancel|expire|lost|declin|void|terminat/.test(s)) return 'bad';
  if (/paid|convert|accept|active|confirm|occupied|won|complete|signed|closed|resolv/.test(s)) return 'ok';
  if (/pending|open|sent|draft|partial|due|new|follow|progress|unpaid|hold/.test(s)) return 'warn';
  return 'neutral';
}

// ---------- Chart.js theme (every chart on the CEO and Sales dashboards and in the drawer) ----------

export const CHART_FONT = "'Inter', system-ui, -apple-system, sans-serif";

/** Dark, roomy tooltip: bold title, the series as dots, the hint ("click for locations") as a muted footer. */
export const TOOLTIP = {
  backgroundColor: '#0f172a', titleColor: '#fff', bodyColor: '#e2e8f0', footerColor: '#94a3b8', padding: 12, cornerRadius: 10,
  caretSize: 5, titleMarginBottom: 6, bodySpacing: 4, footerMarginTop: 8, boxPadding: 6, boxWidth: 8, boxHeight: 8, usePointStyle: true,
  titleFont: { size: 12, weight: 600 as const }, bodyFont: { size: 12, weight: 500 as const }, footerFont: { size: 11, weight: 500 as const }
};
/** Hairline gridlines, one step off white (axes and ticks stay muted: applyChartDefaults). */
export const GRID = { color: '#eef2f6', lineWidth: 1, drawTicks: false };
/** Above the plot, aligned with the panel's left edge: the same dot, size and colour as the HTML legends (.rooms-legend). */
export const LEGEND = {
  position: 'top' as const,
  align: 'start' as const,
  labels: {
    usePointStyle: true, pointStyle: 'circle', boxWidth: 8, boxHeight: 8, padding: 18, color: '#64748b',
    font: { size: 12, weight: 500 as const }
  }
};
export const AXIS_MONEY = { callback: (v: any) => money(Number(v)).replace('PKR ', ''), padding: 8 };

export function applyChartDefaults() {
  Chart.defaults.font.family = CHART_FONT;
  Chart.defaults.color = '#64748b';
}

/** Pointer cursor over a clickable mark. */
export function pointerOnHover(_e: any, elements: any[], chart: Chart) {
  chart.canvas.style.cursor = elements.length ? 'pointer' : 'default';
}

// ---------- keyboard access to chart marks ----------

/**
 * Arrow keys move between a chart's columns / slices (Home / End jump to the ends), Enter or Space opens the
 * drill-down, Escape or leaving clears the highlight. The highlighted mark shows its tooltip as on hover, and
 * `announce` gets a sentence for a live region (screen readers). Several charts can share one position
 * (e.g. occupancy and new bookings stacked under one x axis).
 */
export class ChartKeyNav {
  index = -1;

  constructor(private opts: {
    charts: () => (Chart | undefined)[];
    count: () => number;
    describe: (i: number) => string;
    pick: (i: number) => void;
    announce: (text: string) => void;
    /** Where keyboard focus starts: the latest column (default, for months) or the first one (e.g. a ranking). */
    start?: 'first' | 'last';
  }) {}

  keydown(e: KeyboardEvent) {
    const n = this.opts.count();
    if (!n) return;
    switch (e.key) {
      case 'ArrowRight': case 'ArrowDown': this.set(this.index < 0 ? 0 : Math.min(n - 1, this.index + 1)); break;
      case 'ArrowLeft': case 'ArrowUp': this.set(this.index < 0 ? n - 1 : Math.max(0, this.index - 1)); break;
      case 'Home': this.set(0); break;
      case 'End': this.set(n - 1); break;
      case 'Enter': case ' ':
        if (this.index < 0) { this.set(n - 1); break; }
        this.opts.pick(this.index); break;
      case 'Escape':
        if (this.index < 0) return;
        this.clear(); break;
      default: return;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  /** Focus entered: start on the latest column (or the first, with start: 'first') so the first arrow press feels natural. */
  focus() {
    const n = this.opts.count();
    if (n && this.index < 0) this.set(this.opts.start === 'first' ? 0 : n - 1);
  }

  clear() {
    this.index = -1;
    for (const chart of this.opts.charts()) {
      if (!chart) continue;
      chart.setActiveElements([]);
      chart.tooltip?.setActiveElements([], { x: 0, y: 0 });
      chart.update('none');
    }
  }

  private set(i: number) {
    this.index = i;
    for (const chart of this.opts.charts()) {
      if (!chart) continue;
      const active = chart.data.datasets
        .map((_, d) => ({ datasetIndex: d, index: i }))
        .filter(a => chart.isDatasetVisible(a.datasetIndex) && chart.getDatasetMeta(a.datasetIndex).data[i]);
      if (!active.length) continue;
      const el: any = chart.getDatasetMeta(active[0].datasetIndex).data[i];
      const pos = typeof el?.tooltipPosition === 'function' ? el.tooltipPosition(true) : { x: el?.x ?? 0, y: el?.y ?? 0 };
      chart.setActiveElements(active);
      chart.tooltip?.setActiveElements(active, pos);
      chart.update('none');
    }
    this.opts.announce(this.opts.describe(i));
  }
}

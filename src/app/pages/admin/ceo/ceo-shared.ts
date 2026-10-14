import { Chart } from '../access/access-shared';
import { CeoMetric, CeoParams, CeoPeriod, CeoRecordKind } from '../../../services/ceo.service';

export { Chart };

// ---------- drill-down ----------

/** One drawer level: a breakdown (level 2) or a records list (level 3). */
export type DrillLevel =
  | { kind: 'breakdown'; metric: CeoMetric; params: CeoParams; crumb: string }
  | { kind: 'records'; records: CeoRecordKind; params: CeoParams; crumb: string };

/** Opens the drawer: `root` is the first breadcrumb ("Revenue"), `level` the first level shown. */
export interface DrillRequest { id: number; root: string; level: DrillLevel; }

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

/** Pill tone for a status word from the API. */
export function statusTone(status: string | null | undefined): 'ok' | 'bad' | 'warn' | 'neutral' {
  const s = String(status || '').toLowerCase();
  if (!s) return 'neutral';
  if (/overdue|reject|cancel|expire|lost|declin|void|terminat/.test(s)) return 'bad';
  if (/paid|convert|accept|active|confirm|occupied|won|complete|signed|closed|resolv/.test(s)) return 'ok';
  if (/pending|open|sent|draft|partial|due|new|follow|progress|unpaid|hold/.test(s)) return 'warn';
  return 'neutral';
}

// ---------- Chart.js theme (as the admin dashboard) ----------

export const CHART_FONT = "'Inter', system-ui, -apple-system, sans-serif";

export const TOOLTIP = {
  backgroundColor: '#0f172a', titleColor: '#fff', bodyColor: '#e2e8f0', footerColor: '#94a3b8', padding: 10, cornerRadius: 8,
  titleFont: { weight: 600 as const }, bodyFont: { weight: 500 as const }, boxPadding: 4, usePointStyle: true
};
export const GRID = { color: '#eef2f6', drawTicks: false };
export const LEGEND = {
  position: 'bottom' as const,
  labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 8, boxHeight: 8, padding: 16 }
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

  /** Focus entered: start on the latest column so the first arrow press feels natural. */
  focus() {
    const n = this.opts.count();
    if (n && this.index < 0) this.set(n - 1);
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

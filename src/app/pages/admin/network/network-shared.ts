import { Component, ElementRef, HostListener, computed, inject, input, output, signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Chart, registerables } from 'chart.js';
import { UnifiClientKind } from '../../../models/unifi.model';

Chart.register(...registerables);

export { Chart };

// ---------- Colours (admin dashboard palette) ----------

export const S1 = '#0d9488';   // teal — primary series
export const S2 = '#6366f1';   // indigo — secondary line
export const S3 = '#99f6e4';   // light teal — third series
export const AMBER = '#f59e0b';
export const GOOD = '#10b981';
export const WARN = '#f59e0b';
export const CRIT = '#ef4444';
export const MUTED = '#94a3b8';
const GRID = '#eef2f6';

// Same Chart.js defaults as the admin dashboard (dashboard-overview.ts renderCharts).
Chart.defaults.font.family = "'Inter', system-ui, -apple-system, sans-serif";
Chart.defaults.color = '#64748b';

// ---------- Formatting ----------

export const DASH = '–';

export function fmt(n: number | null | undefined, d = 0): string {
  return n == null || Number.isNaN(n) ? DASH : Number(n).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });
}

export const sum = <T>(arr: T[], f: (x: T) => number | null | undefined) => arr.reduce((a, x) => a + (f(x) || 0), 0);
export const avg = (a: number[]) => (a.length ? sum(a, v => v) / a.length : null);
export const pct = (v: number | null | undefined) => (v == null ? DASH : `${fmt(v, v >= 99.995 || v === 0 ? 0 : 2)}%`);
export const normMac = (m: string | null | undefined) => String(m || '').toLowerCase().replace(/[^0-9a-f]/g, '');
const toMs = (t: string | number | Date) => (typeof t === 'number' ? t : new Date(t).getTime());

export function ago(t: string | number | Date | null | undefined): string {
  if (!t) return 'never';
  const s = Math.round((Date.now() - toMs(t)) / 1000);
  if (s < 60) return `${Math.max(0, s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(t).toLocaleDateString();
}

/** Seconds as "3d 4h" / "2h 10m" / "5m". */
export function dur(sec: number | null | undefined): string {
  if (sec == null) return DASH;
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

export function bytes(n: number | null | undefined): string {
  if (n == null) return DASH;
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1000 && i < u.length - 1) { n /= 1000; i++; }
  return `${fmt(n, n < 10 && i ? 1 : 0)} ${u[i]}`;
}

/** Bytes per second as a bit rate. */
export function rate(bps: number | null | undefined): string {
  if (bps == null) return DASH;
  const bits = bps * 8;
  return bits >= 1e6 ? `${fmt(bits / 1e6, 1)} Mbps` : bits >= 1e3 ? `${fmt(bits / 1e3)} Kbps` : `${fmt(bits)} bps`;
}

/** Bytes per second as { value, unit } for big KPI numbers. */
export function speedParts(bps: number | null | undefined): { value: string; unit: string } {
  if (bps == null) return { value: DASH, unit: '' };
  const bits = bps * 8;
  return bits >= 1e6 ? { value: fmt(bits / 1e6, bits < 1e7 ? 1 : 0), unit: 'Mbps' } : { value: fmt(bits / 1e3), unit: 'Kbps' };
}

export const mbpsText = (v: number) => (v >= 1 ? `${fmt(v, v < 10 ? 1 : 0)} Mbps` : `${fmt(v * 1000)} Kbps`);
export const linkText = (m: number | null | undefined) => (m == null ? '' : m >= 1000 ? `${m / 1000} Gbps` : `${m} Mbps`);

/** Reduce a series to at most `max` points for charts. */
export function thin<T>(points: T[], max = 300): T[] {
  const step = Math.ceil(points.length / max);
  return step > 1 ? points.filter((_, i) => i % step === 0 || i === points.length - 1) : points;
}

export function timeLabel(t: string | number, rangeHours: number): string {
  const d = new Date(t);
  const hm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return rangeHours > 24 ? `${d.toLocaleDateString([], { weekday: 'short' })} ${hm}` : hm;
}

export const clock = (t: number, withDay = false) =>
  new Date(t).toLocaleString([], withDay ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' } : { hour: '2-digit', minute: '2-digit' });
export const dateTime = (t: number) => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
export const shortDate = (t: number) => new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });

/** Time only for today's events, otherwise "Oct 5, 09:14". */
export function logWhen(t: number): string {
  const d = new Date(t);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Wi-Fi signal (dBm) as 0–4 bars and a label. */
export function signalInfo(dbm: number | null | undefined): { bars: number; label: string } {
  if (dbm == null) return { bars: 0, label: DASH };
  const bars = dbm >= -55 ? 4 : dbm >= -65 ? 3 : dbm >= -75 ? 2 : 1;
  return { bars, label: ['', 'Poor', 'Fair', 'Good', 'Excellent'][bars] };
}

const CLIENT_ICONS: Record<UnifiClientKind, string> = {
  phone: 'phone', computer: 'laptop', tablet: 'tablet', printer: 'printer', tv: 'tv',
  camera: 'camera', access: 'lock', network: 'router', iot: 'chip', other: 'other'
};
export const clientIcon = (kind: string) => CLIENT_ICONS[kind as UnifiClientKind] || 'other';
export const typeIcon = (t: string) =>
  t === 'Access point' ? 'ap' : t === 'Switch' || t === 'Third-party switch' ? 'switch' : t === 'Console / Gateway' ? 'gateway' : 'other';

/** Readable message from an HttpErrorResponse (the API returns { error } like the Node server did). */
export function errMsg(err: any, fallback = 'Request failed'): string {
  if (err?.status === 0) return 'The server is not reachable';
  return err?.error?.error || err?.error?.message || err?.message || fallback;
}

// ---------- Online / offline timeline ----------

export interface TimelineEvent { t: number; conn: 'up' | 'down' | null }
export interface Seg { from: number; to: number; up: boolean; lead: boolean }
export interface TimelineMarker { t: number; label: string }

/**
 * Connect/disconnect events → segments between `from` and `to`.
 * `online` is the state now; `downSince` (e.g. last seen) anchors an outage with no logged event.
 * A leading "down" stretch before the first logged connect is `lead` ("not connected yet", not a drop).
 */
export function buildTimeline(events: TimelineEvent[], opts: { online: boolean; from: number; to: number; downSince?: number | null }): Seg[] {
  const { online, from, to, downSince } = opts;
  const ev = events.filter(e => e.conn && e.t >= from && e.t <= to).map(e => ({ t: e.t, up: e.conn === 'up' })).sort((a, b) => a.t - b.t);
  let state = ev.length ? !ev[0].up : online;
  const segs: Seg[] = [];
  let cur = from;
  const push = (end: number, up: boolean) => {
    if (end > cur) segs.push({ from: cur, to: end, up, lead: !segs.length && !up && ev.length > 0 && ev[0].up });
  };
  for (const e of ev) {
    if (e.up === state) continue;
    push(e.t, state);
    cur = e.t;
    state = e.up;
  }
  if (state && !online) {
    const at = Math.min(to, Math.max(cur, downSince || to));
    push(at, true);
    cur = at;
    state = false;
  }
  push(to, state);
  return segs;
}

export function timelineStats(segs: Seg[]) {
  const total = sum(segs, s => s.to - s.from) || 1;
  const up = segs.filter(s => s.up);
  const drops = segs.filter(s => !s.up && !s.lead);
  return {
    availability: (sum(up, s => s.to - s.from) / total) * 100,
    upMs: sum(up, s => s.to - s.from),
    outages: drops.length,
    longest: drops.length ? Math.max(...drops.map(s => s.to - s.from)) : 0,
    firstUp: up.length ? up[0].from : null
  };
}

// ---------- Charts ----------

const TOOLTIP = {
  backgroundColor: '#0f172a', titleColor: '#fff', bodyColor: '#e2e8f0', padding: 10, cornerRadius: 8,
  titleFont: { weight: 600 }, boxPadding: 4, usePointStyle: true
};

/** Chart options in the admin dashboard style: light grid, no borders, dark tooltip, bottom legend. */
export function baseOptions({ stacked = false, unit = '', legend = true, decimals = 0 } = {}): any {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: legend, position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 8, boxHeight: 8, padding: 16 } },
      tooltip: {
        ...TOOLTIP,
        callbacks: {
          label: (c: any) => ` ${c.dataset.label}: ${fmt(c.chart.options.indexAxis === 'y' ? c.parsed.x : c.parsed.y, decimals)}${unit ? ' ' + unit : ''}`
        }
      }
    },
    scales: {
      x: { stacked, grid: { display: false }, border: { display: false }, ticks: { maxTicksLimit: 8, maxRotation: 0, autoSkipPadding: 16 } },
      y: { stacked, beginAtZero: true, grid: { color: GRID, drawTicks: false }, border: { display: false }, ticks: { padding: 8, maxTicksLimit: 5, precision: decimals ? undefined : 0 } }
    }
  };
}

/** Horizontal stacked bar options (labels on the y axis). */
export function hbarOptions(unit: string): any {
  const o = baseOptions({ stacked: true, unit });
  o.indexAxis = 'y';
  o.interaction = { mode: 'index', intersect: true, axis: 'y' };
  o.scales.x.grid = { color: GRID, drawTicks: false };
  o.scales.y.grid = { display: false };
  o.scales.y.ticks = { color: '#334155', font: { size: 12 } };
  return o;
}

export const line = (label: string, values: (number | null)[], color: string, extra: Record<string, unknown> = {}) => ({
  label, data: values, borderColor: color, backgroundColor: color, borderWidth: 2.25, pointRadius: 0, pointHoverRadius: 5,
  pointHoverBorderWidth: 2, pointHoverBorderColor: '#fff', tension: 0.35, spanGaps: true, ...extra
});

/** Vertical gradient area fill: strong at the line, fading to nothing at the baseline. */
export const glow = (color: string, strength = '55') => (ctx: any) => {
  const { chart } = ctx;
  if (!chart.chartArea) return color + '22';
  const g = chart.ctx.createLinearGradient(0, chart.chartArea.top, 0, chart.chartArea.bottom);
  g.addColorStop(0, color + strength);
  g.addColorStop(1, color + '00');
  return g;
};

export const hbar = (label: string, values: number[], color: string, thickness = 14) => ({
  label, data: values, backgroundColor: color, borderColor: '#fff', borderWidth: { right: 2 }, borderRadius: 6, borderSkipped: false, maxBarThickness: thickness
});

/** Keeps a page's charts: updates in place, recreates if the canvas changed, destroys on leave. */
export class ChartBag {
  private charts = new Map<string, Chart>();

  upsert(id: string, canvas: HTMLCanvasElement | undefined | null, config: any): void {
    if (!canvas) return this.destroy(id);
    const existing = this.charts.get(id);
    if (existing && existing.canvas === canvas && (existing.config as any).type === config.type) {
      existing.data = config.data;
      existing.options = config.options;
      existing.update('none');
      return;
    }
    existing?.destroy();
    this.charts.set(id, new Chart(canvas, config));
  }

  destroy(id: string) {
    this.charts.get(id)?.destroy();
    this.charts.delete(id);
  }

  destroyAll() {
    this.charts.forEach(c => c.destroy());
    this.charts.clear();
  }
}

// ---------- Export: Excel / CSV per table, PNG per chart, PDF per page ----------

export type ExportKind = 'xls' | 'csv' | 'png';

const slug = (t: string) => String(t || 'export').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const exportName = (title: string, ext: string) => `network-${slug(title)}-${today()}.${ext}`;

/** A table as rows of plain text — what is on screen, without icons; cells marked .no-export are skipped. */
export function tableRows(table: HTMLTableElement): string[][] {
  return Array.from(table.querySelectorAll('tr'))
    .map(tr => Array.from(tr.children)
      .filter(c => !c.classList.contains('no-export'))
      .map(c => (c as HTMLElement).innerText.replace(/\s+/g, ' ').trim()))
    .filter(r => r.some(Boolean));
}

export function downloadBlob(name: string, blob: Blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

const htmlEsc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

export function exportTable(table: HTMLTableElement | undefined | null, title: string, kind: 'csv' | 'xls') {
  if (!table) return;
  const rows = tableRows(table);
  if (kind === 'csv') {
    const csv = rows.map(r => r.map(v => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(',')).join('\r\n');
    return downloadBlob(exportName(title, 'csv'), new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
  }
  // Excel opens an HTML table saved as .xls (no spreadsheet library is installed).
  const sheet = htmlEsc(title).slice(0, 31) || 'Data';
  const body = rows.map((r, i) => `<tr>${r.map(v => (i === 0 ? `<th>${htmlEsc(v)}</th>` : `<td>${htmlEsc(v)}</td>`)).join('')}</tr>`).join('');
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">`
    + `<head><meta charset="utf-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>${sheet}</x:Name>`
    + `<x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->`
    + `<style>th{font-weight:bold;background:#f1f5f9;text-align:left}td,th{mso-number-format:"\\@";}</style></head>`
    + `<body><table border="1">${body}</table></body></html>`;
  downloadBlob(exportName(title, 'xls'), new Blob(['\ufeff' + html], { type: 'application/vnd.ms-excel;charset=utf-8' }));
}

/** Charts are transparent; paint white behind them so the PNG reads anywhere. */
export function exportChartPng(canvas: HTMLCanvasElement | undefined | null, title: string) {
  if (!canvas) return;
  const out = document.createElement('canvas');
  out.width = canvas.width;
  out.height = canvas.height;
  const ctx = out.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(canvas, 0, 0);
  const a = document.createElement('a');
  a.href = out.toDataURL('image/png');
  a.download = exportName(title, 'png');
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** One card's export: table to Excel / CSV, chart to PNG. */
export function exportCard(kind: ExportKind, title: string, el: { table?: HTMLTableElement | null; canvas?: HTMLCanvasElement | null }) {
  if (kind === 'png') exportChartPng(el.canvas, title);
  else exportTable(el.table, title, kind);
}

/** The whole page as a multi-page A4 PDF (html2canvas + jsPDF, loaded on demand). */
export async function exportPagePdf(el: HTMLElement, title: string) {
  const { default: html2canvas } = await import('html2canvas');
  const { jsPDF } = await import('jspdf');
  const canvas = await html2canvas(el, {
    scale: 2, useCORS: true, backgroundColor: '#f8fafc',
    ignoreElements: (n: Element) => n.classList?.contains('no-print')
  });
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 8;
  const w = pageW - margin * 2;
  // Slice the tall screenshot into page-sized pieces so nothing is squashed.
  const sliceH = Math.floor((canvas.width * (pageH - margin * 2)) / w);
  for (let y = 0, page = 0; y < canvas.height; y += sliceH, page++) {
    const part = document.createElement('canvas');
    part.width = canvas.width;
    part.height = Math.min(sliceH, canvas.height - y);
    const ctx = part.getContext('2d');
    if (!ctx) break;
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, part.width, part.height);
    ctx.drawImage(canvas, 0, y, canvas.width, part.height, 0, 0, canvas.width, part.height);
    if (page) pdf.addPage();
    pdf.addImage(part.toDataURL('image/png'), 'PNG', margin, margin, w, (part.height * w) / canvas.width);
  }
  pdf.save(exportName(title, 'pdf'));
}

// ---------- Icons (inline SVG line icons, same style as the admin sidebar) ----------

const ICONS: Record<string, string> = {
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  server: '<rect x="2" y="3" width="20" height="8" rx="2"/><rect x="2" y="13" width="20" height="8" rx="2"/><path d="M6 7h.01M6 17h.01"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  wifi: '<path d="M5 12.55a11 11 0 0 1 14 0M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01"/>',
  cable: '<path d="M4 9a2 2 0 0 1-2-2V5h6v2a2 2 0 0 1-2 2Z"/><path d="M3 5V3M7 5V3M19 15V6.5a3.5 3.5 0 0 0-7 0v11a3.5 3.5 0 0 1-7 0V9"/><path d="M17 21v-2M21 21v-2M18 15h2a2 2 0 0 1 2 2v2h-6v-2a2 2 0 0 1 2-2Z"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>',
  cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2"/>',
  memory: '<path d="M6 19v-3M10 19v-3M14 19v-3M18 19v-3M8 11V9M16 11V9M12 11V9"/><path d="M2 15h20M2 7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v1.1a2 2 0 0 0 0 3.84V17a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-5.06a2 2 0 0 0 0-3.84Z"/>',
  temp: '<path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  smile: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>',
  arrows: '<path d="m7 15 5 5 5-5M7 9l5-5 5 5"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  ap: '<circle cx="12" cy="12" r="3"/><path d="M5.6 5.6a9 9 0 0 0 0 12.8M18.4 18.4a9 9 0 0 0 0-12.8"/>',
  switch: '<rect x="2" y="7" width="20" height="10" rx="2"/><path d="M6 12h.01M10 12h.01M14 12h.01M18 12h.01"/>',
  gateway: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h.01M10 8h.01M2 12h20"/>',
  phone: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>',
  laptop: '<path d="M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.28 2.55A1 1 0 0 1 20.38 20H3.62a1 1 0 0 1-.9-1.45L4 16"/>',
  other: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 9h6v6H9z"/>',
  camera: '<path d="M16.75 12h3.63a1 1 0 0 1 .7 1.7l-4.3 4.3a1 1 0 0 1-1.42 0l-1.77-1.77"/><path d="m14 15.6 3.2-3.2a2 2 0 0 0 0-2.8L11 3.4a2 2 0 0 0-2.8 0L5 6.6a2 2 0 0 0 0 2.8l6.2 6.2a2 2 0 0 0 2.8 0Z"/><path d="M2 21h4l3-3"/>',
  printer: '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  tv: '<rect x="2" y="7" width="20" height="15" rx="2"/><path d="m17 2-5 5-5-5"/>',
  tablet: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M12 18h.01"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  router: '<rect x="2" y="14" width="20" height="8" rx="2"/><path d="M6.01 18H6M10.01 18H10M15 10v4M17.84 7.17a4 4 0 0 0-5.66 0M20.66 4.34a8 8 0 0 0-11.31 0"/>',
  chip: '<path d="M12 20v2M12 2v2M17 20v2M17 2v2M2 12h2M2 17h2M2 7h2M20 12h2M20 17h2M20 7h2M7 20v2M7 2v2"/><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  map: '<circle cx="12" cy="5" r="3"/><circle cx="5" cy="19" r="3"/><circle cx="19" cy="19" r="3"/><path d="M12 8v4M5 16v-2h14v2"/>',
  up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  down: '<path d="M12 5v14M19 12l-7 7-7-7"/>'
};

/** `<net-icon name="wifi" [size]="14" />` — static line icons from the table above. */
@Component({
  selector: 'net-icon',
  standalone: true,
  template: `<span class="net-icon" [innerHTML]="html()"></span>`,
  styles: [`:host { display: inline-flex; line-height: 0; } .net-icon { display: inline-flex; }`]
})
export class NetIcon {
  private sanitizer = inject(DomSanitizer);
  name = input<string>('other');
  size = input<number>(16);
  // The markup is a fixed constant from this file, never user data.
  html = computed<SafeHtml>(() => this.sanitizer.bypassSecurityTrustHtml(
    `<svg viewBox="0 0 24 24" width="${this.size()}" height="${this.size()}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[this.name()] || ICONS['other']}</svg>`
  ));
}

/** Export dropdown for a card: Excel / CSV when it has a table, PNG when it has a chart. */
@Component({
  selector: 'net-export',
  standalone: true,
  imports: [NetIcon],
  template: `
    <button type="button" class="nx-btn" title="Export" [attr.aria-label]="'Export ' + label()" aria-haspopup="menu" [attr.aria-expanded]="open()" (click)="open.set(!open())">
      <net-icon name="download" [size]="15" />
    </button>
    @if (open()) {
      <div class="nx-menu" role="menu">
        @if (table()) {
          <button type="button" role="menuitem" (click)="pick('xls')">Excel (.xls)</button>
          <button type="button" role="menuitem" (click)="pick('csv')">CSV</button>
        }
        @if (chart()) { <button type="button" role="menuitem" (click)="pick('png')">Image (.png)</button> }
      </div>
    }`,
  styles: [`
    :host { position: relative; display: inline-block; }
    .nx-btn { width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid #e2e8f0; background: #fff; color: #64748b; border-radius: 8px; cursor: pointer; }
    .nx-btn:hover { color: #0d9488; border-color: #99f6e4; }
    .nx-menu { position: absolute; right: 0; top: calc(100% + 4px); z-index: 30; min-width: 150px; background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; box-shadow: 0 10px 25px rgba(15, 23, 42, 0.12); padding: 4px; display: flex; flex-direction: column; }
    .nx-menu button { text-align: left; border: 0; background: none; padding: 0.5rem 0.7rem; font-size: 0.82rem; color: #334155; border-radius: 6px; cursor: pointer; }
    .nx-menu button:hover { background: #f0fdfa; color: #0f766e; }`],
  host: { class: 'no-print' }
})
export class NetExport {
  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  table = input(false);
  chart = input(false);
  label = input('');
  picked = output<ExportKind>();
  open = signal(false);

  pick(kind: ExportKind) {
    this.open.set(false);
    this.picked.emit(kind);
  }

  @HostListener('document:click', ['$event'])
  onDoc(e: Event) {
    if (this.open() && !this.host.nativeElement.contains(e.target as Node)) this.open.set(false);
  }

  @HostListener('document:keydown.escape')
  onEsc() { this.open.set(false); }
}

// ---------- Sparkline ----------

export interface SparkPoint { t?: number; t2?: number; v: number | null }

/** Average points into n buckets, keeping each bucket's start / end time for the tooltip. */
export function bucketPoints(points: SparkPoint[], n = 40): SparkPoint[] {
  const p = points.filter(x => x.v != null && !Number.isNaN(x.v));
  if (p.length <= n) return p;
  const size = p.length / n;
  return Array.from({ length: n }, (_, i) => {
    const part = p.slice(Math.floor(i * size), Math.floor((i + 1) * size));
    return part.length ? { t: part[0].t, t2: part[part.length - 1].t, v: sum(part, x => x.v) / part.length } : null;
  }).filter((x): x is { t: number | undefined; t2: number | undefined; v: number } => !!x);
}

/** Small trend line with a hover read-out (time and value). */
@Component({
  selector: 'net-sparkline',
  standalone: true,
  template: `
    @if (geo(); as g) {
      <div class="sp" (mousemove)="move($event, g.pts.length)" (mouseleave)="hover.set(-1)">
        <svg viewBox="0 0 120 28" preserveAspectRatio="none" aria-hidden="true">
          <path [attr.d]="g.area" [attr.fill]="color()" opacity=".12" />
          <path [attr.d]="g.line" fill="none" [attr.stroke]="color()" stroke-width="1.5" vector-effect="non-scaling-stroke" />
        </svg>
        @if (hover() >= 0 && g.pts[hover()]; as p) {
          <i class="sp-guide" [style.left.%]="p.x"></i>
          <i class="sp-dot" [style.left.%]="p.x" [style.top.%]="p.y" [style.background]="color()"></i>
          <span class="sp-tip" [style.left.%]="p.x" [class.l]="p.x < 25" [class.r]="p.x > 75">{{ p.text }}</span>
        }
      </div>
    }`,
  styles: [`
    :host { display: block; margin-top: 0.5rem; }
    .sp { position: relative; height: 28px; cursor: crosshair; }
    svg { width: 100%; height: 28px; display: block; overflow: visible; }
    .sp-guide { position: absolute; top: 0; bottom: 0; width: 1px; background: #cbd5e1; pointer-events: none; }
    .sp-dot { position: absolute; width: 7px; height: 7px; border-radius: 50%; border: 2px solid #fff; transform: translate(-50%, -50%); pointer-events: none; box-shadow: 0 0 0 1px rgba(15,23,42,.1); }
    .sp-tip { position: absolute; bottom: calc(100% + 4px); transform: translateX(-50%); white-space: nowrap; background: #0f172a; color: #fff; font-size: 0.7rem; padding: 3px 7px; border-radius: 6px; pointer-events: none; z-index: 5; }
    .sp-tip.l { transform: none; } .sp-tip.r { transform: translateX(-100%); }`]
})
export class NetSparkline {
  points = input<SparkPoint[]>([]);
  color = input<string>(S1);
  floor = input<number | null>(null);
  format = input<(v: number) => string>((v: number) => fmt(v, v < 10 ? 1 : 0));
  hover = signal(-1);

  geo = computed(() => {
    const pts = this.points().filter((p): p is SparkPoint & { v: number } => p.v != null && !Number.isNaN(p.v));
    if (pts.length < 2) return null;
    const v = pts.map(p => p.v);
    const w = 120, h = 28;
    const floor = this.floor();
    const min = floor != null ? 0 : Math.min(...v);
    const max = floor != null ? Math.max(floor, ...v) : Math.max(...v);
    const span = max - min || 1;
    const xy = v.map((y, i) => [(i / (v.length - 1)) * w, h - 2 - ((y - min) / span) * (h - 4)]);
    const d = xy.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
    const timed = pts.some(p => p.t != null);
    const spanMs = timed ? (pts[pts.length - 1].t || 0) - (pts[0].t || 0) : 0;
    const format = this.format();
    const when = (p: SparkPoint) => {
      if (p.t == null) return '';
      const dt = new Date(p.t);
      const o: Intl.DateTimeFormatOptions = spanMs > 864e5 ? { weekday: 'short', hour: '2-digit', minute: '2-digit' } : { hour: '2-digit', minute: '2-digit' };
      const yesterday = spanMs <= 864e5 && dt.toDateString() !== new Date().toDateString() ? 'Yesterday ' : '';
      const a = yesterday + dt.toLocaleString([], o);
      return p.t2 && p.t2 - p.t >= 30 * 60e3 ? `${a}–${new Date(p.t2).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : a;
    };
    return {
      line: d,
      area: `${d}L${w},${h}L0,${h}Z`,
      pts: pts.map((p, i) => ({ x: (xy[i][0] / w) * 100, y: (xy[i][1] / h) * 100, text: timed ? `${when(p)} · ${format(p.v)}` : format(p.v) }))
    };
  });

  move(e: MouseEvent, n: number) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    this.hover.set(Math.round(frac * (n - 1)));
  }
}

// ---------- Timeline (online / offline bar) and session list ----------

interface TimelineLabels { upLabel?: string; downLabel?: string; leadLabel?: string }

@Component({
  selector: 'net-timeline',
  standalone: true,
  template: `
    <div class="tl" [class.client]="tone() === 'client'" (mouseleave)="tip.set(null)">
      <div class="tl-flags">
        @for (s of drops(); track s.from) {
          <i class="tl-flag" [style.left.%]="x(s.from)" (mousemove)="show($event, downLabel() + ' at ' + clock(s.from, withDay()) + ' for ' + dur((s.to - s.from) / 1000))"></i>
        }
        @for (m of visibleMarkers(); track m.t) {
          <i class="tl-flag restart" [style.left.%]="x(m.t)" (mousemove)="show($event, m.label + ' at ' + clock(m.t, withDay()))"></i>
        }
      </div>
      <div class="tl-bar">
        @for (s of segs(); track s.from) {
          <span class="tl-seg" [class.up]="s.up" [class.lead]="!s.up && s.lead" [class.down]="!s.up && !s.lead"
            [style.left.%]="x(s.from)" [style.width]="'max(4px, ' + (x(s.to) - x(s.from)) + '%)'"
            (mousemove)="show($event, segText(s))"></span>
        }
      </div>
      <div class="tl-axis">
        @for (t of ticks(); track $index) { <span [style.left.%]="$index * 25">{{ $index === 4 ? 'Now' : clock(t, withDay()) }}</span> }
      </div>
      @if (tip(); as tp) { <div class="tl-tip" [style.left.px]="tp.x">{{ tp.text }}</div> }
    </div>`,
  styles: [`
    .tl { position: relative; padding-top: 14px; margin-top: 0.5rem; }
    .tl-flags { position: relative; height: 12px; }
    .tl-flag { position: absolute; top: 0; width: 8px; height: 8px; margin-left: -4px; border-radius: 50%; background: #ef4444; cursor: default; }
    .tl-flag.restart { background: #6366f1; }
    .tl.client .tl-flag:not(.restart) { background: #f59e0b; }
    .tl-bar { position: relative; height: 26px; background: #f1f5f9; border-radius: 6px; overflow: hidden; }
    .tl-seg { position: absolute; top: 0; bottom: 0; }
    .tl-seg.up { background: #10b981; }
    .tl-seg.down { background: #ef4444; }
    .tl-seg.lead { background: #e2e8f0; }
    .tl.client .tl-seg.down { background: #cbd5e1; }
    .tl-seg:hover { filter: brightness(0.92); }
    .tl-axis { position: relative; height: 18px; margin-top: 4px; font-size: 0.7rem; color: #94a3b8; }
    .tl-axis span { position: absolute; transform: translateX(-50%); white-space: nowrap; }
    .tl-axis span:first-child { transform: none; }
    .tl-axis span:last-child { transform: translateX(-100%); }
    .tl-tip { position: absolute; top: calc(100% + 2px); transform: translateX(-50%); background: #0f172a; color: #fff; font-size: 0.72rem; padding: 4px 8px; border-radius: 6px; white-space: nowrap; pointer-events: none; z-index: 5; }`]
})
export class NetTimeline {
  segs = input<Seg[]>([]);
  from = input.required<number>();
  to = input.required<number>();
  rangeHours = input(24);
  markers = input<TimelineMarker[]>([]);
  tone = input<'device' | 'client'>('device');
  upLabel = input('Online');
  downLabel = input('Offline');
  leadLabel = input('Not connected');

  tip = signal<{ x: number; text: string } | null>(null);
  readonly clock = clock;
  readonly dur = dur;

  withDay = computed(() => this.rangeHours() > 24);
  drops = computed(() => this.segs().filter(s => !s.up && !s.lead));
  visibleMarkers = computed(() => this.markers().filter(m => m.t >= this.from() && m.t <= this.to()));
  ticks = computed(() => Array.from({ length: 5 }, (_, i) => this.from() + ((this.to() - this.from()) * i) / 4));

  x(t: number) { return ((t - this.from()) / (this.to() - this.from() || 1)) * 100; }

  segText(s: Seg) {
    const label = s.up ? this.upLabel() : s.lead ? this.leadLabel() : this.downLabel();
    const end = s.to >= this.to() - 6e4 ? 'now' : clock(s.to, this.withDay());
    return `${label} · ${clock(s.from, this.withDay())} – ${end} (${dur((s.to - s.from) / 1000)})`;
  }

  show(e: MouseEvent, text: string) {
    const box = (e.currentTarget as HTMLElement).closest('.tl') as HTMLElement;
    const r = box.getBoundingClientRect();
    const x = Math.min(r.width - 90, Math.max(90, e.clientX - r.left));
    this.tip.set({ x, text });
  }
}

/** Readable list of sessions / outages, newest first. */
@Component({
  selector: 'net-sessions',
  standalone: true,
  template: `
    @if (rows().length) {
      <ol class="ss" [class.client]="tone() === 'client'">
        @for (s of rows(); track s.from) {
          <li [class]="s.up ? 'up' : s.lead ? 'lead' : 'down'">
            <span class="s-dot"></span>
            <span class="s-label">{{ s.up ? labels().upLabel : s.lead ? labels().leadLabel : labels().downLabel }}</span>
            <span class="s-time">{{ clock(s.from, withDay()) }} to @if (s.to === end()) { <b>now</b> } @else { {{ clock(s.to, withDay()) }} }</span>
            <span class="s-dur">{{ dur((s.to - s.from) / 1000) }}</span>
          </li>
        }
      </ol>
    }`,
  styles: [`
    .ss { list-style: none; margin: 0.5rem 0 0; padding: 0; font-size: 0.82rem; }
    .ss li { display: grid; grid-template-columns: 12px minmax(110px, auto) 1fr auto; gap: 0.6rem; align-items: center; padding: 0.4rem 0; border-bottom: 1px solid #f1f5f9; }
    .ss li:last-child { border-bottom: 0; }
    .s-dot { width: 8px; height: 8px; border-radius: 50%; background: #10b981; }
    .down .s-dot { background: #ef4444; }
    .client .down .s-dot { background: #f59e0b; }
    .lead .s-dot { background: #cbd5e1; }
    .s-label { font-weight: 600; color: #0f172a; }
    .s-time { color: #64748b; }
    .s-dur { color: #334155; font-variant-numeric: tabular-nums; }`]
})
export class NetSessions {
  segs = input<Seg[]>([]);
  rangeHours = input(24);
  limit = input(8);
  onlyDrops = input(false);
  tone = input<'device' | 'client'>('device');
  labels = input<Required<TimelineLabels>>({ upLabel: 'Online', downLabel: 'Offline', leadLabel: 'Not connected' });

  readonly clock = clock;
  readonly dur = dur;
  withDay = computed(() => this.rangeHours() > 24);
  end = computed(() => this.segs()[this.segs().length - 1]?.to);
  rows = computed(() => this.segs().filter(s => (this.onlyDrops() ? !s.up && !s.lead : true)).slice().reverse().slice(0, this.limit()));
}

/** Wi-Fi signal bars plus the dBm value. */
@Component({
  selector: 'net-signal',
  standalone: true,
  template: `
    @if (dbm() == null) { <span class="muted">–</span> } @else {
      <span class="bars" [class]="'s' + info().bars" [title]="info().label">
        @for (i of [1, 2, 3, 4]; track i) { <i [class.on]="i <= info().bars" [style.height.px]="3 + i * 2.5"></i> }
      </span>
      <span class="mono">{{ dbm() }} dBm</span>
    }`,
  styles: [`
    :host { display: inline-flex; align-items: center; gap: 0.4rem; white-space: nowrap; }
    .muted { color: #94a3b8; }
    .bars { display: inline-flex; align-items: flex-end; gap: 2px; height: 13px; }
    .bars i { width: 3px; border-radius: 1px; background: #e2e8f0; }
    .s4 i.on, .s3 i.on { background: #10b981; }
    .s2 i.on { background: #f59e0b; }
    .s1 i.on { background: #ef4444; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.78rem; color: #334155; }`]
})
export class NetSignal {
  dbm = input<number | null>(null);
  info = computed(() => signalInfo(this.dbm()));
}

export const NET_SHARED = [NetIcon, NetExport, NetSparkline, NetTimeline, NetSessions, NetSignal];

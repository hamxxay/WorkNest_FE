import { Chart, registerables } from 'chart.js';
import { HikAccessMethod } from '../../../models/hik-device.model';

Chart.register(...registerables);

export { Chart };

export const ACCENT = '#0d9488';
export const PALETTE = ['#0d9488', '#6366f1', '#0ea5e9', '#f59e0b', '#a855f7', '#ec4899', '#64748b'];

const pad = (n: number) => String(n).padStart(2, '0');

/** Browser-local date as YYYY-MM-DD (event times are terminal local time, so no UTC conversion). */
export function localDate(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return localDate(new Date(y, m - 1, d + days));
}

/** Parse "YYYY-MM-DDTHH:mm:ss" as local wall-clock time. */
export function parseLocal(ts?: string | null): Date | null {
  if (!ts) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):?(\d{2})?/.exec(ts);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
}

export function formatTime12(ts?: string | null, withSeconds = false): string {
  const d = parseLocal(ts);
  if (!d) return '—';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...(withSeconds ? { second: '2-digit' } : {}) });
}

/** Time only when today, otherwise "Oct 5, 9:14 AM". */
export function relStamp(ts?: string | null): string {
  const d = parseLocal(ts);
  if (!d) return '—';
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (localDate(d) === localDate()) return time;
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${time}`;
}

export function hourLabel(h: number): string {
  const suffix = h < 12 ? 'AM' : 'PM';
  return `${h % 12 === 0 ? 12 : h % 12} ${suffix}`;
}

export function hourRangeLabel(h: number): string {
  const f = (x: number) => `${x % 12 === 0 ? 12 : x % 12}:00 ${x < 12 ? 'AM' : 'PM'}`;
  return `${f(h)} – ${f((h + 1) % 24)}`;
}

export const METHOD_LABELS: Record<HikAccessMethod, string> = {
  fingerprint: 'Fingerprint',
  face: 'Face',
  card: 'Card',
  door: 'Door sensor',
  remote: 'Remote unlock',
  other: 'Other'
};

export function initials(name?: string | null): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

export type PeriodPreset = 'today' | 'yesterday' | '7d' | '30d' | 'custom';

/** Inclusive [from, to] dates for a period preset. */
export function periodRange(preset: PeriodPreset, customFrom?: string, customTo?: string): { from: string; to: string } {
  const today = localDate();
  switch (preset) {
    case 'yesterday': return { from: addDays(today, -1), to: addDays(today, -1) };
    case '7d': return { from: addDays(today, -6), to: today };
    case '30d': return { from: addDays(today, -29), to: today };
    case 'custom': {
      const from = customFrom || today;
      const to = customTo && customTo >= from ? customTo : from;
      return { from, to };
    }
    default: return { from: today, to: today };
  }
}

export function downloadCsv(filename: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers, ...rows].map(r => r.map(esc).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

import { signal } from '@angular/core';
import type { CeoPeriod } from '../../../services/ceo.service';
import type { DashRange } from '../../../services/dashboard-api';

// ---------- custom date range (CEO and Sales Manager dashboards, API CS_01) ----------

/** Longest custom range (as the API: a leap year). */
export const MAX_RANGE_DAYS = 366;
/** No range starts before this day (as the API). */
export const EARLIEST_DAY = '2000-01-01';

const pad = (n: number) => String(n).padStart(2, '0');

/** yyyy-MM-dd of a local date. */
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** A yyyy-MM-dd day as a local date (null when it is not one). */
export function parseDay(s: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? '').trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]) ? d : null;
}

/** Days in a range, both days included (0 when it is not a valid range). */
export function rangeDays(r: DashRange | null | undefined): number {
  const f = parseDay(r?.from), t = parseDay(r?.to);
  if (!f || !t || f > t) return 0;
  return Math.round((Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()) - Date.UTC(f.getFullYear(), f.getMonth(), f.getDate())) / 86400000) + 1;
}

/** The range just before one, as many days long (the API's previous period of a custom range). */
export function previousRange(r: DashRange): DashRange | null {
  const n = rangeDays(r);
  const f = parseDay(r.from);
  if (!n || !f) return null;
  const to = new Date(f); to.setDate(to.getDate() - 1);
  const from = new Date(f); from.setDate(from.getDate() - n);
  return { from: ymd(from), to: ymd(to) };
}

/** As the API labels it: "15 Oct 2026", "October 2026", "1 Oct - 15 Oct 2026", "20 Dec 2025 - 10 Jan 2026". */
export function rangeLabel(r: DashRange | null | undefined): string {
  const f = parseDay(r?.from), t = parseDay(r?.to);
  if (!f || !t) return 'Custom range';
  // Month names as the API writes them (en-US: "Sep", not the "Sept" some browsers give for en-GB).
  const mon = (d: Date, style: 'short' | 'long') => d.toLocaleString('en-US', { month: style });
  const day = (d: Date, year: boolean) => `${d.getDate()} ${mon(d, 'short')}${year ? ' ' + d.getFullYear() : ''}`;
  if (f.getTime() === t.getTime()) return day(f, true);
  const lastOfMonth = new Date(f.getFullYear(), f.getMonth() + 1, 0);
  if (f.getDate() === 1 && t.getTime() === lastOfMonth.getTime()) return `${mon(f, 'long')} ${f.getFullYear()}`;
  return f.getFullYear() === t.getFullYear() ? `${day(f, false)} - ${day(t, true)}` : `${day(f, true)} - ${day(t, true)}`;
}

/** What is wrong with a range (the API's rules), or null when it can be used. */
export function checkRange(from: string, to: string, today = ymd(new Date())): string | null {
  if (!from || !to) return 'Choose both dates.';
  const f = parseDay(from), t = parseDay(to);
  if (!f || !t) return 'Enter the dates as day, month and year.';
  if (from > to) return 'The start date must be on or before the end date.';
  if (from < EARLIEST_DAY) return 'Choose a start date in 2000 or later.';
  if (to > today) return 'The end date cannot be after today.';
  if (rangeDays({ from, to }) > MAX_RANGE_DAYS) return `Choose at most ${MAX_RANGE_DAYS} days.`;
  return null;
}

/** First day of the calendar period to today, as the dashboards count it (for a new custom range). */
export function calendarRange(period: CeoPeriod, today = new Date()): DashRange {
  const y = today.getFullYear(), m = today.getMonth();
  const start = period === 'year' ? new Date(y, 0, 1) : period === 'quarter' ? new Date(y, Math.floor(m / 3) * 3, 1) : new Date(y, m, 1);
  return { from: ymd(start), to: ymd(today) };
}

/**
 * How the dashboards word the period and the one before it: "Invoiced this month" / "PKR 2.1M last month" /
 * "vs a month ago"; for a custom range "Invoiced in this range" / "PKR 2.1M previous 15 days" / "vs 15 days earlier".
 */
export interface PeriodWords {
  /** "this month", "in this range" */
  thisP: string;
  /** "last month", "previous 15 days" */
  last: string;
  /** "a month ago", "15 days earlier" */
  ago: string;
  /** "month", "quarter", "year", "range" */
  word: string;
}

export function periodWords(period: CeoPeriod, range?: DashRange | null): PeriodWords {
  if (period === 'custom') {
    const n = rangeDays(range);
    const days = n === 1 ? 'day' : `${n} days`;
    return n
      ? { thisP: 'in this range', last: `previous ${days}`, ago: `${days} earlier`, word: 'range' }
      : { thisP: 'in this range', last: 'previous range', ago: 'one range earlier', word: 'range' };
  }
  const w = period === 'year' ? 'year' : period === 'quarter' ? 'quarter' : 'month';
  return { thisP: `this ${w}`, last: `last ${w}`, ago: `a ${w} ago`, word: w };
}

/** "This month", "This quarter", "This year", or the range ("1 Oct - 15 Oct 2026"). */
export function periodTitleOf(period: CeoPeriod, range?: DashRange | null): string {
  return period === 'custom' ? rangeLabel(range) : { month: 'This month', quarter: 'This quarter', year: 'This year' }[period];
}

/**
 * The From / To editor behind the period selector's "Custom" button: opened with the range on screen (or the current
 * calendar period to today), checked as the API checks it, and applied only when valid.
 */
export class RangeEditor {
  readonly open = signal(false);
  readonly from = signal('');
  readonly to = signal('');
  readonly error = signal('');
  /** Latest day that can be chosen (today). */
  today = ymd(new Date());

  show(period: CeoPeriod, range: DashRange | null) {
    this.today = ymd(new Date());
    const start = period === 'custom' && range ? range : calendarRange(period);
    this.from.set(start.from);
    this.to.set(start.to > this.today ? this.today : start.to);
    this.error.set('');
    this.open.set(true);
  }

  close() { this.open.set(false); this.error.set(''); }

  setFrom(v: string) { this.from.set(v); this.error.set(''); }
  setTo(v: string) { this.to.set(v); this.error.set(''); }

  /** Days in the range being edited (0 when not valid yet). */
  days(): number { return rangeDays({ from: this.from(), to: this.to() }); }

  /** The range when it is valid (and the editor closes), else null with the reason in error(). */
  apply(): DashRange | null {
    this.today = ymd(new Date());
    const problem = checkRange(this.from(), this.to(), this.today);
    if (problem) { this.error.set(problem); return null; }
    const range = { from: this.from(), to: this.to() };
    this.close();
    return range;
  }
}

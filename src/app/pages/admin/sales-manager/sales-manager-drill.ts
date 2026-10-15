import { DrillLevel, DrillMetricSpec, monthLong } from '../ceo/ceo-shared';
import { CeoBreakdownRow, CeoParams } from '../../../services/ceo.service';
import { SmMetric, SmRecordKind } from '../../../services/sales-manager.service';

/** A drawer level of the sales dashboard. */
export type SmDrillLevel = DrillLevel<SmMetric, SmRecordKind>;

/** "91 desks", "1 desk" (the sales dashboard counts desks, never money). */
export function desks(n: number | null | undefined): string {
  const v = Number(n || 0);
  return `${v.toLocaleString()} desk${v === 1 ? '' : 's'}`;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
/** "yyyy-MM" of a date (local time). */
const monthOf = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;

/** The two lists behind a "Desks booked & desks ending" month: bookings made in it, leases ending in it. */
export type SmDesksMonthList = 'bookings' | 'leases';

/**
 * Which list a desks-month row opens, and the other one it offers (null = none), as on the app: a future month has
 * no bookings made in it yet, so it opens the leases ending then; a month with no desks booked but desks ending opens
 * those leases (and offers its bookings, e.g. meeting rooms, which hold 0 desks); otherwise the bookings, offering
 * the leases when desks end that month. value = desks booked, value2 = desks ending.
 */
export function smDesksMonthLists(
  month: string, row: Pick<CeoBreakdownRow, 'value' | 'value2'>, today: Date = new Date()
): { primary: SmDesksMonthList; secondary: SmDesksMonthList | null } {
  const ending = row.value2 ?? 0;
  if (month > monthOf(today)) return { primary: 'leases', secondary: null };
  if (row.value <= 0 && ending > 0) return { primary: 'leases', secondary: 'bookings' };
  return { primary: 'bookings', secondary: ending > 0 ? 'leases' : null };
}

/** A desks-month list of one location: bookings made that month, or leases ending that month. */
function desksMonthLevel(list: SmDesksMonthList, p: CeoParams, r: CeoBreakdownRow): SmDrillLevel {
  return list === 'leases'
    ? { kind: 'records', records: 'leases', params: { month: p['month'], locationId: r.key }, crumb: `${r.label} · leases ending` }
    : { kind: 'records', records: 'bookings', params: { month: p['month'], locationId: r.key }, crumb: r.label };
}

const monthParam = (p: CeoParams) => String(p['month'] ?? '');

/**
 * Sales dashboard breakdowns (GET api/sales-manager/breakdown, drill level 2): what the rows are, how the values
 * read and which records a row opens (level 3), exactly as the contract lists them. Every value is a count
 * (desks, bookings, quotations, leases); the API's valueLabel / value2Label name them.
 */
export const SM_METRICS: Record<SmMetric, DrillMetricSpec> = {
  // A month of the funnel chart: the manager's locations, desks booked / bookings -> that location's bookings.
  'funnel-month': {
    rowLabel: 'Location', money: false, separateUnits: true, chart: 'grouped', vertical: false,
    next: (p, r): SmDrillLevel => ({ kind: 'records', records: 'bookings', params: { month: p['month'], locationId: r.key }, crumb: r.label })
  },
  // A person: their last 6 months, quotations / desks sold -> that month's quotations by them.
  'staff': {
    rowLabel: 'Month', money: false, separateUnits: true, chart: 'grouped', vertical: true,
    next: (p, r): SmDrillLevel => ({ kind: 'records', records: 'quotations', params: { userId: p['userId'], month: r.key }, crumb: r.label })
  },
  // An inquiry type: its last 6 months -> that month's inquiries of the type.
  'inquiries-type': {
    rowLabel: 'Month', money: false, chart: 'single', vertical: true,
    next: (p, r): SmDrillLevel => ({ kind: 'records', records: 'inquiries', params: { type: p['type'], month: r.key }, crumb: r.label })
  },
  // A month of expiring leases: the manager's locations, leases ending / their desks -> those leases.
  'renewals-month': {
    rowLabel: 'Location', money: false, separateUnits: true, chart: 'single', vertical: false,
    next: (p, r): SmDrillLevel => ({ kind: 'records', records: 'leases', params: { month: p['month'], locationId: r.key }, crumb: r.label })
  },
  // A month of desks booked & desks ending: the manager's locations -> that location's bookings of the month, or the
  // leases ending in it (a future month, or no desks booked but desks ending); a row with both offers the other list.
  'desks-month': {
    rowLabel: 'Location', money: false, chart: 'grouped', vertical: false,
    next: (p, r) => desksMonthLevel(smDesksMonthLists(monthParam(p), r).primary, p, r),
    nextLabel: (p, r) => {
      const month = monthLong(monthParam(p));
      return smDesksMonthLists(monthParam(p), r).primary === 'leases'
        ? `Open the leases ending in ${month} at ${r.label}`
        : `Open the bookings made in ${month} at ${r.label}`;
    },
    secondary: (p, r) => {
      const { secondary } = smDesksMonthLists(monthParam(p), r);
      if (!secondary || !r.key) return null;
      const month = monthLong(monthParam(p));
      return {
        label: secondary === 'leases' ? `Leases ending in ${month} · ${desks(r.value2)}` : `Bookings made in ${month} · ${desks(r.value)}`,
        level: desksMonthLevel(secondary, p, r)
      };
    },
    hint: p => monthParam(p) > monthOf(new Date())
      ? 'Select a location for the leases ending that month.'
      : 'Select a location for the bookings made that month, or the leases ending when no desks were booked.'
  }
};

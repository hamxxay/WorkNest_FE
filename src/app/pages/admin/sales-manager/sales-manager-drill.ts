import { DrillLevel, DrillMetricSpec } from '../ceo/ceo-shared';
import { SmMetric, SmRecordKind } from '../../../services/sales-manager.service';

/** A drawer level of the sales dashboard. */
export type SmDrillLevel = DrillLevel<SmMetric, SmRecordKind>;

/** "91 desks", "1 desk" (the sales dashboard counts desks, never money). */
export function desks(n: number | null | undefined): string {
  const v = Number(n || 0);
  return `${v.toLocaleString()} desk${v === 1 ? '' : 's'}`;
}

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
  // A month of desks booked & desks ending: the manager's locations -> that location's bookings of the month.
  'desks-month': {
    rowLabel: 'Location', money: false, chart: 'grouped', vertical: false,
    next: (p, r): SmDrillLevel => ({ kind: 'records', records: 'bookings', params: { month: p['month'], locationId: r.key }, crumb: r.label })
  }
};

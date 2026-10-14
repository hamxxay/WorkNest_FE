import { DrillLevel, DrillMetricSpec, ratio } from '../ceo/ceo-shared';
import { SmMetric, SmRecordKind } from '../../../services/sales-manager.service';

/** A drawer level of the sales dashboard. */
export type SmDrillLevel = DrillLevel<SmMetric, SmRecordKind>;

/**
 * Sales dashboard breakdowns (GET api/sales-manager/breakdown, drill level 2): what the rows are, how the values
 * read and which records a row opens (level 3), exactly as the contract lists them.
 */
export const SM_METRICS: Record<SmMetric, DrillMetricSpec> = {
  // A month of the funnel chart: the manager's locations, bookings / quotations -> that location's bookings.
  'funnel-month': {
    rowLabel: 'Location', money: false, chart: 'grouped', vertical: false,
    derived: { label: 'Conversion', of: r => (r.value2 ? ratio(r.value, r.value2) : null) },
    next: (p, r): SmDrillLevel => ({ kind: 'records', records: 'bookings', params: { month: p['month'], locationId: r.key }, crumb: r.label })
  },
  // A person: their last 6 months, quotations / converted -> that month's quotations by them.
  'staff': {
    rowLabel: 'Month', money: false, chart: 'grouped', vertical: true,
    derived: { label: 'Conversion', of: r => (r.value ? ratio(r.value2 ?? 0, r.value) : null) },
    next: (p, r): SmDrillLevel => ({ kind: 'records', records: 'quotations', params: { userId: p['userId'], month: r.key }, crumb: r.label })
  },
  // An inquiry type: its last 6 months -> that month's inquiries of the type.
  'inquiries-type': {
    rowLabel: 'Month', money: false, chart: 'single', vertical: true,
    next: (p, r): SmDrillLevel => ({ kind: 'records', records: 'inquiries', params: { type: p['type'], month: r.key }, crumb: r.label })
  },
  // A month of expiring leases: the manager's locations, lease count / monthly rent -> those leases.
  'renewals-month': {
    rowLabel: 'Location', money: false, money2: true, chart: 'single', vertical: false,
    next: (p, r): SmDrillLevel => ({ kind: 'records', records: 'leases', params: { month: p['month'], locationId: r.key }, crumb: r.label })
  },
  // A month of new-booking revenue: the manager's locations -> that location's bookings of the month.
  'revenue-month': {
    rowLabel: 'Location', money: true, chart: 'single', vertical: false,
    next: (p, r): SmDrillLevel => ({ kind: 'records', records: 'bookings', params: { month: p['month'], locationId: r.key }, crumb: r.label })
  }
};

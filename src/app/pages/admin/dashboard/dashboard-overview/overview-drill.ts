import { map, throwError } from 'rxjs';
import { CeoParams } from '../../../../services/ceo.service';
import {
  DashboardDetailsService, OverviewDetailKind, OverviewDetailRecords, OverviewDetails
} from '../../../../services/dashboard-details.service';
import { DrillLevel, DrillRecords, DrillSource, count, fullMoney, monthLong, pct, ratio } from '../../ceo/ceo-shared';

// ============================================================
// Chart drill-down of the admin dashboard overview: the CEO drawer (CeoDrawer) with this source. Every chart
// element opens one records level (GET api/dashboard/overview-details/{kind}); the drawer's invoices / bookings /
// spaces tables show it. A booking number links to /admin/bookings?booking=<id>.
// ============================================================

/** The dashboard filters a list follows (read when it loads). */
export interface OverviewDrillScope {
  /** Locations to total (one or several); empty = all the user may see (or locationId). */
  locationIds: number[];
  locationId: number | null;
  /** The dashboard's period (month / quarter / year, or custom); top customers follow it. */
  period: string;
  /** Custom date range, 'yyyy-MM-dd'; used when both are set (they replace the period). */
  customFrom: string | null;
  customTo: string | null;
}

/** Which drawer table a list uses. */
const RECORDS_OF: Record<OverviewDetailKind, OverviewDetailRecords> = {
  'revenue-month': 'invoices', 'aging-bucket': 'invoices', 'top-customer': 'invoices',
  'new-bookings': 'bookings', 'leases-ending': 'bookings',
  'space-type': 'spaces', 'occupied-month': 'spaces'
};

/** Aging bucket keys of the API, in the chart's order (Not due, 1-30, 31-60, 61-90, 90+ days). */
export const AGING_KEYS = ['not_due', '1_30', '31_60', '61_90', '90_plus'] as const;

/** A drawer level for one chart element: the drawer table in `records`, the API kind in params.detail. */
export function overviewLevel(kind: OverviewDetailKind, params: CeoParams, crumb: string): DrillLevel<string, string> {
  return { kind: 'records', records: RECORDS_OF[kind], params: { ...params, detail: kind }, crumb };
}

/** "yyyy-MM" of this month (the browser's clock). */
function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** "Spaces in use now" for this month, else "... at the end of Sep 2026" (as the occupancy line measures it). */
export function spacesInUseLabel(month: string): string {
  return month >= thisMonth() ? 'Spaces in use now' : `Spaces in use at the end of ${monthLong(month)}`;
}

/** The line on the totals of every record, as the chart counts them. */
function summaryOf(kind: OverviewDetailKind, d: OverviewDetails): string | undefined {
  switch (kind) {
    case 'revenue-month': return `${fullMoney(d.amount)} invoiced, ${fullMoney(d.paidAmount)} of it paid`;
    case 'aging-bucket': return `${fullMoney(d.balance)} owed`;
    case 'top-customer': return `${fullMoney(d.amount)} invoiced`;
    case 'new-bookings':
    case 'leases-ending': return `${fullMoney(d.amount)} booking value`;
    case 'occupied-month':
      return d.totalSpaces ? `${pct(ratio(d.occupied, d.totalSpaces))} of ${count(d.totalSpaces)} active spaces` : undefined;
    default: return undefined;
  }
}

/**
 * The other list of an Occupancy and new bookings month (new bookings <-> spaces in use), offered above the table.
 * Only on the list opened from the chart (rel marks the one opened from it), so the path never grows beyond two.
 */
function relatedOf(kind: OverviewDetailKind, params: CeoParams): DrillRecords['related'] {
  const month = String(params['month'] ?? '');
  if (params['rel'] || !month) return undefined;
  if (kind === 'new-bookings') {
    return [{ label: spacesInUseLabel(month), level: overviewLevel('occupied-month', { month, rel: 1 }, 'Spaces in use') }];
  }
  if (kind === 'occupied-month') {
    return [{ label: `New bookings made in ${monthLong(month)}`, level: overviewLevel('new-bookings', { month, rel: 1 }, 'New bookings') }];
  }
  return undefined;
}

/** The drawer's source on the admin dashboard: lists only (no breakdowns), booking numbers link to the booking. */
export function overviewDrillSource(details: DashboardDetailsService, scope: () => OverviewDrillScope): DrillSource {
  return {
    metrics: {},
    breakdown: () => throwError(() => ({ status: 400, needsDbUpdate: false, title: 'Not available', message: 'This list has no breakdown.' })),
    records: (_records, params) => {
      const { detail, locationId: _drawerLocation, rel: _rel, ...rest } = params;
      const kind = String(detail) as OverviewDetailKind;
      const s = scope();
      const range = !!(s.customFrom && s.customTo);
      return details.getDetails(kind, {
        ...rest,
        locationIds: s.locationIds.length ? s.locationIds.join(',') : null,
        locationId: s.locationIds.length ? null : s.locationId,
        period: range || s.period === 'custom' ? null : s.period,
        from: range ? s.customFrom : null,
        to: range ? s.customTo : null
      }).pipe(map((d): DrillRecords => ({
        title: d.title, total: d.total, rows: d.rows, summary: summaryOf(kind, d), related: relatedOf(kind, params)
      })));
    },
    describeError: err => DashboardDetailsService.describeError(err),
    bookingLink: bookingId => ({ path: '/admin/bookings', queryParams: { booking: bookingId } })
  };
}

import type { SmComplaints, SmDashboard } from '../../../services/sales-manager.service';
import type { XlsxCell, XlsxSheet } from '../../../utils/xlsx';
import { ExportMeta, summarySheet } from '../ceo/ceo-export';
import { complaintStatusStyle, ratio } from '../ceo/ceo-shared';

// ============================================================
// The Sales dashboard as an Excel workbook (Export Excel): a summary, every KPI with its previous period, and one sheet
// per chart / list (counts and desks, no money). Built from the figures on screen; complaints when they loaded.
// ============================================================

const pct1 = (v: number) => Math.round(v * 10) / 10;
const leases = (n: number) => `${n} lease${n === 1 ? '' : 's'}`;

export function salesWorkbook(d: SmDashboard, cmp: SmComplaints | null, meta: ExportMeta): XlsxSheet[] {
  const sheets: XlsxSheet[] = [summarySheet('WorkNest Sales dashboard', meta, [
    'Counts and desks (desks of a booking or quotation = its capacity, else its space; meeting rooms count 0).',
    'Previous period: the same number of days just before a custom range, else the same days one period earlier.',
    'The 12-month series, follow-ups due and leases expiring do not change with the period.',
    'Team: the sales executives at the locations covered (no admins or other roles).'
  ])];

  const kpis: XlsxCell[][] = [['Section', 'Figure', 'Value', `Previous (${meta.previousWords})`, 'Note']];
  const f = d.funnel, t = d.team, q = d.inquiries, r = d.renewals;
  const stage = (k: string) => f?.stages.find(s => s.stage.toLowerCase() === k)?.count ?? 0;
  if (f) {
    kpis.push(
      ['Sales funnel', 'Tour inquiries', stage('inquiries'), null, d.inquiriesAllBranches ? 'Every branch' : ''],
      ['Sales funnel', 'Quotations', stage('quotations'), null, ''],
      ['Sales funnel', 'Accepted', stage('accepted'), null, ''],
      ['Sales funnel', 'Bookings', stage('bookings'), null, ''],
      ['Sales funnel', 'Conversion (%)', pct1(f.conversionRate), pct1(f.conversionRatePrev), `${f.quotationsBooked} of ${stage('quotations')} quotations booked`],
      ['Sales funnel', 'Desks quoted', f.quotedDesks, null, ''],
      ['Sales funnel', 'Desks booked', f.bookedDesks, f.bookedDesksPrev, '']
    );
  }
  if (q) {
    kpis.push(
      ['Tour inquiries', 'Tour inquiries', q.total, q.totalPrev, ''],
      ['Tour inquiries', 'Followed up', q.followedUp, null, ''],
      ['Tour inquiries', 'Converted', q.converted, null, ''],
      ['Tour inquiries', 'Not interested', q.notInterested, null, ''],
      ['Tour inquiries', 'Follow-ups due', q.followUpsDue, null, 'Due today or earlier']
    );
  }
  if (r) {
    kpis.push(
      ['Renewals', 'Desks ending in 90 days', r.expiringDesks, null, leases(r.expiringCount)],
      ['Renewals', 'Desks ending within 30 days', r.expiring30Desks, null, leases(r.expiring30Count)],
      ['Renewals', 'Desks booked', r.bookedDesks, null, ''],
      ['Renewals', 'Desks ended', r.endedDesks, null, ''],
      ['Renewals', 'Net desks', r.netDesks, r.netDesksPrev, 'Booked less ended']
    );
  }
  if (cmp) {
    kpis.push(
      ['Complaints', 'New', cmp.newInPeriod, cmp.newInPeriodPrev, `${cmp.reopenedInPeriod} reopened`],
      ['Complaints', 'Open', cmp.status.open, null, 'Right now'],
      ['Complaints', 'In progress', cmp.status.inProgress, null, 'Right now'],
      ['Complaints', 'Resolved', cmp.resolvedInPeriod, null,
        cmp.avgResolutionDays !== null ? `Average ${cmp.avgResolutionDays} days to resolve` : '']
    );
  }
  sheets.push({ name: 'KPIs', rows: kpis });

  if (f) {
    sheets.push({ name: 'Sales funnel', rows: [['Stage', 'Count'], ...f.stages.map(s => [s.label, s.count])] });
    sheets.push({
      name: 'Funnel 12 months',
      rows: [['Month', 'Quotations', 'Accepted', 'Bookings', 'Desks booked', 'Quotations booked', 'Conversion (%)'],
        ...f.months.map(m => [m.month, m.quotations, m.accepted, m.bookings, m.bookedDesks, m.quotationsBooked,
          m.quotations ? pct1(ratio(m.quotationsBooked, m.quotations)) : null])]
    });
  }
  if (t) {
    // The sales executives under the manager (the API sends no other role).
    sheets.push({
      name: 'Sales executives',
      rows: [['Name', 'Locations', 'Inquiries handled', 'Quotations', 'Accepted', 'Converted', 'Conversion (%)', 'Desks sold', 'Follow-ups due'],
        ...[...t.people]
          .sort((a, b) => b.desksSold - a.desksSold || b.converted - a.converted || b.quotations - a.quotations || a.name.localeCompare(b.name))
          .map(p => [p.name, p.locations, p.inquiriesHandled, p.quotations, p.accepted, p.converted, pct1(p.conversionRate), p.desksSold,
            p.followUpsDue])]
    });
    sheets.push({
      name: 'Team by location',
      rows: [['Location', 'Sales executives', 'Quotations', 'Converted', 'Conversion (%)', 'Desks sold'],
        ...t.perLocation.map(l => [l.name, l.salesExecutives, l.quotations, l.converted, l.quotations ? pct1(ratio(l.converted, l.quotations)) : null,
          l.desksSold])]
    });
  }
  if (q) {
    const total = q.byType.reduce((a, x) => a + x.count, 0);
    sheets.push({
      name: 'Inquiries by type',
      rows: [['Type', 'Inquiries', 'Share (%)'], ...q.byType.map(x => [x.label, x.count, total ? pct1(ratio(x.count, total)) : null])]
    });
    sheets.push({ name: 'Not interested reasons', rows: [['Reason', 'Inquiries'], ...q.notInterestedReasons.map(x => [x.reason, x.count])] });
    sheets.push({
      name: 'Inquiries 12 months',
      rows: [['Month', 'Website', 'WhatsApp', 'Walk-In', 'Reference', 'Not set', 'Total'],
        ...q.months.map(m => [m.month, m.website, m.whatsApp, m.walkIn, m.reference, m.notSet, m.website + m.whatsApp + m.walkIn + m.reference + m.notSet])]
    });
  }
  if (r) {
    sheets.push({
      name: 'Desks by month',
      rows: [['Month', 'Desks booked', 'Desks ending', 'Leases ending'], ...r.months.map(m => [m.month, m.bookedDesks, m.endingDesks, m.expiring])]
    });
    sheets.push({
      name: 'Leases expiring',
      rows: [['Customer', 'Space', 'Location', 'Ends on', 'Days left', 'Desks'],
        ...r.expiring.map(l => [l.customer, l.space, l.location, l.endOn.slice(0, 10), l.daysLeft, l.desks])]
    });
  }
  if (cmp) {
    sheets.push({
      name: 'Complaints by status',
      // The API's four status counts, worded as on the page.
      rows: [['Status', 'Complaints now'],
        ...([['open', cmp.status.open], ['in_progress', cmp.status.inProgress], ['resolved', cmp.status.resolved], ['closed', cmp.status.closed]] as const)
          .map(([key, n]) => [complaintStatusStyle(key).label, n])]
    });
    sheets.push({
      name: 'Complaints by category',
      rows: [['Category', 'Open now', 'In progress now', 'New in the period'], ...cmp.byCategory.map(c => [c.category, c.open, c.inProgress, c.total])]
    });
    sheets.push({
      name: 'Complaints by branch',
      rows: [['Branch', 'Open now', 'In progress now', 'New in the period'], ...cmp.byBranch.map(b => [b.label, b.open, b.inProgress, b.total])]
    });
    sheets.push({ name: 'Complaints 12 months', rows: [['Month', 'Raised', 'Resolved'], ...cmp.months.map(m => [m.month, m.created, m.resolved])] });
    sheets.push({
      name: 'Oldest open complaints',
      rows: [['Complaint', 'Customer', 'Category', 'Branch', 'Status', 'Raised on', 'Age (days)'],
        ...cmp.oldestActive.map(c => [c.complaintNo, c.customerName, c.category, c.branch || 'No branch', complaintStatusStyle(c.status).label,
          c.createdOn?.slice(0, 10) ?? '', c.ageDays])]
    });
  }
  return sheets;
}

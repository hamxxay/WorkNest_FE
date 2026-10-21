import { roomCategoryLabel, roomCategoryOf, type CeoDashboard, type CeoForecastMonth, type CeoRooms } from '../../../services/ceo.service';
import type { DashRange } from '../../../services/dashboard-api';
import type { XlsxCell, XlsxSheet } from '../../../utils/xlsx';
import { ratio } from './ceo-shared';
import { rentByGroup, roomGroups } from './ceo-rooms/rooms-view';

// ============================================================
// The CEO dashboard as an Excel workbook (Export Excel): a summary, every KPI with its previous period, and one sheet
// per chart / list with the numbers behind it (money in PKR, shares in %). Built from the figures on screen.
// ============================================================

/** What the sheets say about the export itself. */
export interface ExportMeta {
  /** "1 Oct - 15 Oct 2026", "This month"... */
  periodTitle: string;
  range: DashRange | null;
  previousRange: DashRange | null;
  location: string;
  /** WorkNest name of the person exporting ('' = not known: left out). */
  preparedBy: string;
  /** "last month", "previous 15 days" (the KPI sheet's previous-period column). */
  previousWords: string;
}

/** % with one decimal (as a number for Excel). */
const pct1 = (v: number) => Math.round(v * 10) / 10;
const money2 = (v: number) => Math.round(v * 100) / 100;

/** The Summary sheet both dashboards start with. */
export function summarySheet(title: string, meta: ExportMeta, notes: string[]): XlsxSheet {
  const rows: XlsxCell[][] = [
    [title],
    ['Period', meta.periodTitle]
  ];
  if (meta.range) rows.push(['From', meta.range.from], ['To', meta.range.to]);
  if (meta.previousRange) rows.push(['Compared with', `${meta.previousRange.from} to ${meta.previousRange.to}`]);
  rows.push(['Location', meta.location]);
  rows.push(['Generated', new Date().toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })]);
  if (meta.preparedBy) rows.push(['Prepared by', meta.preparedBy]);
  rows.push([]);
  notes.forEach(n => rows.push([n]));
  return { name: 'Summary', header: 0, rows };
}

export function ceoWorkbook(d: CeoDashboard, forecast: CeoForecastMonth[] | null, rooms: CeoRooms | null, meta: ExportMeta): XlsxSheet[] {
  // The database update CP_01 places an invoice in the month its billing period starts (and sends billed in advance).
  const byPeriod = d.money?.billedInAdvance != null;
  // CP_02 (sends the security deposits): invoiced without deposits, collected = paid so far, whole billing months.
  const cp02 = d.money?.securityDeposits != null;
  const sheets: XlsxSheet[] = [summarySheet('WorkNest CEO dashboard', meta, [
    'Money in PKR. Shares and rates in %.',
    ...(byPeriod ? [
      'Invoiced, collected, the 12-month series and top customers place an invoice in the month its billing period starts, not the month it was issued.',
      'Billed in advance: unpaid invoices for a billing period that has not started yet (and not past due). Outstanding and the aging leave them out.'
    ] : []),
    ...(cp02 ? [
      'Invoiced, collected, the 12-month series and top customers leave out refundable security deposits (Security deposits, apart). Collected = paid so far on those invoices: part payments count, a paid invoice in full, an invoice with only its WHT left as settled.',
      'Previous period: the same number of days just before a custom range; else invoices: the same billing months one period earlier, other figures: the same days one period earlier.'
    ] : ['Previous period: the same number of days just before a custom range, else the same days one period earlier.']),
    'The 12-month series, receivables aging, top customers and leases expiring do not change with the period.',
    d.team?.revenueBasis === 'bookings'
      ? 'Team: sales executives only. Revenue = the contract value of the new bookings they sold in the period (their quotation, else the booking they made).'
      : 'Team: sales executives only. Revenue = the value of the quotations they created in the period that were converted to bookings.',
    'Converted / conversion: quotations whose booking is still live (not rejected, cancelled or deleted).'
  ])];

  // ---------- KPIs ----------
  const kpis: XlsxCell[][] = [['Section', 'Figure', 'Value', `Previous (${meta.previousWords})`, 'Note']];
  const m = d.money, o = d.occupancy, s = d.sales;
  if (m) {
    kpis.push(
      ['Money', 'Invoiced (PKR)', money2(m.invoiced), money2(m.invoicedPrev),
        cp02 ? 'Billing period starts in the period, without security deposits' : byPeriod ? 'Billing period starts in the period' : 'Issued in the period'],
      ['Money', 'Collected (PKR)', money2(m.collected), money2(m.collectedPrev), cp02 ? 'Paid so far on those invoices, without security deposits' : 'Of those, now paid'],
      ['Money', 'Collection rate (%)', pct1(m.collectionRate), m.invoicedPrev > 0 ? pct1(ratio(m.collectedPrev, m.invoicedPrev)) : null, cp02 ? 'Share of the billing paid so far' : ''],
      ...(m.securityDeposits != null ? [['Money', 'Security deposits (PKR)', money2(m.securityDeposits), money2(m.securityDepositsPrev ?? 0),
        `${m.securityDepositsCount ?? 0} invoice${m.securityDepositsCount === 1 ? '' : 's'}, billed in the period, not in Invoiced`] as XlsxCell[]] : []),
      ['Money', 'Outstanding (PKR)', money2(m.outstanding), null, `${m.outstandingCount} unpaid invoice${m.outstandingCount === 1 ? '' : 's'}, as of today${byPeriod ? ', not counting billed in advance' : ''}`],
      ...(m.billedInAdvance != null ? [['Money', 'Billed in advance (PKR)', money2(m.billedInAdvance), null,
        `${m.billedInAdvanceCount ?? 0} unpaid invoice${m.billedInAdvanceCount === 1 ? '' : 's'}, for billing periods not started yet`] as XlsxCell[]] : []),
      ['Money', 'Overdue (PKR)', money2(m.overdue), null, `${m.overdueCount} past due date, as of today`]
    );
  }
  // CP_02: money received (fee receipts and payments by the day they came in), after Collected; none before CP_02.
  if (m?.received != null) {
    const at = kpis.findIndex(r => r[1] === 'Collected (PKR)');
    kpis.splice(at >= 0 ? at + 1 : kpis.length, 0, ['Money', 'Received (PKR)', money2(m.received), money2(m.receivedPrev ?? 0),
      `${m.receivedCount ?? 0} receipts and payments taken in during the period (to date), whatever invoice`]);
  }
  if (o) {
    kpis.push(
      // CP_02: one line per room category (rooms with a confirmed booking now; seats sold), never one mixed figure.
      ...(o.categories.length
        ? o.categories.flatMap(c => [
          ['Occupancy', `${c.label} occupancy (%)`, pct1(c.occupancyPct), pct1(c.occupancyPctPrev),
            `${c.occupied} of ${c.rooms} rooms in use now (confirmed bookings); previous: ${c.occupiedPrev} of ${c.roomsPrev} rooms then`],
          ['Occupancy', `${c.label} seat occupancy (%)`, pct1(c.seatOccupancyPct), null, `${c.seatsSold} of ${c.seats} seats sold now`]
        ] as XlsxCell[][])
        : [['Occupancy', 'Occupancy (%)', pct1(o.occupancyPct), pct1(o.occupancyPctPrev), `${o.occupiedSpaces} of ${o.totalSpaces} spaces in use now`] as XlsxCell[]]),
      ['Occupancy', 'Active bookings', o.activeBookings, null, o.categories.length ? 'Confirmed, running today' : 'Running today'],
      ['Occupancy', 'New bookings', o.newBookings, o.newBookingsPrev, 'Made in the period'],
      ['Occupancy', 'Leases expiring in 90 days', o.leasesExpiringCount ?? o.leasesExpiring.length, null,
        o.leasesExpiringMonthly != null ? `Monthly rent PKR ${Math.round(o.leasesExpiringMonthly).toLocaleString('en-US')}${o.categories.length ? ', after discounts' : ''}` : '']
    );
  }
  if (s) {
    const stage = (k: string) => s.funnel.find(f => f.stage.toLowerCase() === k)?.count ?? 0;
    kpis.push(
      ['Sales', 'Tour inquiries', stage('inquiries'), null,
        s.inquiriesAllLocations ? 'All locations' : s.inquiriesNoBranch ? `+${s.inquiriesNoBranch} without a branch (not included)` : ''],
      ['Sales', 'Quotations', stage('quotations'), null, ''],
      ['Sales', 'Accepted', stage('accepted'), null, ''],
      ['Sales', 'Bookings', stage('bookings'), null,
        s.bookingsFromQuotations != null ? `${s.bookingsFromQuotations} from quotations, the rest booked directly` : ''],
      ['Sales', 'Conversion (%)', pct1(s.conversionRate), null, `${s.quotationsBooked} of ${s.quotations} quotations booked (booking still live)`],
      ['Sales', 'Quoted (PKR)', money2(s.quotationValue), null, ''],
      ['Sales', 'Booked (PKR)', money2(s.bookingValue), null,
        s.bookingValueBasis === 'contract' ? 'Contract value of the bookings made in the period' : 'First invoices of the bookings made in the period']
    );
  }
  if (d.team) {
    kpis.push(
      ['Team', 'Sales executives', d.team.salesExecutives, null, ''],
      ['Team', 'Sales executives revenue (PKR)', money2(d.team.revenue), null,
        d.team.revenueBasis === 'bookings'
          ? 'Contract value of the new bookings they sold in the period'
          : 'Their quotations created in the period that were converted']
    );
  }
  if (rooms?.available) {
    const r = rooms.summary;
    kpis.push(
      ['Rooms', 'Rooms', r.rooms, null, 'Private offices and shared spaces'],
      ['Rooms', 'Occupied now', r.occupiedNow, null, ''],
      ['Rooms', 'Vacant now', r.vacantNow, null, ''],
      ['Rooms', 'Days occupied (%)', pct1(r.periodOccupancyPct), null, 'Days of the period with a confirmed booking'],
      // each room category on its own (private offices, shared spaces)
      ...r.byCategory.flatMap((c): XlsxCell[][] => [
        ['Rooms', `${c.label}: occupied now`, c.occupiedNow, null, `of ${c.rooms} (${pct1(c.occupancyNowPct)}%), ${c.vacantNow} vacant`],
        ['Rooms', `${c.label}: days occupied (%)`, pct1(c.periodOccupancyPct), null, 'Days of the period with a confirmed booking']
      ]),
      ['Rooms', 'Sales under the price', r.under, null, `PKR ${Math.round(r.underGapMonthly).toLocaleString('en-US')} a month short`],
      ['Rooms', 'Sales at the price', r.at, null, ''],
      ['Rooms', 'Sales over the price', r.over, null, `PKR ${Math.round(r.overPremiumMonthly).toLocaleString('en-US')} a month extra`],
      ['Rooms', 'Sales without a list price', r.unpriced, null, '']
    );
  }
  sheets.push({ name: 'KPIs', rows: kpis });

  // ---------- Money ----------
  if (m) {
    sheets.push({
      name: 'Revenue 12 months',
      rows: [[byPeriod ? 'Month (billing period)' : 'Month', cp02 ? 'Invoiced without deposits (PKR)' : 'Invoiced (PKR)', cp02 ? 'Collected, paid so far (PKR)' : 'Collected (PKR)', 'Collection rate (%)'],
        ...m.months.map(x => [x.month, money2(x.invoiced), money2(x.collected), x.invoiced > 0 ? pct1(ratio(x.collected, x.invoiced)) : null])]
    });
    sheets.push({
      name: 'Receivables aging',
      rows: [['Days past due', 'Outstanding (PKR)', 'Invoices'], ...m.aging.map(a => [a.label, money2(a.amount), a.count])]
    });
    sheets.push({
      name: 'Top customers',
      rows: [['Rank', 'Customer', cp02 ? 'Invoiced without security deposits, last 12 months (PKR)' : 'Invoiced, last 12 months (PKR)', 'Invoices'],
        ...m.topCustomers.map((c, i) => [i + 1, c.name, money2(c.amount), c.invoices])]
    });
  }
  // CP_02: money received by month (by the day it came in), the same 12 months
  if (m?.receivedSeries?.length) {
    sheets.push({
      name: 'Received 12 months',
      rows: [['Month (received)', 'Received (PKR)', 'Receipts and payments'], ...m.receivedSeries.map(x => [x.month, money2(x.received), x.count])]
    });
  }
  if (forecast?.length) {
    // CP_02: Expected = confirmed leases (after % and fixed discounts); pending confirmation apart.
    sheets.push({
      name: 'Next 3 months',
      rows: [['Month', 'Expected, confirmed (PKR)', 'Pending confirmation (PKR)', 'All live leases (PKR)', 'Occupancy (%)', 'Occupied spaces', 'Spaces', 'Leases ending', 'Leases starting'],
        ...forecast.map(f => [f.label || f.month, money2(f.confirmedRent), money2(f.pendingRent), money2(f.expectedRent), pct1(f.occupancyPct), f.occupiedSpaces,
          f.totalSpaces, f.leasesEnding, f.leasesStarting])]
    });
  }

  // ---------- Occupancy ----------
  if (o) {
    // CP_02: per room category (Private Office, Shared Space): the 12 month ends, now, and by location.
    const cats = o.categories;
    const monthCats = cats.length ? cats.map(c => ({ code: c.categoryCode, label: c.label })) : [];
    sheets.push({
      name: 'Occupancy 12 months',
      rows: monthCats.length
        ? [['Month', ...monthCats.map(c => `${c.label} occupancy at month end (%)`), 'New bookings'],
          ...o.months.map(x => [x.month, ...monthCats.map(c => pct1(x.categories.find(k => k.categoryCode === c.code)?.occupancyPct ?? 0)), x.newBookings])]
        : [['Month', 'Occupancy (%)', 'New bookings'], ...o.months.map(x => [x.month, pct1(x.occupancyPct), x.newBookings])]
    });
    if (cats.length) {
      sheets.push({
        name: 'By room category',
        rows: [['Room category', 'Rooms', 'Occupied now', 'Occupancy (%)', 'Occupancy one period ago (%)', 'Seats', 'Seats sold', 'Seat occupancy (%)'],
          ...cats.map(c => [c.label, c.rooms, c.occupied, pct1(c.occupancyPct), pct1(c.occupancyPctPrev), c.seats, c.seatsSold, pct1(c.seatOccupancyPct)])]
      });
    } else {
      sheets.push({
        name: 'By space type',
        rows: [['Space type', 'Occupied', 'Spaces', 'Occupancy (%)'],
          ...o.byType.map(t => [t.name, t.occupied, t.total, t.total ? pct1(ratio(t.occupied, t.total)) : null])]
      });
    }
    sheets.push({
      name: 'By location',
      rows: cats.length
        ? [['Location', 'Room category', 'Rooms', 'Occupied now', 'Occupancy (%)', 'Seats', 'Seats sold', 'Seat occupancy (%)'],
          ...o.byLocation.flatMap(l => l.categories.map(c => [l.name, c.label, c.rooms, c.occupied, pct1(c.occupancyPct), c.seats, c.seatsSold, pct1(c.seatOccupancyPct)]))]
        : [['Location', 'Occupied', 'Spaces', 'Occupancy (%)'],
          ...o.byLocation.map(l => [l.name, l.occupied, l.total, l.total ? pct1(ratio(l.occupied, l.total)) : null])]
    });
    // The dashboard holds the first 50 leases: say so when there are more (the full list is records/leases).
    const leaseTotal = o.leasesExpiringCount ?? o.leasesExpiring.length;
    sheets.push({
      name: 'Leases expiring',
      rows: [['Customer', 'Space', 'Location', 'Ends on', cats.length ? 'Monthly rent after discounts (PKR)' : 'Monthly rent (PKR)'],
        ...o.leasesExpiring.map(l => [l.customer, l.space, l.location, l.endOn.slice(0, 10), money2(l.monthlyAmount)]),
        ...(leaseTotal > o.leasesExpiring.length ? [[`The first ${o.leasesExpiring.length} of ${leaseTotal} leases expiring in the next 90 days`]] : [])]
    });
  }

  // ---------- Rooms ----------
  if (rooms?.available && rooms.rooms.length) {
    const cats = rooms.summary.byCategory;
    const categoryOf = (code: string) => cats.find(c => c.categoryCode === code)?.label ?? roomCategoryLabel(code);
    const all = rooms.summary;
    sheets.push({
      name: 'Rooms',
      rows: [['Room', 'Code', 'Location', 'Category', 'Space type', 'Seats', 'List per seat (PKR)', 'List per room (PKR)', 'In use now', 'Days occupied (%)', 'Sales'],
        // no list price: an empty cell, not 0
        ...rooms.rooms.map(r => [r.name, r.code, r.location, categoryOf(roomCategoryOf(r)), r.spaceType, r.seats,
          r.listSeatPrice ? money2(r.listSeatPrice) : null, r.listRoomPrice ? money2(r.listRoomPrice) : null,
          r.occupiedNow ? 'Yes' : 'No', pct1(r.periodOccupancyPct), r.sales.length]),
        // the figures per category under the rooms (the same rooms; they add up to All rooms)
        [],
        ['By category', 'Rooms', 'Occupied now', 'Vacant now', 'Occupied now (%)', 'Days occupied (%)'],
        ...cats.map(c => [c.label, c.rooms, c.occupiedNow, c.vacantNow, pct1(c.occupancyNowPct), pct1(c.periodOccupancyPct)]),
        ['All rooms', all.rooms, all.occupiedNow, all.vacantNow, pct1(all.occupancyNowPct), pct1(all.periodOccupancyPct)]]
    });
    const pricing: Record<string, string> = { under: 'Under', at: 'At', over: 'Over', unpriced: 'No list price' };
    sheets.push({
      name: 'Room sales',
      rows: [['Room', 'Location', 'Customer', 'Shift', 'Seats', 'Start', 'End', 'Expected a month (PKR)', 'Sold a month (PKR)',
        'Difference a month (PKR)', 'Difference (%)', 'Price'],
        ...rooms.rooms.flatMap(r => r.sales.map(x => [r.name, r.location, x.customer, x.shift, x.seatsSold, x.startOn?.slice(0, 10) ?? '',
          x.endOn?.slice(0, 10) ?? '', x.pricing === 'unpriced' ? null : money2(x.expectedMonthly), money2(x.soldMonthly),
          x.pricing === 'unpriced' ? null : money2(x.varianceMonthly), x.pricing === 'unpriced' ? null : pct1(x.variancePct),
          pricing[x.pricing] ?? x.pricing]))]
    });
    // The "Rent a month" chart: per location and space type (a room's latest booking of each shift).
    const rent = rentByGroup(roomGroups(rooms.rooms, 'all'));
    sheets.push({
      name: 'Rooms rent',
      rows: [['Space type and location', 'Sold a month (PKR)', 'Missed below the price (PKR)', 'Rooms not let, at list (PKR)',
        'Over the price, inside sold (PKR)'],
        ...rent.map(r => [r.label, money2(r.sold), money2(r.below), money2(r.notLet), money2(r.premium)]),
        [],
        ['Total', money2(rent.reduce((a, r) => a + r.sold, 0)), money2(rent.reduce((a, r) => a + r.below, 0)),
          money2(rent.reduce((a, r) => a + r.notLet, 0)), money2(rent.reduce((a, r) => a + r.premium, 0))]]
    });
    sheets.push({
      name: 'Rooms by shift',
      rows: [['Shift', 'Sales', 'Under', 'At', 'Over', 'No list price', 'Expected a month (PKR)', 'Sold a month (PKR)', 'Difference a month (PKR)'],
        ...rooms.summary.byShift.map(x => [x.shift, x.sales, x.under, x.at, x.over, x.unpriced, money2(x.expectedMonthly), money2(x.soldMonthly),
          money2(x.varianceMonthly)])]
    });
  }

  // ---------- Sales ----------
  if (s) {
    sheets.push({ name: 'Sales funnel', rows: [['Stage', 'Count'], ...s.funnel.map(f => [f.label, f.count])] });
    const total = s.inquiriesByType.reduce((a, t) => a + t.count, 0);
    sheets.push({
      name: 'Inquiries by type',
      rows: [['Type', 'Inquiries', 'Share (%)'], ...s.inquiriesByType.map(t => [t.label, t.count, total ? pct1(ratio(t.count, total)) : null])]
    });
  }

  // ---------- Team: the sales executives only (the API sends no other role) ----------
  if (d.team) {
    sheets.push({
      name: 'Team by location',
      rows: [['Location', 'Sales executives',
        d.team.perLocation.some(l => l.salesExecutivesOnly) ? 'Sales executives\' quotations at the location' : 'Quotations at the location',
        'Converted', 'Conversion (%)'],
        ...d.team.perLocation.map(l => [l.name, l.salesExecutives, l.quotations, l.converted,
          l.quotations ? pct1(ratio(l.converted, l.quotations)) : null])]
    });
    sheets.push({
      name: 'Sales executives',
      rows: [['Name', 'Locations', 'Quotations', 'Converted', 'Conversion (%)', 'Revenue (PKR)'],
        ...[...d.team.people]
          .sort((a, b) => b.revenue - a.revenue || b.converted - a.converted || b.quotations - a.quotations)
          .map(p => [p.name, p.locations, p.quotations, p.converted, p.quotations ? pct1(ratio(p.converted, p.quotations)) : null,
            money2(p.revenue)]),
        [],
        ['Total', null, null, null, null, money2(d.team.revenue)]]
    });
  }
  return sheets;
}

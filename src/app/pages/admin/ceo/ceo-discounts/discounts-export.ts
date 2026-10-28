import type { CeoDiscountBooking, CeoDiscountGroup, CeoDiscountInvoice, CeoDiscounts } from '../../../../services/ceo-discounts.service';
import type { XlsxCell, XlsxSheet } from '../../../../utils/xlsx';

// ============================================================
// The Discounts section for Export Excel (CEO dashboard): one sheet with the figures and the breakdowns on screen,
// one with the biggest discounts. Money in PKR a month (invoices: as billed), shares in %. None when the section shows
// no figures (database update DD_01 not run, or not loaded).
// ============================================================

const money2 = (v: number | null | undefined) => (v === null || v === undefined ? null : Math.round(v * 100) / 100);
const pct1 = (v: number) => Math.round(v * 10) / 10;

/** One line of a breakdown table. */
function groupRow(g: CeoDiscountGroup, withRole = false): XlsxCell[] {
  return [g.name, ...(withRole ? [g.role ?? ''] : []), g.discounted, g.bookings, money2(g.discountMonthly), pct1(g.discountPct), money2(g.largestMonthly)];
}

/** A booking of the biggest list / the records list. */
export function bookingRow(b: CeoDiscountBooking): XlsxCell[] {
  return [b.customer, b.bookingId, b.room, b.location, b.shift, b.seats, money2(b.listMonthly), money2(b.expectedMonthly), money2(b.rentMonthly),
    money2(b.fixedMonthly), money2(b.soldMonthly), money2(b.discountMonthly), pct1(b.discountPct), b.seller ?? '', b.sellerRole ?? '', b.startOn ?? '', b.endOn ?? ''];
}

export const BOOKING_HEAD: XlsxCell[] = ['Customer', 'Booking', 'Room', 'Location', 'Shift', 'Seats', 'List a month (PKR)',
  'Expected a month (PKR)', 'Rent a month (PKR)', 'Fixed discount a month (PKR)', 'Sold a month (PKR)', 'Discount a month (PKR)',
  'Discount (%)', 'Sold by', 'Role', 'Start', 'End'];

export function invoiceRow(i: CeoDiscountInvoice): XlsxCell[] {
  return [i.invoiceNumber, i.periodStart ?? '', i.periodEnd ?? '', i.issuedOn ?? '', i.customer, i.room, i.location, money2(i.subTotal), money2(i.discount), money2(i.total), i.status, i.paid ? 'Yes' : 'No'];
}

export const INVOICE_HEAD: XlsxCell[] = ['Invoice', 'Billing period start', 'Billing period end', 'Issued', 'Customer', 'Room', 'Location', 'Before discount (PKR)', 'Discount (PKR)',
  'Total (PKR)', 'Status', 'Paid'];

export function discountSheets(d: CeoDiscounts | null): XlsxSheet[] {
  if (!d || !d.available) return [];
  const s = d.summary;
  const rows: XlsxCell[][] = [
    ['Discounts', d.periodLabel],
    ['Discount a month: below the expected price (24/7: the room price x seats; Morning / Evening: that price less the location shift discount; more than 0.5% below, as the Rooms section) plus fixed PKR discounts a month.'],
    ['Bookings: the confirmed bookings of the private offices and shared spaces running in the period. Invoices: the discount on the invoices whose billing period starts in the period (not void); not added to the monthly figure. Over a quarter or a year the monthly figures add up every booking running in the period.'],
    [],
    ['Figure', 'Value'],
    ['Discount a month (PKR)', money2(s.discountMonthly)],
    ['Of the expected rent (%)', pct1(s.discountPct)],
    ['Expected rent a month (PKR)', money2(s.expectedMonthly)],
    ['Sold a month, after discounts (PKR)', money2(s.soldMonthly)],
    ['Bookings', s.bookings],
    ['Bookings discounted', s.discounted],
    ['Average discount of those (%)', pct1(s.averageDiscountPct)],
    ['Below the expected price a month (PKR)', money2(s.belowPriceMonthly)],
    ['Bookings below the expected price', s.belowPriceBookings],
    ['Fixed PKR discounts a month (PKR)', money2(s.fixedMonthly)],
    ['Bookings with a fixed PKR discount', s.fixedBookings],
    ['Bookings started in the period', s.newBookings],
    ['Of those discounted', s.newDiscounted],
    ['Their discount a month (PKR)', money2(s.newDiscountMonthly)],
    ['Bookings without a list price (not compared)', s.unpriced],
    ['Discount on invoices, billing period starting in the period (PKR)', money2(s.invoiceDiscount)],
    ['Invoices with a discount', s.invoicesDiscounted],
    ['Of that, on invoices now paid (PKR)', money2(s.invoiceDiscountPaid)],
    [],
    ['By location', 'Discounted', 'Bookings', 'Discount a month (PKR)', 'Of expected (%)', 'Largest (PKR)', 'Invoice discount (PKR)', 'Invoices'],
    ...d.byLocation.map(g => [...groupRow(g), money2(g.invoiceDiscount), g.invoicesDiscounted]),
    [],
    ['By salesperson', 'Role', 'Discounted', 'Bookings', 'Discount a month (PKR)', 'Of expected (%)', 'Largest (PKR)'],
    ...d.bySeller.map(g => groupRow(g, true)),
    [],
    ['By shift', 'Discounted', 'Bookings', 'Discount a month (PKR)', 'Of expected (%)', 'Largest (PKR)'],
    ...d.byShift.map(g => groupRow(g))
  ];
  return [
    { name: 'Discounts', header: 1, rows },
    { name: 'Biggest discounts', header: 1, rows: [BOOKING_HEAD, ...d.biggest.map(bookingRow)] }
  ];
}

import { SEAT_RULE } from '../../../../services/ceo-seats.service';
import type { CeoSeats, SeatGroup } from '../../../../services/ceo-seats.service';
import type { XlsxCell, XlsxSheet } from '../../../../utils/xlsx';

/** % with one decimal and money with two (as numbers for Excel); null stays empty. */
const pct1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);
const money2 = (v: number | null) => (v === null ? null : Math.round(v * 100) / 100);

const GROUP_HEAD = ['Rooms', 'Rooms occupied', 'Room occupancy (%)', 'Seats', 'Seats sold', 'Empty seats', 'Seat occupancy (%)',
  'Gap (points)', 'Partly filled rooms', 'Empty seats in rooms let', 'Revenue per seat a month (PKR)', 'List a seat, sold seats (PKR)',
  'Revenue against list (%)', 'Rent not earned a month (PKR)', 'Empty seats without a list price', 'Seats in the period (%)',
  'Rooms in the period (%)'];

function groupRow(label: string, g: SeatGroup): XlsxCell[] {
  return [label, g.rooms, g.roomsOccupied, pct1(g.roomOccupancyPct), g.seats, g.seatsSold, g.emptySeats, pct1(g.seatOccupancyPct),
    pct1(g.gapPts), g.partlyFilledRooms, g.partlyFilledEmptySeats, money2(g.revenuePerSeat), money2(g.listSeatPriceSold),
    pct1(g.revenueVsListPct), money2(g.rentNotEarned), g.emptySeatsUnpriced, pct1(g.periodSeatOccupancyPct), pct1(g.periodRoomOccupancyPct)];
}

/**
 * The Seats section for Export Excel (CEO dashboard): a "Seats" sheet (the figures on screen with the rule, seats sold
 * now by shift, by location and by space type), "Seats by room" and "Seats 12 months". None when the section shows no
 * figures (SEAT_01 not run, no rooms, not loaded).
 */
export function seatsSheets(d: CeoSeats | null): XlsxSheet[] {
  if (!d || !d.available || !d.summary) return [];
  const s = d.summary;
  const rows: XlsxCell[][] = [
    ['Seats', ''],
    ['Rule', SEAT_RULE],
    ['Rooms', 'Active private offices and shared spaces sold by the month; seats = the room\'s capacity'],
    ['Now', `${d.asOf ?? 'Today'} (Pakistan time); follows the location only`],
    ['Period', d.periodLabel || d.period],
    ...(d.range ? [['From', d.range.from], ['To', d.range.to]] as XlsxCell[][] : []),
    [],
    ['Figure', 'Value', 'Note'],
    ['Seats', s.seats, `In ${s.rooms} rooms`],
    ['Seats sold now', s.seatsSold, ''],
    ['Empty seats now', s.emptySeats, ''],
    ['Seat occupancy now (%)', pct1(s.seatOccupancyPct), 'Seats sold / seats'],
    ['Rooms occupied now', s.roomsOccupied, `Of ${s.rooms}: any confirmed booking now`],
    ['Room occupancy now (%)', pct1(s.roomOccupancyPct), ''],
    ['Gap (points)', pct1(s.gapPts), 'Room occupancy % less seat occupancy %'],
    ['Partly filled rooms', s.partlyFilledRooms, 'A booking now and empty seats'],
    ['Empty seats in rooms already let', s.partlyFilledEmptySeats, ''],
    ['Seats with one shift free', s.oneShiftSeats, 'Sold for Morning or Evening only; counted as sold'],
    ['Sold a month (PKR)', money2(s.soldMonthly), 'Monthly rent of the bookings running now, after the booking discount'],
    ['Revenue per seat a month (PKR)', money2(s.revenuePerSeat), 'Sold a month / seats sold'],
    ['List a seat, sold seats (PKR)', money2(s.listSeatPriceSold), 'Average list price a seat of the seats sold'],
    ['List a seat, all seats (PKR)', money2(s.listSeatPriceAll), 'Average list price a seat over every seat with a list price'],
    ['Revenue against list (%)', pct1(s.revenueVsListPct), 'Revenue per seat against the list of the seats sold'],
    ['Rent not earned a month (PKR)', money2(s.rentNotEarned), "Empty seats x their room's list price a seat"],
    ['Empty seats without a list price', s.emptySeatsUnpriced, 'Not in rent not earned'],
    ['Seats in the period (%)', pct1(s.periodSeatOccupancyPct), `Seat-days sold / seat-days, ${s.periodDays} days so far`],
    ['Rooms in the period (%)', pct1(s.periodRoomOccupancyPct), 'Room-days with a booking / room-days'],
    [],
    ['Seats sold now by shift', 'Seats', 'Bookings'],
    ...d.byShift.map(x => [x.shift, x.seats, x.bookings]),
    [],
    ['Location', ...GROUP_HEAD],
    ...d.byLocation.map(g => groupRow(g.name || 'No location', g)),
    [],
    ['Space type', ...GROUP_HEAD],
    ...d.bySpaceType.map(g => groupRow(g.name || 'No space type', g))
  ];

  const rooms: XlsxCell[][] = [
    ['Room', 'Code', 'Location', 'Space type', 'Seats', 'Seats sold', 'Empty seats', 'Seat occupancy (%)', '24/7 seats', 'Morning seats',
      'Evening seats', 'One shift free', 'Bookings now', 'Occupied now', 'List a seat (PKR)', 'Sold a month (PKR)', 'Revenue per seat (PKR)',
      'Rent not earned a month (PKR)', 'Seats in the period (%)', 'Days occupied in the period (%)'],
    ...d.rooms.map(r => [r.name, r.code, r.location, r.spaceType, r.seats, r.seatsSold, r.emptySeats, pct1(r.seatOccupancyPct), r.seats247,
      r.seatsMorning, r.seatsEvening, r.oneShiftSeats, r.bookingsNow, r.occupiedNow ? 'Yes' : 'No', money2(r.listSeatPrice),
      money2(r.soldMonthly), money2(r.revenuePerSeat), money2(r.rentNotEarned), pct1(r.periodSeatOccupancyPct), pct1(r.periodRoomOccupancyPct)])
  ];

  const months: XlsxCell[][] = [
    ['Month', 'Rooms', 'Rooms occupied', 'Room occupancy (%)', 'Seats', 'Seats sold', 'Seat occupancy (%)', 'Gap (points)'],
    ...d.months.map(m => [m.month, m.rooms, m.roomsOccupied, pct1(m.roomOccupancyPct), m.seats, m.seatsSold, pct1(m.seatOccupancyPct),
      pct1(m.roomOccupancyPct - m.seatOccupancyPct)])
  ];

  return [
    { name: 'Seats', header: 1, rows },
    { name: 'Seats by room', rows: rooms },
    { name: 'Seats 12 months', rows: months }
  ];
}

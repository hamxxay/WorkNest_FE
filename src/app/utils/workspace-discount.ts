export type BookingLike = {
  startDateTime?: string;
  endDateTime?: string;
  bookingStatus?: string;
};

export type WorkspaceDiscount = {
  percent: number;
  label: string;
  totalBookedDays: number;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function safeDate(value?: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isCountableStatus(status?: string): boolean {
  const s = (status ?? '').toLowerCase();
  if (!s) return true;
  return !['cancelled', 'canceled', 'rejected'].includes(s);
}

export function sumBookedDays(bookings: BookingLike[]): number {
  let total = 0;
  for (const b of bookings) {
    if (!isCountableStatus(b.bookingStatus)) continue;
    const start = safeDate(b.startDateTime);
    const end = safeDate(b.endDateTime);
    if (!start || !end) continue;
    const diffMs = end.getTime() - start.getTime();
    if (diffMs <= 0) continue;
    total += diffMs / MS_PER_DAY;
  }
  return total;
}

/**
 * Loyalty discount tiers:
 * - >= 365 days booked → 50% discount (1 year loyalty)
 * - >= 90 days booked  → 10% discount (3 months loyalty)
 * - < 90 days          → no discount
 */
export function getWorkspaceDiscount(bookings: BookingLike[]): WorkspaceDiscount {
  const totalBookedDays = sumBookedDays(bookings);

  if (totalBookedDays >= 365) {
    return { percent: 50, label: '50% loyalty discount (1 year)', totalBookedDays };
  }

  if (totalBookedDays >= 90) {
    return { percent: 10, label: '10% loyalty discount (3 months)', totalBookedDays };
  }

  return { percent: 0, label: 'No discount', totalBookedDays };
}

export function applyPercentDiscount(amount: number, percent: number): number {
  const a = Number.isFinite(amount) ? amount : 0;
  const p = Number.isFinite(percent) ? percent : 0;
  return Math.max(0, a * (1 - p / 100));
}

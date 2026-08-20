// Centralised role and option definitions — single source of truth.
// Update here when new roles are added to the system.

export const ASSIGNABLE_ROLES: { v: string; l: string }[] = [
  { v: 'super_admin', l: 'Super Admin' },
  { v: 'admin',       l: 'Admin' },
  { v: 'general',     l: 'General User' },
];

export const BILLING_CYCLES: { v: string; l: string }[] = [
  { v: 'Monthly',   l: 'Monthly' },
  { v: 'Quarterly', l: 'Quarterly' },
  { v: 'Yearly',    l: 'Yearly' },
];

/** Allowed billing period values (months). Used in Quotation and Booking forms. */
export const BILLING_PERIOD_OPTIONS: { v: number; l: string }[] = [
  { v: 1, l: '1 Month' },
  { v: 2, l: '2 Months' },
  { v: 3, l: '3 Months' },
  { v: 6, l: '6 Months' },
];

// Amount field labels are stored in the DB (WN_AmountFields table).
// Use AmountFieldService.getLabelMap() to get a Record<'Entity.field', label>
// and reference via amountLabels['Entity.field'] in templates.

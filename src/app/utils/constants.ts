// Centralised role and option definitions — single source of truth.
// Update here when new roles are added to the system.

export const ASSIGNABLE_ROLES: { v: string; l: string }[] = [
  { v: 'super_admin',     l: 'Super Admin' },
  { v: 'admin',           l: 'Admin' },
  { v: 'general',         l: 'General User' },
  { v: 'sales_executive', l: 'Sales Executive' },
  // Sees every location on the CEO dashboard, view only. Only a Super Admin can give this role.
  { v: 'ceo',             l: 'CEO' },
  // Sees the sales dashboard for their own location(s), view only. Only a Super Admin can give this role.
  { v: 'sales_manager',   l: 'Sales Manager' },
  // Gives and removes door access by CNIC (Access page) at their own location(s). Only a Super Admin can give this role.
  { v: 'access_officer',  l: 'Access Officer' },
  // Full access to network configuration and monitoring at their own location(s). Only a Super Admin can give this role.
  { v: 'network_engineer', l: 'Network Engineer' },
];

/**
 * Fallback label for a role name ("sales_executive" -> "Sales Executive"). The real labels come from the
 * database (auth/me roleDisplayName, GET api/roles); this is only used when the API sent none.
 */
export function roleLabelFor(role: string | null | undefined): string {
  const key = String(role ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  const known = ASSIGNABLE_ROLES.find(r => r.v.replace(/_/g, '') === key);
  if (known) return known.l;
  return String(role ?? '').replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

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

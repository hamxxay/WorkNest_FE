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

// Amount field labels are stored in the DB (WN_AmountFields table).
// Use AmountFieldService.getLabelMap() to get a Record<'Entity.field', label>
// and reference via amountLabels['Entity.field'] in templates.

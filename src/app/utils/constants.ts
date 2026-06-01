// Centralised role and option definitions — single source of truth.
// Update here when new roles are added to the system.

export const ASSIGNABLE_ROLES: { v: string; l: string }[] = [
  { v: 'Admin',        l: 'Admin' },
  { v: 'Receptionist', l: 'Receptionist' },
  { v: 'Public',       l: 'Public' },
];

export const BILLING_CYCLES: { v: string; l: string }[] = [
  { v: 'Monthly',   l: 'Monthly' },
  { v: 'Quarterly', l: 'Quarterly' },
  { v: 'Yearly',    l: 'Yearly' },
];

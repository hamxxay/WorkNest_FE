import { inject } from '@angular/core';
import { Router, CanActivateFn, CanActivateChildFn } from '@angular/router';
import { AuthService } from '../services/auth.service';

/**
 * Admin routes a sales executive may open. Single source of truth for the guard
 * and the sidebar (admin-layout) so the two never drift apart.
 */
export const SALES_EXECUTIVE_ROUTES: string[] = [
  '/admin',            // Dashboard (sidebar item). Matched exactly, so it does not open every /admin/* page.
  '/admin/dashboard',
  '/admin/profile',
  '/admin/kyc',
  '/admin/quotations',
  '/admin/agreements',
  '/admin/lease-templates',
  '/admin/invoices',
  '/admin/bookings',
  '/admin/attendants',
  '/admin/staff-access',
  '/admin/biometric-users',
  '/admin/machine-users',
  '/admin/contacts',
  '/admin/quotation-responses',
  '/admin/network',
  '/admin/network/clients',
  '/admin/network/devices',
  '/admin/network/internet',
  '/admin/network/wifi'
];

/** True when `url` is one of the allowed routes or a child of one (query/fragment ignored). */
export function isSalesExecutiveUrl(url: string): boolean {
  const path = url.split(/[?#]/)[0];
  return SALES_EXECUTIVE_ROUTES.some(p => path === p || (p !== '/admin' && path.startsWith(p + '/')));
}

// Used as both canActivate and canActivateChild on the /admin parent, so every
// navigation between admin child routes is re-checked.
export const adminGuard: CanActivateFn & CanActivateChildFn = (_route, state) => {
  const router = inject(Router);
  const auth = inject(AuthService);

  if (!auth.isAuthenticated()) {
    return router.createUrlTree(['/login'], { queryParams: { redirect: state.url } });
  }

  const isSalesExecutive = auth.hasRole('sales_executive');
  const isAdmin = auth.hasRole('admin') || auth.hasRole('super_admin');

  if (isSalesExecutive && !isAdmin) {
    if (isSalesExecutiveUrl(state.url)) {
      return true;
    }
    return router.createUrlTree(['/admin/dashboard']);
  }

  if (isAdmin) {
    return true;
  }

  return router.createUrlTree(['/unauthorized']);
};

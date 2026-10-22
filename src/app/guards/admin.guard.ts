import { inject } from '@angular/core';
import { Router, CanActivateFn, CanActivateChildFn, UrlTree } from '@angular/router';
import { map } from 'rxjs';
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
  '/admin/invoices',
  '/admin/invoice-approvals',
  '/admin/fee-receipts',
  '/admin/bookings',
  '/admin/attendants',
  '/admin/biometric-users',
  '/admin/machine-users',
  '/admin/contacts',
  '/admin/complaints',
  '/admin/whatsapp',
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

/** The only admin page a CEO may open (the CEO dashboard). Shared with ceoGuard and the sidebar. */
export const CEO_HOME = '/admin/ceo';

/** True for the CEO dashboard (query/fragment ignored). */
export function isCeoUrl(url: string): boolean {
  const path = url.split(/[?#]/)[0];
  return path === CEO_HOME || path.startsWith(CEO_HOME + '/');
}

/** The only admin page a Sales Manager may open (the sales dashboard). Shared with salesManagerGuard and the sidebar. */
export const SALES_MANAGER_HOME = '/admin/sales-manager';

/** True for the sales dashboard (query/fragment ignored). */
export function isSalesManagerUrl(url: string): boolean {
  const path = url.split(/[?#]/)[0];
  return path === SALES_MANAGER_HOME || path.startsWith(SALES_MANAGER_HOME + '/');
}

/** The only admin page an Access Officer may open (door access by CNIC). Shared with accessOfficerGuard and the sidebar. */
export const ACCESS_OFFICER_HOME = '/admin/access';

/** True for the Access page (query/fragment ignored). */
export function isAccessOfficerUrl(url: string): boolean {
  const path = url.split(/[?#]/)[0];
  return path === ACCESS_OFFICER_HOME || path.startsWith(ACCESS_OFFICER_HOME + '/');
}

// Used as both canActivate and canActivateChild on the /admin parent, so every
// navigation between admin child routes is re-checked.
export const adminGuard: CanActivateFn & CanActivateChildFn = (_route, state) => {
  const router = inject(Router);
  const auth = inject(AuthService);

  if (!auth.isAuthenticated()) {
    return router.createUrlTree(['/login'], { queryParams: { redirect: state.url } });
  }

  const decide = (): boolean | UrlTree => {
    const isSalesExecutive = auth.hasRole('sales_executive');
    const isAdmin = auth.hasRole('admin') || auth.hasRole('super_admin');

    // A CEO sees the CEO dashboard and nothing else: every other admin page sends them back to it.
    if (auth.isCeoOnly()) {
      return isCeoUrl(state.url) ? true : router.createUrlTree([CEO_HOME]);
    }

    // Same for a Sales Manager: the sales dashboard only.
    if (auth.isSalesManagerOnly()) {
      return isSalesManagerUrl(state.url) ? true : router.createUrlTree([SALES_MANAGER_HOME]);
    }

    // Same for an Access Officer: the Access page only.
    if (auth.isAccessOfficerOnly()) {
      return isAccessOfficerUrl(state.url) ? true : router.createUrlTree([ACCESS_OFFICER_HOME]);
    }

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

  if (auth.rolesVerified()) {
    return decide();
  }

  // Roles came from localStorage only: confirm them with auth/me before opening an admin page.
  return auth.verifyRoles$().pipe(
    map(verified => verified ? decide() : router.createUrlTree(['/unauthorized']))
  );
};

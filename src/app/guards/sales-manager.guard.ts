import { inject } from '@angular/core';
import { Router, CanActivateFn, UrlTree } from '@angular/router';
import { map } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { ACCESS_OFFICER_HOME, CEO_HOME } from './admin.guard';

/**
 * Sales dashboard (/admin/sales-manager): the Sales Manager, and super admins (who may check what a manager
 * sees). A CEO goes to the CEO dashboard; admins and sales executives to their own dashboard. Runs after
 * adminGuard, which already keeps a Sales Manager on this page and nowhere else.
 */
export const salesManagerGuard: CanActivateFn = (_route, state) => {
  const router = inject(Router);
  const auth = inject(AuthService);

  if (!auth.isAuthenticated()) {
    return router.createUrlTree(['/login'], { queryParams: { redirect: state.url } });
  }

  const decide = (): boolean | UrlTree => {
    if (auth.hasRole('super_admin') || auth.isSalesManagerOnly()) return true;
    if (auth.isCeoOnly()) return router.createUrlTree([CEO_HOME]);
    if (auth.isAccessOfficerOnly()) return router.createUrlTree([ACCESS_OFFICER_HOME]);
    if (auth.hasRole('admin') || auth.hasRole('sales_executive')) return router.createUrlTree(['/admin/dashboard']);
    return router.createUrlTree(['/unauthorized']);
  };

  if (auth.rolesVerified()) {
    return decide();
  }

  // Roles came from localStorage only: confirm them with auth/me first.
  return auth.verifyRoles$().pipe(
    map(verified => verified ? decide() : router.createUrlTree(['/unauthorized']))
  );
};

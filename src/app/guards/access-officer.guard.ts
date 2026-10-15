import { inject } from '@angular/core';
import { Router, CanActivateFn, UrlTree } from '@angular/router';
import { map } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { CEO_HOME, SALES_MANAGER_HOME } from './admin.guard';

/**
 * Access page (/admin/access, door access by CNIC): the Access Officer, and super admins (who may use it too).
 * A CEO / Sales Manager goes to their dashboard; admins and sales executives to their own dashboard. Runs after
 * adminGuard, which already keeps an Access Officer on this page and nowhere else.
 */
export const accessOfficerGuard: CanActivateFn = (_route, state) => {
  const router = inject(Router);
  const auth = inject(AuthService);

  if (!auth.isAuthenticated()) {
    return router.createUrlTree(['/login'], { queryParams: { redirect: state.url } });
  }

  const decide = (): boolean | UrlTree => {
    if (auth.hasRole('super_admin') || auth.isAccessOfficerOnly()) return true;
    if (auth.isCeoOnly()) return router.createUrlTree([CEO_HOME]);
    if (auth.isSalesManagerOnly()) return router.createUrlTree([SALES_MANAGER_HOME]);
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

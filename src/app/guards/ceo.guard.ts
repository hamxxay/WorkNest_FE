import { inject } from '@angular/core';
import { Router, CanActivateFn, UrlTree } from '@angular/router';
import { map } from 'rxjs';
import { AuthService } from '../services/auth.service';

/**
 * CEO dashboard (/admin/ceo): the CEO, and super admins (who may check what the CEO sees).
 * Admins and sales executives go back to their own dashboard. Runs after adminGuard, which already
 * keeps a CEO on this page and nowhere else.
 */
export const ceoGuard: CanActivateFn = (_route, state) => {
  const router = inject(Router);
  const auth = inject(AuthService);

  if (!auth.isAuthenticated()) {
    return router.createUrlTree(['/login'], { queryParams: { redirect: state.url } });
  }

  const decide = (): boolean | UrlTree => {
    if (auth.hasRole('ceo') || auth.hasRole('super_admin')) return true;
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

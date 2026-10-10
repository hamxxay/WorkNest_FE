import { inject } from '@angular/core';
import { Router, CanActivateFn, UrlTree } from '@angular/router';
import { map } from 'rxjs';
import { AuthService } from '../services/auth.service';

export const superAdminGuard: CanActivateFn = (route, state) => {
  const router = inject(Router);
  const auth   = inject(AuthService);

  if (!auth.isAuthenticated()) {
    return router.createUrlTree(['/login'], { queryParams: { redirect: state.url } });
  }

  const decide = (): boolean | UrlTree =>
    auth.hasRole('super_admin') || auth.hasRole('superadmin')
      ? true
      : router.createUrlTree(['/unauthorized']);

  if (auth.rolesVerified()) {
    return decide();
  }

  // Roles came from localStorage only: confirm them with auth/me first.
  return auth.verifyRoles$().pipe(
    map(verified => verified ? decide() : router.createUrlTree(['/unauthorized']))
  );
};

import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const superAdminGuard: CanActivateFn = (route, state) => {
  const router = inject(Router);
  const auth   = inject(AuthService);

  if (!auth.isAuthenticated()) {
    return router.createUrlTree(['/login'], { queryParams: { redirect: state.url } });
  }

  if (auth.hasRole('super_admin') || auth.hasRole('superadmin')) {
    return true;
  }

  return router.createUrlTree(['/unauthorized']);
};

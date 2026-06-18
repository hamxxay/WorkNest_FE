import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const adminGuard: CanActivateFn = (route, state) => {
  const router = inject(Router);
  const auth = inject(AuthService);

  if (!auth.isAuthenticated()) {
    return router.createUrlTree(['/login'], { queryParams: { redirect: state.url } });
  }

  if (auth.hasRole('Admin') || auth.hasRole('admin') || auth.hasRole('super_admin') || auth.hasRole('superadmin')) {
    return true;
  }

  return router.createUrlTree(['/unauthorized']);
};

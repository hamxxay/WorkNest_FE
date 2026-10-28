import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const userGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.isAuthenticated() && auth.hasRole('admin')) {
    return router.createUrlTree(['/admin']);
  }
  // A CEO only uses the CEO dashboard (no customer pages).
  if (auth.isAuthenticated() && auth.isCeoOnly()) {
    return router.createUrlTree(['/admin/ceo']);
  }
  // A Sales Manager only uses the sales dashboard.
  if (auth.isAuthenticated() && auth.isSalesManagerOnly()) {
    return router.createUrlTree(['/admin/sales-manager']);
  }
  // An Access Officer only uses the Access page.
  if (auth.isAuthenticated() && auth.isAccessOfficerOnly()) {
    return router.createUrlTree(['/admin/access']);
  }
  // A Network Engineer only uses the Network pages.
  if (auth.isAuthenticated() && auth.isNetworkEngineerOnly()) {
    return router.createUrlTree(['/admin/network']);
  }
  return true;
};

import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const adminGuard: CanActivateFn = (route, state) => {
  const router = inject(Router);
  const auth = inject(AuthService);

  if (!auth.isAuthenticated()) {
    return router.createUrlTree(['/login'], { queryParams: { redirect: state.url } });
  }

  const isSalesExecutive = auth.hasRole('sales_executive');
  const isAdmin = auth.hasRole('admin') || auth.hasRole('super_admin');

  if (isSalesExecutive && !isAdmin) {
    const allowed = ['/admin/quotations', '/admin/invoices', '/admin/bookings', '/admin/attendants', '/admin/contacts', '/admin/challan-validity'];
    if (allowed.some(p => state.url.startsWith(p))) {
      return true;
    }
    return router.createUrlTree(['/admin/quotations']);
  }

  if (isAdmin) {
    return true;
  }

  return router.createUrlTree(['/unauthorized']);
};

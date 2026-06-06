import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const checkoutGuard: CanActivateFn = (route) => {
  const router = inject(Router);
  const auth   = inject(AuthService);

  if (!auth.isAuthenticated()) {
    return router.createUrlTree(['/login'], {
      queryParams: { redirect: `/checkout/${route.paramMap.get('bookingId')}` }
    });
  }

  const id = Number(route.paramMap.get('bookingId'));
  if (!id || isNaN(id)) {
    return router.createUrlTree(['/my-bookings']);
  }

  return true;
};

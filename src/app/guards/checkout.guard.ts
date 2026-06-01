import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { BookingService } from '../services/booking.service';

export const checkoutGuard: CanActivateFn = (route) => {
  const router   = inject(Router);
  const auth     = inject(AuthService);
  const bookings = inject(BookingService);

  if (!auth.isAuthenticated()) {
    return router.createUrlTree(['/login'], {
      queryParams: { redirect: `/checkout/${route.paramMap.get('bookingId')}` }
    });
  }

  const id = Number(route.paramMap.get('bookingId'));
  if (!id || isNaN(id)) {
    return router.createUrlTree(['/my-bookings']);
  }

  return bookings.getById(id).pipe(
    map((res: any) => {
      const d = res?.data;
      const booking = d && !Array.isArray(d) && typeof d === 'object' && !d.items
        ? d
        : res?.booking ?? res;

      if (!booking?.id) return router.createUrlTree(['/my-bookings']);

      // Only block if booking is explicitly NOT pending.
      // Ownership is enforced by the backend — a 403 from getById
      // is caught below and lets the checkout component show the error.
      const status = (booking.bookingStatus ?? booking.status ?? '').toLowerCase();
      if (status && status !== 'pending') {
        return router.createUrlTree(['/my-bookings']);
      }

      return true;
    }),
    catchError(() => of(true))
  );
};

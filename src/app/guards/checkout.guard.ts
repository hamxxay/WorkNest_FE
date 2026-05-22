// ============================================================
// Checkout Guard
// ============================================================
// Prevents users from accessing /checkout/:bookingId directly
// unless:
//   1. They are authenticated
//   2. The booking exists and belongs to them
//   3. The booking status is still Pending (not already paid)
//
// This closes the loophole where someone could guess a booking
// ID in the URL and land on another user's checkout page.
// ============================================================

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
      const booking = res?.data;

      // Booking must exist
      if (!booking) return router.createUrlTree(['/my-bookings']);

      // Booking must belong to the logged-in user
      const currentUserId = auth.getUser()?.userId;
      if (booking.userId && currentUserId && String(booking.userId) !== String(currentUserId)) {
        return router.createUrlTree(['/my-bookings']);
      }

      // Booking must still be Pending — no re-paying a completed booking
      const status = (booking.bookingStatus || '').toLowerCase();
      if (status !== 'pending') {
        return router.createUrlTree(['/my-bookings']);
      }

      return true;
    }),
    catchError(() => of(router.createUrlTree(['/my-bookings'])))
  );
};

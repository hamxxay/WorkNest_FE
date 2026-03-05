import { Routes } from '@angular/router';
import { authGuard } from '../guards/auth.guard';

export const USER_ROUTES: Routes = [

  {
    path: 'booking',
    loadComponent: () => import('./booking/booking').then(m => m.Booking),
    canActivate: [authGuard]
  },

  {
    path: 'my-bookings',
    loadComponent: () => import('./my-bookings/my-bookings').then(m => m.MyBookings),
    canActivate: [authGuard]
  },

  {
    path: 'my-payments',
    loadComponent: () => import('./my-payments/my-payments').then(m => m.MyPayments),
    canActivate: [authGuard]
  }

];
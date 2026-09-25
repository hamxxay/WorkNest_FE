import { Routes } from '@angular/router';
import { authGuard } from '../guards/auth.guard';
import { userGuard } from '../guards/user.guard';

export const USER_ROUTES: Routes = [

  // {
  //   path: 'booking',
  //   loadComponent: () => import('./booking/booking').then(m => m.Booking),
  //   canActivate: [authGuard, userGuard]
  // },

  {
    path: 'checkout',
    loadComponent: () => import('./checkout/checkout').then(m => m.Checkout),
    canActivate: [authGuard, userGuard]
  },

  {
    path: 'payment-result',
    loadComponent: () => import('./payment-result/payment-result').then(m => m.PaymentResult),
    canActivate: [authGuard, userGuard]
  },

  {
    path: 'my-bookings',
    loadComponent: () => import('./my-bookings/my-bookings').then(m => m.MyBookings),
    canActivate: [authGuard, userGuard]
  },

  {
    path: 'my-payments',
    loadComponent: () => import('./my-payments/my-payments').then(m => m.MyPayments),
    canActivate: [authGuard, userGuard]
  },
  {
    path: 'my-meeting-rooms',
    loadComponent: () => import('./my-meeting-rooms/my-meeting-rooms').then(m => m.MyMeetingRooms),
    canActivate: [authGuard, userGuard]
  },
  {
    path: 'my-quotations',
    loadComponent: () => import('./my-quotations/my-quotations').then(m => m.MyQuotations),
    canActivate: [authGuard, userGuard]
  },
  {
    path: 'quotation/:id',
    loadComponent: () => import('./my-quotations/my-quotations').then(m => m.MyQuotations)
  }
];

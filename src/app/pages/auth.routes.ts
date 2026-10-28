import { toPublicSiteGuard } from '../utils/public-site';
import { Routes } from '@angular/router';

export const AUTH_ROUTES: Routes = [

  {
    path: 'login',
    loadComponent: () => import('./login/login').then(m => m.Login),
    data: { layout: 'auth' }
  },

  {
    // Signed in on worknestpk.com as staff: arrives with a one-time code (#code=...) and lands on the dashboard.
    path: 'auth/handoff',
    loadComponent: () => import('./auth-handoff/auth-handoff').then(m => m.AuthHandoff),
    data: { layout: 'auth' }
  },

  {
    path: 'signup',
    loadComponent: () => import('./signup/signup').then(m => m.Signup),
    canActivate: [toPublicSiteGuard], // customers sign up on worknestpk.com
    data: { layout: 'auth' }
  }

];
import { Routes } from '@angular/router';

export const AUTH_ROUTES: Routes = [

  {
    path: 'login',
    loadComponent: () => import('./login/login').then(m => m.Login),
    data: { layout: 'auth' }
  },

  {
    path: 'signup',
    loadComponent: () => import('./signup/signup').then(m => m.Signup),
    data: { layout: 'auth' }
  }

];
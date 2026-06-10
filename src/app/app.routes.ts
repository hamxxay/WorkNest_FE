import { Routes } from '@angular/router';

export const routes: Routes = [

  { path: '', loadChildren: () => import('./pages/public.routes').then(m => m.PUBLIC_ROUTES) },

  { path: '', loadChildren: () => import('./pages/auth.routes').then(m => m.AUTH_ROUTES) },

  { path: '', loadChildren: () => import('./pages/user.routes').then(m => m.USER_ROUTES) },

  { path: '**', redirectTo: '' }

];

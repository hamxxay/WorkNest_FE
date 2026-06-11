import { Routes } from '@angular/router';
import { adminGuard } from './guards/admin.guard';

export const routes: Routes = [

  { path: '', loadChildren: () => import('./pages/public.routes').then(m => m.PUBLIC_ROUTES) },

  { path: '', loadChildren: () => import('./pages/auth.routes').then(m => m.AUTH_ROUTES) },

  { path: '', loadChildren: () => import('./pages/user.routes').then(m => m.USER_ROUTES) },

  {
    path: 'admin',
    loadComponent: () => import('./pages/admin/layout/admin-layout').then(m => m.AdminLayout),
    canActivate: [adminGuard],
    data: { layout: 'admin' },
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
      { path: 'dashboard', loadComponent: () => import('./pages/admin/dashboard/dashboard').then(m => m.Dashboard) },
      { path: 'users',       loadComponent: () => import('./pages/admin/manage/manage').then(m => m.Manage), data: { entity: 'users' } },
      { path: 'locations',   loadComponent: () => import('./pages/admin/manage/manage').then(m => m.Manage), data: { entity: 'locations' } },
      { path: 'spacetypes',  loadComponent: () => import('./pages/admin/manage/manage').then(m => m.Manage), data: { entity: 'spacetypes' } },
      { path: 'spaces',      loadComponent: () => import('./pages/admin/manage/manage').then(m => m.Manage), data: { entity: 'spaces' } },
      { path: 'bookings',    loadComponent: () => import('./pages/admin/manage/manage').then(m => m.Manage), data: { entity: 'bookings' } },
      { path: 'pricing',     loadComponent: () => import('./pages/admin/manage/manage').then(m => m.Manage), data: { entity: 'pricing' } },
      { path: 'payments',    loadComponent: () => import('./pages/admin/manage/manage').then(m => m.Manage), data: { entity: 'payments' } },
      { path: 'contacts',    loadComponent: () => import('./pages/admin/manage/manage').then(m => m.Manage), data: { entity: 'contacts' } },
      { path: 'gallery',     loadComponent: () => import('./pages/admin/manage/manage').then(m => m.Manage), data: { entity: 'gallery' } },
    ]
  },

  { path: 'unauthorized', loadComponent: () => import('./pages/unauthorized/unauthorized').then(m => m.Unauthorized) },

  { path: '**', redirectTo: '' }

];

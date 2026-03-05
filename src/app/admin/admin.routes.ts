import { Routes } from '@angular/router';
import { adminGuard } from '../guards/admin.guard';

export const ADMIN_ROUTES: Routes = [

  {
    path: '',
    loadComponent: () => import('./layout/admin-layout')
      .then(m => m.AdminLayout),
    canActivate: [adminGuard],
    data: { layout: 'admin' },

    children: [

      {
        path: '',
        loadComponent: () => import('./dashboard/dashboard')
          .then(m => m.AdminDashboard)
      },

      { path: 'users', loadComponent: () => import('./manage/manage').then(m => m.AdminManage), data: { entity: 'users' } },
      { path: 'locations', loadComponent: () => import('./manage/manage').then(m => m.AdminManage), data: { entity: 'locations' } },
      { path: 'space-types', loadComponent: () => import('./manage/manage').then(m => m.AdminManage), data: { entity: 'space-types' } },
      { path: 'spaces', loadComponent: () => import('./manage/manage').then(m => m.AdminManage), data: { entity: 'spaces' } },
      { path: 'bookings', loadComponent: () => import('./manage/manage').then(m => m.AdminManage), data: { entity: 'bookings' } },
      { path: 'pricing', loadComponent: () => import('./manage/manage').then(m => m.AdminManage), data: { entity: 'pricing' } },
      { path: 'memberships', loadComponent: () => import('./manage/manage').then(m => m.AdminManage), data: { entity: 'memberships' } },
      { path: 'payments', loadComponent: () => import('./manage/manage').then(m => m.AdminManage), data: { entity: 'payments' } },
      { path: 'contacts', loadComponent: () => import('./manage/manage').then(m => m.AdminManage), data: { entity: 'contacts' } },
      { path: 'gallery', loadComponent: () => import('./manage/manage').then(m => m.AdminManage), data: { entity: 'gallery' } }

    ]
  }

];
// ============================================================
// Root Application Routes
// ============================================================

import { Routes } from '@angular/router';

export const routes: Routes = [

  // ============= PUBLIC ROUTES =============
  {
    path: '',
    loadChildren: () => import('./pages/public.routes')
      .then(m => m.PUBLIC_ROUTES)
  },

  // ============= AUTH ROUTES =============
  {
    path: '',
    loadChildren: () => import('./pages/auth.routes')
      .then(m => m.AUTH_ROUTES)
  },

  // ============= USER PROTECTED ROUTES =============
  {
    path: '',
    loadChildren: () => import('./pages/user.routes')
      .then(m => m.USER_ROUTES)
  },

  // ============= ADMIN ROUTES =============
  {
    path: 'admin',
    loadChildren: () => import('./admin/admin.routes')
      .then(m => m.ADMIN_ROUTES)
  },

  // ============= WILDCARD =============
  { path: '**', redirectTo: '' }

];
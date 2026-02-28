// ============================================================
// Admin Guard
// ============================================================
// This guard protects admin routes and ensures strict role-based access.
// Relies on the `user` signal that is initialized via the auth service
// bootstrap (see app.config). It checks:
// 1. If the user is authenticated (has user info stored)
// 2. If the user has the 'Admin' role
//
// If either check fails, the user is redirected accordingly.

import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';

// CanActivateFn guard for admin routes
export const adminGuard: CanActivateFn = (route, state) => {
  const router = inject(Router);
  const authService = inject(AuthService);
  
  // verify authentication status first
  if (!authService.isAuthenticated()) {
    router.navigate(['/login']);
    return false;
  }

  // verify admin role
  if (!authService.hasRole('Admin')) {
    router.navigate(['/']);
    return false;
  }

  return true;
};

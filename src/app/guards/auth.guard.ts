// ============================================================
// Auth Guard
// ============================================================
// This guard protects routes that require user authentication.
// It depends on AuthService.user signal which is populated via the
// `loadSession()` bootstrap called during app initialization. If the
// signal is null (session not loaded or expired) the user will be
// redirected to the login page.

import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';

// CanActivateFn is a function-based guard that returns boolean or UrlTree
export const authGuard: CanActivateFn = (route, state) => {
  const router = inject(Router);
  const authService = inject(AuthService);

  if (!authService.isAuthenticated()) {
    return router.createUrlTree(['/login'], {
      queryParams: { redirect: state.url }
    });
  }

  return true;
};
 

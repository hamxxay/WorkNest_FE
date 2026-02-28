// ============================================================
// HTTP Auth Interceptor
// ============================================================
// This interceptor is applied to all HTTP requests in the application.
// It performs two main functions:
// 1. Automatically attaches JWT token to Authorization header
// 2. Handles 401 (Unauthorized) errors by clearing token and redirecting to login

import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';

// HttpInterceptorFn is a function-based interceptor in Angular 15+
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);
  const authService = inject(AuthService);

  // With cookie-based sessions we must ask the browser to include
  // credentials on cross-site requests. Clone the request with the
  // appropriate flag so the cookie is sent along to the API origin.
  const requestWithCreds = req.clone({ withCredentials: true });

  // Note: we no longer attach an Authorization header. The cookie
  // itself is HttpOnly and will be transmitted automatically.

  // Handle the HTTP request and any errors
  return next(requestWithCreds).pipe(
    // Catch any errors from the HTTP response
    catchError((error: HttpErrorResponse) => {
      if (error.status === 401) {
        // always clear in-memory auth state
        authService.logout();
        // but only redirect if this was not the session probe, logout call,
        // or another public endpoint. adjust patterns as needed.
        const url = req.url || '';
        if (!url.includes('/auth/me') && !url.includes('/auth/logout') && !url.includes('/public')) {
          // protected resource failed; send user to login
          router.navigate(['/login']);
        }
      }
      // Re-throw the error so it can be handled by the calling component
      return throwError(() => error);
    })
  );
};

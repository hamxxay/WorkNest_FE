// ============================================================
// HTTP Auth Interceptor
// ============================================================
// This interceptor is applied to all HTTP requests in the application.
// It performs two main functions:
// 1. Automatically attaches JWT token to Authorization header
// 2. Handles 401 (Unauthorized) errors by clearing token and redirecting to login
//
// NOTE: On 401 responses from /auth/* endpoints (login, register, me, logout),
// the interceptor clears local state only without attempting server logout
// to prevent recursive unauthorized requests and client destabilization.

import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';

// HttpInterceptorFn is a function-based interceptor in Angular 15+
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);
  const authService = inject(AuthService);
  const token = authService.getToken();

  // With cookie-based sessions we must ask the browser to include
  // credentials on cross-site requests. Clone the request with the
  // appropriate flag so the cookie is sent along to the API origin.
  let requestWithAuth = req.clone({ withCredentials: true });

  // Also support bearer-token APIs.
  if (token) {
    requestWithAuth = requestWithAuth.clone({
      setHeaders: { Authorization: `Bearer ${token}` }
    });
  }

  // Handle the HTTP request and any errors
  return next(requestWithAuth).pipe(
    // Catch any errors from the HTTP response
    catchError((error: HttpErrorResponse) => {
      if (error.status === 401) {
        const url = req.url || '';
        
        // Guard against recursive unauthorized calls on auth endpoints.
        // Do not attempt server-side logout if this error came from:
        // - POST /auth/login
        // - POST /auth/register
        // - GET /auth/me (session probe)
        // - POST /auth/logout (already logging out)
        const isAuthEndpoint = /\/auth\/(login|register|me|logout)/.test(url);
        
        if (isAuthEndpoint) {
          // For auth endpoints: clear local state, skip redirect
          // to allow initial session probe to fail silently.
          authService.clearSession();
        } else {
          // For protected resources: clear state and redirect to login
          authService.clearSession();
          router.navigate(['/login']);
        }
      }
      // Re-throw the error so it can be handled by the calling component
      return throwError(() => error);
    })
  );
};

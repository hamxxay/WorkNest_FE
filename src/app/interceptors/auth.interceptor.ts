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
import { catchError, switchMap, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';

function isAuthRequest(url: string): boolean {
  return /\/auth(?:\/|$)/i.test(url);
}

// HttpInterceptorFn is a function-based interceptor in Angular 15+
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);
  const authService = inject(AuthService);
  return authService.getAccessToken$().pipe(
    switchMap(token => {
      let requestWithAuth = req.clone({ withCredentials: true });

      if (token) {
        requestWithAuth = requestWithAuth.clone({
          setHeaders: { Authorization: `Bearer ${token}` }
        });
      }

      return next(requestWithAuth).pipe(
        catchError((error: HttpErrorResponse) => {
          if (error.status === 401) {
            authService.clearSession();
            if (!isAuthRequest(req.url)) {
              void router.navigate(['/login'], {
                queryParams: { redirect: router.url }
              });
            }
          }

          return throwError(() => error);
        })
      );
    })
  );
};

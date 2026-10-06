import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, switchMap, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';

function isAuthRequest(url: string): boolean {
  return /\/auth(?:\/|$)/i.test(url);
}

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);
  const authService = inject(AuthService);
  return authService.getAccessToken$().pipe(
    switchMap(token => {
      let requestWithAuth = req.clone();

      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      const user = authService.getUser();
      if (user && user.email) {
        headers['X-User-Email'] = user.email;
      }

      if (Object.keys(headers).length > 0) {
        requestWithAuth = requestWithAuth.clone({
          setHeaders: headers
        });
      }

      return next(requestWithAuth).pipe(
        catchError((error: HttpErrorResponse) => {
          if (error.status === 401) {
            const guest = authService.isGuest();
            // Guests keep their guest session (public pages still work) but are sent to sign in
            // when an action needs an account (non-GET) or they are on a protected page, instead
            // of being left on a broken page. A background GET on a public page just fails.
            const sendGuestToLogin = guest && (req.method !== 'GET' || authService.isProtectedUrl(router.url));
            if (!guest) {
              authService.clearSession();
            }
            if ((!guest || sendGuestToLogin) && !isAuthRequest(req.url) && !router.url.startsWith('/login')) {
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

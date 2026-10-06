import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, switchMap, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { ToastService } from '../services/toast.service';

function isAuthRequest(url: string): boolean {
  return /\/auth(?:\/|$)/i.test(url);
}

// Login, sign-up, contact and tour forms already show the API's message on the page.
function showsOwnRateLimitMessage(url: string): boolean {
  return isAuthRequest(url) || /\/api\/(contact|book-tour)(?:\?|$)/i.test(url);
}

// One toast per burst: a page that fires several requests at once should not stack copies.
let lastRateLimitToastAt = 0;

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);
  const authService = inject(AuthService);
  const toastService = inject(ToastService);
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

          if (error.status === 429 && !showsOwnRateLimitMessage(req.url)) {
            // The API's message carries the wait time ("please wait 42 seconds and try again").
            // Callers that show err.error.message inline (login, sign-up) get the same text.
            const now = Date.now();
            if (now - lastRateLimitToastAt > 5000) {
              lastRateLimitToastAt = now;
              toastService.show(
                error.error?.message || 'Too many requests. Please wait a minute and try again.',
                'warning', 'Too many attempts');
            }
          }

          return throwError(() => error);
        })
      );
    })
  );
};

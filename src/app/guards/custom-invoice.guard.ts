import { inject } from '@angular/core';
import { Router, CanActivateFn, UrlTree } from '@angular/router';
import { Observable, catchError, map, of, switchMap } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { CustomInvoiceService, customInvoiceErrorMessage } from '../services/custom-invoice.service';
import { ToastService } from '../services/toast.service';

/**
 * Custom Invoice page (/admin/custom-invoice): super admins always; an admin only when a super admin has given them
 * access (GET api/custom-invoices/access/me says canUse). Everyone else goes back to the dashboard. Runs after
 * adminGuard, which already keeps CEOs, Sales Managers, Access Officers and sales executives off this page.
 * The API checks the same rule on every call; this only keeps people off a page they could not use.
 */
export const customInvoiceGuard: CanActivateFn = (_route, state) => {
  const router = inject(Router);
  const auth = inject(AuthService);
  const api = inject(CustomInvoiceService);
  const toast = inject(ToastService);

  if (!auth.isAuthenticated()) {
    return router.createUrlTree(['/login'], { queryParams: { redirect: state.url } });
  }

  const home = () => router.createUrlTree(['/admin/dashboard']);

  const decide = (): boolean | UrlTree | Observable<boolean | UrlTree> => {
    if (auth.hasRole('super_admin')) return true;
    if (!auth.hasRole('admin')) return home();
    return api.getMyAccess().pipe(
      map(me => {
        if (me.canUse) return true;
        toast.warning('Ask a super admin if you need to create custom invoices.', 'No access to Custom Invoice');
        return home();
      }),
      catchError(err => {
        toast.error(customInvoiceErrorMessage(err, "Your access couldn't be checked. Please try again."), 'Custom Invoice');
        return of(home());
      })
    );
  };

  if (auth.rolesVerified()) {
    return decide();
  }

  // Roles came from localStorage only: confirm them with auth/me first.
  return auth.verifyRoles$().pipe(
    switchMap(verified => {
      if (!verified) return of(router.createUrlTree(['/unauthorized']));
      const result = decide();
      return result instanceof Observable ? result : of(result);
    })
  );
};

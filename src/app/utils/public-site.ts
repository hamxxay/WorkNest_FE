import { CanActivateFn } from '@angular/router';
import { Observable } from 'rxjs';

/**
 * The public website where customers sign in (worknestpk.com). The CMS (cms.worknestpk.com) is for staff only.
 * Running locally, the public site is the WorkNest-MainWeb dev server on port 4300.
 */
export function publicSiteUrl(path = '/'): string {
  const local = typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const base = local ? 'http://localhost:4300' : 'https://worknestpk.com';
  return base + (path.startsWith('/') ? path : '/' + path);
}

/** Customer / public pages on the CMS open the same page on the public website instead. */
export const toPublicSiteGuard: CanActivateFn = (_route, state) => {
  if (typeof window !== 'undefined') window.location.href = publicSiteUrl(state.url);
  return false;
};

/**
 * Customers use worknestpk.com: hands the session over (they arrive there signed in) and ends it here.
 * The token goes after '#', which the browser never sends to a server; the site removes it on arrival.
 */
export function handOffToPublicSite(
  auth: { getToken(): string | null; logout$(options: { keepApiSession?: boolean }): Observable<unknown> },
  landingPath = '/'
): void {
  const token = auth.getToken();
  const url = token
    ? `${publicSiteUrl(landingPath)}#handoff=${encodeURIComponent(token)}`
    : publicSiteUrl('/login');
  const go = () => { window.location.replace(url); };
  // keepApiSession: the token was just handed to worknestpk.com, so only this portal's session ends here.
  auth.logout$({ keepApiSession: true }).subscribe({ next: go, error: go });
}

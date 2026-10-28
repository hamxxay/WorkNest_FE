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
 * Customers use worknestpk.com: sends them there already signed in, and ends the session here (the CMS is staff-only).
 * A one-time code (single use, 60 seconds, for worknestpk.com only) goes after '#' in /auth/handoff, which the browser
 * never sends to a server; the site redeems it for its own session and removes it from the address bar. Without a code
 * (API not updated yet, network error) the customer just gets worknestpk.com's sign-in page, as before.
 */
export function handOffToPublicSite(
  auth: { createHandoffCode$(target: 'web'): Observable<string | null>; logout$(): Observable<unknown> },
  landingPath = '/my-bookings'
): void {
  auth.createHandoffCode$('web').subscribe(code => {
    const url = code
      ? `${publicSiteUrl('/auth/handoff')}#code=${encodeURIComponent(code)}&next=${encodeURIComponent(landingPath)}`
      : publicSiteUrl('/login');
    let gone = false;
    const go = () => { if (!gone) { gone = true; window.location.replace(url); } };
    // A full sign-out (this token is revoked): worknestpk.com gets a new session of its own from the code.
    auth.logout$().subscribe({ next: go, error: go, complete: go });
  });
}

/** The code handed over by the other site (/auth/handoff#code=...), removed from the address bar straight away. */
export function takeHandoffCode(): string | null {
  if (typeof window === 'undefined') return null;
  const match = /(?:^#|&)code=([^&]+)/.exec(window.location.hash || '');
  history.replaceState(history.state, '', window.location.pathname + window.location.search);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]).trim() || null;
  } catch {
    return null;
  }
}

import { CanActivateFn } from '@angular/router';

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

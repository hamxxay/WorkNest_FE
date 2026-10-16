import { Injectable, WritableSignal, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, from, of, throwError } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import {
  AuthError,
  AuthProvider,
  EmailAuthProvider,
  GoogleAuthProvider,
  User,
  UserCredential,
  createUserWithEmailAndPassword,
  getIdTokenResult,
  onAuthStateChanged,
  reload,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  reauthenticateWithCredential,
  updatePassword,
  updateProfile,
} from 'firebase/auth';
import {
  firebaseAuth,
  githubProvider,
  googleProvider,
  isFirebaseConfigured,
} from './firebase';
import { environment } from '../../environments/environment';
import { roleLabelFor } from '../utils/constants';

export interface UserInfo {
  email: string;
  userId: string;
  roles: string[];
  displayName?: string;
  photoURL?: string;
  locationId?: number | null;
  /** All locations an Admin / Sales Executive / Sales Manager / Access Officer is assigned to; locationId is the active one. */
  locationIds?: number[];
  /** The role's name as the database words it (WN_Roles.DisplayName, from auth/me), e.g. "Sales Manager". */
  roleDisplayName?: string;
}

/** Sign-out waits at most this long for POST auth/logout before clearing the session anyway. */
const LOGOUT_API_WAIT_MS = 1500;

export interface AuthResult {
  isSuccessful: boolean;
  message: string;
  data: UserInfo | null;
}

/**
 * Why the API refused a sign-in (HTTP 403 { isSuccessful: false, message, data: { code } } from auth/login,
 * auth/google-login, auth/register and auth/sync).
 * EMAIL_NOT_VERIFIED: the Firebase account's email isn't verified (and it never signed in before 16 Oct 2026).
 * ACCOUNT_DISABLED: the WorkNest account is turned off.
 */
export const EMAIL_NOT_VERIFIED = 'EMAIL_NOT_VERIFIED';
export const ACCOUNT_DISABLED = 'ACCOUNT_DISABLED';
/** The email is still not verified after the user pressed "I've verified" (Firebase reload). */
export const STILL_NOT_VERIFIED = 'STILL_NOT_VERIFIED';
/** There is no Firebase user any more (e.g. signed out in another tab): the user has to sign in again. */
export const SIGNED_OUT = 'SIGNED_OUT';

/** Shown when the API refused without a readable message of its own (same wording as the API). */
const REFUSAL_MESSAGES: Record<string, string> = {
  [EMAIL_NOT_VERIFIED]: 'Please verify your email address first. Open the link we sent you, then sign in again.',
  [ACCOUNT_DISABLED]: 'Your account is turned off. Please contact WorkNest.',
};

/**
 * The code of a failed sign-in, as the pages see it: err.error.code (set by AuthService) or the API's
 * data.code. Null for any other failure.
 */
export function authFailureCode(err: any): string | null {
  const code = err?.error?.code ?? err?.error?.data?.code ?? null;
  return typeof code === 'string' && code ? code : null;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  user: WritableSignal<UserInfo | null> = signal<UserInfo | null>(null);
  /**
   * True only once the API (login/sync response or /auth/me) has returned this user's roles.
   * Roles read from localStorage can be edited by the user, so admin guards wait for this.
   */
  readonly rolesVerified = signal(false);
  private readonly tokenKey = 'wn_token';
  private readonly userKey = 'wn_user';

  constructor(private http: HttpClient) {}

  loadSession(): Observable<UserInfo | null> {
    const cachedUser = localStorage.getItem(this.userKey);
    let parsedCachedUser: UserInfo | null = null;

    if (cachedUser) {
      try {
        parsedCachedUser = JSON.parse(cachedUser) as UserInfo;
        this.user.set(parsedCachedUser);
      } catch {
        this.user.set(null);
      }
    }

    if (!isFirebaseConfigured) {
      return this.hydrateBackendSession$(parsedCachedUser);
    }

    return new Observable<UserInfo | null>(subscriber => {
      const unsubscribe = onAuthStateChanged(
        firebaseAuth,
        async currentUser => {
          if (!currentUser) {
            if (this.getToken() && parsedCachedUser) {
              this.hydrateBackendSession$(parsedCachedUser).subscribe({
                next: userInfo => {
                  subscriber.next(userInfo);
                  subscriber.complete();
                },
                error: () => {
                  subscriber.next(parsedCachedUser);
                  subscriber.complete();
                }
              });
              return;
            }
            if (!this.isGuest()) {
              this.clearSession();
            }
            subscriber.next(this.user());
            subscriber.complete();
            return;
          }

          const firebaseUser = await this.mapFirebaseUser(currentUser);
          const mergedUser = this.mergeUserInfo(firebaseUser, parsedCachedUser);

          this.user.set(mergedUser);
          if (mergedUser) {
            localStorage.setItem(this.userKey, JSON.stringify(mergedUser));
          } else {
            this.clearSession();
          }

          this.hydrateBackendSession$(mergedUser).subscribe({
            next: userInfo => {
              subscriber.next(userInfo);
              subscriber.complete();
            },
            error: error => subscriber.error(error)
          });

          return;
        },
        error => {
          this.user.set(null);
          subscriber.error(error);
        }
      );

      return unsubscribe;
    }).pipe(catchError(() => of(null)));
  }

  loginWithBackendApi$(email: string, password: string): Observable<{
    isSuccessful: boolean;
    message: string;
    data: UserInfo | null;
  }> {
    const payload = { email, password };
    return this.http.post<any>(`${environment.apiUrl}/auth/login`, payload).pipe(
      switchMap(res => {
        if (!res || res.isSuccessful === false || res.isSuccess === false || res.success === false) {
          const msg = res?.message || 'Invalid email or password.';
          return throwError(() => ({ error: { message: msg } }));
        }
        const data = res.data ?? res;
        const token = this.extractToken(res);
        if (token) {
          localStorage.setItem(this.tokenKey, token);
        }
        const roles = this.extractRoles(data, data?.role ? [data.role] : ['customer']);
        const userInfo: UserInfo = {
          email: data?.email || email,
          userId: data?.id || data?.userId || '',
          roles: roles.length ? roles : ['customer'],
          displayName: String(data?.name ?? '').trim() || email.split('@')[0],
          locationId: data?.locationId != null ? Number(data.locationId) : null,
          locationIds: Array.isArray(data?.locationIds) ? data.locationIds.map(Number) : [],
          roleDisplayName: String(data?.roleDisplayName ?? '').trim() || undefined
        };
        localStorage.setItem(this.userKey, JSON.stringify(userInfo));
        this.user.set(userInfo);
        this.rolesVerified.set(true);

        if (isFirebaseConfigured && password && password.length >= 6) {
          signInWithEmailAndPassword(firebaseAuth, email, password)
            .catch(() => createUserWithEmailAndPassword(firebaseAuth, email, password))
            .catch(() => { /* ignore background Firebase sync */ });
        }

        return of({
          isSuccessful: true,
          message: res.message || 'Login successful.',
          data: userInfo
        });
      }),
      catchError(err => {
        const msg = err?.error?.message || err?.message || 'Invalid email or password.';
        // A turned-off account (403 ACCOUNT_DISABLED) keeps its code so the page can tell it apart.
        const code = authFailureCode(err);
        return throwError(() => ({ status: err?.status, error: code ? { message: msg, code } : { message: msg } }));
      })
    );
  }

  /**
   * Email + password sign-in: Firebase, then the API token exchange (auth/login with the Firebase ID token).
   * Any failure falls back to the WorkNest password (auth/login without a token), as before; this also keeps staff
   * whose Firebase email isn't verified signing in. Errors carry err.error.code:
   * - EMAIL_NOT_VERIFIED (the fallback failed too): Firebase stays signed in so the page can send the verification
   *   email (sendVerificationEmail$) and finish with completeEmailVerification$.
   * - ACCOUNT_DISABLED: signed out of Firebase; err.error.message is the API's message.
   */
  login(email: string, password: string): Observable<AuthResult> {
    if (!isFirebaseConfigured) {
      return this.loginWithBackendApi$(email, password);
    }

    return from(signInWithEmailAndPassword(firebaseAuth, email, password)).pipe(
      switchMap(credential => this.syncLoginOrProvisionApi$(credential.user, email, password).pipe(
        map(response => ({ credential, response }))
      )),
      switchMap(({ credential, response }) => this.toAuthSuccess(credential, response)),
      catchError(firebaseError => {
        const firstCode = authFailureCode(firebaseError);
        // A turned-off account is turned off for the password sign-in too.
        if (firstCode === ACCOUNT_DISABLED) {
          return this.refuseSignIn$(firebaseError);
        }
        return this.loginWithBackendApi$(email, password).pipe(
          catchError(backendError => {
            if (authFailureCode(backendError) === ACCOUNT_DISABLED) {
              return this.refuseSignIn$(backendError);
            }
            if (firstCode === EMAIL_NOT_VERIFIED) {
              return this.refuseSignIn$(firebaseError);
            }
            return throwError(() => this.signInFailure(firebaseError, backendError));
          })
        );
      })
    );
  }

  /**
   * Creates the Firebase account and signs in (the API creates the WorkNest account), like a sign-in.
   * When the API wants a verified email first (EMAIL_NOT_VERIFIED, Security:RequireVerifiedEmail on), the verification
   * email is sent instead (verificationRequired: true): the page shows "Check your email" and, once the link was opened,
   * completeEmailVerification$ creates the WorkNest account and signs in.
   * emailSent is false when the account was created but the email could not be sent (the page offers "Resend").
   */
  register(email: string, password: string, firstName?: string, lastName?: string): Observable<AuthResult & {
    verificationRequired: boolean;
    emailSent: boolean;
  }> {
    const displayName = [firstName, lastName].filter(Boolean).join(' ').trim();

    return this.ensureConfigured().pipe(
      switchMap(() => from(createUserWithEmailAndPassword(firebaseAuth, email, password)).pipe(
        catchError(error => throwError(() => this.normalizeAuthError(error)))
      )),
      switchMap(async credential => {
        if (displayName) {
          // The name the API stores when it creates the WorkNest account.
          await updateProfile(credential.user, { displayName }).catch(() => undefined);
        }
        return credential;
      }),
      // Sign in straight away, as a sign-in would. Only when the API wants a verified email first (EMAIL_NOT_VERIFIED,
      // its Security:RequireVerifiedEmail setting) is the verification link sent and "Check your email" shown.
      switchMap(credential => this.syncLoginOrProvisionApi$(credential.user, email, password).pipe(
        switchMap(response => this.toAuthSuccess(credential, response)),
        map(result => ({ ...result, verificationRequired: false, emailSent: false })),
        catchError(error => {
          const code = authFailureCode(error);
          if (code === ACCOUNT_DISABLED) return this.refuseSignIn$(error);
          if (code !== EMAIL_NOT_VERIFIED) {
            const message = String(error?.error?.message ?? '').trim() || 'Your account was created, but signing in failed. Please sign in.';
            return throwError(() => ({ error: { message } }));
          }
          return from(sendEmailVerification(credential.user)).pipe(
            map(() => true),
            catchError(() => of(false)),
            map(emailSent => ({
              isSuccessful: true,
              message: emailSent
                ? `We sent a verification link to ${email}.`
                : 'Your account was created, but we could not send the verification email.',
              data: null,
              verificationRequired: true,
              emailSent
            }))
          );
        })
      ))
    );
  }

  /** The email of the signed-in Firebase user waiting for verification (null when nobody is signed in to Firebase). */
  pendingVerificationEmail(): string | null {
    return (isFirebaseConfigured && firebaseAuth?.currentUser?.email) || null;
  }

  /** Sends (again) Firebase's verification link to the signed-in Firebase user. */
  sendVerificationEmail$(): Observable<void> {
    const user = isFirebaseConfigured ? firebaseAuth?.currentUser : null;
    if (!user) {
      return throwError(() => ({ error: { message: 'Please sign in again to get a new verification email.', code: SIGNED_OUT } }));
    }
    return from(sendEmailVerification(user)).pipe(
      catchError((err: AuthError) => {
        const code = err?.code ?? '';
        if (code === 'auth/user-token-expired' || code === 'auth/user-disabled' || code === 'auth/user-not-found') {
          return throwError(() => ({
            error: { message: 'Please sign in again to get a new verification email.', code: SIGNED_OUT }
          }));
        }
        const message =
          code === 'auth/too-many-requests' ? 'We have sent several emails already. Please wait a few minutes before asking for another one.'
          : code === 'auth/network-request-failed' ? 'Network error while sending the email. Please check your connection and try again.'
          : 'Could not send the verification email. Please try again.';
        return throwError(() => ({ error: { message, code } }));
      })
    );
  }

  /**
   * After the user opened the verification link: reloads the Firebase user, takes a fresh ID token (now with
   * email_verified) and exchanges it with the API the same way the sign-in did (auth/login for email + password,
   * auth/google-login otherwise). Errors carry err.error.code: STILL_NOT_VERIFIED, SIGNED_OUT, ACCOUNT_DISABLED
   * (signed out of Firebase) or EMAIL_NOT_VERIFIED.
   */
  completeEmailVerification$(): Observable<AuthResult> {
    const user = isFirebaseConfigured ? firebaseAuth?.currentUser : null;
    if (!user) {
      return throwError(() => ({ error: { message: 'Please sign in again.', code: SIGNED_OUT } }));
    }

    return from(reload(user)).pipe(
      catchError(() => throwError(() => ({
        error: { message: 'Could not check your email right now. Please try again.' }
      }))),
      switchMap(() => {
        const current = firebaseAuth.currentUser;
        if (!current) {
          return throwError(() => ({ error: { message: 'Please sign in again.', code: SIGNED_OUT } }));
        }
        if (!current.emailVerified) {
          return throwError(() => ({
            error: {
              message: `Your email is not verified yet. Open the link we sent to ${current.email ?? 'your email'}, then press "I've verified" again.`,
              code: STILL_NOT_VERIFIED
            }
          }));
        }
        const viaPassword = current.providerData.some(p => p.providerId === 'password');
        return from(current.getIdToken(true)).pipe(
          switchMap(() => viaPassword
            ? this.syncLoginOrProvisionApi$(current, current.email ?? '', '')
            : this.syncGoogleLoginToApi$(current, null)),
          catchError(error => this.isSignInRefusal(error)
            ? this.refuseSignIn$(error)
            : throwError(() => ({
                error: { message: error?.error?.message || 'Could not sign you in. Please try again.' }
              }))),
          switchMap(response => this.toAuthSuccess({ user: current }, response))
        );
      })
    );
  }

  /** "Back" from the verification screen: signs out of Firebase so the next sign-in starts fresh. */
  cancelEmailVerification$(): Observable<unknown> {
    return this.logout$();
  }

  loginWithGoogle(): Observable<AuthResult> {
    return this.ensureConfigured().pipe(
      switchMap(() => from(signInWithPopup(firebaseAuth, googleProvider))),
      switchMap(credential => {
        const googleCredential = GoogleAuthProvider.credentialFromResult(credential);
        const idToken = googleCredential?.idToken;

        if (!idToken) {
          return this.toAuthSuccess(credential, null);
        }

        return this.syncGoogleLoginToApi$(credential.user, idToken).pipe(
          catchError((err) => {
            // Email not verified / account turned off: say so (never fall back to a session without a token).
            if (this.isSignInRefusal(err)) {
              return this.refuseSignIn$(err);
            }
            console.warn('Google login API sync failed, falling back to /auth/me:', err);
            if (credential.user.email) {
              return this.hydrateBackendSession$({
                email: credential.user.email,
                userId: credential.user.uid,
                roles: []
              }).pipe(
                map(user => user ? { data: user } : null)
              );
            }
            return of(null);
          }),
          switchMap(response => this.toAuthSuccess(credential, response))
        );
      })
    );
  }

  loginWithGithub(): Observable<{
    isSuccessful: boolean;
    message: string;
    data: UserInfo | null;
  }> {
    return this.signInWithProvider(githubProvider);
  }

  resetPassword$(email: string): Observable<void> {
    return this.ensureConfigured().pipe(
      switchMap(() => from(sendPasswordResetEmail(firebaseAuth, email)))
    );
  }

  continueAsGuest(): void {
    const guest: UserInfo = {
      email: '',
      userId: 'guest',
      roles: ['guest'],
      displayName: 'Guest'
    };
    this.user.set(guest);
    this.rolesVerified.set(false);
    localStorage.setItem(this.userKey, JSON.stringify(guest));
  }

  isGuest(): boolean {
    return this.user()?.userId === 'guest';
  }

  clearUserOnly(): void {
    this.user.set(null);
  }

  /**
   * Signs out: first ends the API session (POST auth/logout, so the server revokes this token), then signs out
   * of Firebase and clears the stored session. The API call never blocks sign-out: errors are ignored and it
   * waits for the reply at most LOGOUT_API_WAIT_MS.
   *
   * keepApiSession: only for the hand-over to worknestpk.com (login page), which passes this same token on to
   * the public site; revoking it there would sign the customer straight out again.
   */
  logout$(options: { keepApiSession?: boolean } = {}): Observable<any> {
    const endApiSession$ = options.keepApiSession ? of(null) : this.endApiSession$();
    return endApiSession$.pipe(switchMap(() => this.endLocalSession$()));
  }

  /**
   * POST auth/logout with the current token. Emits once the API answered (or failed) or after LOGOUT_API_WAIT_MS,
   * whichever comes first; the request itself is never cancelled, so a slow reply still reaches the server.
   */
  private endApiSession$(): Observable<null> {
    const token = this.getToken();
    if (!token) return of(null);

    return new Observable<null>(subscriber => {
      const done = () => { subscriber.next(null); subscriber.complete(); };
      const timer = setTimeout(done, LOGOUT_API_WAIT_MS);
      // Sent explicitly (not only by the interceptor) so the call always carries the token being signed out.
      this.http.post(`${environment.apiUrl}/auth/logout`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      }).subscribe({ error: done, complete: done });
      return () => clearTimeout(timer);
    });
  }

  private endLocalSession$(): Observable<any> {
    if (!isFirebaseConfigured) {
      this.clearSession();
      return of(null);
    }

    return from(signOut(firebaseAuth)).pipe(
      map(() => {
        this.clearSession();
        return { isSuccessful: true };
      }),
      catchError(() => {
        this.clearSession();
        return of(null);
      })
    );
  }

  logout(): void {
    this.logout$().subscribe();
  }

  getToken(): string | null {
    return localStorage.getItem(this.tokenKey);
  }

  getAccessToken$(): Observable<string | null> {
    return of(this.getToken());
  }

  /**
   * A real sign-in: the API token is present and the session is not a guest one.
   * Guests (continueAsGuest) can browse public pages but every protected API call
   * needs the token, so they must not pass the route guards.
   */
  /** Pages that need a real sign-in (route guards send guests/anonymous visitors to /login). */
  isProtectedUrl(url: string): boolean {
    return /^\/(my-|checkout|payment-result|admin)/.test(url || '');
  }

  isAuthenticated(): boolean {
    return !!this.getToken() && !this.isGuest();
  }

  getUser(): UserInfo | null {
    return this.user();
  }

  getPostLoginRedirect(): string {
    if (this.isCeoOnly()) {
      return '/admin/ceo';
    }
    if (this.isSalesManagerOnly()) {
      return '/admin/sales-manager';
    }
    if (this.isAccessOfficerOnly()) {
      return '/admin/access';
    }
    if (this.hasRole('sales_executive')) {
      return '/admin/dashboard';
    }
    if (this.hasRole('admin') || this.hasRole('super_admin')) {
      return '/admin';
    }
    return '/dashboard';
  }

  /**
   * A CEO (role "ceo") sees every location but only the CEO dashboard, read-only. Only when the user has no
   * other staff role: a super admin, admin or sales executive keeps their own pages.
   */
  isCeoOnly(): boolean {
    return this.hasRole('ceo')
      && !this.hasRole('super_admin') && !this.hasRole('admin') && !this.hasRole('sales_executive');
  }

  /**
   * A Sales Manager (role "sales_manager") sees only their sales dashboard, read-only, for their own location(s).
   * Only when the user has no other staff role (a CEO keeps the CEO dashboard).
   */
  isSalesManagerOnly(): boolean {
    return this.hasRole('sales_manager')
      && !this.hasRole('super_admin') && !this.hasRole('admin') && !this.hasRole('sales_executive') && !this.hasRole('ceo');
  }

  /**
   * An Access Officer (role "access_officer") only uses the Access page (door access by CNIC) for their own
   * location(s). Only when the user has no other staff role (a CEO / Sales Manager keeps their dashboard).
   */
  isAccessOfficerOnly(): boolean {
    return this.hasRole('access_officer')
      && !this.hasRole('super_admin') && !this.hasRole('admin') && !this.hasRole('sales_executive')
      && !this.hasRole('ceo') && !this.hasRole('sales_manager');
  }

  /** CEO, Sales Manager or Access Officer: one page (their dashboard / the Access page) and no other. */
  isSinglePageOnly(): boolean {
    return this.isCeoOnly() || this.isSalesManagerOnly() || this.isAccessOfficerOnly();
  }

  /**
   * Admins, sales executives, sales managers and access officers only see their own location(s); super admins
   * see every location.
   */
  isLocationBound(): boolean {
    return !this.hasRole('super_admin')
      && (this.hasRole('admin') || this.hasRole('sales_executive') || this.hasRole('sales_manager')
        || this.hasRole('access_officer'));
  }

  /** The signed-in user's role as the database words it (auth/me), else a label made from the role name. */
  roleLabel(): string {
    const u = this.user();
    return u?.roleDisplayName?.trim() || roleLabelFor(u?.roles?.[0]);
  }

  hasRole(role?: string): boolean {
    const currentUser = this.user();
    if (!currentUser) return false;
    if (!role) return true;
    const target = role.toLowerCase().replace(/[\s_]/g, '');
    return (currentUser.roles || []).some(item => String(item).toLowerCase().replace(/[\s_]/g, '') === target);
  }

  getUserFromToken(): any {
    return null;
  }

  /** Location ids in the signed-in user's API token (location_ids, else location_id); [] when none. */
  tokenLocationIds(): number[] {
    const token = this.getToken();
    if (!token) return [];
    try {
      const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const claims = JSON.parse(decodeURIComponent(escape(atob(part.padEnd(part.length + (4 - part.length % 4) % 4, '=')))));
      const raw = claims['location_ids'] ?? claims['location_id'] ?? claims['LocationId'] ?? '';
      return [...new Set(String(raw).split(',').map(s => Number(s.trim())).filter(n => n > 0))];
    } catch {
      return [];
    }
  }

  clearSession(): void {
    this.user.set(null);
    this.rolesVerified.set(false);
    localStorage.removeItem(this.tokenKey);
    localStorage.removeItem(this.userKey);
  }

  /**
   * Confirms the signed-in user's roles with GET auth/me (used by the admin guards).
   * Emits true when the API returned roles; false when the call failed or returned none.
   */
  verifyRoles$(): Observable<boolean> {
    if (this.rolesVerified()) return of(true);
    return this.hydrateBackendSession$(this.user()).pipe(
      map(() => this.rolesVerified()),
      catchError(() => of(false))
    );
  }

  /** Cached user with staff roles removed: used when the API could not confirm the roles. */
  private withoutStaffRoles(cached: UserInfo | null): UserInfo | null {
    if (!cached) return null;
    const staff = ['admin', 'superadmin', 'salesexecutive', 'ceo', 'salesmanager', 'accessofficer'];
    const roles = (cached.roles || []).filter(r => !staff.includes(String(r).toLowerCase().replace(/[\s_]/g, '')));
    // The stored role label belonged to a role that is now dropped.
    return roles.length === (cached.roles || []).length ? { ...cached, roles } : { ...cached, roles, roleDisplayName: undefined };
  }

  /** Keeps the session but drops unconfirmed staff roles (in memory only; the next load retries auth/me). */
  private unverifiedUser(fallbackUser: UserInfo | null): UserInfo | null {
    this.rolesVerified.set(false);
    const stripped = this.withoutStaffRoles(fallbackUser);
    if (stripped) this.user.set(stripped);
    return stripped;
  }

  private hydrateBackendSession$(fallbackUser: UserInfo | null): Observable<UserInfo | null> {
    const email = fallbackUser?.email;
    if (!email) return of(fallbackUser);

    const currentUser = firebaseAuth?.currentUser;
    let accountDisabled = false;
    const ensureToken$ = !this.getToken() && currentUser
      ? this.silentExchange$(email, currentUser).pipe(
          map(res => {
            const token = this.extractToken(res);
            if (token) {
              localStorage.setItem(this.tokenKey, token);
            }
            return token;
          }),
          catchError(error => {
            if (authFailureCode(error) === ACCOUNT_DISABLED) {
              // The account was turned off: end the Firebase session too, so it isn't retried on every load.
              accountDisabled = true;
              this.clearSession();
              void signOut(firebaseAuth).catch(() => undefined);
            }
            return of(null);
          })
        )
      : of(this.getToken());

    return ensureToken$.pipe(
      switchMap(() => {
        if (accountDisabled) return of(null);
        if (!this.getToken()) return of(fallbackUser);
        return this.http.get<any>(`${environment.apiUrl}/auth/me`, {
          headers: { 'x-user-email': email }
        }).pipe(
          map(res => {
            const data = res?.data;
            if (!data) return this.unverifiedUser(fallbackUser);
            const roles = this.extractRoles(data, []);
            if (!roles.length) return this.unverifiedUser(fallbackUser);
            const updated: UserInfo = {
              ...fallbackUser!,
              email: data.email || fallbackUser?.email || email,
              userId: data.id || data.userId || fallbackUser?.userId || '',
              roles,
              // The name in WorkNest (WN_Users.Name) wins over the sign-in provider's name or the email prefix.
              displayName: String(data.name ?? '').trim() || fallbackUser?.displayName,
              roleDisplayName: String(data.roleDisplayName ?? '').trim() || undefined,
              locationId: data.locationId ?? fallbackUser?.locationId ?? null,
              locationIds: Array.isArray(data.locationIds) ? data.locationIds.map(Number) : (fallbackUser?.locationIds ?? [])
            };
            this.user.set(updated);
            this.rolesVerified.set(true);
            localStorage.setItem(this.userKey, JSON.stringify(updated));
            return updated;
          }),
          catchError(() => of(this.unverifiedUser(fallbackUser)))
        );
      })
    );
  }

  private signInWithProvider(provider: AuthProvider): Observable<{
    isSuccessful: boolean;
    message: string;
    data: UserInfo | null;
  }> {
    return this.ensureConfigured().pipe(
      switchMap(() => from(signInWithPopup(firebaseAuth, provider))),
      switchMap(credential => this.toAuthSuccess(credential, null))
    );
  }

  private toAuthSuccess(credential: Pick<UserCredential, 'user'>, apiResponse?: any): Observable<AuthResult> {
    return from(this.mapFirebaseUser(credential.user)).pipe(
      map(userInfo => {
        const apiPayload = this.extractApiPayload(apiResponse);
        // Roles count as verified only when the API response carried them (not Firebase claims alone).
        const apiRoles = this.extractRoles(apiPayload, []);
        const apiName = String(apiPayload?.name ?? '').trim();
        const apiRoleLabel = String(apiPayload?.roleDisplayName ?? '').trim();
        const hydratedUser: UserInfo | null = userInfo
          ? {
              ...userInfo,
              email: apiPayload?.email || userInfo.email,
              userId: apiPayload?.userId || apiPayload?.id || userInfo.userId,
              roles: this.extractRoles(apiPayload, userInfo.roles),
              ...(apiName ? { displayName: apiName } : {}),
              ...(apiRoleLabel ? { roleDisplayName: apiRoleLabel } : {})
            }
          : null;

        const token = this.extractToken(apiResponse);
        if (token) {
          localStorage.setItem(this.tokenKey, token);
        }
        if (hydratedUser) {
          localStorage.setItem(this.userKey, JSON.stringify(hydratedUser));
        }

        this.user.set(hydratedUser);
        this.rolesVerified.set(!!hydratedUser && apiRoles.length > 0);
        return {
          isSuccessful: true,
          message: apiResponse?.message || 'Authentication successful.',
          data: hydratedUser
        };
      }),
      catchError(error => throwError(() => this.normalizeAuthError(error)))
    );
  }

  private async mapFirebaseUser(user: User | null): Promise<UserInfo | null> {
    if (!user) {
      return null;
    }

    const tokenResult = await getIdTokenResult(user);
    const rawRoles = tokenResult.claims['roles'];
    const roles = Array.isArray(rawRoles)
      ? rawRoles.map(role => String(role))
      : typeof rawRoles === 'string'
        ? [rawRoles]
        : [];

    return {
      email: user.email ?? '',
      userId: user.uid,
      roles,
      displayName: user.displayName ?? undefined,
      photoURL: user.photoURL ?? undefined
    };
  }

  private mergeUserInfo(primary: UserInfo | null, fallback: UserInfo | null): UserInfo | null {
    if (!primary) {
      return fallback;
    }

    if (!fallback) {
      return primary;
    }

    const sameUser =
      (primary.userId && fallback.userId && primary.userId === fallback.userId) ||
      (primary.email && fallback.email && primary.email.toLowerCase() === fallback.email.toLowerCase());

    if (!sameUser) {
      return primary;
    }

    return {
      ...fallback,
      ...primary,
      // An empty name from the sign-in provider never hides the stored one (WorkNest's own name after auth/me).
      displayName: primary.displayName || fallback.displayName,
      roles: primary.roles?.length ? primary.roles : (fallback.roles?.length ? fallback.roles : [])
    };
  }

  private mergeApiUser(apiData: any, fallback: UserInfo | null): UserInfo | null {
    if (!apiData && !fallback) {
      return null;
    }

    return {
      email: apiData?.email || fallback?.email || '',
      userId: apiData?.userId || fallback?.userId || '',
      roles: Array.isArray(apiData?.roles) && apiData.roles.length ? apiData.roles : (fallback?.roles || []),
      displayName: fallback?.displayName,
      photoURL: fallback?.photoURL
    };
  }

  private extractApiPayload(response: any): any {
    return response?.data?.user ?? response?.data ?? response?.user ?? response ?? null;
  }

  private extractToken(response: any): string | null {
    return response?.data?.token
      || response?.data?.accessToken
      || response?.data?.jwt
      || response?.token
      || response?.accessToken
      || response?.jwt
      || null;
  }

  private extractRoles(payload: any, fallbackRoles: string[] = []): string[] {
    const rawRoles = payload?.roles ?? payload?.role;

    if (Array.isArray(rawRoles) && rawRoles.length) {
      return rawRoles.map(role => String(role));
    }

    if (typeof rawRoles === 'string' && rawRoles.trim()) {
      return [rawRoles];
    }

    return fallbackRoles;
  }

  private ensureConfigured(): Observable<void> {
    if (isFirebaseConfigured) {
      return of(void 0);
    }

    return throwError(() => ({
      error: {
        message: 'Firebase is not configured. Set the NG_APP_FIREBASE_* environment variables.'
      }
    }));
  }

  /**
   * Firebase ID token of the user who just signed in. The API verifies it, so a sign-in request can't
   * claim someone else's email. Passwords are never sent to the API (Firebase owns them).
   */
  private firebaseIdToken$(): Observable<string | null> {
    const user = firebaseAuth?.currentUser;
    return from(user ? user.getIdToken() : Promise.resolve(null));
  }

  private syncRegisterToApi$(email: string, _password: string, firstName?: string, lastName?: string): Observable<any> {
    const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
    const basePayload = {
      email,
      firstName,
      lastName,
      name: fullName || email.split('@')[0]
    };

    return this.firebaseIdToken$().pipe(
      switchMap(firebaseIdToken => {
        const payload = { ...basePayload, firebaseIdToken };
        return this.http.post<any>(`${environment.apiUrl}/auth/register`, payload).pipe(
      catchError(error => {
        if (this.requiresRequestWrapper(error)) {
          return this.http.post<any>(`${environment.apiUrl}/auth/register`, {
            request: payload
          });
        }

        return throwError(() => error);
      }));
      }),
      catchError(error => {
        const message = String(error?.error?.message ?? '').toLowerCase();
        const alreadyExists =
          error?.status === 409 ||
          (error?.status === 400 && message.includes('already')) ||
          message.includes('already exists') ||
          message.includes('duplicate');

        if (alreadyExists) {
          return of(null);
        }

        return throwError(() => error);
      })
    );
  }

  /**
   * POST auth/google-login: exchanges the Firebase sign-in (Google, or any Firebase user) for the API token.
   * idToken is the Google credential's token when there is one, else the Firebase ID token (what the app sends).
   * interactive: false = a silent re-exchange: the API returns the token without a login-history row.
   */
  private syncGoogleLoginToApi$(firebaseUser: User, idToken: string | null, interactive = true): Observable<any> {
    const [firstName, ...rest] = (firebaseUser.displayName || '').trim().split(/\s+/).filter(Boolean);
    const lastName = rest.join(' ') || undefined;
    const fullName = firebaseUser.displayName || [firstName, lastName].filter(Boolean).join(' ').trim();
    return from(firebaseUser.getIdToken()).pipe(
      switchMap(firebaseIdToken => {
        const payload = {
          idToken: idToken || firebaseIdToken,
          firebaseIdToken,
          email: firebaseUser.email ?? undefined,
          firstName: firstName || undefined,
          lastName,
          name: fullName || (firebaseUser.email ? firebaseUser.email.split('@')[0] : 'User'),
          interactive
        };
        return this.http.post<any>(`${environment.apiUrl}/auth/google-login`, payload).pipe(
          catchError(error => {
            if (this.requiresRequestWrapper(error)) {
              return this.http.post<any>(`${environment.apiUrl}/auth/google-login`, {
                request: payload
              });
            }

            return throwError(() => error);
          })
        );
      })
    );
  }

  private syncLoginToApi$(email: string, _password: string, firebaseUser?: User | null): Observable<any> {
    const [firstName, ...rest] = (firebaseUser?.displayName || '').trim().split(/\s+/).filter(Boolean);
    const lastName = rest.join(' ') || undefined;
    const fullName = firebaseUser?.displayName || [firstName, lastName].filter(Boolean).join(' ').trim();
    return from(firebaseUser ? firebaseUser.getIdToken() : Promise.resolve(null)).pipe(
      switchMap(firebaseIdToken => {
        const payload = {
          email,
          firebaseIdToken,
          firstName: firstName || undefined,
          lastName: lastName || undefined,
          name: fullName || email.split('@')[0]
        };
        return this.http.post<any>(`${environment.apiUrl}/auth/login`, payload).pipe(
          catchError(error => {
            if (this.requiresRequestWrapper(error)) {
              return this.http.post<any>(`${environment.apiUrl}/auth/login`, {
                request: payload
              });
            }

            return throwError(() => error);
          })
        );
      })
    );
  }

  /**
   * Session restore without a button press (Firebase still has the user but the API token is missing): exchanges
   * the Firebase ID token at auth/google-login with interactive: false, so no login-history row is added.
   * A refusal (EMAIL_NOT_VERIFIED / ACCOUNT_DISABLED) is final; any other failure (e.g. the per-account limit)
   * falls back to the auth/login exchange used before.
   */
  private silentExchange$(email: string, firebaseUser: User): Observable<any> {
    return this.syncGoogleLoginToApi$(firebaseUser, null, false).pipe(
      catchError(error => this.isSignInRefusal(error)
        ? throwError(() => error)
        : this.syncLoginToApi$(email, '', firebaseUser))
    );
  }

  /** The API refused the sign-in on purpose (403 EMAIL_NOT_VERIFIED / ACCOUNT_DISABLED). */
  private isSignInRefusal(error: any): boolean {
    const code = authFailureCode(error);
    return code === EMAIL_NOT_VERIFIED || code === ACCOUNT_DISABLED;
  }

  /**
   * A refused sign-in as the error the pages read: { error: { message: the API's message, code } }.
   * A turned-off account is also signed out of Firebase (and the stored session cleared); an unverified one stays
   * signed in to Firebase so the verification email can be sent to it.
   */
  private refuseSignIn$(error: any): Observable<never> {
    const code = authFailureCode(error) ?? EMAIL_NOT_VERIFIED;
    const serverMessage = String(error?.error?.message ?? '').trim();
    // The error interceptor puts its generic 403 text there when the API's own message was not readable.
    const message = serverMessage && serverMessage !== "You don't have permission to do this."
      ? serverMessage
      : (REFUSAL_MESSAGES[code] ?? 'WorkNest could not sign you in. Please contact WorkNest.');
    const failure = { error: { message, code } };
    if (code !== ACCOUNT_DISABLED) {
      return throwError(() => failure);
    }
    return this.endLocalSession$().pipe(switchMap(() => throwError(() => failure)));
  }

  private syncLoginOrProvisionApi$(firebaseUser: User, email: string, password: string): Observable<any> {
    const [firstName, ...rest] = (firebaseUser.displayName || '').trim().split(/\s+/).filter(Boolean);
    const lastName = rest.join(' ') || undefined;

    return this.syncLoginToApi$(email, password, firebaseUser).pipe(
      catchError(error => {
        const message = String(error?.error?.message ?? '').toLowerCase();
        const missingBackendUser =
          error?.status === 401 ||
          error?.status === 404 ||
          (error?.status === 400 && (message.includes('not found') || message.includes('invalid')));

        if (!missingBackendUser) {
          return throwError(() => error);
        }

        return this.syncRegisterToApi$(email, password, firstName || undefined, lastName);
      })
    );
  }

  /**
   * Why an email + password sign-in failed (Firebase and the WorkNest password both refused), in plain words instead of
   * "Authentication failed": too many attempts (Firebase's temporary lock or the API's 429), a turned-off Firebase sign-in,
   * WorkNest unreachable (status 0) or down (5xx), else the API's own message or "Invalid email or password."
   */
  private signInFailure(firebaseError: any, backendError: any) {
    const statusOf = (e: any): number | null =>
      typeof e?.status === 'number' ? e.status : (typeof e?.error?.status === 'number' ? e.error.status : null);
    const fbCode = typeof firebaseError?.code === 'string' ? firebaseError.code : '';
    const fail = (message: string) => ({ error: { message } });
    if (fbCode === 'auth/too-many-requests' || statusOf(firebaseError) === 429 || statusOf(backendError) === 429) {
      return fail('Too many sign-in attempts. Please wait a few minutes and try again.');
    }
    if (fbCode === 'auth/user-disabled') return fail('This sign-in has been turned off. Please contact WorkNest.');
    if (['auth/invalid-credential', 'auth/invalid-login-credentials', 'auth/wrong-password', 'auth/user-not-found'].includes(fbCode)) {
      return fail('Invalid email or password.');
    }
    if (fbCode) return this.normalizeAuthError(firebaseError);
    const status = statusOf(firebaseError) ?? statusOf(backendError);
    if (status === 0) return fail('Could not reach WorkNest. Check your internet connection and try again.');
    if (status !== null && status >= 500) return fail('WorkNest could not sign you in right now. Please try again in a few minutes.');
    const apiMessage = String(backendError?.error?.message ?? firebaseError?.error?.message ?? '').trim();
    return fail(apiMessage || 'Invalid email or password.');
  }

  private normalizeAuthError(error: unknown) {
    // A refusal from the API keeps its own message and code (never "Authentication failed").
    const refusalCode = authFailureCode(error);
    if (refusalCode === EMAIL_NOT_VERIFIED || refusalCode === ACCOUNT_DISABLED) {
      const message = String((error as any)?.error?.message ?? '').trim() || REFUSAL_MESSAGES[refusalCode];
      return { error: { message, code: refusalCode } };
    }
    const authError = error as AuthError;
    const messageMap: Record<string, string> = {
      // amazonq-ignore-next-line
      'auth/account-exists-with-different-credential': 'An account already exists with a different sign-in method.',
      'auth/email-already-in-use': 'That email is already in use.',
      // amazonq-ignore-next-line
      'auth/invalid-credential': 'That sign-in attempt was rejected. Please try again.',
      'auth/invalid-email': 'Please enter a valid email address.',
      'auth/network-request-failed': 'Network error while contacting Firebase. Please try again.',
      'auth/popup-blocked': 'Your browser blocked the sign-in popup. Please allow popups and try again.',
      'auth/popup-closed-by-user': 'The sign-in popup was closed before completing authentication.',
      'auth/user-not-found': 'No account was found for that email address.',
      // amazonq-ignore-next-line
      'auth/weak-password': 'Password should be at least 6 characters.',
      'auth/wrong-password': 'Invalid email or password.',
    };

    const code = typeof authError?.code === 'string' ? authError.code : '';
    const message = Object.prototype.hasOwnProperty.call(messageMap, code)
      ? messageMap[code]
      : 'Authentication failed. Please try again.';

    return {
      ...authError,
      error: { message }
    };
  }

  private requiresRequestWrapper(error: any): boolean {
    const msg = typeof error?.error?.message === 'string' ? error.error.message.toLowerCase() : '';
    return error?.status === 400 && msg.includes('request field is required');
  }

  // ---- Signed-in user's own profile (admin portal Profile page) ----

  /** Name, email, phone, role and location from the API (GET auth/me). */
  getMyProfile(): Observable<any> {
    return this.http.get<any>(`${environment.apiUrl}/auth/me`).pipe(map(res => res?.data ?? null));
  }

  /**
   * Picks up the name and role label from auth/me (WN_Users.Name, WN_Roles.DisplayName), e.g. right after a
   * sign-in whose response did not carry the label. Roles are left as they are, and a failure changes nothing.
   */
  refreshProfileLabels(): void {
    if (!this.getToken() || this.isGuest()) return;
    this.getMyProfile().subscribe({
      next: data => {
        const current = this.user();
        if (!current || !data) return;
        const name = String(data.name ?? '').trim();
        const roleLabel = String(data.roleDisplayName ?? '').trim();
        if ((!name || name === current.displayName) && (!roleLabel || roleLabel === current.roleDisplayName)) return;
        const updated: UserInfo = {
          ...current,
          ...(name ? { displayName: name } : {}),
          ...(roleLabel ? { roleDisplayName: roleLabel } : {})
        };
        this.user.set(updated);
        localStorage.setItem(this.userKey, JSON.stringify(updated));
      },
      error: () => { /* labels are cosmetic: keep what is shown */ }
    });
  }

  /** Saves the user's own name and phone; the sidebar picks up the new name. */
  updateMyProfile(name: string, phone: string): Observable<any> {
    return this.http.put<any>(`${environment.apiUrl}/auth/me`, { name, phone }).pipe(
      map(res => {
        const data = res?.data ?? null;
        const current = this.user();
        if (current && data?.name) {
          const updated: UserInfo = { ...current, displayName: data.name };
          this.user.set(updated);
          localStorage.setItem(this.userKey, JSON.stringify(updated));
        }
        if (firebaseAuth?.currentUser && data?.name) {
          updateProfile(firebaseAuth.currentUser, { displayName: data.name }).catch(() => undefined);
        }
        return data;
      })
    );
  }

  /** True when the account signs in with email + password (Google accounts manage passwords at Google). */
  hasPasswordSignIn(): boolean {
    return !!firebaseAuth?.currentUser?.providerData?.some(p => p.providerId === 'password');
  }

  /** Changes the password after re-checking the current one (Firebase requires a recent sign-in). */
  changePassword(currentPassword: string, newPassword: string): Observable<void> {
    const fbUser = firebaseAuth?.currentUser;
    if (!fbUser?.email) return throwError(() => new Error('Please sign in again to change your password.'));
    const credential = EmailAuthProvider.credential(fbUser.email, currentPassword);
    return from(reauthenticateWithCredential(fbUser, credential).then(() => updatePassword(fbUser, newPassword))).pipe(
      map(() => undefined),
      catchError((err: AuthError) => {
        const code = err?.code ?? '';
        const message =
          code === 'auth/wrong-password' || code === 'auth/invalid-credential' ? 'Your current password is incorrect.'
          : code === 'auth/weak-password' ? 'Choose a stronger password (at least 6 characters).'
          : code === 'auth/too-many-requests' ? 'Too many attempts. Please wait a few minutes and try again.'
          : code === 'auth/requires-recent-login' ? 'Please sign out and sign in again, then change your password.'
          : 'Could not change the password. Please try again.';
        return throwError(() => new Error(message));
      })
    );
  }
}

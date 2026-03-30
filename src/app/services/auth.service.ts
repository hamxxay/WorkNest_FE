import { Injectable, WritableSignal, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, from, of, throwError } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import {
  AuthError,
  AuthProvider,
  GoogleAuthProvider,
  User,
  UserCredential,
  createUserWithEmailAndPassword,
  getIdTokenResult,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
} from 'firebase/auth';
import {
  firebaseAuth,
  githubProvider,
  googleProvider,
  isFirebaseConfigured,
} from './firebase';
import { environment } from '../../environments/environment';

export interface UserInfo {
  email: string;
  userId: string;
  roles: string[];
  displayName?: string;
  photoURL?: string;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  user: WritableSignal<UserInfo | null> = signal<UserInfo | null>(null);
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
          const firebaseUser = await this.mapFirebaseUser(currentUser);
          const mergedUser = this.mergeUserInfo(firebaseUser, parsedCachedUser);

          this.user.set(mergedUser);
          localStorage.setItem(this.userKey, JSON.stringify(mergedUser));

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

  login(email: string, password: string): Observable<{
    isSuccessful: boolean;
    message: string;
    data: UserInfo | null;
  }> {
    return this.ensureConfigured().pipe(
      switchMap(() => from(signInWithEmailAndPassword(firebaseAuth, email, password))),
      switchMap(credential => this.syncLoginOrProvisionApi$(credential.user, email, password).pipe(
        map(response => ({ credential, response }))
      )),
      switchMap(({ credential, response }) => this.toAuthSuccess(credential, response))
    );
  }

  register(email: string, password: string, firstName?: string, lastName?: string): Observable<{
    isSuccessful: boolean;
    message: string;
    data: UserInfo | null;
  }> {
    const displayName = [firstName, lastName].filter(Boolean).join(' ').trim();

    return this.ensureConfigured().pipe(
      switchMap(() => from(createUserWithEmailAndPassword(firebaseAuth, email, password))),
      switchMap(async credential => {
        if (displayName) {
          await updateProfile(credential.user, { displayName });
        }
        return credential;
      }),
      switchMap(credential => this.syncRegisterToApi$(email, password, firstName, lastName).pipe(
        map(response => ({ credential, response }))
      )),
      switchMap(({ credential, response }) => this.toAuthSuccess(credential, response))
    );
  }

  loginWithGoogle(): Observable<{
    isSuccessful: boolean;
    message: string;
    data: UserInfo | null;
  }> {
    return this.ensureConfigured().pipe(
      switchMap(() => from(signInWithPopup(firebaseAuth, googleProvider))),
      switchMap(credential => {
        const googleCredential = GoogleAuthProvider.credentialFromResult(credential);
        const idToken = googleCredential?.idToken;

        if (!idToken) {
          return throwError(() => ({
            error: {
              message: 'Google sign-in succeeded, but no Google ID token was returned.'
            }
          }));
        }

        return this.syncGoogleLoginToApi$(credential.user, idToken).pipe(
          map(response => ({ credential, response }))
        );
      }),
      switchMap(({ credential, response }) => this.toAuthSuccess(credential, response))
    );
  }

  loginWithGithub(): Observable<{
    isSuccessful: boolean;
    message: string;
    data: UserInfo | null;
  }> {
    return this.signInWithProvider(githubProvider);
  }

  clearUserOnly(): void {
    this.user.set(null);
  }

  logout$(): Observable<any> {
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

  isAuthenticated(): boolean {
    return !!this.user() || !!this.getToken();
  }

  getUser(): UserInfo | null {
    return this.user();
  }

  hasRole(role?: string): boolean {
    const currentUser = this.user();
    if (!currentUser) return false;
    if (!role) return true;
    const target = role.toLowerCase();
    return (currentUser.roles || []).some(item => String(item).toLowerCase() === target);
  }

  getUserFromToken(): any {
    return null;
  }

  clearSession(): void {
    this.user.set(null);
    localStorage.removeItem(this.tokenKey);
    localStorage.removeItem(this.userKey);
  }

  private hydrateBackendSession$(fallbackUser: UserInfo | null): Observable<UserInfo | null> {
    return of(fallbackUser);
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

  private toAuthSuccess(credential: UserCredential): Observable<{
    isSuccessful: boolean;
    message: string;
    data: UserInfo | null;
  }>;
  private toAuthSuccess(credential: UserCredential, apiResponse: any): Observable<{
    isSuccessful: boolean;
    message: string;
    data: UserInfo | null;
  }>;
  private toAuthSuccess(credential: UserCredential, apiResponse?: any): Observable<{
    isSuccessful: boolean;
    message: string;
    data: UserInfo | null;
  }> {
    return from(this.mapFirebaseUser(credential.user)).pipe(
      map(userInfo => {
        const apiPayload = this.extractApiPayload(apiResponse);
        const hydratedUser = userInfo
          ? {
              ...userInfo,
              email: apiPayload?.email || userInfo.email,
              userId: apiPayload?.userId || apiPayload?.id || userInfo.userId,
              roles: this.extractRoles(apiPayload, userInfo.roles)
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
      (primary.email && fallback.email && primary.email === fallback.email);

    if (!sameUser) {
      return primary;
    }

    return {
      ...fallback,
      ...primary,
      roles: primary.roles?.length ? primary.roles : fallback.roles
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

  private syncRegisterToApi$(email: string, password: string, firstName?: string, lastName?: string): Observable<any> {
    const payload = {
      email,
      password,
      firstName,
      lastName
    };

    return this.http.post<any>(`${environment.apiUrl}/auth/register`, payload).pipe(
      catchError(error => {
        if (this.requiresRequestWrapper(error)) {
          return this.http.post<any>(`${environment.apiUrl}/auth/register`, {
            request: payload
          });
        }

        return throwError(() => error);
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

  private syncGoogleLoginToApi$(firebaseUser: User, idToken: string): Observable<any> {
    const [firstName, ...rest] = (firebaseUser.displayName || '').trim().split(/\s+/).filter(Boolean);
    const lastName = rest.join(' ') || undefined;
    const payload = {
      idToken,
      email: firebaseUser.email ?? undefined,
      firstName: firstName || undefined,
      lastName
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
  }

  private syncLoginToApi$(email: string, password: string): Observable<any> {
    const payload = { email, password };

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
  }

  private syncLoginOrProvisionApi$(firebaseUser: User, email: string, password: string): Observable<any> {
    const [firstName, ...rest] = (firebaseUser.displayName || '').trim().split(/\s+/).filter(Boolean);
    const lastName = rest.join(' ') || undefined;

    return this.syncLoginToApi$(email, password).pipe(
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

  private normalizeAuthError(error: unknown) {
    const authError = error as AuthError;
    const messageMap: Record<string, string> = {
      'auth/account-exists-with-different-credential': 'An account already exists with a different sign-in method.',
      'auth/email-already-in-use': 'That email is already in use.',
      'auth/invalid-credential': 'That sign-in attempt was rejected. Please try again.',
      'auth/invalid-email': 'Please enter a valid email address.',
      'auth/network-request-failed': 'Network error while contacting Firebase. Please try again.',
      'auth/popup-blocked': 'Your browser blocked the sign-in popup. Please allow popups and try again.',
      'auth/popup-closed-by-user': 'The sign-in popup was closed before completing authentication.',
      'auth/user-not-found': 'No account was found for that email address.',
      'auth/weak-password': 'Password should be at least 6 characters.',
      'auth/wrong-password': 'Invalid email or password.',
    };

    return {
      ...authError,
      error: {
        message: messageMap[authError?.code ?? ''] ?? authError?.message ?? 'Authentication failed. Please try again.'
      }
    };
  }

  private requiresRequestWrapper(error: any): boolean {
    return error?.status === 400 &&
      JSON.stringify(error?.error ?? {}).toLowerCase().includes('request field is required');
  }
}

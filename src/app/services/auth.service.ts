// ============================================================
// Authentication Service
// ============================================================
// This service handles all authentication-related operations:
// - User login and registration
// - Token management (storage and retrieval)
// - User information management
// - Logout functionality
//
// All authentication data is persisted in browser localStorage.

import { Injectable, signal, WritableSignal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap, timeout, catchError, of, throwError } from 'rxjs';
import { environment } from '../../environments/environment';

// Interface representing logged-in user information
export interface UserInfo {
  email: string;
  userId: string;
  roles: string[]; // Array of user roles (e.g., 'User', 'Admin')
}

// Injectable service provided at the root level (singleton)
@Injectable({
  providedIn: 'root'
})
export class AuthService {
  // Base API URL for authentication endpoints
  private apiUrl = `${environment.apiUrl}/auth`;
  private readonly tokenKey = 'wn_token';
  private readonly userKey = 'wn_user';

  // Reactive signal that holds the current user info. Components can
  // bind to `authService.user()` or consume the signal directly. Because
  // authentication is handled via secure cookies, we no longer persist
  // tokens or profile data in localStorage. The signal is initially null
  // and must be seeded by a successful login or an explicit profile
  // fetch (not implemented here).
  user: WritableSignal<UserInfo | null> = signal<UserInfo | null>(null);

  constructor(private http: HttpClient) {}

  /**
   * Attempt to rehydrate session state from server-side cookie.
   * The backend should expose an endpoint (e.g. /auth/me or /auth/profile)
   * that returns the currently logged‑in user's metadata when a valid
   * HttpOnly cookie is present. This method updates the `user` signal
   * accordingly; callers may subscribe to know when bootstrap is complete.
   *
   * NOTE: the global HTTP interceptor will clear auth state on 401 but
   * will not redirect during this probe, allowing the initializer to
   * resolve without forcing a navigation.
   */
  loadSession(): Observable<any> {
    // Prefer local cache first so apps using bearer tokens (without /auth/me)
    // still restore session on refresh.
    const cachedUser = localStorage.getItem(this.userKey);
    if (cachedUser) {
      try {
        this.user.set(JSON.parse(cachedUser) as UserInfo);
      } catch {
        this.user.set(null);
      }
    }

    // add a timeout so probe cannot hang indefinitely
    return this.http.get<any>(`${this.apiUrl}/me`).pipe(
      tap(response => {
        if (response?.data) {
          const userInfo: UserInfo = {
            email: response.data.email,
            userId: response.data.userId,
            roles: response.data.roles || []
          };
          this.user.set(userInfo);
        } else {
          this.user.set(null);
        }
      }),
      // any error or timeout will propagate, caller should handle
      timeout(5000),
      catchError(err => {
        console.warn('Session probe failed or timed out', err);
        // Keep cached session when /auth/me is unavailable (older bearer APIs).
        if (!this.getToken() && !localStorage.getItem(this.userKey)) {
          this.user.set(null);
        }
        return of(null);
      })
    );
  }

  /**
   * Login user with email and password
   * Stores JWT token and user info in localStorage on successful login
   * @param email - User email address
   * @param password - User password
   * @returns Observable of API response containing token and user data
   */
  login(email: string, password: string): Observable<any> {
    // Backend is expected to set an HttpOnly, SameSite cookie containing the
    // session token. This client method only captures non-sensitive user
    // metadata returned in the response body and updates the local signal.
    const credentials = { email, password };

    return this.http.post<any>(`${this.apiUrl}/login`, credentials).pipe(
      catchError(err => {
        // Some backend deployments bind login DTOs from a `request` wrapper.
        // Retry once with that shape when the API explicitly reports it.
        const requestFieldRequired = err?.status === 400 &&
          JSON.stringify(err?.error ?? {}).toLowerCase().includes('request field is required');

        if (!requestFieldRequired) {
          return throwError(() => err);
        }

        return this.http.post<any>(`${this.apiUrl}/login`, { request: credentials });
      }),
      tap(response => {
        if (response?.data) {
          const userInfo: UserInfo = {
            email: response.data.email,
            userId: response.data.userId,
            roles: response.data.roles || []
          };
          // update reactive state only
          this.user.set(userInfo);
          localStorage.setItem(this.userKey, JSON.stringify(userInfo));

          // Support both common token payload shapes.
          const token =
            response.data.token ||
            response.data.accessToken ||
            response.token ||
            response.accessToken;
          if (token) {
            localStorage.setItem(this.tokenKey, token);
          }
        }
      })
    );
  }

  /**
   * Register a new user account
   * @param email - Email address for the new account
   * @param password - Password for the account
   * @param firstName - (Optional) User's first name
   * @param lastName - (Optional) User's last name
   * @returns Observable of API response
   */
  register(email: string, password: string, firstName?: string, lastName?: string): Observable<any> {
    const body: any = { email, password };
    if (firstName) body.firstName = firstName;
    if (lastName) body.lastName = lastName;
    return this.http.post<any>(`${this.apiUrl}/register`, body);
  }

  /**
   * Logout the current user
   * Clears token and user info from localStorage and updates the cached
   * reactive state.
   */
  /**
   * Clear user signal locally without making an HTTP call.
   * Used by the HTTP interceptor to avoid recursive logout requests
   * when a 401 is encountered on /auth/* endpoints.
   */
  clearUserOnly(): void {
    this.user.set(null);
  }

  /**
   * Perform a server-side sign-out then clear client state.
   * Returns observable so callers can wait for completion.
   */
  logout$(): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/logout`, {}).pipe(
      tap(() => {
        this.clearSession();
      }),
      catchError(err => {
        // even if the request fails, wipe client state
        this.clearSession();
        return of(null);
      })
    );
  }

  logout(): void {
    // convenience wrapper for components that don't need to wait
    this.logout$().subscribe();
  }

  // token is no longer stored on the client; authentication happens via
  // HttpOnly cookie automatically sent with requests.
  getToken(): string | null {
    return localStorage.getItem(this.tokenKey);
  }

  /**
   * Check if a user is currently logged in (based on reactive state).
   * @returns true if user info exists, false otherwise
   */
  isAuthenticated(): boolean {
    return !!this.user() || !!this.getToken();
  }

  /**
   * Get the current user's information (from reactive cache).
   * @returns UserInfo object or null if user not found
   */
  getUser(): UserInfo | null {
    return this.user();
  }

  /**
   * Check whether the current session includes a specific role.
   * If no role is provided, simply return whether the user is authenticated.
   */
  hasRole(role?: string): boolean {
    const u = this.user();
    if (!u) return false;
    if (!role) return true;
    const target = role.toLowerCase();
    return (u.roles || []).some(r => String(r).toLowerCase() === target);
  }

  /**
   * Placeholder removed: token is not available client-side when using
   * secure cookies. If the app needs decoded claims, the server should
   * return them as part of the profile response.
   */
  getUserFromToken(): any {
    return null;
  }

  clearSession(): void {
    this.user.set(null);
    localStorage.removeItem(this.tokenKey);
    localStorage.removeItem(this.userKey);
  }
}

import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { catchError, tap } from 'rxjs/operators';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { Router } from '@angular/router';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private apiUrl = '/api/auth';
  private currentUserSubject = new BehaviorSubject<any>(null);
  public currentUser: Observable<any> = this.currentUserSubject.asObservable();

  /**
   * Signal mirror of `currentUser`, used by templates (navbar sign-in/sign-out
   * state). Templates need a synchronous, SSR-safe read of the session; the
   * subject alone cannot be read without subscribing.
   */
  private readonly currentUserSignal = signal<any>(null);
  readonly user = this.currentUserSignal.asReadonly();

  // Store the URL the user was trying to access before being redirected to login
  redirectUrl: string | null = null;

  /**
   * localStorage does not exist during SSR. The navbar is rendered on the
   * server and reads the session state, so every access goes through this
   * guard; an unguarded `localStorage.getItem` throws a ReferenceError and
   * breaks server rendering for every route.
   */
  private static get storage(): Storage | null {
    return typeof localStorage === 'undefined' ? null : localStorage;
  }

  /** Keeps the observable and signal views of the session in sync. */
  private setCurrentUser(user: any): void {
    this.currentUserSubject.next(user);
    this.currentUserSignal.set(user);
  }

  constructor(
    private http: HttpClient,
    private router: Router
  ) {
    // Try to get user from localStorage on init
    const userJson = AuthService.storage?.getItem('currentUser');
    if (userJson) {
      this.setCurrentUser(JSON.parse(userJson));
    }
  }

  /**
   * Register a new user
   */
  register(firstName: string, lastName: string, email: string, phone: string, password: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/register`, {
      firstName,
      lastName,
      email,
      phone,
      password
    }).pipe(
      tap((response: any) => {
        // Store user info in localStorage
        if (response.success && response.user) {
          AuthService.storage?.setItem('currentUser', JSON.stringify(response.user));
          this.setCurrentUser(response.user);
        }
      })
    );
  }

  /**
   * Login user
   */
  login(email: string, password: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/login`, {
      email,
      password
    }).pipe(
      tap((response: any) => {
        // Store user info and token in localStorage
        if (response.success && response.token && response.user) {
          AuthService.storage?.setItem('currentUser', JSON.stringify(response.user));
          AuthService.storage?.setItem('token', response.token);
          this.setCurrentUser(response.user);
        }
      })
    );
  }

  /**
   * Request a password reset link.
   *
   * The server always answers with success so this endpoint cannot be used to
   * discover which email addresses have accounts.
   */
  forgotPassword(email: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/forgot-password`, {
      email: email.toLowerCase().trim()
    });
  }

  /**
   * Complete a password reset with the token from the emailed link.
   *
   * A successful reset invalidates every existing session, so the stale token
   * in localStorage is discarded.
   */
  resetPassword(token: string, password: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/reset-password`, { token, password }).pipe(
      tap((response: any) => {
        if (response?.success) {
          this.clearSession();
        }
      })
    );
  }

  /**
   * Logout user
   */
  logout(): void {
    this.clearSession();

    // Redirect to login page
    this.router.navigate(['/login']);
  }

  /**
   * Remove the stored session without redirecting.
   *
   * Called when the server rejects a stored token (expired, or signed with a
   * rotated JWT_SECRET) so the app does not keep retrying with a dead token.
   */
  private clearSession(): void {
    AuthService.storage?.removeItem('currentUser');
    AuthService.storage?.removeItem('token');
    this.setCurrentUser(null);
  }

  /**
   * Discard a session the server has rejected with a 401.
   *
   * Invoked by AuthInterceptor. This is what stops the repeated
   * "Rejected bearer token" warnings: the dead token is removed from
   * localStorage, so it is no longer sent on subsequent requests.
   */
  handleUnauthorized(): void {
    const hadSession =
      !!AuthService.storage?.getItem('token') || !!AuthService.storage?.getItem('currentUser');
    this.clearSession();

    // Only bounce the user to the login page when a session actually existed;
    // a 401 from the login form itself must not trigger a redirect loop.
    if (hadSession && !this.router.url.startsWith('/login')) {
      this.redirectUrl = this.router.url;
      this.router.navigate(['/login']);
    }
  }

  /**
   * Check if user is logged in
   */
  isLoggedIn(): boolean {
    return !!AuthService.storage?.getItem('token');
  }

  /**
   * Get current user token
   */
  getToken(): string | null {
    return AuthService.storage?.getItem('token') ?? null;
  }

  /**
   * Get current user data
   */
  getCurrentUser(): any {
    const userJson = AuthService.storage?.getItem('currentUser');
    return userJson ? JSON.parse(userJson) : null;
  }

  /**
   * Get current user observables
   */
  getCurrentUserObservable(): Observable<any> {
    return this.currentUser;
  }

  /**
   * Validate token and get current user from server
   */
  validateToken(): Observable<any> {
    const token = this.getToken();
    if (!token) {
      return of(null);
    }
    
    return this.http.get(`${this.apiUrl}/me`, {
      headers: { Authorization: `Bearer ${token}` }
    }).pipe(
      tap((response: any) => {
        if (response.success && response.user) {
          // Update localStorage with fresh user data
          AuthService.storage?.setItem('currentUser', JSON.stringify(response.user));
          this.setCurrentUser(response.user);
        }
      }),
      catchError(() => {
        // The token is no longer accepted (expired, or JWT_SECRET was rotated).
        // Drop the stale session instead of leaving the user in a broken state.
        this.clearSession();
        return of(null);
      })
    );
  }
}
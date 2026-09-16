import { Injectable } from '@angular/core';
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
  
  // Store the URL the user was trying to access before being redirected to login
  redirectUrl: string | null = null;

  constructor(
    private http: HttpClient,
    private router: Router
  ) {
    // Try to get user from localStorage on init
    const userJson = localStorage.getItem('currentUser');
    if (userJson) {
      this.currentUserSubject.next(JSON.parse(userJson));
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
          localStorage.setItem('currentUser', JSON.stringify(response.user));
          this.currentUserSubject.next(response.user);
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
          localStorage.setItem('currentUser', JSON.stringify(response.user));
          localStorage.setItem('token', response.token);
          this.currentUserSubject.next(response.user);
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
    localStorage.removeItem('currentUser');
    localStorage.removeItem('token');
    this.currentUserSubject.next(null);
  }

  /**
   * Discard a session the server has rejected with a 401.
   *
   * Invoked by AuthInterceptor. This is what stops the repeated
   * "Rejected bearer token" warnings: the dead token is removed from
   * localStorage, so it is no longer sent on subsequent requests.
   */
  handleUnauthorized(): void {
    const hadSession = !!localStorage.getItem('token') || !!localStorage.getItem('currentUser');
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
    return !!localStorage.getItem('token');
  }

  /**
   * Get current user token
   */
  getToken(): string | null {
    return localStorage.getItem('token');
  }

  /**
   * Get current user data
   */
  getCurrentUser(): any {
    return localStorage.getItem('currentUser') ? JSON.parse(localStorage.getItem('currentUser')!) : null;
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
          localStorage.setItem('currentUser', JSON.stringify(response.user));
          this.currentUserSubject.next(response.user);
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
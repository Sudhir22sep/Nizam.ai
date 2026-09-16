import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import {
  HttpErrorResponse,
  HttpEvent,
  HttpHandler,
  HttpInterceptor,
  HttpRequest
} from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { AuthService } from '../services/auth.service';

/**
 * Attaches the stored JWT to API requests and reacts to rejected tokens.
 *
 * Why this is needed: a token left in localStorage that was signed with an older
 * (or different) JWT_SECRET is rejected by the server on every request. The
 * server responds 401 and logs "Rejected bearer token: invalid signature", but
 * without this interceptor the client keeps the dead token and keeps retrying,
 * so the same 401 is produced forever. On a 401 the interceptor clears the
 * stale session so the app self-heals and the user can log in again.
 */
@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly authService = inject(AuthService);

  private static readonly API_PREFIX = '/api/';

  /**
   * Login/register must never carry a stored Authorization header: a stale token
   * must not be able to interfere with signing in again.
   */
  private static readonly TOKEN_FREE_URLS = ['/api/auth/login', '/api/auth/register'];

  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    const isApiRequest = req.url.startsWith(AuthInterceptor.API_PREFIX);
    const isTokenFreeUrl = AuthInterceptor.TOKEN_FREE_URLS.some((url) => req.url.startsWith(url));

    let request = req;

    // localStorage only exists in the browser; during SSR the request is left untouched.
    if (isApiRequest && !isTokenFreeUrl && !req.headers.has('Authorization') && isPlatformBrowser(this.platformId)) {
      const token = this.authService.getToken();
      if (token) {
        request = req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
      }
    }

    // A 401 is only meaningful for the session when the request actually carried a token.
    const carriedToken = request.headers.has('Authorization');

    return next.handle(request).pipe(
      catchError((error: HttpErrorResponse) => {
        if (error.status === 401 && carriedToken) {
          this.authService.handleUnauthorized();
        }
        return throwError(() => error);
      })
    );
  }
}
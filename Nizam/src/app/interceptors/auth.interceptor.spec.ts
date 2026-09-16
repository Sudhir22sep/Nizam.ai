import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import {
  HTTP_INTERCEPTORS,
  HttpClient,
  provideHttpClient,
  withInterceptorsFromDi
} from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { vi } from 'vitest';
import { AuthInterceptor } from './auth.interceptor';
import { AuthService } from '../services/auth.service';

describe('AuthInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let authService: { getToken: ReturnType<typeof vi.fn>; handleUnauthorized: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    localStorage.clear();

    // Mocked so this spec exercises the interceptor's wiring only. The handler's
    // own behaviour is covered by auth.service.spec.ts.
    authService = {
      getToken: vi.fn(() => localStorage.getItem('token')),
      handleUnauthorized: vi.fn()
    };

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: AuthService, useValue: authService },
        { provide: HTTP_INTERCEPTORS, useClass: AuthInterceptor, multi: true }
      ]
    });

    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  it('attaches the stored token to API requests', () => {
    localStorage.setItem('token', 'stored-token');

    http.get('/api/wishlist').subscribe();

    const req = httpMock.expectOne('/api/wishlist');
    expect(req.request.headers.get('Authorization')).toBe('Bearer stored-token');
    req.flush({ success: true, wishlists: [] });
  });

  it('does not attach a token when none is stored', () => {
    http.get('/api/wishlist').subscribe();

    const req = httpMock.expectOne('/api/wishlist');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({ success: true, wishlists: [] });
  });

  it('never attaches a stale token to login or register', () => {
    localStorage.setItem('token', 'stale-token');

    http.post('/api/auth/login', {}).subscribe();
    http.post('/api/auth/register', {}).subscribe();

    const loginReq = httpMock.expectOne('/api/auth/login');
    const registerReq = httpMock.expectOne('/api/auth/register');

    expect(loginReq.request.headers.has('Authorization')).toBe(false);
    expect(registerReq.request.headers.has('Authorization')).toBe(false);

    loginReq.flush({});
    registerReq.flush({});
  });

  it('reports a rejected token to the session handler', () => {
    localStorage.setItem('token', 'stale-token');

    http.get('/api/wishlist').subscribe({ error: () => undefined });

    const req = httpMock.expectOne('/api/wishlist');
    req.flush(
      { success: false, message: 'Invalid or expired token.' },
      { status: 401, statusText: 'Unauthorized' }
    );

    expect(authService.handleUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('ignores a 401 for a request that carried no token', () => {
    http.get('/api/wishlist').subscribe({ error: () => undefined });

    const req = httpMock.expectOne('/api/wishlist');
    req.flush(
      { success: false, message: 'Authorization header required' },
      { status: 401, statusText: 'Unauthorized' }
    );

    expect(authService.handleUnauthorized).not.toHaveBeenCalled();
  });

  it('ignores non-401 failures', () => {
    localStorage.setItem('token', 'stored-token');

    http.get('/api/wishlist').subscribe({ error: () => undefined });

    const req = httpMock.expectOne('/api/wishlist');
    req.flush({ success: false }, { status: 500, statusText: 'Server Error' });

    expect(authService.handleUnauthorized).not.toHaveBeenCalled();
  });
});

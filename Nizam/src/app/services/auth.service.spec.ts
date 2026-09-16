import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { vi } from 'vitest';
import { AuthService } from './auth.service';

/**
 * Instantiated directly (instead of through TestBed) because the vitest/esbuild
 * transform does not emit the decorator metadata Angular DI needs for a class
 * with constructor dependencies.
 */
describe('AuthService.handleUnauthorized()', () => {
  let router: { url: string; navigate: ReturnType<typeof vi.fn> };
  let service: AuthService;

  beforeEach(() => {
    localStorage.clear();
    router = { url: '/wishlist', navigate: vi.fn() };
    service = new AuthService({} as HttpClient, router as unknown as Router);
  });

  afterEach(() => localStorage.clear());

  it('discards the stored session so the rejected token is not retried', () => {
    localStorage.setItem('token', 'stale-token');
    localStorage.setItem('currentUser', JSON.stringify({ id: '1', email: 'user@example.com' }));

    service.handleUnauthorized();

    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('currentUser')).toBeNull();
    expect(service.isLoggedIn()).toBe(false);
    expect(router.navigate).toHaveBeenCalledWith(['/login']);
  });

  it('returns the user to the page they were on after logging in again', () => {
    localStorage.setItem('token', 'stale-token');
    router.url = '/orders';

    service.handleUnauthorized();

    expect(service.redirectUrl).toBe('/orders');
  });

  it('does not redirect when no session existed', () => {
    service.handleUnauthorized();

    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('does not redirect while the user is already on the login page', () => {
    localStorage.setItem('token', 'stale-token');
    router.url = '/login';

    service.handleUnauthorized();

    expect(router.navigate).not.toHaveBeenCalled();
  });
});
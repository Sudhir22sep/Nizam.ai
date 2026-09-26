import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { LoginComponent } from './login.component';
import { AuthService } from '../../services/auth.service';

/**
 * The social handshake reads `window.location`, so each test drives the query
 * string through jsdom's history API instead of stubbing globals.
 */
describe('LoginComponent social sign-in', () => {
  let authService: {
    isLoggedIn: ReturnType<typeof vi.fn>;
    getSocialProviders: ReturnType<typeof vi.fn>;
    completeSocialLogin: ReturnType<typeof vi.fn>;
    startSocialLogin: ReturnType<typeof vi.fn>;
    redirectUrl: string | null;
  };

  /** Points jsdom at /login with the given query, without a real navigation. */
  function setSearch(search: string): void {
    window.history.replaceState({}, '', `/login${search}`);
  }

  beforeEach(async () => {
    authService = {
      isLoggedIn: vi.fn().mockReturnValue(false),
      getSocialProviders: vi.fn().mockReturnValue(of([])),
      completeSocialLogin: vi.fn().mockReturnValue(of({ success: true })),
      startSocialLogin: vi.fn(),
      redirectUrl: null,
    };

    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [provideRouter([]), { provide: AuthService, useValue: authService }],
    }).compileComponents();
  });

  afterEach(() => setSearch(''));

  it('keeps the social buttons hidden when the server offers no providers', () => {
    setSearch('');

    const fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;

    expect(fixture.componentInstance.socialProviders).toEqual([]);
    expect(element.querySelector('.social-login')).toBeFalsy();
  });

  it('renders a button for each provider the server reports', () => {
    setSearch('');
    authService.getSocialProviders.mockReturnValue(of(['google', 'facebook']));

    const fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelectorAll('.social-btn').length).toBe(2);
    expect(element.querySelector('.social-btn--google')?.textContent).toContain('Continue with Google');
    expect(element.querySelector('.social-btn--facebook')?.textContent).toContain('Continue with Facebook');
  });

  it('exchanges the one-time cookie for a session after the provider redirects back', () => {
    setSearch('?socialCallback=1');
    authService.redirectUrl = '/wishlist';
    const navigateByUrl = vi.spyOn(TestBed.inject(Router), 'navigateByUrl');

    const fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();

    expect(authService.completeSocialLogin).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.completingSocialLogin).toBe(false);
    // Asserted on the call rather than Router.url: the test router has no
    // /wishlist route, so a real navigation would be rejected.
    expect(navigateByUrl).toHaveBeenCalledWith('/wishlist');
  });

  it('falls back to the home page when there is no saved destination', () => {
    setSearch('?socialCallback=1');
    const navigateByUrl = vi.spyOn(TestBed.inject(Router), 'navigateByUrl');

    const fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();

    expect(navigateByUrl).toHaveBeenCalledWith('/');
  });

  it('surfaces a friendly message when the user cancels at the provider', () => {
    setSearch('?socialError=denied');

    const fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();

    expect(authService.completeSocialLogin).not.toHaveBeenCalled();
    expect(fixture.componentInstance.errorMessage).toContain('cancelled');
  });

  it('explains a failed state verification without exposing internals', () => {
    setSearch('?socialError=state_mismatch');

    const fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();

    expect(fixture.componentInstance.errorMessage).toContain('expired');
  });

  it('recovers from an exchange failure and leaves the form usable', () => {
    setSearch('?socialCallback=1');
    authService.completeSocialLogin.mockReturnValue(throwError(() => new Error('no cookie')));

    const fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();

    expect(fixture.componentInstance.completingSocialLogin).toBe(false);
    expect(fixture.componentInstance.errorMessage).toContain('could not complete');
  });

  it('clears a stale error when the user starts a new attempt', () => {
    setSearch('');
    authService.getSocialProviders.mockReturnValue(of(['google']));

    const fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.errorMessage = 'stale failure';

    component.loginWith('google');

    expect(component.errorMessage).toBeNull();
    expect(authService.startSocialLogin).toHaveBeenCalledWith('google');
  });
});

import { TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { App } from './app';
import { routes } from './app.routes';
import { AuthGuard } from './guards/auth.guard';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App, RouterTestingModule],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render the footer copyright text', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const footerText = compiled.querySelector('.footer-inner')?.textContent || '';
    expect(footerText).toContain('Amma Wears');
  });

  it('renders every footer destination as a real routed link', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const links = Array.from(fixture.nativeElement.querySelectorAll('.site-footer a[routerLink]')) as HTMLAnchorElement[];
    const destinations = links.map(link => link.getAttribute('href'));

    expect(destinations).toEqual(expect.arrayContaining([
      '/', '/products', '/cart', '/wishlist', '/about', '/contact', '/orders', '/login'
    ]));
    expect(links.every(link => link.tagName === 'A' && link.textContent?.trim())).toBe(true);
  });

  it('keeps the customer chat available as a separate floating control', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('app-customer-chat')).toBeTruthy();
    expect(compiled.querySelector('.glass-preview-launcher')).toBeFalsy();
  });
});

describe('app routes', () => {
  it('keeps only the landing page out of the lazy chunks', () => {
    // The home page must be ready for the first paint. Every other destination
    // uses loadComponent so its template is fetched on demand; statically
    // importing one would pull it back into the initial bundle and undo the
    // split that keeps the bundle inside its size budget.
    const eager = routes.filter(route => route.component);
    expect(eager.map(route => route.path)).toEqual(['']);

    // Everything that is neither the landing page, the 'home' redirect, nor the
    // catch-all must be split out into its own chunk.
    const lazyPaths = routes
      .filter(route => route.loadComponent)
      .map(route => route.path);
    expect(lazyPaths).not.toContain('');
    expect(lazyPaths).not.toContain('home');
    expect(lazyPaths).not.toContain('**');
    expect(lazyPaths.length).toBe(14);
  });

  it('keeps the auth guard on every private destination', () => {
    const guarded = new Set(['checkout', 'orders', 'wishlist', 'checkout-success']);
    const privateRoutes = routes.filter(
      route => route.path && !route.path.includes(':') && route.path !== 'home' && route.path !== '**',
    );

    for (const route of privateRoutes) {
      const shouldBeGuarded = guarded.has(route.path);
      expect(route.canActivate?.includes(AuthGuard) ?? false).toBe(shouldBeGuarded);
    }
  });
});

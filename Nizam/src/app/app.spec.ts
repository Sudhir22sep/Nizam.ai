import { TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { App } from './app';

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
      '/home', '/products', '/cart', '/wishlist', '/about', '/contact', '/orders', '/login'
    ]));
    expect(links.every(link => link.tagName === 'A' && link.textContent?.trim())).toBe(true);
  });

  it('opens the site-wide glass preview from its launcher', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    const launcher = compiled.querySelector('.glass-preview-launcher') as HTMLButtonElement;

    expect(compiled.querySelector('#site-glass-preview .glass-popup--open')).toBeFalsy();
    launcher.click();
    fixture.detectChanges();

    expect(compiled.querySelector('#site-glass-preview .glass-popup--open')).toBeTruthy();
    expect(compiled.querySelector('#site-glass-preview')?.textContent).toContain('Premium essentials');

    const primary = compiled.querySelector('.glass-preview-actions .btn-primary') as HTMLElement;
    const secondary = compiled.querySelector('.glass-preview-actions .btn-ghost') as HTMLElement;
    expect(getComputedStyle(primary).color).toBe('rgb(255, 255, 255)');
    expect(getComputedStyle(secondary).color).toBe('rgb(255, 255, 255)');
  });
});

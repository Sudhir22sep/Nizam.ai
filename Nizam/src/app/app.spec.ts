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

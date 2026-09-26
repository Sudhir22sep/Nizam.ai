import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
import { HomeComponent } from './home.component';

describe('HomeComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HomeComponent],
      providers: [provideRouter([])]
    }).compileComponents();
  });

  it('renders the interactive hero and featured collection carousel', () => {
    const fixture = TestBed.createComponent(HomeComponent);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('app-hero-banner .hero')).toBeTruthy();
    expect(element.querySelectorAll('app-rotational-carousel .carousel__item').length).toBe(3);
    expect(element.querySelector('.carousel__item--active h3')?.textContent).toContain('Modern tailoring');
  });

  it('opens the style-help popup with a visible, high-contrast call to action', () => {
    const fixture = TestBed.createComponent(HomeComponent);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    const trigger = element.querySelector('.contact-copy .cta-button') as HTMLButtonElement;

    expect(element.querySelector('app-glass-popup .glass-popup--open')).toBeFalsy();
    trigger.click();
    fixture.detectChanges();

    const primaryAction = element.querySelector('.popup-action--primary') as HTMLElement;

    expect(element.querySelector('app-glass-popup .glass-popup--open')).toBeTruthy();
    expect(primaryAction.textContent).toContain('Ask a stylist');

    // The contrast itself is asserted against the stylesheet source rather than
    // getComputedStyle: this test environment never injects component CSS into
    // the document (document.styleSheets is empty under jsdom + the Angular
    // vite plugin), so computed styles would only report jsdom's unstyled
    // defaults and could never pass or fail meaningfully.
    const homeStyles = readFileSync(
      resolve(__dirname, 'home.component.css'),
      'utf8',
    );
    const primaryRule = homeStyles.match(/\.popup-action--primary\s*\{[^}]*\}/)?.[0] ?? '';
    expect(primaryRule).toContain('color: #fff');
    expect(primaryRule).toContain('-webkit-text-fill-color: #fff');
  });
});
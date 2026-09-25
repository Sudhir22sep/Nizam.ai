import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { HeroBannerComponent } from './hero-banner.component';

describe('HeroBannerComponent', () => {
  let fixture: ComponentFixture<HeroBannerComponent>;
  let component: HeroBannerComponent;
  let element: HTMLElement;

  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query.includes('hover: hover'),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn()
      }))
    });

    TestBed.configureTestingModule({
      imports: [HeroBannerComponent],
      providers: [provideRouter([])]
    });

    fixture = TestBed.createComponent(HeroBannerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    element = fixture.nativeElement as HTMLElement;
  });

  it('renders the three visual planes and shopping content', () => {
    expect(element.querySelector('.hero__backdrop')).toBeTruthy();
    expect(element.querySelector('.hero__midground')).toBeTruthy();
    expect(element.querySelector('.hero__foreground')).toBeTruthy();
    expect(element.querySelector('.hero__headline')?.textContent).toContain('Everyday luxury');
    expect(element.querySelector('.hero__image-frame img')?.getAttribute('src')).toContain('hero.jpg');
  });

  it('tracks pointer position and applies layer-specific transforms', () => {
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 1000, height: 600,
      right: 1000, bottom: 600, x: 0, y: 0,
      toJSON: () => ({})
    } as DOMRect);

    component.onMouseMove(new MouseEvent('mousemove', { clientX: 750, clientY: 450 }));

    return new Promise<void>(resolve => requestAnimationFrame(() => {
      expect(element.style.getPropertyValue('--parallax-front-x')).toBe('10.50px');
      expect(element.style.getPropertyValue('--parallax-mid-x')).toBe('-4.41px');
      expect(element.style.getPropertyValue('--parallax-bg-x')).toBe('1.68px');
      resolve();
    }));
  });

  it('resets transforms when the pointer leaves', () => {
    component.onMouseLeave();
    expect(element.style.getPropertyValue('--parallax-front-x')).toBe('0.00px');
    expect(element.style.getPropertyValue('--parallax-tilt-y')).toBe('0.00deg');
  });

  it('uses a static fallback when the foreground image fails', () => {
    const image = element.querySelector('img') as HTMLImageElement;
    component.onImageError({ target: image } as unknown as Event);
    expect(image.hidden).toBe(true);
    expect(element.querySelector('.hero__figure')?.classList.contains('hero__figure--fallback')).toBe(true);
  });
});

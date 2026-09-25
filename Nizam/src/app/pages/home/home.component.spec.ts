import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
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
    const primaryStyle = getComputedStyle(primaryAction);

    expect(element.querySelector('app-glass-popup .glass-popup--open')).toBeTruthy();
    expect(primaryAction.textContent).toContain('Ask a stylist');
    expect(primaryStyle.color).toBe('rgb(255, 255, 255)');
    expect(primaryStyle.webkitTextFillColor).toBe('rgb(255, 255, 255)');
  });
});
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
});
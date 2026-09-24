import { provideRouter } from '@angular/router';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RotationalCarouselComponent, FeaturedCollection } from './rotational-carousel.component';

const collections: FeaturedCollection[] = [
  { title: 'Summer Linen', description: 'Light layers for warm days.', imageUrl: '/summer.jpg' },
  { title: 'After Dark', description: 'Polished evening essentials.', imageUrl: '/evening.jpg' },
  { title: 'Everyday Ease', description: 'Comfort-first favourites.', imageUrl: '/everyday.jpg' }
];

describe('RotationalCarouselComponent', () => {
  let fixture: ComponentFixture<RotationalCarouselComponent>;
  let component: RotationalCarouselComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RotationalCarouselComponent],
      providers: [provideRouter([])]
    }).compileComponents();
    fixture = TestBed.createComponent(RotationalCarouselComponent);
    component = fixture.componentInstance;
    component.collections = collections;
    fixture.detectChanges();
  });

  it('renders collections and exposes controls', () => {
    expect(fixture.nativeElement.querySelectorAll('.carousel__item').length).toBe(3);
    expect(fixture.nativeElement.querySelectorAll('.carousel__button').length).toBe(2);
  });

  it('wraps the active item when moving next and previous', () => {
    component.next();
    expect(component.activeIndex).toBe(1);
    component.next();
    component.next();
    expect(component.activeIndex).toBe(0);
    component.prev();
    expect(component.activeIndex).toBe(2);
  });

  it('uses internal Angular routes for collection links', () => {
    component.collections = [{ ...collections[0], href: '/products' }];
    fixture.componentRef.setInput('collections', component.collections);
    fixture.detectChanges();

    const link = fixture.nativeElement.querySelector('a.carousel__link') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/products');
  });

  it('does not rotate for fewer than two collections', () => {
    component.collections = [collections[0]];
    component.ngOnChanges();
    component.next();
    expect(component.activeIndex).toBe(0);
  });
});

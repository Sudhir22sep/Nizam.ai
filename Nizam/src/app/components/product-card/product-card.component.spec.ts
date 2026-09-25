import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ProductCardComponent } from './product-card.component';
import { Product } from '../../services/product.service';
import { CurrencyService } from '../../services/currency.service';

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'test-prod-1',
    name: 'Silk Linen Kurta',
    description: 'Handcrafted premium silk kurta for festive celebrations.',
    basePrice: 2499,
    originalPrice: 3499,
    rating: 4.8,
    currency: 'INR',
    category: 'Men',
    images: ['https://example.com/photo1.jpg'],
    variants: [],
    tags: ['festive', 'traditional'],
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
}

describe('ProductCardComponent', () => {
  let fixture: ComponentFixture<ProductCardComponent>;
  let component: ProductCardComponent;
  let element: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ProductCardComponent],
      providers: [provideRouter([]), CurrencyService]
    });

    fixture = TestBed.createComponent(ProductCardComponent);
    component = fixture.componentInstance;
    component.product = makeProduct();
    fixture.detectChanges();
    element = fixture.nativeElement as HTMLElement;
  });

  it('renders product details correctly', () => {
    expect(element.querySelector('.tilt-card__name')?.textContent?.trim()).toBe('Silk Linen Kurta');
    expect(element.querySelector('.tilt-card__eyebrow')?.textContent?.trim()).toBe('Men');
    expect(element.querySelector('.tilt-card__description')?.textContent?.trim()).toContain('Handcrafted premium silk kurta');
    expect(element.querySelector('.tilt-card__badge--discount')?.textContent?.trim()).toBe('29% off');
    expect(element.querySelector('.tilt-card__badge--rating')?.textContent?.trim()).toContain('4.8');
  });

  it('rotates every product image with accessible controls', () => {
    component.product = makeProduct({ images: ['photo-1.jpg', 'photo-2.jpg', 'photo-3.jpg'] });
    fixture.componentRef.setInput('product', component.product);
    fixture.detectChanges();

    const images = element.querySelectorAll('.tilt-card__image');
    expect(images.length).toBe(3);
    expect(images[0].classList).toContain('tilt-card__image--active');

    const next = element.querySelectorAll('.tilt-card__gallery-controls button')[1] as HTMLButtonElement;
    next.click();
    fixture.detectChanges();

    expect(component.image).toBe('/photo-2.jpg');
    expect(images[1].classList).toContain('tilt-card__image--active');
  });

  it('computes discountPercent accurately', () => {
    expect(component.discountPercent).toBe(29);

    component.product = makeProduct({ originalPrice: undefined });
    expect(component.discountPercent).toBeNull();

    component.product = makeProduct({ originalPrice: 2000, basePrice: 2500 });
    expect(component.discountPercent).toBeNull();
  });

  it('emits quickAdd event when quick add button is clicked', () => {
    const emitSpy = vi.spyOn(component.quickAdd, 'emit');
    const quickAddBtn = element.querySelector('.tilt-card__quick-add') as HTMLButtonElement;
    quickAddBtn.click();
    expect(emitSpy).toHaveBeenCalledWith(component.product);
  });

  it('emits wishlistToggle event when wishlist button is clicked', () => {
    const emitSpy = vi.spyOn(component.wishlistToggle, 'emit');
    const heartBtn = element.querySelector('.tilt-card__heart') as HTMLButtonElement;
    heartBtn.click();
    expect(emitSpy).toHaveBeenCalledWith(component.product);

    const wishlistBtn = element.querySelector('.tilt-card__wishlist') as HTMLButtonElement;
    wishlistBtn.click();
    expect(emitSpy).toHaveBeenCalledTimes(2);
  });

  it('resets tilt custom properties on mouseleave', () => {
    component.onMouseEnter(new MouseEvent('mouseenter', { clientX: 100, clientY: 100 }));
    component.onMouseLeave();

    expect(element.style.getPropertyValue('--rotate-x')).toBe('0deg');
    expect(element.style.getPropertyValue('--rotate-y')).toBe('0deg');
    expect(element.style.getPropertyValue('--card-scale')).toBe('1');
    expect(element.classList.contains('is-tilting')).toBe(false);
  });

  it('cleans up listeners and animations on destroy', () => {
    component.onMouseEnter(new MouseEvent('mouseenter', { clientX: 100, clientY: 100 }));
    expect(() => fixture.destroy()).not.toThrow();
  });
});

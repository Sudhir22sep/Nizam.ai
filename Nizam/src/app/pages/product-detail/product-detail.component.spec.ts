import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { Product, ProductService } from '../../services/product.service';
import { CartService } from '../../services/cart.service';
import { WishlistService } from '../../services/wishlist.service';
import { ToastService } from '../../services/toast.service';
import { ProductDetailComponent } from './product-detail.component';

function makeProduct(id: string, name: string, category: string): Product {
  return {
    id,
    name,
    description: `${name} description`,
    basePrice: 1299,
    currency: 'INR',
    category,
    images: [`${id}.jpg`],
    variants: [],
    tags: [],
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date()
  };
}

const catalog: Product[] = [
  makeProduct('1', 'Linen Shirt', 'Men'),
  makeProduct('2', 'Satin Slip Dress', 'Women'),
  makeProduct('3', 'Everyday Tee', 'Men')
];

/**
 * The storefront is zoneless (Angular 21 default, no `zone.js` polyfill), so a
 * component that mutates plain fields after an `await` never schedules change
 * detection. These tests boot the fixture zoneless on purpose and let Angular's
 * own scheduler run; they must never call `fixture.detectChanges()` after the
 * async work completes, otherwise they would mask the regression.
 */
async function flushZonelessScheduler(fixture: ComponentFixture<unknown>): Promise<void> {
  // Flush the component's promise chain. The first scheduler tick that follows
  // this point switches Angular's zoneless scheduler to microtask mode, so
  // notifications triggered by the awaited work are delivered on microtasks.
  await fixture.whenStable();
  // Angular's very first zoneless notification is queued through
  // `scheduleCallbackWithRafRace` — a `setTimeout(0)` racing a
  // `requestAnimationFrame` callback — so the pending change-detection pass
  // only runs after one animation-frame turn. Awaiting a frame (with a
  // timeout fallback for environments where the frame is cancelled) lets the
  // scheduler's own callback run. This must never be replaced by a manual
  // `fixture.detectChanges()`, which would mask a zoneless regression.
  await new Promise<void>(resolveAnimationFrame => {
    const fallback = setTimeout(() => resolveAnimationFrame(), 50);
    requestAnimationFrame(() => {
      clearTimeout(fallback);
      resolveAnimationFrame();
    });
  });
}

describe('ProductDetailComponent (zoneless)', () => {
  let cartService = { addToCart: vi.fn() };
  let toastService = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() };
  let resolveCatalog: () => void = () => {};

  function createComponent(productId: string): ComponentFixture<ProductDetailComponent> {
    cartService = { addToCart: vi.fn() };
    toastService = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() };

    let release: () => void = () => {};
    const catalogReady = new Promise<void>(resolve => {
      release = resolve;
    });
    resolveCatalog = release;

    TestBed.configureTestingModule({
      imports: [ProductDetailComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        {
          provide: ProductService,
          useValue: {
            ensureLoaded: () => catalogReady,
            getProductById: (id: string) => catalog.find(product => product.id === id),
            getProductsByCategory: (category: string) => catalog.filter(product => product.category === category),
            fetchProductById: () => Promise.resolve(undefined),
            addProductImage: vi.fn(),
            removeProductImage: vi.fn()
          }
        },
        { provide: CartService, useValue: cartService },
        {
          provide: WishlistService,
          useValue: {
            getWishlists: () => of([]),
            createWishlist: vi.fn(),
            addItemToWishlist: vi.fn()
          }
        },
        { provide: ToastService, useValue: toastService },
        {
          provide: ActivatedRoute,
          // The component reads the raw `params` dictionary (`params['id']`), so the
          // stub mirrors the router's plain-object shape rather than a ParamMap.
          useValue: { params: of({ id: productId }) }
        }
      ]
    });

    const fixture = TestBed.createComponent(ProductDetailComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('leaves the loading state and renders the product once the catalog resolves', async () => {
    const fixture = createComponent('1');
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.textContent).toContain('Loading product details');

    resolveCatalog();
    await flushZonelessScheduler(fixture);

    expect(compiled.textContent).not.toContain('Loading product details');
    expect(compiled.querySelector('h1')?.textContent?.trim()).toBe('Linen Shirt');
    expect(compiled.querySelectorAll('.size-btn').length).toBeGreaterThan(0);
  });

  it('replaces the loading state with an error message for an unknown product', async () => {
    const fixture = createComponent('missing');
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.textContent).toContain('Loading product details');

    resolveCatalog();
    await flushZonelessScheduler(fixture);

    expect(compiled.textContent).toContain('We could not find that product');
    expect(compiled.textContent).not.toContain('Loading product details');
  });

  it('asks for a size before adding a sized product to the cart', async () => {
    const fixture = createComponent('1');

    resolveCatalog();
    await flushZonelessScheduler(fixture);

    fixture.componentInstance.addToCart();

    expect(cartService.addToCart).not.toHaveBeenCalled();
    expect(toastService.warning).toHaveBeenCalledWith('Please choose a size before adding this item to your cart.');
  });

  it('renders the product gallery as a 3D coverflow when multiple images exist', async () => {
    const fixture = createComponent('2');
    resolveCatalog();
    await flushZonelessScheduler(fixture);

    const compiled = fixture.nativeElement as HTMLElement;
    const items = compiled.querySelectorAll('.product-gallery-3d__item');
    expect(items.length).toBe(3);
    expect(items[0].classList).toContain('product-gallery-3d__item--active');

    const nextButton = compiled.querySelectorAll('.product-gallery-3d__controls > button')[1] as HTMLButtonElement;
    nextButton.click();
    await flushZonelessScheduler(fixture);
    expect(fixture.componentInstance.selectedImageIndex()).toBe(1);
    expect(items[1].classList).toContain('product-gallery-3d__item--active');
  });

  it('adds the selected size and unit price to the cart', async () => {
    const fixture = createComponent('1');

    resolveCatalog();
    await flushZonelessScheduler(fixture);

    fixture.componentInstance.selectSize('M');
    fixture.componentInstance.addToCart();

    expect(cartService.addToCart).toHaveBeenCalledWith(
      expect.objectContaining({ id: '1' }),
      1,
      'M',
      1299
    );
  });
});

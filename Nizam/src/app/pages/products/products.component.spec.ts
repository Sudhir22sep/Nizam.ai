import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { Product, ProductService } from '../../services/product.service';
import { CartService } from '../../services/cart.service';
import { WishlistService } from '../../services/wishlist.service';
import { ToastService } from '../../services/toast.service';
import { ProductsComponent } from './products.component';

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
  makeProduct('2', 'Wool Coat', 'Men'),
  makeProduct('3', 'Silk Saree', 'Women')
];

describe('ProductsComponent', () => {
  let productsSignal = signal<Product[]>([]);
  let cartService = { addToCart: vi.fn(() => true), getItems: vi.fn(() => []) };
  let toastService = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

  function createComponent(category?: string) {
    productsSignal = signal<Product[]>([...catalog]);
    cartService = { addToCart: vi.fn(() => true), getItems: vi.fn(() => []) };
    toastService = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

    TestBed.configureTestingModule({
      imports: [ProductsComponent],
      providers: [
        provideRouter([]),
        {
          provide: ProductService,
          useValue: { getProducts: () => productsSignal, ensureLoaded: () => Promise.resolve() }
        },
        { provide: CartService, useValue: cartService },
        {
          provide: WishlistService,
          useValue: { getWishlists: () => of([]), createWishlist: vi.fn(), addItemToWishlist: vi.fn() }
        },
        { provide: ToastService, useValue: toastService },
        {
          provide: ActivatedRoute,
          useValue: { queryParamMap: of(convertToParamMap(category ? { category } : {})) }
        }
      ]
    });

    const fixture = TestBed.createComponent(ProductsComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('renders one card per product and one filter button per category', () => {
    const compiled = createComponent().nativeElement as HTMLElement;

    expect(compiled.querySelectorAll('.product-card').length).toBe(3);
    const filters = Array.from(compiled.querySelectorAll('.filter-btn'))
      .map(button => button.textContent?.trim());
    expect(filters).toEqual(['All', 'Men', 'Women']);
  });

  it('renders a live 3D product showcase above the catalog', () => {
    const compiled = createComponent().nativeElement as HTMLElement;
    expect(compiled.querySelectorAll('.collection-showcase__card').length).toBe(3);
    expect(compiled.querySelector('.collection-showcase h1')?.textContent).toContain('Style in motion');
    expect(compiled.querySelector('.collection-showcase__stage')?.getAttribute('aria-label')).toBe('Featured products');
  });

  it('uses the reusable 3D card for every product', () => {
    const compiled = createComponent().nativeElement as HTMLElement;
    expect(compiled.querySelectorAll('app-product-card.product-card').length).toBe(3);
    expect(compiled.querySelectorAll('.tilt-card__inner').length).toBe(3);
  });

  it('filters the grid by the category query param, ignoring case', () => {
    const compiled = createComponent('men').nativeElement as HTMLElement;

    expect(compiled.querySelectorAll('.product-card').length).toBe(2);
    expect(compiled.textContent).toContain('Linen Shirt');
    expect(compiled.textContent).not.toContain('Silk Saree');
  });

  it('re-renders the grid when the catalog signal changes', () => {
    const fixture = createComponent();
    const compiled = fixture.nativeElement as HTMLElement;

    productsSignal.set([makeProduct('4', 'Cotton Kurta', 'Men')]);
    fixture.detectChanges();

    expect(compiled.querySelectorAll('.product-card').length).toBe(1);
    expect(compiled.textContent).toContain('Cotton Kurta');
  });

  it('navigates with the category query param when a filter is applied', () => {
    const fixture = createComponent();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    fixture.componentInstance.filterByCategory('Women');

    expect(navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ queryParams: { category: 'Women' } })
    );
  });

  it('adds a product to the cart and confirms it through the toast service', () => {
    const fixture = createComponent();

    fixture.componentInstance.addToCart(catalog[0]);

    expect(cartService.addToCart).toHaveBeenCalledWith(catalog[0], 1);
    expect(toastService.success).toHaveBeenCalledWith('Linen Shirt added to cart.');
  });

  it('exposes the responsive catalog controls with accessible labels', () => {
    const compiled = createComponent().nativeElement as HTMLElement;

    expect(compiled.querySelector('.catalog-search input[type="search"]')).toBeTruthy();
    expect(compiled.querySelector('.catalog-sort select[aria-label="Sort products"]')).toBeTruthy();
    expect(compiled.querySelector('.filters[aria-label="Filter products by category"]')).toBeTruthy();
    expect(compiled.querySelectorAll('.filter-btn')).toHaveLength(3);
  });

  it('searches across product names, descriptions, categories and tags', () => {
    const fixture = createComponent();
    fixture.componentInstance.searchQuery.set('linen');
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelectorAll('.product-card').length).toBe(1);
    expect(compiled.textContent).toContain('Linen Shirt');
  });

  it('sorts the filtered catalog by price', () => {
    const fixture = createComponent();
    productsSignal.set([
      { ...catalog[0], basePrice: 1800 },
      { ...catalog[1], basePrice: 900 },
      { ...catalog[2], basePrice: 1200 }
    ]);
    fixture.componentInstance.sortBy.set('price-low');
    fixture.detectChanges();
    const names = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.tilt-card__name'))
      .map(element => element.textContent?.trim());

    expect(names).toEqual(['Wool Coat', 'Silk Saree', 'Linen Shirt']);
  });
});

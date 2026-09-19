import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { normalizeProductImages, normalizeProductVariants, primaryProductImage, productSizes, variantPrice } from './product.service';
import { ProductService } from './product.service';
import { Product } from './product.service';

// Mock product data for testing
const mockProducts: Product[] = [
  {
    id: '1',
    name: 'Test Product 1',
    description: 'Test Description 1',
    basePrice: 100,
    currency: 'USD',
    category: 'Test Category',
    images: ['test1.jpg'],
    variants: [],
    tags: [],
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    id: '2',
    name: 'Test Product 2',
    description: 'Test Description 2',
    basePrice: 200,
    currency: 'USD',
    category: 'Test Category',
    images: ['test2.jpg'],
    variants: [],
    tags: [],
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date()
  },
  {
    id: '3',
    name: 'Test Product 3',
    description: 'Test Description 3',
    basePrice: 150,
    currency: 'USD',
    category: 'Another Category',
    images: ['test3.jpg'],
    variants: [],
    tags: [],
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date()
  }
];

describe('ProductService', () => {
  let service: ProductService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [ProductService, provideHttpClient(), provideHttpClientTesting()]
    });
    service = TestBed.inject(ProductService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getProducts()', () => {
    it('should return products signal', () => {
      const products = service.getProducts();
      expect(products).toBeDefined();
      // Initially products should be empty until loaded
      expect(products()).toEqual([]);
    });
  });

  describe('getProductById()', () => {
    it('should return undefined for non-existent product when no products loaded', () => {
      const product = service.getProductById('999');
      expect(product).toBeUndefined();
    });

    it('should return product when found', () => {
      // Manually set products for testing
      (service as any).productsSignal.set(mockProducts);
      
      const product = service.getProductById('2');
      expect(product).toBeDefined();
      expect(product?.id).toBe('2');
      expect(product?.name).toBe('Test Product 2');
    });

    it('should return undefined for non-existent product ID', () => {
      // Manually set products for testing
      (service as any).productsSignal.set(mockProducts);
      
      const product = service.getProductById('999');
      expect(product).toBeUndefined();
    });
  });

  describe('getProductsByCategory()', () => {
    it('should return empty array when no products loaded', () => {
      const products = service.getProductsByCategory('Test');
      expect(products).toEqual([]);
    });

    it('should return products matching category', () => {
      // Manually set products for testing
      (service as any).productsSignal.set(mockProducts);
      
      const products = service.getProductsByCategory('Test Category');
      expect(products.length).toBe(2);
      expect(products[0].name).toBe('Test Product 1');
      expect(products[1].name).toBe('Test Product 2');
    });

    it('should return empty array for non-existent category', () => {
      // Manually set products for testing
      (service as any).productsSignal.set(mockProducts);
      
      const products = service.getProductsByCategory('Non-existent');
      expect(products.length).toBe(0);
    });
  });

  describe('getCategories()', () => {
    it('should return empty array when no products loaded', () => {
      const categories = service.getCategories();
      expect(categories).toEqual([]);
    });

    it('should return unique categories', () => {
      // Manually set products for testing
      (service as any).productsSignal.set(mockProducts);
      
      const categories = service.getCategories();
      expect(categories).toEqual(['Test Category', 'Another Category']);
    });
  });

  // Note: Testing loadProducts() and ensureLoaded() is complex due to SSR/CSR differences
  // CSR differences
  // and file system/network calls. These are better tested with integration tests.
  // For unit tests, we focus on the public methods that don't have complex side effects.

  describe('normalizeProductVariants()/productSizes()/variantPrice()', () => {
    it('should normalize named variants and resolve variant prices', () => {
      const variants = normalizeProductVariants([
        { name: 'M', price: 42 },
        { size: 'L' },
        { name: '', price: null }
      ]);
      expect(variants).toEqual([
        { id: undefined, name: 'M', price: 42 },
        { id: undefined, name: 'L', price: null }
      ]);
      expect(variantPrice({ basePrice: 40, variants }, 'M')).toBe(42);
      expect(variantPrice({ basePrice: 40, variants }, 'L')).toBe(40);
    });

    it('should fall back to category sizes when variants are absent', () => {
      expect(productSizes({ category: 'Men', variants: [] })).toEqual(['XS', 'S', 'M', 'L', 'XL', 'XXL']);
      expect(productSizes({ category: 'Footwear', variants: [] })).toEqual(['UK 6', 'UK 7', 'UK 8', 'UK 9', 'UK 10', 'UK 11']);
      expect(productSizes({ category: 'Accessories', variants: [] })).toEqual(['One Size']);
    });

    it('should keep image paths root-relative on nested detail routes', () => {
      expect(primaryProductImage(['images/products/tee.jpeg'], undefined, 'Tee')).toBe('/images/products/tee.jpeg');
      expect(normalizeProductImages([], undefined, 'Tee')).toEqual([]);
    });
  });
});
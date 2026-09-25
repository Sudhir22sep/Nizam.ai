import { TestBed } from '@angular/core/testing';
import { CART_STORAGE_KEY, CartService } from './cart.service';
import { Product } from './product.service';

describe('CartService', () => {
  let service: CartService;
  let testProduct: Product;

  beforeEach(() => {
    localStorage.removeItem(CART_STORAGE_KEY);
    TestBed.configureTestingModule({
      providers: [CartService]
    });
    service = TestBed.inject(CartService);
    
    // Create a test product
    testProduct = {
      id: '1',
      name: 'Test Product',
      description: 'Test Description',
      basePrice: 100,
      currency: 'USD',
      category: 'Test Category',
      images: ['test.jpg'],
      variants: [],
      tags: [],
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date()
    };
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  afterEach(() => localStorage.removeItem(CART_STORAGE_KEY));

  it('persists and restores a valid variant cart line', () => {
    service.addToCart(testProduct, 2, 'M', 125);
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [CartService] });
    const restored = TestBed.inject(CartService);

    expect(restored.getItems()).toHaveLength(1);
    expect(restored.getItems()[0]).toMatchObject({ quantity: 2, size: 'M', unitPrice: 125 });
  });

  it('discards malformed stored data and clamps restored quantities to stock', () => {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify([
      { product: testProduct, quantity: 20, unitPrice: 100 },
      { product: { id: 'broken' }, quantity: 1, unitPrice: 10 }
    ]));
    testProduct.stock = 3;
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify([
      { product: testProduct, quantity: 20, unitPrice: 100 }
    ]));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [CartService] });

    expect(TestBed.inject(CartService).getItems()[0].quantity).toBe(3);
  });

  it('enforces stock when adding and updating cart lines', () => {
    testProduct.stock = 2;
    service.addToCart(testProduct, 5);
    expect(service.getItems()[0].quantity).toBe(2);
    expect(service.addToCart(testProduct, 1)).toBe(false);
    expect(service.updateQuantity(testProduct.id, 1)).toBe(true);
    expect(service.getItems()[0].quantity).toBe(1);
    expect(service.updateQuantity(testProduct.id, 0)).toBe(true);
    expect(service.getItems()).toEqual([]);
  });

  describe('Initial State', () => {
    it('should start with empty cart', () => {
      expect(service.getItems()).toEqual([]);
      expect(service.getItemCount()).toBe(0);
      expect(service.getTotalAmount()).toBe(0);
    });
  });

  describe('addToCart()', () => {
    it('should add product to cart', () => {
      service.addToCart(testProduct, 2);
      
      const items = service.getItems();
      expect(items.length).toBe(1);
      expect(items[0].product).toEqual(testProduct);
      expect(items[0].quantity).toBe(2);
      expect(service.getItemCount()).toBe(2);
      expect(service.getTotalAmount()).toBe(200);
    });

    it('should increment quantity when adding same product again', () => {
      service.addToCart(testProduct, 1);
      service.addToCart(testProduct, 3);
      
      const items = service.getItems();
      expect(items.length).toBe(1);
      expect(items[0].quantity).toBe(4);
      expect(service.getItemCount()).toBe(4);
      expect(service.getTotalAmount()).toBe(400);
    });

    it('should handle adding different products', () => {
      const product2: Product = {
        id: '2',
        name: 'Test Product 2',
        description: 'Test Description 2',
        basePrice: 50,
        currency: 'USD',
        category: 'Test Category',
        images: ['test2.jpg'],
        variants: [],
        tags: [],
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      
      service.addToCart(testProduct, 2);
      service.addToCart(product2, 1);
      
      const items = service.getItems();
      expect(items.length).toBe(2);
      expect(service.getItemCount()).toBe(3);
      expect(service.getTotalAmount()).toBe(250); // 2*100 + 1*50
    });
  });

  describe('removeFromCart()', () => {
    beforeEach(() => {
      // Add some items to cart first
      service.addToCart(testProduct, 3);
    });

    it('should remove product completely from cart', () => {
      service.removeFromCart(testProduct.id);
      
      expect(service.getItems()).toEqual([]);
      expect(service.getItemCount()).toBe(0);
      expect(service.getTotalAmount()).toBe(0);
    });

    it('should do nothing when removing non-existent product', () => {
      service.removeFromCart('999'); // Non-existent ID
      
      const items = service.getItems();
      expect(items.length).toBe(1);
      expect(items[0].quantity).toBe(3);
      expect(service.getItemCount()).toBe(3);
    });
  });

  describe('clearCart()', () => {
    beforeEach(() => {
      // Add some items to cart first
      service.addToCart(testProduct, 2);
    });

    it('should remove all items from cart', () => {
      service.clearCart();
      
      expect(service.getItems()).toEqual([]);
      expect(service.getItemCount()).toBe(0);
      expect(service.getTotalAmount()).toBe(0);
    });
  });

  describe('size-aware cart lines', () => {
    it('should keep different sizes as separate cart lines', () => {
      service.addToCart(testProduct, 1, 'M', 100);
      service.addToCart(testProduct, 2, 'L', 120);

      const items = service.getItems();
      expect(items.length).toBe(2);
      expect(service.getTotalAmount()).toBe(340);
    });

    it('should remove only the selected size line', () => {
      service.addToCart(testProduct, 1, 'M', 100);
      service.addToCart(testProduct, 1, 'L', 120);
      service.removeFromCart(testProduct.id, 'M');

      const items = service.getItems();
      expect(items.length).toBe(1);
      expect(items[0].size).toBe('L');
      expect(service.getTotalAmount()).toBe(120);
    });
  });

  describe('getters', () => {
    it('getItems() should return cart items', () => {
      service.addToCart(testProduct, 1);
      const items = service.getItems();
      expect(items.length).toBe(1);
      expect(items[0].product).toEqual(testProduct);
      expect(items[0].quantity).toBe(1);
      expect(items[0].size).toBeUndefined();
      expect(items[0].unitPrice).toBe(100);
    });

    it('getItemCount() should return total quantity', () => {
      service.addToCart(testProduct, 2);
      service.addToCart(testProduct, 3);
      
      expect(service.getItemCount()).toBe(5);
    });

    it('getTotalAmount() should return total price', () => {
      service.addToCart(testProduct, 2);
      
      expect(service.getTotalAmount()).toBe(200);
    });
  });
});

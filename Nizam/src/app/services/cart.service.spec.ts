import { TestBed } from '@angular/core/testing';
import { CartService } from './cart.service';
import { Product } from './product.service';

describe('CartService', () => {
  let service: CartService;
  let testProduct: Product;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [CartService]
    });
    service = TestBed.inject(CartService);
    
    // Create a test product
    testProduct = {
      id: 1,
      name: 'Test Product',
      description: 'Test Description',
      price: 100,
      image: 'test.jpg',
      category: 'Test Category'
    };
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
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
        id: 2,
        name: 'Test Product 2',
        description: 'Test Description 2',
        price: 50,
        image: 'test2.jpg',
        category: 'Test Category'
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
      service.removeFromCart(999); // Non-existent ID
      
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

  describe('getters', () => {
    it('getItems() should return cart items', () => {
      service.addToCart(testProduct, 1);
      const items = service.getItems();
      expect(items.length).toBe(1);
      expect(items[0].product).toEqual(testProduct);
      expect(items[0].quantity).toBe(1);
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
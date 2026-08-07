import { Injectable, computed, signal } from '@angular/core';
import { Product } from './product.service';

export interface CartItem {
  product: Product;
  quantity: number;
}

@Injectable({
  providedIn: 'root'
})
export class CartService {
  private cartItems = signal<CartItem[]>([]);
  private readonly cartItemsSignal = this.cartItems.asReadonly();

  readonly itemCount = computed(() =>
    this.cartItems().reduce((total, item) => total + item.quantity, 0)
  );

  readonly cartTotal = computed(() =>
    this.cartItems().reduce((total, item) => total + item.product.basePrice * item.quantity, 0)
  );

  getItems() {
    return this.cartItemsSignal();
  }

  getItemCount() {
    return this.itemCount();
  }

  getTotalAmount() {
    return this.cartTotal();
  }

  addToCart(product: Product, quantity = 1) {
    const existing = this.cartItems().find(item => item.product.id === product.id);
    if (existing) {
      this.cartItems.update(items =>
        items.map(item =>
          item.product.id === product.id
            ? { ...item, quantity: item.quantity + quantity }
            : item
        )
      );
    } else {
      this.cartItems.update(items => [...items, { product, quantity }]);
    }
  }

  removeFromCart(productId: string) {
    this.cartItems.update(items => items.filter(item => item.product.id !== productId));
  }

  clearCart() {
    this.cartItems.set([]);
  }
}

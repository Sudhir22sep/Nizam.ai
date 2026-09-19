import { Injectable, computed, signal } from '@angular/core';
import { Product } from './product.service';

export interface CartItem {
  product: Product;
  quantity: number;
  /** Shopper-selected size label; undefined when the product has no size. */
  size?: string;
  /** Snapshot of the unit price for the selected size. */
  unitPrice: number;
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
    this.cartItems().reduce((total, item) => total + item.unitPrice * item.quantity, 0)
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

  addToCart(product: Product, quantity = 1, size?: string, unitPrice?: number) {
    const normalizedSize = size?.trim() || undefined;
    const normalizedUnitPrice =
      typeof unitPrice === 'number' && Number.isFinite(unitPrice) ? unitPrice : product.basePrice;
    const existing = this.cartItems().find(
      item => item.product.id === product.id && (item.size ?? undefined) === normalizedSize
    );
    if (existing) {
      this.cartItems.update(items =>
        items.map(item =>
          item.product.id === product.id && (item.size ?? undefined) === normalizedSize
            ? { ...item, quantity: item.quantity + quantity, unitPrice: normalizedUnitPrice }
            : item
        )
      );
    } else {
      this.cartItems.update(items => [...items, { product, quantity, size: normalizedSize, unitPrice: normalizedUnitPrice }]);
    }
  }

  removeFromCart(productId: string, size?: string) {
    const normalizedSize = size?.trim() || undefined;
    this.cartItems.update(items =>
      items.filter(item => !(item.product.id === productId && (item.size ?? undefined) === normalizedSize))
    );
  }

  clearCart() {
    this.cartItems.set([]);
  }
}

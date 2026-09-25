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

export const CART_STORAGE_KEY = 'amma-wears-cart-v1';
const MAX_CART_QUANTITY = 99;

interface StoredCartItem {
  product: Product;
  quantity: number;
  size?: string;
  unitPrice: number;
}

@Injectable({
  providedIn: 'root'
})
export class CartService {
  private cartItems = signal<CartItem[]>(this.restoreCart());
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

  addToCart(product: Product, quantity = 1, size?: string, unitPrice?: number): boolean {
    if (!this.isPurchasable(product)) return false;

    const normalizedSize = size?.trim() || undefined;
    const normalizedUnitPrice =
      typeof unitPrice === 'number' && Number.isFinite(unitPrice) ? unitPrice : product.basePrice;
    const existing = this.cartItems().find(
      item => item.product.id === product.id && (item.size ?? undefined) === normalizedSize
    );
    const requested = this.normalizeQuantity(quantity, 1);
    const nextQuantity = this.clampToStock(product, (existing?.quantity ?? 0) + requested);

    if (existing && nextQuantity === existing.quantity) return false;

    if (existing) {
      this.updateItems(items => items.map(item =>
        item.product.id === product.id && (item.size ?? undefined) === normalizedSize
          ? { ...item, quantity: nextQuantity, product, unitPrice: normalizedUnitPrice }
          : item
      ));
    } else {
      this.updateItems(items => [...items, {
        product,
        quantity: nextQuantity,
        size: normalizedSize,
        unitPrice: normalizedUnitPrice
      }]);
    }
    return true;
  }

  updateQuantity(productId: string, quantity: number, size?: string): boolean {
    const normalizedSize = size?.trim() || undefined;
    const existing = this.cartItems().find(
      item => item.product.id === productId && (item.size ?? undefined) === normalizedSize
    );
    if (!existing) return false;

    if (quantity <= 0) {
      this.removeFromCart(productId, size);
      return true;
    }
    const requested = this.normalizeQuantity(quantity, 1);
    if (!this.isPurchasable(existing.product)) {
      this.removeFromCart(productId, size);
      return false;
    }
    const nextQuantity = this.clampToStock(existing.product, requested);
    if (nextQuantity === existing.quantity) return requested <= this.stockLimit(existing.product);
    this.updateItems(items => items.map(item =>
      item.product.id === productId && (item.size ?? undefined) === normalizedSize
        ? { ...item, quantity: nextQuantity }
        : item
    ));
    return true;
  }

  removeFromCart(productId: string, size?: string) {
    const normalizedSize = size?.trim() || undefined;
    this.updateItems(items =>
      items.filter(item => !(item.product.id === productId && (item.size ?? undefined) === normalizedSize))
    );
  }

  clearCart() {
    this.updateItems([]);
  }

  private updateItems(update: CartItem[] | ((items: CartItem[]) => CartItem[])): void {
    const items = typeof update === 'function' ? update(this.cartItems()) : update;
    this.cartItems.set(items);
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
      } catch {
        // Browsing and checkout continue in-memory when storage is unavailable or full.
      }
    }
  }

  private restoreCart(): CartItem[] {
    if (typeof localStorage === 'undefined') return [];
    try {
      const parsed = JSON.parse(localStorage.getItem(CART_STORAGE_KEY) ?? '[]') as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.flatMap(value => {
        if (!value || typeof value !== 'object') return [];
        const item = value as Partial<StoredCartItem>;
        if (!item.product?.id || !item.product.name || !Array.isArray(item.product.images)) return [];
        if (!Number.isFinite(item.unitPrice) || (item.unitPrice as number) < 0) return [];
        const quantity = Math.floor(Number(item.quantity));
        const product = item.product as Product;
        if (!Number.isFinite(quantity) || quantity < 1 || !this.isPurchasable(product)) return [];
        return [{
          product,
          quantity: this.clampToStock(product, quantity),
          size: typeof item.size === 'string' && item.size.trim() ? item.size.trim() : undefined,
          unitPrice: item.unitPrice as number
        }];
      });
    } catch {
      localStorage.removeItem(CART_STORAGE_KEY);
      return [];
    }
  }

  private normalizeQuantity(quantity: number, fallback: number): number {
    return Number.isFinite(quantity) ? Math.max(1, Math.min(MAX_CART_QUANTITY, Math.floor(quantity))) : fallback;
  }

  private stockLimit(product: Product): number {
    return product.stock === null || product.stock === undefined
      ? MAX_CART_QUANTITY
      : Math.max(0, Math.floor(product.stock));
  }

  private clampToStock(product: Product, quantity: number): number {
    return Math.min(this.normalizeQuantity(quantity, 1), this.stockLimit(product));
  }

  private isPurchasable(product: Product): boolean {
    return product.isActive !== false && this.stockLimit(product) > 0;
  }
}

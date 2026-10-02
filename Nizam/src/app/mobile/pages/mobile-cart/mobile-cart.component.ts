import { Component, OnInit, computed, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  addOutline,
  cartOutline,
  removeOutline,
  trashOutline,
} from 'ionicons/icons';

import { CartService, CartItem } from '../../../services/cart.service';
import { AnalyticsService } from '../../../services/analytics.service';
import { ToastService } from '../../../services/toast.service';
import { PricePipe } from '../../../pipes/price.pipe';
import { ImageFallbackDirective } from '../../../directives/image-fallback.directive';
import { NativeShellService } from '../../services/native-shell.service';

/**
 * MobileCartComponent — the cart screen.
 *
 * Reuses CartService wholesale, so the cart the shopper builds on the phone is
 * the same persisted cart the website reads (both write
 * `amma-wears-cart-v1` to localStorage within the same WebView storage
 * partition per app install).
 *
 * The order summary is a sticky footer rather than a separate section, so
 * "checkout" is always one tap away no matter how far the list is scrolled.
 */
@Component({
  selector: 'app-mobile-cart',
  imports: [RouterLink, IonIcon, PricePipe, ImageFallbackDirective],
  templateUrl: './mobile-cart.component.html',
  styleUrls: ['./mobile-cart.component.scss'],
})
export class MobileCartComponent implements OnInit {
  private readonly cartService = inject(CartService);
  private readonly analytics = inject(AnalyticsService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly shell = inject(NativeShellService);

  // getItems() returns a plain array; wrapping it in computed() keeps the
  // template reactive to add/remove/quantity changes.
  protected readonly items = computed(() => this.cartService.getItems());
  protected readonly itemCount = this.cartService.itemCount;
  protected readonly total = this.cartService.cartTotal;

  /** Free-shipping threshold and progress, mirroring the website's banner. */
  protected readonly freeShippingAt = 2999;

  /** How much more is needed for free shipping; 0 once the threshold is met. */
  protected readonly amountToFreeShipping = computed(() =>
    Math.max(0, this.freeShippingAt - this.total())
  );

  protected readonly freeShippingProgress = computed(() =>
    Math.min(100, Math.round((this.total() / this.freeShippingAt) * 100))
  );

  /** Flattened view rows: each cart line is rendered individually. */
  protected readonly rows = computed(() =>
    this.items().map((item) => ({
      item,
      key: `${item.product.id}-${item.size ?? 'default'}`,
    }))
  );

  constructor() {
    addIcons({ addOutline, cartOutline, removeOutline, trashOutline });
  }

  ngOnInit(): void {
    this.analytics.init();
    this.analytics.trackPageView('/cart');
    this.analytics.trackViewCart(
      this.items().map((item) => ({
        item_id: item.product.id,
        item_name: item.product.name,
        price: item.unitPrice,
        quantity: item.quantity,
      })),
      this.total()
    );
  }

  protected image(item: CartItem): string {
    return item.product.images?.[0] ?? '/images/products/placeholder.svg';
  }

  protected increase(item: CartItem): void {
    // updateQuantity clamps to stock internally and returns false when the
    // limit is already reached, so nothing extra is needed here.
    this.cartService.updateQuantity(item.product.id, item.quantity + 1, item.size);
  }

  protected decrease(item: CartItem): void {
    // A quantity of 0 removes the line (see CartService.updateQuantity).
    this.cartService.updateQuantity(item.product.id, item.quantity - 1, item.size);
  }

  protected async remove(item: CartItem): Promise<void> {
    const confirmed = await this.toast.confirm(
      `Remove ${item.product.name} from your cart?`
    );
    if (!confirmed) {
      return;
    }

    this.cartService.removeFromCart(item.product.id, item.size);
    this.toast.info(`${item.product.name} removed`);
    this.analytics.trackRemoveFromCart(item.product, item.quantity, item.size);
  }

  protected async clear(): Promise<void> {
    const confirmed = await this.toast.confirm('Remove all items from your cart?');
    if (!confirmed) {
      return;
    }

    this.cartService.clearCart();
    this.toast.info('Cart cleared');
  }

  protected checkout(): void {
    // /checkout is AuthGuard-protected; the guard bounces to /login and
    // remembers the return URL, so a shopper who is not signed in still lands
    // back here to finish.
    this.analytics.trackBeginCheckout(
      this.items().map((item) => ({
        item_id: item.product.id,
        item_name: item.product.name,
        price: item.unitPrice,
        quantity: item.quantity,
      })),
      this.total()
    );
    void this.router.navigateByUrl('/checkout');
    void this.shell.dismissKeyboard();
  }
}
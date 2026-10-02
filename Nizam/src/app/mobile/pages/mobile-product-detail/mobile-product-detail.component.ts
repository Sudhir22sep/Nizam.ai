import { Component, OnInit, computed, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { IonIcon, IonSpinner } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  cartOutline,
  chevronBackOutline,
  heartOutline,
  removeOutline,
  addOutline,
} from 'ionicons/icons';

import {
  ProductService,
  Product,
  normalizeProductImages,
} from '../../../services/product.service';
import { CartService } from '../../../services/cart.service';
import { AnalyticsService } from '../../../services/analytics.service';
import { ToastService } from '../../../services/toast.service';
import { PricePipe } from '../../../pipes/price.pipe';
import { ImageFallbackDirective } from '../../../directives/image-fallback.directive';
import { MobileWishlistFacade } from '../../services/mobile-wishlist.facade';
import { NativeShellService } from '../../services/native-shell.service';

/**
 * MobileProductDetailComponent — the product page.
 *
 * Swappable gallery: an Ionic `ion-slides` would need gesture configuration and,
 * more importantly, makes it hard to guarantee a visible thumbnail strip on
 * every device. Instead the hero image is a signal-driven stage with prev/next
 * controls plus a dot indicator, which is deterministic and accessible to
 * screen readers.
 *
 * Variants (sizes) map onto `CartItem.size`, so a size selection lands in the
 * same cart the website writes.
 */
@Component({
  selector: 'app-mobile-product-detail',
  imports: [RouterLink, IonIcon, IonSpinner, PricePipe, ImageFallbackDirective],
  templateUrl: './mobile-product-detail.component.html',
  styleUrls: ['./mobile-product-detail.component.scss'],
})
export class MobileProductDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly productService = inject(ProductService);
  private readonly cartService = inject(CartService);
  private readonly wishlistFacade = inject(MobileWishlistFacade);
  private readonly analytics = inject(AnalyticsService);
  private readonly toast = inject(ToastService);
  private readonly shell = inject(NativeShellService);

  protected readonly product = signal<Product | null>(null);
  protected readonly images = signal<string[]>([]);
  protected readonly imageIndex = signal(0);
  protected readonly selectedSize = signal<string | undefined>(undefined);
  protected readonly quantity = signal(1);
  protected readonly loading = signal(true);

  /** Size options come from the catalog's variants, when it defines any. */
  protected readonly sizes = computed(() =>
    (this.product()?.variants ?? [])
      .map((variant) => variant.name)
      .filter((name): name is string => Boolean(name?.trim()))
  );

  protected readonly isSoldOut = computed(() => {
    const stock = this.product()?.stock;
    return stock !== null && stock !== undefined && stock <= 0;
  });

  /** Low-stock count, or null when stock is healthy or unknown. */
  protected readonly lowStock = computed(() => {
    const stock = this.product()?.stock;
    return stock !== null && stock !== undefined && stock > 0 && stock <= 3 ? stock : null;
  });

  /** Discount against the compare-at price, or null when there is none. */
  protected readonly discountPercent = computed(() => {
    const product = this.product();
    if (!product?.originalPrice || product.originalPrice <= product.basePrice) {
      return null;
    }
    return Math.round(((product.originalPrice - product.basePrice) / product.originalPrice) * 100);
  });

  constructor() {
    addIcons({ cartOutline, chevronBackOutline, heartOutline, removeOutline, addOutline });

    // Navigating straight between two products (shop grid -> product -> back ->
    // next product) re-uses this component instance, so the gallery and the
    // selected swatch must reset or the new product opens on stale state.
    effect(() => {
      const id = this.route.snapshot.paramMap.get('id');
      if (id) {
        void this.load(id);
      }
    });
  }

  ngOnInit(): void {
    this.analytics.init();
  }
  private async load(id: string): Promise<void> {
    this.loading.set(true);
    try {
      const product = await this.productService.fetchProductById(id);
      this.product.set(product ?? null);
      this.images.set(
        product ? normalizeProductImages(product.images, undefined, product.name) : []
      );
      this.imageIndex.set(0);
      this.quantity.set(1);
      // Default to the first size so "add to cart" always carries one when the
      // product defines variants.
      this.selectedSize.set(product?.variants?.[0]?.name ?? undefined);

      if (product) {
        this.analytics.trackPageView(`/product/${id}`);
        this.analytics.trackViewItem(product);
      }
    } catch {
      this.toast.error('Could not load this product.');
    } finally {
      this.loading.set(false);
    }
  }

  protected nextImage(): void {
    this.imageIndex.update((index) => (index + 1) % this.images().length);
  }

  protected previousImage(): void {
    this.imageIndex.update((index) => (index - 1 + this.images().length) % this.images().length);
  }

  protected selectImage(index: number): void {
    this.imageIndex.set(index);
  }

  protected selectSize(size: string): void {
    this.selectedSize.set(size);
  }

  protected increaseQuantity(): void {
    const product = this.product();
    if (!product) {
      return;
    }
    // Clamp to stock so the stepper cannot exceed what is actually buyable.
    const limit = product.stock ?? 99;
    this.quantity.update((quantity) => Math.min(limit, quantity + 1));
  }

  protected decreaseQuantity(): void {
    this.quantity.update((quantity) => Math.max(1, quantity - 1));
  }

  protected async addToCart(): Promise<void> {
    const product = this.product();
    if (!product) {
      return;
    }

    if (this.isSoldOut()) {
      this.toast.warning('This item is sold out.');
      return;
    }

    const size = this.selectedSize();
    if (this.cartService.addToCart(product, this.quantity(), size)) {
      this.toast.success(`${product.name} added to cart`);
      this.analytics.trackAddToCart(product, this.quantity(), size);
      void this.router.navigateByUrl('/cart');
    } else {
      this.toast.warning(`No more ${product.name} available.`);
    }
    void this.shell.dismissKeyboard();
  }

  protected async toggleWishlist(): Promise<void> {
    const product = this.product();
    if (!product) {
      return;
    }

    try {
      const saved = await this.wishlistFacade.toggle(product);
      if (!saved) {
        this.toast.info('Sign in to save favourites.');
        void this.router.navigateByUrl('/login');
        return;
      }
      this.toast.success(`${product.name} saved`);
    } catch {
      this.toast.error(`Could not save ${product.name}. Try again.`);
    }
  }

  protected back(): void {
    // Shared with the rest of the shell: prefers real history, and falls back
    // to the shop grid when the app was opened straight into this URL.
    this.shell.goBack('/products');
  }
}

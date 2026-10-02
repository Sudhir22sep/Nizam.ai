import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { IonIcon, IonSpinner } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { arrowForwardOutline, cartOutline, heartOutline, searchOutline } from 'ionicons/icons';

import {
  ProductService,
  Product,
  primaryProductImage,
} from '../../../services/product.service';
import { CartService } from '../../../services/cart.service';
import { AnalyticsService } from '../../../services/analytics.service';
import { PricePipe } from '../../../pipes/price.pipe';
import { ToastService } from '../../../services/toast.service';
import { MobileWishlistFacade } from '../../services/mobile-wishlist.facade';
import { ImageFallbackDirective } from '../../../directives/image-fallback.directive';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Capacitor } from '@capacitor/core';

/** A card in the "Trending now" horizontal rail. */
interface RailCollection {
  title: string;
  imageUrl: string;
  href: string;
}

/**
 * MobileHomeComponent — the app's landing screen.
 *
 * This is the Ionic counterpart of the website home page: same content and
 * same services, laid out for a phone. The desktop hero grid, bento grid and
 * 3D-tilt carousel are replaced by a vertically stacked layout — a single
 * column of promo, categories rail, and featured products — which is what fits
 * a 360–430pt viewport.
 */
@Component({
  selector: 'app-mobile-home',
  imports: [RouterLink, IonIcon, IonSpinner, PricePipe, ImageFallbackDirective],
  templateUrl: './mobile-home.component.html',
  styleUrls: ['./mobile-home.component.scss'],
})
export class MobileHomeComponent implements OnInit {
  private readonly productService = inject(ProductService);
  private readonly cartService = inject(CartService);
  private readonly wishlistFacade = inject(MobileWishlistFacade);
  private readonly analytics = inject(AnalyticsService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  /** Mirrors the website hero copy so both surfaces stay in sync. */
  protected readonly hero = {
    eyebrow: 'New summer edit',
    title: 'Everyday luxury for modern wardrobes',
    subtitle:
      'Premium apparel and curated essentials designed for style, comfort and confidence.',
    cta: 'Shop the collection',
    image: '/images/products/satin-slip-dress.jpeg',
  };

  /** Category rail; tapping a card opens the shop pre-filtered. */
  protected readonly collections: readonly RailCollection[] = [
    {
      title: 'Modern tailoring',
      imageUrl: '/images/products/premium-shirt.jpeg',
      href: '/products',
    },
    {
      title: 'Evening silhouettes',
      imageUrl: '/images/products/satin-slip-dress.jpeg',
      href: '/products',
    },
    {
      title: 'Everyday staples',
      imageUrl: '/images/products/Tshirt.jpeg',
      href: '/products',
    },
    {
      title: 'Denim & layers',
      imageUrl: '/images/products/denim-trucker-jacket.jpeg',
      href: '/products',
    },
  ];

  protected readonly products = this.productService.getProducts();
  protected readonly loading = signal(true);

  /** First eight active products for the "New arrivals" grid. */
  protected readonly featured = computed(() =>
    this.products()
      .filter((product) => product.isActive !== false)
      .slice(0, 8)
  );

  protected readonly cartCount = this.cartService.itemCount;

  constructor() {
    addIcons({ arrowForwardOutline, cartOutline, heartOutline, searchOutline });
  }

  ngOnInit(): void {
    // The catalog arrives from the bundled seed plus a live API fetch, so the
    // spinner clears once the service settles rather than on a fixed timer.
    void this.productService.ensureLoaded().finally(() => this.loading.set(false));

    this.analytics.init();
    this.analytics.trackPageView('/');
    this.analytics.trackViewItemList(
      this.featured().slice(0, 4).map((p) => ({
        item_id: p.id,
        item_name: p.name,
        price: p.basePrice,
      })),
      'mobile-home',
      'Mobile Home'
    );
  }

  protected image(product: Product): string {
    return primaryProductImage(product.images, undefined, product.name);
  }

  protected isSoldOut(product: Product): boolean {
    return product.stock !== null && product.stock !== undefined && product.stock <= 0;
  }

  /**
   * Whole-number discount against the compare-at price, or null when there is
   * no genuine markdown (guards against a compare-at price that is lower than
   * the selling price, which would otherwise render as a negative discount).
   */
  protected discountPercent(product: Product): number | null {
    const original = product.originalPrice;
    if (!original || original <= product.basePrice) {
      return null;
    }
    return Math.round(((original - product.basePrice) / original) * 100);
  }

  protected async addToCart(product: Product, event: Event): Promise<void> {
    // The whole card is a link; stop the tap from navigating to the detail page.
    event.preventDefault();
    event.stopPropagation();

    if (this.isSoldOut(product)) {
      this.toast.warning('This item is sold out.');
      return;
    }

    await this.tapFeedback();

    // addToCart clamps to stock and returns false when nothing changed, so a
    // false result means "already at the stock limit" rather than a failure.
    if (this.cartService.addToCart(product, 1)) {
      this.toast.success(`${product.name} added to cart`);
      this.analytics.trackAddToCart(product, 1);
    } else {
      this.toast.warning(`No more ${product.name} available.`);
    }
  }

  protected async toggleWishlist(product: Product, event: Event): Promise<void> {
    event.preventDefault();
    event.stopPropagation();

    await this.tapFeedback();

    try {
      const saved = await this.wishlistFacade.toggle(product);
      if (!saved) {
        // Wishlists are per-account, so an anonymous shopper is sent to sign in.
        this.toast.info('Sign in to save favourites.');
        void this.router.navigateByUrl('/login');
        return;
      }
      this.toast.success(`${product.name} saved`);
    } catch {
      this.toast.error(`Could not save ${product.name}. Try again.`);
    }
  }

  /**
   * Fires a light haptic on native devices only.
   *
   * Confirms "the tap registered" without a visual ripple, which the Ionic
   * ripple does not provide on `ion-icon` buttons inside a router link.
   */
  private async tapFeedback(): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      return;
    }
    try {
      await Haptics.impact({ style: ImpactStyle.Light });
    } catch {
      // Haptics are a nicety; a device without a motor still works.
    }
  }
}
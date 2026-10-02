import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { IonIcon, IonSpinner } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { cartOutline, closeOutline, heartOutline, searchOutline } from 'ionicons/icons';

import {
  ProductService,
  Product,
  primaryProductImage,
} from '../../../services/product.service';
import { CartService } from '../../../services/cart.service';
import { AnalyticsService } from '../../../services/analytics.service';
import { ToastService } from '../../../services/toast.service';
import { PricePipe } from '../../../pipes/price.pipe';
import { ImageFallbackDirective } from '../../../directives/image-fallback.directive';
import { MobileWishlistFacade } from '../../services/mobile-wishlist.facade';

type SortOption = 'featured' | 'newest' | 'price-low' | 'price-high' | 'name';

const SORT_LABELS: Record<SortOption, string> = {
  featured: 'Featured',
  newest: 'Newest',
  'price-low': 'Price: low to high',
  'price-high': 'Price: high to low',
  name: 'Name: A–Z',
};

/**
 * MobileProductsComponent — the shop screen.
 *
 * Replaces the website's desktop filter sidebar and multi-column grid with the
 * mobile equivalent: a sticky search field, a horizontally scrolling category
 * chip row, a sort control, and a two-column product grid.
 *
 * Filtering, sorting and the catalog itself all come from the shared
 * ProductService, so the app and the site always show the same inventory.
 */
@Component({
  selector: 'app-mobile-products',
  imports: [RouterLink, IonIcon, IonSpinner, PricePipe, ImageFallbackDirective],
  templateUrl: './mobile-products.component.html',
  styleUrls: ['./mobile-products.component.scss'],
})
export class MobileProductsComponent implements OnInit {
  private readonly productService = inject(ProductService);
  private readonly cartService = inject(CartService);
  private readonly wishlistFacade = inject(MobileWishlistFacade);
  private readonly analytics = inject(AnalyticsService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  protected readonly products = this.productService.getProducts();
  protected readonly loading = signal(true);

  protected readonly searchTerm = signal('');
  protected readonly activeCategory = signal('All');
  protected readonly sort = signal<SortOption>('featured');
  protected readonly showFilters = signal(false);

  protected readonly sortOptions = Object.entries(SORT_LABELS) as ReadonlyArray<
    [SortOption, string]
  >;

  /** Categories are derived from the catalog so they never go stale. */
  protected readonly categories = computed(() => {
    const names = new Set(
      this.products()
        .filter((product) => product.isActive !== false)
        .map((product) => product.category)
        .filter((category): category is string => Boolean(category?.trim()))
    );
    return ['All', ...Array.from(names).sort()];
  });

  /** The visible, filtered and sorted slice shown in the grid. */
  protected readonly visibleProducts = computed(() => {
    const term = this.searchTerm().trim().toLowerCase();
    const category = this.activeCategory();

    const filtered = this.products().filter((product) => {
      if (product.isActive === false) {
        return false;
      }
      if (category !== 'All' && product.category !== category) {
        return false;
      }
      if (!term) {
        return true;
      }
      // Search name, description and category so "shirt", "denim" and
      // "tailoring" all find the relevant products.
      return [product.name, product.description, product.category]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(term));
    });

    return this.sortProducts(filtered);
  });

  protected readonly resultCount = computed(() => this.visibleProducts().length);

  constructor() {
    addIcons({ cartOutline, closeOutline, heartOutline, searchOutline });
  }

  ngOnInit(): void {
    void this.productService.ensureLoaded().finally(() => this.loading.set(false));

    this.analytics.init();
    this.analytics.trackPageView('/products');
  }
/** Applies the selected sort to an already-filtered list. */
  private sortProducts(products: Product[]): Product[] {
    const sorted = [...products];
    switch (this.sort()) {
      case 'price-low':
        return sorted.sort((a, b) => a.basePrice - b.basePrice);
      case 'price-high':
        return sorted.sort((a, b) => b.basePrice - a.basePrice);
      case 'name':
        return sorted.sort((a, b) => a.name.localeCompare(b.name));
      case 'newest':
        // Newest first by creation date; entries without a usable date sink to
        // the end instead of being treated as 1970.
        return sorted.sort((a, b) => this.timestamp(b) - this.timestamp(a));
      default:
        return sorted;
    }
  }

  /** Epoch millis, tolerating both Date objects and ISO strings. */
  private timestamp(product: Product): number {
    const raw = product.createdAt as Date | string | undefined;
    const parsed = raw ? new Date(raw).getTime() : Number.NaN;
    return Number.isFinite(parsed) ? parsed : 0;
  }

  protected image(product: Product): string {
    return primaryProductImage(product.images, undefined, product.name);
  }

  protected isSoldOut(product: Product): boolean {
    return product.stock !== null && product.stock !== undefined && product.stock <= 0;
  }

  protected onSearch(event: Event): void {
    this.searchTerm.set((event.target as HTMLInputElement).value);
  }

  protected clearSearch(): void {
    this.searchTerm.set('');
  }

  protected selectCategory(category: string): void {
    this.activeCategory.set(category);
  }

  protected onSortChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as SortOption;
    if (value in SORT_LABELS) {
      this.sort.set(value);
      this.analytics.trackSearch(this.searchTerm().trim() || value);
    }
  }

  /** Clears query, category and sort in one tap. */
  protected resetFilters(): void {
    this.searchTerm.set('');
    this.activeCategory.set('All');
    this.sort.set('featured');
  }

  protected get hasActiveFilters(): boolean {
    return (
      this.searchTerm().trim().length > 0 ||
      this.activeCategory() !== 'All' ||
      this.sort() !== 'featured'
    );
  }

  protected async addToCart(product: Product, event: Event): Promise<void> {
    event.preventDefault();
    event.stopPropagation();

    if (this.isSoldOut(product)) {
      this.toast.warning('This item is sold out.');
      return;
    }

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
}
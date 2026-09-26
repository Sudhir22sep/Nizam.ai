import { Component, OnInit, OnDestroy, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { BentoHighlightsComponent } from '../../components/bento-grid/bento-highlights.component';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import {
  ProductService,
  Product,
  primaryProductImage,
  productImageSrcset,
} from '../../services/product.service';
import { SiteEventsService } from '../../services/site-events.service';
import { CartService } from '../../services/cart.service';
import { WishlistService } from '../../services/wishlist.service';
import { ToastService } from '../../services/toast.service';
import { ProductCardComponent } from '../../components/product-card/product-card.component';
import { EmptyStateComponent } from '../../components/empty-state/empty-state.component';
import { AuroraBackgroundComponent } from '../../components/aurora-background/aurora-background.component';

type SortOption = 'featured' | 'newest' | 'price-low' | 'price-high' | 'name';

/** Sort keys accepted from the `sort` query param. */
const SORTS: readonly SortOption[] = ['featured', 'newest', 'price-low', 'price-high', 'name'];

/** Narrows an untrusted query-param string to a supported sort key. */
function toSortOption(value: unknown): SortOption {
  return SORTS.includes(value as SortOption) ? (value as SortOption) : 'featured';
}

@Component({
  selector: 'app-products',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule, EmptyStateComponent, ProductCardComponent, AuroraBackgroundComponent, BentoHighlightsComponent],
  templateUrl: './products.component.html',
  styleUrl: './products.component.css'
})
export class ProductsComponent implements OnInit, OnDestroy {
  private readonly productService = inject(ProductService);
  private readonly cartService = inject(CartService);
  private readonly wishlistService = inject(WishlistService);
  private readonly toast = inject(ToastService);
  private readonly siteEvents = inject(SiteEventsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly showcaseProducts = computed(() => {
    const category = this.normaliseCategory(this.selectedCategory());
    return this.products()
      .filter(product => product.isActive !== false)
      .filter(product => !category || this.normaliseCategory(product.category) === category)
      .slice(0, 3);
  });

  /** Catalog signal published by the service (bundled catalog + live API). */
  readonly products = this.productService.getProducts();

  /** Category coming from the `category` query param; '' means "all". */
  readonly selectedCategory = signal('');

  readonly categories = computed(() =>
    Array.from(new Set(this.products().map(product => product.category.trim())))
      .filter(category => category.length > 0)
  );

  readonly searchQuery = signal('');
  readonly sortBy = signal<SortOption>('featured');

  readonly filteredProducts = computed(() => {
    const category = this.normaliseCategory(this.selectedCategory());
    const query = this.searchQuery().trim().toLowerCase();
    const products = this.products().filter(product => {
      const matchesCategory = !category || this.normaliseCategory(product.category) === category;
      const searchable = `${product.name} ${product.description} ${product.category} ${product.tags.join(' ')}`.toLowerCase();
      return matchesCategory && (!query || searchable.includes(query));
    });

    switch (this.sortBy()) {
      case 'newest': return [...products].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      case 'price-low': return [...products].sort((a, b) => a.basePrice - b.basePrice);
      case 'price-high': return [...products].sort((a, b) => b.basePrice - a.basePrice);
      case 'name': return [...products].sort((a, b) => a.name.localeCompare(b.name));
      default: return products;
    }
  });

  /** How many catalog cards are mounted at a time; grows as the user scrolls. */
  private static readonly PAGE_SIZE = 24;

  /** Number of cards currently mounted. Reset whenever the filter set changes. */
  readonly visibleCount = signal(ProductsComponent.PAGE_SIZE);

  /** Sentinel element observed by the auto-load observer. */
  readonly loadMoreSentinel = viewChild<ElementRef<HTMLElement>>('loadMoreSentinel');

  /** Auto-load observer, absent during SSR or in bare-DOM tests. */
  private loadMoreObserver?: IntersectionObserver;

  /** Cards actually handed to the template, capped at the current window. */
  readonly visibleProducts = computed(() =>
    this.filteredProducts().slice(0, this.visibleCount())
  );

  /** True while more matches exist beyond the mounted window. */
  readonly hasMoreProducts = computed(
    () => this.visibleCount() < this.filteredProducts().length
  );

  /** Grows the window by one page. */
  loadMore(): void {
    this.visibleCount.update(count => count + ProductsComponent.PAGE_SIZE);
  }

  constructor() {
    this.route.queryParamMap.subscribe(params => {
      this.selectedCategory.set(params.get('category') ?? '');
      this.searchQuery.set(params.get('q') ?? '');
      const sort = params.get('sort');
      this.sortBy.set(toSortOption(sort));
    });
  }

  /**
   * A new filter means a new result set, so the window restarts at the first
   * page. This is an effect rather than a reset inside the query-param
   * subscription so it also covers programmatic filter changes.
   */
  private readonly windowReset = effect(() => {
    // Read the filter inputs so this effect re-runs when any of them change.
    this.selectedCategory();
    this.searchQuery();
    this.sortBy();
    this.visibleCount.set(ProductsComponent.PAGE_SIZE);
  });

  ngOnInit() {
    void this.productService.ensureLoaded().then(() => {
      const count = Math.min(this.products().length, 3);
      this.siteEvents.announceNewArrivals(count);
      if (count > 0) this.siteEvents.notify('new_product', 'Fresh products just landed — explore the latest edit.', 'info', 'catalog-products');
    });
  }

  /**
   * Watches the sentinel so the next page mounts just before the user reaches
   * the bottom. A plain "Load more" button remains in the DOM for keyboard
   * users and for environments without IntersectionObserver.
   *
   * This runs as an effect rather than in `ngAfterViewInit` because the sentinel
   * only exists once the catalog resolves and `hasMoreProducts()` becomes true,
   * which is after the first view is initialised.
   */
  private readonly sentinelWatcher = effect(() => {
    const sentinel = this.loadMoreSentinel()?.nativeElement;
    // SSR and bare DOM test environments have no IntersectionObserver; the
    // template's "Load more" button keeps the grid fully reachable there.
    if (!sentinel || typeof IntersectionObserver === 'undefined') {
      return;
    }

    this.loadMoreObserver?.disconnect();
    this.loadMoreObserver = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          this.loadMore();
        }
      },
      // Mount the next page slightly before the sentinel scrolls into view.
      { rootMargin: '600px 0px' }
    );
    this.loadMoreObserver.observe(sentinel);
  });

  ngOnDestroy(): void {
    this.loadMoreObserver?.disconnect();
    this.loadMoreObserver = undefined;
  }

  filterByCategory(category: string) {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { category },
      queryParamsHandling: 'merge'
    });
  }

  setSearchQuery(query: string) {
    this.searchQuery.set(query);
    void this.router.navigate([], { relativeTo: this.route, queryParams: { q: query || null }, queryParamsHandling: 'merge' });
  }

  setSort(sort: string) {
    const value = toSortOption(sort);
    this.sortBy.set(value);
    void this.router.navigate([], { relativeTo: this.route, queryParams: { sort: value === 'featured' ? null : value }, queryParamsHandling: 'merge' });
  }

  resetFilter() {
    this.searchQuery.set('');
    this.sortBy.set('featured');
    void this.router.navigate([], { relativeTo: this.route, queryParams: { category: null, q: null, sort: null }, queryParamsHandling: 'merge' });
  }

  addToCart(product: Product) {
    if (product.stock !== null && product.stock !== undefined && product.stock <= 0) {
      this.toast.info(`${product.name} is currently sold out.`);
      return;
    }
    const existing = this.cartService.getItems().find(item => item.product.id === product.id && !item.size);
    const requested = (existing?.quantity ?? 0) + 1;
    if (product.stock !== null && product.stock !== undefined && requested > product.stock) {
      this.toast.warning(`Only ${product.stock} ${product.name} available.`);
      return;
    }
    if (this.cartService.addToCart(product, 1)) {
      this.toast.success(`${product.name} added to cart.`);
      this.siteEvents.track('add_to_cart', { product_id: product.id, product_name: product.name });
    }
  }

  addToWishlist(product: Product) {
    this.wishlistService.getWishlists().subscribe({
      next: (wishlists) => {
        if (wishlists.length === 0) {
          this.wishlistService.createWishlist('My Favorites', false).subscribe({
            next: (response) => {
              if (response.success && response.wishlist) {
                this.wishlistService.addItemToWishlist(response.wishlist._id, product.id).subscribe({
                  next: () => this.toast.success(`${product.name} added to wishlist.`),
                  error: (error) => this.handleAddToWishlistError(error, product.name)
                });
              }
            },
            error: () => this.toast.error('Could not create wishlist. Try again.')
          });
        } else {
          this.wishlistService.addItemToWishlist(wishlists[0]._id, product.id).subscribe({
            next: () => this.toast.success(`${product.name} added to wishlist.`),
            error: (error) => this.handleAddToWishlistError(error, product.name)
          });
        }
      },
      error: () => this.toast.error('Could not access wishlists. Try again.')
    });
  }

  /** Surfaces the server's reason (e.g. duplicate item) instead of a generic failure. */
  private handleAddToWishlistError(error: { status?: number; error?: { message?: string } }, productName: string) {
    const message = error?.error?.message;
    if (error?.status === 409 || message?.toLowerCase().includes('already exists')) {
      this.toast.info(`${productName} is already in your wishlist.`);
      return;
    }
    this.toast.error(`Failed to add ${productName} to wishlist. Try again.`);
  }

  trackByProductId(index: number, product: Product) {
    return product.id;
  }

  private normaliseCategory(category: string): string {
    return category.trim().toLowerCase();
  }

 primaryImage(product: Product): string {
    return primaryProductImage(product.images, undefined, product.name);
  }

  /**
   * Responsive WebP candidates for the showcase card, or null for catalog
   * images hosted on a CDN that have no locally generated variants.
   */
  srcsetFor(product: Product): string | null {
    return productImageSrcset(primaryProductImage(product.images, undefined, product.name));
  }

  // image fallback handled by ImageFallbackDirective
}

import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { BentoHighlightsComponent } from '../../components/bento-grid/bento-highlights.component';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ProductService, Product, primaryProductImage } from '../../services/product.service';
import { SiteEventsService } from '../../services/site-events.service';
import { CartService } from '../../services/cart.service';
import { WishlistService } from '../../services/wishlist.service';
import { ToastService } from '../../services/toast.service';
import { ProductCardComponent } from '../../components/product-card/product-card.component';
import { EmptyStateComponent } from '../../components/empty-state/empty-state.component';
import { AuroraBackgroundComponent } from '../../components/aurora-background/aurora-background.component';

@Component({
  selector: 'app-products',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule, EmptyStateComponent, ProductCardComponent, AuroraBackgroundComponent, BentoHighlightsComponent],
  templateUrl: './products.component.html',
  styleUrl: './products.component.css'
})
export class ProductsComponent implements OnInit {
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
  readonly sortBy = signal<'featured' | 'price-low' | 'price-high' | 'name'>('featured');

  readonly filteredProducts = computed(() => {
    const category = this.normaliseCategory(this.selectedCategory());
    const query = this.searchQuery().trim().toLowerCase();
    const products = this.products().filter(product => {
      const matchesCategory = !category || this.normaliseCategory(product.category) === category;
      const searchable = `${product.name} ${product.description} ${product.category} ${product.tags.join(' ')}`.toLowerCase();
      return matchesCategory && (!query || searchable.includes(query));
    });

    switch (this.sortBy()) {
      case 'price-low': return [...products].sort((a, b) => a.basePrice - b.basePrice);
      case 'price-high': return [...products].sort((a, b) => b.basePrice - a.basePrice);
      case 'name': return [...products].sort((a, b) => a.name.localeCompare(b.name));
      default: return products;
    }
  });

  constructor() {
    this.route.queryParamMap.subscribe(params => {
      this.selectedCategory.set(params.get('category') ?? '');
      this.searchQuery.set(params.get('q') ?? '');
      const sort = params.get('sort');
      this.sortBy.set(sort === 'price-low' || sort === 'price-high' || sort === 'name' ? sort : 'featured');
    });
  }

  ngOnInit() {
    void this.productService.ensureLoaded().then(() => {
      const count = Math.min(this.products().length, 3);
      this.siteEvents.announceNewArrivals(count);
      if (count > 0) this.siteEvents.notify('new_product', 'Fresh products just landed — explore the latest edit.', 'info', 'catalog-products');
    });
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
    const value = sort === 'price-low' || sort === 'price-high' || sort === 'name' ? sort : 'featured';
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

  // image fallback handled by ImageFallbackDirective
}

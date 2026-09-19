import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ProductService, Product, primaryProductImage } from '../../services/product.service';
import { CartService } from '../../services/cart.service';
import { WishlistService } from '../../services/wishlist.service';
import { ToastService } from '../../services/toast.service';
import { ImageFallbackDirective } from '../../directives/image-fallback.directive';
import { PricePipe } from '../../pipes/price.pipe';
import { EmptyStateComponent } from '../../components/empty-state/empty-state.component';

@Component({
  selector: 'app-products',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule, PricePipe, ImageFallbackDirective, EmptyStateComponent],
  templateUrl: './products.component.html',
  styleUrl: './products.component.css'
})
export class ProductsComponent implements OnInit {
  private readonly productService = inject(ProductService);
  private readonly cartService = inject(CartService);
  private readonly wishlistService = inject(WishlistService);
  private readonly toast = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  /** Catalog signal published by the service (bundled catalog + live API). */
  readonly products = this.productService.getProducts();

  /** Category coming from the `category` query param; '' means "all". */
  readonly selectedCategory = signal('');

  readonly categories = computed(() =>
    Array.from(new Set(this.products().map(product => product.category.trim())))
      .filter(category => category.length > 0)
  );

  readonly filteredProducts = computed(() => {
    const category = this.normaliseCategory(this.selectedCategory());
    const products = this.products();
    if (!category) {
      return products;
    }
    return products.filter(product => this.normaliseCategory(product.category) === category);
  });

  constructor() {
    this.route.queryParamMap.subscribe(params => {
      this.selectedCategory.set(params.get('category') ?? '');
    });
  }

  ngOnInit() {
    void this.productService.ensureLoaded();
  }

  filterByCategory(category: string) {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { category },
      queryParamsHandling: 'merge'
    });
  }

  resetFilter() {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { category: null },
      queryParamsHandling: 'merge'
    });
  }

  addToCart(product: Product) {
    this.cartService.addToCart(product, 1);
    this.toast.success(`${product.name} added to cart.`);
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
                  error: () => this.toast.error('Failed to add to wishlist. Try again.')
                });
              }
            },
            error: () => this.toast.error('Could not create wishlist. Try again.')
          });
        } else {
          this.wishlistService.addItemToWishlist(wishlists[0]._id, product.id).subscribe({
            next: () => this.toast.success(`${product.name} added to wishlist.`),
            error: () => this.toast.error('Failed to add to wishlist. Try again.')
          });
        }
      },
      error: () => this.toast.error('Could not access wishlists. Try again.')
    });
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

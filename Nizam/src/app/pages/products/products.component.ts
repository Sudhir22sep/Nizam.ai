import { Component, OnInit, inject, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { PricePipe } from '../../pipes/price.pipe';
import { ImageFallbackDirective } from '../../directives/image-fallback.directive';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ProductService, Product } from '../../services/product.service';
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
  selectedCategory = '';
  categories = computed(() => Array.from(new Set(this.filteredProducts().map(p => p.category))));
  filteredProducts = computed(() => {
    const all = this.productService.getProducts();
    const cat = this.selectedCategory;
    return cat
      ? all().filter(p => p.category === cat)
      : all();
  });

  private readonly productService = inject(ProductService);
  private readonly cartService = inject(CartService);
  private readonly wishlistService = inject(WishlistService);
  private readonly toast = inject(ToastService);
  readonly categories = computed(() =>
    Array.from(new Set(this.products().map(product => product.category.trim())))
  );

  readonly filteredProducts = computed(() => {
    const category = this.normaliseCategory(this.selectedCategory());
    const products = this.products();
    if (!category) {
      return products;
    }
    return products.filter(product => this.normaliseCategory(product.category) === category);
  });

  constructor(
    private productService: ProductService,
    private cartService: CartService,
    private route: ActivatedRoute,
    private router: Router
  ) {
    this.products = this.productService.getProducts();
    this.route.queryParamMap.subscribe(params => {
      this.selectedCategory.set(params.get('category') ?? '');
    });
  }

ngOnInit() {
    this.productService.ensureLoaded();
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
    return category.trim().toLocaleLowerCase();
  }

 primaryImage(product: Product): string {
    return product.images[0] ?? '';
  }

  // image fallback handled by ImageFallbackDirective
}

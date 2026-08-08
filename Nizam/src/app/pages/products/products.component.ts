import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { PricePipe } from '../../pipes/price.pipe';
import { ImageFallbackDirective } from '../../directives/image-fallback.directive';
import { ProductService, Product } from '../../services/product.service';
import { CartService } from '../../services/cart.service';
import { WishlistService } from '../../services/wishlist.service';

@Component({
  selector: 'app-products',
  standalone: true,
  imports: [CommonModule, RouterLink, PricePipe, ImageFallbackDirective],
  templateUrl: './products.component.html',
  styleUrl: './products.component.css'
})
export class ProductsComponent {
  readonly products!: ReturnType<ProductService['getProducts']>;
  readonly selectedCategory = signal('');

  readonly categories = computed(() =>
    Array.from(new Set(this.products().map(product => product.category)))
  );

  readonly filteredProducts = computed(() => {
    const category = this.selectedCategory();
    const products = this.products();
    if (!category) {
      return products;
    }
    return products.filter(product => product.category === category);
  });

  constructor(
    private productService: ProductService,
    private cartService: CartService,
    private wishlistService: WishlistService
  ) {
    this.products = this.productService.getProducts();
  }

  filterByCategory(category: string) {
    this.selectedCategory.set(category);
  }

  resetFilter() {
    this.selectedCategory.set('');
  }

  addToCart(product: Product) {
    this.cartService.addToCart(product, 1);
    alert(`${product.name} has been added to your cart.`);
  }

  addToWishlist(product: Product) {
    // For simplicity, we'll add to a default wishlist or prompt to create/select one
    // In a full implementation, we'd show a modal to select/create wishlist
    this.wishlistService.getWishlists().subscribe({
      next: (wishlists) => {
        const defaultWishlist = wishlists.find(w => w.name === 'My Favorites') || wishlists[0];
        if (defaultWishlist) {
          this.wishlistService.addItemToWishlist(defaultWishlist._id, product.id).subscribe({
            next: () => {
              alert(`${product.name} has been added to your wishlist!`);
            },
            error: (error) => {
              console.error('Error adding to wishlist:', error);
              alert('Failed to add item to wishlist. Please try again.');
            }
          });
        } else {
          // No wishlists exist, prompt to create one
          if (confirm('You don\'t have any wishlists yet. Create a new wishlist called "My Favorites" and add this item to it?')) {
            this.wishlistService.createWishlist('My Favorites', false).subscribe({
              next: (response) => {
                if (response.success) {
                  this.wishlistService.addItemToWishlist(response.wishlist._id, product.id).subscribe({
                    next: () => {
                      alert(`${product.name} has been added to your new wishlist!`);
                    },
                    error: (error) => {
                      console.error('Error adding to wishlist:', error);
                    }
                  });
                }
              }
            });
          }
        }
      }
    });
  }

  trackByProductId(_: number, product: Product) {
    return product.id;
  }

  // image fallback handled by ImageFallbackDirective
}

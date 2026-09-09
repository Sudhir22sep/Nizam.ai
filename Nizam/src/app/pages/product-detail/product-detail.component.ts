import { Component, effect, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { PricePipe } from '../../pipes/price.pipe';
import { ImageFallbackDirective } from '../../directives/image-fallback.directive';
import { ProductService, Product } from '../../services/product.service';
import { CartService } from '../../services/cart.service';
import { WishlistService } from '../../services/wishlist.service';

@Component({
  selector: 'app-product-detail',
  standalone: true,
  imports: [CommonModule, RouterLink, PricePipe, ImageFallbackDirective],
  templateUrl: './product-detail.component.html',
  styleUrl: './product-detail.component.css'
})
export class ProductDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private productService = inject(ProductService);
  private cartService = inject(CartService);
  private wishlistService = inject(WishlistService);

  product: Product | undefined;
  relatedProducts: Product[] = [];
  quantity: number = 1;
  private productId: string | null = null;

  constructor() {
    effect(async () => {
      if (this.productId !== null) {
        // Ensure products are loaded before accessing
        await this.productService.ensureLoaded();
        
        const products = this.productService.getProducts();
        if (products().length > 0) {
          const product = this.productService.getProductById(this.productId);
          if (product) {
            this.product = product;
            this.relatedProducts = this.productService
              .getProductsByCategory(product.category)
              .filter(p => p.id !== product.id)
              .slice(0, 3);
          } else {
            this.product = undefined;
            this.relatedProducts = [];
          }
        }
      }
    });
  }

  ngOnInit() {
    this.route.params.subscribe(params => {
      this.productId = params['id'];
    });
  }

  incrementQuantity() {
    this.quantity++;
  }

  decrementQuantity() {
    if (this.quantity > 1) {
      this.quantity--;
    }
  }

  trackByProductId(_: number, product: Product) {
    return product.id;
  }

  addToCart() {
    if (!this.product) {
      return;
    }
    this.cartService.addToCart(this.product, this.quantity);
    alert(`${this.quantity} ${this.product.name} item(s) added to cart.`);
  }

  addToWishlist() {
    if (!this.product) {
      return;
    }

    // Get user's wishlists to add to first one (or create default)
    this.wishlistService.getWishlists().subscribe({
      next: (wishlists) => {
        let targetWishlist = wishlists[0]; // Use first wishlist

        if (!targetWishlist) {
          // Create default wishlist if none exists
          this.wishlistService.createWishlist('My Wishlist').subscribe({
            next: (response) => {
              if (response.success) {
                targetWishlist = response.wishlist;
                this.addItemToWishlist(targetWishlist._id);
              }
            }
          });
        } else {
          this.addItemToWishlist(targetWishlist._id);
        }
      },
      error: (error) => {
        console.error('Error loading wishlists:', error);
        alert('Unable to access wishlists. Please try again.');
      }
    });
  }

  private addItemToWishlist(wishlistId: string) {
    if (!this.product) return;

    this.wishlistService.addItemToWishlist(
      wishlistId,
      this.product.id,
      null, // variantId
      ''    // notes
    ).subscribe({
      next: (response) => {
        if (response.success) {
          alert('Product added to wishlist!');
        } else {
          alert('Failed to add product to wishlist.');
        }
      },
      error: (error) => {
        console.error('Error adding to wishlist:', error);
        alert('Failed to add product to wishlist.');
      }
    });
  }

  // image fallback handled by ImageFallbackDirective
}

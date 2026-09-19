import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { PricePipe } from '../../pipes/price.pipe';
import { ImageFallbackDirective } from '../../directives/image-fallback.directive';
import { ProductService, Product, primaryProductImage } from '../../services/product.service';
import { CartService } from '../../services/cart.service';
import { WishlistService } from '../../services/wishlist.service';
import { ToastService } from '../../services/toast.service';

@Component({
  selector: 'app-product-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, PricePipe, ImageFallbackDirective],
  templateUrl: './product-detail.component.html',
  styleUrl: './product-detail.component.css'
})
export class ProductDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private productService = inject(ProductService);
  private cartService = inject(CartService);
  private wishlistService = inject(WishlistService);
  private readonly toast = inject(ToastService);

  product: Product | undefined;
  relatedProducts: Product[] = [];
  quantity: number = 1;
  selectedImageIndex = 0;
  isUploading = false;
  uploadMessage = '';

  ngOnInit() {
    this.route.params.subscribe(params => {
      void this.loadProduct(params['id'] ?? null);
    });
  }

  private async loadProduct(productId: string | null): Promise<void> {
    this.product = undefined;
    this.relatedProducts = [];
    this.selectedImageIndex = 0;

    if (productId === null) {
      return;
    }

    await this.productService.ensureLoaded();
    const product = this.productService.getProductById(productId);
    if (!product) {
      return;
    }

    this.product = product;
    this.relatedProducts = this.productService
      .getProductsByCategory(product.category)
      .filter(relatedProduct => relatedProduct.id !== product.id)
      .slice(0, 3);
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

  trackByImage(_: number, image: string) {
    return image;
  }

  galleryImages(product?: Product): string[] {
    if (!product) {
      return [];
    }

    const images = Array.isArray(product.images) ? product.images : [];
    return images.length > 0 ? images : [primaryProductImage(undefined, undefined, product.name)];
  }

  selectedImage(product?: Product): string {
    const images = this.galleryImages(product);
    if (images.length === 0) {
      return primaryProductImage(undefined, undefined, product?.name);
    }
    return images[Math.min(this.selectedImageIndex, images.length - 1)];
  }

  selectImage(index: number) {
    this.selectedImageIndex = index;
  }

  primaryImage(product?: Product): string {
    // Stateless first-image lookup: related-product cards must not inherit the
    // main gallery's selected index.
    return primaryProductImage(product?.images, undefined, product?.name);
  }

  addToCart() {
    if (!this.product) {
      return;
    }
    this.cartService.addToCart(this.product, this.quantity);
    this.toast.success(`${this.quantity} ${this.product.name} item(s) added to cart.`);
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
        this.toast.error('Unable to access wishlists. Please try again.');
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
          this.toast.success('Product added to wishlist!');
        } else {
          this.toast.error('Failed to add product to wishlist.');
        }
      },
      error: (error) => {
        console.error('Error adding to wishlist:', error);
        this.toast.error('Failed to add product to wishlist.');
      }
    });
  }

  // image fallback handled by ImageFallbackDirective

  /** Add an image URL to the product gallery */
  async addImageToGallery(imageUrl: string): Promise<void> {
    if (!this.product || !this.product.id) {
      this.toast.error('Cannot add image: product not loaded.');
      return;
    }

    if (!imageUrl || !imageUrl.trim()) {
      this.toast.error('Please enter a valid image URL.');
      return;
    }

    this.isUploading = true;
    this.uploadMessage = '';

    try {
      await this.productService.addProductImage(this.product.id, imageUrl.trim());
      this.toast.success('Image added to gallery!');
      // Refresh product data
      const refreshed = this.productService.getProductById(this.product.id);
      if (refreshed) {
        this.product = refreshed;
      }
    } catch (error) {
      console.error('Error adding image:', error);
      this.toast.error('Failed to add image. Please try again.');
    } finally {
      this.isUploading = false;
    }
  }

  /** Remove an image at the given index */
  async removeImageFromGallery(index: number): Promise<void> {
    if (!this.product || !this.product.id) {
      this.toast.error('Cannot remove image: product not loaded.');
      return;
    }

    try {
      await this.productService.removeProductImage(this.product.id, index);
      this.toast.success('Image removed from gallery.');
      // Refresh product data
      const refreshed = this.productService.getProductById(this.product.id);
      if (refreshed) {
        this.product = refreshed;
      }
    } catch (error) {
      console.error('Error removing image:', error);
      this.toast.error('Failed to remove image. Please try again.');
    }
  }
}

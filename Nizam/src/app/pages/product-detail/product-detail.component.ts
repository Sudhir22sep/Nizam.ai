import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { PricePipe } from '../../pipes/price.pipe';
import { ImageFallbackDirective } from '../../directives/image-fallback.directive';
import { ProductService, Product, primaryProductImage, productSizes, variantPrice } from '../../services/product.service';
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
  selectedSize: string | null = null;
  isLoading = true;
  loadError: string | null = null;
  isUploading = false;
  uploadImageUrl = '';
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
    this.selectedSize = null;
    this.quantity = 1;
    this.uploadImageUrl = '';
    this.uploadMessage = '';
    this.isLoading = true;
    this.loadError = null;

    if (productId === null) {
      this.isLoading = false;
      this.loadError = 'No product was selected.';
      return;
    }

    try {
      await this.productService.ensureLoaded();
      const product =
        this.productService.getProductById(productId) ??
        (await this.productService.fetchProductById(productId));
      if (!product) {
        this.loadError = 'We could not find that product. It may have been removed.';
        return;
      }

      this.product = product;
      const sizes = this.availableSizes;
      this.selectedSize = sizes.length === 1 ? sizes[0] : null;
      this.relatedProducts = this.productService
        .getProductsByCategory(product.category)
        .filter(relatedProduct => relatedProduct.id !== product.id)
        .slice(0, 3);
    } catch (error) {
      console.error('Failed to load product details:', error);
      this.loadError = 'Product details are temporarily unavailable. Please try again.';
    } finally {
      this.isLoading = false;
    }
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

  trackBySize(_: number, size: string) {
    return size;
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
    if (this.availableSizes.length > 0 && !this.selectedSize) {
      this.toast.warning('Please choose a size before adding this item to your cart.');
      return;
    }
    this.cartService.addToCart(
      this.product,
      this.quantity,
      this.selectedSize ?? undefined,
      this.displayPrice
    );
    const sizeLabel = this.selectedSize ? ` in size ${this.selectedSize}` : '';
    this.toast.success(`${this.quantity} ${this.product.name}${sizeLabel} item(s) added to cart.`);
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

  /** Sizes available for the loaded product, including category defaults. */
  get availableSizes(): string[] {
    return productSizes(this.product);
  }

  /** Active unit price for the currently selected size/variant. */
  get displayPrice(): number {
    return variantPrice(this.product, this.selectedSize);
  }

  /** Compare-at price for the discount badge, when one is available. */
  get compareAtPrice(): number | null {
    const value = this.product?.originalPrice ?? null;
    return typeof value === 'number' && Number.isFinite(value) && value > this.displayPrice
      ? value
      : null;
  }

  get discountPercent(): number | null {
    if (this.compareAtPrice === null) {
      return null;
    }
    return Math.round((1 - this.displayPrice / (this.compareAtPrice as number)) * 100);
  }

  get ratingValue(): number | null {
    const rating = this.product?.rating ?? null;
    return typeof rating === 'number' && Number.isFinite(rating)
      ? Math.max(0, Math.min(5, rating))
      : null;
  }

  get reviewCount(): number {
    return this.product?.reviewCount ?? 0;
  }

  get ratingStars(): string {
    if (this.ratingValue === null) {
      return '★★★★★';
    }
    const full = Math.round(this.ratingValue);
    return '★'.repeat(full).padEnd(5, '☆');
  }

  get stockLabel(): { text: string; inStock: boolean } {
    const stock = this.product?.stock ?? null;
    if (stock === null) {
      return { text: '✓ In Stock', inStock: true };
    }
    if (stock <= 0) {
      return { text: 'Out of stock', inStock: false };
    }
    if (stock <= 3) {
      return { text: `Only ${stock} left in stock`, inStock: true };
    }
    return { text: '✓ In Stock', inStock: true };
  }

  get isOutOfStock(): boolean {
    return !this.stockLabel.inStock;
  }

  selectSize(size: string): void {
    this.selectedSize = size;
  }

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
      this.uploadImageUrl = '';
      // Refresh product data from the server so variant/image changes appear.
      const refreshed = await this.productService.fetchProductById(this.product.id);
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
      // Refresh product data from the server so the gallery updates reliably.
      const refreshed = await this.productService.fetchProductById(this.product.id);
      if (refreshed) {
        this.product = refreshed;
        this.selectedImageIndex = Math.min(this.selectedImageIndex, Math.max(0, this.galleryImages(refreshed).length - 1));
      }
    } catch (error) {
      console.error('Error removing image:', error);
      this.toast.error('Failed to remove image. Please try again.');
    }
  }
}

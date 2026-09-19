import { Component, OnInit, inject, signal } from '@angular/core';
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

  /**
   * View state is signal-based on purpose: this app runs zoneless (Angular 21
   * defaults to zoneless and no `zone.js` polyfill is loaded), so assigning to a
   * plain field after an `await` never schedules change detection. The template
   * would stay stuck on its loading state even though the data had arrived.
   */
  readonly product = signal<Product | undefined>(undefined);
  readonly relatedProducts = signal<Product[]>([]);
  readonly quantity = signal(1);
  readonly selectedImageIndex = signal(0);
  readonly selectedSize = signal<string | null>(null);
  readonly isLoading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly isUploading = signal(false);
  readonly uploadImageUrl = signal('');
  readonly uploadMessage = signal('');

  ngOnInit() {
    this.route.params.subscribe(params => {
      void this.loadProduct(params['id'] ?? null);
    });
  }

  private async loadProduct(productId: string | null): Promise<void> {
    this.product.set(undefined);
    this.relatedProducts.set([]);
    this.selectedImageIndex.set(0);
    this.selectedSize.set(null);
    this.quantity.set(1);
    this.uploadImageUrl.set('');
    this.uploadMessage.set('');
    this.isLoading.set(true);
    this.loadError.set(null);

    if (productId === null) {
      this.isLoading.set(false);
      this.loadError.set('No product was selected.');
      return;
    }

    try {
      await this.productService.ensureLoaded();
      const product =
        this.productService.getProductById(productId) ??
        (await this.productService.fetchProductById(productId));
      if (!product) {
        this.loadError.set('We could not find that product. It may have been removed.');
        return;
      }

      this.product.set(product);
      const sizes = this.availableSizes;
      this.selectedSize.set(sizes.length === 1 ? sizes[0] : null);
      this.relatedProducts.set(
        this.productService
          .getProductsByCategory(product.category)
          .filter(relatedProduct => relatedProduct.id !== product.id)
          .slice(0, 3)
      );
    } catch (error) {
      console.error('Failed to load product details:', error);
      this.loadError.set('Product details are temporarily unavailable. Please try again.');
    } finally {
      this.isLoading.set(false);
    }
  }

  incrementQuantity() {
    this.quantity.update(current => current + 1);
  }

  decrementQuantity() {
    if (this.quantity() > 1) {
      this.quantity.update(current => current - 1);
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
    return images[Math.min(this.selectedImageIndex(), images.length - 1)];
  }

  selectImage(index: number) {
    this.selectedImageIndex.set(index);
  }

  primaryImage(product?: Product): string {
    // Stateless first-image lookup: related-product cards must not inherit the
    // main gallery's selected index.
    return primaryProductImage(product?.images, undefined, product?.name);
  }

  addToCart() {
    const product = this.product();
    if (!product) {
      return;
    }
    const selectedSize = this.selectedSize();
    if (this.availableSizes.length > 0 && !selectedSize) {
      this.toast.warning('Please choose a size before adding this item to your cart.');
      return;
    }
    const quantity = this.quantity();
    this.cartService.addToCart(
      product,
      quantity,
      selectedSize ?? undefined,
      this.displayPrice
    );
    const sizeLabel = selectedSize ? ` in size ${selectedSize}` : '';
    this.toast.success(`${quantity} ${product.name}${sizeLabel} item(s) added to cart.`);
  }

  addToWishlist() {
    if (!this.product()) {
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
    const product = this.product();
    if (!product) return;

    this.wishlistService.addItemToWishlist(
      wishlistId,
      product.id,
      null, // variantId
      ''    // notes
    ).subscribe({
      next: (response) => {
        if (response.success) {
          this.toast.success(`${product.name} added to wishlist!`);
        } else {
          this.toast.error(`Failed to add ${product.name} to wishlist.`);
        }
      },
      error: (error) => {
        const message = error?.error?.message;
        if (error?.status === 409 || message?.toLowerCase().includes('already exists')) {
          this.toast.info(`${product.name} is already in your wishlist.`);
          return;
        }
        console.error('Error adding to wishlist:', error);
        this.toast.error(`Failed to add ${product.name} to wishlist.`);
      }
    });
  }

  // image fallback handled by ImageFallbackDirective

  /** Sizes available for the loaded product, including category defaults. */
  get availableSizes(): string[] {
    return productSizes(this.product());
  }

  /** Active unit price for the currently selected size/variant. */
  get displayPrice(): number {
    return variantPrice(this.product(), this.selectedSize());
  }

  /** Compare-at price for the discount badge, when one is available. */
  get compareAtPrice(): number | null {
    const value = this.product()?.originalPrice ?? null;
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
    const rating = this.product()?.rating ?? null;
    return typeof rating === 'number' && Number.isFinite(rating)
      ? Math.max(0, Math.min(5, rating))
      : null;
  }

  get reviewCount(): number {
    return this.product()?.reviewCount ?? 0;
  }

  get ratingStars(): string {
    if (this.ratingValue === null) {
      return '★★★★★';
    }
    const full = Math.round(this.ratingValue);
    return '★'.repeat(full).padEnd(5, '☆');
  }

  get stockLabel(): { text: string; inStock: boolean } {
    const stock = this.product()?.stock ?? null;
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
    this.selectedSize.set(size);
  }

  /** Add an image URL to the product gallery */
  async addImageToGallery(imageUrl: string): Promise<void> {
    const product = this.product();
    if (!product || !product.id) {
      this.toast.error('Cannot add image: product not loaded.');
      return;
    }

    if (!imageUrl || !imageUrl.trim()) {
      this.toast.error('Please enter a valid image URL.');
      return;
    }

    this.isUploading.set(true);
    this.uploadMessage.set('');

    try {
      await this.productService.addProductImage(product.id, imageUrl.trim());
      this.toast.success('Image added to gallery!');
      this.uploadImageUrl.set('');
      // Refresh product data from the server so variant/image changes appear.
      const refreshed = await this.productService.fetchProductById(product.id);
      if (refreshed) {
        this.product.set(refreshed);
      }
    } catch (error) {
      console.error('Error adding image:', error);
      this.toast.error('Failed to add image. Please try again.');
    } finally {
      this.isUploading.set(false);
    }
  }

  /** Remove an image at the given index */
  async removeImageFromGallery(index: number): Promise<void> {
    const product = this.product();
    if (!product || !product.id) {
      this.toast.error('Cannot remove image: product not loaded.');
      return;
    }

    try {
      await this.productService.removeProductImage(product.id, index);
      this.toast.success('Image removed from gallery.');
      // Refresh product data from the server so the gallery updates reliably.
      const refreshed = await this.productService.fetchProductById(product.id);
      if (refreshed) {
        this.product.set(refreshed);
        this.selectedImageIndex.set(
          Math.min(this.selectedImageIndex(), Math.max(0, this.galleryImages(refreshed).length - 1))
        );
      }
    } catch (error) {
      console.error('Error removing image:', error);
      this.toast.error('Failed to remove image. Please try again.');
    }
  }
}

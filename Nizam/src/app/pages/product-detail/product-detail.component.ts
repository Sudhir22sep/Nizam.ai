import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { PricePipe } from '../../pipes/price.pipe';
import { ProductCardComponent } from '../../components/product-card/product-card.component';
import { ImageFallbackDirective } from '../../directives/image-fallback.directive';
import { ProductService, Product, normalizeProductImages, primaryProductImage, productSizes, variantPrice } from '../../services/product.service';
import { CartService } from '../../services/cart.service';
import { WishlistService } from '../../services/wishlist.service';
import { ToastService } from '../../services/toast.service';

@Component({
  selector: 'app-product-detail',
  standalone: true,
  imports: [CommonModule, RouterLink, PricePipe, ImageFallbackDirective, ProductCardComponent],
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

    const images = normalizeProductImages(product.images, undefined, product.name);
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

  nextImage(): void {
    const count = this.galleryImages(this.product()).length;
    if (count > 1) {
      this.selectedImageIndex.update(index => (index + 1) % count);
    }
  }

  previousImage(): void {
    const count = this.galleryImages(this.product()).length;
    if (count > 1) {
      this.selectedImageIndex.update(index => (index - 1 + count) % count);
    }
  }

  galleryItemTransform(index: number): string {
    const images = this.galleryImages(this.product());
    if (index === this.selectedImageIndex()) return 'translate3d(0, 0, 80px) rotateY(0deg)';
    const distance = index - this.selectedImageIndex();
    const wrapped = distance > images.length / 2
      ? distance - images.length
      : distance < -images.length / 2 ? distance + images.length : distance;
    const direction = Math.sign(wrapped) || 1;
    return `translate3d(${direction * 64}%, 0, -120px) rotateY(${direction * -45}deg) scale(.86)`;
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

  /** Gallery selection is shopper-facing; image management is owner tooling. */
}

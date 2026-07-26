import { Component, effect, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { PricePipe } from '../../pipes/price.pipe';
import { ImageFallbackDirective } from '../../directives/image-fallback.directive';
import { ProductService, Product } from '../../services/product.service';
import { CartService } from '../../services/cart.service';

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

  product: Product | undefined;
  relatedProducts: Product[] = [];
  quantity: number = 1;
  private productId: number | null = null;

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
      this.productId = parseInt(params['id'], 10);
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

  // image fallback handled by ImageFallbackDirective
}

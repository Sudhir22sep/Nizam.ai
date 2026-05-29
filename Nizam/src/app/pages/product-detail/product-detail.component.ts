import { Component, OnInit } from '@angular/core';
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
  product: Product | undefined;
  relatedProducts: Product[] = [];
  quantity: number = 1;

  constructor(
    private route: ActivatedRoute,
    private productService: ProductService,
    private cartService: CartService
  ) {}

  ngOnInit() {
    this.route.params.subscribe(params => {
      const id = parseInt(params['id'], 10);
      this.product = this.productService.getProductById(id);
      
      if (this.product) {
        this.relatedProducts = this.productService
          .getProductsByCategory(this.product.category)
          .filter(p => p.id !== this.product!.id)
          .slice(0, 3);
      }
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

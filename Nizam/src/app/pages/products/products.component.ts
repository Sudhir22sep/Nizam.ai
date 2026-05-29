import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { PricePipe } from '../../pipes/price.pipe';
import { ImageFallbackDirective } from '../../directives/image-fallback.directive';
import { ProductService, Product } from '../../services/product.service';
import { CartService } from '../../services/cart.service';

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
    private cartService: CartService
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

  trackByProductId(_: number, product: Product) {
    return product.id;
  }

  // image fallback handled by ImageFallbackDirective
}

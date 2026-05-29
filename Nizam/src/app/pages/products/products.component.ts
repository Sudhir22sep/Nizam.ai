import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { PricePipe } from '../../pipes/price.pipe';
import { ProductService, Product } from '../../services/product.service';
import { CartService } from '../../services/cart.service';

@Component({
  selector: 'app-products',
  standalone: true,
  imports: [CommonModule, RouterLink, PricePipe],
  templateUrl: './products.component.html',
  styleUrl: './products.component.css'
})
export class ProductsComponent implements OnInit {
  products: Product[] = [];
  categories: string[] = [];
  selectedCategory: string = '';

  constructor(
    private productService: ProductService,
    private cartService: CartService
  ) {}

  ngOnInit() {
    this.loadProducts();
    this.categories = this.productService.getCategories();
  }

  loadProducts() {
    const productsSignal = this.productService.getProducts();
    this.products = productsSignal();
  }

  filterByCategory(category: string) {
    this.selectedCategory = category;
    if (category) {
      this.products = this.productService.getProductsByCategory(category);
    } else {
      this.loadProducts();
    }
  }

  resetFilter() {
    this.selectedCategory = '';
    this.loadProducts();
  }

  addToCart(product: Product) {
    this.cartService.addToCart(product, 1);
    alert(`${product.name} has been added to your cart.`);
  }

  onImageError(event: Event) {
    const img = event.target as HTMLImageElement;
    if (img) {
      img.src = 'images/products/placeholder.svg';
    }
  }
}

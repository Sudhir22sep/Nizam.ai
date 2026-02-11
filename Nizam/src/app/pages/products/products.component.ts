import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ProductService, Product } from '../../services/product.service';

@Component({
  selector: 'app-products',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './products.component.html',
  styleUrl: './products.component.css'
})
export class ProductsComponent implements OnInit {
  products: Product[] = [];
  categories: string[] = [];
  selectedCategory: string = '';

  constructor(private productService: ProductService) {}

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
}

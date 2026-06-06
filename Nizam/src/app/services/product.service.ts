import { Injectable, signal } from '@angular/core';

export interface Product {
  id: number;
  name: string;
  description: string;
  price: number;
  image: string;
  category: string;
  arPreviewAvailable?: boolean;
  arModelUrl?: string;
}

@Injectable({ providedIn: 'root' })
export class ProductService {
  private productsSignal = signal<Product[]>([]);

  constructor() {
    void this.loadProducts();
  }

  private async loadProducts() {
    try {
      const res = await fetch('/assets/products.json');
      if (!res.ok) throw new Error('Failed to load products.json');
      const data = await res.json();
      this.productsSignal.set(data as Product[]);
    } catch (e) {
      console.error('Error loading products.json', e);
    }
  }

  getProducts() {
    return this.productsSignal.asReadonly();
  }

  getProductById(id: number): Product | undefined {
    return this.productsSignal().find(p => p.id === id);
  }

  getProductsByCategory(category: string): Product[] {
    return this.productsSignal().filter(p => p.category === category);
  }

  getCategories(): string[] {
    return Array.from(new Set(this.productsSignal().map(p => p.category)));
  }
}

import { Injectable } from '@angular/core';
import { signal } from '@angular/core';

export interface Product {
  id: number;
  name: string;
  description: string;
  price: number;
  image: string;
  category: string;
}

@Injectable({
  providedIn: 'root'
})
export class ProductService {
  private products: Product[] = [
    {
      id: 1,
      name: 'Product 1',
      description: 'High quality product with excellent features',
      price: 29.99,
      image: 'https://via.placeholder.com/300x200?text=Product+1',
      category: 'Electronics'
    },
    {
      id: 2,
      name: 'Product 2',
      description: 'Premium design with modern technology',
      price: 49.99,
      image: 'https://via.placeholder.com/300x200?text=Product+2',
      category: 'Electronics'
    },
    {
      id: 3,
      name: 'Product 3',
      description: 'Durable and reliable performance',
      price: 39.99,
      image: 'https://via.placeholder.com/300x200?text=Product+3',
      category: 'Accessories'
    },
    {
      id: 4,
      name: 'Product 4',
      description: 'Innovative solution for everyday use',
      price: 59.99,
      image: 'https://via.placeholder.com/300x200?text=Product+4',
      category: 'Accessories'
    },
    {
      id: 5,
      name: 'Product 5',
      description: 'Best seller with customer reviews',
      price: 44.99,
      image: 'https://via.placeholder.com/300x200?text=Product+5',
      category: 'Electronics'
    },
    {
      id: 6,
      name: 'Product 6',
      description: 'Limited edition exclusive item',
      price: 69.99,
      image: 'https://via.placeholder.com/300x200?text=Product+6',
      category: 'Premium'
    }
  ];

  private productsSignal = signal<Product[]>(this.products);

  getProducts() {
    return this.productsSignal.asReadonly();
  }

  getProductById(id: number): Product | undefined {
    return this.products.find(p => p.id === id);
  }

  getProductsByCategory(category: string): Product[] {
    return this.products.filter(p => p.category === category);
  }

  getCategories(): string[] {
    return Array.from(new Set(this.products.map(p => p.category)));
  }
}

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
      name: 'Satin Slip Dress',
      description: 'A sleek silhouette in satin with a delicate cowl neckline, perfect for evening outings and warm-weather style.',
      price: 84.99,
      image: 'https://via.placeholder.com/600x800?text=Satin+Slip+Dress',
      category: 'Women'
    },
    {
      id: 2,
      name: 'Denim Trucker Jacket',
      description: 'A modern take on a classic trucker jacket with structured shoulders and a comfortable vintage wash.',
      price: 119.99,
      image: 'https://via.placeholder.com/600x800?text=Denim+Trucker+Jacket',
      category: 'Men'
    },
    {
      id: 3,
      name: 'Leather Tote Bag',
      description: 'A supple leather tote with clean lines and interior pockets for everyday essentials.',
      price: 138.00,
      image: 'https://via.placeholder.com/600x800?text=Leather+Tote+Bag',
      category: 'Accessories'
    },
    {
      id: 4,
      name: 'Linen Relaxed Shirt',
      description: 'Breathable linen in a relaxed fit, designed for effortless layering and refined casual dressing.',
      price: 79.50,
      image: 'https://via.placeholder.com/600x800?text=Linen+Relaxed+Shirt',
      category: 'Men'
    },
    {
      id: 5,
      name: 'Silk Scarf',
      description: 'A timeless silk scarf featuring an elegant print to elevate any outfit.',
      price: 49.95,
      image: 'https://via.placeholder.com/600x800?text=Silk+Scarf',
      category: 'Accessories'
    },
    {
      id: 6,
      name: 'Stitched Leather Sneakers',
      description: 'Minimal leather sneakers with cushioned comfort and polished details for everyday wear.',
      price: 112.00,
      image: 'https://via.placeholder.com/600x800?text=Leather+Sneakers',
      category: 'Footwear'
    },
    {
      id: 7,
      name: 'Cashmere Crewneck',
      description: 'A soft cashmere crewneck with a refined fit and luxurious feel for cozy layering.',
      price: 149.99,
      image: 'https://via.placeholder.com/600x800?text=Cashmere+Crewneck',
      category: 'Women'
    },
    {
      id: 8,
      name: 'Tailored Chinos',
      description: 'Smart casual chinos cut with a tailored silhouette, ready for work or weekend plans.',
      price: 89.00,
      image: 'https://via.placeholder.com/600x800?text=Tailored+Chinos',
      category: 'Men'
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

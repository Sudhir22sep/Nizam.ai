import { Injectable, signal, PLATFORM_ID, Inject } from '@angular/core';
import { isPlatformServer } from '@angular/common';
import { HttpClient } from '@angular/common/http';

export interface Product {
  id: string;
  name: string;
  description: string;
  basePrice: number;
  currency: string;
  category: string;
  images: string[];
  variants: any[];
  tags: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  arPreviewAvailable?: boolean;
  arModelUrl?: string;
}

@Injectable({ providedIn: 'root' })
export class ProductService {
  private productsSignal = signal<Product[]>([]);
  private productsLoaded = false;
  private loadingPromise: Promise<void> | null = null;

  constructor(
    @Inject(PLATFORM_ID) private platformId: Object,
    private http: HttpClient
  ) {
    // Start loading immediately
    this.loadingPromise = this.loadProducts();
  }

  private async loadProducts(): Promise<void> {
    if (this.productsLoaded) return;

    try {
      let data: Product[];

      // Always try to fetch from API first, fallback to JSON if needed
      try {
        const apiUrl = isPlatformServer(this.platformId) ? 'http://localhost:4000' : '';
        const response = await this.http.get<{ success: boolean; products: Product[] }>(`${apiUrl}/api/products`).toPromise();
        if (response?.success) {
          data = response.products.map((p: any) => ({
            id: p._id.toString(),
            name: p.name,
            description: p.description,
            basePrice: p.basePrice,
            currency: p.currency,
            category: p.category,
            images: p.images || [],
            variants: p.variants || [],
            tags: p.tags || [],
            isActive: p.isActive !== undefined ? p.isActive : true,
            createdAt: p.createdAt ? new Date(p.createdAt) : new Date(),
            updatedAt: p.updatedAt ? new Date(p.updatedAt) : new Date()
          }));
        } else {
          throw new Error('API returned unsuccessful response');
        }
      } catch (apiError) {
        console.warn('Failed to fetch from API, falling back to JSON:', apiError);
        // Fallback to static JSON
        const res = await fetch('/assets/products.json');
        if (!res.ok) throw new Error('Failed to load products.json');
        const jsonData = await res.json();
        
        data = jsonData.map((p: any) => ({
          id: p.id.toString(),
          name: p.name,
          description: p.description,
          basePrice: p.price,
          currency: 'USD',
          category: p.category,
          images: [p.image],
          variants: [],
          tags: [],
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date()
        }));
      }

      this.productsSignal.set(data);
      this.productsLoaded = true;
    } catch (e) {
      console.error('Error loading products', e);
      this.productsLoaded = true; // Prevent retry loops
      this.productsSignal.set([]); // Set empty array on error
    }
  }

  async ensureLoaded(): Promise<void> {
    if (this.loadingPromise) {
      await this.loadingPromise;
    }
  }

  getProducts() {
    return this.productsSignal.asReadonly();
  }

  getProductById(id: string): Product | undefined {
    return this.productsSignal().find(p => p.id === id);
  }

  getProductsByCategory(category: string): Product[] {
    return this.productsSignal().filter(p => p.category === category);
  }

  getCategories(): string[] {
    return Array.from(new Set(this.productsSignal().map(p => p.category)));
  }
}

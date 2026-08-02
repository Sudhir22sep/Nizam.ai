import { Injectable, signal, PLATFORM_ID, Inject } from '@angular/core';
import { isPlatformServer } from '@angular/common';

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
  private productsLoaded = false;
  private loadingPromise: Promise<void> | null = null;

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {
    // Start loading immediately
    this.loadingPromise = this.loadProducts();
  }

  private async loadProducts(): Promise<void> {
    if (this.productsLoaded) return;

    try {
      let data: Product[];

      if (isPlatformServer(this.platformId)) {
        // SSR: Read file directly from filesystem using require()
        // to avoid TypeScript static analysis issues in browser builds/tests
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fs = require('fs') as { readFileSync: (path: string, encoding: string) => string };
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const path = require('path') as { join: (...paths: string[]) => string };
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const url = require('url') as { fileURLToPath: (url: string) => string };
        
        const __filename = url.fileURLToPath(import.meta.url);
        const __dirname = path.join(__filename, '..');
        const possiblePaths = [
          // Production build path
          path.join(__dirname, '../../browser/assets/products.json'),
          // Alternative production path
          path.join(__dirname, '../../../browser/assets/products.json'),
          // Dev path
          path.join(__dirname, '../../../public/assets/products.json'),
        ];

        let fileContent: string | null = null;
        for (const p of possiblePaths) {
          try {
            fileContent = fs.readFileSync(p, 'utf-8');
            break;
          } catch {
            // Try next path
          }
        }

        if (!fileContent) {
          throw new Error('Could not find products.json in any expected location');
        }

        data = JSON.parse(fileContent) as Product[];
      } else {
        // CSR: Fetch from HTTP
        const res = await fetch('/assets/products.json');
        if (!res.ok) throw new Error('Failed to load products.json');
        data = await res.json();
      }

      this.productsSignal.set(data);
      this.productsLoaded = true;
    } catch (e) {
      console.error('Error loading products.json', e);
      this.productsLoaded = true; // Prevent retry loops
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

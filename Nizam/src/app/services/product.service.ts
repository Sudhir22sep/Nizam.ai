import { Injectable, signal, PLATFORM_ID, Inject } from '@angular/core';
import { isPlatformServer } from '@angular/common';
import { HttpClient } from '@angular/common/http';

export const PRODUCT_IMAGE_PLACEHOLDER = '/images/products/placeholder.svg';

// Satin Slip Dress has three proper photographic views in the repo and should
// never fall back to the generic placeholder.
export const SATIN_SLIP_DRESS_IMAGES = [
  '/images/products/slip-dress.jpeg',
  '/images/products/satin.jpg',
  '/images/products/satin-slip-dress.jpeg'
];

function normalizeProductImage(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const image = value.trim();
  if (!image || image === 'null' || image === 'undefined') {
    return null;
  }

  // Keep fully qualified URLs and root-relative app paths as-is.
  if (/^(https?:|data:|blob:|\/)/i.test(image)) {
    return image;
  }

  // Catalog data historically stores paths such as
  // "images/products/satin-slip-dress.jpeg" without a leading slash. Serve them
  // root-relative so they keep working on nested routes such as /product/:id.
  return `/${image.replace(/^\.\//, '')}`;
}

export function normalizeProductImages(images: unknown, image?: unknown, productName?: string): string[] {
  if (isSatinSlipDress(productName)) {
    return [...SATIN_SLIP_DRESS_IMAGES];
  }

  const rawImages = Array.isArray(images) ? images : image !== undefined ? [image] : [];
  const normalized: string[] = [];

  for (const rawImage of rawImages) {
    const normalizedImage = normalizeProductImage(rawImage);
    if (normalizedImage && !normalized.includes(normalizedImage)) {
      normalized.push(normalizedImage);
    }
  }

  return normalized;
}

function isSatinSlipDress(productName?: string): boolean {
  return typeof productName === 'string' && productName.trim().toLowerCase() === 'satin slip dress';
}

export function primaryProductImage(images: unknown, image?: unknown, productName?: string): string {
  return normalizeProductImages(images, image, productName)[0] ?? PRODUCT_IMAGE_PLACEHOLDER;
}


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
            basePrice: p.basePrice ?? p.price ?? 0,
            currency: p.currency,
            category: p.category,
            images: normalizeProductImages(p.images, p.image, p.name),
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
          images: normalizeProductImages(p.images, p.image, p.name),
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

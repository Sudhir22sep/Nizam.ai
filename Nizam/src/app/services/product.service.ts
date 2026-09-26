import { Injectable, signal, PLATFORM_ID, Inject } from '@angular/core';
import { isPlatformServer } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';

export const PRODUCT_IMAGE_PLACEHOLDER = '/images/products/placeholder.svg';

/** Hard ceiling for catalog requests so a stalled backend cannot hang the UI. */
const CATALOG_TIMEOUT_MS = 8000;

/** Mongo ObjectIds are the only product ids the products API can resolve. */
const MONGO_OBJECT_ID = /^[a-f\d]{24}$/i;

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

/** Widths the generated WebP variants exist at (see scripts/optimize-images.mjs). */
const RESPONSIVE_IMAGE_WIDTHS = [320, 640, 1280];

/**
 * Builds a `srcset` for a local product photo, or null when there is nothing
 * useful to offer.
 *
 * Only bundled repo images have generated WebP variants. Catalog images are
 * usually remote (myntassets CDN) or SVG, and those are already served in the
 * most efficient form available, so they get no srcset rather than candidates
 * that would 404 and make the browser fall back after a wasted request.
 */
export function productImageSrcset(image: string | null | undefined): string | null {
  if (!image || !/^\/images\/products\/.+\.(jpe?g|png)$/i.test(image)) {
    return null;
  }

  const dot = image.lastIndexOf('.');
  const stem = image.slice(0, dot);

  return RESPONSIVE_IMAGE_WIDTHS
    .map(width => `${stem}-${width}w.webp ${width}w`)
    .join(', ');
}

function toOptionalNumber(value: unknown): number | null {
  const numeric = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof numeric === 'number' && Number.isFinite(numeric) ? numeric : null;
}

function toCount(value: unknown): number {
  const numeric = toOptionalNumber(value);
  return numeric === null ? 0 : Math.max(0, Math.floor(numeric));
}

function toOptionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Normalize catalog variant entries (API or JSON) into typed size/price variants. */
export function normalizeProductVariants(rawVariants: unknown): ProductVariant[] {
  if (!Array.isArray(rawVariants)) {
    return [];
  }

  const variants: ProductVariant[] = [];
  for (const raw of rawVariants) {
    if (!raw || typeof raw !== 'object') {
      continue;
    }
    const entry = raw as Record<string, unknown>;
    const nameValue = entry['name'] ?? entry['size'] ?? entry['label'] ?? entry['title'];
    const name = typeof nameValue === 'string' && nameValue.trim() ? nameValue.trim() : undefined;
    const idValue = entry['id'] ?? entry['_id'] ?? entry['variantId'];
    const id = typeof idValue === 'string' || typeof idValue === 'number' ? String(idValue) : undefined;
    const price = toOptionalNumber(entry['price'] ?? entry['basePrice']);

    if (!name && !id && price === null) {
      continue;
    }
    variants.push({ id, name, price });
  }
  return variants;
}

const APPAREL_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
const FOOTWEAR_SIZES = ['UK 6', 'UK 7', 'UK 8', 'UK 9', 'UK 10', 'UK 11'];

/**
 * Size options for a product: explicit variant names first, otherwise sensible
 * defaults derived from the category so every product gets a real size picker.
 */
export function productSizes(product: Pick<Product, 'category' | 'variants'> | undefined): string[] {
  if (!product) {
    return [];
  }
  const variantSizes = (product.variants ?? [])
    .map(variant => variant?.name?.trim())
    .filter((name): name is string => !!name);
  if (variantSizes.length > 0) {
    return Array.from(new Set(variantSizes));
  }

  const category = (product.category ?? '').trim().toLowerCase();
  if (category.includes('footwear') || category.includes('shoe') || category.includes('sneaker')) {
    return [...FOOTWEAR_SIZES];
  }
  if (category.includes('accessor') || category.includes('bag') || category.includes('scarf')) {
    return ['One Size'];
  }
  return [...APPAREL_SIZES];
}

/**
 * Unit price for a size selection. Variant prices are honored when the catalog
 * defines one; otherwise the authoritative catalog base price applies so cart
 * and checkout totals stay consistent with server-side pricing.
 */
export function variantPrice(product: Pick<Product, 'basePrice' | 'variants'> | undefined, size?: string | null): number {
  const basePrice = product?.basePrice ?? 0;
  const wanted = (size ?? '').trim().toLowerCase();
  if (!wanted) {
    return basePrice;
  }
  const match = (product?.variants ?? []).find(
    variant => (variant?.name ?? '').trim().toLowerCase() === wanted && variant?.price !== null && variant?.price !== undefined
  );
  return match?.price ?? basePrice;
}export interface ProductVariant {
  id?: string;
  name?: string;
  price?: number | null;
}

export interface Product {
  id: string;
  name: string;
  description: string;
  basePrice: number;
  /** Compare-at / MRP price used for display-only discount badges. */
  originalPrice?: number | null;
  currency: string;
  category: string;
  images: string[];
  variants: ProductVariant[];
  tags: string[];
  isActive: boolean;
  /** Average rating out of 5 when the catalog provides one. */
  rating?: number | null;
  reviewCount?: number;
  /** Units available when the catalog tracks inventory; null means unknown. */
  stock?: number | null;
  createdAt: Date;
  updatedAt: Date;
  arPreviewAvailable?: boolean;
  arModelUrl?: string;
  /**
   * Owner/backend-only supplier checkout link.
   *
   * Populated from the catalog for backend tooling only: the storefront never
   * renders it, the public products API strips it, and an admin-only endpoint
   * (`GET /api/admin/products/:id/purchase-link`) serves it instead.
   */
  buyUrl?: string | null;
  /** Owner/backend-only supplier reference. Never rendered in the storefront. */
  supplier?: string | null;
}

/**
 * Removes a duplicated brand prefix from product names, e.g.
 * "DKNY DKNY Unisex Black Trolley Bag" → "DKNY Unisex Black Trolley Bag".
 *
 * The bundled catalog was imported from a CSV whose `name` column already
 * started with the `brand` column, and the importer prepended the brand
 * again, so many catalog names repeat the brand twice. This collapses any
 * leading word sequence that immediately repeats itself (comparing
 * whitespace-split words, so "Raymond Raymonds" is not collapsed).
 * Runtime safety net: data from MongoDB or future imports can never render
 * doubled names.
 */
export function cleanProductName(name: unknown): string {
  if (typeof name !== 'string') {
    return 'Untitled product';
  }
  const trimmed = name.trim();
  const words = trimmed.split(/\s+/);
  for (let take = Math.floor(words.length / 2); take >= 1; take -= 1) {
    const first = words.slice(0, take).join(' ').toLowerCase();
    const second = words.slice(take, take * 2).join(' ').toLowerCase();
    if (first.length > 0 && first === second) {
      return words.slice(take).join(' ');
    }
  }
  return trimmed;
}

/**
 * Maps a catalog document (MongoDB product or bundled products.json entry) into
 * the UI product shape. Both shapes are accepted so prices, sizes, ratings and
 * stock are available no matter which source answered first.
 */
export function normalizeCatalogProduct(raw: any): Product {
  const mongoId = raw?._id?.toString?.() ?? (typeof raw?._id === 'string' ? raw._id : null);

  return {
    id: mongoId ?? String(raw?.id ?? raw?.sku ?? ''),
    name: cleanProductName(raw?.name),
    description: raw?.description ?? '',
    basePrice: Number(raw?.basePrice ?? raw?.price ?? 0) || 0,
    originalPrice: toOptionalNumber(raw?.originalPrice ?? raw?.compareAtPrice ?? raw?.mrp),
    currency: raw?.currency ?? 'USD',
    category: raw?.category ?? 'Uncategorized',
    images: normalizeProductImages(raw?.images, raw?.image, raw?.name),
    variants: normalizeProductVariants(raw?.variants),
    tags: Array.isArray(raw?.tags) ? raw.tags : [],
    isActive: raw?.isActive !== undefined ? raw.isActive : true,
    rating: toOptionalNumber(raw?.rating ?? raw?.averageRating),
    reviewCount: toCount(raw?.reviewCount ?? raw?.reviewsCount ?? raw?.numReviews),
    stock: raw?.stock === undefined || raw?.stock === null ? null : toOptionalNumber(raw?.stock),
    createdAt: raw?.createdAt ? new Date(raw.createdAt) : new Date(),
    updatedAt: raw?.updatedAt ? new Date(raw.updatedAt) : new Date(),
    buyUrl: toOptionalText(raw?.buyUrl),
    supplier: toOptionalText(raw?.supplier)
  };
}

/**
 * Keeps every bundled catalog entry (so products added to products.json always
 * appear in the shop) and appends live API products that are not duplicates.
 */
export function mergeCatalogs(bundled: Product[], live: Product[]): Product[] {
  const merged: Product[] = [];
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();

  const add = (product: Product): void => {
    const nameKey = `${product.name.trim().toLowerCase()}::${product.category.trim().toLowerCase()}`;
    if (!product.id || seenIds.has(product.id) || seenNames.has(nameKey)) {
      return;
    }
    seenIds.add(product.id);
    seenNames.add(nameKey);
    merged.push(product);
  };

  bundled.forEach(add);
  live.forEach(add);
  return merged;
}@Injectable({ providedIn: 'root' })
export class ProductService {
  private productsSignal = signal<Product[]>([]);
  private productsLoaded = false;
  private loadingPromise: Promise<void> | null = null;

  constructor(
    @Inject(PLATFORM_ID) private platformId: Object,
    private http: HttpClient
  ) {
    // Kick off loading immediately so the first rendered route has a catalog.
    this.loadingPromise = this.loadProducts();
  }

  /**
   * Loads the bundled catalog first (always available, also during SSR) and then
   * merges live API products. Both sources are time-boxed, so a slow or
   * unreachable backend can never leave a page stuck on its loading state.
   */
  private async loadProducts(): Promise<void> {
    if (this.productsLoaded) {
      return;
    }

    const [bundled, live] = await Promise.all([
      this.loadBundledCatalog(),
      this.loadApiCatalog()
    ]);

    this.productsSignal.set(mergeCatalogs(bundled, live));
    this.productsLoaded = true;
  }

  /** Reads and maps the bundled `assets/products.json` catalog. */
  private async loadBundledCatalog(): Promise<Product[]> {
    try {
      const payload = await this.fetchJsonWithTimeout(this.catalogJsonUrl);
      return Array.isArray(payload) ? payload.map(normalizeCatalogProduct) : [];
    } catch (error) {
      console.warn('Bundled product catalog unavailable:', error);
      return [];
    }
  }

  /** Reads the live product catalog, returning an empty list when unavailable. */
  private async loadApiCatalog(): Promise<Product[]> {
    try {
      const response = await firstValueFrom(
        this.http
          .get<{ success: boolean; products: any[] }>(`${this.apiUrl}/api/products`)
          .pipe(timeout(CATALOG_TIMEOUT_MS))
      );
      if (!response?.success || !Array.isArray(response.products)) {
        return [];
      }
      return response.products.map(normalizeCatalogProduct);
    } catch (error) {
      console.warn('Live product catalog unavailable, using the bundled catalog:', error);
      return [];
    }
  }

  /**
   * A relative URL cannot be resolved during SSR, so the server loads the bundle
   * from its own origin while the browser keeps the relative path.
   */
  private get catalogJsonUrl(): string {
    return isPlatformServer(this.platformId)
      ? `${this.apiUrl}/assets/products.json`
      : '/assets/products.json';
  }

  /** Fetches JSON with an abort timer so a stalled response cannot hang a page. */
  private async fetchJsonWithTimeout(url: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CATALOG_TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`Failed to load ${url} (${response.status})`);
      }
      return await response.json();
    } finally {
      clearTimeout(timer);
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

  /** Resolves one product, falling back to a single-product API lookup. */
  async fetchProductById(id: string): Promise<Product | undefined> {
    const wantedId = (id ?? '').trim();
    if (!wantedId) {
      return undefined;
    }

    const cached = this.getProductById(wantedId);
    if (cached) {
      return cached;
    }

    // Only Mongo ObjectIds can be resolved by the API. Bundled catalog ids
    // (for example "0") are already covered by the cached catalog above.
    if (!MONGO_OBJECT_ID.test(wantedId)) {
      return undefined;
    }

    try {
      const response = await firstValueFrom(
        this.http
          .get<{ success: boolean; product: any }>(`${this.apiUrl}/api/products/${wantedId}/`)
          .pipe(timeout(CATALOG_TIMEOUT_MS))
      );
      if (!response?.success || !response.product) {
        return undefined;
      }

      const mapped = normalizeCatalogProduct(response.product);
      const current = this.productsSignal();
      const exists = current.some(product => product.id === mapped.id);
      this.productsSignal.set(
        exists ? current.map(product => (product.id === mapped.id ? mapped : product)) : [...current, mapped]
      );
      return mapped;
    } catch (error) {
      console.warn('Failed to fetch product by id:', error);
      return undefined;
    }
  }

  /**
   * Base URL for server-side requests.
   *
   * A relative URL cannot be resolved during SSR, so the server has to address
   * itself explicitly. It used to be hardcoded to `http://localhost:4000`, which
   * silently broke whenever the process ran on any other port (Render's PORT,
   * a local `PORT=4125`, the Codespaces preview URL) — the catalog fetch failed
   * with ECONNREFUSED and the page rendered empty. Deriving it from PORT keeps
   * SSR pointed at whichever port this same process is listening on.
   */
  private get apiUrl(): string {
    if (!isPlatformServer(this.platformId)) {
      return '';
    }
    const port = process.env['PORT'] || '4000';
    return `http://127.0.0.1:${port}`;
  }

  /** Add an image URL to a product's gallery (owner/backend tooling). */
  async addProductImage(productId: string, imageUrl: string): Promise<void> {
    await firstValueFrom(
      this.http
        .post(`${this.apiUrl}/api/products/${productId}/images`, { image: imageUrl })
        .pipe(timeout(CATALOG_TIMEOUT_MS))
    );
  }

  /** Remove an image at the given index (owner/backend tooling). */
  async removeProductImage(productId: string, index: number): Promise<void> {
    await firstValueFrom(
      this.http
        .delete(`${this.apiUrl}/api/products/${productId}/images/${index}`)
        .pipe(timeout(CATALOG_TIMEOUT_MS))
    );
  }
}
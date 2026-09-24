import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { environment } from '../../environments/environment';
import { Product } from './product.service';

/** Minimal typed window surface for GA4 so no `any` leaks into call sites. */
interface GtagWindow extends Window {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
}

/** E-commerce item payload accepted by GA4 cart/purchase events. */
export interface AnalyticsItem {
  item_id: string;
  item_name: string;
  item_category?: string;
  price?: number;
  quantity?: number;
  index?: number;
  item_variant?: string;
  item_list_id?: string;
  item_list_name?: string;
}

/**
 * Google Analytics 4 loader + event tracker.
 *
 * - Runs only in the browser (SSR-safe); on the server every call is a no-op.
 * - Injects gtag.js once on the first event or page view after consent-safe
 *   defaults are applied (consent mode "denied" until the shopper acts, so
 *   the site stays privacy-friendly by default).
 * - Replace the measurement ID in `src/environments/environment*.ts`
 *   (`gaMeasurementId`) with the live GA4 "G-XXXXXXX" id.
 */
@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly document = inject(DOCUMENT);
  private readonly measurementId = environment.gaMeasurementId;
  private scriptInjected = false;

  /** True when analytics can run (browser + configured measurement id). */
  private get enabled(): boolean {
    return isPlatformBrowser(this.platformId) && this.measurementId.length > 0;
  }

  /** Injects the GA4 script tag and initialises dataLayer exactly once. */
  init(): void {
    if (!this.enabled || this.scriptInjected) {
      return;
    }
    this.scriptInjected = true;
    const win = this.document.defaultView as GtagWindow | null;
    if (!win) {
      return;
    }

    // Standard gtag.js bootstrap (keeps dataLayer working even before the
    // remote script finishes loading).
    win.dataLayer = win.dataLayer || [];
    win.gtag = win.gtag ?? function (...args: unknown[]) {
      win.dataLayer!.push(args);
    };
    win.gtag('js', new Date());
    // Default to consent denied; only basic cookieless pings may fire.
    // Call grantAnalyticsConsent() from a cookie banner to enable storage.
    win.gtag('consent', 'default', {
      analytics_storage: 'denied',
      ad_storage: 'denied',
      wait_for_update: 500
    });
    win.gtag('config', this.measurementId, {
      send_page_view: false // the router drives page_view instead
    });

    const script = this.document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(this.measurementId)}`;
    this.document.head.appendChild(script);
  }

  /** Sends a page_view for SPA navigation. */
  trackPageView(pagePath: string, pageTitle?: string): void {
    if (!this.enabled) {
      return;
    }
    this.init();
    this.gtag('event', 'page_view', {
      page_path: pagePath,
      page_title: pageTitle,
      page_location: this.document.defaultView?.location.href
    });
  }

  /** E-commerce: a product list was shown (home, shop grid). */
  trackViewItemList(items: AnalyticsItem[], listId = 'shop', listName = 'Shop the Collection'): void {
    this.ecommerceEvent('view_item_list', { item_list_id: listId, item_list_name: listName, items });
  }

  /** E-commerce: a shopper clicked a product from a list. */
  trackSelectItem(product: Product, index?: number, listId = 'product-list'): void {
    this.ecommerceEvent('select_item', { item_list_id: listId, items: [toAnalyticsItem(product, index)] });
  }

  /** E-commerce: product detail page viewed. */
  trackViewItem(product: Product): void {
    this.ecommerceEvent('view_item', { currency: 'INR', value: product.basePrice, items: [toAnalyticsItem(product)] });
  }

  /** E-commerce: item added to the cart. */
  trackAddToCart(product: Product, quantity = 1, size?: string): void {
    const item = toAnalyticsItem(product);
    if (size) {
      item.item_variant = size;
    }
    item.quantity = quantity;
    this.ecommerceEvent('add_to_cart', { currency: 'INR', value: product.basePrice * quantity, items: [item] });
  }

  /** E-commerce: item removed from the cart. */
  trackRemoveFromCart(product: Product, quantity = 1, size?: string): void {
    const item = toAnalyticsItem(product);
    item.item_variant = size;
    item.quantity = quantity;
    this.ecommerceEvent('remove_from_cart', { currency: 'INR', value: product.basePrice * quantity, items: [item] });
  }

  /** E-commerce: cart page viewed. */
  trackViewCart(items: AnalyticsItem[], value: number): void {
    this.ecommerceEvent('view_cart', { currency: 'INR', value, items });
  }

  /** E-commerce: checkout started. */
  trackBeginCheckout(items: AnalyticsItem[], value: number): void {
    this.ecommerceEvent('begin_checkout', { currency: 'INR', value, items });
  }

  /** E-commerce: order completed. */
  trackPurchase(
    transactionId: string,
    items: AnalyticsItem[],
    value: number,
    options?: { tax?: number; shipping?: number; coupon?: string }
  ): void {
    this.ecommerceEvent('purchase', {
      transaction_id: transactionId,
      currency: 'INR',
      value,
      tax: options?.tax ?? 0,
      shipping: options?.shipping ?? 0,
      coupon: options?.coupon,
      items
    });
  }

  /** Login flow used. */
  trackLogin(method = 'email'): void {
    this.event('login', { method });
  }

  /** Registration completed. */
  trackSignUp(method = 'email'): void {
    this.event('sign_up', { method });
  }

  /** Search used (shop filters / search box). */
  trackSearch(searchTerm: string): void {
    this.event('search', { search_term: searchTerm });
  }

  /** User granted analytics consent (wire to a cookie banner). */
  grantAnalyticsConsent(): void {
    if (!this.enabled) {
      return;
    }
    this.gtag('consent', 'update', { analytics_storage: 'granted' });
  }

  /** Generic custom event (safe no-op when analytics is disabled). */
  event(name: string, params: Record<string, unknown> = {}): void {
    if (!this.enabled) {
      return;
    }
    this.init();
    this.gtag('event', name, params);
  }

  private ecommerceEvent(name: string, params: Record<string, unknown>): void {
    this.event(name, params);
  }

  private gtag(...args: unknown[]): void {
    (this.document.defaultView as GtagWindow | null)?.gtag?.(...args);
  }
}

/** Maps a catalog product into the GA4 item shape. */
export function toAnalyticsItem(product: Product, index?: number): AnalyticsItem {
  const item: AnalyticsItem = {
    item_id: product.id,
    item_name: product.name,
    item_category: product.category || undefined,
    price: product.basePrice,
    item_list_id: 'shop',
    item_list_name: 'Shop the Collection'
  };
  if (index !== undefined) {
    item.index = index;
  }
  return item;
}
import { Injectable, inject } from '@angular/core';
import { AnalyticsService } from './analytics.service';
import { ToastService, ToastType } from './toast.service';

export type SiteEventName =
  | 'new_arrival'
  | 'new_product'
  | 'product_view'
  | 'add_to_cart'
  | 'add_to_wishlist'
  | 'checkout_started'
  | 'order_completed'
  | 'chat_opened';

@Injectable({ providedIn: 'root' })
export class SiteEventsService {
  private readonly toast = inject(ToastService);
  private readonly analytics = inject(AnalyticsService);
  private readonly recent = new Map<string, number>();

  notify(name: SiteEventName, message: string, type: ToastType = 'info', dedupeKey?: string): void {
    const key = dedupeKey ?? name;
    const now = Date.now();
    const lastShown = this.recent.get(key) ?? 0;
    if (now - lastShown < 30_000) return;
    this.recent.set(key, now);
    this.toast[type](message);
    this.analytics.event(name);
  }

  announceNewArrivals(count: number): void {
    if (count > 0) this.notify('new_arrival', `${count} new ${count === 1 ? 'arrival is' : 'arrivals are'} now available.`, 'info', 'catalog-arrivals');
  }

  track(name: SiteEventName, params: Record<string, unknown> = {}): void {
    this.analytics.event(name, params);
  }
}

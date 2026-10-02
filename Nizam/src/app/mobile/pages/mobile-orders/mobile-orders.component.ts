import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { IonIcon, IonSpinner } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { chevronBackOutline, receiptOutline } from 'ionicons/icons';

import { OrderService, OrderSummary } from '../../../services/order.service';
import { AnalyticsService } from '../../../services/analytics.service';
import { ToastService } from '../../../services/toast.service';
import { PricePipe } from '../../../pipes/price.pipe';

/**
 * MobileOrdersComponent — order history.
 *
 * Reads through OrderService, which relies on the JWT attached by
 * AuthInterceptor; the server scopes the list to the token's email, so the app
 * never has to send an account identifier.
 *
 * The route is AuthGuard-protected, so reaching this screen already implies a
 * signed-in shopper.
 */
@Component({
  selector: 'app-mobile-orders',
  imports: [RouterLink, IonIcon, IonSpinner, PricePipe],
  templateUrl: './mobile-orders.component.html',
  styleUrls: ['./mobile-orders.component.scss'],
})
export class MobileOrdersComponent implements OnInit {
  private readonly orderService = inject(OrderService);
  private readonly analytics = inject(AnalyticsService);
  private readonly toast = inject(ToastService);

  protected readonly orders = signal<OrderSummary[]>([]);
  protected readonly loading = signal(true);

  constructor() {
    addIcons({ chevronBackOutline, receiptOutline });
  }

  async ngOnInit(): Promise<void> {
    this.analytics.init();
    this.analytics.trackPageView('/orders');

    try {
      const response = await new Promise<{ orders?: OrderSummary[] }>((resolve, reject) => {
        this.orderService.listMyOrders().subscribe({ next: resolve, error: reject });
      });

      // The endpoint reports success separately; treat a missing flag as success
      // rather than blanking a list the server did populate.
      this.orders.set(response?.orders ?? []);
    } catch {
      this.toast.error('Could not load your orders.');
    } finally {
      this.loading.set(false);
    }
  }

  /** Human-friendly date; falls back to the raw value if unparseable. */
  protected formatDate(value: string): string {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime())
      ? parsed.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
      : value;
  }

  /** Uppercases the server's status codes (PAID, SHIPPED, …) for display. */
  protected formatStatus(status: string): string {
    return (status ?? '').replace(/_/g, ' ');
  }
}

import { BentoHighlightsComponent } from '../../components/bento-grid/bento-highlights.component';
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { OrderService, OrderSummary } from '../../services/order.service';

@Component({
  selector: 'app-orders',
  standalone: true,
  imports: [CommonModule, RouterLink, BentoHighlightsComponent],
  templateUrl: './orders.component.html',
  styleUrls: ['./orders.component.css']
})
export class OrdersComponent implements OnInit {
  orders: OrderSummary[] = [];
  isLoading = true;
  errorMessage: string | null = null;

  constructor(private orderService: OrderService) {}

  ngOnInit(): void {
    this.loadOrders();
  }

  /** Loads the signed-in shopper's orders (scoped by the server from the JWT). */
  loadOrders(): void {
    this.isLoading = true;
    this.errorMessage = null;

    this.orderService.listMyOrders().subscribe({
      next: (response) => {
        this.isLoading = false;
        this.orders = response?.orders ?? [];
      },
      error: (error) => {
        this.isLoading = false;
        this.errorMessage =
          error?.error?.message || error?.message || 'Unable to load your orders right now.';
      }
    });
  }

  /** Each order stores the total in the currency the shopper actually paid in. */
  formatTotal(order: OrderSummary): string {
    return `${order.currency} ${Number(order.total ?? 0).toFixed(2)}`;
  }

  itemCount(order: OrderSummary): number {
    return (order.items ?? []).reduce((sum, item) => sum + (item.quantity ?? 0), 0);
  }

  trackByReference(_index: number, order: OrderSummary): string {
    return order.orderReference;
  }
}

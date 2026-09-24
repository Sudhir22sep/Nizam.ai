import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { timeout } from 'rxjs/operators';

/** One line of a placed order. */
export interface OrderItem {
  product?: { name?: string };
  size?: string;
  quantity?: number;
}

/** Order as returned by /api/orders (already scoped to the shopper by the server). */
export interface OrderSummary {
  orderReference: string;
  total: number;
  currency: string;
  status: string;
  paymentMethod: string;
  createdAt: string;
  items: OrderItem[];
}

export interface OrderListResponse {
  success: boolean;
  orders: OrderSummary[];
  total: number;
}

/** Hard ceiling so a stalled backend cannot hang the orders page. */
const ORDERS_TIMEOUT_MS = 8000;

/**
 * Reads the signed-in shopper's orders.
 *
 * The JWT is attached by AuthInterceptor and the server filters orders by the
 * token's email (admins may query any email), so the client never asks for
 * another shopper's data.
 */
@Injectable({ providedIn: 'root' })
export class OrderService {
  constructor(private http: HttpClient) {}

  listMyOrders(limit = 50): Observable<OrderListResponse> {
    return this.http
      .get<OrderListResponse>(`/api/orders?limit=${limit}`)
      .pipe(timeout(ORDERS_TIMEOUT_MS));
  }

  getOrder(orderReference: string): Observable<{ success: boolean; order: OrderSummary }> {
    return this.http
      .get<{ success: boolean; order: OrderSummary }>(`/api/orders/${orderReference}`)
      .pipe(timeout(ORDERS_TIMEOUT_MS));
  }
}

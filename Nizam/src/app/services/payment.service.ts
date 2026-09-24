import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';
import { CurrencyCode } from './currency.service';

/** Payment methods offered at checkout. */
export type PaymentMethod = 'razorpay' | 'stripe' | 'cod';

/** Cart details every payment endpoint expects. */
export interface CheckoutOrderPayload {
  name: string;
  email: string;
  address: string;
  items: unknown[];
  /** Total in `currency`, converted from the USD cart total. */
  total: number;
  currency: CurrencyCode;
}

/** Result of creating an order/payment session. */
export interface PaymentOrderResult {
  success: boolean;
  message?: string;
  orderReference?: string;
  orderId?: string;
  amount?: number;
  currency?: string;
  keyId?: string;
  sessionId?: string;
  checkoutUrl?: string;
}

/**
 * Server endpoint per payment method.
 *
 * Razorpay settles domestic cards/UPI in INR, Stripe settles international
 * cards in USD, and COD simply records the order.
 */
const CREATE_ORDER_ENDPOINTS: Record<PaymentMethod, string> = {
  razorpay: '/api/create-razorpay-order',
  stripe: '/api/create-stripe-checkout-session',
  cod: '/api/create-cod-order',
};

/**
 * Talks to the payment endpoints.
 *
 * Both online gateways re-price the cart from the catalog server-side, so this
 * service never acts on an amount the server has not verified itself.
 */
@Injectable({ providedIn: 'root' })
export class PaymentService {
  private get baseUrl(): string {
    return environment.apiUrl || '';
  }

  /** Creates the pending order and the gateway session for the chosen method. */
  async createOrder(method: PaymentMethod, payload: CheckoutOrderPayload): Promise<PaymentOrderResult> {
    return this.post(CREATE_ORDER_ENDPOINTS[method], payload);
  }

  /** Verifies the Razorpay signature server-side and settles the order. */
  async confirmRazorpayPayment(params: {
    orderReference: string;
    razorpayPaymentId: string;
    razorpayOrderId: string;
    razorpaySignature: string;
  }): Promise<any> {
    return this.post('/api/confirm-razorpay-payment', params);
  }

  /** Verifies a Stripe Checkout session server-side and settles the order. */
  async confirmStripePayment(params: { sessionId: string; orderReference?: string }): Promise<any> {
    return this.post('/api/confirm-stripe-payment', params);
  }

  /** Sends the browser to the Stripe-hosted checkout page. */
  redirectToStripeCheckout(url: string): void {
    window.location.href = url;
  }

  /** POSTs JSON and throws the server's message when the call fails. */
  private async post(url: string, body: unknown): Promise<any> {
    const response = await fetch(`${this.baseUrl}${url}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const text = await response.text();
    let data: any = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { message: text };
    }

    if (!response.ok || !data?.success) {
      throw new Error(data?.message || 'Unable to complete the request. Please try again.');
    }
    return data;
  }
}

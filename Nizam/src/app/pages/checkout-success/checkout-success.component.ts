import { BentoHighlightsComponent } from '../../components/bento-grid/bento-highlights.component';
import { Component, OnInit, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser, CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { CartService } from '../../services/cart.service';
import { PaymentService } from '../../services/payment.service';

@Component({
  selector: 'app-checkout-success',
  standalone: true,
  imports: [CommonModule, RouterLink, BentoHighlightsComponent],
  templateUrl: './checkout-success.component.html',
  styleUrl: './checkout-success.component.css'
})
export class CheckoutSuccessComponent implements OnInit {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly route = inject(ActivatedRoute);
  private readonly payments = inject(PaymentService);
  private readonly cart = inject(CartService);

  sessionId = '';
  orderReference = '';
  statusMessage = 'Confirming your payment...';

  ngOnInit() {
    if (!isPlatformBrowser(this.platformId)) {
      this.statusMessage = 'Payment confirmation pending.';
      return;
    }

    const params = new URLSearchParams(window.location.search);
    this.sessionId = params.get('session_id') || '';
    this.orderReference = params.get('order') || '';

    if (!this.sessionId) {
      this.statusMessage = this.orderReference
        ? `Waiting for the payment provider to confirm order ${this.orderReference}. We will email you as soon as the payment clears.`
        : 'No payment session to confirm.';
      return;
    }

    this.confirmPayment(this.sessionId, this.orderReference);
  }

  /**
   * Confirms a Stripe Checkout session.
   *
   * The server re-fetches the session from Stripe and only releases the order
   * when Stripe reports it as paid, so a forged return URL cannot mark an order
   * as paid.
   */
  async confirmPayment(sessionId: string, orderReference: string) {
    try {
      const data = await this.payments.confirmStripePayment({
        sessionId,
        orderReference: orderReference || undefined,
      });

      this.orderReference = data?.orderReference || orderReference;
      this.statusMessage = `Payment confirmed — ${this.orderReference}`;
      this.cart.clearCart();
    } catch (error) {
      console.error('Stripe confirmation failed', error);
      this.statusMessage = error instanceof Error
        ? error.message
        : 'Payment could not be confirmed.';
    }
  }
}

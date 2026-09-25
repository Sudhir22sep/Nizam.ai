import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { PricePipe } from '../../pipes/price.pipe';
import { ToastService } from '../../services/toast.service';
import { CurrencyService } from '../../services/currency.service';
import { CartService } from '../../services/cart.service';
import { PaymentMethod, PaymentService } from '../../services/payment.service';
import { GlassPopupComponent } from '../../components/glass-popup/glass-popup.component';
import { SiteEventsService } from '../../services/site-events.service';

@Component({
  selector: 'app-checkout',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, PricePipe, GlassPopupComponent],
  templateUrl: './checkout.component.html',
  styleUrl: './checkout.component.css'
})
export class CheckoutComponent {
  name = '';
  email = '';
  address = '';
  paymentMethod: PaymentMethod = 'razorpay';
  orderConfirmed = false;
  confirmationReference = '';
  isProcessing = false;

  constructor(
    public cartService: CartService,
    private currency: CurrencyService,
    private toast: ToastService,
    private payments: PaymentService,
    private siteEvents: SiteEventsService
  ) {}

  get items() {
    return this.cartService.getItems();
  }

  get totalAmount() {
    return this.cartService.getTotalAmount();
  }

  /** Button label for the selected payment method. */
  get submitLabel(): string {
    switch (this.paymentMethod) {
      case 'cod':
        return 'Place order with COD';
      case 'stripe':
        return 'Continue to Stripe (USD)';
      default:
        return 'Submit payment';
    }
  }

  async submitOrder() {
    if (this.isProcessing) {
      return;
    }

    if (!this.name || !this.email || !this.address) {
      this.toast.warning('Please complete name, email and shipping address.');
      return;
    }

    if (this.cartService.getItemCount() === 0) {
      this.toast.warning('Your cart is empty. Add items before checking out.');
      return;
    }

    const selectedCurrency = this.currency.getCurrency();

    // Stripe is the international gateway and only settles in USD; sending the
    // shopper to it in another currency would mis-price the order.
    if (this.paymentMethod === 'stripe' && selectedCurrency !== 'USD') {
      this.toast.warning('International card payments are charged in USD. Select USD in the currency selector to continue.');
      return;
    }

    // Convert the USD cart total to the selected currency for payment
    const orderPayload = {
      name: this.name,
      email: this.email,
      address: this.address,
      items: this.items,
      total: this.currency.convertFromUSD(this.totalAmount),
      currency: selectedCurrency,
    };

    this.isProcessing = true;
    this.siteEvents.track('checkout_started', { item_count: this.items.length, value: this.totalAmount });

    try {
      const result = await this.payments.createOrder(this.paymentMethod, orderPayload);

      if (this.paymentMethod === 'cod') {
        this.orderConfirmed = true;
        this.confirmationReference = result.orderReference || '';
        this.siteEvents.track('order_completed', { order_reference: this.confirmationReference, value: this.totalAmount, payment_method: this.paymentMethod });
        this.cartService.clearCart();
        return;
      }

      // International card payment: Stripe hosts the card form.
      if (this.paymentMethod === 'stripe') {
        if (!result.checkoutUrl) {
          this.toast.error('Unable to start the Stripe payment. Please try again.');
          return;
        }
        this.toast.info('Redirecting you to the secure Stripe checkout…');
        this.payments.redirectToStripeCheckout(result.checkoutUrl);
        return;
      }

      // Razorpay payment (domestic card/UPI)
      if (!result.orderId || !result.keyId) {
        this.toast.error(result.message || 'Unable to start Razorpay payment.');
        return;
      }

      await this.openRazorpayCheckout({
        orderId: result.orderId,
        amount: result.amount ?? 0,
        currency: result.currency ?? 'INR',
        keyId: result.keyId,
        orderReference: result.orderReference || '',
      });
    } catch (error) {
      console.error('Create payment session failed', error);
      this.toast.error(
        error instanceof Error
          ? error.message
          : 'Unable to complete checkout at this time. Please try again later.'
      );
    } finally {
      this.isProcessing = false;
    }
  }

  async openRazorpayCheckout(data: { orderId: string; amount: number; currency: string; keyId: string; orderReference: string }) {
    try {
      const RazorpayConstructor = (window as any).Razorpay;
      if (!RazorpayConstructor) {
        this.toast.error('Razorpay SDK is not loaded. Please refresh the page and try again.');
        return;
      }

      console.log('Opening Razorpay checkout:', {
        orderId: data.orderId,
        amount: data.amount,
        currency: data.currency,
        orderReference: data.orderReference
      });

      const options = {
        key: data.keyId,
        amount: data.amount,
        currency: data.currency,
        name: 'Amma Wears',
        description: `Order ${data.orderReference}`,
        order_id: data.orderId,
        prefill: {
          name: this.name,
          email: this.email,
          contact: '',
          fiscal_code: data.orderReference,
        },
        notes: {
          orderReference: data.orderReference,
        },
        handler: async (response: any) => {
          console.log('Razorpay payment success response:', response);
          await this.confirmRazorpayPayment(response, data.orderReference);
        },
        modal: {
          ondismiss: () => {
            console.log('Payment modal dismissed by user');
            this.toast.info('Payment popup was closed. You can retry the payment from checkout.');
          },
        },
        theme: {
          color: '#3399cc'
        }
      };

      const rzp = new RazorpayConstructor(options);
      rzp.open();
    } catch (error) {
      console.error('Error opening Razorpay checkout:', error);
      this.toast.error('Unable to open payment window. Please try again or contact support.');
    }
  }

  async confirmRazorpayPayment(response: any, orderReference: string) {
    console.log('Confirming Razorpay payment for order:', orderReference);
    try {
      const data = await this.payments.confirmRazorpayPayment({
        orderReference,
        razorpayPaymentId: response?.razorpay_payment_id,
        razorpayOrderId: response?.razorpay_order_id,
        razorpaySignature: response?.razorpay_signature,
      });

      this.orderConfirmed = true;
      this.confirmationReference = data?.orderReference || orderReference;
      this.cartService.clearCart();
      this.toast.success(`Payment confirmed successfully! Order reference: ${this.confirmationReference}`);
    } catch (error) {
      console.error('Razorpay confirmation failed', error);
      this.toast.error(
        error instanceof Error
          ? error.message
          : 'Unable to confirm payment after Razorpay checkout. Please contact support.'
      );
    }
  }
}

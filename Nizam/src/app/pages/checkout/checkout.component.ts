import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { PricePipe } from '../../pipes/price.pipe';
import { CurrencyService } from '../../services/currency.service';
import { CartService } from '../../services/cart.service';

@Component({
  selector: 'app-checkout',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, PricePipe],
  templateUrl: './checkout.component.html',
  styleUrl: './checkout.component.css'
})
export class CheckoutComponent {
  name = '';
  email = '';
  address = '';
  paymentMethod: 'razorpay' | 'cod' = 'razorpay';
  orderConfirmed = false;
  confirmationReference = '';

  constructor(public cartService: CartService, private currency: CurrencyService) {}

  get items() {
    return this.cartService.getItems();
  }

  get totalAmount() {
    return this.cartService.getTotalAmount();
  }

  async submitOrder() {
    if (!this.name || !this.email || !this.address) {
      alert('Please complete name, email and shipping address.');
      return;
    }

    if (this.cartService.getItemCount() === 0) {
      alert('Your cart is empty. Add items before checking out.');
      return;
    }

    // Convert the USD cart total to the selected currency for payment
    const selectedCurrency = this.currency.getCurrency();
    const totalInSelectedCurrency = this.currency.convertFromUSD(this.totalAmount);

    const orderPayload = {
      name: this.name,
      email: this.email,
      address: this.address,
      items: this.items,
      total: totalInSelectedCurrency,
      currency: selectedCurrency,
      paymentMethod: this.paymentMethod,
    };

    try {
      const endpoint = this.paymentMethod === 'cod'
        ? '/api/create-cod-order'
        : '/api/create-razorpay-order';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(orderPayload),
      });

      const text = await response.text();
      let result: any = {};
      try {
        result = text ? JSON.parse(text) : {};
      } catch {
        result = { message: text || 'Unable to complete checkout.' };
      }

      if (!response.ok || !result.success) {
        alert(result.message || 'Unable to complete order.');
        return;
      }

      if (this.paymentMethod === 'cod') {
        this.orderConfirmed = true;
        this.confirmationReference = result.orderReference || '';
        this.cartService.clearCart();
        return;
      }

      // Razorpay payment
      if (!result.orderId || !result.keyId) {
        alert(result.message || 'Unable to start Razorpay payment.');
        return;
      }

      await this.openRazorpayCheckout(result);
    } catch (error) {
      console.error('Create payment session failed', error);
      alert('Unable to complete checkout at this time. Please try again later.');
    }
  }

  async openRazorpayCheckout(data: { orderId: string; amount: number; currency: string; keyId: string; orderReference: string }) {
    const RazorpayConstructor = (window as any).Razorpay;
    if (!RazorpayConstructor) {
      alert('Razorpay SDK is not loaded. Refresh the page and try again.');
      return;
    }

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
      },
      notes: {
        orderReference: data.orderReference,
      },
      handler: async (response: any) => {
        await this.confirmRazorpayPayment(response, data.orderReference);
      },
      modal: {
        ondismiss: () => {
          alert('Payment popup was closed. You can retry the payment from checkout.');
        },
      },
    };

    const rzp = new RazorpayConstructor(options);
    rzp.open();
  }

  async confirmRazorpayPayment(response: any, orderReference: string) {
    try {
      const res = await fetch('/api/confirm-razorpay-payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          orderReference,
          razorpayPaymentId: response.razorpay_payment_id,
          razorpayOrderId: response.razorpay_order_id,
          razorpaySignature: response.razorpay_signature,
        }),
      });

      const text = await res.text();
      let data: any = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { message: text || 'Unable to confirm Razorpay payment.' };
      }

      if (!res.ok || !data.success) {
        alert(data.message || 'Unable to confirm Razorpay payment.');
        return;
      }

      this.orderConfirmed = true;
      this.confirmationReference = data.orderReference || '';
      this.cartService.clearCart();
    } catch (error) {
      console.error('Razorpay confirmation failed', error);
      alert('Unable to confirm payment after Razorpay checkout.');
    }
  }
}

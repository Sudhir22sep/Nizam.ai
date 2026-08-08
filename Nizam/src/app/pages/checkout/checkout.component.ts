import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { PricePipe } from '../../pipes/price.pipe';
import { CurrencyService } from '../../services/currency.service';
import { CartService } from '../../services/cart.service';
import { environment } from '../../../environments/environment';

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
        ? `${environment.apiUrl || ''}/api/create-cod-order`
        : `${environment.apiUrl || ''}/api/create-razorpay-order`;
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
        console.error('Order creation failed:', result);
        alert(result.message || 'Unable to complete order. Please try again.');
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
    try {
      const RazorpayConstructor = (window as any).Razorpay;
      if (!RazorpayConstructor) {
        alert('Razorpay SDK is not loaded. Please refresh the page and try again.');
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
            alert('Payment popup was closed. You can retry the payment from checkout.');
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
      alert('Unable to open payment window. Please try again or contact support.');
    }
  }

  async confirmRazorpayPayment(response: any, orderReference: string) {
    console.log('Confirming Razorpay payment for order:', orderReference);
    console.log('Response:', response);
    try {
      const res = await fetch(`${environment.apiUrl || ''}/api/confirm-razorpay-payment`, {
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
      console.log('Confirmation response status:', res.status);
      console.log('Confirmation response text:', text);
      let data: any = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { message: text || 'Unable to confirm Razorpay payment.' };
      }

      if (!res.ok || !data.success) {
        console.error('Payment confirmation failed:', data);
        alert(data.message || 'Unable to confirm payment. Please contact support if the issue persists.');
        return;
      }

      this.orderConfirmed = true;
      this.confirmationReference = data.orderReference || '';
      this.cartService.clearCart();
      alert(`Payment confirmed successfully! Order reference: ${this.confirmationReference}`);
    } catch (error) {
      console.error('Razorpay confirmation failed', error);
      alert('Unable to confirm payment after Razorpay checkout. Please contact support.');
    }
  }
}

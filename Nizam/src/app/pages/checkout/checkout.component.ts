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
  cardNumber = '';
  expiry = '';
  cvc = '';
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

    const orderPayload = {
      name: this.name,
      email: this.email,
      address: this.address,
      items: this.items,
      total: this.totalAmount,
      currency: this.currency.getCurrency()
    };

    try {
      const response = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(orderPayload),
      });

      const result = await response.json();

      if (!response.ok || !result.success || !result.url) {
        alert(result.message || 'Unable to create a checkout session.');
        return;
      }

      // Redirect to Stripe Checkout
      window.location.href = result.url;
    } catch (error) {
      console.error('Create checkout session failed', error);
      alert('Unable to complete checkout at this time. Please try again later.');
    }
  }
}

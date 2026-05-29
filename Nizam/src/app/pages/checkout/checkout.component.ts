import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CartService } from '../../services/cart.service';

@Component({
  selector: 'app-checkout',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
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

  constructor(public cartService: CartService) {}

  get items() {
    return this.cartService.getItems();
  }

  get totalAmount() {
    return this.cartService.getTotalAmount();
  }

  async submitOrder() {
    if (!this.name || !this.email || !this.address || !this.cardNumber || !this.expiry || !this.cvc) {
      alert('Please complete all payment and shipping fields before submitting your order.');
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
    };

    try {
      const response = await fetch('/api/order-confirmation', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(orderPayload),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        alert(result.message || 'Payment confirmation failed. Please try again.');
        return;
      }

      this.orderConfirmed = true;
      this.confirmationReference = result.orderReference || `ORDER-${Date.now()}`;
      this.cartService.clearCart();
    } catch (error) {
      console.error('Order confirmation failed', error);
      alert('Unable to complete checkout at this time. Please try again later.');
    }
  }
}

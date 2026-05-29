import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { CartService } from '../../services/cart.service';

@Component({
  selector: 'app-cart',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './cart.component.html',
  styleUrl: './cart.component.css'
})
export class CartComponent {
  constructor(public cartService: CartService) {}

  get items() {
    return this.cartService.getItems();
  }

  get total() {
    return this.cartService.getTotalAmount();
  }

  removeItem(productId: number) {
    this.cartService.removeFromCart(productId);
  }
}

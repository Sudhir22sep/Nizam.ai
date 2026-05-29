import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { PricePipe } from '../../pipes/price.pipe';
import { ImageFallbackDirective } from '../../directives/image-fallback.directive';
import { CartService } from '../../services/cart.service';

@Component({
  selector: 'app-cart',
  standalone: true,
  imports: [CommonModule, RouterLink, PricePipe, ImageFallbackDirective],
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

  trackByCartItem(_: number, item: { product: { id: number } }) {
    return item.product.id;
  }

  // image fallback handled by ImageFallbackDirective
}

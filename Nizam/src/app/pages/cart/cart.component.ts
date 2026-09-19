import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, Router } from '@angular/router';
import { PricePipe } from '../../pipes/price.pipe';
import { ImageFallbackDirective } from '../../directives/image-fallback.directive';
import { CartService } from '../../services/cart.service';
import { primaryProductImage } from '../../services/product.service';
import { EmptyStateComponent } from '../../components/empty-state/empty-state.component';

@Component({
  selector: 'app-cart',
  standalone: true,
  imports: [CommonModule, RouterLink, PricePipe, ImageFallbackDirective, EmptyStateComponent],
  templateUrl: './cart.component.html',
  styleUrl: './cart.component.css'
})
export class CartComponent {
  constructor(
    public cartService: CartService,
    private router: Router
  ) {}

  get items() {
    return this.cartService.getItems();
  }

  get total() {
    return this.cartService.getTotalAmount();
  }

  removeItem(productId: string) {
    this.cartService.removeFromCart(productId);
  }

  goToProducts(): void {
    this.router.navigate(['/products']);
  }

  primaryImage(product?: { images?: unknown; image?: unknown; name?: string }): string {
    return primaryProductImage(product?.images, product?.image, product?.name);
  }

  trackByCartItem(_: number, item: { product: { id: string } }) {
    return item.product.id;
  }
}

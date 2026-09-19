import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

export type EmptyStateVariant = 'cart' | 'wishlist' | 'search' | 'no-products' | 'no-reviews' | 'out-of-stock';

@Component({
  selector: 'app-empty-state',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="empty-state" [class]="'empty-state--' + variant">
      <div class="empty-state__visual">
        <img
          [src]="svgPath"
          [alt]=""
          class="empty-state__icon"
          role="presentation"
        />
      </div>
      <h3 class="empty-state__title">{{ title }}</h3>
      <p class="empty-state__body">{{ body }}</p>
      <div class="empty-state__action" *ngIf="actionLabel">
        <button class="empty-state__btn" (click)="onAction()">{{ actionLabel }}</button>
      </div>
    </div>
  `,
  styleUrl: './empty-state.component.css'
})
export class EmptyStateComponent {
  @Input() variant: EmptyStateVariant = 'cart';
  @Input() title = '';
  @Input() body = '';
  @Input() actionLabel = '';
  @Input() actionCallback?: () => void;

  get svgPath(): string {
    const map: Record<EmptyStateVariant, string> = {
      cart:        '/images/empty-states/empty-cart.svg',
      wishlist:    '/images/empty-states/empty-wishlist.svg',
      search:      '/images/empty-states/empty-search.svg',
      'no-products': '/images/empty-states/empty-cart.svg',
      'no-reviews':  '/images/empty-states/empty-wishlist.svg',
      'out-of-stock': '/images/empty-states/empty-search.svg',
    };
    return map[this.variant] ?? map.cart;
  }

  onAction(): void {
    this.actionCallback?.();
  }
}

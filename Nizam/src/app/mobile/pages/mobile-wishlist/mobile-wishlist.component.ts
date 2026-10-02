import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { IonIcon, IonSpinner } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { heartOutline, trashOutline } from 'ionicons/icons';
import { firstValueFrom } from 'rxjs';

import { WishlistService } from '../../../services/wishlist.service';
import { AuthService } from '../../../services/auth.service';
import { ToastService } from '../../../services/toast.service';
import { PricePipe } from '../../../pipes/price.pipe';
import { ImageFallbackDirective } from '../../../directives/image-fallback.directive';
import {
  ProductService,
  primaryProductImage,
} from '../../../services/product.service';

/** One saved product, flattened for the template. */
interface SavedProduct {
  productId: string;
  name: string;
  imageUrl: string;
  price: number;
}

/**
 * MobileWishlistComponent — saved items.
 *
 * The wishlist is per-account and lives on the server, so this screen has three
 * genuine states, not two: signed out, signed in with nothing saved, and signed
 * in with items. Rendering the signed-out state as a friendly prompt (rather
 * than bouncing to /login) is deliberate — it is the website behaviour too, and
 * it lets the tab bar stay put.
 */
@Component({
  selector: 'app-mobile-wishlist',
  imports: [RouterLink, IonIcon, IonSpinner, PricePipe, ImageFallbackDirective],
  templateUrl: './mobile-wishlist.component.html',
  styleUrls: ['./mobile-wishlist.component.scss'],
})
export class MobileWishlistComponent implements OnInit {
  private readonly wishlistService = inject(WishlistService);
  private readonly authService = inject(AuthService);
  private readonly productService = inject(ProductService);
  private readonly toast = inject(ToastService);

  protected readonly loading = signal(true);
  protected readonly saved = signal<SavedProduct[]>([]);

  protected readonly isSignedIn = signal(false);

  constructor() {
    addIcons({ heartOutline, trashOutline });
  }

  async ngOnInit(): Promise<void> {
    // The auth service restores the session from storage in its constructor,
    // so the sign-in state is already correct by the time this runs.
    this.isSignedIn.set(this.authService.isLoggedIn());

    if (!this.isSignedIn()) {
      this.loading.set(false);
      return;
    }

    await this.load();
  }

  /** Fetches the first wishlist and flattens its items for display. */
  private async load(): Promise<void> {
    try {
      const wishlists = await firstValueFrom(this.wishlistService.getWishlists());
      const items: unknown[] = wishlists[0]?.items ?? [];

      const flattened = items.flatMap((entry) => {
        // Items may arrive as a populated `product` or as an id only; the
        // latter is resolved from the cached catalog, and skipped if unknown.
        const raw = entry as { product?: any; productId?: string };
        const product = raw.product ?? this.productService.getProductById(raw.productId ?? '');

        if (!product?.id) {
          return [];
        }

        return [{
          productId: product.id,
          name: product.name,
          imageUrl: primaryProductImage(product.images, undefined, product.name),
          price: product.basePrice,
        }];
      });

      this.saved.set(flattened);
    } catch {
      this.toast.error('Could not load your saved items.');
    } finally {
      this.loading.set(false);
    }
  }

  protected async remove(item: SavedProduct): Promise<void> {
    const confirmed = await this.toast.confirm(`Remove ${item.name} from saved items?`);
    if (!confirmed) {
      return;
    }

    try {
      const wishlists = await firstValueFrom(this.wishlistService.getWishlists());
      const wishlistId = wishlists[0]?._id;
      if (!wishlistId) {
        return;
      }

      await firstValueFrom(
        this.wishlistService.removeItemFromWishlist(wishlistId, item.productId)
      );
      this.saved.update((items) => items.filter((entry) => entry.productId !== item.productId));
      this.toast.info(`${item.name} removed`);
    } catch {
      this.toast.error('Could not remove that item. Try again.');
    }
  }
}
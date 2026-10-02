import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { WishlistService } from '../../services/wishlist.service';
import { Product } from '../../services/product.service';
import { AuthService } from '../../services/auth.service';

/**
 * MobileWishlistFacade — promise-based wishlist actions for the app.
 *
 * The website's `WishlistService` is reactive and requires a nested
 * `subscribe` to "get the list, create it if missing, then add the item"
 * (see ProductsComponent.addToWishlist). Screens in the app need the same
 * behaviour from a simple `await`, so the branching lives here once instead of
 * being copy-pasted into five mobile pages.
 *
 * The wishlist is API-backed and owned by a signed-in shopper, so every method
 * reports whether auth is required instead of throwing — callers decide
 * whether to send the shopper to the login screen.
 */
@Injectable({ providedIn: 'root' })
export class MobileWishlistFacade {
  private readonly wishlistService = inject(WishlistService);
  private readonly authService = inject(AuthService);

  /**
   * Saves a product, creating the default "My Favorites" list on first use.
   *
   * Returns `false` when the shopper is signed out — the caller should route to
   * `/login`. A duplicate is treated as a success: the shopper's intent (keep
   * this product) is satisfied, so re-saving must not look like an error.
   */
  async toggle(product: Product): Promise<boolean> {
    if (!this.isSignedIn) {
      return false;
    }

    const wishlists = await firstValueFrom(this.wishlistService.getWishlists());
    const wishlistId = wishlists[0]?._id ?? (await this.createDefaultWishlist());

    if (!wishlistId) {
      throw new Error('Could not create wishlist');
    }

    try {
      await firstValueFrom(this.wishlistService.addItemToWishlist(wishlistId, product.id));
      return true;
    } catch (error) {
      // 409 / "already exists" — the product is already saved, which is the
      // state the shopper asked for, so it must not surface as a failure.
      if (this.isDuplicate(error)) {
        return true;
      }
      throw error;
    }
  }

  /** Removes a saved product. Returns false when signed out. */
  async remove(product: Product): Promise<boolean> {
    if (!this.isSignedIn) {
      return false;
    }

    const wishlists = await firstValueFrom(this.wishlistService.getWishlists());
    const wishlistId = wishlists[0]?._id;
    if (!wishlistId) {
      return true;
    }

    await firstValueFrom(
      this.wishlistService.removeItemFromWishlist(wishlistId, product.id)
    );
    return true;
  }

  private get isSignedIn(): boolean {
    return this.authService.isLoggedIn();
  }

  /** Creates the default list and returns its id, or null on failure. */
  private async createDefaultWishlist(): Promise<string | null> {
    const response = await firstValueFrom(
      this.wishlistService.createWishlist('My Favorites', false)
    );
    return response?.success && response.wishlist?._id ? response.wishlist._id : null;
  }

  /** Recognises the server's "already exists" rejection. */
  private isDuplicate(error: unknown): boolean {
    const candidate = error as { status?: number; error?: { message?: string } };
    const message = candidate?.error?.message?.toLowerCase() ?? '';
    return candidate?.status === 409 || message.includes('already exists');
  }
}
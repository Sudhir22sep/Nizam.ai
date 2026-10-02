import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { of, throwError } from 'rxjs';

import { MobileWishlistFacade } from './mobile-wishlist.facade';
import { WishlistService } from '../../services/wishlist.service';
import { AuthService } from '../../services/auth.service';
import { Product } from '../../services/product.service';

describe('MobileWishlistFacade', () => {
  let facade: MobileWishlistFacade;
  let wishlistService: {
    getWishlists: ReturnType<typeof vi.fn>;
    createWishlist: ReturnType<typeof vi.fn>;
    addItemToWishlist: ReturnType<typeof vi.fn>;
    removeItemFromWishlist: ReturnType<typeof vi.fn>;
  };
  let authService: { isLoggedIn: ReturnType<typeof vi.fn> };

  const product = { id: 'p1', name: 'Oxford Shirt' } as Product;

  beforeEach(() => {
    wishlistService = {
      getWishlists: vi.fn(() => of([{ _id: 'w1', items: [] }])),
      createWishlist: vi.fn(() => of({ success: true, wishlist: { _id: 'w2' } })),
      addItemToWishlist: vi.fn(() => of({ success: true })),
      removeItemFromWishlist: vi.fn(() => of({ success: true }))
    };

    authService = { isLoggedIn: vi.fn(() => true) };

    TestBed.configureTestingModule({
      providers: [
        MobileWishlistFacade,
        { provide: WishlistService, useValue: wishlistService },
        { provide: AuthService, useValue: authService }
      ]
    });

    facade = TestBed.inject(MobileWishlistFacade);
  });

  it('adds the product to the existing wishlist', async () => {
    await expect(facade.toggle(product)).resolves.toBe(true);

    expect(wishlistService.addItemToWishlist).toHaveBeenCalledWith('w1', 'p1');
    expect(wishlistService.createWishlist).not.toHaveBeenCalled();
  });

  // A signed-out shopper has no API-backed wishlist, so the facade reports it
  // rather than throwing, and the screen routes them to /login.
  it('reports false without calling the API when signed out', async () => {
    authService.isLoggedIn.mockReturnValue(false);

    await expect(facade.toggle(product)).resolves.toBe(false);
    expect(wishlistService.getWishlists).not.toHaveBeenCalled();
  });

  it('creates the default wishlist first when none exists', async () => {
    wishlistService.getWishlists.mockReturnValue(of([]));

    await expect(facade.toggle(product)).resolves.toBe(true);

    expect(wishlistService.createWishlist).toHaveBeenCalledWith('My Favorites', false);
    expect(wishlistService.addItemToWishlist).toHaveBeenCalledWith('w2', 'p1');
  });

  // Re-saving an already-saved product satisfies the shopper's intent, so a
  // duplicate must not surface as an error toast.
  it('treats a duplicate as success', async () => {
    wishlistService.addItemToWishlist.mockReturnValue(
      throwError(() => ({ status: 409, error: { message: 'Already exists' } }))
    );

    await expect(facade.toggle(product)).resolves.toBe(true);
  });

  it('rethrows genuine failures so the screen can report them', async () => {
    wishlistService.addItemToWishlist.mockReturnValue(
      throwError(() => ({ status: 500, error: { message: 'Server error' } }))
    );

    await expect(facade.toggle(product)).rejects.toBeDefined();
  });

  it('removes the product from the wishlist', async () => {
    await expect(facade.remove(product)).resolves.toBe(true);
    expect(wishlistService.removeItemFromWishlist).toHaveBeenCalledWith('w1', 'p1');
  });

  it('reports false on remove when signed out', async () => {
    authService.isLoggedIn.mockReturnValue(false);

    await expect(facade.remove(product)).resolves.toBe(false);
    expect(wishlistService.removeItemFromWishlist).not.toHaveBeenCalled();
  });

  // Nothing to remove means the desired end state already holds, so removing
  // from a missing list is a success rather than an error.
  it('is a no-op success when removing from a wishlist that no longer exists', async () => {
    wishlistService.getWishlists.mockReturnValue(of([]));

    await expect(facade.remove(product)).resolves.toBe(true);
    expect(wishlistService.removeItemFromWishlist).not.toHaveBeenCalled();
  });
});

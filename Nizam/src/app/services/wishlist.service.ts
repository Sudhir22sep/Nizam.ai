import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { tap } from 'rxjs/operators';
import { BehaviorSubject, Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class WishlistService {
  private apiUrl = '/api/wishlist';
  private wishlistsSubject = new BehaviorSubject<any[]>([]);
  public wishlists = this.wishlistsSubject.asObservable();

  constructor(private http: HttpClient) {
    // Load wishlists on init
    this.loadWishlists();
  }

  /**
   * Get all wishlists for the current user
   */
  getWishlists(): Observable<any[]> {
    return this.wishlists;
  }

  /**
   * Load wishlists from API
   */
  loadWishlists(): void {
    this.http.get<any>(`${this.apiUrl}`).subscribe({
      next: (response) => {
        if (response.success) {
          this.wishlistsSubject.next(response.wishlists || []);
        }
      },
      error: (error) => {
        console.error('Error loading wishlists:', error);
        this.wishlistsSubject.next([]);
      }
    });
  }

  /**
   * Get a specific wishlist by ID
   */
  getWishlistById(id: string): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/${id}`);
  }

  /**
   * Create a new wishlist
   */
  createWishlist(name: string, isPublic: boolean = false): Observable<any> {
    return this.http.post<any>(this.apiUrl, { name, isPublic }).pipe(
      tap(response => {
        if (response.success) {
          this.loadWishlists(); // Reload wishlists after creation
        }
      })
    );
  }

  /**
   * Add an item to a wishlist
   */
  addItemToWishlist(wishlistId: string, productId: string, variantId: string | null = null, notes: string = ""): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/${wishlistId}/items`, { 
      productId, 
      variantId, 
      notes 
    }).pipe(
      tap(response => {
        if (response.success) {
          // Reload the specific wishlist to get updated items
          this.getWishlistById(wishlistId).subscribe();
        }
      })
    );
  }

  /**
   * Remove an item from a wishlist
   */
  removeItemFromWishlist(wishlistId: string, productId: string, variantId: string | null = null): Observable<any> {
    return this.http.delete<any>(`${this.apiUrl}/${wishlistId}/items`, {
      body: { productId, variantId }
    }).pipe(
      tap(response => {
        if (response.success) {
          // Reload the specific wishlist to get updated items
          this.getWishlistById(wishlistId).subscribe();
        }
      })
    );
  }

  /**
   * Delete a wishlist
   */
  deleteWishlist(wishlistId: string): Observable<any> {
    return this.http.delete<any>(`${this.apiUrl}/${wishlistId}`).pipe(
      tap(response => {
        if (response.success) {
          this.loadWishlists(); // Reload wishlists after deletion
        }
      })
    );
  }
}
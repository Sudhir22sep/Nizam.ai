import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { tap } from 'rxjs/operators';
import { BehaviorSubject, Observable } from 'rxjs';
import { AuthService } from './auth.service';

@Injectable({
  providedIn: 'root'
})
export class WishlistService {
  private apiUrl = '/api/wishlist';
  private wishlistsSubject = new BehaviorSubject<any[]>([]);
  public wishlists = this.wishlistsSubject.asObservable();

  constructor(private http: HttpClient, private authService: AuthService) {
    // Load wishlists on init
    this.loadWishlists();
  }

  /**
   * Get authorization headers if token exists
   */
  private getAuthHeaders(): { [header: string]: string } | {} {
    const token = this.authService.getToken();
    return token ? { 'Authorization': `Bearer ${token}` } : {};
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
    this.http.get<any>(`${this.apiUrl}`, { headers: this.getAuthHeaders() }).subscribe({
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
    return this.http.get<any>(`${this.apiUrl}/${id}`, { headers: this.getAuthHeaders() });
  }

  /**
   * Create a new wishlist
   */
  createWishlist(name: string, isPublic: boolean = false): Observable<any> {
    return this.http.post<any>(this.apiUrl, { name, isPublic }, { headers: this.getAuthHeaders() }).pipe(
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
    }, { headers: this.getAuthHeaders() }).pipe(

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
    return this.http.delete<any>(`${this.apiUrl}/${wishlistId}/items`, { headers: this.getAuthHeaders(), body: { productId, variantId } }).pipe(
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
    return this.http.delete<any>(`${this.apiUrl}/${wishlistId}`, { headers: this.getAuthHeaders() }).pipe(
      tap(response => {
        if (response.success) {
          this.loadWishlists(); // Reload wishlists after deletion
        }
      })
    );
  }
}
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { WishlistService } from '../../services/wishlist.service';

@Component({
  selector: 'app-wishlist',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  templateUrl: './wishlist.component.html',
  styleUrls: ['./wishlist.component.css']
})
export class WishlistComponent implements OnInit {
  wishlists: any[] = [];
  isLoading = true;
  showCreateModal = false;
  isCreating = false;
  createWishlistForm: FormGroup;

  constructor(
    private fb: FormBuilder,
    private wishlistService: WishlistService
  ) {
    this.createWishlistForm = this.fb.group({
      name: ['', Validators.required],
      isPublic: [false]
    });
  }

  ngOnInit(): void {
    this.loadWishlists();
  }

  loadWishlists(): void {
    this.isLoading = true;
    this.wishlistService.wishlists.subscribe({
      next: (wishlists) => {
        this.wishlists = wishlists;
        this.isLoading = false;
      },
      error: (error) => {
        console.error('Error loading wishlists:', error);
        this.isLoading = false;
      }
    });
  }

  openCreateWishlistModal(): void {
    this.showCreateModal = true;
    this.createWishlistForm.reset();
    this.createWishlistForm.patchValue({ isPublic: false });
  }

  closeCreateWishlistModal(): void {
    this.showCreateModal = false;
  }

  onCreateWishlistSubmit(): void {
    if (this.createWishlistForm.invalid) {
      return;
    }

    this.isCreating = true;
    const { name, isPublic } = this.createWishlistForm.value;

    this.wishlistService.createWishlist(name, isPublic).subscribe({
      next: () => {
        this.isCreating = false;
        this.closeCreateWishlistModal();
        this.loadWishlists(); // Reload wishlists
      },
      error: (error) => {
        this.isCreating = false;
        console.error('Error creating wishlist:', error);
      }
    });
  }

  viewWishlistItems(wishlistId: string): void {
    // Navigate to wishlist detail view
    // For now, we'll just show an alert
    alert(`Viewing items for wishlist ID: ${wishlistId}`);
    // TODO: Implement wishlist detail view
  }

  removeItemFromWishlist(wishlistId: string, productId: string, variantId: string | null): void {
    this.wishlistService.removeItemFromWishlist(wishlistId, productId, variantId).subscribe({
      next: () => {
        this.loadWishlists(); // Reload to reflect changes
      },
      error: (error) => {
        console.error('Error removing item from wishlist:', error);
      }
    });
  }

  deleteWishlist(wishlistId: string): void {
    if (confirm('Are you sure you want to delete this wishlist? This action cannot be undone.')) {
      this.wishlistService.deleteWishlist(wishlistId).subscribe({
        next: () => {
          this.loadWishlists(); // Reload wishlists
        },
        error: (error) => {
          console.error('Error deleting wishlist:', error);
        }
      });
    }
  }
}
import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { WishlistService } from '../../services/wishlist.service';
import { ToastService } from '../../services/toast.service';
import { EmptyStateComponent } from '../../components/empty-state/empty-state.component';

@Component({
  selector: 'app-wishlist',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, EmptyStateComponent],
  templateUrl: './wishlist.component.html',
  styleUrls: ['./wishlist.component.css']
})
export class WishlistComponent implements OnInit {
  wishlists: any[] = [];
  isLoading = true;
  showCreateModal = false;
  isCreating = false;
  createWishlistForm: FormGroup;

  private readonly toast = inject(ToastService);

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
        this.toast.error('Could not load your wishlists.');
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
        this.toast.success('Wishlist created.');
        this.loadWishlists();
      },
      error: (error) => {
        this.isCreating = false;
        console.error('Error creating wishlist:', error);
        this.toast.error('Could not create wishlist. Try again.');
      }
    });
  }

  viewWishlistItems(wishlistId: string): void {
    this.toast.info(`Viewing items for wishlist ID: ${wishlistId}`);
  }

  removeItemFromWishlist(wishlistId: string, productId: string, variantId: string | null): void {
    this.wishlistService.removeItemFromWishlist(wishlistId, productId, variantId).subscribe({
      next: () => {
        this.toast.success('Item removed.');
        this.loadWishlists();
      },
      error: (error) => {
        console.error('Error removing item from wishlist:', error);
        this.toast.error('Could not remove item.');
      }
    });
  }

  deleteWishlist(wishlistId: string): void {
    this.toast.confirm('Are you sure you want to delete this wishlist? This action cannot be undone.')
      .then(confirmed => {
        if (confirmed) {
          this.wishlistService.deleteWishlist(wishlistId).subscribe({
            next: () => {
              this.toast.success('Wishlist deleted.');
              this.loadWishlists();
            },
            error: (error) => {
              console.error('Error deleting wishlist:', error);
              this.toast.error('Could not delete wishlist.');
            }
          });
        }
      });
  }

  onCreateFirstWishlist(): void {
    this.openCreateWishlistModal();
  }
}
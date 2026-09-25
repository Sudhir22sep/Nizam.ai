import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';

export interface ProductReview {
  productId: string;
  userId?: string;
  rating: number;
  title: string;
  comment: string;
  createdAt: string;
}

export interface ProductReviewsResponse {
  success: boolean;
  reviews: ProductReview[];
  rating: number | null;
  reviewCount: number;
}

@Injectable({ providedIn: 'root' })
export class ReviewService {
  constructor(private readonly http: HttpClient) {}

  list(productId: string): Observable<ProductReviewsResponse> {
    return this.http.get<ProductReviewsResponse>(`/api/products/${encodeURIComponent(productId)}/reviews`);
  }

  submit(productId: string, review: Pick<ProductReview, 'rating' | 'title' | 'comment'>): Observable<{ success: boolean; review: ProductReview }> {
    return this.http.post<{ success: boolean; review: ProductReview }>(
      `/api/products/${encodeURIComponent(productId)}/reviews`,
      review
    );
  }
}

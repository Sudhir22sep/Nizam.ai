import { Component, Input, OnInit, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * HeroBannerComponent — Amma Wears hero with guaranteed text readability.
 *
 * Three-layer architecture:
 *   Layer 1  → <img> background (full-bleed, aspect-ratio locked)
 *   Layer 2  →  CSS gradient overlay (contrast insurance for text)
 *   Layer 3  →  HTML content (headline, subtitle, CTA buttons)
 *
 * Usage:
 *   <app-hero-banner
 *     imageUrl="/images/hero/summer-campaign.jpg"
 *     headline="Everyday luxury for modern wardrobes"
 *     eyebrow="Limited drop"
 *     subtitle="Premium apparel, effortless layering, curated essentials."
 *     ctaPrimary="Shop the collection" [ctaPrimaryUrl]="'/products'"
 *     ctaSecondary="Talk to a style advisor" [ctaSecondaryUrl]="'/contact'"
 *     [heroHighlights]="[{label:'Fast delivery', sub:'Across MENA & India'}]"
 *   ></app-hero-banner>
 */
@Component({
  selector: 'app-hero-banner',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="hero" [class.hero--has-image]="imageUrl">
      <!-- Layer 1: Background image -->
      <div class="hero__bg">
        <img
          *ngIf="imageUrl"
          [src]="imageUrl"
          [alt]="imageAlt || 'Hero banner'"
          class="hero__bg-img"
          (error)="onImageError($event)"
        />
      </div>

      <!-- Layer 2: Gradient overlay (always present; stronger when no image) -->
      <div class="hero__overlay"></div>

      <!-- Decorative glow blobs (brand identity) -->
      <div class="hero__glow hero__glow--one"></div>
      <div class="hero__glow hero__glow--two"></div>

      <!-- Layer 3: Content -->
      <div class="hero__inner">
        <div class="hero__copy">
          <span class="eyebrow hero__eyebrow">{{ eyebrow }}</span>

          <h1 class="hero__headline">
            <ng-container *ngIf="headline">{{ headline }}</ng-container>
            <ng-container *ngIf="!headline">
              Everyday luxury for <em>modern wardrobes</em>
            </ng-container>
          </h1>

          <p class="hero__subtitle" *ngIf="subtitle">{{ subtitle }}</p>

          <div class="hero__actions" *ngIf="ctaPrimary || ctaSecondary">
            <a
              *ngIf="ctaPrimary"
              [routerLink]="ctaPrimaryUrl || '/'"
              class="cta-button hero__cta"
            >{{ ctaPrimary }}</a>
            <a
              *ngIf="ctaSecondary"
              [routerLink]="ctaSecondaryUrl || '/contact'"
              class="hero__ghost-link"
            >{{ ctaSecondary }}</a>
          </div>

          <!-- Highlight cards (trust signals) -->
          <div class="hero__highlights" *ngIf="heroHighlights && heroHighlights.length">
            <div *ngFor="let h of heroHighlights">
              <strong>{{ h.label }}</strong>
              <span>{{ h.sub }}</span>
            </div>
          </div>
        </div>

        <div class="hero__visual" *ngIf="imageUrl">
          <div class="hero__card">
            <img [src]="imageUrl" [alt]="imageAlt || 'Fashion collection'" class="hero__card-img">
          </div>
          <div class="hero__card-chip" *ngIf="chipLabel">
            <strong>{{ chipLabel }}</strong>
            <span *ngIf="chipSub">{{ chipSub }}</span>
          </div>
        </div>
      </div>
    </section>
  `,
  styleUrl: './hero-banner.component.css'
})
export class HeroBannerComponent implements OnInit, OnChanges {
  @Input() imageUrl?: string;
  @Input() imageAlt?: string;
  @Input() headline?: string;
  @Input() eyebrow = 'Limited drop';
  @Input() subtitle?: string;
  @Input() ctaPrimary?: string;
  @Input() ctaPrimaryUrl?: string;
  @Input() ctaSecondary?: string;
  @Input() ctaSecondaryUrl?: string;
  @Input() heroHighlights?: { label: string; sub: string }[];
  @Input() chipLabel?: string;
  @Input() chipSub?: string;

  /** Fallback gradient used when image fails to load or isn't provided */
  private readonly fallbackGradient = 'var(--gradient-dark)';

  ngOnInit(): void {
    this.ensureDefaults();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes.imageUrl || changes.headline) {
      this.ensureDefaults();
    }
  }

  private ensureDefaults(): void {
    if (!this.imageUrl) {
      this.imageUrl = '';
    }
    if (!this.headline && !this.subtitle) {
      this.subtitle = 'Discover premium apparel, effortless layering pieces, and curated essentials designed for style, comfort, and confidence.';
    }
    if (!this.heroHighlights) {
      this.heroHighlights = [
        { label: 'Fast delivery', sub: 'Across MENA & India' },
        { label: 'Easy returns',  sub: '7-day hassle-free policy' },
        { label: 'COD available', sub: 'Pay on delivery, worry free' },
      ];
    }
  }

  onImageError(event: Event): void {
    const img = (event.target as HTMLImageElement) ?? null;
    if (img) img.style.display = 'none';
    // Overlay gradient will cover the missing image automatically
  }
}

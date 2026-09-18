import { Directive, ElementRef, HostListener, Input, OnChanges } from '@angular/core';
import { PRODUCT_IMAGE_PLACEHOLDER } from '../services/product.service';

@Directive({
  selector: '[appImageFallback]',
  standalone: true,
})
export class ImageFallbackDirective implements OnChanges {
  @Input() appImageFallback = PRODUCT_IMAGE_PLACEHOLDER;
  @Input() src?: string | null;

  constructor(private el: ElementRef<HTMLImageElement>) {
    // ensure lazy loading where supported
    const img = this.el.nativeElement;
    if (!img.getAttribute('loading')) {
      img.setAttribute('loading', 'lazy');
    }
  }

  ngOnChanges(): void {
    this.applyPrimarySource();
  }

  @HostListener('error') onError() {
    this.applyFallback();
  }

  private currentSource(): string {
    return this.src ?? this.el.nativeElement.getAttribute('src') ?? '';
  }

  private applyPrimarySource(): void {
    const img = this.el.nativeElement;
    const fallback = this.appImageFallback || PRODUCT_IMAGE_PLACEHOLDER;
    const current = this.currentSource();

    // Avoid loading a broken historical fallback path, and recover if a stale
    // relative URL survived from an older catalog value.
    if (!current || current === '/assets/images/placeholder.jpg' || img.src.endsWith('/assets/images/placeholder.jpg')) {
      img.src = fallback;
    } else {
      img.src = current;
    }
  }

  private applyFallback(): void {
    const img = this.el.nativeElement;
    const fallback = this.appImageFallback || PRODUCT_IMAGE_PLACEHOLDER;

    // Avoid loading a broken historical fallback path, and recover if a stale
    // relative URL survived from an older catalog value.
    if (img && img.src && !img.src.endsWith(fallback) && !img.src.endsWith('/assets/images/placeholder.jpg')) {
      img.src = fallback;
    } else if (img && (img.src.endsWith('/assets/images/placeholder.jpg') || !img.getAttribute('src'))) {
      img.src = fallback;
    }
  }
}

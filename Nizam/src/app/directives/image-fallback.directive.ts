import { Directive, ElementRef, HostListener, Input } from '@angular/core';

@Directive({
  selector: '[appImageFallback]',
  standalone: true,
})
export class ImageFallbackDirective {
  @Input() appImageFallback = 'images/products/placeholder.svg';

  constructor(private el: ElementRef<HTMLImageElement>) {
    // ensure lazy loading where supported
    const img = this.el.nativeElement;
    if (!img.getAttribute('loading')) {
      img.setAttribute('loading', 'lazy');
    }
  }

  @HostListener('error') onError() {
    const img = this.el.nativeElement;
    if (img && img.src && !img.src.endsWith(this.appImageFallback)) {
      img.src = this.appImageFallback;
    }
  }
}

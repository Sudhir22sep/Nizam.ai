import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnDestroy,
  Output,
  Renderer2,
  RendererStyleFlags2,
  inject,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import {
  Product,
  normalizeProductImages,
  primaryProductImage,
  productImageSrcset,
} from '../../services/product.service';
import { ImageFallbackDirective } from '../../directives/image-fallback.directive';
import { PricePipe } from '../../pipes/price.pipe';

/**
 * ProductCardComponent — pointer-driven 3D tilt card for the catalog grid.
 *
 * How the effect is built (no WebGL, no external 3D library):
 *
 *  1. The *host* element carries `perspective`, so it acts as the camera. The
 *     inner surface (`.tilt-card__inner`) is the only element that rotates, via
 *     `transform: rotateX() rotateY()` fed by the `--rotate-x` / `--rotate-y`
 *     custom properties.
 *  2. `mousemove` is tracked relative to the centre of the card and normalised
 *     to -0.5 … +0.5, so the effect is independent of card size or scroll.
 *  3. The tilt sign is chosen so the *edge under the cursor lifts towards the
 *     viewer*: `rotateY` is negated because a positive `rotateY` pushes the
 *     right-hand edge away from the camera.
 *  4. The transform is channelled through `preserve-3d`, so descendants can
 *     float above the card plane with `translateZ()` — the photo plate, the
 *     brand/discount badge and the quick-add bar each sit at their own depth.
 *
 * Performance notes:
 *
 *  - Every pointer sample is written to a single `requestAnimationFrame` slot,
 *    so a burst of `mousemove` events (or a high-polling-rate mouse) produces
 *    at most one style write per frame.
 *  - Style writes only touch a handful of custom properties on the host, which
 *    the browser interpolates inside `transform`; no layout is invalidated and
 *    the component never triggers Angular change detection.
 *  - The card's box is measured once per hover, from the *untransformed* host,
 *    never from the rotated surface (a rotated element reports a rotated
 *    bounding box, which would make the pointer maths drift as it tilts).
 *  - `will-change` is only hinted while the pointer is inside the card, so idle
 *    cards do not hold a permanent compositor layer.
 *
 * SSR / robustness: every DOM read happens inside pointer handlers, which only
 * exist in a browser, and `matchMedia` is resolved lazily from
 * `ownerDocument.defaultView`, so the component renders safely on the server.
 *
 * Usage:
 *   <app-product-card
 *     [product]="product"
 *     [eager]="$index < 2"
 *     (quickAdd)="addToCart($event)"
 *     (wishlistToggle)="addToWishlist($event)"
 *   ></app-product-card>
 */
@Component({
  selector: 'app-product-card',
  standalone: true,
  imports: [CommonModule, RouterLink, ImageFallbackDirective, PricePipe],
  templateUrl: './product-card.component.html',
  styleUrl: './product-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ProductCardComponent implements OnDestroy {
  /** Product rendered by the card. Required — the template reads it directly. */
  @Input({ required: true }) product!: Product;

  /** Peak rotation (degrees) reached at the edges of the card. */
  @Input() maxTilt = 12;

  /** How far (px) the cast shadow slides as the card tilts. */
  @Input() shadowTravel = 18;

  /** Scale applied while the pointer is inside the card. */
  @Input() hoverScale = 1.03;

  /** Vertical lift (px) applied while the pointer is inside the card. */
  @Input() hoverLift = 6;

  /** Loads the image eagerly; use only for above-the-fold cards. */
  @Input() eager = false;

  /** Per-instance opt-out of the tilt (the CSS fallbacks still apply). */
  @Input() tiltEnabled = true;

  /** Emitted by the quick-add button with the card's product. */
  @Output() readonly quickAdd = new EventEmitter<Product>();

  /** Emitted by either heart button with the card's product. */
  @Output() readonly wishlistToggle = new EventEmitter<Product>();

  readonly activeImageIndex = signal(0);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly renderer = inject(Renderer2);

  /** Latest pointer position in viewport (client) coordinates. */
  private pointer = { x: 0, y: 0 };

  /** Cached, untransformed host box — read at most once per layout change. */
  private bounds: DOMRect | null = null;
  private boundsDirty = true;

  /** Single in-flight animation frame; `framePending` is the re-entrancy guard. */
  private frameId: number | null = null;
  private framePending = false;

  /** Window listeners that invalidate the cached box while hovering. */
  private invalidateListeners: Array<() => void> = [];

  /** Lazily resolved `(hover: hover) and (pointer: fine)` + reduced-motion check. */
  private tiltSupported: boolean | null = null;

  ngOnDestroy(): void {
    this.stopTilt();
  }

  get images(): string[] {
    return normalizeProductImages(this.product?.images, undefined, this.product?.name);
  }

  /** Currently visible product image. */
  get image(): string {
    return this.images[this.activeImageIndex()] ?? primaryProductImage(undefined, undefined, this.product?.name);
  }

  /**
   * Responsive WebP candidates for a bundled photo, or null for catalog images
   * that live on a CDN and have no local variants.
   */
  productImageSrcset(image: string): string | null {
    return productImageSrcset(image);
  }

  selectImage(index: number): void {
    if (index >= 0 && index < this.images.length) {
      this.activeImageIndex.set(index);
    }
  }

  nextImage(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.images.length < 2) return;
    this.activeImageIndex.update(index => (index + 1) % this.images.length);
  }

  previousImage(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.images.length < 2) return;
    this.activeImageIndex.update(index => (index - 1 + this.images.length) % this.images.length);
  }

  /** Display-only percentage off, derived from the optional compare-at price. */
  get discountPercent(): number | null {
    const compareAt = this.product?.originalPrice ?? null;
    const price = this.product?.basePrice ?? 0;
    if (compareAt === null || price <= 0 || compareAt <= price) {
      return null;
    }
    return Math.round(((compareAt - price) / compareAt) * 100);
  }

  @HostListener('mouseenter', ['$event'])
  onMouseEnter(event: MouseEvent): void {
    if (!this.canTilt()) {
      return;
    }

    // Refresh the cached box (the page may have scrolled since the last hover)
    // and seed the pointer so the very first frame is already correct.
    this.boundsDirty = true;
    this.pointer = { x: event.clientX, y: event.clientY };
    this.watchForLayoutChanges();

    this.renderer.addClass(this.hostElement, 'is-tilting');
    this.setCardVariables({
      '--card-scale': String(clamp(this.hoverScale, 1, 1.15)),
      '--card-lift': `${-clamp(this.hoverLift, 0, 24)}px`
    });

    this.scheduleTilt();
  }

  @HostListener('mousemove', ['$event'])
  onMouseMove(event: MouseEvent): void {
    if (!this.canTilt()) {
      return;
    }

    this.pointer = { x: event.clientX, y: event.clientY };
    this.scheduleTilt();
  }

  @HostListener('mouseleave')
  onMouseLeave(): void {
    this.stopTilt();
  }

  /** Covers drag-out-of-window, where `mouseleave` does not always fire. */
  @HostListener('window:blur')
  onWindowBlur(): void {
    this.stopTilt();
  }

  onQuickAdd(): void {
    if (this.product.stock !== null && this.product.stock !== undefined && this.product.stock <= 0) return;
    this.quickAdd.emit(this.product);
  }

  onWishlistToggle(): void {
    this.wishlistToggle.emit(this.product);
  }

  /**
   * Queues one frame of work. Repeated pointer samples inside the same frame
   * collapse into a single style write; without `requestAnimationFrame` (SSR, or
   * a bare DOM implementation such as jsdom) the maths is applied directly so
   * the component still behaves correctly.
   */
  private scheduleTilt(): void {
    if (this.framePending) {
      return;
    }
    this.framePending = true;

    if (typeof requestAnimationFrame !== 'function') {
      this.framePending = false;
      this.applyTilt();
      return;
    }

    this.frameId = requestAnimationFrame(() => {
      this.framePending = false;
      this.frameId = null;
      this.applyTilt();
    });
  }

  /** Maps the pointer position to rotation, gloss position and shadow offset. */
  private applyTilt(): void {
    const rect = this.measureBounds();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return;
    }

    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    // Normalised offsets: -0.5 is the top/left edge, +0.5 the bottom/right edge.
    const offsetX = clamp((this.pointer.x - centerX) / rect.width, -0.5, 0.5);
    const offsetY = clamp((this.pointer.y - centerY) / rect.height, -0.5, 0.5);

    const degrees = clamp(this.maxTilt, 0, 30);
    const travel = clamp(this.shadowTravel, 0, 60);

    // rotateY is negated so the edge under the cursor lifts towards the camera;
    // rotateX is not, because a positive rotateX already brings the bottom of
    // the card forwards.
    const rotateY = -(offsetX * 2 * degrees);
    const rotateX = offsetY * 2 * degrees;

    this.setCardVariables({
      '--rotate-x': `${rotateX.toFixed(2)}deg`,
      '--rotate-y': `${rotateY.toFixed(2)}deg`,
      // Drives the radial gloss so the sheen tracks the pointer.
      '--pointer-x': `${((offsetX + 0.5) * 100).toFixed(2)}%`,
      '--pointer-y': `${((offsetY + 0.5) * 100).toFixed(2)}%`,
      // The cast shadow slides against the tilt, which reads as light coming
      // from the side the pointer is on.
      '--shadow-x': `${(-offsetX * 2 * travel).toFixed(1)}px`,
      '--shadow-y': `${(10 + Math.abs(offsetY) * travel * 0.6).toFixed(1)}px`
    });
  }

  /**
   * Returns the cached box of the *host* element. The host is the perspective
   * container and is never transformed, whereas the rotating surface reports a
   * rotated bounding box — using that would feed the tilt back into itself.
   */
  private measureBounds(): DOMRect | null {
    if (this.bounds && !this.boundsDirty) {
      return this.bounds;
    }

    const element = this.hostElement;
    if (typeof element?.getBoundingClientRect !== 'function') {
      return null;
    }

    this.bounds = element.getBoundingClientRect();
    this.boundsDirty = false;
    return this.bounds;
  }

  /** Watches scroll/resize while hovering so the cached box stays accurate. */
  private watchForLayoutChanges(): void {
    if (this.invalidateListeners.length > 0) {
      return;
    }

    const invalidate = () => {
      this.boundsDirty = true;
    };

    this.invalidateListeners = [
      this.renderer.listen('window', 'scroll', invalidate),
      this.renderer.listen('window', 'resize', invalidate)
    ];
  }

  /**
   * Releases the hover state: the pending frame is dropped and every custom
   * property returns to its neutral value, which lets the long, eased
   * transition in the stylesheet glide the card back to rest.
   */
  private stopTilt(): void {
    this.cancelTiltFrame();
    this.renderer.removeClass(this.hostElement, 'is-tilting');
    this.releaseInvalidateListeners();
    this.boundsDirty = true;

    this.setCardVariables({
      '--rotate-x': '0deg',
      '--rotate-y': '0deg',
      '--pointer-x': '50%',
      '--pointer-y': '50%',
      '--shadow-x': '0px',
      '--shadow-y': '10px',
      '--card-scale': '1',
      '--card-lift': '0px'
    });
  }

  private cancelTiltFrame(): void {
    if (this.framePending && this.frameId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.frameId);
    }
    this.frameId = null;
    this.framePending = false;
  }

  private releaseInvalidateListeners(): void {
    for (const remove of this.invalidateListeners) {
      remove();
    }
    this.invalidateListeners = [];
  }

  /**
   * Writes custom properties through `Renderer2`.
   *
   * `RendererStyleFlags2.DashCase` matters here: without it the DOM renderer
   * assigns `element.style['--rotate-x']`, which browsers silently ignore for
   * custom properties. The flag routes the write through
   * `CSSStyleDeclaration.setProperty()`, which does support them.
   */
  private setCardVariables(variables: Record<string, string>): void {
    const element = this.hostElement;
    for (const [name, value] of Object.entries(variables)) {
      this.renderer.setStyle(element, name, value, RendererStyleFlags2.DashCase);
    }
  }

  /** Skips the tilt for coarse pointers (touch) and reduced-motion requests. */
  private canTilt(): boolean {
    if (!this.tiltEnabled) {
      return false;
    }

    if (this.tiltSupported === null) {
      const view = this.hostElement?.ownerDocument?.defaultView;
      if (!view?.matchMedia) {
        this.tiltSupported = false;
      } else {
        this.tiltSupported =
          view.matchMedia('(hover: hover) and (pointer: fine)').matches &&
          !view.matchMedia('(prefers-reduced-motion: reduce)').matches;
      }
    }

    return this.tiltSupported;
  }

  private get hostElement(): HTMLElement {
    return this.host.nativeElement;
  }
}

/** Keeps every derived value inside the range the stylesheet can render. */
function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

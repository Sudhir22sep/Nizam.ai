import {
  ChangeDetectionStrategy, Component, ElementRef, HostListener, Input, OnDestroy,
  Renderer2, RendererStyleFlags2, inject
} from '@angular/core';
import { NgIf, NgFor } from '@angular/common';
import { RouterLink } from '@angular/router';

/**
 * Three-plane fashion hero with frame-batched pointer parallax.
 *
 * Background, branding/copy, and the model image consume the same normalised
 * pointer coordinates at different depths. `imageUrl` accepts either an
 * isolated transparent PNG/WebP or a regular editorial portrait.
 */
@Component({
  selector: 'app-hero-banner',
  standalone: true,
  imports: [NgIf, NgFor, RouterLink],
  templateUrl: './hero-banner.component.html',
  styleUrl: './hero-banner.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HeroBannerComponent implements OnDestroy {
  @Input() imageUrl = '/images/products/hero.jpg';
  @Input() imageAlt = 'Amma Wears seasonal fashion collection';
  @Input() headline = 'Everyday luxury for modern wardrobes';
  @Input() brandWord = 'AMMA';
  @Input() eyebrow = 'Limited drop';
  @Input() subtitle = 'Discover premium apparel, effortless layering pieces, and curated essentials designed for style, comfort, and confidence.';
  @Input() ctaPrimary = 'Shop the collection';
  @Input() ctaPrimaryUrl = '/products';
  @Input() ctaSecondary = 'Talk to a style advisor';
  @Input() ctaSecondaryUrl = '/contact';
  @Input() heroHighlights: ReadonlyArray<{ label: string; sub: string }> = [
    { label: 'Fast delivery', sub: 'Across MENA & India' },
    { label: 'Easy returns', sub: '7-day hassle-free policy' },
    { label: 'COD available', sub: 'Pay on delivery, worry free' }
  ];
  @Input() chipLabel = 'New season edit';
  @Input() chipSub = 'Curated pieces, restocked weekly';
  @Input() parallaxStrength = 42;

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly renderer = inject(Renderer2);
  private pointerX = 0;
  private pointerY = 0;
  private frameId: number | null = null;
  private animationSupported: boolean | null = null;

  ngOnDestroy(): void {
    this.cancelFrame();
  }

  @HostListener('mouseenter', ['$event'])
  onMouseEnter(event: MouseEvent): void {
    if (!this.canAnimate()) return;
    this.updatePointer(event);
    this.renderer.addClass(this.hostElement, 'is-parallax-active');
    this.scheduleParallax();
  }

  @HostListener('mousemove', ['$event'])
  onMouseMove(event: MouseEvent): void {
    if (!this.canAnimate()) return;
    this.updatePointer(event);
    this.scheduleParallax();
  }

  @HostListener('mouseleave')
  onMouseLeave(): void {
    this.pointerX = this.pointerY = 0;
    this.cancelFrame();
    this.renderer.removeClass(this.hostElement, 'is-parallax-active');
    this.writeTransforms(0, 0);
  }

  @HostListener('window:blur')
  onWindowBlur(): void {
    this.onMouseLeave();
  }

  onImageError(event: Event): void {
    const image = event.target as HTMLImageElement | null;
    image?.closest('.hero__figure')?.classList.add('hero__figure--fallback');
    if (image) image.hidden = true;
  }

  /** Coalesces high-frequency pointer events into one style write per frame. */
  private scheduleParallax(): void {
    if (this.frameId !== null) return;
    const view = this.hostElement.ownerDocument.defaultView;
    if (!view?.requestAnimationFrame) {
      this.applyParallax();
      return;
    }
    this.frameId = view.requestAnimationFrame(() => {
      this.frameId = null;
      this.applyParallax();
    });
  }

  private applyParallax(): void {
    const strength = clamp(this.parallaxStrength, 0, 80);
    this.writeTransforms(this.pointerX * strength, this.pointerY * strength);
  }

  private writeTransforms(x: number, y: number): void {
    const values: Record<string, string> = {
      '--parallax-bg-x': `${(x * 0.16).toFixed(2)}px`,
      '--parallax-bg-y': `${(y * 0.16).toFixed(2)}px`,
      '--parallax-mid-x': `${(-x * 0.42).toFixed(2)}px`,
      '--parallax-mid-y': `${(-y * 0.42).toFixed(2)}px`,
      '--parallax-front-x': `${x.toFixed(2)}px`,
      '--parallax-front-y': `${y.toFixed(2)}px`,
      '--parallax-tilt-x': `${(-y * 1.5).toFixed(2)}deg`,
      '--parallax-tilt-y': `${(x * 1.8).toFixed(2)}deg`
    };
    for (const [property, value] of Object.entries(values)) {
      this.renderer.setStyle(this.hostElement, property, value, RendererStyleFlags2.DashCase);
    }
  }

  private updatePointer(event: MouseEvent): void {
    const rect = this.hostElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    this.pointerX = clamp((event.clientX - rect.left) / rect.width - 0.5, -0.5, 0.5);
    this.pointerY = clamp((event.clientY - rect.top) / rect.height - 0.5, -0.5, 0.5);
  }

  private canAnimate(): boolean {
    if (this.animationSupported === null) {
      const view = this.hostElement.ownerDocument.defaultView;
      const hoverCapable = view?.matchMedia?.('(hover: hover) and (pointer: fine)').matches ?? false;
      const reducedMotion = view?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      this.animationSupported = hoverCapable && !reducedMotion;
    }
    return this.animationSupported;
  }

  private cancelFrame(): void {
    if (this.frameId !== null) {
      this.hostElement.ownerDocument.defaultView?.cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
  }

  private get hostElement(): HTMLElement {
    return this.host.nativeElement;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(value, min), max) : 0;
}

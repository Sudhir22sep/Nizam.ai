import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  PLATFORM_ID,
  inject,
  signal
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RouterLink } from '@angular/router';

export interface FeaturedCollection {
  readonly title: string;
  readonly description: string;
  readonly imageUrl: string;
  readonly imageUrls?: ReadonlyArray<string>;
  readonly imageAlt?: string;
  readonly href?: string;
}

@Component({
  selector: 'app-rotational-carousel',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './rotational-carousel.component.html',
  styleUrl: './rotational-carousel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class RotationalCarouselComponent implements OnChanges, OnInit, OnDestroy {
  @Input() collections: ReadonlyArray<FeaturedCollection> = [];
  @Input() previousLabel = 'Previous collection';
  @Input() nextLabel = 'Next collection';
  @Input() imageRotationInterval = 3200;

  activeIndex = 0;
  protected readonly imageIndexes = signal<ReadonlyArray<number>>([]);
  private rotationTimer: ReturnType<typeof setInterval> | null = null;
  private readonly platformId = inject(PLATFORM_ID);
  private readonly changeDetector = inject(ChangeDetectorRef);

  ngOnInit(): void {
    this.imageIndexes.set(this.collections.map(() => 0));
    if (!isPlatformBrowser(this.platformId) || !this.imagesCanRotate()) return;
    this.rotationTimer = setInterval(() => this.rotateVisibleImages(), this.imageRotationInterval);
  }

  ngOnDestroy(): void {
    this.stopRotation();
  }

  private imagesCanRotate(): boolean {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  private stopRotation(): void {
    if (this.rotationTimer !== null) {
      clearInterval(this.rotationTimer);
      this.rotationTimer = null;
    }
  }

  protected rotateVisibleImages(): void {
    if (!this.collections.length) return;
    this.imageIndexes.update(indexes => indexes.map((index, cardIndex) => {
      const count = this.collectionImages(cardIndex).length;
      return count > 1 ? (index + 1) % count : 0;
    }));
    this.changeDetector.markForCheck();
  }

  protected collectionImages(index: number): ReadonlyArray<string> {
    const collection = this.collections[index];
    if (!collection) return [];
    const images = collection.imageUrls?.length ? collection.imageUrls : [collection.imageUrl];
    return [...new Set(images.filter(Boolean))];
  }

  protected collectionImage(index: number): string {
    const images = this.collectionImages(index);
    const indexes = this.imageIndexes();
    return images[indexes[index] ?? 0] ?? images[0] ?? '';
  }

  protected isActiveImage(index: number, imageIndex: number): boolean {
    return imageIndex === (this.imageIndexes()[index] ?? 0);
  }

  protected collectionImagePosition(index: number): number {
    return (this.imageIndexes()[index] ?? 0) + 1;
  }

  ngOnChanges(): void {
    this.imageIndexes.set(this.collections.map(() => 0));
    if (this.collections.length === 0) this.activeIndex = 0;
    else this.activeIndex = Math.min(this.activeIndex, this.collections.length - 1);
  }

  protected get itemCount(): number {
    return this.collections.length;
  }

  protected itemOffset(index: number): number {
    if (this.itemCount < 2 || index === this.activeIndex) return 0;
    const distance = index - this.activeIndex;
    const wrapped = distance > this.itemCount / 2
      ? distance - this.itemCount
      : distance < -this.itemCount / 2
        ? distance + this.itemCount
        : distance;
    return Math.sign(wrapped);
  }

  protected itemTransform(index: number): string {
    const offset = this.itemOffset(index);
    if (offset === 0) return 'translate3d(0, 0, 90px) rotateY(0deg)';
    return `translate3d(${offset * 68}%, 0, -130px) rotateY(${offset * -48}deg) scale(.86)`;
  }

  protected isActive(index: number): boolean {
    return index === this.activeIndex;
  }

  protected mobilePosition(index: number): 'left' | 'right' | 'active' {
    if (this.isActive(index)) return 'active';
    return this.itemOffset(index) < 0 ? 'left' : 'right';
  }

  goTo(index: number): void {
    if (index < 0 || index >= this.itemCount) return;
    this.activeIndex = index;
  }

  next(): void {
    if (this.itemCount < 2) return;
    this.activeIndex = (this.activeIndex + 1) % this.itemCount;
  }

  prev(): void {
    if (this.itemCount < 2) return;
    this.activeIndex = (this.activeIndex - 1 + this.itemCount) % this.itemCount;
  }
}

import { ChangeDetectionStrategy, Component, Input, OnChanges } from '@angular/core';
import { RouterLink } from '@angular/router';

export interface FeaturedCollection {
  readonly title: string;
  readonly description: string;
  readonly imageUrl: string;
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
export class RotationalCarouselComponent implements OnChanges {
  @Input() collections: ReadonlyArray<FeaturedCollection> = [];
  @Input() ringRadius = 360;
  @Input() previousLabel = 'Previous collection';
  @Input() nextLabel = 'Next collection';

  activeIndex = 0;
  private rotationDegrees = 0;

  ngOnChanges(): void {
    this.rotationDegrees = 0;
    if (this.collections.length === 0) this.activeIndex = 0;
    else this.activeIndex = Math.min(this.activeIndex, this.collections.length - 1);
  }

  protected get itemCount(): number {
    return this.collections.length;
  }

  protected get rotation(): number {
    return this.rotationDegrees;
  }

  protected itemAngle(index: number): number {
    if (this.itemCount < 2) return 0;
    return (index / this.itemCount) * 360;
  }

  protected isActive(index: number): boolean {
    return index === this.activeIndex;
  }

  next(): void {
    if (this.itemCount < 2) return;
    this.activeIndex = (this.activeIndex + 1) % this.itemCount;
    this.rotationDegrees += 360 / this.itemCount;
  }

  prev(): void {
    if (this.itemCount < 2) return;
    this.activeIndex = (this.activeIndex - 1 + this.itemCount) % this.itemCount;
    this.rotationDegrees -= 360 / this.itemCount;
  }
}

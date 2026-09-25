import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

@Component({
  selector: 'app-bento-grid',
  standalone: true,
  templateUrl: './bento-grid.component.html',
  styleUrl: './bento-grid.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class BentoGridComponent {
  /** Accessible name for the grid landmark. */
  @Input() ariaLabel = 'Featured content';

  /** Number of columns on large screens. */
  @Input() columns = 4;
}

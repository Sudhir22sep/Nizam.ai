import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Decorative, GPU-composited ambient light background.
 * Place the host behind page content and ensure its parent supplies the height.
 */
@Component({
  selector: 'app-aurora-background',
  standalone: true,
  templateUrl: './aurora-background.component.html',
  styleUrl: './aurora-background.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AuroraBackgroundComponent {}

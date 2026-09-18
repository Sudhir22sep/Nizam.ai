import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { PRODUCT_IMAGE_PLACEHOLDER } from '../../services/product.service';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './home.component.html',
  styleUrl: './home.component.css'
})
export class HomeComponent {
  readonly productImagePlaceholder = PRODUCT_IMAGE_PLACEHOLDER;

  onImageError(event: Event) {
    const img = event?.target as HTMLImageElement;
    if (img) {
      img.src = PRODUCT_IMAGE_PLACEHOLDER;
    }
  }
}

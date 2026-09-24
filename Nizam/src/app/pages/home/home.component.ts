import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HeroBannerComponent } from '../../components/hero/hero-banner.component';
import { FeaturedCollection, RotationalCarouselComponent } from '../../components/rotational-carousel/rotational-carousel.component';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterLink, HeroBannerComponent, RotationalCarouselComponent],
  templateUrl: './home.component.html',
  styleUrl: './home.component.css'
})
export class HomeComponent {
  protected readonly featuredCollections: ReadonlyArray<FeaturedCollection> = [
    {
      title: 'Modern tailoring',
      description: 'Polished layers designed for workdays and everywhere after.',
      imageUrl: '/images/products/premium-shirt.jpeg',
      imageAlt: 'Premium tailored shirt',
      href: '/products'
    },
    {
      title: 'Evening silhouettes',
      description: 'Satin, soft lines, and confident details for special occasions.',
      imageUrl: '/images/products/satin-slip-dress.jpeg',
      imageAlt: 'Satin evening slip dress',
      href: '/products'
    },
    {
      title: 'Everyday staples',
      description: 'Easy essentials with a premium feel from morning to night.',
      imageUrl: '/images/products/Tshirt.jpeg',
      imageAlt: 'Everyday premium T-shirt',
      href: '/products'
    }
  ];
}

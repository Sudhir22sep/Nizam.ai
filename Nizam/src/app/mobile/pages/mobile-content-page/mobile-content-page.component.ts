import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { AnalyticsService } from '../../../services/analytics.service';
import { ToastService } from '../../../services/toast.service';

/** One editorial page: about, contact, or shipping & returns. */
interface ContentPage {
  slug: string;
  title: string;
  eyebrow: string;
  sections: ReadonlyArray<{ heading: string; body: string }>;
}

/**
 * Static copy for the app's informational pages.
 *
 * Kept here rather than fetched so these screens render instantly and keep
 * working offline; the copy mirrors the website's about / contact /
 * shipping-returns pages.
 */
const PAGES: Readonly<Record<string, ContentPage>> = {
  about: {
    slug: 'about',
    eyebrow: 'Our story',
    title: 'Designed for modern wardrobes',
    sections: [
      {
        heading: 'Everyday luxury',
        body: 'At Amma Wears, we blend thoughtful design with premium quality. Each item is crafted to bring refined comfort, polished style, and confidence to every look.',
      },
      {
        heading: 'Thoughtful fabrics',
        body: 'We choose materials that feel as good as they look — soft structure, confident colour and easy silhouettes that move through your day.',
      },
      {
        heading: 'Made for repeat wear',
        body: 'Easy pieces designed to feel as good as they look, so the things you love most are the ones you reach for again.',
      },
    ],
  },
  contact: {
    slug: 'contact',
    eyebrow: 'Customer care',
    title: 'Need help styling your look?',
    sections: [
      {
        heading: 'Talk to our style team',
        body: 'Send us a note and our style team will get back to you shortly. Tell us what you are looking for, or browse the collection and ask for help with sizing, fit and styling.',
      },
      {
        heading: 'Response time',
        body: 'Customer support replies within one business day.',
      },
    ],
  },
  'shipping-returns': {
    slug: 'shipping-returns',
    eyebrow: 'Orders & delivery',
    title: 'Shipping & returns',
    sections: [
      {
        heading: 'Free shipping',
        body: 'Free shipping on orders over ₹2999. Cash on delivery is available across selected locations.',
      },
      {
        heading: '7-day easy returns',
        body: 'Changed your mind? Return any unused item with its tags attached within 7 days of delivery, and we will arrange a refund to your original payment method.',
      },
      {
        heading: 'Secure checkout',
        body: 'Payments are handled by Razorpay and Stripe. Card details never touch our servers.',
      },
    ],
  },
};

/**
 * MobileContentPageComponent — the shared editorial screen.
 *
 * One component serves about, contact and shipping-returns, selected by the
 * `:page` route param (`/info/about`). A separate near-identical component per
 * page would triple the lazy chunks for content that is purely text.
 */
@Component({
  selector: 'app-mobile-content-page',
  imports: [RouterLink],
  templateUrl: './mobile-content-page.component.html',
  styleUrls: ['./mobile-content-page.component.scss'],
})
export class MobileContentPageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly analytics = inject(AnalyticsService);
  private readonly toast = inject(ToastService);

  protected readonly page = signal<ContentPage | null>(null);

  ngOnInit(): void {
    this.analytics.init();

    const slug = this.route.snapshot.paramMap.get('page') ?? 'about';
    const match = PAGES[slug] ?? PAGES['about'];
    this.page.set(match);

    this.analytics.trackPageView(`/info/${match.slug}`);

    if (!PAGES[slug]) {
      this.toast.info('Showing our story instead.');
    }
  }
}

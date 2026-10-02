import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { NavigationEnd, RouterLink, Router as NgRouter } from '@angular/router';
import { filter, startWith } from 'rxjs/operators';

import {
  IonApp,
  IonBadge,
  IonIcon,
  IonLabel,
  IonRouterOutlet,
  IonTabBar,
  IonTabButton,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  cartOutline,
  homeOutline,
  personOutline,
  searchOutline,
  heartOutline,
} from 'ionicons/icons';

import { CartService } from '../services/cart.service';
import { AnalyticsService } from '../services/analytics.service';
import { ToastContainerComponent } from '../components/toast-container/toast-container.component';
import { NativeShellService } from './services/native-shell.service';

/**
 * MobileAppComponent — the Ionic shell for the native app.
 *
 * Structure, top to bottom:
 *
 *   ion-app                (the single root element Ionic requires)
 *     ion-router-outlet    (the routed pages)
 *     ion-tab-bar          (fixed bottom navigation, 5 destinations)
 *
 * The tab bar is intentionally *not* implemented with `ion-tabs` / `ion-router`
 * outlets. `ion-tabs` owns its own navigation stack and cannot lazily load the
 * existing lazy routes, whereas routing everything through the plain Angular
 * router keeps the same URLs as the website and lets guarded screens
 * (`/checkout`, `/orders`) keep working with the existing AuthGuard.
 *
 * The outlet is animated through `ion-router-outlet`, so page transitions get
 * the native-feeling slide without giving up router control.
 */
@Component({
  selector: 'app-mobile-root',
  imports: [
    IonApp,
    IonBadge,
    IonRouterOutlet,
    IonTabBar,
    IonTabButton,
    IonIcon,
    IonLabel,
    RouterLink,
    ToastContainerComponent,
  ],
  templateUrl: './mobile-app.component.html',
  styleUrls: ['./mobile-app.component.scss'],
})
export class MobileAppComponent implements OnInit {
  private readonly navEvents = inject(NgRouter);
  private readonly analytics = inject(AnalyticsService);
  private readonly shell = inject(NativeShellService);

  protected readonly cartService = inject(CartService);

  /** Live cart badge, shown on the Cart tab. */
  protected readonly cartCount = this.cartService.itemCount;

  /** Current URL as a signal, so the tab state can be derived from it. */
  private readonly currentUrl = signal('/');

  /**
   * Which tab should light up.
   *
   * Ionic's `ion-tab-button` normally selects by its own outlet hierarchy,
   * which does not apply here because routing goes through the plain Angular
   * router (see the class comment). The active tab is therefore derived from
   * the URL instead.
   */
  protected readonly activeTab = computed(() => {
    const url = this.currentUrl();
    if (url.startsWith('/products') || url.startsWith('/product/')) {
      return 'products';
    }
    if (url.startsWith('/cart')) {
      return 'cart';
    }
    if (url.startsWith('/wishlist')) {
      return 'wishlist';
    }
    if (url.startsWith('/account')) {
      return 'account';
    }
    // Any other destination (login, orders, info pages...) falls back to Home
    // rather than leaving the bar with no tab selected.
    return 'home';
  });

  /**
   * Hides the tab bar on checkout, where the sticky "place order" bar needs the
   * full height of the screen.
   */
  protected readonly showTabs = computed(() => !this.currentUrl().startsWith('/checkout'));

  constructor() {
    addIcons({ cartOutline, homeOutline, personOutline, searchOutline, heartOutline });
  }

  ngOnInit(): void {
    // Status bar, keyboard and connectivity. Fire-and-forget: navigation must
    // not wait on a plugin round trip.
    void this.shell.init();

    // GA4 page views, matching the website's behaviour. A plain subscription
    // rather than toSignal + effect: these events fire for the lifetime of the
    // shell, and this way there is no signal write that could itself trigger a
    // re-check.
    this.navEvents.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        startWith(null)
      )
      .subscribe((event) => {
        if (event instanceof NavigationEnd) {
          this.currentUrl.set(event.urlAfterRedirects);
          this.analytics.init();
          this.analytics.trackPageView(event.urlAfterRedirects, this.navEvents.url);
        }
      });
  }

  /**
   * Scrolls to the top when the shopper re-taps the tab they are already on,
   * which is what native tab bars do.
   *
   * Navigation itself is left to `routerLink` on the tab buttons. This only
   * handles the one case `routerLink` cannot: it is a no-op when the URL is
   * unchanged, so re-tapping would otherwise do nothing at all. Using
   * `onSameUrlNavigation: 'reload'` would instead tear the page down and rebuild
   * it, discarding the shopper's search text, filters and scroll position.
   */
  protected onTabClick(tab: string): void {
    const target = tab === 'home' ? '/' : `/${tab}`;

    if (this.currentUrl() === target) {
      this.scrollToTop();
    }
  }

  /**
   * ion-router-outlet has no scrolling of its own — each page's ion-content is
   * the scroller, so that is what has to be told to go back to the top.
   */
  private scrollToTop(): void {
    document.querySelector<HTMLIonContentElement>('ion-content')?.scrollToTop();
  }
}

import { Component, effect, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, startWith } from 'rxjs/operators';
import { NavbarComponent } from './components/navbar/navbar.component';
import { ToastContainerComponent } from './components/toast-container/toast-container.component';
import { AuroraBackgroundComponent } from './components/aurora-background/aurora-background.component';
import { GlassPopupComponent } from './components/glass-popup/glass-popup.component';
import { AnalyticsService } from './services/analytics.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, NavbarComponent, ToastContainerComponent, AuroraBackgroundComponent, GlassPopupComponent],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class App {
  protected readonly title = signal('Amma Wears');
  protected readonly glassPreviewOpen = signal(false);

  private readonly router = inject(Router);
  private readonly analytics = inject(AnalyticsService);

  /** Emits after every completed router navigation (browser only). */
  private readonly routerNavevents = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      startWith(null)
    ),
    { initialValue: null }
  );

  constructor() {
    // GA4: load gtag.js in the browser and fire page_view on every route
    // change so SPA navigation is counted as visits in Google Analytics.
    effect(() => {
      const event = this.routerNavevents();
      if (event instanceof NavigationEnd) {
        this.analytics.init();
        this.analytics.trackPageView(event.urlAfterRedirects, this.router.url);
      }
    });
  }
}

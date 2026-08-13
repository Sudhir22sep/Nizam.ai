import {
  Component,
  Inject,
  PLATFORM_ID,
  Injector,
  isPlatformServer,
  isPlatformBrowser,
} from '@angular/core';
import { environment } from '../environments/environment';
import { ActivatedRoute } from '@angular/router';
import { Title } from '@angular/platform-browser';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
})
export class AppComponent {
  /** Detect if the component is being rendered on the server */
  isServer: boolean;
  /** Detect if the component is being rendered in the browser */
  isBrowser: boolean;

  /** Example of data that can only be loaded in the browser */
  clientOnlyData: string | null = null;

  constructor(
    private route: ActivatedRoute,
    private title: Title,
    private injector: Injector,
    @Inject(PLATFORM_ID) private platformId: Object
  ) {
    this.isServer = isPlatformServer(this.platformId);
    this.isBrowser = isPlatformBrowser(this.platformId);

    // Set an SEO-friendly title from the route's data, falling back to a default
    const routeTitle = this.route.snapshot.data['title'];
    if (routeTitle) {
      this.title.setTitle(`${routeTitle} - ${environment.appName}`);
    }

    // Client-only logic (e.g. loading scripts or modules that rely on window)
    if (this.isBrowser) {
      this.loadClientOnlyData();
    }
  }

  /**
   * Dynamically import a client-only module.
   * This avoids referencing DOM APIs during server-side rendering.
   */
  private loadClientOnlyData(): void {
    import('../client-only/client-only.module')
      .then((m) => m.ClientOnlyModule.loadData())
      .then((data) => {
        this.clientOnlyData = data;
      })
      .catch((err) => console.error('Failed to load client-only module', err));
  }
}

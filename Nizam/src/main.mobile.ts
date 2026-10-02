import { bootstrapApplication } from '@angular/platform-browser';

import { mobileAppConfig } from './app/mobile/app.config.mobile';
import { MobileAppComponent } from './app/mobile/mobile-app.component';

/**
 * Entry point for the Ionic / Capacitor mobile bundle.
 *
 * This is a *second* bootstrap, separate from `src/main.ts` which serves the
 * SSR website. Both share every page component's underlying services, but they
 * compile to different outputs: the website keeps server rendering and the
 * desktop navbar/footer, while this build is client-only and wrapped in the
 * Ionic shell (header + bottom tab bar).
 */
bootstrapApplication(MobileAppComponent, mobileAppConfig).catch((err) =>
  console.error(err)
);
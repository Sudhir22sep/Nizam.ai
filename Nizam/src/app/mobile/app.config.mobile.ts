import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners
} from '@angular/core';
import {
  HTTP_INTERCEPTORS,
  provideHttpClient,
  withFetch,
  withInterceptorsFromDi,
  withNoXsrfProtection
} from '@angular/common/http';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular';

import { mobileRoutes } from './app.routes.mobile';
import { AuthInterceptor } from '../interceptors/auth.interceptor';
import { MobileApiInterceptor } from './interceptors/mobile-api.interceptor';

/**
 * Mobile app configuration (Capacitor / Ionic).
 *
 * Deliberately separate from `app.config.ts`:
 *
 *  - No `provideClientHydration` / SSR providers. The mobile bundle is rendered
 *    once inside a WebView; there is no server pass to hydrate against, and
 *    asking for hydration would just leave the app waiting for data that is
 *    never sent.
 *  - `provideIonicAngular` supplies the Ionic config (mode, gesture
 *    coordination, animations). Without it, `ion-*` web components do not
 *    initialise their behaviour.
 *  - `withNoXsrfProtection` is kept for the same reason as the web build: the
 *    API is cross-origin and the JWT rides in the Authorization header.
 */
export const mobileAppConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(mobileRoutes, withComponentInputBinding()),
    provideIonicAngular({
      // `mode` is intentionally left unset. Ionic then derives the platform at
      // runtime, which gives Material components on Android and the iOS-style
      // ones on iPhone from a single bundle. Hard-coding either value here
      // would ship the wrong interaction and animation curves to half the
      // devices.
      animated: true,
    }),
    provideHttpClient(withFetch(), withInterceptorsFromDi(), withNoXsrfProtection()),

    // Interceptor order matters and is load-bearing:
    //
    //   1. AuthInterceptor matches on the *relative* '/api/' prefix to attach
    //      the stored JWT.
    //   2. MobileApiInterceptor then rewrites that still-relative URL onto the
    //      absolute API origin.
    //
    // Reversing these would break sign-in on device: the auth interceptor would
    // never see a relative '/api/...' URL, so no token would ever be attached
    // and every authenticated request would come back 401.
    { provide: HTTP_INTERCEPTORS, useClass: AuthInterceptor, multi: true },
    { provide: HTTP_INTERCEPTORS, useClass: MobileApiInterceptor, multi: true },
  ],
};
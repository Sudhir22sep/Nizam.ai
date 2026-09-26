import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { HTTP_INTERCEPTORS, provideHttpClient, withFetch, withInterceptorsFromDi, withNoXsrfProtection } from '@angular/common/http';

import { routes } from './app.routes';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { AuthInterceptor } from './interceptors/auth.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideClientHydration(withEventReplay()),
    // withFetch() is required for SSR (NG02801): the XHR backend is not
    // supported during server rendering, and fetch is the recommended backend
    // there. Ordering does not matter to provideHttpClient, but it is kept first
    // to mirror the import list.
    // withNoXsrfProtection() stays because the API is cross-origin and the token
    // is carried in the Authorization header, not a cookie.
    provideHttpClient(withFetch(), withInterceptorsFromDi(), withNoXsrfProtection()),
    // Attaches the stored JWT to API calls and discards the session when the
    // server rejects the token (expired, or signed with a rotated JWT_SECRET).
    { provide: HTTP_INTERCEPTORS, useClass: AuthInterceptor, multi: true }
  ]
};

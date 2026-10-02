import { Injectable } from '@angular/core';
import {
  HttpEvent,
  HttpHandler,
  HttpInterceptor,
  HttpRequest
} from '@angular/common/http';
import { Observable } from 'rxjs';

import { environment } from '../../../environments/environment';

/**
 * MobileApiInterceptor — rewrites same-origin `/api` requests to the absolute
 * API origin.
 *
 * Every service in the storefront (auth, catalog, wishlist, orders) calls
 * relative paths such as `/api/products`. That is correct on the website, where
 * Angular and Express share an origin, but inside a Capacitor WebView the
 * origin is `capacitor://localhost` / `http://localhost`, so those requests
 * would hit the bundled app's own asset server and fail.
 *
 * Rewriting here — rather than editing every service — keeps a single source of
 * truth for API calls across the website and the app.
 *
 * Requests that are already absolute (remote CDN images, the Razorpay checkout,
 * auth headers) are passed through untouched.
 */
@Injectable()
export class MobileApiInterceptor implements HttpInterceptor {
  intercept(request: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    return next.handle(this.rewrite(request));
  }

  /**
   * Returns the request unchanged unless it targets the relative `/api`.
   *
   * The `/api/` boundary matters: a plain `startsWith('/api')` would also match
   * unrelated local paths such as `/api-key-config.json` and try to send them
   * to the API host, failing on a request that should have been served from
   * the bundled app itself.
   */
  private rewrite(request: HttpRequest<unknown>): HttpRequest<unknown> {
    const base = environment.apiUrl;
    if (!base || !this.targetsApi(request.url)) {
      return request;
    }

    return request.clone({ url: `${base}${request.url}` });
  }

  /** True for `/api` itself and anything nested under `/api/`. */
  private targetsApi(url: string): boolean {
    return url === '/api' || url.startsWith('/api/') || url.startsWith('/api?');
  }
}
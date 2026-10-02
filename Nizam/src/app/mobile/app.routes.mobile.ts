import { Routes } from '@angular/router';

import { AuthGuard } from '../guards/auth.guard';
import { MobileHomeComponent } from './pages/mobile-home/mobile-home.component';
import { MobileProductsComponent } from './pages/mobile-products/mobile-products.component';
import { MobileCartComponent } from './pages/mobile-cart/mobile-cart.component';
import { MobileWishlistComponent } from './pages/mobile-wishlist/mobile-wishlist.component';
import { MobileAccountComponent } from './pages/mobile-account/mobile-account.component';
import { MobileLoginComponent } from './pages/mobile-login/mobile-login.component';
import { MobileRegisterComponent } from './pages/mobile-register/mobile-register.component';
import { MobileCheckoutComponent } from './pages/mobile-checkout/mobile-checkout.component';
import { MobileOrdersComponent } from './pages/mobile-orders/mobile-orders.component';
import { MobileContentPageComponent } from './pages/mobile-content-page/mobile-content-page.component';

/**
 * Routes for the Ionic / Capacitor app.
 *
 * Path shape mirrors the website so any deep link, analytics page path, or
 * support URL behaves the same in both places — only the components and the
 * shell around them differ.
 *
 * The five tab destinations (home, products, cart, wishlist, account) are
 * eagerly imported: they are the only screens that must be ready instantly, and
 * lazy chunks inside a WebView add a round trip to the first tap. Everything
 * reachable only by tapping into a tab (product detail, checkout, orders,
 * sign-in, content pages) stays lazy.
 */
export const mobileRoutes: Routes = [
  { path: 'home', redirectTo: '', pathMatch: 'full' },
  { path: '', component: MobileHomeComponent },
  { path: 'products', component: MobileProductsComponent },
  { path: 'cart', component: MobileCartComponent },
  { path: 'wishlist', component: MobileWishlistComponent },
  {
    path: 'product/:id',
    loadComponent: () =>
      import('./pages/mobile-product-detail/mobile-product-detail.component').then(
        (m) => m.MobileProductDetailComponent
      ),
  },
  { path: 'account', component: MobileAccountComponent },

  {
    path: 'checkout',
    canActivate: [AuthGuard],
    loadComponent: () =>
      import('./pages/mobile-checkout/mobile-checkout.component').then(
        (m) => m.MobileCheckoutComponent
      ),
  },
  {
    path: 'orders',
    canActivate: [AuthGuard],
    loadComponent: () =>
      import('./pages/mobile-orders/mobile-orders.component').then(
        (m) => m.MobileOrdersComponent
      ),
  },
  {
    path: 'login',
    loadComponent: () =>
      import('./pages/mobile-login/mobile-login.component').then((m) => m.MobileLoginComponent),
  },
  {
    path: 'register',
    loadComponent: () =>
      import('./pages/mobile-register/mobile-register.component').then(
        (m) => m.MobileRegisterComponent
      ),
  },

  // Static editorial pages (about, contact, shipping & returns) share one
  // generic screen driven by the `:page` path param, which keeps the lazy chunk
  // count down instead of shipping a near-identical component per page.
  {
    path: 'info/:page',
    loadComponent: () =>
      import('./pages/mobile-content-page/mobile-content-page.component').then(
        (m) => m.MobileContentPageComponent
      ),
  },

  { path: '**', redirectTo: '' },
];
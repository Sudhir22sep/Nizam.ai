import { Routes } from '@angular/router';
import { HomeComponent } from './pages/home/home.component';
import { AuthGuard } from './guards/auth.guard';

/**
 * Every destination except the landing page is lazily loaded.
 *
 * The home page is the one route that must be ready for the first paint, so it
 * stays eager. The rest used to be statically imported, which pulled all of
 * their templates and components into the initial bundle and pushed it over
 * the size budget. `loadComponent` splits each into its own chunk that is only
 * fetched when the shopper actually navigates there, so the initial payload
 * drops by the combined weight of those pages.
 */
export const routes: Routes = [
  { path: 'home', redirectTo: '', pathMatch: 'full' },
  {
    path: 'products',
    loadComponent: () => import('./pages/products/products.component').then(m => m.ProductsComponent),
  },
  {
    path: 'cart',
    loadComponent: () => import('./pages/cart/cart.component').then(m => m.CartComponent),
  },
  {
    path: 'checkout',
    canActivate: [AuthGuard],
    loadComponent: () => import('./pages/checkout/checkout.component').then(m => m.CheckoutComponent),
  },
  {
    path: 'contact',
    loadComponent: () => import('./pages/contact/contact.component').then(m => m.ContactComponent),
  },
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login.component').then(m => m.LoginComponent),
  },
  {
    path: 'register',
    loadComponent: () => import('./pages/register/register.component').then(m => m.RegisterComponent),
  },
  {
    path: 'forgot-password',
    loadComponent: () => import('./pages/forgot-password/forgot-password.component').then(m => m.ForgotPasswordComponent),
  },
  {
    path: 'reset-password',
    loadComponent: () => import('./pages/reset-password/reset-password.component').then(m => m.ResetPasswordComponent),
  },
  {
    path: 'orders',
    canActivate: [AuthGuard],
    loadComponent: () => import('./pages/orders/orders.component').then(m => m.OrdersComponent),
  },
  {
    path: 'about',
    loadComponent: () => import('./pages/about/about.component').then(m => m.AboutComponent),
  },
  {
    path: 'shipping-returns',
    loadComponent: () => import('./pages/shipping-returns/shipping-returns.component').then(m => m.ShippingReturnsComponent),
  },
  {
    path: 'wishlist',
    canActivate: [AuthGuard],
    loadComponent: () => import('./pages/wishlist/wishlist.component').then(m => m.WishlistComponent),
  },
  {
    path: 'checkout-success',
    canActivate: [AuthGuard],
    loadComponent: () => import('./pages/checkout-success/checkout-success.component').then(m => m.CheckoutSuccessComponent),
  },
  {
    path: 'product/:id',
    loadComponent: () => import('./pages/product-detail/product-detail.component').then(m => m.ProductDetailComponent),
  },
  { path: '', component: HomeComponent },
  { path: '**', redirectTo: '' }
];

import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { IonIcon, IonSpinner } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { chevronBackOutline, lockClosedOutline } from 'ionicons/icons';

import { CartService } from '../../../services/cart.service';
import { AuthService } from '../../../services/auth.service';
import { CurrencyService } from '../../../services/currency.service';
import { PaymentService, PaymentMethod } from '../../../services/payment.service';
import { AnalyticsService } from '../../../services/analytics.service';
import { ToastService } from '../../../services/toast.service';
import { PricePipe } from '../../../pipes/price.pipe';
import { ImageFallbackDirective } from '../../../directives/image-fallback.directive';
import { NativeShellService } from '../../services/native-shell.service';

/** Payment methods offered in the app, in the order they are presented. */
const METHODS: ReadonlyArray<{ id: PaymentMethod; label: string; hint: string }> = [
  { id: 'razorpay', label: 'UPI, cards & netbanking', hint: 'Pay securely with Razorpay' },
  { id: 'stripe', label: 'International cards', hint: 'Visa, Mastercard and Amex' },
  { id: 'cod', label: 'Cash on delivery', hint: 'Pay when your order arrives' },
];

/**
 * MobileCheckoutComponent — address capture + payment.
 *
 * This screen hides the bottom tab bar (see MobileAppComponent.tabForUrl) so
 * the sticky "place order" bar gets the full height — with a keyboard open, the
 * extra 56px is the difference between the form being usable or not.
 *
 * The order is created through the same PaymentService the website uses, so
 * pricing is re-verified server-side and both surfaces share one payment path.
 */
@Component({
  selector: 'app-mobile-checkout',
  imports: [FormsModule, IonIcon, IonSpinner, PricePipe, ImageFallbackDirective],
  templateUrl: './mobile-checkout.component.html',
  styleUrls: ['./mobile-checkout.component.scss'],
})
export class MobileCheckoutComponent implements OnInit {
  private readonly cartService = inject(CartService);
  private readonly authService = inject(AuthService);
  private readonly currencyService = inject(CurrencyService);
  private readonly paymentService = inject(PaymentService);
  private readonly analytics = inject(AnalyticsService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly shell = inject(NativeShellService);

  // getItems() returns a plain array; computed() keeps the summary reactive.
  protected readonly items = computed(() => this.cartService.getItems());
  protected readonly total = this.cartService.cartTotal;

  protected readonly name = signal('');
  protected readonly email = signal('');
  protected readonly address = signal('');
  protected readonly method = signal<PaymentMethod>('razorpay');
  protected readonly submitting = signal(false);

  protected readonly methods = METHODS;
  protected readonly currency = this.currencyService.activeCurrency;

  ngOnInit(): void {
    this.analytics.init();
    this.analytics.trackPageView('/checkout');

    // Pre-fill from the session so a returning shopper does not retype their
    // details; the address is always left blank since it changes per delivery.
    const user = this.authService.user();
    if (user) {
      const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
      this.name.set(fullName || user.name || '');
      this.email.set(user.email ?? '');
    }

    // Falling back to COD keeps checkout usable when the online gateways have
    // not been configured on the server yet.
    if (!this.cartService.getItems().length) {
      void this.router.navigateByUrl('/cart');
    }
  }

  protected image(index: number): string {
    return this.items()[index]?.product?.images?.[0] ?? '/images/products/placeholder.svg';
  }

  protected selectMethod(method: PaymentMethod): void {
    this.method.set(method);
  }

  protected async placeOrder(): Promise<void> {
    if (this.submitting()) {
      return;
    }

    const name = this.name().trim();
    const email = this.email().trim();
    const address = this.address().trim();

    if (!name || !email || !address) {
      this.toast.warning('Enter your name, email and delivery address.');
      return;
    }

    this.submitting.set(true);
    try {
      const result = await this.paymentService.createOrder(this.method(), {
        name,
        email,
        address,
        items: this.items().map((item) => ({
          productId: item.product.id,
          name: item.product.name,
          quantity: item.quantity,
          size: item.size,
          price: item.unitPrice,
        })),
        total: this.total(),
        currency: this.currency(),
      });

      if (!result?.success) {
        throw new Error(result?.message ?? 'Could not place the order');
      }

      this.analytics.trackBeginCheckout([], this.total());

      // Stripe hosts its own checkout page; hand the WebView over to it and
      // let the return URL settle the order.
      if (this.method() === 'stripe' && result.checkoutUrl) {
        this.paymentService.redirectToStripeCheckout(result.checkoutUrl);
        return;
      }

      if (this.method() === 'razorpay' && result.orderReference) {
        // Razorpay is rendered by the injected checkout.js script; that script
        // is loaded in index.html for the web build, so its absence here is
        // detected and reported rather than failing silently.
        await this.confirmRazorpay(result.orderReference, result.keyId ?? '', this.total());
        return;
      }

      // COD: the order already exists server-side, so the cart can be cleared.
      this.cartService.clearCart();
      this.toast.success('Order placed. Cash on delivery confirmed.');
      await this.shell.dismissKeyboard();
      await this.router.navigateByUrl('/orders');
    } catch (error) {
      this.toast.error(this.messageFor(error));
    } finally {
      this.submitting.set(false);
    }
  }

  /** Opens the Razorpay modal and confirms the payment on success. */
  private async confirmRazorpay(
    orderReference: string,
    keyId: string,
    total: number
  ): Promise<void> {
    // Captured here so the Razorpay handler can reference the order it belongs
    // to; the handler outlives this method call.
    const razorpay = (window as any).Razorpay;
    if (typeof razorpay !== 'function') {
      // The checkout script is loaded by index.html; if it is missing the
      // payment cannot start, so the shopper is told plainly and can retry
      // with COD instead.
      this.toast.error('Payment is unavailable right now. Try cash on delivery.');
      return;
    }

    const options = {
      key: keyId,
      amount: Math.round(total * 100),
      currency: this.currency(),
      name: 'Amma Wears',
      order_id: orderReference,
      prefill: { name: this.name(), email: this.email() },
      theme: { color: '#D92D48' },
      // Razorpay's handler returns the payment id, order id and the signature
      // computed over the other two; the server recomputes it and rejects the
      // order if it does not match, which is what makes this safe to trust.
      handler: async (response: {
        razorpay_payment_id: string;
        razorpay_order_id: string;
        razorpay_signature: string;
      }) => {
        try {
          await this.paymentService.confirmRazorpayPayment({
            orderReference,
            razorpayPaymentId: response.razorpay_payment_id,
            razorpayOrderId: response.razorpay_order_id,
            razorpaySignature: response.razorpay_signature,
          });
          this.cartService.clearCart();
          this.toast.success('Payment complete. Thank you!');
          await this.router.navigateByUrl('/orders');
        } catch {
          this.toast.error('Payment could not be confirmed. Contact support.');
        }
      },
      modal: { ondismiss: () => this.toast.info('Payment cancelled.') },
    };

    new razorpay(options).open();
  }

  private messageFor(error: unknown): string {
    const candidate = error as { status?: number; error?: { message?: string } };
    if (candidate?.status === 0) {
      return 'Cannot reach the server. Check your connection and try again.';
    }
    if (candidate?.status === 401) {
      return 'Your session expired. Sign in again to place the order.';
    }
    return candidate instanceof Error
      ? candidate.message
      : 'Could not place your order. Try again.';
  }

  protected backToCart(): void {
    void this.router.navigateByUrl('/cart');
  }
}

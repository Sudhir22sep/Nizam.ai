import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  chevronForwardOutline,
  heartOutline,
  logOutOutline,
  personOutline,
  receiptOutline,
  helpCircleOutline,
} from 'ionicons/icons';

import { AuthService } from '../../../services/auth.service';
import { CartService } from '../../../services/cart.service';
import { AnalyticsService } from '../../../services/analytics.service';
import { ToastService } from '../../../services/toast.service';
import { CurrencyService, CurrencyCode } from '../../../services/currency.service';
import { NativeShellService } from '../../services/native-shell.service';

/** A row in the account menu list. */
interface MenuLink {
  label: string;
  description: string;
  icon: string;
  path: string;
}

/**
 * MobileAccountComponent — the Account tab.
 *
 * Doubles as the app's settings screen: the currency picker lives here because
 * it is the only preference the storefront has, and burying it in a 5th tab
 * would be worse than grouping it with the shopper's identity.
 */
@Component({
  selector: 'app-mobile-account',
  imports: [RouterLink, IonIcon],
  templateUrl: './mobile-account.component.html',
  styleUrls: ['./mobile-account.component.scss'],
})
export class MobileAccountComponent implements OnInit {
  private readonly authService = inject(AuthService);
  private readonly analytics = inject(AnalyticsService);
  private readonly toast = inject(ToastService);
  private readonly shell = inject(NativeShellService);

  protected readonly cartService = inject(CartService);
  protected readonly currencyService = inject(CurrencyService);

  protected readonly user = this.authService.user;
  protected readonly cartCount = this.cartService.itemCount;

  protected readonly currencies: ReadonlyArray<{ code: CurrencyCode; label: string }> = [
    { code: 'USD', label: 'USD — US Dollar' },
    { code: 'INR', label: 'INR — Indian Rupee' },
    { code: 'AED', label: 'AED — UAE Dirham' },
    { code: 'SAR', label: 'SAR — Saudi Riyal' },
  ];

  protected readonly activeCurrency = this.currencyService.activeCurrency;

  /** Account-scoped destinations, shown only when signed in. */
  protected readonly accountLinks: readonly MenuLink[] = [
    {
      label: 'My orders',
      description: 'Track and review past purchases',
      icon: 'receipt-outline',
      path: '/orders',
    },
    {
      label: 'Wishlist',
      description: 'Items you have saved',
      icon: 'heart-outline',
      path: '/wishlist',
    },
  ];

  /** Store information, shown to everyone. */
  protected readonly infoLinks: readonly MenuLink[] = [
    {
      label: 'About Amma Wears',
      description: 'Our story and what we stand for',
      icon: 'person-outline',
      path: '/info/about',
    },
    {
      label: 'Contact us',
      description: 'Talk to our style team',
      icon: 'help-circle-outline',
      path: '/info/contact',
    },
    {
      label: 'Shipping & returns',
      description: 'Delivery windows and our 7-day returns',
      icon: 'receipt-outline',
      path: '/info/shipping-returns',
    },
  ];

  ngOnInit(): void {
    this.analytics.init();
    this.analytics.trackPageView('/account');
  }

  protected get displayName(): string {
    const user = this.user();
    const first = user?.firstName?.trim();
    if (first) {
      return `Hi, ${first}`;
    }
    return user?.email ?? 'Your account';
  }

  protected onCurrencyChange(event: Event): void {
    const code = (event.target as HTMLSelectElement).value as CurrencyCode;
    this.currencyService.setCurrency(code);
    this.toast.success(`Prices now shown in ${code}.`);
  }

  protected async signOut(): Promise<void> {
    const confirmed = await this.toast.confirm('Sign out of Amma Wears?');
    if (!confirmed) {
      return;
    }

    this.authService.logout();
    this.toast.info('Signed out');
    await this.shell.dismissKeyboard();
  }
}

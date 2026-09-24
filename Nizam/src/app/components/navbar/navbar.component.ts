import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { CartService } from '../../services/cart.service';
import { CurrencyService, CurrencyCode } from '../../services/currency.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive],
  templateUrl: './navbar.component.html',
  styleUrl: './navbar.component.css'
})
export class NavbarComponent {
  isMenuOpen = false;

  constructor(
    public cartService: CartService,
    private currency: CurrencyService,
    public auth: AuthService
  ) {}

  get currentCurrency(): CurrencyCode {
    return this.currency.getCurrency();
  }

  /**
   * True when a session exists. Read from the auth signal (not localStorage) so
   * the navbar re-renders the moment the shopper signs in or out.
   */
  get isLoggedIn(): boolean {
    return this.auth.user() !== null;
  }

  /** First name when known, otherwise the email; empty for anonymous visitors. */
  get greeting(): string {
    const user = this.auth.user();
    const name = user?.firstName || user?.email || '';
    return name ? `Hi, ${name}` : '';
  }

  changeCurrency(code: CurrencyCode) {
    this.currency.setCurrency(code);
  }

  toggleMenu() {
    this.isMenuOpen = !this.isMenuOpen;
  }

  closeMenu() {
    this.isMenuOpen = false;
  }

  /** Clears the session and returns to the login page (handled by AuthService). */
  signOut() {
    this.closeMenu();
    this.auth.logout();
  }
}

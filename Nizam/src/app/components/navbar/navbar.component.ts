import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { CartService } from '../../services/cart.service';
import { CurrencyService, CurrencyCode } from '../../services/currency.service';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive],
  templateUrl: './navbar.component.html',
  styleUrl: './navbar.component.css'
})
export class NavbarComponent {
  isMenuOpen = false;

  constructor(public cartService: CartService, private currency: CurrencyService) {}

  get currentCurrency(): CurrencyCode {
    return this.currency.getCurrency();
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
}

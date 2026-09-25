import { Injectable, signal } from '@angular/core';

export type CurrencyCode = 'USD' | 'INR' | 'AED' | 'SAR';

const CURRENCY_OVERRIDE_KEY = 'amma-wears-currency';

@Injectable({ providedIn: 'root' })
export class CurrencyService {
  // US storefront default. Product catalog prices are authored in USD; payment
  // providers still settle in their supported settlement currency.
  activeCurrency = signal<CurrencyCode>('USD');

  // Simple exchange rates relative to USD (1 USD = X target)
  // In a real app fetch rates from an API and cache them.
  private readonly rates: Record<CurrencyCode, number> = {
    USD: 1,
    INR: 95.21,
    AED: 3.67,
    SAR: 3.73
  };

  constructor() {
    this.restoreOverride();
    if (typeof navigator !== 'undefined') {
      void this.detectLocationCurrency();
    }
  }

  setCurrency(code: CurrencyCode) {
    this.activeCurrency.set(code);
    try {
      localStorage?.setItem(CURRENCY_OVERRIDE_KEY, code);
    } catch {
      // Storage is optional; the in-memory selection still works.
    }
  }

  /** Detects a sensible currency from the browser locale without blocking the app. */
  async detectLocationCurrency(): Promise<CurrencyCode> {
    const locale = typeof navigator !== 'undefined' ? navigator.language : 'en-US';
    const region = new Intl.Locale(locale).maximize().region ?? 'US';
    const detected = this.currencyForRegion(region);
    if (detected !== this.activeCurrency() && !this.hasStoredOverride()) {
      this.activeCurrency.set(detected);
    }
    return this.activeCurrency();
  }

  private currencyForRegion(region: string): CurrencyCode {
    switch (region.toUpperCase()) {
      case 'IN': return 'INR';
      case 'AE': return 'AED';
      case 'SA': return 'SAR';
      default: return 'USD';
    }
  }

  private hasStoredOverride(): boolean {
    try { return !!localStorage?.getItem(CURRENCY_OVERRIDE_KEY); } catch { return false; }
  }

  private restoreOverride(): void {
    try {
      const saved = localStorage?.getItem(CURRENCY_OVERRIDE_KEY) as CurrencyCode | null;
      if (saved && saved in this.rates) this.activeCurrency.set(saved);
    } catch {
      // Use the USD default when storage is unavailable.
    }
  }

  getCurrency() {
    return this.activeCurrency();
  }

  // Convert a USD amount to the active currency
  convertFromUSD(amountUsd: number): number {
    const code = this.getCurrency();
    const rate = this.rates[code] ?? 1;
    return amountUsd * rate;
  }

  // Return a formatted string with currency symbol
  format(amountUsd: number): string {
    const code = this.getCurrency();
    const value = this.convertFromUSD(amountUsd);
    switch (code) {
      case 'INR':
        return `₹${value.toFixed(2)}`;
      case 'AED':
        return `د.إ ${value.toFixed(2)}`;
      case 'SAR':
        return `﷼ ${value.toFixed(2)}`;
      default:
        return `$${value.toFixed(2)}`;
    }
  }

  // Return smallest currency unit multiplier for Stripe (e.g., 100 for USD/INR)
  getMinorUnitMultiplier(): number {
    // For most currencies it's 100 (cents/halalas/paise)
    return 100;
  }
}

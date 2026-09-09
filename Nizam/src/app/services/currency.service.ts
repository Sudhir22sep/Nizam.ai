import { Injectable, signal } from '@angular/core';

export type CurrencyCode = 'USD' | 'INR' | 'AED' | 'SAR';

@Injectable({ providedIn: 'root' })
export class CurrencyService {
  // Active currency signal
  activeCurrency = signal<CurrencyCode>('INR');

  // Simple exchange rates relative to USD (1 USD = X target)
  // In a real app fetch rates from an API and cache them.
  private rates: Record<CurrencyCode, number> = {
    USD: 1,
    INR: 95.21,
    AED: 3.67,
    SAR: 3.73
  };

  setCurrency(code: CurrencyCode) {
    this.activeCurrency.set(code);
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

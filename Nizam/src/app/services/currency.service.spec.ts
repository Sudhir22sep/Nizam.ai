import { TestBed } from '@angular/core/testing';
import { CurrencyService } from './currency.service';

describe('CurrencyService', () => {
  let service: CurrencyService;
  // The service derives the starting currency from the browser locale, so the
  // default is only "USD" for a US region. jsdom inherits whatever locale the
  // machine/CI runner has (this one resolves to SA -> SAR), which made this
  // assertion fail for reasons that have nothing to do with the default. Pin
  // the language so the test checks the documented default rather than the
  // environment's locale.
  const originalLanguage = navigator.language;

  beforeEach(() => {
    Object.defineProperty(navigator, 'language', { value: 'en-US', configurable: true });
    // The service also restores a currency the user picked earlier, which lives
    // in localStorage. Without this, whichever test calls setCurrency() first
    // leaves a stored override that the constructor picks up and the default
    // test then fails on -- an order dependency that only happens to pass
    // because the cases currently run top to bottom.
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [CurrencyService] });
    service = TestBed.inject(CurrencyService);
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'language', { value: originalLanguage, configurable: true });
  });

  it('should default to USD for the US storefront', () => {
    expect(service.getCurrency()).toBe('USD');
  });

  it('should convert USD to INR correctly', () => {
    service.setCurrency('INR');
    expect(service.convertFromUSD(1)).toBeCloseTo(95.21, 2);
    expect(service.format(1)).toBe('₹95.21');
  });

  it('should convert USD to AED correctly', () => {
    service.setCurrency('AED');
    expect(service.convertFromUSD(10)).toBeCloseTo(36.7, 2);
    expect(service.format(10)).toBe('د.إ 36.70');
  });

  it('should format USD correctly', () => {
    service.setCurrency('USD');
    expect(service.format(12.5)).toBe('$12.50');
  });

  it('should return 100 as minor unit multiplier', () => {
    expect(service.getMinorUnitMultiplier()).toBe(100);
  });
});

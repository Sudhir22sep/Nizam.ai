import { TestBed } from '@angular/core/testing';
import { CurrencyService } from './currency.service';

describe('CurrencyService', () => {
  let service: CurrencyService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [CurrencyService] });
    service = TestBed.inject(CurrencyService);
  });

  it('should default to INR', () => {
    expect(service.getCurrency()).toBe('INR');
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

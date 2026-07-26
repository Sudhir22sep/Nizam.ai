import { TestBed } from '@angular/core/testing';
import { CurrencyService } from '../services/currency.service';
import { PricePipe } from './price.pipe';

describe('PricePipe', () => {
  let service: CurrencyService;
  let pipe: PricePipe;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [CurrencyService] });
    service = TestBed.inject(CurrencyService);
    pipe = new PricePipe(service);
  });

  it('should format values in INR by default', () => {
    expect(pipe.transform(2)).toBe('₹190.42');
  });

  it('should format values in USD when currency is switched', () => {
    service.setCurrency('USD');
    expect(pipe.transform(2)).toBe('$2.00');
  });

  it('should format values in SAR when currency is switched', () => {
    service.setCurrency('SAR');
    expect(pipe.transform(3)).toBe('﷼ 11.19');
  });
});

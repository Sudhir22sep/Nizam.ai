import { Pipe, PipeTransform } from '@angular/core';
import { CurrencyService } from '../services/currency.service';

@Pipe({
  name: 'price',
  standalone: true
})
export class PricePipe implements PipeTransform {
  constructor(private currency: CurrencyService) {}

  transform(value: number): string {
    return this.currency.format(value);
  }
}

import { CompetitorPrice } from '../models/price-comparison.schema';

export interface BestPriceInfo {
  bestPrice: {
    source: string;
    price: number;
    originalPrice?: number;
    discountPercent?: number;
  };
  allPrices: CompetitorPrice[];
}

export function calculateBestPrice(comps: CompetitorPrice[]): BestPriceInfo {
  const best = comps.reduce((a, b) => (a.price < b.price ? a : b));
  return {
    bestPrice: {
      source: best.source,
      price: best.price,
      originalPrice: best.originalPrice,
      discountPercent: best.discountPercent,
    },
    allPrices: comps,
  };
}

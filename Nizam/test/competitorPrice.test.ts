import { describe, it, expect } from 'vitest';
import { calculateBestPrice, BestPriceInfo } from '../src/helpers/priceCalculator';
import { CompetitorPrice } from '../src/models/price-comparison.schema';

// Sample competitor price data for testing
const mockCompetitorPrices: CompetitorPrice[] = [
  {
    source: 'flipkart',
    sourceProductId: 'fp123',
    sourceProductUrl: 'https://flipkart.com/p123',
    price: 599,
    originalPrice: 699,
    discountPercent: 14,
    availability: 'in_stock',
    sellerName: 'Flipkart Seller',
    sellerRating: 4.5,
    deliveryDays: 3,
    lastUpdated: new Date('2024-09-01T10:00:00Z'),
    isActive: true,
  },
  {
    source: 'amazon',
    sourceProductId: 'amz456',
    sourceProductUrl: 'https://amazon.com/p456',
    price: 550,
    originalPrice: 580,
    discountPercent: 5,
    availability: 'in_stock',
    sellerName: 'Amazon Seller',
    sellerRating: 4.8,
    deliveryDays: 2,
    lastUpdated: new Date('2024-09-02T11:00:00Z'),
    isActive: true,
  },
  {
    source: 'myntra',
    sourceProductId: 'mn789',
    sourceProductUrl: 'https://myntra.com/p789',
    price: 540,
    originalPrice: 590,
    discountPercent: 8,
    availability: 'limited',
    sellerName: 'Myntra Seller',
    sellerRating: 4.2,
    deliveryDays: 5,
    lastUpdated: new Date('2024-09-03T12:00:00Z'),
    isActive: true,
  },
];

describe('calculateBestPrice', () => {
  it('should return the competitor with the lowest price', () => {
    const result: BestPriceInfo = calculateBestPrice(mockCompetitorPrices);
    expect(result.bestPrice?.source).toBe('myntra');
    expect(result.bestPrice?.price).toBe(540);
    // All prices should be returned
    expect(result.allPrices).toEqual(mockCompetitorPrices);
  });

  it('should handle empty array gracefully', () => {
    const result = calculateBestPrice([]);
    expect(result).toBeDefined();
  });
});

export interface CompetitorPrice {
  source: 'myntra' | 'flipkart' | 'amazon' | 'meesho' | 'ajio' | 'nykaa' | 'other';
  sourceProductId: string;
  sourceProductUrl: string;
  price: number;
  originalPrice?: number; // MRP/strikethrough price
  discountPercent?: number;
  availability: 'in_stock' | 'out_of_stock' | 'limited';
  sellerName?: string;
  sellerRating?: number;
  deliveryDays?: number;
  deliveryCharge?: number;
  lastUpdated: Date;
  isActive: boolean;
}

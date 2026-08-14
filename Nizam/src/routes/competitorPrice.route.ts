import { Router } from 'express';
import { authenticateJwt } from '../middleware/auth';
import { calculateBestPrice } from '../helpers/priceCalculator';
import { ApiPartner } from '../models/apiPartner.schema';
import { Types } from 'mongoose';
import { getPriceComparisonsCollection } from '../server';

const router = Router();

/**
 * GET /api/competitor-price/compare
 * Query: productId (ObjectId)
 * Returns best price + all competitor prices.
 */
router.get('/compare', authenticateJwt, async (req, res) => {
  try {
    const { productId } = req.query;
    if (!productId || !(productId instanceof String) || !Types.ObjectId.isValid(productId as string)) {
      return res.status(400).json({ success: false, message: 'productId is required and must be a valid ObjectId.' });
    }

    const collection = await getPriceComparisonsCollection();
    const comps = await (collection.find({ ammawearsProductId: productId }) as any).lean();

    if (!comps?.length) {
      return res.status(404).json({ success: false, message: 'No competitor data found.' });
    }

    const result = calculateBestPrice(comps);
    return res.json({ success: true, productId, ...result });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * POST /api/competitor-price/submit
 * Body: { productId, source, price, originalPrice?, discountPercent?, url?, availability?, deliveryDays? }
 * Header: x-api-key (partner API key)
 * Returns commissionEarned flag.
 */
router.post('/submit', async (req, res) => {
  try {
    const { productId, source, price, originalPrice, discountPercent, url, availability, deliveryDays } = req.body;
    const apiKey = req.headers['x-api-key'];

    if (!productId || !source || price == null) {
      return res.status(400).json({ success: false, message: 'Missing required fields.' });
    }
    if (!Types.ObjectId.isValid(productId)) {
      return res.status(400).json({ success: false, message: 'Invalid productId.' });
    }
    if (!apiKey) {
      return res.status(401).json({ success: false, message: 'API key required.' });
    }

    const partner = await ApiPartner.findOne({ apiKey: apiKey?.toString() });
    if (!partner || !partner.isActive) {
      return res.status(401).json({ success: false, message: 'Invalid API key.' });
    }

    const collection = await getPriceComparisonsCollection();

    const newEntry = {
      source,
      price: Number(price),
      originalPrice: originalPrice ? Number(originalPrice) : undefined,
      discountPercent: discountPercent !== undefined ? Number(discountPercent) : undefined,
      sourceProductUrl: url,
      availability,
      deliveryDays: deliveryDays ? Number(deliveryDays) : undefined,
      lastUpdated: new Date(),
      isActive: true,
    };

    let commissionEarned = 0;

    const existing = await collection.findOne({ ammawearsProductId: productId, 'competitorPrices.source': source });

    if (!existing) {
      await (collection as any).updateOne({ ammawearsProductId: productId }, { $push: { competitorPrices: newEntry } });
    } else {
      const idx = existing.competitorPrices.findIndex((p: any) => p.source === source);
      const currentBest = Math.min(...existing.competitorPrices.map((p: any) => p.price));
      if (price < currentBest) commissionEarned = 1;

      if (idx >= 0) {
        (collection as any).updateOne(
          { ammawearsProductId: productId, 'competitorPrices.source': source },
          { $set: { 'competitorPrices.$': newEntry } }
        );
      } else {
        await (collection as any).updateOne({ ammawearsProductId: productId, 'competitorPrices.source': source }, { $set: { 'competitorPrices.$': newEntry } });
      }
    }

    return res.json({ success: true, message: 'Price recorded', commissionEarned });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
});


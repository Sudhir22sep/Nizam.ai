import { describe, it, expect } from 'vitest';
import request from 'supertest';
import router from '../src/routes/competitorPrice.route';

describe('Competitor Price API', () => {
  it('GET /compare should return 400 when productId is missing', async () => {
    const res = await request(router).get('/compare');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('productId is required');
  });

  it('GET /compare with invalid productId should return 400', async () => {
    const res = await request(router).get('/compare?productId=invalid');
    expect(res.status).toBe(400);
  });

  it('GET /compare with valid productId should return 200', async () => {
    const res = await request(router).get('/compare?productId=651f2345c3b1a2d5e8f9a0b1');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('POST /submit should return 401 when x-api-key header is missing', async () => {
    const res = await request(router).post('/submit').send({
      productId: '651f2345c3b1a2d5e8f9a0b1',
      source: 'flipkart',
      price: 499,
    });
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('API key required');
  });

  it('POST /submit with valid payload should return success', async () => {
    const res = await request(router)
      .post('/submit')
      .set('x-api-key', 'test-key')
      .send({
        productId: '651f2345c3b1a2d5e8f9a0b1',
        source: 'flipkart',
        price: 499,
        originalPrice: 599,
        url: 'https://flipkart.com/product/123',
        availability: 'in_stock',
        deliveryDays: 2,
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain('Competitor price recorded');
    expect(res.body.commissionEarned).toBeDefined();
  });
});
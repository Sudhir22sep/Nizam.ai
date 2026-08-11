# Payment & Dropshipping Guide for Nizam.ai

## 1️⃣ Razorpay Payments on Localhost – Why They Fail & How to Fix

| Problem | Reason | Solution |
|---------|--------|----------|
| Razorpay cannot reach `localhost` | Razorpay’s servers POST webhooks to a public URL. `http://localhost:4000/...` is not reachable from the internet. | Expose your local server with a tunneling service (ngrok, cloudflared, localtunnel). |
| Using live keys while testing locally | Live keys only work with real money; test mode uses fake card numbers. | Switch to **test** keys (`RAZORPAY_TEST_KEY_ID`, `RAZORPAY_TEST_KEY_SECRET`) in `.env`. |
| Webhook signature verification fails | The secret in `.env` must match the secret Razorpay uses to sign the webhook. | Ensure `RAZORPAY_KEY_SECRET` (or `RAZORPAY_WEBHOOK_SECRET`) equals the secret shown in Razorpay Dashboard → Settings → API Keys (test or live). |
| Missing `express.raw()` middleware | The webhook route needs the raw body to compute HMAC; `express.json()` would corrupt it. | The code already has:<br>`app.use('/api/razorpay-webhook', express.raw({ type: 'application/json' }));` Keep it before any `express.json()` for that route. |

### Step‑by‑Step Local Test

1. **Add test keys to `.env`** (replace with your own):
   ```env
   RAZORPAY_TEST_KEY_ID=rzp_test_XXXXXXXXXXXXXX
   RAZORPAY_TEST_KEY_SECRET=your_test_secret
   RAZORPAY_WEBHOOK_SECRET=your_test_secret   # same as above
   ```

2. **Start the server** (ensure it listens on port 4000):
   ```bash
   npm run dev   # or however you start server.ts
   ```

3. **Run a tunnel** (ngrok example):
   ```bash
   ngrok http 4000
4. **Configure webhook in Razorpay Dashboard**
   - Settings → Webhooks → Add Webhook
   - URL: `https://abcd1234.ngrok.io/api/razorpay-webhook`
   - Secret: paste the same secret from `.env` (`RAZORPAY_TEST_KEY_SECRET`)
   - Enable event: `payment.captured` (also `payment.failed` if desired).

5. **Test a payment**
   - Use Razorpay test card numbers (e.g., `4111 1111 1111 1111`, any future expiry, any 3‑digit CVV).
   - After payment, Razorpay POSTs to your ngrok URL → your local `/api/razorpay-webhook` updates the order to `paid`.
6. **Verify order status** (requires JWT):
   ```bash
   TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email":"test@example.com","password":"password123"}' | jq -r .token)

   curl -s -H "Authorization: Bearer $TOKEN" \
     http://localhost:4000/api/orders/ORDER-$(date +%s) | jq .
   ```
   Look for `"status":"paid"` and the `razorpayPaymentId`/`razorpayOrderId` fields.

7. **Go live**
   - Replace test keys with live ones in `.env`.
   - Deploy server to a public host (Vercel, Railway, Render, Docker on VPS, etc.).
   - Update webhook URL in Razorpay Dashboard to your production HTTPS endpoint (must have a valid TLS certificate).

## 2️⃣ Automating Dropshipping

You can either **use a ready‑made SaaS platform** (Shopify + Oberlo/DSers, WooCommerce + AliDropship, etc.) **or extend your existing Node/Express backend**. Below is a lightweight way to add dropshipping automation to the current codebase.

### A. Product Import (Cron Job)

Create a script `scripts/import-products.js` that runs daily (via `node-cron` or Linux `cron`).

```javascript
// scripts/import-products.js
const { MongoClient } = require('mongodb');
const axios = require('axios');
require('dotenv').config();

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/nizam_ai';
const SUPPLIER_FEED_URL = process.env.SUPPLIER_FEED_URL; // CSV/JSON/XML endpoint

async function importProducts() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db();
  const collection = db.collection('products');

  const { data } = await axios.get(SUPPLIER_FEED_URL);
  // Assume data is an array of product objects; adapt mapping as needed
  const products = data.map(p => ({
    sku: p.sku,
    name: p.title,
    description: p.description,
    price: Number(p.price),
    images: p.images || [],
    category: p.category,
    supplierId: p.id,
    fulfillmentMethod: 'dropship',
    updatedAt: new Date()
  }));

  for (const prod of products) {
    await collection.updateOne(
      { sku: prod.sku },
      { $set: prod, $setOnInsert: { createdAt: new Date() } },
      { upsert: true }
    );
  }
  console.log(`Imported/updated ${products.length} products`);
  await client.close();
}

importProducts().catch(console.error);
```

Add to `crontab` (runs at 2 AM daily):
```
0 2 * * * /usr/bin/node /path/to/Nizam.ai/scripts/import-products.js >> /var/log/product-import.log 2>&1
```
### B. Order Routing After Payment Confirmation

After a Razorpay payment is confirmed (via `/api/confirm-razorpay-payment` or webhook), instead of just setting status to `paid`, also place the order with the supplier.

Pseudo‑code to add inside the payment‑success block (both confirm endpoint and webhook):

```javascript
// after setting status: 'paid'
// 1️⃣ Call supplier order API
const supplierResponse = await axios.post(
  process.env.SUPPLIER_ORDER_API_URL,
  {
    orderReference: orderReference,
    shippingAddress: order.address,
    items: order.items.map(i => ({
      sku: i.product.sku, // or supplier‑specific ID
      quantity: i.quantity
    }))
  },
  { headers: { Authorization: `Bearer ${process.env.SUPPLIER_API_KEY}` } }
);

// 2️⃣ Store supplier reference & tracking URL (if provided)
await ordersCollection.updateOne(
  { orderReference },
  {
    $set: {
      supplierOrderId: supplierResponse.data.order_id,
      supplierTrackingUrl: supplierResponse.data.tracking_url,
      status: 'processing' // or 'fulfilled' if supplier ships instantly
    }
  }
);
```

### C. Tracking / Status Updates

**Option 1 – Polling (cron)**: Every hour run a script that:
- Finds orders where `status` is `processing` and `supplierOrderId` exists.
- Calls the supplier’s tracking API (or checks a tracking page) to get latest status & tracking number.
- Updates the order: `trackingNumber`, `estimatedDelivery`, and if delivered → `status: "delivered"`.

**Option 2 – Webhook**: If the supplier offers a webhook for order/shipping updates, expose an endpoint like `/api/supplier-webhook` (similar to Razorpay) and update the order when the POST arrives.

### D. Customer Notifications

Use your existing email service (AWS SES) or a transactional email provider (SendGrid, Mailgun, Postmark) to send:
- Order confirmation (already done).
- “Your item has shipped” email with tracking number (triggered when tracking update arrives).
- Delivery confirmation.
### E. Error Handling & Retries

- Log every supplier API call.
- If the supplier returns an error (out of stock, payment failure), move the order to `requires_manual_review` and notify the store owner via email or Slack.
- Implement exponential back‑off for retries.

### F. Low‑Code Alternatives (if you prefer less custom code)

- **Zapier / Make (Integromat)**: Connect your MongoDB (via a REST wrapper or using a service like Hasura/Strapi as a thin API layer) to supplier apps (Shopify, WooCommerce, AliExpress, etc.) to automatically push orders and pull tracking.
- **Apilio / Tray.io**: More advanced enterprise‑grade automation for complex branching.
- **Custom middleware**: Write a small Express router that receives webhooks from multiple suppliers and normalizes the payload into your order model.

### Where to Buy a Ready‑Made Dropshipping Platform (Shopify‑like)

If you don’t want to build/maintain the automation yourself, consider one of these all‑in‑one solutions:

| Platform | What It Provides | Approx. Monthly Cost |
|----------|------------------|----------------------|
| **Shopify + Oberlo / DSers / Spocket** | Storefront, SSL, payment gateways, one‑click product import, auto‑fulfillment, inventory & price sync, tracking emails. | Shopify Basic $29 + app fees (Oberlo free‑tier, DSers ~$19.90/mo) |
| **WooCommerce (WordPress) + AliDropship / WooDropship** | Free core (WooCommerce) + paid plugins for product import & order automation. | Hosting $5‑$30/mo + plugins $49‑$99 one‑time or $15‑$30/mo |
| **BigCommerce + Inventory Source / Dropified** | Built‑in B2B & wholesale features, automation for product feed & order routing. | $29.95/mo + app fees |
| **Magento (Adobe Commerce) + Drop‑ship extensions** | Enterprise‑grade, highly customizable, powerful API for custom automation. | Free Open Source (hosting + dev cost) or Commerce ~$22k/yr |

**Typical starter budget for a fully automated dropshipping store:** ~$50‑$70/mo (Shopify Basic + DSers + domain + basic email marketing).

---

### Quick Checklist for You Right Now

1. **Fix Razorpay on localhost**
   - Switch to test keys in `.env`.
   - Run `ngrok http 4000` (or your actual port).
   - Set webhook URL to `https://<subdomain>.ngrok.io/api/razorpay-webhook`.
   - Test with Razorpay test card numbers.
   - Verify order status updates via `/api/orders` (auth required).

2. **Confirm the flow works**
   - Order created → status `created`.
   - Webhook received → status `paid`, `razorpayPaymentId` & `razorpayOrderId` filled.

3. **Add dropshipping automation (if desired)**
   - Decide: use a SaaS platform (Shopify, WooCommerce) **or** extend your Node backend.
   - If extending: add product import cron, supplier order API call after payment, tracking webhook/poll, and customer email updates.

4. **Deploy to production when ready**
   - Move to live Razorpay keys.
   - Deploy server to a public host (Vercel, Railway, Render, AWS Elastic Beanstalk, Docker on VPS, etc.).
   - Update webhook URL in Razorpay Dashboard to your production HTTPS URL.

---

*Last Updated: August 5, 2026*  
*Based on debugging session for Nizam.ai payment system*
   ```
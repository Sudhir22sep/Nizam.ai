import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { join } from 'node:path';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import Stripe from 'stripe';
import { promises as fs } from 'fs';

const dataDir = join(import.meta.dirname, '../data');
const ordersFile = join(dataDir, 'orders.json');

const stripeSecret = process.env['STRIPE_SECRET_KEY'];
const stripe = stripeSecret ? new Stripe(stripeSecret, { apiVersion: '2022-11-15' }) : null;
const appUrl = process.env['APP_URL'] || 'http://localhost:4200';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine();

const sesRegion = process.env['SES_REGION'];
const sesClient = sesRegion ? new SESClient({ region: sesRegion }) : null;
const verifiedSender = process.env['SES_VERIFIED_SENDER'] || 'hello@ganeshacollections.com';

app.use(express.json());

async function ensureDataDir() {
  try {
    await fs.mkdir(dataDir, { recursive: true });
    try {
      await fs.access(ordersFile);
    } catch {
      await fs.writeFile(ordersFile, JSON.stringify([]));
    }
  } catch (e) {
    console.error('Failed to ensure data dir', e);
  }
}

async function readOrders() {
  await ensureDataDir();
  const raw = await fs.readFile(ordersFile, 'utf-8');
  return JSON.parse(raw || '[]');
}

async function writeOrders(orders: any[]) {
  await ensureDataDir();
  await fs.writeFile(ordersFile, JSON.stringify(orders, null, 2));
}

async function sendEmail(params: { to: string | string[]; subject: string; text: string; html: string }) {
  const { to, subject, text, html } = params;
  if (!sesClient) {
    throw new Error('SES_REGION is not configured. Set SES_REGION in the environment.');
  }

  const destination = {
    ToAddresses: Array.isArray(to) ? to : [to],
  };

  const command = new SendEmailCommand({
    Source: verifiedSender,
    Destination: destination,
    ReplyToAddresses: [verifiedSender],
    Message: {
      Subject: { Data: subject },
      Body: {
        Text: { Data: text },
        Html: { Data: html },
      },
    },
  });

  return sesClient.send(command);
}

function buildContactMessage(params: { name: string; email: string; message: string }) {
  const { name, email, message } = params;
  return {
    subject: `New contact request from ${name}`,
    text: `New contact request:\n\nName: ${name}\nEmail: ${email}\nMessage:\n${message}`,
    html: `<p><strong>Name:</strong> ${name}</p><p><strong>Email:</strong> ${email}</p><p><strong>Message:</strong></p><p>${message}</p>`,
  };
}

function buildOrderConfirmationMessage(params: {
  name: string;
  email: string;
  items: Array<{ product: { name: string; price: number }; quantity: number }>;
  total: number;
  orderReference: string;
}) {
  const { name, email, items, total, orderReference } = params;
  const itemRows = items.map((item) => `
    <tr>
      <td>${item.product.name}</td>
      <td>${item.quantity}</td>
      <td>$${item.product.price.toFixed(2)}</td>
      <td>$${(item.product.price * item.quantity).toFixed(2)}</td>
    </tr>
  `).join('');

  const itemText = items.map((item) => `${item.quantity} x ${item.product.name} @ $${item.product.price.toFixed(2)} = $${(item.product.price * item.quantity).toFixed(2)}`).join('\n');

  return {
    subject: `Order confirmation — ${orderReference}`,
    text: `Thank you for your order, ${name}!\n\nOrder reference: ${orderReference}\n\nItems:\n${itemText}\n\nTotal: $${total.toFixed(2)}\n\nWe will ship to:\n${email}`,
    html: `<p>Thank you for your order, <strong>${name}</strong>!</p>
      <p>Order reference: <strong>${orderReference}</strong></p>
      <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse; width:100%;">
        <thead>
          <tr>
            <th align="left">Item</th>
            <th align="right">Qty</th>
            <th align="right">Price</th>
            <th align="right">Total</th>
          </tr>
        </thead>
        <tbody>
          ${itemRows}
        </tbody>
      </table>
      <p><strong>Total: $${total.toFixed(2)}</strong></p>
      <p>We will ship your order shortly.</p>`,
  };
}

app.post('/api/contact', async (req, res) => {
  const { name, email, message } = req.body;

  if (!name || !email || !message) {
    return res.status(400).json({ success: false, message: 'Name, email, and message are required.' });
  }

  try {
    const mail = buildContactMessage({ name, email, message });
    await sendEmail({
      to: verifiedSender,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });

    return res.status(200).json({ success: true, message: 'Contact message sent successfully.' });
  } catch (error) {
    console.error('Failed to send contact email:', error);
    return res.status(500).json({ success: false, message: 'Unable to send contact email.' });
  }
});

app.post('/api/order-confirmation', async (req, res) => {
  const { name, email, items, total } = req.body;

  if (!name || !email || !Array.isArray(items) || typeof total !== 'number') {
    return res.status(400).json({ success: false, message: 'Name, email, items, and total are required.' });
  }

  const orderReference = `ORDER-${Date.now()}`;

  try {
    // persist order
    const orders = await readOrders();
    const order = { orderReference, name, email, items, total, status: 'created', createdAt: new Date().toISOString() };
    orders.push(order);
    await writeOrders(orders);

    const mail = buildOrderConfirmationMessage({ name, email, items, total, orderReference });
    await sendEmail({
      to: email,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });

    return res.status(200).json({ success: true, orderReference, message: 'Order confirmation sent successfully.' });
  } catch (error) {
    console.error('Failed to send order confirmation email:', error);
    return res.status(500).json({ success: false, message: 'Unable to send order confirmation email.' });
  }
});

// Create a Stripe Checkout session and persist the order as pending
app.post('/api/create-checkout-session', async (req, res) => {
  if (!stripe) {
    return res.status(500).json({ success: false, message: 'Stripe is not configured.' });
  }

  const { name, email, address, items, total } = req.body;
  if (!name || !email || !Array.isArray(items) || typeof total !== 'number') {
    return res.status(400).json({ success: false, message: 'Name, email, items, and total are required.' });
  }

  const orderReference = `ORDER-${Date.now()}`;

  try {
    // persist order as pending
    const orders = await readOrders();
    const order = { orderReference, name, email, address, items, total, status: 'pending', createdAt: new Date().toISOString() };
    orders.push(order);
    await writeOrders(orders);

    // build line items for Stripe
    const line_items = items.map((it: any) => ({
      price_data: {
        currency: 'usd',
        product_data: { name: it.product.name },
        unit_amount: Math.round(it.product.price * 100),
      },
      quantity: it.quantity,
    }));

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items,
      success_url: `${appUrl}/checkout-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/checkout?canceled=true`,
      metadata: { orderReference },
      customer_email: email,
    });

    return res.status(200).json({ success: true, url: session.url });
  } catch (err) {
    console.error('create-checkout-session error', err);
    return res.status(500).json({ success: false, message: 'Unable to create checkout session.' });
  }
});

// Confirm payment after redirect by retrieving session and updating order
app.post('/api/confirm-payment', async (req, res) => {
  if (!stripe) {
    return res.status(500).json({ success: false, message: 'Stripe is not configured.' });
  }

  const { sessionId } = req.body;
  if (!sessionId) {
    return res.status(400).json({ success: false, message: 'sessionId is required.' });
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['payment_intent'] });
    const paid = String((session as any).payment_status) === 'paid';
    const orderReference = (session as any).metadata?.['orderReference'] || '';

    const orders = await readOrders();
    const order = orders.find((o: any) => o.orderReference === orderReference);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });

    if (paid) {
      order.status = 'paid';
      order.paymentIntent = session.payment_intent;
      await writeOrders(orders);

      // send confirmation email
      try {
        const mail = buildOrderConfirmationMessage({ name: order.name, email: order.email, items: order.items, total: order.total, orderReference });
        await sendEmail({ to: order.email, subject: mail.subject, text: mail.text, html: mail.html });
      } catch (e) {
        console.error('Failed to send post-payment confirmation email', e);
      }

      return res.status(200).json({ success: true, orderReference });
    }

    return res.status(400).json({ success: false, message: 'Payment not completed.' });
  } catch (err) {
    console.error('confirm-payment error', err);
    return res.status(500).json({ success: false, message: 'Unable to confirm payment.' });
  }
});

/**
 * Example Express Rest API endpoints can be defined here.
 * Uncomment and define endpoints as necessary.
 *
 * Example:
 * ```ts
 * app.get('/api/{*splat}', (req, res) => {
 *   // Handle API request
 * });
 * ```
 */

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

/**
 * Handle all other requests by rendering the Angular application.
 */
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next(),
    )
    .catch(next);
});

/**
 * Start the server if this module is the main entry point, or it is ran via PM2.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, (error) => {
    if (error) {
      throw error;
    }

    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);

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
import { MongoClient, Db } from 'mongodb';

const mongoUrl = process.env['MONGODB_URI'] || 'mongodb://localhost:27017/nizam_ai';
let mongoClient: MongoClient | null = null;
let db: Db | null = null;

const stripeSecret = process.env['STRIPE_SECRET_KEY'];
const stripe = stripeSecret ? new Stripe(stripeSecret, { apiVersion: '2022-11-15' }) : null;
const appUrl = process.env['APP_URL'] || 'http://localhost:4200';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine();

const sesRegion = process.env['SES_REGION'];
const sesClient = sesRegion ? new SESClient({ region: sesRegion }) : null;
const verifiedSender = process.env['SES_VERIFIED_SENDER'] || 'sudhir.22sep@gmail.com';

// parse JSON bodies for most routes
app.use(express.json());

// Simple server-side currency rates (relative to USD)
const serverRates: Record<string, number> = {
  USD: 1,
  INR: 82.5,
  AED: 3.67,
  SAR: 3.75,
};

function formatCurrency(amount: number, currency = 'USD') {
  const symbol = currency === 'INR' ? '₹' : currency === 'AED' ? 'د.إ ' : currency === 'SAR' ? '﷼ ' : '$';
  return `${symbol}${amount.toFixed(2)}`;
}

// Initialize MongoDB connection
async function initializeMongoDB() {
  try {
    mongoClient = new MongoClient(mongoUrl);
    await mongoClient.connect();
    db = mongoClient.db();
    
    // Create indexes for better performance
    const ordersCollection = db.collection('orders');
    const usersCollection = db.collection('users');
    const contactsCollection = db.collection('contacts');
    
    await ordersCollection.createIndex({ orderReference: 1 }, { unique: true });
    await ordersCollection.createIndex({ email: 1 });
    await usersCollection.createIndex({ email: 1 }, { unique: true });
    await contactsCollection.createIndex({ email: 1 });
    
    console.log('MongoDB connected successfully');
  } catch (error) {
    console.error('Failed to connect to MongoDB:', error);
    process.exit(1);
  }
}

// Get or create orders collection
async function getOrdersCollection() {
  if (!db) {
    throw new Error('MongoDB not initialized');
  }
  return db.collection('orders');
}

// Get or create users collection
async function getUsersCollection() {
  if (!db) {
    throw new Error('MongoDB not initialized');
  }
  return db.collection('users');
}

// Get or create contacts collection
async function getContactsCollection() {
  if (!db) {
    throw new Error('MongoDB not initialized');
  }
  return db.collection('contacts');
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
  paymentMethod?: string;
}) {
  const { name, email, items, total, orderReference, paymentMethod } = params;
  const methodLabel = paymentMethod === 'COD' ? 'Cash on Delivery (COD)' : 'Card payment';
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
    text: `Thank you for your order, ${name}!\n\nOrder reference: ${orderReference}\nPayment method: ${methodLabel}\n\nItems:\n${itemText}\n\nTotal: $${total.toFixed(2)}\n\nWe will ship to:\n${email}\n\nFor dropshipping or wholesale inquiries, email sudhir.22sep@gmail.com.`,
    html: `<p>Thank you for your order, <strong>${name}</strong>!</p>
      <p>Order reference: <strong>${orderReference}</strong></p>
      <p>Payment method: <strong>${methodLabel}</strong></p>
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
      <p>We will ship your order shortly.</p>
      <p>For dropshipping or wholesale inquiries, email <strong>sudhir.22sep@gmail.com</strong>.</p>`,
  };
}

async function trySendEmail(params: { to: string | string[]; subject: string; text: string; html: string }) {
  try {
    await sendEmail(params);
    return true;
  } catch (error) {
    console.warn('Email not sent:', error instanceof Error ? error.message : error);
    return false;
  }
}

app.post('/api/contact', async (req, res) => {
  const { name, email, message } = req.body;

  if (!name || !email || !message) {
    return res.status(400).json({ success: false, message: 'Name, email, and message are required.' });
  }

  try {
    const contactsCollection = await getContactsCollection();
    
    const contact = {
      name,
      email,
      message,
      createdAt: new Date(),
    };
    
    await contactsCollection.insertOne(contact);

    const mail = buildContactMessage({ name, email, message });
    const sent = await trySendEmail({
      to: verifiedSender,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });

    return res.status(200).json({ success: true, message: sent ? 'Contact message sent successfully.' : 'Contact message received. Email service is not configured, but we have recorded your request.' });
  } catch (error) {
    console.error('Failed to handle contact submission:', error);
    return res.status(500).json({ success: false, message: 'Unable to send your contact message at this time.' });
  }
});

// Save user profile/account data
app.post('/api/save-user', async (req, res) => {
  const { name, email, phone, address } = req.body;

  if (!name || !email) {
    return res.status(400).json({ success: false, message: 'Name and email are required.' });
  }

  try {
    const usersCollection = await getUsersCollection();

    // Check if user already exists
    const existingUser = await usersCollection.findOne({ email });
    if (existingUser) {
      // Update existing user
      await usersCollection.updateOne(
        { email },
        {
          $set: {
            name,
            phone: phone || (existingUser as any).phone,
            address: address || (existingUser as any).address,
            updatedAt: new Date(),
          },
        }
      );
      return res.status(200).json({ success: true, userId: (existingUser as any)._id, message: 'User profile updated successfully.' });
    }

    // Create new user
    const user = {
      name,
      email,
      phone: phone || '',
      address: address || '',
      createdAt: new Date(),
    };

    const result = await usersCollection.insertOne(user);
    return res.status(200).json({ success: true, userId: result.insertedId, message: 'User profile saved successfully.' });
  } catch (error) {
    console.error('Failed to save user:', error);
    return res.status(500).json({ success: false, message: 'Unable to save user data.' });
  }
});

app.post('/api/order-confirmation', async (req, res) => {
  const { name, email, items, total, paymentMethod } = req.body;

  if (!name || !email || !Array.isArray(items) || typeof total !== 'number') {
    return res.status(400).json({ success: false, message: 'Name, email, items, and total are required.' });
  }

  const orderReference = `ORDER-${Date.now()}`;

  try {
    const ordersCollection = await getOrdersCollection();
    
    const order = { 
      orderReference, 
      name, 
      email, 
      items, 
      total, 
      paymentMethod: paymentMethod || 'CARD', 
      status: 'created', 
      createdAt: new Date() 
    };
    
    await ordersCollection.insertOne(order);

    const mail = buildOrderConfirmationMessage({ name, email, items, total, orderReference, paymentMethod: order.paymentMethod });
    const sent = await trySendEmail({
      to: email,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });

    return res.status(200).json({ success: true, orderReference, message: sent ? 'Order confirmation sent successfully.' : 'Order recorded successfully. Email service not configured.' });
  } catch (error) {
    console.error('Failed to send order confirmation email:', error);
    return res.status(500).json({ success: false, message: 'Unable to record order at this time.' });
  }
});

// Create a Stripe Checkout session and persist the order as pending
app.post('/api/create-checkout-session', async (req, res) => {
  if (!stripe) {
    return res.status(500).json({ success: false, message: 'Stripe is not configured.' });
  }

  const { name, email, address, items, total, currency } = req.body;
  if (!name || !email || !Array.isArray(items) || typeof total !== 'number') {
    return res.status(400).json({ success: false, message: 'Name, email, items, and total are required.' });
  }

  const orderReference = `ORDER-${Date.now()}`;

  try {
    const ordersCollection = await getOrdersCollection();
    
    // persist order as pending
    const order = { 
      orderReference, 
      name, 
      email, 
      address, 
      items, 
      total, 
      currency: currency || 'USD', 
      paymentMethod: 'CARD', 
      status: 'pending', 
      createdAt: new Date() 
    };
    
    await ordersCollection.insertOne(order);

    // build line items for Stripe
    const targetCurrency = (currency || 'USD').toUpperCase();
    const rate = serverRates[targetCurrency] ?? 1;
    const minor = 100; // cents/paise

    const line_items = items.map((it: any) => ({
      price_data: {
        currency: targetCurrency.toLowerCase(),
        product_data: { name: it.product.name },
        unit_amount: Math.round(it.product.price * rate * minor),
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

app.post('/api/create-cod-order', async (req, res) => {
  const { name, email, address, items, total, currency } = req.body;
  if (!name || !email || !Array.isArray(items) || typeof total !== 'number') {
    return res.status(400).json({ success: false, message: 'Name, email, items, and total are required.' });
  }

  const orderReference = `ORDER-${Date.now()}`;

  try {
    const ordersCollection = await getOrdersCollection();
    
    const order = { 
      orderReference, 
      name, 
      email, 
      address, 
      items, 
      total, 
      currency: currency || 'USD', 
      paymentMethod: 'COD', 
      status: 'pending', 
      createdAt: new Date() 
    };
    
    await ordersCollection.insertOne(order);

    const mail = buildOrderConfirmationMessage({ name, email, items, total, orderReference, paymentMethod: 'COD' });
    const sent = await trySendEmail({
      to: email,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });

    return res.status(200).json({ success: true, orderReference, message: sent ? 'Order placed with COD. Confirmation email sent.' : 'Order placed with COD. Email service is not configured.' });
  } catch (err) {
    console.error('create-cod-order error', err);
    return res.status(500).json({ success: false, message: 'Unable to place COD order.' });
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
    const ordersCollection = await getOrdersCollection();
    
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['payment_intent'] });
    const paid = String((session as any).payment_status) === 'paid';
    const orderReference = (session as any).metadata?.['orderReference'] || '';

    const order = await ordersCollection.findOne({ orderReference });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });

    if (paid) {
      await ordersCollection.updateOne(
        { orderReference },
        {
          $set: {
            status: 'paid',
            paymentIntent: session.payment_intent,
          },
        }
      );

      // send confirmation email
      try {
        const mail = buildOrderConfirmationMessage({ name: (order as any).name, email: (order as any).email, items: (order as any).items, total: (order as any).total, orderReference });
        await sendEmail({ to: (order as any).email, subject: mail.subject, text: mail.text, html: mail.html });
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

// Stripe webhook endpoint (optional signature verification)
app.post('/webhook/stripe', async (req, res) => {
  if (!stripe) {
    return res.status(500).send('Stripe not configured');
  }

  const event = req.body;

  try {
    const ordersCollection = await getOrdersCollection();
    
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const orderReference = session.metadata?.orderReference || '';

      const order = await ordersCollection.findOne({ orderReference });
      if (order) {
        await ordersCollection.updateOne(
          { orderReference },
          {
            $set: {
              status: 'paid',
              paymentIntent: session.payment_intent || session.payment_intent_id || null,
            },
          }
        );

        // send confirmation email (best-effort)
        try {
          const mail = buildOrderConfirmationMessage({ name: (order as any).name, email: (order as any).email, items: (order as any).items, total: (order as any).total, orderReference });
          await sendEmail({ to: (order as any).email, subject: mail.subject, text: mail.text, html: mail.html });
        } catch (e) {
          console.error('Failed to send webhook confirmation email', e);
        }
      }
    }

    return res.json({ received: true });
  } catch (e) {
    console.error('webhook processing error', e);
    return res.status(500).send('Webhook processing error');
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
  
  // Initialize MongoDB before starting the server
  initializeMongoDB().then(() => {
    app.listen(port, (error) => {
      if (error) {
        throw error;
      }

      console.log(`Node Express server listening on http://localhost:${port}`);
    });
  }).catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);

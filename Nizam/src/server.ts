import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import cors from 'cors';
import { join, resolve } from 'node:path';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import Razorpay from 'razorpay';
//import Stripe from 'stripe';
import { MongoClient, Db, WithId } from "mongodb";
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import dotenv from 'dotenv';
import { dirname } from 'node:path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
console.log('__dirname:', __dirname);
console.log('process.cwd():', process.cwd());

// Prevent process exit on unhandled rejections (common with MongoDB in local dev)
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit in development
  if (process.env['NODE_ENV'] !== 'production') {
    console.warn('Continuing despite unhandled rejection (development mode)');
  }
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  if (process.env['NODE_ENV'] !== 'production') {
    console.warn('Continuing despite uncaught exception (development mode)');
  }
});

const browserDistFolder = join(__dirname, '../browser');
console.log('browserDistFolder:', browserDistFolder);
console.log('Does browserDistFolder exist?', existsSync(browserDistFolder));
console.log('Does index.csr.html exist?', existsSync(join(browserDistFolder, 'index.csr.html')));
dotenv.config({ path: resolve(process.cwd(), '.env'), override: true });

const mongoUrl = process.env['MONGODB_URI'] || 'mongodb://localhost:27017/nizam_ai';
console.log("MONGODB_URI from process.env:", process.env['MONGODB_URI']);
let mongoClient: MongoClient | null = null;
let db: Db | null = null;
// Order document type
interface OrderDocument {
  orderReference: string;
  name: string;
  email: string;
  address: string;
  items: Array<{ product: { name: string; price: number }; quantity: number }>;
  total: number;
  currency: string;
  paymentMethod: string;
  status: string;
  razorpayPaymentId?: string;
  razorpayOrderId?: string;
  createdAt: Date;
  updatedAt?: Date;
}

//const stripeSecret = process.env['environment'] === 'production' ? process.env['STRIPE_SECRET_KEY'] : process.env['STRIPE_TEST_SECRET_KEY'];
//const stripe = stripeSecret ? new Stripe(stripeSecret, { apiVersion: '2022-11-15' }) : null;

const razorpayKeyId = process.env['RAZORPAY_KEY_ID'] || process.env['RAZORPAY_TEST_KEY_ID'];
const razorpayKeySecret = process.env['RAZORPAY_KEY_SECRET'] || process.env['RAZORPAY_TEST_KEY_SECRET'];
const razorpay = razorpayKeyId && razorpayKeySecret
  ? new Razorpay({ key_id: razorpayKeyId, key_secret: razorpayKeySecret })
  : null;
console.log('RazorPay Key ID:', razorpayKeyId ? 'SET' : 'NOT SET');
// console.log('RazorPay Key Secret:', razorpayKeySecret ? 'SET' : 'NOT SET'); // Avoid logging secret
console.log('RazorPay instance:', razorpay ? 'CREATED' : 'NULL');

const appUrl = process.env['APP_URL'] || 'http://localhost:4200';

// Use import.meta.dirname directly - it will resolve correctly both in dev (src/) and production (dist/Nizam/server/)

const app = express();

// Lazy initialization of AngularNodeAppEngine to handle both dev and production
// In dev mode (Vite), we try to create the engine; if it fails, we fall back to CSR.
let angularApp: AngularNodeAppEngine | null = null;

function getAngularApp(): AngularNodeAppEngine | null {
  if (!angularApp) {
    try {
      // Try to create the engine. This will work in:
      // - Production: when the manifest exists (built with ng build)
      // - Development SSR mode (ng run <project>:serve-ssr): when the Angular CLI sets up the environment
      // It will fail in a pure client-side dev setup (ng serve) but we catch the error and fall back to CSR.
      angularApp = new AngularNodeAppEngine();
    } catch (error) {
      console.warn('AngularNodeAppEngine initialization failed:', error instanceof Error ? error.message : error);
      // Fall back to null to indicate SSR not available
      angularApp = null;
    }
  }
  return angularApp;
}

const sesRegion = process.env['SES_REGION'];
const sesClient = sesRegion ? new SESClient({ region: sesRegion }) : null;
const verifiedSender = process.env['SES_VERIFIED_SENDER'] || 'sudhir.22sep@gmail.com';

// parse JSON bodies for most routes
app.use(express.json());

// CORS configuration for Vercel frontend → Render backend
const corsOrigin = process.env['CORS_ORIGIN'] || 'http://localhost:4200';
// Allow localhost:4000 for local SSR development (same origin)
const allowedOrigins = corsOrigin.split(',').map(o => o.trim());
if (process.env['NODE_ENV'] !== 'production') {
  allowedOrigins.push('http://localhost:4000', 'http://localhost:4200', 'http://127.0.0.1:4000', 'http://127.0.0.1:4200');
}
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Global guard against invalid Express response objects (for Angular SSR route extraction)
// This must be the FIRST middleware after express.json() to catch issues early
app.use((req, res, next) => {
  // During Angular's route extraction (getRoutesFromAngularRouterConfig), 
  // the SSR engine may invoke the app with mock request/response objects
  // that don't have all Express response properties properly initialized.
  if (!res || typeof res !== 'object' || typeof res.headersSent !== 'boolean') {
    console.warn('Global guard: Invalid response object detected, skipping middleware chain');
    // Return early without calling next() to prevent downstream middleware
    // from accessing invalid response object properties
    return;
  }
  next();
});

// Simple server-side currency rates (relative to USD)
const serverRates: Record<string, number> = {
  USD: 1,
  INR: 95.21,
  AED: 3.67,
  SAR: 3.75,
};

let mongoInitPromise: Promise<void> | null = null;

function formatCurrency(amount: number, currency = 'USD') {
  const symbol = currency === 'INR' ? '₹' : currency === 'AED' ? 'د.إ ' : currency === 'SAR' ? '﷼ ' : '$';
  return `${symbol}${amount.toFixed(2)}`;
}

// Initialize MongoDB connection
async function initializeMongoDB(): Promise<void> {
  try {
    if (!mongoUrl) {
      throw new Error('MONGODB_URI environment variable is not set');
    }
    console.log('Connecting to MongoDB...', mongoUrl.replace(/\/\/[^:]+:[^@]+@/, '//***:***@'));
    // Shorter timeout for local dev, allow quick failure
    const isLocalDev = process.env['NODE_ENV'] !== 'production';
    mongoClient = new MongoClient(mongoUrl, { 
      serverSelectionTimeoutMS: isLocalDev ? 3000 : 10000,
      connectTimeoutMS: isLocalDev ? 3000 : 10000,
    });
    
    // Handle MongoDB client events to prevent unhandled rejections
    mongoClient.on('error', (err) => {
      console.error('MongoDB client error:', err.message);
    });
    
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
    console.error('MongoDB connection error details:', error instanceof Error ? error.message : String(error));
    console.error('Check MONGODB_URI environment variable and MongoDB Atlas IP whitelist');
    // Don't exit, just continue without DB
  }
}


function ensureMongoDBInitialized(): Promise<void> {
  if (!mongoInitPromise) {
    mongoInitPromise = initializeMongoDB().catch((error) => {
      console.error('MongoDB connection failed, continuing without database:', error.message);
      // Don't exit, just continue without DB
    });
  }

  return mongoInitPromise!;
}

// Get or create orders collection
async function getOrdersCollection() {
  await ensureMongoDBInitialized();

  if (!db) {
    throw new Error('MongoDB not connected');
  }
  return db.collection('orders');
}

// Get or create users collection
async function getUsersCollection() {
  await ensureMongoDBInitialized();

  if (!db) {
    throw new Error('MongoDB not connected');
  }
  return db.collection('users');
}

// Get or create contacts collection
async function getContactsCollection() {
  await ensureMongoDBInitialized();

  if (!db) {
    throw new Error('MongoDB not connected');
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
// DISABLED: Stripe not configured
// app.post('/api/create-checkout-session', async (req, res) => {
//   if (!stripe) {
//     return res.status(500).json({ success: false, message: 'Stripe is not configured.' });
//   }
//
//   const { name, email, address, items, total, currency } = req.body;
//   if (!name || !email || !Array.isArray(items) || typeof total !== 'number') {
//     return res.status(400).json({ success: false, message: 'Name, email, items, and total are required.' });
//   }
//
//   const orderReference = `ORDER-${Date.now()}`;
//
//   try {
//     const ordersCollection = await getOrdersCollection();
//
//     // persist order as pending
//     const order = {
//       orderReference,
//       name,
//       email,
//       address,
//       items,
//       total,
//       currency: currency || 'USD',
//       paymentMethod: 'CARD',
//       status: 'pending',
//       createdAt: new Date()
//     };
//
//     await ordersCollection.insertOne(order);
//
//     // build line items for Stripe
//     const targetCurrency = (currency || 'USD').toUpperCase();
//     const rate = serverRates[targetCurrency] ?? 1;
//     const minor = 100; // cents/paise
//
//     const line_items = items.map((it: any) => ({
//       price_data: {
//         currency: targetCurrency.toLowerCase(),
//         product_data: { name: it.product.name },
//         unit_amount: Math.round(it.product.price * rate * minor),
//       },
//       quantity: it.quantity,
//     }));
//
//     const session = await stripe.checkout.sessions.create({
//       payment_method_types: ['card'],
//       mode: 'payment',
//       line_items,
//       success_url: `${appUrl}/checkout-success?session_id={CHECKOUT_SESSION_ID}`,
//       cancel_url: `${appUrl}/checkout?canceled=true`,
//       metadata: { orderReference },
//       customer_email: email,
//     });
//
//     return res.status(200).json({ success: true, url: session.url });
//   } catch (err) {
//     console.error('create-checkout-session error', err);
//     return res.status(500).json({ success: false, message: 'Unable to create checkout session.' });
//   }
// });

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

// GET /api/orders - Get all orders (with pagination and filters)
app.get('/api/orders', async (req, res) => {
  try {
    const ordersCollection = await getOrdersCollection();
    const { email, status, paymentMethod, page = 1, limit = 20 } = req.query;

    const filter: any = {};
    if (email) filter.email = email;
    if (status) filter.status = status;
    if (paymentMethod) filter.paymentMethod = paymentMethod;

    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit)));
    const skip = (pageNum - 1) * limitNum;

    const orders = await ordersCollection
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .toArray();

    const total = await ordersCollection.countDocuments(filter);

    res.json({ success: true, orders, total, page: pageNum, limit: limitNum });
  } catch (err) {
    console.error('get orders error', err);
    res.status(500).json({ success: false, message: 'Failed to fetch orders' });
  }
});

// GET /api/orders/:orderReference - Get single order
app.get('/api/orders/:orderReference', async (req, res) => {
  try {
    const ordersCollection = await getOrdersCollection();
    const order = await ordersCollection.findOne<OrderDocument>({
      orderReference: req.params.orderReference
    });

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    return res.json({ success: true, order });
  } catch (err) {
    console.error('get order error', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch order' });
  }
});

// PATCH /api/orders/:orderReference/status - Update order status
app.patch('/api/orders/:orderReference/status', async (req, res) => {
  try {
    const ordersCollection = await getOrdersCollection();
    const { status } = req.body;

    const validStatuses = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    const result = await ordersCollection.updateOne(
      { orderReference: req.params.orderReference },
      { $set: { status, updatedAt: new Date() } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    return res.json({ success: true, message: 'Order status updated' });
  } catch (err) {
    console.error('update order status error', err);
    return res.status(500).json({ success: false, message: 'Failed to update order status' });
  }
});

/**
 * Create Razorpay order - for online payments (Card/UPI)
 */
app.post('/api/create-razorpay-order', async (req, res) => {
  // Guard against invalid response object
  if (!res || typeof res !== 'object' || typeof res.headersSent !== 'boolean') {
    console.error('Invalid response object in create-razorpay-order');
    // Cannot send a response, so we just return to avoid errors.
    return;
  }

  console.log('RazorPay endpoint: razorpay is', razorpay ? 'present' : 'null');
  if (!razorpay) {
    return res.status(500).json({ success: false, message: 'Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.' });
  }

  const { name, email, address, items, total, currency } = req.body;

  if (!name || !email || !Array.isArray(items) || typeof total !== 'number') {
    return res.status(400).json({ success: false, message: 'Name, email, items, and total are required.' });
  }

  const orderReference = `ORDER-${Date.now()}`;

  // Exchange rates relative to USD (1 USD = X target) - must match CurrencyService
  const exchangeRates: Record<string, number> = {
    USD: 1,
    INR: 95.21,
    AED: 3.67,
    SAR: 3.73
  };

  // Convert the total from the frontend's currency to INR
  // The frontend sends the total in its active currency (e.g., USD, INR, AED, SAR)
  // We need to convert to INR for Razorpay
  const frontendCurrency = currency || 'USD';
  const frontendRate = exchangeRates[frontendCurrency] ?? 1;
  const inrRate = exchangeRates['INR'] ?? 95.21;
  
  // Convert: total (in frontend currency) -> USD -> INR
  const totalInUsd = total / frontendRate;
  const totalInInr = totalInUsd * inrRate;
  
  // Convert to paise (smallest unit for INR)
  const amountInPaise = Math.round(totalInInr * 100);

  console.log(`[Razorpay] Frontend currency: ${frontendCurrency}, Total: ${total}, USD: ${totalInUsd.toFixed(2)}, INR: ${totalInInr.toFixed(2)}, Paise: ${amountInPaise}`);

  try {
    const razorpayOrder = await razorpay.orders.create({
      amount: amountInPaise,
      currency: 'INR',
      receipt: orderReference,
      payment_capture: true,
      notes: {
        orderReference,
        email,
        name,
      },
    });

    return res.status(200).json({
      success: true,
      orderId: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      keyId: razorpayKeyId,
      orderReference,
    });
  } catch (error) {
    console.error('create-razorpay-order error', error);
    return res.status(500).json({ success: false, message: 'Unable to create Razorpay order.' });
  }
});

/**
 * Confirm Razorpay payment after successful payment
 */
app.post('/api/confirm-razorpay-payment', async (req, res) => {
// Guard against invalid response object
  if (!res || typeof res !== 'object' || typeof res.headersSent !== 'boolean') {
    console.error('Invalid response object in confirm-razorpay-payment');
    // Cannot send a response, so we just return to avoid errors.
    return;
  }
  if (!razorpayKeySecret) {
    return res.status(500).json({ success: false, message: 'Razorpay is not configured.' });
  }

  const { orderReference, razorpayPaymentId, razorpayOrderId, razorpaySignature } = req.body;

  if (!orderReference || !razorpayPaymentId || !razorpayOrderId || !razorpaySignature) {
    return res.status(400).json({ success: false, message: 'Payment verification parameters are required.' });
  }

  const crypto = require('crypto');
  const expectedSignature = crypto
    .createHmac('sha256', razorpayKeySecret)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest('hex');

  if (expectedSignature !== razorpaySignature) {
    return res.status(400).json({ success: false, message: 'Invalid payment signature.' });
  }

  try {
    const ordersCollection = await getOrdersCollection();
    
    // Update order status to paid
    await ordersCollection.updateOne(
      { orderReference },
      { $set: { status: 'paid', razorpayPaymentId, razorpayOrderId, updatedAt: new Date() } }
    );

    // Send confirmation email
    const order = await ordersCollection.findOne<OrderDocument>({ orderReference });
    if (order) {
      const mail = buildOrderConfirmationMessage({ 
        name: order.name, 
        email: order.email, 
        items: order.items, 
        total: order.total, 
        orderReference,
        paymentMethod: 'Razorpay'
      });
      await trySendEmail({
        to: order.email,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      });
    }

    return res.status(200).json({ success: true, orderReference });
  } catch (err) {
    console.error('confirm-razorpay-payment error', err);
    return res.status(500).json({ success: false, message: 'Unable to confirm payment.' });
  }
});

// Confirm payment after redirect by retrieving session and updating order
// DISABLED: Stripe not configured
// app.post('/api/confirm-payment', async (req, res) => {
//   if (!stripe) {
//     return res.status(500).json({ success: false, message: 'Stripe is not configured.' });
//   }
//
//   const { sessionId } = req.body;
//   if (!sessionId) {
//     return res.status(400).json({ success: false, message: 'sessionId is required.' });
//   }
//
//   try {
//     const ordersCollection = await getOrdersCollection();
//
//     const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['payment_intent'] });
//     const paid = String((session as any).payment_status) === 'paid';
//     const orderReference = (session as any).metadata?.['orderReference'] || '';
//
//     const order = await ordersCollection.findOne<OrderDocument>({ orderReference });
//     if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });
//
//     if (paid) {
//       await ordersCollection.updateOne(
//         { orderReference },
//         {
//           $set: {
//             status: 'paid',
//             paymentIntent: session.payment_intent,
//           },
//         }
//       );
//
//       // send confirmation email
//       try {
//         const mail = buildOrderConfirmationMessage({ name: (order as any).name, email: (order as any).email, items: (order as any).items, total: (order as any).total, orderReference });
//         await sendEmail({ to: (order as any).email, subject: mail.subject, text: mail.text, html: mail.html });
//       } catch (e) {
//         console.error('Failed to send post-payment confirmation email', e);
//       }
//
//       return res.status(200).json({ success: true, orderReference });
//     }
//
//     return res.status(400).json({ success: false, message: 'Payment not completed.' });
//   } catch (err) {
//     console.error('confirm-payment error', err);
//     return res.status(500).json({ success: false, message: 'Unable to confirm payment.' });
//   }
// });

// Stripe webhook endpoint (optional signature verification)
// DISABLED: Stripe not configured
// app.post('/webhook/stripe', async (req, res) => {
//   if (!stripe) {
//     return res.status(500).send('Stripe not configured');
//   }
//
//   const event = req.body;
//
//   try {
//     const ordersCollection = await getOrdersCollection();
//
//     if (event.type === 'checkout.session.completed') {
//       const session = event.data.object;
//       const orderReference = session.metadata?.orderReference || '';
//
//       const order = await ordersCollection.findOne<OrderDocument>({ orderReference });
//       if (order) {
//         await ordersCollection.updateOne(
//           { orderReference },
//           {
//             $set: {
//               status: 'paid',
//               paymentIntent: session.payment_intent || session.payment_intent_id || null,
//             },
//           }
//         );
//
//         // send confirmation email (best-effort)
//         try {
//           const mail = buildOrderConfirmationMessage({ name: (order as any).name, email: (order as any).email, items: (order as any).items, total: (order as any).total, orderReference });
//           await sendEmail({ to: (order as any).email, subject: mail.subject, text: mail.text, html: mail.html });
//         } catch (e) {
//           console.error('Failed to send webhook confirmation email', e);
//         }
//       }
//     }
//
//     return res.json({ received: true });
//   } catch (e) {
//     console.error('webhook processing error', e);
//     return res.status(500).send('Webhook processing error');
//   }
// });

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

// Health check endpoint for Render/load balancers
app.get('/health', (req, res) => {
// Guard against invalid response object
  if (!res || typeof res !== 'object' || typeof res.headersSent !== 'boolean') {
    console.error('Invalid response object in health check');
    // Cannot send a response, so we just return to avoid errors.
    return;
  }
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    mongodb: db ? 'connected' : 'disconnected'
  });
});

/**
 * Serve static files from /browser
 * Guard against invalid response objects during Angular SSR route extraction
 */
app.use((req, res, next) => {
  if (!res || typeof res !== 'object' || typeof res.headersSent !== 'boolean') {
    console.warn('Static middleware guard: Invalid response object detected, skipping');
    return;
  }
  next();
});

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
app.use(async (req, res, next) => {
  // Guard against invalid Express response objects
  if (!res || typeof res !== 'object' || typeof res.headersSent !== 'boolean') {
    console.error('SSR middleware invoked with invalid response object');
    // We cannot send a response, so we just return to avoid errors.
    return;
  }

  try {
    // Skip API routes and health check - they are handled above
    if (req.path.startsWith('/api/') || req.path === '/health') {
      return next();
    }

    const engine = getAngularApp();
    if (!engine) {
      // In development without SSR build, serve index.csr.html for client-side routing
      const fallbackHtml = join(browserDistFolder, 'index.csr.html');
      res.sendFile(fallbackHtml, (err) => {
        if (err) {
          console.error('Failed to serve fallback HTML:', err);
          next(err);
        }
      });
      return;
    }
    const response = await engine.handle(req);
    if (response) {
      await writeResponseToNodeResponse(response, res);
      return;
    }
    next();
  } catch (err) {
    console.error('SSR Error:', err);
    next(err);
  }
});
// Express error-handling middleware
app.use((err: any, req: any, res: any, next: any) => {
  console.error('Unhandled error:', err);

  // Guard against invalid Express response objects
  if (!res || typeof res !== 'object' || typeof res.headersSent !== 'boolean') {
    console.error('Error handler invoked with invalid response object');
    // Cannot send a response, so we log and end the process here to avoid infinite loop
    return;
  }

  // If the response has already been sent, delegate to Express' default error handler
  if (res?.headersSent) {
    return next(err);
  }

  res.status(500).json({ success: false, message: 'Internal server error' });
});

/**
 * Start the server if this module is the main entry point, or it is ran via PM2.
 * In development, also start the server when PORT is set (for Angular CLI dev servers).
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url) || process.env['pm_id'] || (process.env['NODE_ENV'] !== 'production' && process.env['PORT'])) {
  const port = process.env['PORT'] || 4000;

  // Start the server immediately - don't wait for MongoDB
  // MongoDB will be initialized in the background
  const server = app.listen(port, () => {
    console.log(`Node Express server listening on http://localhost:${port}`);
  });

  server.on('error', (error) => {
    console.error('Server experienced an execution error:', error);
    throw error;
  });

  // Initialize MongoDB in the background (non-blocking)
  ensureMongoDBInitialized().catch((error) => {
    console.error('MongoDB background initialization failed:', error.message);
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);

// Export app as default for Angular SSR
export default app;

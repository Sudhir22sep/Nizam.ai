import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { join, resolve } from 'node:path';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import Razorpay from 'razorpay';
//import Stripe from 'stripe';
import { MongoClient, Db, WithId } from "mongodb";
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
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

// Determine environment and default database name
 const isProduction = process.env['NODE_ENV'] === 'production';
 const isIntegration = process.env['NODE_ENV'] === 'integration';
 const defaultDbName = isProduction ? 'ammawears_prod' : isIntegration ? 'ammawears_int' : 'ammawears_dev';

// Resolve MongoDB URI with appropriate database name
let mongoUrl = process.env['MONGODB_URI'] || `mongodb://localhost:27017/${defaultDbName}`;

// If URI doesn't have a database name in the path, append the environment-specific one
try {
  const url = new URL(mongoUrl.replace('mongodb+srv://', 'https://').replace('mongodb://', 'http://'));
  const pathDbName = url.pathname.slice(1).split('?')[0]; // Get database name from path
  
  if (!pathDbName || pathDbName === '') {
    // No database name in URI - append the default
    const separator = mongoUrl.includes('?') ? '&' : '?';
    const dbParam = `retryWrites=true&w=majority`;
    mongoUrl = `${mongoUrl}${separator}${dbParam}`;
    // Insert database name before query params
    mongoUrl = mongoUrl.replace(/\.mongodb\.net\//, `.mongodb.net/${defaultDbName}/`);
  }
} catch {
  // Fallback for malformed URLs
  if (!mongoUrl.includes('.mongodb.net/') || mongoUrl.endsWith('.mongodb.net/')) {
    mongoUrl += `${defaultDbName}?retryWrites=true&w=majority`;
  }
}

console.log("MONGODB_URI resolved:", mongoUrl.replace(/\/\/[^:]+:[^@]+@/, '//***:***@'));
console.log("Environment:", isProduction ? 'production' : 'development', "| Database:", defaultDbName);
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
const razorpayWebhookSecret = process.env['RAZORPAY_WEBHOOK_SECRET'] || razorpayKeySecret;
const razorpay = razorpayKeyId && razorpayKeySecret
  ? new Razorpay({ key_id: razorpayKeyId, key_secret: razorpayKeySecret })
  : null;
console.log('RazorPay Key ID:', razorpayKeyId ? 'SET' : 'NOT SET');
// console.log('RazorPay Key Secret:', razorpayKeySecret ? 'SET' : 'NOT SET'); // Avoid logging secret
console.log('RazorPay instance:', razorpay ? 'CREATED' : 'NULL');

const appUrl = process.env['APP_URL'] || 'http://localhost:4200';

// JWT Configuration
const jwtSecret = process.env['JWT_SECRET'] || '10193d8ce7571d25550376f46ddae5e828daaf826d262a2f0def0ad109719addf600879a000771cf5c432cc7e3267a08e789377e682bd918c27c970333bc05d1';
const jwtExpiresIn = '7d';

// User document type
interface UserDocument {
  _id: any;
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  phone?: string;
  addresses: Array<{
    type: 'billing' | 'shipping';
    line1: string;
    line2?: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
    isDefault: boolean;
  }>;
  createdAt: Date;
  lastLogin?: Date;
  isActive: boolean;
  role: 'user' | 'admin';
}

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
// IMPORTANT: Razorpay webhook needs raw body for signature verification
// Register raw body parser for webhook BEFORE express.json()
app.use('/api/razorpay-webhook', express.raw({ type: 'application/json' }));
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

// Health check endpoint for Render (and general health monitoring)
app.get('/api/health', async (req, res) => {
  try {
    if (!db) {
      return res.status(503).json({ status: 'unhealthy', message: 'Database not initialized' });
    }
    // Ping the database to verify connectivity
    await db.admin().ping();
    return res.json({ status: 'healthy', message: 'All systems operational' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Health check failed:', error);
    return res.status(503).json({ 
      status: 'unhealthy', 
      message: 'Service unavailable', 
      error: message 
    });
  }
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
    const productsCollection = db.collection('products');

    await ordersCollection.createIndex({ orderReference: 1 }, { unique: true });
    await ordersCollection.createIndex({ email: 1 });
    await usersCollection.createIndex({ email: 1 }, { unique: true });
    await contactsCollection.createIndex({ email: 1 });
    await productsCollection.createIndex({ name: 'text', description: 'text' });

    console.log('MongoDB connected successfully');
  } catch (error) {
    console.error('Failed to connect to MongoDB:', error);
    console.error('MongoDB connection error details:', error instanceof Error ? error.message : String(error));
    console.error('Check MONGODB_URI environment variable and MongoDB Atlas IP whitelist');
    // Don't exit, just continue without DB
  }
}


function ensureMongoDBInitialized(): Promise<void> {
   console.log('ensureMongoDBInitialized called');
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

// Get or create products collection
async function getProductsCollection() {
  await ensureMongoDBInitialized();

  if (!db) {
    throw new Error('MongoDB not connected');
  }
  return db.collection('products');
}

// Get or create wishlists collection
async function getWishlistsCollection() {
  await ensureMongoDBInitialized();

  if (!db) {
    throw new Error('MongoDB not connected');
  }
  return db.collection('wishlists');
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
  items: Array<{ product: { name: string; price?: number; basePrice?: number }; quantity: number }>;
  total: number;
  orderReference: string;
  paymentMethod?: string;
}) {
  const { name, email, items, total, orderReference, paymentMethod } = params;
  const methodLabel = paymentMethod === 'COD' ? 'Cash on Delivery (COD)' : 'Card payment';
  const itemRows = items.map((item) => {
    const price = item.product.price ?? item.product.basePrice ?? 0;
    const productName = item.product.name || 'Unnamed Item';
    return `
    <tr>
      <td>${productName}</td>
      <td>${item.quantity}</td>
      <td>$${price.toFixed(2)}</td>
      <td>$${(price * item.quantity).toFixed(2)}</td>
    </tr>
  `}).join('');

  const itemText = items.map((item) => {
    const price = item.product.price ?? item.product.basePrice ?? 0;
    const productName = item.product.name || 'Unnamed Item';
    return `${item.quantity} x ${productName} @ $${price.toFixed(2)} = $${(price * item.quantity).toFixed(2)}`;
  }).join('\n');

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

// ============================================
// AUTHENTICATION ENDPOINTS
// ============================================

/**
 * Register a new user
 */
app.post('/api/auth/register', async (req, res) => {
  const { email, password, firstName, lastName, phone } = req.body;

  if (!email || !password || !firstName || !lastName) {
    return res.status(400).json({ success: false, message: 'Email, password, first name, and last name are required.' });
  }

  if (password.length < 8) {
    return res.status(400).json({ success: false, message: 'Password must be at least 8 characters.' });
  }

  try {
    const usersCollection = await getUsersCollection();

    // Check if user already exists
    const existingUser = await usersCollection.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Create user
    const user: UserDocument = {
      _id: new (require('mongodb')).ObjectId(),
      email: email.toLowerCase().trim(),
      passwordHash,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      phone: phone?.trim() || '',
      addresses: [],
      createdAt: new Date(),
      isActive: true,
      role: 'user',
    };

    const result = await usersCollection.insertOne(user);

    // Generate JWT token
    const token = jwt.sign(
      { userId: result.insertedId.toString(), email: user.email, role: user.role },
      jwtSecret,
      { expiresIn: jwtExpiresIn }
    );

    return res.status(201).json({
      success: true,
      message: 'Account created successfully.',
      token,
      user: {
        id: result.insertedId.toString(),
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
    });
  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({ success: false, message: 'Unable to create account at this time.' });
  }
});

/**
 * Login user
 */
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password are required.' });
  }

  try {
    const usersCollection = await getUsersCollection();

    // Find user by email
    const user = await usersCollection.findOne({ email: email.toLowerCase().trim() }) as UserDocument | null;
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(403).json({ success: false, message: 'This account has been deactivated.' });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    // Update last login
    await usersCollection.updateOne(
      { _id: user._id },
      { $set: { lastLogin: new Date() } }
    );

    // Generate JWT token
    const token = jwt.sign(
      { userId: user._id.toString(), email: user.email, role: user.role },
      jwtSecret,
      { expiresIn: jwtExpiresIn }
    );

    return res.status(200).json({
      success: true,
      message: 'Login successful.',
      token,
      user: {
        id: user._id.toString(),
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
        addresses: user.addresses,
        role: user.role,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ success: false, message: 'Unable to login at this time.' });
  }
});

/**
 * Get current user profile (requires auth)
 */
app.get('/api/auth/me', async (req, res) => {
  if (!res || typeof res !== 'object' || typeof res.headersSent !== 'boolean') {
    console.error('Invalid response object in auth/me');
    return;
  }

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }

    const token = authHeader.substring(7);
    let decoded: any;
    try {
      decoded = jwt.verify(token, jwtSecret);
    } catch (err) {
      return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
    }

    const usersCollection = await getUsersCollection();
    const user = await usersCollection.findOne({ _id: new (require('mongodb')).ObjectId(decoded.userId) }) as UserDocument | null;

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    if (!user.isActive) {
      return res.status(403).json({ success: false, message: 'This account has been deactivated.' });
    }

    return res.status(200).json({
      success: true,
      user: {
        id: user._id.toString(),
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
        addresses: user.addresses,
        role: user.role,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    console.error('Get profile error:', error);
    return res.status(500).json({ success: false, message: 'Unable to fetch profile.' });
  }
});

/**
 * Update user profile (requires auth)
 */
app.put('/api/auth/profile', async (req, res) => {
  if (!res || typeof res !== 'object' || typeof res.headersSent !== 'boolean') {
    console.error('Invalid response object in auth/profile');
    return;
  }

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }

    const token = authHeader.substring(7);
    let decoded: any;
    try {
      decoded = jwt.verify(token, jwtSecret);
    } catch (err) {
      return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
    }

    const usersCollection = await getUsersCollection();
    const { firstName, lastName, phone } = req.body;

    const updates: any = {};
    if (firstName) updates.firstName = firstName.trim();
    if (lastName) updates.lastName = lastName.trim();
    if (phone !== undefined) updates.phone = phone.trim();

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, message: 'No fields to update.' });
    }

    updates.updatedAt = new Date();

    const result = await usersCollection.findOneAndUpdate(
      { _id: new (require('mongodb')).ObjectId(decoded.userId) },
      { $set: updates },
      { returnDocument: 'after' }
    ) as UserDocument | null;

    if (!result) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully.',
      user: {
        id: result._id.toString(),
        email: result.email,
        firstName: result.firstName,
        lastName: result.lastName,
        phone: result.phone,
        addresses: result.addresses,
        role: result.role,
      },
    });
  } catch (error) {
    console.error('Update profile error:', error);
    return res.status(500).json({ success: false, message: 'Unable to update profile.' });
  }
});

/**
 * Add/update user address (requires auth)
 */
app.post('/api/auth/addresses', async (req, res) => {
  if (!res || typeof res !== 'object' || typeof res.headersSent !== 'boolean') {
    console.error('Invalid response object in auth/addresses');
    return;
  }

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }

    const token = authHeader.substring(7);
    let decoded: any;
    try {
      decoded = jwt.verify(token, jwtSecret);
    } catch (err) {
      return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
    }

    const { type, line1, line2, city, state, postalCode, country, isDefault } = req.body;

    if (!type || !line1 || !city || !state || !postalCode || !country) {
      return res.status(400).json({ success: false, message: 'All address fields are required.' });
    }

    const usersCollection = await getUsersCollection();
    const userId = new (require('mongodb')).ObjectId(decoded.userId);

    // If this is set as default, unset other defaults of same type
    if (isDefault) {
      await usersCollection.updateOne(
        { _id: userId, 'addresses.type': type, 'addresses.isDefault': true },
        { $set: { 'addresses.$.isDefault': false } }
      );
    }

    const newAddress: UserDocument['addresses'][0] = {
      type,
      line1: line1.trim(),
      line2: line2?.trim() || '',
      city: city.trim(),
      state: state.trim(),
      postalCode: postalCode.trim(),
      country: country.trim(),
      isDefault: !!isDefault,
    };

    await usersCollection.updateOne(
      { _id: userId },
      { $push: { addresses: newAddress } } as any
    );

    const updatedUser = await usersCollection.findOne({ _id: userId }) as UserDocument | null;

    return res.status(200).json({
      success: true,
      message: 'Address added successfully.',
      addresses: updatedUser?.addresses || [],
    });
  } catch (error) {
    console.error('Add address error:', error);
    return res.status(500).json({ success: false, message: 'Unable to add address.' });
  }
});

/**
 * Delete user address (requires auth)
 */
app.delete('/api/auth/addresses/:index', async (req, res) => {
  if (!res || typeof res !== 'object' || typeof res.headersSent !== 'boolean') {
    console.error('Invalid response object in auth/addresses delete');
    return;
  }

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }

    const token = authHeader.substring(7);
    let decoded: any;
    try {
      decoded = jwt.verify(token, jwtSecret);
    } catch (err) {
      return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
    }

    const index = parseInt(req.params.index, 10);
    if (isNaN(index) || index < 0) {
      return res.status(400).json({ success: false, message: 'Invalid address index.' });
    }

    const usersCollection = await getUsersCollection();
    const userId = new (require('mongodb')).ObjectId(decoded.userId);

    const user = await usersCollection.findOne({ _id: userId }) as UserDocument | null;
    if (!user || !user.addresses || index >= user.addresses.length) {
      return res.status(404).json({ success: false, message: 'Address not found.' });
    }

    // Remove address at index
    user.addresses.splice(index, 1);

    await usersCollection.updateOne(
      { _id: userId },
      { $set: { addresses: user.addresses } }
    );

    return res.status(200).json({
      success: true,
      message: 'Address deleted successfully.',
      addresses: user.addresses,
    });
  } catch (error) {
    console.error('Delete address error:', error);
    return res.status(500).json({ success: false, message: 'Unable to delete address.' });
  }
});

/**
 * Logout (client-side only, but endpoint for consistency)
 */
// JWT authentication middleware
async function authenticateJwt(req: Request & { user?: any }, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ success: false, message: 'Authorization header required' });
  }
  const token = authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ success: false, message: 'Token not provided' });
  }
  try {
    const decoded = jwt.verify(token, jwtSecret);
    req.user = decoded;
    next();
    return;
  } catch (error) {
    console.error('JWT verification error:', error);
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
}
app.post('/api/auth/logout', (req, res) => {
  // JWT is stateless - logout is handled client-side by deleting the token
  // This endpoint exists for API consistency and potential future token blacklisting
  return res.status(200).json({ success: true, message: 'Logged out successfully.' });
});
app.post('/api/register', async (req, res) => {
  const { firstName, lastName, email, phone, password, addresses } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password required' });
  }
  try {
    const usersCollection = await getUsersCollection();
    const existingUser = await usersCollection.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ success: false, message: 'User already exists' });
    }
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    const user = {
      firstName: firstName || '',
      lastName: lastName || '',
      email,
      phone: phone || '',
      passwordHash,
      addresses: addresses || [],
      createdAt: new Date(),
      lastLogin: new Date(),
      isActive: true,
      role: 'user'
    };
    const result = await usersCollection.insertOne(user);
    const token = jwt.sign({ email, role: user.role }, jwtSecret, { expiresIn: jwtExpiresIn });
    return res.status(201).json({ success: true, token });
  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password required' });
  }
  try {
    const usersCollection = await getUsersCollection();
    const user = await usersCollection.findOne({ email }) as UserDocument | null;
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    const token = jwt.sign({ email, role: user.role }, jwtSecret, { expiresIn: jwtExpiresIn });
    return res.json({ success: true, token });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
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



app.post('/api/create-cod-order', async (req: Request, res: Response) => {
  try {
    const { name, email, address, items, total, currency } = req.body;

    // Validate required fields
    if (!name || !email || !Array.isArray(items) || typeof total !== 'number') {
      return res.status(400).json({ 
        success: false, 
        message: 'Name, email, items (array), and total are required.' 
      });
    }

    // Validate total is positive
    if (total <= 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Total must be greater than zero' 
      });
    }

    // Validate each item and normalize structure
    const normalizedItems = [];
    for (const item of items) {
      if (!item || typeof item !== 'object') {
        return res.status(400).json({ 
          success: false, 
          message: 'Each item must be an object' 
        });
      }

      // Extract price from either item.price or item.product.basePrice or item.product.price
      let price: number | undefined;
      let productName = '';
      
      if (typeof item.price === 'number' && item.price > 0) {
        price = item.price;
        productName = item.product?.name || `Item ${normalizedItems.length + 1}`;
      } else if (item.product && typeof item.product === 'object') {
        // Support frontend cart item structure: { product: { basePrice: number, name: string, ... }, quantity: number }
        if (typeof item.product.basePrice === 'number' && item.product.basePrice > 0) {
          price = item.product.basePrice;
          productName = item.product.name || `Item ${normalizedItems.length + 1}`;
        } else if (typeof item.product.price === 'number' && item.product.price > 0) {
          price = item.product.price;
          productName = item.product.name || `Item ${normalizedItems.length + 1}`;
        }
      }
      
      if (price === undefined || price <= 0) {
        return res.status(400).json({ 
          success: false, 
          message: 'Each item must have a valid positive price' 
        });
      }

      // Validate quantity
      const quantity = typeof item.quantity === 'number' && item.quantity > 0 ? item.quantity : 1;
      if (quantity <= 0) {
        return res.status(400).json({ 
          success: false, 
          message: 'Each item quantity must be a positive number' 
        });
      }

      // Normalize to the expected OrderDocument structure
      normalizedItems.push({
        product: {
          name: productName,
          price: price
        },
        quantity: quantity
      });
    }

    const orderReference = `ORDER-${Date.now()}`;
    const ordersCollection = await getOrdersCollection();

    const order = {
      orderReference,
      name,
      email,
      address,
      items: normalizedItems,
      total,
      currency: currency || 'USD',
      paymentMethod: 'COD',
      status: 'pending',
      createdAt: new Date()
    };

    await ordersCollection.insertOne(order);

    const mail = buildOrderConfirmationMessage({ 
      name, email, items: normalizedItems, total, 
      orderReference, paymentMethod: 'COD' 
    });

    const sent = await trySendEmail({
      to: email,
      subject: mail.subject,
      text: mail.text,
      html: mail.html
    });

    return res.status(200).json({ 
      success: true, 
      orderReference, 
      message: sent ? 
        'Order placed with COD. Confirmation email sent.' 
        : 'Order placed with COD. Email service is not configured.' 
    });

  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error('Order creation error:', error.stack);
    return res.status(500).json({ 
      success: false, 
      message: 'Unable to place COD order', 
      error: error.message 
    });
  }
});
// GET /api/orders - Get all orders (with pagination and filters)
app.get('/api/orders', authenticateJwt, async (req, res) => {
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
app.get('/api/orders/:orderReference', authenticateJwt, async (req, res) => {
  try {
    const ordersCollection = await getOrdersCollection();
    const order = await ordersCollection.findOne<OrderDocument>({
      orderReference: req.params['orderReference']
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

    // Save order to MongoDB with 'pending' status before returning
    // This ensures the order exists when payment is confirmed
    const ordersCollection = await getOrdersCollection();
    
    // Normalize items to match OrderDocument structure
    const normalizedItems = items.map(item => {
      // Extract price from either item.price or item.product.basePrice or item.product.price
      let price = 0;
      let productName = 'Unnamed Item';
      
      if (typeof item.price === 'number' && item.price > 0) {
        price = item.price;
        productName = item.product?.name || productName;
      } else if (item.product && typeof item.product === 'object') {
        if (typeof item.product.basePrice === 'number' && item.product.basePrice > 0) {
          price = item.product.basePrice;
          productName = item.product.name || productName;
        } else if (typeof item.product.price === 'number' && item.product.price > 0) {
          price = item.product.price;
          productName = item.product.name || productName;
        }
      }
      
      const quantity = typeof item.quantity === 'number' && item.quantity > 0 ? item.quantity : 1;
      
      return {
        product: {
          name: productName,
          price: price
        },
        quantity: quantity
      };
    });

    const order: OrderDocument = {
      orderReference,
      name,
      email,
      address: address || '',
      items: normalizedItems,
      total,
      currency: 'INR', // Razorpay always uses INR
      paymentMethod: 'Razorpay',
      status: 'pending',
      createdAt: new Date()
    };
    await ordersCollection.insertOne(order);

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
 * Confirm Razorpay payment after successful payment (client-side callback)
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
/**
 * Razorpay Webhook - Server-side payment confirmation (RELIABLE for UPI/redirect payments)
 * Configure this URL in Razorpay Dashboard: https://api.ammawears.com/api/razorpay-webhook
 */
app.post('/api/razorpay-webhook', async (req: Request, res: Response) => {
  // Guard against invalid response object
  if (!res || typeof res !== 'object' || typeof res.headersSent !== 'boolean') {
    console.error('Invalid response object in razorpay-webhook');
    return;
  }

  if (!razorpayKeySecret) {
    console.error('Razorpay webhook: Razorpay not configured');
    return res.status(500).json({ success: false, message: 'Razorpay is not configured.' });
  }

  // Verify webhook signature
  const webhookSignature = req.headers['x-razorpay-signature'] as string;
  if (!webhookSignature) {
    console.error('Razorpay webhook: Missing signature header');
    return res.status(400).json({ success: false, message: 'Missing webhook signature.' });
  }

  const crypto = require('crypto');
  // req.body is now a Buffer (raw body) due to express.raw() middleware
  const rawBody = req.body instanceof Buffer ? req.body.toString('utf8') : JSON.stringify(req.body);
  console.log('Razorpay webhook: Raw body received:', rawBody);
  console.log('Razorpay webhook: Signature header:', webhookSignature);
  const expectedSignature = crypto
    .createHmac('sha256', razorpayKeySecret)
    .update(rawBody)
    .digest('hex');
  console.log('Razorpay webhook: Expected signature:', expectedSignature);

  if (expectedSignature !== webhookSignature) {
    console.error('Razorpay webhook: Invalid signature');
    return res.status(400).json({ success: false, message: 'Invalid webhook signature.' });
  }

  try {
    const event = JSON.parse(rawBody);
    
    // Handle payment.captured event (payment successful)
    if (event.event === 'payment.captured') {
      const payment = event.payload.payment.entity;
      const orderId = payment.order_id;
      const paymentId = payment.id;
      const amount = payment.amount / 100; // Convert from paise
      const currency = payment.currency;
      
      // Get order reference from notes
      const orderReference = payment.notes?.orderReference;
      const email = payment.notes?.email;
      const name = payment.notes?.name;

      if (!orderReference) {
        console.error('Razorpay webhook: No orderReference in payment notes');
        return res.status(400).json({ success: false, message: 'Missing order reference.' });
      }

      const ordersCollection = await getOrdersCollection();
      
      // Check if already processed (idempotency)
      const existingOrder = await ordersCollection.findOne<OrderDocument>({ orderReference });
      if (existingOrder && existingOrder.status === 'paid') {
        console.log(`Razorpay webhook: Order ${orderReference} already processed`);
        return res.status(200).json({ success: true, message: 'Already processed' });
      }

      // Update order status to paid
      await ordersCollection.updateOne(
        { orderReference },
        { 
          $set: { 
            status: 'paid', 
            razorpayPaymentId: paymentId, 
            razorpayOrderId: orderId,
            amount,
            currency,
            updatedAt: new Date() 
          } 
        },
        { upsert: true }
      );

      // Send confirmation email
      if (email && name) {
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
      }

      console.log(`Razorpay webhook: Order ${orderReference} confirmed via webhook`);
    }

    // Always return 200 to acknowledge receipt
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Razorpay webhook error', err);
    return res.status(500).json({ success: false, message: 'Webhook processing failed.' });
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
//
// Product Catalog API Endpoints
//
app.get('/api/products/', async (req, res) => {
  try {
    const productsCollection = await getProductsCollection();
    const { category, minPrice, maxPrice, search, limit = 20, page = 1 } = req.query;
    
    const filter: any = {};
    
    if (category) {
      filter.category = category;
    }
    
    if (minPrice !== undefined && maxPrice !== undefined) {
      filter.basePrice = { $gte: Number(minPrice), $lte: Number(maxPrice) };
    } else if (minPrice !== undefined) {
      filter.basePrice = { $gte: Number(minPrice) };
    } else if (maxPrice !== undefined) {
      filter.basePrice = { $lte: Number(maxPrice) };
    }
    
    if (search) {
      filter.$text = { $search: search };
    }
    
    const skip = (Number(page) - 1) * Number(limit);
    
    const [products, total] = await Promise.all([
      productsCollection
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .toArray(),
      productsCollection.countDocuments(filter)
    ]);
    
    res.json({ success: true, products, total, page: Number(page), limit: Number(limit) });
  } catch (error) {
    console.error("Get products error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch products" });
  }
});

app.get('/api/products/:id/', async (req, res) => {
  try {
    const productsCollection = await getProductsCollection();
    const product = await productsCollection.findOne({ _id: new (require("mongodb")).ObjectId(req.params.id) });
    
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }
    
    res.json({ success: true, product });
  } catch (error) {
    console.error("Get product by ID error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch product" });
  }
});

app.post('/api/products/', async (req, res) => {
  try {
    const productsCollection = await getProductsCollection();
    const { name, description, basePrice, currency, category, images, variants, tags, isActive } = req.body;
    
    if (!name || !description || !basePrice || !currency || !category) {
      return res.status(400).json({ success: false, message: "Name, description, basePrice, currency, and category are required" });
    }
    
    const product: any = {
      _id: new (require("mongodb")).ObjectId(),
      name,
      description,
      basePrice: Number(basePrice),
      currency,
      category,
      images: images || [],
      variants: variants || [],
      tags: tags || [],
      isActive: isActive !== undefined ? isActive : true,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    const result = await productsCollection.insertOne(product);
    product._id = result.insertedId;
    
    res.status(201).json({ success: true, message: "Product created successfully", product });
  } catch (error) {
    console.error("Create product error:", error);
    res.status(500).json({ success: false, message: "Failed to create product" });
  }
});

app.put('/api/products/:id/', async (req, res) => {
  try {
    const productsCollection = await getProductsCollection();
    const { name, description, basePrice, currency, category, images, variants, tags, isActive } = req.body;
    
    const updateData: any = {}
    
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (basePrice !== undefined) updateData.basePrice = Number(basePrice);
    if (currency !== undefined) updateData.currency = currency;
    if (category !== undefined) updateData.category = category;
    if (images !== undefined) updateData.images = images;
    if (variants !== undefined) updateData.variants = variants;
    if (tags !== undefined) updateData.tags = tags;
    if (isActive !== undefined) updateData.isActive = isActive;
    
    updateData.updatedAt = new Date();
    
    const result = await productsCollection.updateOne(
      { _id: new (require("mongodb")).ObjectId(req.params.id) },
      { $set: updateData }
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }
    
    res.json({ success: true, message: "Product updated successfully" });
  } catch (error) {
    console.error("Update product error:", error);
    res.status(500).json({ success: false, message: "Failed to update product" });
  }
});

app.delete('/api/products/:id/', async (req, res) => {
  try {
    const productsCollection = await getProductsCollection();
    
    const result = await productsCollection.deleteOne(
      { _id: new (require("mongodb")).ObjectId(req.params.id) }
    );
    
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }
    
    res.json({ success: true, message: "Product deleted successfully" });
  } catch (error) {
    console.error("Delete product error:", error);
    res.status(500).json({ success: false, message: "Failed to delete product" });
  }
});

// Wishlist API Endpoints
app.get('/api/wishlist', authenticateJwt, async (req, res) => {
  try {
    const wishlistsCollection = await getWishlistsCollection();
    const userId = req.user.userId;
    
    const wishlists = await wishlistsCollection.find({ userId: new (require("mongodb")).ObjectId(userId) }).toArray();
    
    // Convert ObjectId to string for frontend
    const wishlistsWithStringIds = wishlists.map(wishlist => ({
      ...wishlist,
      _id: wishlist._id.toString(),
      userId: wishlist.userId.toString(),
      items: wishlist.items.map(item => ({
        ...item,
        productId: item.productId.toString(),
        variantId: item.variantId ? item.variantId.toString() : null
      }))
    }));
    
    res.json({ success: true, wishlists: wishlistsWithStringIds });
  } catch (error) {
    console.error("Get wishlists error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch wishlists" });
  }
});

app.post('/api/wishlist', authenticateJwt, async (req, res) => {
  try {
    const wishlistsCollection = await getWishlistsCollection();
    const { name, isPublic = false } = req.body;
    const userId = req.user.userId;
    
    if (!name) {
      return res.status(400).json({ success: false, message: "Wishlist name is required" });
    }
    
    const wishlist = {
      _id: new (require("mongodb")).ObjectId(),
      userId: new (require("mongodb")).ObjectId(userId),
      name,
      items: [],
      isPublic: !!isPublic,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    const result = await wishlistsCollection.insertOne(wishlist);
    wishlist._id = result.insertedId;
    
    res.status(201).json({ success: true, message: "Wishlist created successfully", wishlist: {
      ...wishlist,
      _id: wishlist._id.toString(),
      userId: wishlist.userId.toString()
    }});
  } catch (error) {
    console.error("Create wishlist error:", error);
    res.status(500).json({ success: false, message: "Failed to create wishlist" });
  }
});

app.get('/api/wishlist/:id', authenticateJwt, async (req, res) => {
  try {
    const wishlistsCollection = await getWishlistsCollection();
    const wishlistId = req.params.id;
    const userId = req.user.userId;
    
    if (!require("mongodb").ObjectId.isValid(wishlistId)) {
      return res.status(400).json({ success: false, message: "Invalid wishlist ID" });
    }
    
    const wishlist = await wishlistsCollection.findOne({
      _id: new (require("mongodb")).ObjectId(wishlistId),
      userId: new (require("mongodb")).ObjectId(userId)
    });
    
    if (!wishlist) {
      return res.status(404).json({ success: false, message: "Wishlist not found" });
    }
    
    // Convert ObjectId to string for frontend
    const wishlistWithStringIds = {
      ...wishlist,
      _id: wishlist._id.toString(),
      userId: wishlist.userId.toString(),
      items: wishlist.items.map(item => ({
        ...item,
        productId: item.productId.toString(),
        variantId: item.variantId ? item.variantId.toString() : null
      }))
    };
    
    res.json({ success: true, wishlist: wishlistWithStringIds });
  } catch (error) {
    console.error("Get wishlist by ID error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch wishlist" });
  }
});

app.post('/api/wishlist/:id/items', authenticateJwt, async (req, res) => {
  try {
    const wishlistsCollection = await getWishlistsCollection();
    const wishlistId = req.params.id;
    const userId = req.user.userId;
    const { productId, variantId = null, notes = "" } = req.body;
    
    if (!require("mongodb").ObjectId.isValid(wishlistId)) {
      return res.status(400).json({ success: false, message: "Invalid wishlist ID" });
    }
    
    if (!require("mongodb").ObjectId.isValid(productId)) {
      return res.status(400).json({ success: false, message: "Invalid product ID" });
    }
    
    if (variantId !== null && !require("mongodb").ObjectId.isValid(variantId)) {
      return res.status(400).json({ success: false, message: "Invalid variant ID" });
    }
    
    // Check if wishlist exists and belongs to user
    const wishlist = await wishlistsCollection.findOne({
      _id: new (require("mongodb")).ObjectId(wishlistId),
      userId: new (require("mongodb")).ObjectId(userId)
    });
    
    if (!wishlist) {
      return res.status(404).json({ success: false, message: "Wishlist not found" });
    }
    
    // Check if item already exists in wishlist
    const itemExists = wishlist.items.some(item => 
      item.productId.equals(new (require("mongodb")).ObjectId(productId)) &&
      ((variantId === null && !item.variantId) || (item.variantId && item.variantId.equals(new (require("mongodb")).ObjectId(variantId))))
    );
    
    if (itemExists) {
      return res.status(409).json({ success: false, message: "Item already exists in wishlist" });
    }
    
    const newItem = {
      productId: new (require("mongodb")).ObjectId(productId),
      variantId: variantId ? new (require("mongodb")).ObjectId(variantId) : null,
      addedAt: new Date(),
      notes
    };
    
    await wishlistsCollection.updateOne(
      { _id: new (require("mongodb")).ObjectId(wishlistId) },
      { $push: { items: newItem }, $set: { updatedAt: new Date() } }
    );
    
    res.json({ success: true, message: "Item added to wishlist successfully" });
  } catch (error) {
    console.error("Add item to wishlist error:", error);
    res.status(500).json({ success: false, message: "Failed to add item to wishlist" });
  }
});

app.delete('/api/wishlist/:id/items/:itemId', authenticateJwt, async (req, res) => {
  try {
    const wishlistsCollection = await getWishlistsCollection();
    const wishlistId = req.params.id;
    const userId = req.user.userId;
    
    if (!require("mongodb").ObjectId.isValid(wishlistId)) {
      return res.status(400).json({ success: false, message: "Invalid wishlist ID" });
    }
    
    // Check if wishlist exists and belongs to user
    const wishlist = await wishlistsCollection.findOne({
      _id: new (require("mongodb")).ObjectId(wishlistId),
      userId: new (require("mongodb")).ObjectId(userId)
    });
    
    if (!wishlist) {
      return res.status(404).json({ success: false, message: "Wishlist not found" });
    }
    
    // For removal, we'll accept productId and variantId in the body to identify the item
    const { productId, variantId } = req.body;
    
    if (!productId || !require("mongodb").ObjectId.isValid(productId)) {
      return res.status(400).json({ success: false, message: "Product ID is required" });
    }
    
    const updateData = { $set: { updatedAt: new Date() } };
    
    if (variantId && require("mongodb").ObjectId.isValid(variantId)) {
      updateData.$pull = { items: { productId: new (require("mongodb")).ObjectId(productId), variantId: new (require("mongodb")).ObjectId(variantId) } };
    } else {
      updateData.$pull = { items: { productId: new (require("mongodb")).ObjectId(productId) } };
    }
    
    const result = await wishlistsCollection.updateOne(
      { _id: new (require("mongodb")).ObjectId(wishlistId), userId: new (require("mongodb")).ObjectId(userId) },
      updateData
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, message: "Wishlist not found" });
    }
    
    if (result.modifiedCount === 0) {
      return res.status(409).json({ success: false, message: "Item not found in wishlist" });
    }
    
    res.json({ success: true, message: "Item removed from wishlist successfully" });
  } catch (error) {
    console.error("Remove item from wishlist error:", error);
    res.status(500).json({ success: false, message: "Failed to remove item from wishlist" });
  }
});

 */

// Health check endpoint for Render/load balancers
app.get('/health', (req: Request, res: Response) => {
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
app.use(async (req: Request, res: Response, next: NextFunction) => {
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
      res.sendFile(fallbackHtml, (err: Error | null) => {
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

  server.on('error', (error: Error) => {
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

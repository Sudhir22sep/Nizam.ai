// server.ts - Clean SSR Server Setup
import { createNodeRequestHandler } from '@angular/ssr/node';
import express, { Response, Request, NextFunction } from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import { resolve } from 'path';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import { writeResponseToNodeResponse } from '@angular/ssr/node';
import { isMainModule } from '@angular/ssr/node';
import { Db, MongoClient, ObjectId } from 'mongodb';
import Razorpay from 'razorpay';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { AngularNodeAppEngine } from '@angular/ssr/node';
import { ɵsetAngularAppManifest, ɵsetAngularAppEngineManifest } from '@angular/ssr';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);

// Load local environment variables as a fallback. Never override variables
// injected by the hosting platform (for example, Render), so production does
// not depend on a committed .env file.
function loadEnv(): string | null {
  const candidates = [
    process.env['ENV_FILE'],
    resolve(process.cwd(), '.env'),
    resolve(__dirname, '../.env'),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (!existsSync(candidate)) {
      continue;
    }
    dotenv.config({ path: candidate, quiet: true });
    return candidate;
  }

  return null;
}

const loadedEnvFile = loadEnv();
console.log('Environment file:', loadedEnvFile ?? 'none found (using process environment only)');

// Set trust proxy headers EARLY - before Angular SSR engine is initialized
// This prevents the "x-forwarded-scheme header but trustProxyHeaders was not set" warning
if (!process.env['NG_TRUST_PROXY_HEADERS']) {
  process.env['NG_TRUST_PROXY_HEADERS'] = 'x-forwarded-for,x-forwarded-host,x-forwarded-port,x-forwarded-proto,x-forwarded-scheme';
}

// Browser distribution folder for SSR
// In production build, __dirname is dist/Nizam/server/, so browser is at ../browser
const browserDistFolder = resolve(__dirname, '../browser');

// ─── Owner-only product fields & bundled catalog ──────────────────────────────

/**
 * Owner-only product fields. They must never reach a shopper-facing response:
 * every public catalog endpoint strips them and an admin-only endpoint serves
 * the purchase link instead.
 */
const OWNER_ONLY_PRODUCT_FIELDS = ['buyUrl', 'supplier'] as const;

/** Removes owner-only fields from a product document. */
function toPublicProduct(product: Record<string, any>): Record<string, any> {
  const clone: Record<string, any> = { ...product };
  for (const field of OWNER_ONLY_PRODUCT_FIELDS) {
    delete clone[field];
  }
  return clone;
}

/** Normalizes a catalog entry and strips owner-only fields in one step. */
function toPublicCatalogProduct(product: any): Record<string, any> {
  return toPublicProduct({
    ...product,
    basePrice: product?.basePrice ?? product?.price ?? 0,
    currency: product?.currency ?? 'USD',
    images: Array.isArray(product?.images) ? product.images : (product?.image ? [product.image] : []),
    variants: product?.variants ?? [],
    tags: product?.tags ?? [],
    isActive: product?.isActive ?? true,
    createdAt: product?.createdAt ? new Date(product.createdAt) : new Date(),
    updatedAt: product?.updatedAt ? new Date(product.updatedAt) : new Date(),
  });
}

/**
 * The storefront ships a bundled catalog (public/assets/products.json) that also
 * carries owner-only purchase links. It is used whenever MongoDB is unreachable
 * so browsing, prices, sizes and owner tooling keep working.
 */
function loadBundledCatalog(): Record<string, any>[] {
  const candidates = [
    resolve(browserDistFolder, 'assets/products.json'),
    resolve(process.cwd(), 'public/assets/products.json'),
    resolve(__dirname, '../public/assets/products.json'),
  ];

  for (const candidate of candidates) {
    try {
      if (!existsSync(candidate)) {
        continue;
      }
      const parsed = JSON.parse(readFileSync(candidate, 'utf8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.warn('Failed to read bundled catalog:', candidate, error instanceof Error ? error.message : error);
    }
  }
  return [];
}

// Load Angular SSR manifests (only available in production build)
async function loadAngularManifests(): Promise<void> {
  try {
    // In production build, manifests are in the same directory as the server entry point
    const manifestDir = resolve(__dirname, '.');
    const appManifest = await import(`${manifestDir}/angular-app-manifest.mjs`);
    const engineManifest = await import(`${manifestDir}/angular-app-engine-manifest.mjs`);
    ɵsetAngularAppManifest(appManifest.default);
    ɵsetAngularAppEngineManifest(engineManifest.default);
  } catch (error) {
    // Manifests not available (development mode) - will fall back to CSR
    console.debug('Angular SSR manifests not found, falling back to CSR mode');
  }
}

// Initialize the SES client whenever a region is configured.
// Static keys are used when present; otherwise the AWS SDK default credential
// chain is used (environment variables, AWS_PROFILE / SSO, instance role).
let sesClient: any = null;
const sesRegion = process.env.SES_REGION;
if (sesRegion) {
  // Placeholder values from .env.example must not be treated as real keys: the
  // SDK would sign every request with them and fail with InvalidClientTokenId
  // instead of the actionable "could not load credentials" error.
  const PLACEHOLDER_CREDENTIALS = new Set([
    'your_access_key_here',
    'your_secret_access_key_here',
    'your_aws_access_key_id',
    'your_aws_secret_access_key',
    'AKIAIOSFODNN7EXAMPLE',
    'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
  ]);
  const staticAccessKeyId = (process.env.AWS_ACCESS_KEY_ID || '').trim();
  const staticSecretAccessKey = (process.env.AWS_SECRET_ACCESS_KEY || '').trim();
  const hasStaticCredentials =
    staticAccessKeyId.length > 0 &&
    staticSecretAccessKey.length > 0 &&
    !PLACEHOLDER_CREDENTIALS.has(staticAccessKeyId) &&
    !PLACEHOLDER_CREDENTIALS.has(staticSecretAccessKey);

  if ((staticAccessKeyId || staticSecretAccessKey) && !hasStaticCredentials) {
    console.warn(
      'AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY are placeholders, not real IAM keys; ignoring them and using the AWS SDK default credential chain (AWS_PROFILE / SSO / instance role).'
    );
  }

  sesClient = hasStaticCredentials
    ? new SESClient({
        region: sesRegion,
        credentials: {
          accessKeyId: staticAccessKeyId,
          secretAccessKey: staticSecretAccessKey
        }
      })
    : new SESClient({ region: sesRegion });

  console.log(
    `SES email delivery enabled (region: ${sesRegion}, credentials: ${hasStaticCredentials ? 'static keys' : 'AWS default credential chain'})`
  );
} else {
  // Email failures are handled gracefully - they are recorded but not sent via SES
  console.warn('SES email delivery disabled. Missing environment variable(s): SES_REGION');
}

// Verified sender email for SES.
// There is deliberately no silent fallback address: SES rejects any sender that
// is not a verified identity, and a hidden default turns a configuration error
// into what looks like a delivery outage.
const PLACEHOLDER_SENDERS = new Set(['your-email@example.com', 'your-verified-email@example.com']);
const verifiedSender = (process.env.SES_VERIFIED_SENDER || '').trim();
const isSenderConfigured =
  verifiedSender.length > 0 && !PLACEHOLDER_SENDERS.has(verifiedSender.toLowerCase());

if (sesClient && !isSenderConfigured) {
  console.warn(
    verifiedSender
      ? `SES_VERIFIED_SENDER ("${verifiedSender}") is a placeholder value, not a verified SES identity; email delivery will fail. Verify it in SES (region ${sesRegion}).`
      : `SES_VERIFIED_SENDER is not set; email delivery will fail. Set it to an identity verified in SES (region ${sesRegion}).`
  );
}

// Initialize Express app
const app = express();

// ✅ Fix: Trust proxy headers for GitHub Codespaces (x-forwarded-*)
app.enable('trust proxy');

// Required middleware - order matters!
// (Body parser, CORS, and global guard are registered later after DB init,
// see around line 480 — the early registrations here were duplicates.)

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
// Order docum

// ============================================================================
// PRICE COMPARISON TYPES & INTERFACES
// ============================================================================
// Try iwht other distributoins main ones also
//snitch, nabero, nyka,westside and small ones also, redirect to ammawears adn try to buy from them and sale at easy prices.

interface CompetitorPrice {
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

interface PriceComparisonProduct {
  _id?: ObjectId;
  ammawearsProductId: string; // Reference to our product
  name: string;
  description: string;
  category: string;
  brand?: string;
  attributes: Record<string, string>; // e.g., { "fabric": "cotton", "fit": "oversized", "pattern": "graphic" }
  images: string[];
  competitorPrices: CompetitorPrice[];
  bestPrice: {
    source: string;
    price: number;
    totalPrice: number; // price + delivery
    url: string;
  } | null;
  priceHistory: Array<{
    date: Date;
    source: string;
    price: number;
  }>;
  createdAt: Date;
  updatedAt: Date;
  isActive: boolean;
}

interface ApiPartner {
  _id?: ObjectId;
  name: string;
  email: string;
  website?: string;
  apiKey: string;
  apiSecret: string;
  tier: 'free' | 'starter' | 'pro' | 'enterprise';
  monthlyRequestLimit: number;
  currentMonthRequests: number;
  commissionRate: number; // Percentage commission on sales
  isActive: boolean;
  createdAt: Date;
  lastAccessedAt?: Date;
  allowedOrigins: string[];
  webhookUrl?: string;
}

interface PriceComparisonRequest {
  productId?: string;
  name?: string;
  category?: string;
  brand?: string;
  attributes?: Record<string, string>;
  limit?: number;
}

interface PriceComparisonResponse {
  success: boolean;
  product?: PriceComparisonProduct;
  comparisons?: Array<{
    source: string;
    price: number;
    originalPrice?: number;
    discountPercent?: number;
    availability: string;
    sellerName?: string;
    deliveryDays?: number;
    deliveryCharge?: number;
    totalPrice: number;
    url: string;
    lastUpdated: Date;
  }>;
  bestDeal?: {
    source: string;
    price: number;
    totalPrice: number;
    savings: number;
    savingsPercent: number;
    url: string;
  };
  message?: string;
}
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
  // Fulfillment tracking fields
  fulfillmentService?: 'qikink' | 'printful' | 'manual';
  fulfillmentStatus?: 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled';
  fulfillmentOrderId?: string;
  fulfillmentTrackingNumber?: string;
  fulfillmentCarrier?: string;
  fulfillmentEstimatedDelivery?: Date;
  fulfillmentUpdatedAt?: Date;
  createdAt: Date;
  updatedAt?: Date;
}

interface ProductCreateDto {
  name: string;
  description: string;
  basePrice: number | string;
  currency: string;
  category: string;
  images?: string[];
  variants?: Array<{ id?: string; name?: string; price?: number }>;
  tags?: string[];
  isActive?: boolean;
  /** Owner-only supplier checkout link; stripped from public responses. */
  buyUrl?: string;
  /** Owner-only supplier reference; stripped from public responses. */
  supplier?: string;
}

interface WishlistItem {
  productId: ObjectId;
  variantId: ObjectId | null;
  addedAt: Date;
  notes: string;
}

interface WishlistDocument {
  _id: ObjectId;
  userId: ObjectId;
  name: string;
  items: WishlistItem[];
  isPublic: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface ProductDocument {
  _id: ObjectId;
  name: string;
  description: string;
  basePrice: number;
  currency: string;
  category: string;
  images: string[];
  variants: any[];
  tags: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  /** Owner-only supplier checkout link. Never returned by public endpoints. */
  buyUrl?: string;
  /** Owner-only supplier reference. Never returned by public endpoints. */
  supplier?: string;
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

// Qikink Configuration
const qikinkApiKey = process.env['QIKINK_API_KEY'] || '';
const qikink = qikinkApiKey ? true : false;
console.log('Qikink API Key:', qikinkApiKey ? 'SET' : 'NOT SET');
console.log('Qikink integration:', qikink ? 'ENABLED' : 'DISABLED');

// Printful Configuration
const printfulApiKey = process.env['PRINTFUL_API_KEY'] || '';
const printful = printfulApiKey ? true : false;
console.log('Printful API Key:', printfulApiKey ? 'SET' : 'NOT SET');
console.log('Printful integration:', printful ? 'ENABLED' : 'DISABLED');

const appUrl = process.env['APP_URL'] || 'http://localhost:4200';

// JWT Configuration
if (!process.env.JWT_SECRET) {
  console.error('JWT_SECRET is missing from the runtime environment.');
  console.error('Set it in the Render dashboard (Environment) or define it in a local .env file.');
  throw new Error('JWT_SECRET must be set in the runtime environment');
}
const jwtSecret = process.env.JWT_SECRET;
const jwtExpiresIn = '30d';

/**
 * Resolve the authenticated user for a request.
 *
 * A supplied token is ALWAYS verified, so real user accounts work in every
 * environment. Only when no token is supplied does development mode fall back
 * to a sandbox user (production returns null so the caller can send a 401).
 */
function resolveRequestUser(req: Request): { userId: string; email: string; role?: string; isDev?: boolean } | null {
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    if (token) {
      try {
        return jwt.verify(token, jwtSecret) as { userId: string; email: string; role?: string };
      } catch (err) {
        // A token that is expired, malformed, or signed with a different JWT_SECRET
        // (e.g. the secret was rotated) must never crash the request. Treat it as
        // "not authenticated" so the caller responds with 401 and the client can
        // clear the stale session, instead of throwing an unhandled error.
        console.warn('Rejected bearer token:', err instanceof Error ? err.message : err);
        return null;
      }
    }
  }

  if (process.env.NODE_ENV !== 'production') {
    return { userId: '000000000000000000000001', email: 'dev@local.com', isDev: true };
  }

  return null;
}

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
  allowedHeaders: ['Content-Type', 'Authorization']
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

  const frontendCurrency = String(currency || 'USD').toUpperCase();

  // Re-price the order from the catalog so a tampered or stale cart cannot set
  // the amount Razorpay charges.
  const priced = await priceOrderItems(items);
  if (!priced.ok) {
    return res.status(400).json({ success: false, message: priced.message });
  }

  const resolved = resolveOrderTotal(priced, total, frontendCurrency, '[Razorpay]');
  if (!resolved.ok) {
    return res.status(400).json({ success: false, message: resolved.message });
  }
  const orderTotal = resolved.total;

  // Convert the order total from the shopper's currency to INR for Razorpay.
  const frontendRate = serverRates[frontendCurrency] ?? 1;
  const inrRate = serverRates['INR'] ?? 95.21;

  // Convert: order total (in frontend currency) -> USD -> INR
  const totalInUsd = orderTotal / frontendRate;
  const totalInInr = totalInUsd * inrRate;

  // Convert to paise (smallest unit for INR)
  const amountInPaise = Math.round(totalInInr * 100);

  console.log(`[Razorpay] Frontend currency: ${frontendCurrency}, Total: ${orderTotal}, USD: ${totalInUsd.toFixed(2)}, INR: ${totalInInr.toFixed(2)}, Paise: ${amountInPaise}`);

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
    
    const order: OrderDocument = {
      orderReference,
      name,
      email,
      address: address || '',
      items: priced.items,
      total: orderTotal,
      currency: frontendCurrency, // total is expressed in the shopper's currency
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

async function createQikinkOrder(orderData: Record<string, any>) {
  try {
    const response = await fetch('https://api.qikink.com/v1/orders', {
      method: 'POST',
      headers: {
        'Authorization': `ApiKey ${process.env.QIKINK_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(orderData)
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Qikink API error: ${errorText}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Error creating Qikink order:', error);
    throw error;
  }
}

app.post('/api/create-qikink-order', async (req, res) => {
  // Guard against invalid response object
  if (!res || typeof res !== 'object' || typeof res.headersSent !== 'boolean') {
    console.error('Invalid response object in create-qikink-order');
    return;
  }
  try {
    const { name, email, address, items, total, currency } = req.body;
    if (!name || !email || !Array.isArray(items) || typeof total !== 'number') {
      return res.status(400).json({ success: false, message: 'Name, email, items, and total are required.' });
    }
    const orderReference = `QK-${Date.now()}`;
    const qikinkOrderData = {
      customer_name: name,
      customer_email: email,
      items: items.map(item => ({
        product_name: item.product?.name || 'Unnamed Product',
        quantity: item.quantity || 1,
        price: item.price || 0
      })),
      total_amount: total,
      currency_code: currency || 'INR'
    };
    const qikinkResponse = await createQikinkOrder(qikinkOrderData);
    const ordersCollection = await getOrdersCollection();
    const normalizedItems = items.map(item => {
      const price = item.price ?? item.product?.basePrice ?? 0;
      const productName = item.product?.name || 'Unnamed Item';
      return {
        product: { name: productName, price },
        quantity: typeof item.quantity === 'number' && item.quantity > 0 ? item.quantity : 1
      };
    });
    const newOrder = {
      orderReference,
      name,
      email,
      address: address || '',
      items: normalizedItems,
      total,
      currency: currency || 'INR',
      paymentMethod: 'Qikink',
      status: 'pending',
      createdAt: new Date(),
      qikinkOrderId: qikinkResponse?.id || ''
    };
    await ordersCollection.insertOne(newOrder);
    return res.status(200).json({
      success: true,
      orderReference,
      qikinkOrderId: qikinkResponse?.id,
      message: 'Order placed with Qikink successfully.'
    });
  } catch (error) {
    console.error('Create Qikink Order error:', error);
    return res.status(500).json({ success: false, message: 'Unable to create Qikink order.' });
  }
});

// Printful Integration Endpoint
async function createPrintfulOrder(orderData: Record<string, any>) {
  try {
    const response = await fetch('https://api.printful.com/store/products', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.PRINTFUL_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(orderData)
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Printful API error: ${errorText}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Error creating Printful order:', error);
    throw error;
  }
}

app.post('/api/create-printful-order', async (req, res) => {
  // Guard against invalid response object
  if (!res || typeof res !== 'object' || typeof res.headersSent !== 'boolean') {
    console.error('Invalid response object in create-printful-order');
    return;
  }
  try {
    const { name, email, address, items, total, currency, designId } = req.body;
    if (!name || !email || !Array.isArray(items) || typeof total !== 'number' || !designId) {
      return res.status(400).json({ success: false, message: 'Name, email, items, total, and designId are required.' });
    }
    const orderReference = `PF-${Date.now()}`;
    const printfulResponse = await createPrintfulOrder({
      design_id: designId,
      name: name,
      variants: items.map(item => ({
        quantity: item.quantity || 1,
        external_product_id: item.product?.id || ''
      }))
    });
    const ordersCollection = await getOrdersCollection();
    const normalizedItems = items.map(item => {
      const price = item.price ?? item.product?.basePrice ?? 0;
      const productName = item.product?.name || 'Unnamed Item';
      return {
        product: { name: productName, price },
        quantity: typeof item.quantity === 'number' && item.quantity > 0 ? item.quantity : 1
      };
    });
    const newOrder = {
      orderReference,
      name,
      email,
      address: address || '',
      items: normalizedItems,
      total,
      currency: currency || 'USD',
      paymentMethod: 'Printful',
      status: 'pending',
      createdAt: new Date(),
      printfulProductId: printfulResponse?.result?.id || ''
    };
    await ordersCollection.insertOne(newOrder);
    return res.status(200).json({
      success: true,
      orderReference,
      printfulProductId: printfulResponse?.result?.id,
      message: 'Printful order created successfully.'
    });
  } catch (error) {
    console.error('Create Printful Order error:', error);
    return res.status(500).json({ success: false, message: 'Unable to create Printful order.' });
  }
});
// Lazy initialization of AngularNodeAppEngine to handle both dev and production
// In dev mode (Vite), we try to create the engine; if it fails, we fall back to CSR.
let angularApp: AngularNodeAppEngine | null = null;

async function getAngularApp(): Promise<AngularNodeAppEngine | null> {
  if (!angularApp) {
    try {
      // Load Angular SSR manifests (only available in production build)
      await loadAngularManifests();
      
      // Set allowed hosts via environment variables if not already set
      if (!process.env['NG_ALLOWED_HOSTS']) {
        process.env['NG_ALLOWED_HOSTS'] = 'localhost,localhost:4000,localhost:4200,verbose-cod-96rq44v9pjh7r69-4000.app.github.dev,*.app.github.dev';
      }
      // Set trust proxy headers to allow X-Forwarded-* headers
      if (!process.env['NG_TRUST_PROXY_HEADERS']) {
        process.env['NG_TRUST_PROXY_HEADERS'] = 'x-forwarded-for,x-forwarded-host,x-forwarded-port,x-forwarded-proto';
      }
      
      // Try to create the engine. This will work in:
      // - Production: when the manifest exists (built with ng build)
      // - Development SSR mode (ng run <project>:serve-ssr): when the Angular CLI sets up the environment
      // It will fail in a pure client-side dev setup (ng serve) but we catch the error and fall back to CSR.
      angularApp = new AngularNodeAppEngine();
      console.log('Angular SSR engine initialized successfully');
    } catch (error) {
      console.warn('AngularNodeAppEngine initialization failed:', error instanceof Error ? error.message : error);
      // Fall back to null to indicate SSR not available
      angularApp = null;
    }
  }
  return angularApp;
}

// SES client and verified sender are initialized at the top of the file


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

// Simple test endpoint for smoke tests and basic health checking
app.get('/api/test', (req, res) => {
  res.json({ success: true, message: 'Test endpoint OK' });
});
app.post('/api/test', (req, res) => {
  res.json({ success: true, message: 'Test endpoint OK' });
});

// Simple server-side currency rates (relative to USD).
// These MUST match the client's CurrencyService rates, otherwise the totals the
// frontend sends will not reconcile with the item prices converted here.
const serverRates: Record<string, number> = {
  USD: 1,
  INR: 95.21,
  AED: 3.67,
  SAR: 3.73,
};
let mongoInitPromise: Promise<void> | null = null;

function formatCurrency(amount: number, currency = 'USD') {
  const symbol = currency === 'INR' ? '₹' : currency === 'AED' ? 'د.إ ' : currency === 'SAR' ? '﷼ ' : '$';
  return `${symbol}${amount.toFixed(2)}`;
}

// Product/cart prices are stored as USD base amounts, while the order total is
// sent in the shopper's selected currency. Convert the base amounts into the
// order currency so every line of the email is in one single currency.
function convertFromUsd(amountUsd: number, currency = 'USD') {
  const rate = serverRates[(currency || 'USD').toUpperCase()] ?? 1;
  return amountUsd * rate;
}

// ---- Order pricing -------------------------------------------------------
// Catalog prices are USD base amounts. The browser also sends its own `total`
// in the shopper's currency, so the server re-prices every order from the
// catalog and compares instead of trusting the client amount.
//
// Items are resolved by Mongo `_id` (the /api/products response) or by the
// numeric `id` (the bundled products.json fallback), so both cart sources are
// priced authoritatively.
const TOTAL_TOLERANCE = 0.01;

function roundCurrency(amount: number) {
  return Math.round(amount * 100) / 100;
}

async function lookupCatalogPriceUsd(productId: unknown): Promise<number | null> {
  const raw = productId === undefined || productId === null ? '' : String(productId).trim();
  if (!raw) {
    return null;
  }

  const lookups: any[] = [];
  if (/^[a-f\d]{24}$/i.test(raw)) {
    lookups.push({ _id: new ObjectId(raw) });
  }
  const asNumber = Number(raw);
  if (Number.isFinite(asNumber)) {
    lookups.push({ id: asNumber });
  }
  lookups.push({ id: raw });

  const productsCollection = await getProductsCollection();
  const product: any = await productsCollection.findOne({ $or: lookups });
  const price = product?.basePrice ?? product?.price;
  return typeof price === 'number' && price > 0 ? price : null;
}

interface PricedOrderItem {
  product: { name: string; price: number };
  quantity: number;
}

type PricingResult =
  | { ok: true; items: PricedOrderItem[]; subtotalUsd: number; pricedFromCatalog: boolean }
  | { ok: false; message: string };

async function priceOrderItems(rawItems: unknown[]): Promise<PricingResult> {
  if (rawItems.length === 0) {
    return { ok: false, message: 'At least one item is required.' };
  }

  const items: PricedOrderItem[] = [];
  let catalogPricedCount = 0;

  for (const rawItem of rawItems) {
    if (!rawItem || typeof rawItem !== 'object') {
      return { ok: false, message: 'Each item must be an object' };
    }

    const item: any = rawItem;
    const product: any = item.product && typeof item.product === 'object' ? item.product : {};

    // Client-supplied price - only used when the product is no longer in the catalog.
    let clientPrice: number | undefined;
    if (typeof item.price === 'number' && item.price > 0) {
      clientPrice = item.price;
    } else if (typeof product.basePrice === 'number' && product.basePrice > 0) {
      clientPrice = product.basePrice;
    } else if (typeof product.price === 'number' && product.price > 0) {
      clientPrice = product.price;
    }

    const quantity = typeof item.quantity === 'number' && item.quantity > 0 ? item.quantity : 1;

    let unitPriceUsd: number | null = null;
    try {
      unitPriceUsd = await lookupCatalogPriceUsd(product.id ?? product._id ?? item.productId);
    } catch (error) {
      console.warn(
        'Order pricing: catalog lookup failed, falling back to the client price:',
        error instanceof Error ? error.message : error
      );
    }

    if (unitPriceUsd === null) {
      if (clientPrice === undefined || clientPrice <= 0) {
        return { ok: false, message: 'Each item must have a valid positive price' };
      }
      unitPriceUsd = clientPrice;
    } else {
      catalogPricedCount += 1;
    }

    items.push({
      product: { name: product.name || `Item ${items.length + 1}`, price: unitPriceUsd },
      quantity,
    });
  }

  const subtotalUsd = items.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
  return {
    ok: true,
    items,
    subtotalUsd,
    pricedFromCatalog: catalogPricedCount === rawItems.length,
  };
}

// Returns the amount the order must be stored and charged with.
function resolveOrderTotal(
  priced: { subtotalUsd: number; pricedFromCatalog: boolean },
  claimedTotal: number,
  currency: string,
  context: string
): { ok: true; total: number } | { ok: false; message: string } {
  if (!priced.pricedFromCatalog) {
    // A product is missing from the catalog (for example a deleted product), so
    // the client total is the only remaining source. Keep the order flowing.
    console.warn(`${context}: could not price every item from the catalog; using the client total.`);
    return { ok: true, total: roundCurrency(claimedTotal) };
  }

  const catalogTotal = roundCurrency(convertFromUsd(priced.subtotalUsd, currency));
  if (Math.abs(catalogTotal - roundCurrency(claimedTotal)) > TOTAL_TOLERANCE) {
    console.warn(
      `${context}: rejected order - client total ${claimedTotal} ${currency} does not match catalog total ${catalogTotal} ${currency}`
    );
    return {
      ok: false,
      message: 'Your cart total is out of date. Please refresh the page and try again.',
    };
  }

  return { ok: true, total: catalogTotal };
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

// Get or create reviews collection
async function getReviewsCollection() {
  await ensureMongoDBInitialized();

  if (!db) {
    throw new Error('MongoDB not connected');
  }
  return db.collection('reviews');
}

// Get or create price comparison collection
export async function getPriceComparisonsCollection() {
  await ensureMongoDBInitialized();

  if (!db) {
    throw new Error('MongoDB not connected');
  }
  const collection = db.collection('price_comparisons');
  
  // Create indexes for efficient querying
  await collection.createIndexes([
    { key: { ammawearsProductId: 1 }, unique: true },
    { key: { name: 'text', description: 'text', brand: 'text', category: 'text' } },
    { key: { category: 1, brand: 1 } },
    { key: { 'competitorPrices.source': 1, 'competitorPrices.price': 1 } },
    { key: { updatedAt: -1 } }
  ]);
  
    return collection;
}


/**
 * End of price comparison collection helper.
 */

// Get or create API partners collection
async function getApiPartnersCollection() {
  await ensureMongoDBInitialized();

  if (!db) {
    throw new Error('MongoDB not connected');
  }
  const collection = db.collection('api_partners');
  
  // Create indexes
  await collection.createIndexes([
    { key: { apiKey: 1 }, unique: true },
    { key: { email: 1 }, unique: true },
    { key: { isActive: 1 } }
  ]);
  
  return collection;
}

async function sendEmail(params: { to: string | string[]; subject: string; text: string; html: string }) {
  const { to, subject, text, html } = params;
  if (!sesClient) {
    throw new Error('Email service is not configured. Missing environment variable(s): SES_REGION');
  }
  if (!isSenderConfigured) {
    throw new Error('Email service is not configured. SES_VERIFIED_SENDER must be a verified SES identity.');
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

  try {
    const result = await sesClient.send(command);
        console.log(`Email sent successfully to ${(Array.isArray(to) ? to : [to]).join(', ')}`);
    return result;
  } catch (error: unknown) {
    console.error('Failed to send email:', error);
    throw new Error(`Email delivery failed: ${error instanceof Error ? error.message : String(error)}`);
  }
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
  currency?: string;
}) {
  const { name, email, items, total, orderReference, paymentMethod, currency } = params;
  const orderCurrency = (currency || 'USD').toUpperCase();
  const methodLabel = paymentMethod === 'COD' ? 'Cash on Delivery (COD)' : 'Card payment';
  const itemRows = items.map((item) => {
    const price = convertFromUsd(item.product.price ?? item.product.basePrice ?? 0, orderCurrency);
    const productName = item.product.name || 'Unnamed Item';
    return `
    <tr>
      <td>${productName}</td>
      <td>${item.quantity}</td>
      <td>${formatCurrency(price, orderCurrency)}</td>
      <td>${formatCurrency(price * item.quantity, orderCurrency)}</td>
    </tr>
  `}).join('');

  const itemText = items.map((item) => {
    const price = convertFromUsd(item.product.price ?? item.product.basePrice ?? 0, orderCurrency);
    const productName = item.product.name || 'Unnamed Item';
    return `${item.quantity} x ${productName} @ ${formatCurrency(price, orderCurrency)} = ${formatCurrency(price * item.quantity, orderCurrency)}`;
  }).join('\n');

  return {
    subject: `Order confirmation — ${orderReference}`,
    text: `Thank you for your order, ${name}!\n\nOrder reference: ${orderReference}\nPayment method: ${methodLabel}\n\nItems:\n${itemText}\n\nTotal: ${formatCurrency(total, orderCurrency)}\n\nWe will ship to:\n${email}\n\nFor dropshipping or wholesale inquiries, email sudhir.22sep@gmail.com.`,
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
      <p><strong>Total: ${formatCurrency(total, orderCurrency)}</strong></p>
      <p>We will ship your order shortly.</p>
      <p>For dropshipping or wholesale inquiries, email <strong>sudhir.22sep@gmail.com</strong>.</p>`,
  };
}

async function trySendEmail(params: { to: string | string[]; subject: string; text: string; html: string }) {
  try {
    await sendEmail(params);
    console.log('Email sent successfully');
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
    const notificationRecipient = process.env.CONTACT_RECIPIENT_EMAIL || verifiedSender;
    const sent = await trySendEmail({
      to: notificationRecipient,
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

    // Split the full name into firstName/lastName to match the auth endpoints
    // and the UserDocument schema (firstName + lastName).
    const [firstName = '', ...lastNameParts] = name.trim().split(/\s+/);
    const lastName = lastNameParts.join(' ');

    if (!firstName || !lastName) {
      return res.status(400).json({ success: false, message: 'Name must include both a first name and a last name.' });
    }

    // Check if user already exists
    const existingUser = await usersCollection.findOne({ email });
    if (existingUser) {
      // Update existing user
      await usersCollection.updateOne(
        { email },
        {
          $set: {
            firstName,
            lastName,
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
      firstName,
      lastName,
      email,
      phone: phone || '',
      address: address || '',
      addresses: [],
      createdAt: new Date(),
      isActive: true,
      role: 'user',
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
  let decoded: { userId: string; email: string; role?: string; isDev?: boolean } | null;

  try {
    decoded = resolveRequestUser(req);
  } catch (error) {
    console.error('JWT verification error:', error);
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }

  if (!decoded) {
    return res.status(401).json({ success: false, message: 'Authorization header required' });
  }

  req.user = decoded;
  next();
  return;
}
app.post('/api/auth/logout', (req: Request, res: Response) => {
  // JWT is stateless - logout is handled client-side by deleting the token
  // This endpoint exists for API consistency and potential future token blacklisting
  return res.status(200).json({ success: true, message: 'Logged out successfully.' });
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

    const orderCurrency = String(currency || 'USD').toUpperCase();

    // Re-price the order from the catalog so a tampered or stale cart cannot set
    // the amount recorded for the order (and charged, for online payments).
    const priced = await priceOrderItems(items);
    if (!priced.ok) {
      return res.status(400).json({ 
        success: false, 
        message: priced.message 
      });
    }

    const resolved = resolveOrderTotal(priced, total, orderCurrency, '[COD]');
    if (!resolved.ok) {
      return res.status(400).json({ 
        success: false, 
        message: resolved.message 
      });
    }
    const orderTotal = resolved.total;

    const orderReference = `ORDER-${Date.now()}`;
    const ordersCollection = await getOrdersCollection();

    const order = {
      orderReference,
      name,
      email,
      address,
      items: priced.items,
      total: orderTotal,
      currency: orderCurrency,
      paymentMethod: 'COD',
      status: 'pending',
      createdAt: new Date()
    };

    await ordersCollection.insertOne(order);

    const mail = buildOrderConfirmationMessage({ 
      name, email, items: priced.items, total: orderTotal, 
      orderReference, paymentMethod: 'COD', currency: orderCurrency 
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
    const currentUser = (req as Request & { user?: { email?: string; role?: string } }).user;

    const filter: any = {};
    if (currentUser?.role === 'admin') {
      if (email) filter.email = email;
    } else {
      // Customers may only list their own orders
      filter.email = currentUser?.email;
    }
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

    // Customers may only read their own orders; admins may read any order
    const currentUser = (req as Request & { user?: { email?: string; role?: string } }).user;
    if (currentUser?.role !== 'admin' && order.email !== currentUser?.email) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    return res.json({ success: true, order });
  } catch (err) {
    console.error('get order error', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch order' });
  }
});

// PATCH /api/orders/:orderReference/status - Update order status
app.patch('/api/orders/:orderReference/status', authenticateJwt, async (req, res) => {
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
        currency: order.currency,
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
            currency: order.currency,
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
// Qikink Webhook Handler
app.post('/api/qikink-webhook', async (req, res) => {
  // Verify Qikink signature if required
  // For now, we'll assume Qikink uses a simple API key check in headers
  if (!req.headers.authorization || !req.headers.authorization.startsWith('ApiKey ')) {
    return res.status(401).json({ success: false, message: 'Missing or invalid Qikink API key in headers' });
  }

  try {
    const rawBody = req.body instanceof Buffer ? req.body.toString('utf8') : JSON.stringify(req.body);
    const qikinkEvent = JSON.parse(rawBody);

    // Handle Qikink fulfillment events
    if (qikinkEvent.event_type === 'order.shipped') {
      const orderRef = qikinkEvent.order_reference;
      const trackingNumber = qikinkEvent.tracking_number;
      const estimatedDelivery = new Date(qikinkEvent.estimated_delivery);

      const ordersCollection = await getOrdersCollection();
      const order = await ordersCollection.findOne({ orderReference: orderRef });

      if (order) {
        await ordersCollection.updateOne(
          { orderReference: orderRef },
          {
            $set: {
              fulfillmentStatus: 'shipped',
              fulfillmentService: 'qikink',
              fulfillmentOrderId: qikinkEvent.order_id,
              fulfillmentTrackingNumber: trackingNumber,
              fulfillmentEstimatedDelivery: estimatedDelivery,
              fulfillmentUpdatedAt: new Date()
            }
          }
        );

        return res.status(200).json({ success: true, message: `Qikink order ${orderRef} shipped successfully` });
      } else {
        return res.status(404).json({ success: false, message: 'Order not found in database' });
      }
    }
    // Add more event types as needed
    else {
      return res.status(200).json({ success: true, message: 'Qikink webhook received (unhandled event)' });
    }
  } catch (error) {
    console.error('Qikink webhook error:', error);
    return res.status(500).json({ success: false, message: String(error) });
  }
});

// Printful Webhook Handler
app.post('/api/printful-webhook', async (req, res) => {
  // Printful uses webhook verification via signature
  // Implementation depends on Printful's webhook documentation
  try {
    const rawBody = req.body instanceof Buffer ? req.body.toString('utf8') : JSON.stringify(req.body);
    const printfulEvent = JSON.parse(rawBody);

    // Handle Printful fulfillment events
    if (printfulEvent.event === 'order.shipped') {
      const orderRef = printfulEvent.order_reference;
      const trackingNumber = printfulEvent.tracking_number;
      const estimatedDelivery = new Date(printfulEvent.estimated_delivery);

      const ordersCollection = await getOrdersCollection();
      const order = await ordersCollection.findOne({ orderReference: orderRef });

      if (order) {
        await ordersCollection.updateOne(
          { orderReference: orderRef },
          {
            $set: {
              fulfillmentStatus: 'shipped',
              fulfillmentService: 'printful',
              fulfillmentOrderId: printfulEvent.order_id,
              fulfillmentTrackingNumber: trackingNumber,
              fulfillmentEstimatedDelivery: estimatedDelivery,
              fulfillmentUpdatedAt: new Date()
            }
          }
        );

        res.status(200).json({ success: true, message: `Printful order ${orderRef} shipped successfully` });
      } else {
        res.status(404).json({ success: false, message: 'Order not found in database' });
      }
    }
    // Add more event types as needed
    else {
      res.status(200).json({ success: true, message: 'Printful webhook received (unhandled event)' });
    }
  } catch (error) {
    console.error('Printful webhook error:', error);
    res.status(500).json({ success: false, message: String(error) });
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
// POST register a new user

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
    
    const [rawProducts, total] = await Promise.all([
      productsCollection
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .toArray(),
      productsCollection.countDocuments(filter)
    ]);

    let products = rawProducts.map(toPublicCatalogProduct);
    let totalCount = total;

    if (products.length === 0) {
      // MongoDB resolved but holds no products (for example an unseeded
      // environment): serve the bundled catalog so the shop still works.
      const bundled = loadBundledCatalog();
      if (bundled.length > 0) {
        products = bundled.map(toPublicCatalogProduct);
        totalCount = bundled.length;
      }
    }

    return res.json({ success: true, products, total: totalCount, page: Number(page), limit: Number(limit) });
  } catch (error) {
    console.error("Get products error:", error);
    // MongoDB unavailable: fall back to the bundled catalog so shoppers can still
    // browse real products, prices and sizes. Owner-only fields stay stripped.
    const bundled = loadBundledCatalog();
    if (bundled.length > 0) {
      return res.json({
        success: true,
        products: bundled.map(toPublicCatalogProduct),
        total: bundled.length,
        page: 1,
        limit: bundled.length,
        source: 'bundled',
      });
    }
    return res.status(500).json({ success: false, message: "Failed to fetch products" });
  }
});

app.get('/api/products/:id/', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      // Bundled catalog ids (for example "0") are not Mongo ObjectIds.
      const bundled = loadBundledCatalog().find(candidate => String(candidate.id) === id);
      if (bundled) {
        return res.json({ success: true, product: toPublicCatalogProduct(bundled), source: 'bundled' });
      }
      return res.status(400).json({ success: false, message: "Invalid product id" });
    }

    const productsCollection = await getProductsCollection();
    const product = await productsCollection.findOne({ _id: new ObjectId(id) });
    
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }
    
    // Owner-only fields (buyUrl/supplier) never leave the server here.
    return res.json({ success: true, product: toPublicProduct(product) });
  } catch (error) {
    console.error("Get product by ID error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch product" });
  }
});

app.post('/api/products/', async (req: Request & { body: ProductCreateDto }, res: Response) => {
  try {
    const productsCollection = await getProductsCollection();
    const { name, description, basePrice, currency, category, images, variants, tags, isActive, buyUrl, supplier } = req.body;
    
    if (!name || !description || !basePrice || !currency || !category) {
      return res.status(400).json({ success: false, message: "Name, description, basePrice, currency, and category are required" });
    }
    
    const product: ProductDocument = {
      _id: new ObjectId(),
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

    // Owner-only fields are persisted but never returned by public endpoints.
    if (typeof buyUrl === 'string') {
      product.buyUrl = buyUrl;
    }
    if (typeof supplier === 'string') {
      product.supplier = supplier;
    }
    
    const result = await productsCollection.insertOne(product);
    product._id = result.insertedId;
    
    return res.status(201).json({ success: true, message: "Product created successfully", product });
  } catch (error) {
    console.error("Create product error:", error);
    return res.status(500).json({ success: false, message: "Failed to create product" });
  }
});

app.put('/api/products/:id/', async (req: Request, res: Response) => {
  try {
    const productsCollection = await getProductsCollection();
    const { name, description, basePrice, currency, category, images, variants, tags, isActive, buyUrl, supplier } = req.body;
    
    const updateData: any = {};
    
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (basePrice !== undefined) updateData.basePrice = Number(basePrice);
    if (currency !== undefined) updateData.currency = currency;
    if (category !== undefined) updateData.category = category;
    if (images !== undefined) updateData.images = images;
    if (variants !== undefined) updateData.variants = variants;
    if (tags !== undefined) updateData.tags = tags;
    if (isActive !== undefined) updateData.isActive = isActive;
    // Owner-only fields (never returned by public endpoints).
    if (buyUrl !== undefined) updateData.buyUrl = buyUrl;
    if (supplier !== undefined) updateData.supplier = supplier;
    
    updateData.updatedAt = new Date();
    
    const result = await productsCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: updateData }
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }
    
    return res.json({ success: true, message: "Product updated successfully" });
  } catch (error) {
    console.error("Update product error:", error);
    return res.status(500).json({ success: false, message: "Failed to update product" });
  }
});

// ─── Product Image Gallery Endpoints ───────────────────────────────────────────

/**
 * Add an image to a product's gallery.
 * The image URL/path is validated and appended to the product's images array.
 */
app.post('/api/products/:id/images', async (req: Request, res: Response) => {
  try {
    const { image } = req.body;

    if (!image || typeof image !== 'string') {
      return res.status(400).json({ success: false, message: 'Image URL/path is required.' });
    }

    const imageValue = image.trim();
    if (!imageValue) {
      return res.status(400).json({ success: false, message: 'Image URL/path is required.' });
    }

    // Accept root-relative paths and fully qualified URLs (https/http).
    // This keeps images portable across environments while rejecting unsafe schemes.
    if (!/^(https?:)?\/\//i.test(imageValue) && !imageValue.startsWith('/')) {
      return res.status(400).json({ success: false, message: 'Image URL/path is invalid.' });
    }

    const productsCollection = await getProductsCollection();
    const result = await productsCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $push: { images: imageValue }, $set: { updatedAt: new Date() } } as any
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    return res.status(201).json({ success: true, message: 'Image added to product.', image: imageValue });
  } catch (error) {
    console.error('Add product image error:', error);
    return res.status(500).json({ success: false, message: 'Failed to add image to product' });
  }
});

/**
 * Remove an image from a product's gallery by index.
 * Splice out the image at the given index and update the array.
 */
app.delete('/api/products/:id/images/:index', async (req: Request, res: Response) => {
  try {
    const index = Number.parseInt(req.params.index, 10);

    if (isNaN(index) || index < 0) {
      return res.status(400).json({ success: false, message: 'Invalid image index.' });
    }

    const productsCollection = await getProductsCollection();
    const product = await productsCollection.findOne({ _id: new ObjectId(req.params.id) });

    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    // Remove the image at the specified index using splice
    const updatedImages = [...(product.images || [])];
    updatedImages.splice(index, 1);

    await productsCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { images: updatedImages, updatedAt: new Date() } }
    );

    return res.json({ success: true, message: 'Image removed from product.' });
  } catch (error) {
    console.error('Remove product image error:', error);
    return res.status(500).json({ success: false, message: 'Failed to remove image from product' });
  }
});

/**
 * Owner/backend-only purchase link for a product.
 *
 * `buyUrl` and `supplier` are stripped from every shopper-facing product
 * response, so the purchase link is only reachable here, behind an
 * authenticated admin token (or the development sandbox user).
 */
app.get('/api/admin/products/:id/purchase-link', authenticateJwt, async (req: Request & { user?: any }, res: Response) => {
  try {
    const isAdmin = req.user?.role === 'admin';
    const isLocalDev = req.user?.isDev === true && process.env['NODE_ENV'] !== 'production';

    if (!isAdmin && !isLocalDev) {
      return res.status(403).json({ success: false, message: 'Admin access required' });
    }

    const { id } = req.params;
    let product: Record<string, any> | null = null;

    if (ObjectId.isValid(id)) {
      const productsCollection = await getProductsCollection();
      product = await productsCollection.findOne({ _id: new ObjectId(id) });
    } else {
      product = loadBundledCatalog().find(candidate => String(candidate.id) === id) ?? null;
    }

    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    return res.json({
      success: true,
      productId: product._id?.toString?.() ?? String(product.id ?? id),
      name: product.name ?? null,
      sku: product.sku ?? null,
      supplier: product.supplier ?? null,
      buyUrl: product.buyUrl ?? null,
    });
  } catch (error) {
    console.error('Get product purchase link error:', error);
    return res.status(500).json({ success: false, message: 'Failed to load purchase link' });
  }
});


app.delete('/api/products/:id/', async (req: Request, res: Response) => {
  try {
    const productsCollection = await getProductsCollection();
    
    const result = await productsCollection.deleteOne(
      { _id: new ObjectId(req.params.id) }
    );
    
    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }
    
    return res.json({ success: true, message: "Product deleted successfully" });
  } catch (error) {
    console.error("Delete product error:", error);
    return res.status(500).json({ success: false, message: "Failed to delete product" });
  }
});

// Wishlist API Endpoints
app.get('/api/wishlist', authenticateJwt, async (req, res) => {
  try {
    const wishlistsCollection = await getWishlistsCollection();
const userId = req.user?.userId;
    
    const wishlists = await wishlistsCollection.find({ userId: new (require("mongodb")).ObjectId(userId) }).toArray();
    
    // Convert ObjectId to string for frontend
    const wishlistsWithStringIds = wishlists.map(wishlist => ({
      ...wishlist,
      _id: wishlist._id.toString(),
      userId: wishlist.userId.toString(),
      items: wishlist.items.map((item: any) => ({
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
    const userId = req.user?.userId;
    
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
    
    return res.status(201).json({ success: true, message: "Wishlist created successfully", wishlist: {
      ...wishlist,
      _id: wishlist._id.toString(),
      userId: wishlist.userId.toString()
    }});
  } catch (error) {
    console.error("Create wishlist error:", error);
    return res.status(500).json({ success: false, message: "Failed to create wishlist" });
  }
});

app.get('/api/wishlist/:id', authenticateJwt, async (req, res) => {
  try {
    const wishlistsCollection = await getWishlistsCollection();
    const wishlistId = req.params.id;
    const userId = req.user?.userId;
    
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
      items: wishlist.items.map((item: any) => ({
        ...item,
        productId: item.productId.toString(),
        variantId: item.variantId ? item.variantId.toString() : null
      }))
    };
    
    return res.json({ success: true, wishlist: wishlistWithStringIds });
  } catch (error) {
    console.error("Get wishlist by ID error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch wishlist" });
  }
});

app.post('/api/wishlist/:id/items', authenticateJwt, async (req, res) => {
  try {
    const wishlistsCollection = await getWishlistsCollection();
    const wishlistId = req.params.id;
    const userId = req.user?.userId;
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
    const itemExists = wishlist.items.some((item: any) => 
      item.productId.equals(new (require("mongodb")).ObjectId(productId)) &&
      ((variantId === null && !item.variantId) || (item.variantId && item.variantId.equals(new (require("mongodb")).ObjectId(variantId))))
    );
    
    if (itemExists) {
      return res.status(409).json({ success: false, message: "Item already exists in wishlist" });
    }
    
    const newItem: any = {
      productId: new (require("mongodb")).ObjectId(productId),
      variantId: variantId ? new (require("mongodb")).ObjectId(variantId) : null,
      addedAt: new Date(),
      notes: notes || ""
    };
    
    await wishlistsCollection.updateOne(
      { _id: new (require("mongodb")).ObjectId(wishlistId) },
      { 
        $push: { items: newItem }, 
        $set: { updatedAt: new Date() } 
      } as any
    );
    
    return res.json({ success: true, message: "Item added to wishlist successfully" });
  } catch (error) {
    console.error("Add item to wishlist error:", error);
    return res.status(500).json({ success: false, message: "Failed to add item to wishlist" });
  }
});

// Remove an item from a wishlist.
// Registered for the frontend path (/items with productId/variantId in the body)
// and for the legacy path that also carries an :itemId segment.
async function removeWishlistItem(req: Request, res: Response) {
  try {
    const wishlistsCollection = await getWishlistsCollection();
    const wishlistId = req.params.id;
    const userId = req.user?.userId;
    
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
    
    // Pull the item first so modifiedCount reports whether anything was removed,
    // then touch updatedAt separately (otherwise updatedAt alone would always
    // mark the document as modified and hide "item not found").
    const pullSpec: any = variantId && require("mongodb").ObjectId.isValid(variantId)
      ? { items: { productId: new (require("mongodb")).ObjectId(productId), variantId: new (require("mongodb")).ObjectId(variantId) } }
      : { items: { productId: new (require("mongodb")).ObjectId(productId) } };

    const result = await wishlistsCollection.updateOne(
      { _id: new (require("mongodb")).ObjectId(wishlistId), userId: new (require("mongodb")).ObjectId(userId) },
      { $pull: pullSpec }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, message: "Wishlist not found" });
    }

    if (result.modifiedCount === 0) {
      return res.status(409).json({ success: false, message: "Item not found in wishlist" });
    }

    await wishlistsCollection.updateOne(
      { _id: new (require("mongodb")).ObjectId(wishlistId), userId: new (require("mongodb")).ObjectId(userId) },
      { $set: { updatedAt: new Date() } }
    );
    
    return res.json({ success: true, message: "Item removed from wishlist successfully" });
  } catch (error) {
    console.error("Remove item from wishlist error:", error);
    return res.status(500).json({ success: false, message: "Failed to remove item from wishlist" });
  }
}

app.delete('/api/wishlist/:id/items', authenticateJwt, removeWishlistItem);
app.delete('/api/wishlist/:id/items/:itemId', authenticateJwt, removeWishlistItem);

// Delete an entire wishlist (used by the wishlist page)
app.delete('/api/wishlist/:id', authenticateJwt, async (req, res) => {
  try {
    const wishlistsCollection = await getWishlistsCollection();
    const { id } = req.params;
    const userId = req.user?.userId;

    if (!require("mongodb").ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid wishlist ID" });
    }

    const result = await wishlistsCollection.deleteOne({
      _id: new (require("mongodb")).ObjectId(id),
      userId: new (require("mongodb")).ObjectId(userId)
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ success: false, message: "Wishlist not found" });
    }

    return res.json({ success: true, message: "Wishlist deleted successfully" });
  } catch (error) {
    console.error("Delete wishlist error:", error);
    return res.status(500).json({ success: false, message: "Failed to delete wishlist" });
  }
});



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
// Competitor price route is handled above - no additional middleware needed here

/**
 * End of all route registrations - any custom middleware should be added above
 * this point to avoid overwriting existing behavior.
 */
/**
 * Unknown API routes return JSON instead of Express' default HTML 404 page.
 * Must be registered after every API route above.
 */
app.use('/api', (req: Request, res: Response) => {
  res.status(404).json({ success: false, message: `Unknown endpoint: ${req.method} ${req.originalUrl}` });
});

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
  // Guard against invalid Express response objects - return early if res is invalid
  if (!res || typeof res !== 'object' || typeof res.headersSent !== 'boolean') {
    console.warn('SSR middleware skipped: invalid response object');
    return next();
  }

  // This server currently exports an Express app as well as the Angular SSR
  // entry point. Keep the reliable CSR path as the default until SSR is
  // explicitly enabled in a deployment using a compatible adapter.
  if (process.env['ENABLE_SSR'] !== 'true') {
    const fallbackHtml = join(browserDistFolder, 'index.csr.html');
    if (!res.headersSent) {
      return res.sendFile(fallbackHtml, (err: Error | null) => {
        if (err) {
          console.error('Failed to serve CSR HTML:', err);
          next(err);
        }
      });
    }
    return;
  }

  try {
    // Skip API routes and health check - they are handled above
    if (req.path.startsWith('/api/') || req.path === '/health') {
      return next();
    }

    const engine = await getAngularApp();
    if (!engine) {
      // In development without SSR build, serve index.csr.html for client-side routing
      const fallbackHtml = join(browserDistFolder, 'index.csr.html');
      if (res && !res.headersSent) {
        res.sendFile(fallbackHtml, (err: Error | null) => {
          if (err) {
            console.error('Failed to serve fallback HTML:', err);
            next(err);
          }
        });
      }
      return;
    }
    const response = await engine.handle(req);
    if (response) {
      if (res && !res.headersSent) {
        await writeResponseToNodeResponse(response, res);
      }
      return;
    }
    next();
  } catch (err) {
    console.error('SSR Error:', err);
    // Serve fallback CSR if SSR fails
    try {
      const fallbackHtml = join(browserDistFolder, 'index.csr.html');
      if (res && !res.headersSent) {
        res.sendFile(fallbackHtml, (fileErr: Error | null) => {
          if (fileErr) {
            console.error('Fallback HTML serve failed:', fileErr);
            next(err);
          }
        });
      }
    } catch {
      next(err);
    }
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

export default app;


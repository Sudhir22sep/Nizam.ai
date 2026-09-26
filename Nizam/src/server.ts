// server.ts - Clean SSR Server Setup
import { createNodeRequestHandler } from '@angular/ssr/node';
import express, { Response, Request, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import { resolve, relative, sep } from 'path';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import { writeResponseToNodeResponse } from '@angular/ssr/node';
import { isMainModule } from '@angular/ssr/node';
import { Db, MongoClient, ObjectId } from 'mongodb';
import Razorpay from 'razorpay';
import Stripe from 'stripe';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { AngularNodeAppEngine } from '@angular/ssr/node';
import { ɵsetAngularAppManifest, ɵsetAngularAppEngineManifest } from '@angular/ssr';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomBytes, timingSafeEqual } from 'crypto';

import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { createRequire } from 'module';
import {
  consumeInventory,
  inventoryLinesFromPricedItems,
  releaseInventory,
  reserveInventory,
  type InventoryLine
} from './server/order-inventory';
import {
  ASSISTANT_SYSTEM_PROMPT,
  localAssistantReply,
  sanitizeAssistantRequest,
  type AssistantReply
} from './server/ai-assistant';
import {
  buildInboundMessageEmail,
  parseInboundMessages,
  verifyMetaSignature,
} from './server/meta-webhook';

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

// Browser distribution folder for SSR.
//
// This has to survive three different places `__dirname` can point at:
//   - production:  dist/Nizam/server  -> ../browser            (built output)
//   - `ng serve`:  .angular/vite-root/Nizam -> ../browser       (does NOT exist)
//   - ts-node/src: src -> ../dist/Nizam/browser               (dev without a build)
// Only the first exists, so the others are probed rather than assumed. Probing
// matters because guessing wrong produced ENOENT on every page request under
// `ng serve`, where the browser assets are served by Vite from memory and there
// is no `index.csr.html` on disk at all.
//
// Paths under `.angular` are excluded outright. The Vite dev server creates
// `.angular/vite-root/browser` while it builds and deletes it once the build
// settles, so a plain `existsSync` probe can win that race and select a
// directory that is gone by the first request -- which is what turned every
// `ng serve` page load into `ENOENT ... index.csr.html` and a 500. Under
// `ng serve` there is genuinely no browser bundle on disk, so the candidate is
// dropped and the request is handed back to Vite, which serves it from memory.
const isViteScratchPath = (candidate: string): boolean => {
  const rel = relative(process.cwd(), candidate);
  return rel === '.angular' || rel.startsWith(`.angular${sep}`);
};

const BROWSER_DIST_CANDIDATES = [
  resolve(__dirname, '../browser'),
  resolve(__dirname, '../../dist/Nizam/browser'),
  resolve(process.cwd(), 'dist/Nizam/browser'),
].filter((candidate) => !isViteScratchPath(candidate));

const browserDistFolder =
  BROWSER_DIST_CANDIDATES.find((candidate) => existsSync(candidate)) ?? BROWSER_DIST_CANDIDATES[0];

/**
 * Angular may emit index.csr.html for client-rendered routes or index.html
 * when CSR is the application's default render output. Support both layouts
 * so the standalone server never points at a file that was not generated.
 *
 * Returns null when there is no built client on disk. Callers must treat that
 * as "there is nothing to send" and hand off to the dev server rather than
 * calling `res.sendFile` with a path that does not exist.
 */
function getClientFallbackPath(): string | null {
  const candidates = [
    join(browserDistFolder, 'index.csr.html'),
    join(browserDistFolder, 'index.html'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

/** True when a built browser bundle is available to serve from disk. */
const hasBuiltClient = (): boolean => getClientFallbackPath() !== null;

// ─── Owner-only product fields & bundled catalog ──────────────────────────────

/**
 * Owner-only product fields. They must never reach a shopper-facing response:
 * every public catalog endpoint strips them and an admin-only endpoint serves
 * the purchase link instead.
 */
const OWNER_ONLY_PRODUCT_FIELDS = ['buyUrl', 'supplier', 'reservedStock', 'inventoryReservations'] as const;

/** Removes owner-only fields from a product document. */
function toPublicProduct(product: Record<string, any>): Record<string, any> {
  const clone: Record<string, any> = { ...product };
  for (const field of OWNER_ONLY_PRODUCT_FIELDS) {
    delete clone[field];
  }
  return clone;
}

/**
 * Collapses a duplicated brand prefix in product names, e.g.
 * "DKNY DKNY Unisex Black Trolley Bag" → "DKNY Unisex Black Trolley Bag".
 * The imported catalog (and possibly older MongoDB rows) repeats the brand at
 * the start of the name; shoppers see the doubled text on cards and PDPs, so
 * every served product name is cleaned here.
 */
function cleanProductName(name: unknown): string {
  if (typeof name !== 'string') {
    return typeof name === 'string' ? name : 'Untitled product';
  }
  const words = name.trim().split(/\s+/);
  for (let take = Math.floor(words.length / 2); take >= 1; take -= 1) {
    const first = words.slice(0, take).join(' ').toLowerCase();
    const second = words.slice(take, take * 2).join(' ').toLowerCase();
    if (first.length > 0 && first === second) {
      return words.slice(take).join(' ');
    }
  }
  return name.trim();
}

/** Normalizes a catalog entry and strips owner-only fields in one step. */
function toPublicCatalogProduct(product: any): Record<string, any> {
  return toPublicProduct({
    ...product,
    name: cleanProductName(product?.name),
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
    resolve(process.cwd(), 'dist/Nizam/browser/assets/products.json'),
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

/**
 * Resolves the public info (name, price, image, category) for a wishlist item.
 *
 * Wishlist items may reference either a Mongo product document or a bundled
 * catalog entry (products.json ids are numeric, e.g. "100000", and are NOT
 * Mongo ObjectIds). Both sources are consulted so the wishlist page can render
 * real product details instead of "Product #0".
 */
async function lookupWishlistProductInfo(productId: unknown): Promise<Record<string, any> | null> {
  const idText = productId === null || productId === undefined ? '' : String(productId);
  if (!idText) {
    return null;
  }

  // 1. Try MongoDB when the id is a valid ObjectId.
  if (ObjectId.isValid(idText)) {
    try {
      const productsCollection = await getProductsCollection();
      const product: any = await productsCollection.findOne({ _id: new ObjectId(idText) });
      if (product) {
        return toPublicProduct({
          ...product,
          basePrice: product?.basePrice ?? product?.price ?? 0,
          currency: product?.currency ?? 'USD',
          images: Array.isArray(product?.images) ? product.images : (product?.image ? [product.image] : []),
        });
      }
    } catch (error) {
      console.warn('Wishlist product lookup (Mongo) failed:', error instanceof Error ? error.message : error);
    }
  }

  // 2. Fall back to the bundled catalog by its plain id.
  const asNumber = Number(idText);
  const bundled = loadBundledCatalog().find(candidate =>
    String(candidate?.id) === idText ||
    (Number.isFinite(asNumber) && Number(candidate?.id) === asNumber)
  );
  if (bundled) {
    return toPublicCatalogProduct(bundled);
  }

  return null;
}

/** Attaches product info (name/price/image/category) to each wishlist item. */
async function withProductInfo(items: any[]): Promise<any[]> {
  return Promise.all((items ?? []).map(async (item: any) => {
    const info = await lookupWishlistProductInfo(item.productId);
    return {
      ...item,
      productId: item.productId?.toString?.() ?? String(item.productId ?? ''),
      variantId: item.variantId ? item.variantId.toString() : null,
      productName: info?.name ?? item.productName ?? null,
      productPrice: info?.basePrice ?? item.productPrice ?? null,
      productCurrency: info?.currency ?? item.productCurrency ?? 'USD',
      productImage: (Array.isArray(info?.images) && info.images[0]) ?? item.productImage ?? null,
      productCategory: info?.category ?? item.productCategory ?? null,
    };
  }));
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

// Where merchant order notifications are sent. The default is the shop's
// own Gmail inbox; override with ORDER_NOTIFICATION_EMAIL when needed.
const orderNotificationEmail = (process.env.ORDER_NOTIFICATION_EMAIL || 'ammacollectivewear@gmail.com').trim();

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
  /** Authenticated storefront account that created the order. */
  userId?: ObjectId;
  name: string;
  email: string;
  address: string;
  items: Array<{ product: { name: string; price: number }; size?: string; quantity: number }>;
  total: number;
  currency: string;
  paymentMethod: string;
  status: string;
  razorpayPaymentId?: string;
  razorpayOrderId?: string;
  /** Stripe Checkout Session id (international card payments in USD). */
  stripeSessionId?: string;
  /** Stripe PaymentIntent id, recorded once the session is paid. */
  stripePaymentIntentId?: string;
  /** Mongo product ids and quantities participating in server-side inventory. */
  inventoryItems?: Array<{ productId: ObjectId; quantity: number }>;
  inventoryState?: 'none' | 'reserved' | 'consumed' | 'released';
  inventoryUpdatedAt?: Date;
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
  /** Numeric stock enables atomic reservation/decrement; omitted means untracked. */
  stock?: number | null;
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
  stock?: number | null;
  /** Units committed to pending online orders but not yet consumed. */
  reservedStock?: number;
  createdAt: Date;
  updatedAt: Date;
  /** Owner-only supplier checkout link. Never returned by public endpoints. */
  buyUrl?: string;
  /** Owner-only supplier reference. Never returned by public endpoints. */
  supplier?: string;
}

// Stripe powers the international (USD) card payments. Razorpay remains the
// domestic (INR) gateway; both flows re-price the order through the same
// catalog helpers and store an identical order document.
const stripeSecretKey = process.env['STRIPE_SECRET_KEY'] || process.env['STRIPE_TEST_SECRET_KEY'];
const stripePublishableKey =
  process.env['STRIPE_PUBLISHABLE_KEY'] || process.env['STRIPE_TEST_PUBLISHABLE_KEY'] || '';
const stripeWebhookSecret = process.env['STRIPE_WEBHOOK_SECRET'] || '';
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;
console.log('Stripe secret key:', stripeSecretKey ? 'SET' : 'NOT SET');
console.log('Stripe instance:', stripe ? 'CREATED' : 'NULL');

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

// Meta (WhatsApp Cloud API / Messenger) Configuration
// Shared secret typed into the Meta app dashboard when subscribing the webhook.
const metaVerifyToken = process.env['META_VERIFY_TOKEN'] || 'ammawearssecret2026';
console.log('Meta verify token:', process.env['META_VERIFY_TOKEN'] ? 'SET (env)' : 'NOT SET (using default)');
// App secret is what `X-Hub-Signature-256` is computed with. Without it every
// POST is rejected, so the inbox integration is simply inert until it is set.
const metaAppSecret = process.env['META_APP_SECRET'] || '';
console.log('Meta app secret:', metaAppSecret ? 'SET' : 'NOT SET (inbound messages will be rejected)');

// Printful Configuration
const printfulApiKey = process.env['PRINTFUL_API_KEY'] || '';
const printful = printfulApiKey ? true : false;
console.log('Printful API Key:', printfulApiKey ? 'SET' : 'NOT SET');
console.log('Printful integration:', printful ? 'ENABLED' : 'DISABLED');

const appUrl = process.env['APP_URL'] || 'http://localhost:4200';

// JWT Configuration
//
// NOTE: this module is also imported by the Angular CLI while it builds
// (`angular.json` -> `ssr.entry` is this file, and the builder imports it to
// obtain the request handler for SSR/prerendering). A throw at module scope
// therefore breaks `npm run build` in any environment that does not have the
// production secrets yet -- e.g. the Docker builder stage, where `.env` is
// excluded by `.dockerignore`. So the check is deferred: importing this module
// is always safe, and the process still refuses to start serving without a
// secret (see `assertJwtSecret` called from the startup block) and every
// sign/verify path goes through `getJwtSecret()`.
if (!process.env.JWT_SECRET) {
  console.warn('JWT_SECRET is missing from the environment at import time.');
  console.warn('This is expected while building. It must be set before the server accepts requests.');
}
const jwtSecret = process.env.JWT_SECRET;
const jwtExpiresIn = '30d';

/**
 * Read the JWT secret, or throw if it is not configured.
 *
 * Used on every signing/verification path so a misconfigured deployment fails
 * loudly on the affected request instead of silently signing tokens with an
 * empty key.
 */
function getJwtSecret(): string {
  if (!jwtSecret) {
    throw new Error('JWT_SECRET must be set in the runtime environment');
  }
  return jwtSecret;
}

/**
 * Startup guard. Called only when this module is the process entry point, so
 * a server launched without `JWT_SECRET` still exits immediately instead of
 * booting and 500ing on every login/register call.
 */
function assertJwtSecret(): void {
  if (!jwtSecret) {
    console.error('JWT_SECRET is missing from the runtime environment.');
    console.error('Set it in the Render dashboard (Environment) or define it in a local .env file.');
    throw new Error('JWT_SECRET must be set in the runtime environment');
  }
}

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
        return jwt.verify(token, getJwtSecret()) as { userId: string; email: string; role?: string };
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

function requestUserId(user: { userId?: string } | undefined): ObjectId | null {
  const raw = user?.userId?.trim() ?? '';
  return /^[a-f\d]{24}$/i.test(raw) ? new ObjectId(raw) : null;
}

function userOwnsOrder(order: Pick<OrderDocument, 'userId' | 'email'>, user: { userId?: string; email?: string } | undefined): boolean {
  const userId = requestUserId(user);
  return !!userId && !!order.userId && order.userId.toString() === userId.toString() ||
    !order.userId && !!user?.email && order.email.toLowerCase() === user.email.toLowerCase();
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
  /** SHA-256 hash of the active password-reset token (the raw token is only emailed). */
  passwordResetTokenHash?: string | null;
  /** Reset link expiry; links are valid for 30 minutes. */
  passwordResetExpiresAt?: Date | null;
  updatedAt?: Date;
}

// Use import.meta.dirname directly - it will resolve correctly both in dev (src/) and production (dist/Nizam/server/)

// parse JSON bodies for most routes
// IMPORTANT: Razorpay webhook needs raw body for signature verification
// Register raw body parser for webhook BEFORE express.json()
app.use('/api/razorpay-webhook', express.raw({ type: 'application/json' }));
// Stripe signs its webhook payloads the same way, so it also needs the raw body.
app.use('/api/stripe-webhook', express.raw({ type: 'application/json' }));
// Meta signs the exact bytes it sent in `X-Hub-Signature-256`, so its callback
// (POST on the site root, next to the GET handshake) also needs the raw body.
// Registered as POST-only so normal page requests are untouched.
app.post('/', express.raw({ type: 'application/json' }));
app.use(express.json());
// Parses the short-lived cookies used by the social sign-in handshake
// (the CSRF `state` nonce and the one-time token cookie).
app.use(cookieParser());

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

app.post('/api/create-razorpay-order', authenticateJwt, async (req, res) => {
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

  const userId = requestUserId((req as Request & { user?: any }).user);
  if (!userId) {
    return res.status(401).json({ success: false, message: 'A valid authenticated account is required.' });
  }
  const { name, email: requestedEmail, address, items, total, currency } = req.body;
  const orderEmail = ((req as Request & { user?: any }).user?.email || requestedEmail || '').toLowerCase();

  if (!name || !orderEmail || !Array.isArray(items) || typeof total !== 'number') {
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

  const inventory = await reserveOrderInventory(orderReference, priced.items);
  if (!inventory.result.ok) {
    return res.status(409).json({ success: false, message: inventory.result.message });
  }


  try {
    const razorpayOrder = await razorpay.orders.create({
      amount: amountInPaise,
      currency: 'INR',
      receipt: orderReference,
      payment_capture: true,
      notes: {
        orderReference,
        email: orderEmail,
        name,
      },
    });

    // Save order to MongoDB with 'pending' status before returning
    // This ensures the order exists when payment is confirmed
    const ordersCollection = await getOrdersCollection();
    
    const order: OrderDocument = {
      orderReference,
      userId,
      name,
      email: orderEmail,
      address: address || '',
      items: priced.items,
      total: orderTotal,
      currency: frontendCurrency, // total is expressed in the shopper's currency
      paymentMethod: 'Razorpay',
      status: 'pending',
      inventoryItems: inventory.lines,
      inventoryState: inventory.lines.length ? 'reserved' : 'none',
      inventoryUpdatedAt: new Date(),
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
    await releaseInventory(inventory.products, orderReference, inventory.lines);
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

// The in-flight initialization, memoized so it runs at most once.
//
// Checking `if (!angularApp)` alone is check-then-act: the first page requests
// arrive concurrently, and every one of them sees a null engine and builds its
// own before the first assignment lands. That is not only wasted work, it
// printed "Angular SSR engine initialized successfully" once per racing request
// (observed twice on a cold start) and left the losers to be discarded while
// their listeners were still registered. Storing the promise closes the window:
// the first caller starts the work, the rest await the same result.
let angularAppInit: Promise<AngularNodeAppEngine | null> | null = null;

async function getAngularApp(): Promise<AngularNodeAppEngine | null> {
  if (angularApp) {
    return angularApp;
  }

  angularAppInit ??= (async () => {
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
      const engine = new AngularNodeAppEngine();
      console.log('Angular SSR engine initialized successfully');
      return engine;
    } catch (error) {
      console.warn('AngularNodeAppEngine initialization failed:', error instanceof Error ? error.message : error);
      // Fall back to null to indicate SSR not available
      return null;
    }
  })();

  // A failed init is not cached permanently: `angularAppInit` is reset below so
  // a later request can retry, but a successful engine is kept for good.
  const engine = await angularAppInit;
  if (engine) {
    angularApp = engine;
  } else {
    angularAppInit = null;
  }
  return engine;
}

// SES client and verified sender are initialized at the top of the file


app.post('/api/assistant', async (req, res) => {
  const messages = sanitizeAssistantRequest(req.body);
  const lastUserMessage = [...messages].reverse().find(message => message.role === 'user');
  if (!lastUserMessage) {
    return res.status(400).json({ success: false, message: 'Please enter a message.' });
  }

  const fallback = (): AssistantReply => ({
    success: true,
    message: localAssistantReply(lastUserMessage.content),
    source: 'local'
  });
  const apiKey = (process.env['GEMINI_API_KEY'] || '').trim();
  if (!apiKey || apiKey === 'your_gemini_api_key') {
    return res.json(fallback());
  }

  const model = (process.env['GEMINI_MODEL'] || 'gemini-2.0-flash').trim();
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        contents: messages.map(message => ({
          role: message.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: message.content }]
        })),
        systemInstruction: { parts: [{ text: ASSISTANT_SYSTEM_PROMPT }] },
        generationConfig: { maxOutputTokens: 500, temperature: 0.35 }
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      console.warn(`Gemini assistant request failed with status ${response.status}; using local reply.`);
      return res.json(fallback());
    }

    const payload = await response.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = payload.candidates?.[0]?.content?.parts
      ?.map(part => part.text || '')
      .join('')
      .trim();
    if (!text) return res.json(fallback());

    return res.json({ success: true, message: text, source: 'gemini' } satisfies AssistantReply);
  } catch (error) {
    console.warn('Gemini assistant unavailable; using local reply.', error instanceof Error ? error.message : error);
    return res.json(fallback());
  } finally {
    clearTimeout(timeout);
  }
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

async function lookupCatalogProduct(productId: unknown): Promise<{ productId?: ObjectId; price: number; name?: string; stockTracked: boolean } | null> {
  const raw = productId === undefined || productId === null ? '' : String(productId).trim();
  if (!raw) return null;

  const lookups: any[] = [];
  if (/^[a-f\d]{24}$/i.test(raw)) lookups.push({ _id: new ObjectId(raw) });
  const asNumber = Number(raw);
  if (Number.isFinite(asNumber)) lookups.push({ id: asNumber });
  lookups.push({ id: raw });

  const productsCollection = await getProductsCollection();
  const product: any = await productsCollection.findOne({ $or: lookups });
  const price = product?.basePrice ?? product?.price;
  if (typeof price !== 'number' || price <= 0) return null;
  return {
    productId: product._id instanceof ObjectId ? product._id : new ObjectId(product._id),
    price,
    name: product.name,
    stockTracked: typeof product.stock === 'number' && Number.isFinite(product.stock),
  };
}

interface PricedOrderItem {
  product: { name: string; price: number };
  /** Present only for Mongo products with numeric inventory. */
  productId?: ObjectId;
  stockTracked?: boolean;
  /** Shopper-selected size label; absent for one-size products. */
  size?: string;
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
    // Preserve the shopper-selected size so it reaches the stored order and
    // both the customer and merchant notification emails.
    const size = typeof item.size === 'string' && item.size.trim() ? item.size.trim() : undefined;

    let catalogProduct: Awaited<ReturnType<typeof lookupCatalogProduct>> = null;
    try {
      catalogProduct = await lookupCatalogProduct(product.id ?? product._id ?? item.productId);
    } catch (error) {
      console.warn(
        'Order pricing: catalog lookup failed, falling back to the client price:',
        error instanceof Error ? error.message : error
      );
    }

    let unitPriceUsd = catalogProduct?.price ?? null;
    if (unitPriceUsd === null) {
      if (clientPrice === undefined || clientPrice <= 0) {
        return { ok: false, message: 'Each item must have a valid positive price' };
      }
      unitPriceUsd = clientPrice;
    } else {
      catalogPricedCount += 1;
    }

    items.push({
      product: { name: catalogProduct?.name || product.name || `Item ${items.length + 1}`, price: unitPriceUsd },
      productId: catalogProduct?.productId,
      stockTracked: catalogProduct?.stockTracked,
      size,
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
    const newsletterCollection = db.collection('newsletter_subscribers');

    await ordersCollection.createIndex({ orderReference: 1 }, { unique: true });
    await ordersCollection.createIndex({ userId: 1, createdAt: -1 });
    await ordersCollection.createIndex({ email: 1 });
    await usersCollection.createIndex({ email: 1 }, { unique: true });
    await contactsCollection.createIndex({ email: 1 });
    await productsCollection.createIndex({ name: 'text', description: 'text' });
    // The shop grid filters by category, sorts by recency and filters on price,
    // so these match the /api/products query shape and avoid a collection scan.
    await productsCollection.createIndex({ category: 1, createdAt: -1 });
    await productsCollection.createIndex({ basePrice: 1 });
    await productsCollection.createIndex({ isActive: 1, createdAt: -1 });
    await newsletterCollection.createIndex({ email: 1 }, { unique: true });

    console.log('MongoDB connected successfully');
  } catch (error) {
    console.error('Failed to connect to MongoDB:', error);
    console.error('MongoDB connection error details:', error instanceof Error ? error.message : String(error));
    console.error('Check MONGODB_URI environment variable and MongoDB Atlas IP whitelist');
    // Don't exit, just continue without DB
  }
}


function ensureMongoDBInitialized(): Promise<void> {
  // Logged inside the guard, not before it. The guard means the connection is
  // established exactly once, so logging outside it printed
  // "ensureMongoDBInitialized called" on every request that touched a
  // collection while the work itself only ever happened once -- which reads as
  // a repeated failure to anyone watching the log.
  if (!mongoInitPromise) {
    console.log('ensureMongoDBInitialized called; connecting to MongoDB');
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
async function getNewsletterSubscribersCollection() {
  await ensureMongoDBInitialized();

  if (!db) {
    throw new Error('MongoDB not connected');
  }
  return db.collection('newsletter_subscribers');
}

// Get or create products collection
async function getProductsCollection() {
  await ensureMongoDBInitialized();

  if (!db) {
    throw new Error('MongoDB not connected');
  }
  return db.collection('products');
}

async function reserveOrderInventory(orderReference: string, items: PricedOrderItem[]) {
  const products = await getProductsCollection();
  const lines = inventoryLinesFromPricedItems(items);
  const result = await reserveInventory(products, orderReference, lines);
  return { products, lines, result };
}

async function releaseOrderInventory(order: OrderDocument) {
  if (order.inventoryState !== 'reserved' || !order.inventoryItems?.length) return;
  const products = await getProductsCollection();
  await releaseInventory(products, order.orderReference, order.inventoryItems as InventoryLine[]);
  await getOrdersCollection().then(orders => orders.updateOne(
    { orderReference: order.orderReference, inventoryState: 'reserved' },
    { $set: { inventoryState: 'released', inventoryUpdatedAt: new Date(), updatedAt: new Date() } }
  ));
}

async function consumeOrderInventory(order: OrderDocument) {
  if (order.inventoryState !== 'reserved' || !order.inventoryItems?.length) return;
  const products = await getProductsCollection();
  const result = await consumeInventory(products, order.orderReference, order.inventoryItems as InventoryLine[]);
  if (!result.ok) throw new Error(result.message);
  await getOrdersCollection().then(orders => orders.updateOne(
    { orderReference: order.orderReference, inventoryState: 'reserved' },
    { $set: { inventoryState: 'consumed', inventoryUpdatedAt: new Date(), updatedAt: new Date() } }
  ));
}

// Get or create wishlists collection
async function getWishlistsCollection() {
  await ensureMongoDBInitialized();

  if (!db) {
    throw new Error('MongoDB not connected');
  }
  return db.collection('wishlists');
}

// Inbound WhatsApp messages. The unique index on `messageId` is the
// de-duplication guard: Meta redelivers a payload it considers unacknowledged,
// and insertOne then fails as a duplicate instead of emailing the owner twice.
async function getMetaMessagesCollection() {
  await ensureMongoDBInitialized();

  if (!db) {
    throw new Error('MongoDB not connected');
  }
  const collection = db.collection('meta_messages');
  await collection.createIndex({ messageId: 1 }, { unique: true });
  return collection;
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

async function sendEmail(params: { to: string | string[]; subject: string; text: string; html: string; replyTo?: string }) {
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
    ReplyToAddresses: [params.replyTo || verifiedSender],
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

/**
 * Minimal HTML escaping for customer-supplied values interpolated into email
 * bodies (names, addresses, sizes). Keeps malformed input from breaking the
 * HTML email layout or injecting markup.
 */
function escapeEmailHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\r?\n/g, '<br>');
}

/**
 * Builds the merchant notification for a new/paid order. Contains everything
 * the shop owner needs to fulfil: customer contact, shipping address, and
 * each item with size, quantity, unit price, and line total.
 */
function buildMerchantOrderNotification(params: {
  name: string;
  email: string;
  address?: string;
  items: Array<{ product: { name: string; price?: number }; size?: string; quantity: number }>;
  total: number;
  currency: string;
  orderReference: string;
  paymentMethod: string;
  orderStatus: string;
}) {
  const { name, email, address, items, total, currency, orderReference, paymentMethod, orderStatus } = params;
  const orderCurrency = (currency || 'USD').toUpperCase();

  const itemRows = items.map((item) => {
    const price = convertFromUsd(item.product.price ?? 0, orderCurrency);
    const sizeLabel = item.size ? escapeEmailHtml(item.size) : '—';
    return `
    <tr>
      <td>${escapeEmailHtml(item.product.name || 'Unnamed Item')}</td>
      <td>${sizeLabel}</td>
      <td align="center">${item.quantity}</td>
      <td align="right">${formatCurrency(price, orderCurrency)}</td>
      <td align="right">${formatCurrency(price * item.quantity, orderCurrency)}</td>
    </tr>
  `}).join('');

  const itemText = items.map((item) => {
    const price = convertFromUsd(item.product.price ?? 0, orderCurrency);
    const sizeLabel = item.size ? ` (size ${item.size})` : '';
    return `${item.quantity} x ${item.product.name || 'Unnamed Item'}${sizeLabel} @ ${formatCurrency(price, orderCurrency)} = ${formatCurrency(price * item.quantity, orderCurrency)}`;
  }).join('\n');

  const addressBlock = (address || '').trim();

  return {
    subject: `🛍️ New order ${orderReference} — ${formatCurrency(total, orderCurrency)} (${paymentMethod})`,
    text: `New order received!

Order reference: ${orderReference}
Status: ${orderStatus}
Payment method: ${paymentMethod}
Total: ${formatCurrency(total, orderCurrency)}

CUSTOMER
Name: ${name}
Email: ${email}

SHIPPING ADDRESS
${addressBlock || 'Not provided'}

ITEMS
${itemText}

Fulfil this order from the admin panel or reply to this email to contact the customer.`,
    html: `<h2>New order received</h2>
      <p><strong>Order reference:</strong> ${escapeEmailHtml(orderReference)}</p>
      <p><strong>Status:</strong> ${escapeEmailHtml(orderStatus)} &nbsp;|&nbsp; <strong>Payment method:</strong> ${escapeEmailHtml(paymentMethod)} &nbsp;|&nbsp; <strong>Total:</strong> <strong>${formatCurrency(total, orderCurrency)}</strong></p>
      <h3>Customer</h3>
      <p><strong>Name:</strong> ${escapeEmailHtml(name)}<br>
      <strong>Email:</strong> ${escapeEmailHtml(email)}</p>
      <h3>Shipping address</h3>
      <p>${addressBlock ? escapeEmailHtml(addressBlock) : '<em>Not provided</em>'}</p>
      <h3>Items</h3>
      <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse; width:100%;">
        <thead>
          <tr>
            <th align="left">Item</th>
            <th align="left">Size</th>
            <th align="center">Qty</th>
            <th align="right">Unit price</th>
            <th align="right">Line total</th>
          </tr>
        </thead>
        <tbody>
          ${itemRows}
        </tbody>
      </table>
      <p style="margin-top:12px;"><strong>Order total: ${formatCurrency(total, orderCurrency)}</strong></p>
      <p>Fulfil this order from the admin panel, or reply to this email to contact the customer.</p>`,
  };
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
  address?: string;
  items: Array<{ product: { name: string; price?: number; basePrice?: number }; size?: string; quantity: number }>;
  total: number;
  orderReference: string;
  paymentMethod?: string;
  currency?: string;
}) {
  const { name, email, address, items, total, orderReference, paymentMethod, currency } = params;
  const orderCurrency = (currency || 'USD').toUpperCase();
  const methodLabel = paymentMethod === 'COD' ? 'Cash on Delivery (COD)' : 'Card payment';
  const itemRows = items.map((item) => {
    const price = convertFromUsd(item.product.price ?? item.product.basePrice ?? 0, orderCurrency);
    const productName = item.product.name || 'Unnamed Item';
    const sizeLabel = item.size ? escapeEmailHtml(item.size) : '—';
    return `
    <tr>
      <td>${escapeEmailHtml(productName)}</td>
      <td>${sizeLabel}</td>
      <td>${item.quantity}</td>
      <td>${formatCurrency(price, orderCurrency)}</td>
      <td>${formatCurrency(price * item.quantity, orderCurrency)}</td>
    </tr>
  `}).join('');

  const itemText = items.map((item) => {
    const price = convertFromUsd(item.product.price ?? item.product.basePrice ?? 0, orderCurrency);
    const productName = item.product.name || 'Unnamed Item';
    const sizeLabel = item.size ? ` (size ${item.size})` : '';
    return `${item.quantity} x ${productName}${sizeLabel} @ ${formatCurrency(price, orderCurrency)} = ${formatCurrency(price * item.quantity, orderCurrency)}`;
  }).join('\n');

  const shippingAddress = (address || '').trim();

  return {
    subject: `Order confirmation — ${orderReference}`,
    text: `Thank you for your order, ${name}!\n\nOrder reference: ${orderReference}\nPayment method: ${methodLabel}\n\nItems:\n${itemText}\n\nTotal: ${formatCurrency(total, orderCurrency)}\n\nWe will ship your order to:\n${shippingAddress || 'Address to be confirmed'}\n\nFor dropshipping or wholesale inquiries, email sudhir.22sep@gmail.com.`,
    html: `<p>Thank you for your order, <strong>${escapeEmailHtml(name)}</strong>!</p>
      <p>Order reference: <strong>${escapeEmailHtml(orderReference)}</strong></p>
      <p>Payment method: <strong>${methodLabel}</strong></p>
      <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse; width:100%;">
        <thead>
          <tr>
            <th align="left">Item</th>
            <th align="left">Size</th>
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
      ${shippingAddress ? `<p>We will ship your order to:<br><strong>${escapeEmailHtml(shippingAddress)}</strong></p>` : ''}
      <p>We will ship your order shortly.</p>
      <p>For dropshipping or wholesale inquiries, email <strong>sudhir.22sep@gmail.com</strong>.</p>`,
  };
}

// ---- Password reset --------------------------------------------------------

/** Reset links stay valid for 30 minutes after they are requested. */
const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;

/** Hashes a reset token; only the digest is ever stored in MongoDB. */
function hashPasswordResetToken(token: string): string {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Absolute base URL for links inside transactional email.
 *
 * APP_URL wins (that is what production sets); otherwise the incoming request's
 * own host is used so links also work on Codespaces/preview deployments.
 */
function resolveAppBaseUrl(req?: Request): string {
  if (process.env['APP_URL']) {
    return process.env['APP_URL'].replace(/\/+$/, '');
  }
  const host = req?.get('host');
  if (host) {
    return `${req!.protocol}://${host}`;
  }
  return appUrl.replace(/\/+$/, '');
}

/** Customer-facing password reset email. */
function buildPasswordResetMessage(params: { firstName?: string; resetUrl: string }) {
  const { firstName, resetUrl } = params;
  const greeting = firstName?.trim() ? `Hi ${firstName.trim()},` : 'Hi,';
  return {
    subject: 'Reset your Amma Wears password',
    text: `${greeting}\n\nWe received a request to reset your Amma Wears password. Open the link below to choose a new one:\n\n${resetUrl}\n\nThis link expires in 30 minutes. If you did not request a reset you can safely ignore this email - your password will stay unchanged.`,
    html: `<p>${escapeEmailHtml(greeting)}</p>
      <p>We received a request to reset your Amma Wears password. Click the button below to choose a new one.</p>
      <p><a href="${escapeEmailHtml(resetUrl)}" style="display:inline-block;padding:12px 24px;border-radius:999px;background:#B08D57;color:#ffffff;text-decoration:none;font-weight:700;">Reset password</a></p>
      <p>Or paste this link into your browser:<br>${escapeEmailHtml(resetUrl)}</p>
      <p>This link expires in 30 minutes. If you did not request a reset you can safely ignore this email - your password will stay unchanged.</p>`,
  };
}

/** Confirmation that a password was changed. */
function buildPasswordChangedMessage() {
  return {
    subject: 'Your Amma Wears password was changed',
    text: 'Your Amma Wears password has been updated successfully. If this was not you, reply to this email immediately so we can secure your account.',
    html: '<p>Your Amma Wears password has been updated successfully.</p><p>If this was not you, reply to this email immediately so we can secure your account.</p>',
  };
}

async function trySendEmail(params: { to: string | string[]; subject: string; text: string; html: string; replyTo?: string }) {
  try {
    await sendEmail(params);
    console.log('Email sent successfully');
    return true;
  } catch (error) {
    console.warn('Email not sent:', error instanceof Error ? error.message : error);
    return false;
  }
}

function buildNewsletterWelcomeMessage(unsubscribeUrl: string) {
  const safeUnsubscribeUrl = escapeEmailHtml(unsubscribeUrl);
  return {
    subject: 'Welcome to Amma Wears',
    text: `Welcome to Amma Wears. You are now subscribed to new arrivals, product updates, and occasional offers. Unsubscribe anytime: ${unsubscribeUrl}`,
    html: `<p>Welcome to Amma Wears.</p><p>You are now subscribed to new arrivals, product updates, and occasional offers.</p><p><a href="${safeUnsubscribeUrl}" style="display:inline-block;padding:12px 24px;border-radius:999px;background:#D92D48;color:#ffffff;text-decoration:none;font-weight:700;">Unsubscribe</a></p><p style="color:#64748b;font-size:12px;">You received this email because you opted in to Amma Wears marketing messages.</p>`,
  };
}

function buildProductMarketingMessage(params: { email: string; products: Record<string, any>[]; unsubscribeUrl: string }) {
  const items = params.products.slice(0, 6).map(product => {
    const image = Array.isArray(product.images) ? product.images[0] : product.image;
    const href = `${resolveAppBaseUrl()}/product/${encodeURIComponent(product.id)}`;
    const imageHtml = image ? `<img src="${escapeEmailHtml(image)}" alt="" style="display:block;width:100%;max-width:220px;border-radius:12px;object-fit:cover;">` : '';
    return `<li style="margin:0 0 18px;">${imageHtml}<a href="${escapeEmailHtml(href)}" style="color:#14263D;font-weight:700;">${escapeEmailHtml(product.name)}</a><br><span style="color:#64748B;font-size:12px;">${escapeEmailHtml(product.category || 'New arrival')}</span></li>`;
  }).join('');
  const unsubscribeUrl = escapeEmailHtml(params.unsubscribeUrl);
  return {
    subject: 'New Amma Wears picks selected for you',
    text: `New Amma Wears picks selected for you:\n\n${params.products.slice(0, 6).map(product => `- ${product.name}`).join('\n')}\n\nUnsubscribe: ${params.unsubscribeUrl}`,
    html: `<p>Hello,</p><p>We found new Amma Wears pieces that match your interests.</p><ul style="padding:0;list-style:none;">${items}</ul><p><a href="${unsubscribeUrl}" style="color:#64748B;font-size:12px;">Unsubscribe from marketing emails</a></p>`
  };
}

function productMatchesInterest(product: Record<string, any>, interests: string[]): boolean {
  if (!interests.length) return true;
  const haystack = `${product.category || ''} ${(product.tags || []).join(' ')} ${product.name || ''}`.toLowerCase();
  return interests.some(interest => haystack.includes(interest.toLowerCase()));
}

async function sendNewProductCampaign(): Promise<void> {
  if (!sesClient || !isSenderConfigured) return;
  try {
    const subscribers = await getNewsletterSubscribersCollection();
    const products = await getProductsCollection();
    const deliveries = db!.collection('newsletter_deliveries');
    const since = new Date(Date.now() - 30 * 60 * 1000);
    const activeSubscribers = await subscribers.find({ status: 'subscribed' }).toArray();
    const newProducts = await products.find({ isActive: { $ne: false }, createdAt: { $gte: since } }).sort({ createdAt: -1 }).limit(50).toArray();
    if (!activeSubscribers.length || !newProducts.length) return;

    for (const subscriber of activeSubscribers) {
      const interests = Array.isArray(subscriber.interests) ? subscriber.interests : [];
      const matching = newProducts.filter(product => productMatchesInterest(product, interests));
      if (!matching.length) continue;
      const alreadySent = await deliveries.findOne({ subscriberEmail: subscriber.email, productId: matching[0].id });
      if (alreadySent) continue;
      const unsubscribeUrl = `${resolveAppBaseUrl()}/api/newsletter/unsubscribe?email=${encodeURIComponent(subscriber.email)}`;
      const sent = await trySendEmail({ to: subscriber.email, ...buildProductMarketingMessage({ email: subscriber.email, products: matching, unsubscribeUrl }) });
      if (sent) {
        await deliveries.insertOne({ subscriberEmail: subscriber.email, productId: matching[0].id, productIds: matching.map(product => product.id), sentAt: new Date() });
      }
    }
  } catch (error) {
    console.error('New-product marketing campaign failed:', error instanceof Error ? error.message : error);
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

app.post('/api/newsletter/subscribe', async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const interests = Array.isArray(req.body?.interests)
    ? req.body.interests.filter((interest: unknown): interest is string => typeof interest === 'string').map((interest: string) => interest.trim()).filter(Boolean).slice(0, 12)
    : [];
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!email || email.length > 254 || !emailPattern.test(email)) {
    return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
  }

  try {
    const subscribers = await getNewsletterSubscribersCollection();
    const result = await subscribers.updateOne(
      { email },
      { $setOnInsert: { email, createdAt: new Date() }, $set: { status: 'subscribed', interests, unsubscribedAt: null, updatedAt: new Date() } },
      { upsert: true }
    );
    const alreadySubscribed = result.upsertedCount === 0;
    let welcomeEmailSent = false;
    if (!alreadySubscribed) {
      const unsubscribeUrl = `${resolveAppBaseUrl(req)}/api/newsletter/unsubscribe?email=${encodeURIComponent(email)}`;
      const welcome = buildNewsletterWelcomeMessage(unsubscribeUrl);
      welcomeEmailSent = await trySendEmail({ to: email, subject: welcome.subject, text: welcome.text, html: welcome.html });
    }

    return res.status(200).json({
      success: true,
      alreadySubscribed,
      welcomeEmailSent,
      message: alreadySubscribed
        ? 'You are already subscribed to the Amma Wears newsletter.'
        : 'Thanks for subscribing to the Amma Wears newsletter.',
    });
  } catch (error) {
    // A unique-index race can still be treated as the same successful subscription.
    if (error && typeof error === 'object' && 'code' in error && (error as { code?: number }).code === 11000) {
      return res.status(200).json({ success: true, alreadySubscribed: true, message: 'You are already subscribed to the Amma Wears newsletter.' });
    }
    console.error('Newsletter subscription failed:', error);
    return res.status(500).json({ success: false, message: 'Unable to subscribe right now. Please try again later.' });
  }
});

app.all('/api/newsletter/unsubscribe', async (req, res) => {
  const email = typeof (req.query.email ?? req.body?.email) === 'string' ? String(req.query.email ?? req.body.email).trim().toLowerCase() : '';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ success: false, message: 'A valid email address is required.' });
  }

  try {
    const subscribers = await getNewsletterSubscribersCollection();
    const result = await subscribers.updateOne(
      { email },
      { $set: { status: 'unsubscribed', unsubscribedAt: new Date(), updatedAt: new Date() } }
    );
    return res.status(200).json({
      success: true,
      message: result.modifiedCount > 0
        ? 'You have been unsubscribed from Amma Wears marketing emails.'
        : 'This email address is already unsubscribed.',
    });
  } catch (error) {
    console.error('Newsletter unsubscribe failed:', error);
    return res.status(500).json({ success: false, message: 'Unable to unsubscribe right now. Please try again later.' });
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

// ============================================
// SOCIAL LOGIN (OAuth 2.0)
// ============================================

/**
 * Social sign-in providers.
 *
 * The flow is the standard OAuth 2.0 authorization-code grant, implemented
 * directly against each provider's token/userinfo endpoints so the project
 * needs no extra OAuth library. A provider is only offered when its client id
 * and secret are configured, so an unconfigured deployment degrades to
 * email/password instead of showing a button that cannot work.
 */
const GOOGLE_CLIENT_ID = process.env['GOOGLE_CLIENT_ID'] || '';
const GOOGLE_CLIENT_SECRET = process.env['GOOGLE_CLIENT_SECRET'] || '';
const FACEBOOK_CLIENT_ID = process.env['FACEBOOK_CLIENT_ID'] || '';
const FACEBOOK_CLIENT_SECRET = process.env['FACEBOOK_CLIENT_SECRET'] || '';

/** How long an unredeemed authorization code or handshake cookie may live. */
const SOCIAL_STATE_TTL_MS = 10 * 60 * 1000;

/** Exchanges an authorization code for an access token. */
async function exchangeCodeForToken(tokenUrl: string, params: Record<string, string>): Promise<string> {
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(params).toString(),
  });

  const data: any = await response.json().catch(() => ({}));
  if (!response.ok || !data?.access_token) {
    console.error('OAuth token exchange failed:', response.status, data?.error ?? data?.error_description);
    throw new Error('token_exchange_failed');
  }
  return data.access_token as string;
}

type OAuthProfile = {
  email: string;
  firstName: string;
  lastName: string;
  avatar?: string;
  providerId: string;
};

/** Fetches the normalized profile for an access token. */
async function fetchOAuthProfile(profileUrl: string, accessToken: string): Promise<OAuthProfile> {
  const response = await fetch(profileUrl, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });

  const data: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error('OAuth profile fetch failed:', response.status);
    throw new Error('profile_fetch_failed');
  }

  if (data.email) {
    return {
      email: String(data.email).toLowerCase().trim(),
      firstName: data.given_name || data.name?.split(' ')[0] || '',
      lastName: data.family_name || data.name?.split(' ').slice(1).join(' ') || '',
      avatar: data.picture,
      providerId: String(data.sub ?? data.id),
    };
  }

  // Facebook only returns an email on /me when the email permission was granted.
  throw new Error(data.error?.message ?? 'email_not_provided');
}

/** Providers the client may offer, filtered to those actually configured. */
app.get('/api/auth/social/providers', (_req: Request, res: Response) => {
  res.json({
    success: true,
    providers: [
      Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) ? 'google' : null,
      Boolean(FACEBOOK_CLIENT_ID && FACEBOOK_CLIENT_SECRET) ? 'facebook' : null,
    ].filter(Boolean),
  });
});

/**
 * Starts the flow. The `state` value is a random nonce stored in an httpOnly,
 * sameSite=lax cookie; the callback compares them, which is what blocks CSRF on
 * the callback (the cookie is still sent on the provider's top-level redirect).
 */
app.get('/api/auth/social/:provider/start', (req: Request, res: Response) => {
  const { provider } = req.params;
  const config = provider === 'google'
    ? { id: GOOGLE_CLIENT_ID, secret: GOOGLE_CLIENT_SECRET, url: 'https://accounts.google.com/o/oauth2/v2/auth', scope: 'openid email profile' }
    : provider === 'facebook'
      ? { id: FACEBOOK_CLIENT_ID, secret: FACEBOOK_CLIENT_SECRET, url: 'https://www.facebook.com/v21.0/dialog/oauth', scope: 'email public_profile' }
      : null;

  if (!config?.id || !config.secret) {
    return res.status(400).json({ success: false, message: `${provider} sign-in is not configured.` });
  }

  const state = randomBytes(24).toString('hex');
  res.cookie('social_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env['NODE_ENV'] === 'production',
    maxAge: SOCIAL_STATE_TTL_MS,
  });

  const redirectUri = `${req.protocol}://${req.get('host')}/api/auth/social/${provider}/callback`;
  const params = new URLSearchParams({
    client_id: config.id,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: config.scope,
    state,
  });
  if (provider === 'google') {
    params.set('access_type', 'offline');
    params.set('prompt', 'select_account');
  }

  return res.redirect(`${config.url}?${params.toString()}`);
});

/**
 * Completes the flow: verifies state, exchanges the code, then finds or creates
 * the local user and issues the same JWT shape as /api/auth/login so the client
 * keeps a single "I have a session" code path.
 */
app.get('/api/auth/social/:provider/callback', async (req: Request, res: Response) => {
  const { provider } = req.params;
  const query = req.query as Record<string, unknown>;
  const code = typeof query['code'] === 'string' ? query['code'] : '';
  const state = typeof query['state'] === 'string' ? query['state'] : '';
  const error = typeof query['error'] === 'string' ? query['error'] : '';

  if (error) {
    return res.redirect('/login?socialError=denied');
  }
  if (!code || !state) {
    return res.redirect('/login?socialError=invalid_response');
  }

  // `res.cookie` only sets; the stored nonce is read back off the request.
  const expected = req.cookies?.social_state;
  res.clearCookie('social_state');
  // Length check first: timingSafeEqual throws on mismatched buffer lengths, and
  // the constant-time compare is what keeps the nonce from leaking by timing.
  if (!expected || expected.length !== state.length ||
      !timingSafeEqual(Buffer.from(expected), Buffer.from(state))) {
    return res.redirect('/login?socialError=state_mismatch');
  }

  try {
    const redirectUri = `${req.protocol}://${req.get('host')}/api/auth/social/${provider}/callback`;

    let profile: OAuthProfile;
    if (provider === 'google') {
      const accessToken = await exchangeCodeForToken('https://oauth2.googleapis.com/token', {
        code, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri, grant_type: 'authorization_code',
      });
      profile = await fetchOAuthProfile('https://openidconnect.googleapis.com/v1/userinfo', accessToken);
    } else if (provider === 'facebook') {
      const accessToken = await exchangeCodeForToken('https://graph.facebook.com/v21.0/oauth/access_token', {
        code, client_id: FACEBOOK_CLIENT_ID, client_secret: FACEBOOK_CLIENT_SECRET,
        redirect_uri: redirectUri, grant_type: 'authorization_code',
      });
      profile = await fetchOAuthProfile(
        'https://graph.facebook.com/me?fields=id,name,email,first_name,last_name,picture',
        accessToken,
      );
    } else {
      return res.redirect('/login?socialError=unsupported_provider');
    }

    if (!profile.email) {
      return res.redirect('/login?socialError=email_required');
    }

    const usersCollection = await getUsersCollection();
    const now = new Date();
    // Reuse the existing account so a shopper who signed up with a password can
    // link a provider and keep their cart, wishlist and order history.
    const existing = await usersCollection.findOne({ email: profile.email }) as UserDocument | null;

    let userId: any;
    if (existing) {
      userId = existing._id;
      await usersCollection.updateOne(
        { _id: existing._id },
        {
          $set: { lastLogin: now },
          $addToSet: { socialProviders: { provider, providerId: profile.providerId } },
        },
      );
    } else {
      const created = await usersCollection.insertOne({
        email: profile.email,
        // Social accounts have no password. A random hash keeps the field
        // non-empty so password login can never match this account.
        passwordHash: await bcrypt.hash(randomBytes(32).toString('hex'), 10),
        firstName: profile.firstName || 'Customer',
        lastName: profile.lastName || '',
        phone: '',
        addresses: [],
        socialProviders: [{ provider, providerId: profile.providerId }],
        avatar: profile.avatar ?? null,
        createdAt: now,
        lastLogin: now,
        isActive: true,
        role: 'user',
      });
      userId = created.insertedId;
    }

    const user = await usersCollection.findOne({ _id: userId }) as UserDocument;
    if (!user.isActive) {
      return res.redirect('/login?socialError=account_disabled');
    }

    const token = jwt.sign(
      { userId: user._id.toString(), email: user.email, role: user.role },
      getJwtSecret(),
      { expiresIn: jwtExpiresIn },
    );

    // Hand the token over in a short-lived httpOnly cookie so it never sits in
    // the address bar or browser history; the client exchanges it via
    // POST /api/auth/social/exchange, which puts it in localStorage like a
    // normal password login.
    res.cookie('social_token', token, {
      httpOnly: true, sameSite: 'lax',
      secure: process.env['NODE_ENV'] === 'production', maxAge: SOCIAL_STATE_TTL_MS,
    });
    return res.redirect('/login?socialCallback=1');
  } catch (err) {
    console.error('Social login callback error:', err);
    return res.redirect('/login?socialError=failed');
  }
});

/**
 * Trades the short-lived social cookie for a normal session response, so the
 * client stores the token exactly as it does after /api/auth/login. The cookie
 * is cleared immediately, whether or not the exchange succeeds.
 */
app.post('/api/auth/social/exchange', (req: Request, res: Response) => {
  const token = req.cookies?.social_token;
  res.clearCookie('social_token');

  if (!token) {
    return res.status(401).json({ success: false, message: 'No pending social sign-in.' });
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret()) as { userId: string; email: string; role?: string };
    return res.json({
      success: true,
      token,
      user: {
        id: decoded.userId,
        email: decoded.email,
        role: decoded.role ?? 'user',
      },
    });
  } catch {
    return res.status(401).json({ success: false, message: 'Social sign-in expired. Please try again.' });
  }
});

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
      getJwtSecret(),
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
      getJwtSecret(),
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
 * Request a password reset link.
 *
 * Always answers 200 with the same message, whether or not the email matches an
 * account, so the endpoint cannot be used to enumerate registered shoppers.
 */
app.post('/api/auth/forgot-password', async (req, res) => {
  const email = String(req.body?.email ?? '').toLowerCase().trim();

  if (!email) {
    return res.status(400).json({ success: false, message: 'Email is required.' });
  }

  try {
    const usersCollection = await getUsersCollection();
    const user = await usersCollection.findOne({ email }) as UserDocument | null;

    if (user) {
      const crypto = require('crypto');
      const token = crypto.randomBytes(32).toString('hex');
      const resetUrl = `${resolveAppBaseUrl(req)}/reset-password?token=${token}`;

      await usersCollection.updateOne(
        { _id: user._id },
        {
          $set: {
            passwordResetTokenHash: hashPasswordResetToken(token),
            passwordResetExpiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
            updatedAt: new Date(),
          },
        }
      );

      const mail = buildPasswordResetMessage({ firstName: user.firstName, resetUrl });
      await trySendEmail({ to: user.email, subject: mail.subject, text: mail.text, html: mail.html });
    } else {
      console.log('Password reset requested for an email with no account.');
    }

    return res.status(200).json({
      success: true,
      message: 'If an account exists for that email, a password reset link is on its way.',
    });
  } catch (error) {
    console.error('forgot-password error', error);
    return res.status(500).json({ success: false, message: 'Unable to process the request right now.' });
  }
});

/**
 * Complete a password reset with the token from the emailed link.
 */
app.post('/api/auth/reset-password', async (req, res) => {
  const token = String(req.body?.token ?? '').trim();
  const password = String(req.body?.password ?? '');

  if (!token || !password) {
    return res.status(400).json({ success: false, message: 'Token and new password are required.' });
  }

  if (password.length < 8) {
    return res.status(400).json({ success: false, message: 'Password must be at least 8 characters.' });
  }

  try {
    const usersCollection = await getUsersCollection();

    // Match on the hash (never the raw token) and require the link to be valid.
    const user = await usersCollection.findOne({
      passwordResetTokenHash: hashPasswordResetToken(token),
      passwordResetExpiresAt: { $gt: new Date() },
    }) as UserDocument | null;

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'This reset link is invalid or has expired. Please request a new one.',
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await usersCollection.updateOne(
      { _id: user._id },
      {
        $set: { passwordHash, updatedAt: new Date() },
        // Single use: the token is burned as soon as it is redeemed.
        $unset: { passwordResetTokenHash: '', passwordResetExpiresAt: '' },
      }
    );

    const mail = buildPasswordChangedMessage();
    await trySendEmail({ to: user.email, subject: mail.subject, text: mail.text, html: mail.html });

    return res.status(200).json({ success: true, message: 'Password updated. You can now sign in.' });
  } catch (error) {
    console.error('reset-password error', error);
    return res.status(500).json({ success: false, message: 'Unable to reset the password right now.' });
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
      decoded = jwt.verify(token, getJwtSecret());
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
      decoded = jwt.verify(token, getJwtSecret());
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
      decoded = jwt.verify(token, getJwtSecret());
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
      decoded = jwt.verify(token, getJwtSecret());
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

/** Restricts owner-only catalog and order operations to admins (or local sandbox tooling). */
function requireAdmin(req: Request & { user?: any }, res: Response, next: NextFunction) {
  const isAdmin = req.user?.role === 'admin';
  const isLocalDev = req.user?.isDev === true && process.env['NODE_ENV'] !== 'production';
  if (!isAdmin && !isLocalDev) {
    return res.status(403).json({ success: false, message: 'Admin access required' });
  }
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



app.post('/api/create-cod-order', authenticateJwt, async (req: Request, res: Response) => {
  let inventory: Awaited<ReturnType<typeof reserveOrderInventory>> | null = null;
  let orderReference: string | null = null;
  try {
    const userId = requestUserId((req as Request & { user?: any }).user);
    if (!userId) {
      return res.status(401).json({ success: false, message: 'A valid authenticated account is required.' });
    }
    const { name, email: requestedEmail, address, items, total, currency } = req.body;
    const email = ((req as Request & { user?: any }).user?.email || requestedEmail || '').toLowerCase();

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

  orderReference = `ORDER-${Date.now()}`;
  inventory = await reserveOrderInventory(orderReference, priced.items);
  if (!inventory.result.ok) {
    return res.status(409).json({ success: false, message: inventory.result.message });
  }
  const ordersCollection = await getOrdersCollection();

  const order: OrderDocument = {
      orderReference,
      userId,
      name,
      email,
      address,
      items: priced.items,
      total: orderTotal,
      currency: orderCurrency,
      paymentMethod: 'COD',
      status: 'pending',
      inventoryItems: inventory.lines,
      inventoryState: inventory.lines.length ? 'reserved' : 'none',
      inventoryUpdatedAt: new Date(),
      createdAt: new Date()
    };

    await ordersCollection.insertOne(order);
    await consumeOrderInventory(order);

    const mail = buildOrderConfirmationMessage({
      name, email, address, items: priced.items, total: orderTotal,
      orderReference, paymentMethod: 'COD', currency: orderCurrency
    });

    const sent = await trySendEmail({
      to: email,
      subject: mail.subject,
      text: mail.text,
      html: mail.html
    });

    // Merchant notification with the full order details (address, sizes, cost).
    const merchantMail = buildMerchantOrderNotification({
      name,
      email,
      address,
      items: priced.items,
      total: orderTotal,
      currency: orderCurrency,
      orderReference,
      paymentMethod: 'COD',
      orderStatus: 'pending'
    });

    await trySendEmail({
      to: orderNotificationEmail,
      replyTo: email,
      subject: merchantMail.subject,
      text: merchantMail.text,
      html: merchantMail.html
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
    // If persistence or post-reservation processing fails, return any units
    // still held by this order instead of leaking them permanently.
    if (inventory) {
      try {
        await releaseInventory(inventory.products, orderReference ?? '', inventory.lines);
      } catch (releaseError) {
        console.error('COD inventory cleanup error:', releaseError);
      }
    }
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
      // New orders use the immutable account id. Legacy orders without userId
      // remain visible by their normalized account email during migration.
      const userId = requestUserId(currentUser);
      filter.$or = [
        ...(userId ? [{ userId }] : []),
        { email: String(currentUser?.email || '').toLowerCase() },
      ];
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
    const currentUser = (req as Request & { user?: { userId?: string; email?: string; role?: string } }).user;
    if (currentUser?.role !== 'admin' && !userOwnsOrder(order, currentUser)) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    return res.json({ success: true, order });
  } catch (err) {
    console.error('get order error', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch order' });
  }
});

// PATCH /api/orders/:orderReference/status - Update order status
app.patch('/api/orders/:orderReference/status', authenticateJwt, requireAdmin, async (req, res) => {
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
    if (status === 'cancelled') {
      const order = await ordersCollection.findOne<OrderDocument>({ orderReference: req.params.orderReference });
      if (order) await releaseOrderInventory(order);
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
app.post('/api/confirm-razorpay-payment', authenticateJwt, async (req, res) => {
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
    const ownedOrder = await ordersCollection.findOne<OrderDocument>({ orderReference });
    if (!ownedOrder || !userOwnsOrder(ownedOrder, (req as Request & { user?: any }).user)) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    await consumeOrderInventory(ownedOrder);

    // Transition the order to 'paid' only on the first confirmation. Both the
    // browser callback and the Razorpay webhook can fire for the same payment;
    // guarding here (and in the webhook) keeps customer and merchant
    // notification emails from being sent twice.
    const paidTransition = await ordersCollection.updateOne(
      { orderReference, status: { $ne: 'paid' } },
      { $set: { status: 'paid', razorpayPaymentId, razorpayOrderId, updatedAt: new Date() } }
    );

    if (paidTransition.modifiedCount === 0) {
      console.log(`Razorpay confirmation: Order ${orderReference} already paid; skipping duplicate notifications.`);
      return res.status(200).json({ success: true, orderReference, duplicate: true });
    }

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

      // Merchant notification with the full order details (address, sizes, cost).
      const merchantMail = buildMerchantOrderNotification({
        name: order.name,
        email: order.email,
        address: order.address,
        items: order.items,
        total: order.total,
        currency: order.currency,
        orderReference,
        paymentMethod: 'Razorpay',
        orderStatus: 'paid'
      });

      await trySendEmail({
        to: orderNotificationEmail,
        replyTo: order.email,
        subject: merchantMail.subject,
        text: merchantMail.text,
        html: merchantMail.html,
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
      if (existingOrder) await consumeOrderInventory(existingOrder);
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

          // Merchant notification with the full order details (address, sizes, cost).
          const merchantMail = buildMerchantOrderNotification({
            name: order.name,
            email: order.email,
            address: order.address,
            items: order.items,
            total: order.total,
            currency: order.currency,
            orderReference,
            paymentMethod: 'Razorpay',
            orderStatus: 'paid'
          });

          await trySendEmail({
            to: orderNotificationEmail,
            replyTo: order.email,
            subject: merchantMail.subject,
            text: merchantMail.text,
            html: merchantMail.html,
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
/**
 * Marks a Stripe order as paid exactly once and sends the customer and merchant
 * notifications. Shared by the browser return URL and the Stripe webhook, both
 * of which can arrive for the same payment.
 */
async function settleStripeCheckoutSession(
  session: Stripe.Checkout.Session
): Promise<{ orderReference: string; duplicate: boolean } | null> {
  const orderReference = (session.client_reference_id || session.metadata?.['orderReference'] || '').trim();
  if (!orderReference) {
    return null;
  }

  const paymentIntentId =
    typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;

  const ordersCollection = await getOrdersCollection();

  const order = await ordersCollection.findOne<OrderDocument>({ orderReference });
  if (!order) return null;
  await consumeOrderInventory(order);

  // Guard on status so the return URL and the webhook cannot both send emails.
  const paidTransition = await ordersCollection.updateOne(
    { orderReference, status: { $ne: 'paid' } },
    {
      $set: {
        status: 'paid',
        stripeSessionId: session.id,
        stripePaymentIntentId: paymentIntentId,
        updatedAt: new Date(),
      },
    }
  );

  if (paidTransition.modifiedCount === 0) {
    console.log(`Stripe confirmation: Order ${orderReference} already paid; skipping duplicate notifications.`);
    return { orderReference, duplicate: true };
  }

  const latestOrder = await ordersCollection.findOne<OrderDocument>({ orderReference });
  if (latestOrder) {
    const mail = buildOrderConfirmationMessage({
      name: latestOrder.name,
      email: latestOrder.email,
      items: latestOrder.items,
      total: latestOrder.total,
      currency: latestOrder.currency,
      orderReference,
      paymentMethod: 'Stripe',
    });
    await trySendEmail({ to: latestOrder.email, subject: mail.subject, text: mail.text, html: mail.html });

    const merchantMail = buildMerchantOrderNotification({
      name: latestOrder.name,
      email: latestOrder.email,
      address: latestOrder.address,
      items: latestOrder.items,
      total: latestOrder.total,
      currency: latestOrder.currency,
      orderReference,
      paymentMethod: 'Stripe',
      orderStatus: 'paid',
    });
    await trySendEmail({
      to: orderNotificationEmail,
      replyTo: latestOrder.email,
      subject: merchantMail.subject,
      text: merchantMail.text,
      html: merchantMail.html,
    });
  }

  return { orderReference, duplicate: false };
}

/**
 * Create a Stripe Checkout Session for international (USD) card payments.
 * Returns a hosted checkout URL, so no card data ever touches this app.
 */
app.post('/api/create-stripe-checkout-session', authenticateJwt, async (req, res) => {
  if (!stripe) {
    return res.status(500).json({
      success: false,
      message: 'Stripe is not configured. Set STRIPE_SECRET_KEY to accept international payments.',
    });
  }

  const userId = requestUserId((req as Request & { user?: any }).user);
  if (!userId) {
    return res.status(401).json({ success: false, message: 'A valid authenticated account is required.' });
  }
  const { name, email: requestedEmail, address, items, total, currency } = req.body;
  const email = ((req as Request & { user?: any }).user?.email || requestedEmail || '').toLowerCase();

  if (!name || !email || !Array.isArray(items) || typeof total !== 'number') {
    return res.status(400).json({ success: false, message: 'Name, email, items, and total are required.' });
  }

  const frontendCurrency = String(currency || 'USD').toUpperCase();

  // Stripe is the international gateway and always charges in USD; domestic
  // shoppers pay through Razorpay instead.
  if (frontendCurrency !== 'USD') {
    return res.status(400).json({
      success: false,
      message: 'International card payments are processed in USD. Please switch the currency to USD.',
    });
  }

  // Re-price the order from the catalog so a tampered or stale cart cannot set
  // the amount Stripe charges.
  const priced = await priceOrderItems(items);
  if (!priced.ok) {
    return res.status(400).json({ success: false, message: priced.message });
  }

  const resolved = resolveOrderTotal(priced, total, frontendCurrency, '[Stripe]');
  if (!resolved.ok) {
    return res.status(400).json({ success: false, message: resolved.message });
  }
  const orderTotal = resolved.total;
  const orderReference = `ORDER-${Date.now()}`;
  const inventory = await reserveOrderInventory(orderReference, priced.items);
  if (!inventory.result.ok) {
    return res.status(409).json({ success: false, message: inventory.result.message });
  }

  try {
    const baseUrl = resolveAppBaseUrl(req);
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: email,
      client_reference_id: orderReference,
      line_items: priced.items.map((item) => ({
        quantity: item.quantity,
        price_data: {
          currency: 'usd',
          unit_amount: Math.round(item.product.price * 100),
          product_data: {
            name: item.size ? `${item.product.name} (size ${item.size})` : item.product.name,
          },
        },
      })),
      metadata: {
        orderReference,
        customerName: String(name),
        customerEmail: String(email),
        orderTotal: String(orderTotal),
      },
      success_url: `${baseUrl}/checkout-success?session_id={CHECKOUT_SESSION_ID}&order=${orderReference}`,
      cancel_url: `${baseUrl}/checkout?cancelled=${orderReference}`,
    });

    // Save the order with 'pending' status before returning, exactly like the
    // Razorpay flow, so the confirmation step has a document to settle.
    const ordersCollection = await getOrdersCollection();
    const order: OrderDocument = {
      orderReference,
      userId,
      name,
      email,
      address: address || '',
      items: priced.items,
      total: orderTotal,
      currency: frontendCurrency,
      paymentMethod: 'Stripe',
      status: 'pending',
      inventoryItems: inventory.lines,
      inventoryState: inventory.lines.length ? 'reserved' : 'none',
      inventoryUpdatedAt: new Date(),
      stripeSessionId: session.id,
      createdAt: new Date(),
    };
    await ordersCollection.insertOne(order);

    console.log(`[Stripe] Session ${session.id} created for ${orderReference} (${orderTotal} USD)`);

    return res.status(200).json({
      success: true,
      orderReference,
      sessionId: session.id,
      checkoutUrl: session.url,
      publishableKey: stripePublishableKey,
      amount: session.amount_total,
      currency: session.currency,
    });
  } catch (error) {
    await releaseInventory(inventory.products, orderReference, inventory.lines);
    console.error('create-stripe-checkout-session error', error);
    return res.status(500).json({ success: false, message: 'Unable to start the Stripe payment.' });
  }
});

/**
 * Confirm a Stripe payment after the shopper returns from the hosted checkout.
 */
app.post('/api/confirm-stripe-payment', authenticateJwt, async (req, res) => {
  if (!stripe) {
    return res.status(500).json({ success: false, message: 'Stripe is not configured.' });
  }

  const { orderReference, sessionId } = req.body;

  if (!sessionId && !orderReference) {
    return res.status(400).json({ success: false, message: 'A session id or order reference is required.' });
  }

  try {
    const ordersCollection = await getOrdersCollection();
    const ownedOrder = await ordersCollection.findOne<OrderDocument>({ orderReference: String(orderReference || '') });
    if (ownedOrder && !userOwnsOrder(ownedOrder, (req as Request & { user?: any }).user)) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    let session: Stripe.Checkout.Session | null = null;

    if (sessionId) {
      session = await stripe.checkout.sessions.retrieve(String(sessionId));
      const sessionOrderReference = String(session.client_reference_id || session.metadata?.['orderReference'] || '');
      const sessionOrder = await ordersCollection.findOne<OrderDocument>({ orderReference: sessionOrderReference });
      if (!sessionOrder || !userOwnsOrder(sessionOrder, (req as Request & { user?: any }).user)) {
        return res.status(404).json({ success: false, message: 'Order not found' });
      }
    } else {
      // Some browsers return only the order reference.
      const order = await ordersCollection.findOne<OrderDocument>({ orderReference: String(orderReference) });
      if (order?.stripeSessionId) {
        session = await stripe.checkout.sessions.retrieve(order.stripeSessionId);
      }
    }

    if (!session) {
      return res.status(404).json({ success: false, message: 'Stripe payment session not found.' });
    }

    // Never trust the redirect alone: the session is fetched back from Stripe and
    // must be genuinely paid before the order is released.
    if (session.payment_status !== 'paid') {
      return res.status(400).json({
        success: false,
        message: 'Payment has not completed yet. If money left your account, contact support with your order reference.',
      });
    }

    const settled = await settleStripeCheckoutSession(session);
    if (!settled) {
      return res.status(400).json({ success: false, message: 'The payment session is not linked to an order.' });
    }

    return res.status(200).json({
      success: true,
      orderReference: settled.orderReference,
      duplicate: settled.duplicate,
    });
  } catch (error) {
    console.error('confirm-stripe-payment error', error);
    return res.status(500).json({ success: false, message: 'Unable to confirm the Stripe payment.' });
  }
});

/**
 * Stripe webhook - server-side payment confirmation (reliable for redirects).
 * Configure this URL in the Stripe dashboard: https://api.ammawears.com/api/stripe-webhook
 */
app.post('/api/stripe-webhook', async (req: Request, res: Response) => {
  if (!stripe) {
    console.error('Stripe webhook: Stripe not configured');
    return res.status(500).json({ success: false, message: 'Stripe is not configured.' });
  }

  let event: Stripe.Event;

  try {
    if (stripeWebhookSecret) {
      const signature = req.headers['stripe-signature'] as string;
      if (!signature) {
        return res.status(400).json({ success: false, message: 'Missing Stripe signature.' });
      }
      // req.body is a Buffer here because of the express.raw() registration.
      const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));
      event = stripe.webhooks.constructEvent(rawBody, signature, stripeWebhookSecret);
    } else {
      console.warn('Stripe webhook: STRIPE_WEBHOOK_SECRET is not set; skipping signature verification.');
      event = (Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString('utf8')) : req.body) as Stripe.Event;
    }
  } catch (error) {
    console.error('Stripe webhook signature error', error);
    return res.status(400).json({ success: false, message: 'Invalid Stripe webhook signature.' });
  }

  try {
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const session = event.data.object;
      if (session.payment_status === 'paid') {
        const settled = await settleStripeCheckoutSession(session);
        if (settled) {
          console.log(`Stripe webhook: order ${settled.orderReference} settled`);
        }
      }
    }

    // Always acknowledge receipt so Stripe does not retry indefinitely.
    return res.status(200).json({ success: true, received: true });
  } catch (error) {
    console.error('Stripe webhook error', error);
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

/**
 * Lean catalog feed for the shop grid.
 *
 * `/api/products/` returns full documents (long descriptions, every variant,
 * review payloads). The grid only renders a card per product, so this endpoint
 * projects just the fields a card needs and lets Mongo skip the heavy ones.
 * The front end falls back to the full endpoint if this one is unavailable.
 */
const LIST_PRODUCT_PROJECTION = {
  _id: 1,
  name: 1,
  basePrice: 1,
  price: 1,
  originalPrice: 1,
  currency: 1,
  category: 1,
  images: 1,
  image: 1,
  rating: 1,
  averageRating: 1,
  reviewCount: 1,
  reviewsCount: 1,
  numReviews: 1,
  stock: 1,
  tags: 1,
  isActive: 1,
  createdAt: 1,
} as const;

app.get('/api/products/list', async (req, res) => {
  try {
    const productsCollection = await getProductsCollection();
    const { category, minPrice, maxPrice, search, limit = 48, page = 1 } = req.query;

    const filter: any = {};
    if (category) filter.category = category;
    if (minPrice !== undefined && maxPrice !== undefined) {
      filter.basePrice = { $gte: Number(minPrice), $lte: Number(maxPrice) };
    } else if (minPrice !== undefined) {
      filter.basePrice = { $gte: Number(minPrice) };
    } else if (maxPrice !== undefined) {
      filter.basePrice = { $lte: Number(maxPrice) };
    }
    if (search) filter.$text = { $search: search };

    const safeLimit = Math.min(Math.max(Number(limit) || 48, 1), 200);
    const skip = (Math.max(Number(page) || 1, 1) - 1) * safeLimit;

    const [rawProducts, total] = await Promise.all([
      productsCollection
        .find(filter, { projection: LIST_PRODUCT_PROJECTION })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(safeLimit)
        .toArray(),
      productsCollection.countDocuments(filter),
    ]);

    // Keep the owner-only strip and name cleanup, but drop the fields the grid
    // never renders so the response stays small.
    const products = rawProducts.map((raw: any) => {
      const product = toPublicCatalogProduct(raw);
      delete product.description;
      delete product.variants;
      delete product.updatedAt;
      delete product.buyUrl;
      delete product.supplier;
      return product;
    });

    return res.json({ success: true, products, total, page: Number(page) || 1, limit: safeLimit });
  } catch (error) {
    console.error('Get product list error:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch product list' });
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

app.get('/api/products/:id/reviews', async (req: Request, res: Response) => {
  try {
    const productId = String(req.params.id || '').trim();
    if (!productId) return res.status(400).json({ success: false, message: 'Product id is required.' });
    const reviews = await (await getReviewsCollection()).find({ productId }).sort({ createdAt: -1 }).limit(50).toArray();
    const rating = reviews.length
      ? Math.round((reviews.reduce((sum, review) => sum + Number(review.rating || 0), 0) / reviews.length) * 10) / 10
      : null;
    return res.json({ success: true, reviews, rating, reviewCount: reviews.length });
  } catch (error) {
    console.error('Get product reviews error:', error);
    return res.status(500).json({ success: false, message: 'Unable to load reviews.' });
  }
});

app.post('/api/products/:id/reviews', authenticateJwt, async (req: Request, res: Response) => {
  try {
    const productId = String(req.params.id || '').trim();
    const userId = requestUserId((req as Request & { user?: any }).user);
    const rating = Number(req.body?.rating);
    const title = String(req.body?.title || '').trim();
    const comment = String(req.body?.comment || '').trim();
    if (!productId || !userId) return res.status(400).json({ success: false, message: 'Product and account are required.' });
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ success: false, message: 'Rating must be a whole number from 1 to 5.' });
    if (comment.length < 10 || comment.length > 1000) return res.status(400).json({ success: false, message: 'Review must be between 10 and 1000 characters.' });
    if (title.length > 120) return res.status(400).json({ success: false, message: 'Review title is too long.' });

    const reviews = await getReviewsCollection();
    const review = { productId, userId, rating, title, comment, createdAt: new Date(), updatedAt: new Date() };
    const result = await reviews.updateOne(
      { productId, userId },
      { $set: { rating, title, comment, updatedAt: review.updatedAt }, $setOnInsert: { createdAt: review.createdAt } },
      { upsert: true }
    );
    return res.status(result.upsertedCount ? 201 : 200).json({ success: true, review, updated: result.modifiedCount > 0 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('E11000')) {
      return res.status(409).json({ success: false, message: 'You have already reviewed this product.' });
    }
    console.error('Create product review error:', error);
    return res.status(500).json({ success: false, message: 'Unable to save review.' });
  }
});


app.post('/api/products/', authenticateJwt, requireAdmin, async (req: Request & { body: ProductCreateDto }, res: Response) => {
  try {
    const productsCollection = await getProductsCollection();
    const { name, description, basePrice, stock, currency, category, images, variants, tags, isActive, buyUrl, supplier } = req.body;
    
    if (!name || !description || !basePrice || !currency || !category) {
      return res.status(400).json({ success: false, message: "Name, description, basePrice, currency, and category are required" });
    }
    const normalizedStock = stock === null || stock === undefined ? null : Number(stock);
    if (normalizedStock !== null && (!Number.isInteger(normalizedStock) || normalizedStock < 0)) {
      return res.status(400).json({ success: false, message: "Stock must be a non-negative integer or null" });
    }
    
    const product: ProductDocument = {
      _id: new ObjectId(),
      name,
      description,
      basePrice: Number(basePrice),
      ...(normalizedStock === null ? {} : { stock: normalizedStock }),
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

app.put('/api/products/:id/', authenticateJwt, requireAdmin, async (req: Request, res: Response) => {
  try {
    const productsCollection = await getProductsCollection();
    const { name, description, basePrice, stock, currency, category, images, variants, tags, isActive, buyUrl, supplier } = req.body;
    
    const updateData: any = {};
    if (stock !== undefined) {
      const normalizedStock = stock === null ? null : Number(stock);
      if (normalizedStock !== null && (!Number.isInteger(normalizedStock) || normalizedStock < 0)) {
        return res.status(400).json({ success: false, message: "Stock must be a non-negative integer or null" });
      }
      updateData.stock = normalizedStock;
    }
    
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
app.post('/api/products/:id/images', authenticateJwt, requireAdmin, async (req: Request, res: Response) => {
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
app.delete('/api/products/:id/images/:index', authenticateJwt, requireAdmin, async (req: Request, res: Response) => {
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
app.get('/api/admin/products/:id/purchase-link', authenticateJwt, requireAdmin, async (req: Request, res: Response) => {
  try {
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


app.delete('/api/products/:id/', authenticateJwt, requireAdmin, async (req: Request, res: Response) => {
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
    
    // Convert ObjectId to string for frontend and attach product info
    const wishlistsWithStringIds = await Promise.all(wishlists.map(async wishlist => ({
      ...wishlist,
      _id: wishlist._id.toString(),
      userId: wishlist.userId.toString(),
      items: await withProductInfo(wishlist.items)
    })));
    
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
    
    // Convert ObjectId to string for frontend and attach product info
    const wishlistWithStringIds = {
      ...wishlist,
      _id: wishlist._id.toString(),
      userId: wishlist.userId.toString(),
      items: await withProductInfo(wishlist.items)
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

    if (!productId || (typeof productId !== 'string' && typeof productId !== 'number')) {
      return res.status(400).json({ success: false, message: "Product ID is required" });
    }

    if (!require("mongodb").ObjectId.isValid(wishlistId)) {
      return res.status(400).json({ success: false, message: "Invalid wishlist ID" });
    }

    // Bundled-catalog products (products.json) use plain numeric ids (e.g.
    // "100000"), which are NOT Mongo ObjectIds. Only enforce the ObjectId
    // format for ids that are clearly intended to be Mongo ids (24 hex chars).
    const productIdText = String(productId);
    const isMongoProductId = /^[0-9a-f]{24}$/i.test(productIdText);
    if (isMongoProductId && !require("mongodb").ObjectId.isValid(productIdText)) {
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

    // Check if item already exists in wishlist (compare by string form so
    // bundled numeric ids and ObjectIds are handled the same way).
    const itemExists = wishlist.items.some((item: any) => {
      const existingId = item.productId?.toString?.() ?? String(item.productId ?? '');
      if (existingId !== productIdText) {
        return false;
      }
      if (variantId === null) {
        return !item.variantId;
      }
      return item.variantId !== null && item.variantId !== undefined &&
        item.variantId.toString() === String(variantId);
    });

    if (itemExists) {
      return res.status(409).json({ success: false, message: "Item already exists in wishlist" });
    }

    // Snapshot the product info so the wishlist page can show the name, price
    // and image even if the catalog entry changes or disappears later.
    let productInfo: Record<string, any> | null = null;
    try {
      productInfo = await lookupWishlistProductInfo(productIdText);
    } catch (error) {
      console.warn('Wishlist product snapshot failed:', error instanceof Error ? error.message : error);
    }

    const newItem: any = {
      productId: isMongoProductId ? new (require("mongodb")).ObjectId(productIdText) : productIdText,
      variantId: variantId ? new (require("mongodb")).ObjectId(variantId) : null,
      addedAt: new Date(),
      notes: notes || "",
      productName: productInfo?.name ?? null,
      productPrice: productInfo?.basePrice ?? null,
      productCurrency: productInfo?.currency ?? 'USD',
      productImage: (Array.isArray(productInfo?.images) && productInfo.images[0]) || null,
      productCategory: productInfo?.category ?? null,
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
    
    // Bundled-catalog products use plain numeric ids, so only treat 24-hex-char
    // ids as Mongo ObjectIds; anything else is matched by its string form.
    const productIdText = String(productId ?? '');
    if (!productIdText) {
      return res.status(400).json({ success: false, message: "Product ID is required" });
    }
    const isMongoProductId = /^[0-9a-f]{24}$/i.test(productIdText) && require("mongodb").ObjectId.isValid(productIdText);
    
    // Pull the item first so modifiedCount reports whether anything was removed,
    // then touch updatedAt separately (otherwise updatedAt alone would always
    // mark the document as modified and hide "item not found").
    const productIdSpec: any = isMongoProductId ? new (require("mongodb")).ObjectId(productIdText) : productIdText;
    const pullSpec: any = variantId && require("mongodb").ObjectId.isValid(variantId)
      ? { items: { productId: productIdSpec, variantId: new (require("mongodb")).ObjectId(variantId) } }
      : { items: { productId: productIdSpec } };

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
 * Meta (WhatsApp Cloud API / Messenger) webhook verification handshake.
 *
 * Meta GETs the configured callback URL with `hub.mode`, `hub.verify_token` and
 * `hub.challenge` query params and expects the challenge echoed back verbatim.
 *
 * This handler MUST NOT swallow ordinary traffic to `/` (the storefront is
 * served by the static/SSR middleware at the end of this file), so anything
 * that is not a verification handshake is passed through with `next()`.
 *
 * Configure the callback URL as: https://api.ammawears.com/
 */
app.get('/', (req: Request, res: Response, next: NextFunction) => {
  // Guard against invalid response objects (Angular SSR route extraction).
  if (!res || typeof res !== 'object' || typeof res.headersSent !== 'boolean') {
    console.error('Invalid response object in meta webhook verification');
    return;
  }

  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  // Not a Meta verification handshake - let the normal page/SSR flow handle it.
  if (typeof mode !== 'string' || typeof token !== 'string' || typeof challenge !== 'string') {
    return next();
  }

  if (mode && token === metaVerifyToken) {
    console.log('Meta webhook verification succeeded');
    return res.status(200).type('text/plain').send(challenge);
  }

  console.warn('Meta webhook verification failed: invalid verify token or mode');
  return res.status(403).send('Verification failed');
});

/**
 * Meta (WhatsApp Cloud API) inbound message delivery.
 *
 * Registered on the same callback URL as the handshake above. Meta signs the
 * exact request bytes, so the raw parser registered near the top of this file
 * is what makes verification possible; re-serialising the parsed JSON would
 * change the bytes and the signature would never match.
 *
 * Each message is stored first and only the newly inserted ones are emailed, so
 * a Meta retry cannot notify the store owner twice.
 */
app.post('/', async (req: Request, res: Response) => {
  if (!res || typeof res !== 'object' || typeof res.headersSent !== 'boolean') {
    console.error('Invalid response object in meta webhook delivery');
    return;
  }

  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {}));
  const signature = req.headers['x-hub-signature-256'] as string | undefined;

  if (!verifyMetaSignature(rawBody, signature, metaAppSecret)) {
    // Fail closed: an unverified payload could be forged by anyone who knows
    // the callback URL, and it would end up in the owner's inbox.
    console.warn('Meta webhook delivery rejected: missing or invalid X-Hub-Signature-256');
    return res.status(401).send('Invalid signature');
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    console.warn('Meta webhook delivery rejected: body is not valid JSON');
    return res.status(400).send('Invalid payload');
  }

  // `parseInboundMessages` is total, so anything unusable simply yields no
  // messages; acknowledging is still correct because a 4xx would only make
  // Meta redeliver the same unusable payload.
  const messages = parseInboundMessages(payload);

  if (messages.length === 0) {
    return res.status(200).json({ success: true, received: true, processed: 0 });
  }

  const collection = await getMetaMessagesCollection();
  let processed = 0;
  let duplicates = 0;

  for (const message of messages) {
    // insertOne is the de-duplication gate: a redelivered message collides with
    // the unique messageId index, so it is counted and skipped rather than
    // notifying the store owner a second time.
    let insertedId: ObjectId;
    try {
      const inserted = await collection.insertOne({
        ...message,
        receivedAt: new Date(),
        notified: false,
      });
      insertedId = inserted.insertedId;
    } catch (error) {
      if ((error as { code?: number })?.code === 11000) {
        duplicates++;
        continue;
      }
      throw error;
    }

    // Store first, notify second: a crash between the two leaves `notified:
    // false` to investigate rather than a silently lost customer message.
    const mail = buildInboundMessageEmail(message);
    await sendEmail({ to: orderNotificationEmail, ...mail });
    await collection.updateOne({ _id: insertedId }, { $set: { notified: true } });
    processed++;
    console.log(`Meta webhook: stored and notified for message ${message.messageId}`);
  }

  return res.status(200).json({ success: true, received: true, processed, duplicates });
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
app.get('/robots.txt', (_req: Request, res: Response) => {
  res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${resolveAppBaseUrl()}/sitemap.xml\n`);
});

app.get('/sitemap.xml', (_req: Request, res: Response) => {
  const base = resolveAppBaseUrl();
  const urls = ['/', '/products', '/about', '/contact', '/shipping-returns'];
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(url => `<url><loc>${base}${url}</loc></url>`).join('')}</urlset>`);
});

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

// Static assets are only on disk after `ng build`. Under `ng serve` the browser
// bundle is held in memory by Vite, so registering express.static against a
// folder that does not exist is pointless; skipping it keeps the error surface
// clean and lets the dev server answer instead.
if (hasBuiltClient()) {
  app.use(
    express.static(browserDistFolder, {
      maxAge: '1y',
      index: false,
      redirect: false,
    }),
  );
} else {
  console.log('No built client bundle found; static middleware and CSR fallback disabled (expected under `ng serve`).');
}

/**
 * Handle all other requests by rendering the Angular application.

 */ 
app.use(async (req: Request, res: Response, next: NextFunction) => {
  // Guard against invalid Express response objects - return early if res is invalid
  if (!res || typeof res !== 'object' || typeof res.headersSent !== 'boolean') {
    console.warn('SSR middleware skipped: invalid response object');
    return next();
  }

  // SSR is the default. The CSR path is kept as an explicit opt-out because it
  // still works when the server bundle is missing (a client-only deployment)
  // or when an engine change needs to be rolled back quickly.
  if (process.env['ENABLE_SSR'] === 'false') {
    // Without a built client there is nothing on disk to send, and calling
    // `res.sendFile` with a non-existent path throws ENOENT and turns every
    // page request into a 500. Hand the request back so the Vite dev server
    // (which serves the client from memory) can answer it instead.
    const fallbackHtml = getClientFallbackPath();
    if (!fallbackHtml) {
      return next();
    }
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
      // In development without an SSR build, serve the available client entry.
      // When there is no built client either, pass the request along rather
      // than erroring on a path that does not exist.
      const fallbackHtml = getClientFallbackPath();
      if (!fallbackHtml) {
        return next();
      }
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
    // Serve the available CSR entry if SSR fails.
    try {
      const fallbackHtml = getClientFallbackPath();
      if (!fallbackHtml) {
        return next(err);
      }
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
 * Decide whether this process should own the API listener.
 *
 * Every supported launch path runs `node dist/Nizam/server/server.mjs`
 * directly -- the Docker `CMD`, the Render `startCommand`, and
 * `npm run serve:ssr`. In all of those `isMainModule` is true. PM2 is covered
 * by `pm_id`.
 *
 * `NODE_ENV === 'production'` is deliberately NOT used as a trigger. The
 * Angular builder sets `NODE_ENV=production` in the child process it uses to
 * import this module during `ng build`, so keying off it made the build start a
 * listener and run the startup assertions (and fail the build when secrets
 * such as `JWT_SECRET` are not present in the build environment, as in the
 * Docker builder stage where `.env` is excluded by `.dockerignore`).
 */
function shouldStartServer(): boolean {
  if (isMainModule(import.meta.url)) {
    return true;
  }
  if (process.env['pm_id']) {
    return true;
  }
  // Escape hatch for hosts that load the bundle as a library but still expect
  // it to boot. Opt-in only, so it can never fire during a build.
  return process.env['START_SERVER_ON_IMPORT'] === 'true';
}

if (shouldStartServer()) {
  // Fail fast on a misconfigured runtime. The builder imports this module too,
  // so the check lives here rather than at module scope.
  assertJwtSecret();

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

  // Half-hour personalized new-product campaigns. The job is best-effort and
  // remains a no-op until MongoDB, SES, and a verified sender are configured.
  setInterval(() => { void sendNewProductCampaign(); }, 30 * 60 * 1000);
  void sendNewProductCampaign();

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


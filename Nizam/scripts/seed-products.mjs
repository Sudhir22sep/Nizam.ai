#!/usr/bin/env node
/**
 * Seeds MongoDB with the bundled catalog (public/assets/products.json).
 *
 * The storefront already falls back to the bundled JSON when the `products`
 * collection is empty or MongoDB is unavailable, so seeding is optional — it is
 * what you run when you want the catalog to live in the database (so owner
 * edits, image uploads and search indexing persist).
 *
 * Usage:
 *   MONGODB_URI="mongodb+srv://user:pass@cluster/ammawears_prod" npm run seed:products
 *
 * The upsert key is the catalog's numeric `id`, which keeps bundled ids working
 * for the wishlist and for /api/products/:id lookups. Re-running is safe.
 */
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';

// Load .env when present, so `npm run seed:products` works without exporting
// MONGODB_URI by hand. Values already present in the environment win.
try {
  const { config } = await import('dotenv');
  config({ quiet: true });
} catch {
  // dotenv is optional; the environment can provide MONGODB_URI instead.
}

const here = dirname(fileURLToPath(import.meta.url));
const catalogPath = resolve(here, '../public/assets/products.json');

const uri = process.env['MONGODB_URI'];
const dbName =
  process.env['MONGODB_DB'] ||
  (process.env['NODE_ENV'] === 'production' ? 'ammawears_prod' : 'ammawears_dev');

if (!uri) {
  console.error('MONGODB_URI is required, e.g. MONGODB_URI="mongodb+srv://…" npm run seed:products');
  process.exit(1);
}

const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
if (!Array.isArray(catalog) || catalog.length === 0) {
  console.error(`No products found in ${catalogPath}`);
  process.exit(1);
}

const client = new MongoClient(uri);

try {
  await client.connect();
  const products = client.db(dbName).collection('products');

  // Mirrors the indexes created by the server on startup.
  await products.createIndex({ name: 'text', description: 'text' });
  await products.createIndex({ id: 1 });

  let inserted = 0;
  let updated = 0;

  for (const product of catalog) {
    const now = new Date();
    const result = await products.updateOne(
      { id: product.id },
      {
        $set: {
          // Catalog `price` is the USD base amount the app prices everything from.
          name: product.name,
          description: product.description ?? '',
          basePrice: Number(product.price),
          currency: 'USD',
          category: product.category ?? 'Uncategorised',
          images: product.image ? [product.image] : [],
          variants: [],
          tags: [],
          isActive: true,
          updatedAt: now,
        },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true }
    );

    if (result.upsertedCount > 0) {
      inserted += 1;
    } else if (result.modifiedCount > 0) {
      updated += 1;
    }
  }

  const total = await products.countDocuments();
  console.log(`Seeded ${dbName}.products → inserted ${inserted}, updated ${updated} (catalog size ${catalog.length})`);
  console.log(`Collection now holds ${total} product document(s).`);
} catch (error) {
  console.error('Seeding failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await client.close();
}

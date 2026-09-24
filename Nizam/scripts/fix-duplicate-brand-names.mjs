import { readFile, writeFile } from 'node:fs/promises';

/**
 * Removes a duplicated brand prefix from product names, e.g.
 *   "DKNY DKNY Unisex Black Trolley Bag"  -> "DKNY Unisex Black Trolley Bag"
 *   "YAK YAK YAK YAK Men Polo T-shirt"    -> "YAK Men Polo T-shirt"
 *
 * The bundled catalog (public/assets/products.json) was imported from a
 * Myntra CSV whose `name` column already starts with the `brand` column, and
 * the importer prepended the brand again — so most names repeat the brand
 * twice (495 of 500 rows). This script collapses any leading token sequence
 * that immediately repeats itself. It is idempotent: running it again is a
 * no-op.
 */

/** Collapses a leading `N`-word sequence immediately repeated in the name. */
export function dedupeBrandPrefix(name) {
  const words = name.trim().split(/\s+/);
  for (let take = Math.floor(words.length / 2); take >= 1; take -= 1) {
    const first = words.slice(0, take).join(' ').toLowerCase();
    const second = words.slice(take, take * 2).join(' ').toLowerCase();
    // Word-boundary guards so "Raymond Raymonds" is NOT collapsed.
    const boundaryStart = (s) => new RegExp(`^${s}\\b`).test(second);
    const boundaryEnd = (s) => new RegExp(`${s}\\b$`).test(first);
    if (first === second && boundaryStart(second) && boundaryEnd(first)) {
      return words.slice(take).join(' ');
    }
  }
  return name.trim();
}

const target = process.argv[2] ?? 'public/assets/products.json';
const raw = JSON.parse(await readFile(target, 'utf8'));
const products = Array.isArray(raw) ? raw : raw.products;

let changed = 0;
for (const product of products) {
  if (typeof product?.name === 'string') {
    const cleaned = dedupeBrandPrefix(product.name);
    if (cleaned !== product.name) {
      product.name = cleaned;
      changed += 1;
    }
  }
}

const out = Array.isArray(raw) ? products : { ...raw, products };
await writeFile(target, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
console.log(`Scanned ${products.length} products in ${target}: renamed ${changed}.`);

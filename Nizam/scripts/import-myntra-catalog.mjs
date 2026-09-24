import { readFile, writeFile } from 'node:fs/promises';

const [inputPath, outputPath = 'public/assets/products.json', limitArgument = '500'] = process.argv.slice(2);
const limit = Number.parseInt(limitArgument, 10);

if (!inputPath || !Number.isInteger(limit) || limit < 1) {
  console.error('Usage: node scripts/import-myntra-catalog.mjs <csv-path> [output-path] [limit]');
  process.exit(1);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(value);
      value = '';
    } else if (char === '\n') {
      row.push(value.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      value = '';
    } else {
      value += char;
    }
  }

  if (value || row.length) {
    row.push(value.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows;
}

function categoryFor(product) {
  const gender = product.gender.trim().toLowerCase();
  const name = product.name.toLowerCase();
  if (/shoe|sandal|boot|loafer|slipper|heel|sneaker/.test(name)) return 'Footwear';
  if (/bag|wallet|belt|watch|scarf|cap|hat|sunglass|jewellery|jewelry/.test(name)) return 'Accessories';
  if (gender === 'women') return 'Women';
  if (gender === 'men') return 'Men';
  return 'Accessories';
}

function normaliseImage(images) {
  return images.split(' ~ ')[0].trim().replace(/^http:/, 'https:');
}

const csv = await readFile(inputPath, 'utf8');
const [headers, ...rows] = parseCsv(csv);
const products = rows
  .map(row => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ''])))
  .filter(product => product.in_stock.trim().toLowerCase() === 'true')
  .map(product => ({
    name: product.name.trim(),
    description: product.description.replace(/\s+/g, ' ').trim(),
    priceInInr: Number(product.price),
    image: normaliseImage(product.images),
    category: categoryFor(product),
    brand: product.brand.trim()
  }))
  .filter(product => product.name && product.description && Number.isFinite(product.priceInInr) && product.priceInInr > 0 && product.image)
  .slice(0, limit)
  .map((product, index) => {
    // Myntra `name` values already start with the brand (e.g. "DKNY Unisex …").
    // Strip that prefix first so `${brand} ${name}` cannot render it twice.
    const brand = product.brand.trim();
    const brandPattern = brand
      ? new RegExp(`^${brand.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\s+`, 'i')
      : null;
    const title = brandPattern ? product.name.replace(brandPattern, '') : product.name;

    return {
      id: 100000 + index,
      name: brand ? `${brand} ${title}`.trim() : title,
      description: product.description,
      // Product prices are stored in USD because CurrencyService converts from USD.
      price: Number((product.priceInInr / 82.5).toFixed(2)),
      image: product.image,
      category: product.category
    };
  });

await writeFile(outputPath, `${JSON.stringify(products, null, 2)}\n`);
console.log(`Imported ${products.length} Myntra products into ${outputPath}.`);

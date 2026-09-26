#!/usr/bin/env node
/**
 * Generates responsive WebP variants for the product photography.
 *
 * The originals are 1200x1600 JPEGs of ~100-290 kB, but a product card renders
 * at roughly 260 CSS px. Shipping the full-size original therefore wasted most
 * of the payload. This script writes WebP at the widths the storefront actually
 * uses and reports the saving; the originals are left in place because the
 * product detail gallery still requests a larger size.
 *
 * Usage: node scripts/optimize-images.mjs
 */
import { readdir, stat } from 'fs/promises';
import { join, parse, extname } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const imageDir = join(here, '..', 'public', 'images', 'products');

/** Widths the storefront requests. 1600 covers the zoomed detail gallery. */
const WIDTHS = [320, 640, 1280];
const QUALITY = 78;

const RASTER = new Set(['.jpg', '.jpeg', '.png']);

async function main() {
  const entries = await readdir(imageDir);
  const sources = entries.filter(name => RASTER.has(extname(name).toLowerCase()));
  if (sources.length === 0) {
    console.log('No raster images found; nothing to do.');
    return;
  }

  let originalBytes = 0;
  let generatedBytes = 0;

  for (const name of sources) {
    const sourcePath = join(imageDir, name);
    const { name: base } = parse(name);
    originalBytes += (await stat(sourcePath)).size;

    for (const width of WIDTHS) {
      const target = join(imageDir, `${base}-${width}w.webp`);
      // `withoutEnlargement` avoids upscaling the smaller originals, and a
      // skipped write keeps the build idempotent across runs.
      const info = await sharp(sourcePath)
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: QUALITY })
        .toFile(target)
        .catch(error => {
          console.warn(`  skipped ${base}-${width}w: ${error.message}`);
          return null;
        });

      if (info) generatedBytes += info.size;
    }

    console.log(`  ${name} -> ${WIDTHS.length} WebP variants`);
  }

  const saved = originalBytes - generatedBytes;
  console.log(
    `\nOriginals (largest served size): ${(originalBytes / 1024).toFixed(0)} kB`,
  );
  console.log(`Generated WebP variants total: ${(generatedBytes / 1024).toFixed(0)} kB`);
  console.log(
    `A card at 320w now costs ~${(generatedBytes / sources.length / 3 / 1024).toFixed(0)} kB ` +
      `instead of ~${(originalBytes / sources.length / 1024).toFixed(0)} kB.`,
  );
  console.log(`Net disk change: +${(generatedBytes / 1024).toFixed(0)} kB across ${sources.length} images.`);
  void saved;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

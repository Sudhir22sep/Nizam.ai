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

const here = dirname(fileURLToPath(import.meta.url));
const imageDir = join(here, '..', 'public', 'images', 'products');

// `sharp` is a devDependency and carries native binaries, so it is the first
// thing to go missing when the build runs with devDependencies omitted (for
// example `npm ci` under NODE_ENV=production, which is what Render used to do
// because the service exports NODE_ENV during the build too).
//
// Generating the WebP variants is an optimisation, not a correctness
// requirement -- the storefront falls back to the original JPEG/PNG when a
// variant is absent. Importing it lazily and degrading gracefully means a
// missing or unbuildable native module downgrades image weight instead of
// failing the whole deploy with ERR_MODULE_NOT_FOUND.
let sharp = null;
let sharpLoadError = null;
try {
  ({ default: sharp } = await import('sharp'));
} catch (error) {
  sharpLoadError = error;
}

/** Widths the storefront requests. 1600 covers the zoomed detail gallery. */
const WIDTHS = [320, 640, 1280];
const QUALITY = 78;

const RASTER = new Set(['.jpg', '.jpeg', '.png']);

async function main() {
  if (!sharp) {
    console.warn('sharp is unavailable, so no WebP variants were generated.');
    console.warn(`  reason: ${sharpLoadError instanceof Error ? sharpLoadError.message : String(sharpLoadError)}`);
    console.warn('  The originals are still served, so this only costs image weight, not correctness.');
    console.warn('  Install devDependencies (npm ci --include=dev) to generate them during a build.');
    return;
  }

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

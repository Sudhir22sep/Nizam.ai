/**
 * Generates the app icon and splash sources that @capacitor/assets consumes.
 *
 * Run this when the brand artwork changes, then run `npm run assets:generate`
 * to push the derived sizes into android/ and ios/.
 *
 * @capacitor/assets requires exact 1024x1024 inputs with no transparency in
 * the icon, so the logo is centred on an opaque brand-navy canvas rather than
 * cropped. The canvas colour matches --brand-dark in src/styles.css and the
 * splash background in capacitor.config.ts, so the icon, the splash and the
 * app's own header all agree.
 *
 * Usage: node scripts/generate-app-assets.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');

/** Brand navy — matches --brand-dark and the configured splash background. */
const BRAND_NAVY = { r: 0x14, g: 0x26, b: 0x3d, alpha: 1 };

/** Source logo, outside the Angular workspace (repo root). */
const LOGO_SOURCE = path.resolve(projectRoot, '..', 'ammawears.jpg');

/** @capacitor/assets input/output contract. */
const RESOURCES_DIR = path.join(projectRoot, 'resources');
const ICON_OUTPUT = path.join(RESOURCES_DIR, 'icon.png');
const SPLASH_OUTPUT = path.join(RESOURCES_DIR, 'splash.png');

/** @capacitor/assets requires these exact dimensions. */
const SOURCE_SIZE = 1024;

/**
 * Crops the portrait logo to a square centred on the subject.
 *
 * The source is 1365x2048 with the subject running down the middle, so a plain
 * `contain` fit would leave wide empty bands down both sides of an app icon.
 * Instead we crop a square window whose top edge sits at ~28% of the height,
 * which frames head and torso — the recognisable part — and drops the floor.
 *
 * `fit: 'cover'` alone would centre the crop vertically and cut the subject's
 * head off, so the window is extracted explicitly.
 */
async function croppedSquare() {
  const { width, height } = await sharp(LOGO_SOURCE).metadata();
  if (!width || !height) {
    throw new Error(`Could not read dimensions of ${LOGO_SOURCE}`);
  }

  const size = Math.min(width, height);
  const top = Math.round((height - size) * 0.28);

  return sharp(LOGO_SOURCE)
    .extract({ left: 0, top, width: size, height: size })
    .resize(SOURCE_SIZE, SOURCE_SIZE, { fit: 'cover' })
    .png()
    .toBuffer();
}

/**
 * Builds the app icon: a full-bleed square crop of the logo.
 *
 * Flattened onto an opaque background because iOS rejects alpha channels in
 * app icons and rejects icons that are not square.
 */
async function buildIcon() {
  const photo = await croppedSquare();

  return sharp(photo).flatten({ background: BRAND_NAVY }).png().toBuffer();
}

/**
 * Builds the splash source: brand background with the cropped logo centred.
 *
 * The logo is kept to 45% of the frame so it survives both iOS's rounded
 * masking and Android's letterboxing, and so the spinner beneath it stays
 * visible.
 */
async function buildSplash() {
  const logoSize = Math.round(SOURCE_SIZE * 0.45);
  const photo = await croppedSquare();

  const logo = await sharp(photo)
    .resize(logoSize, logoSize, { fit: 'cover' })
    .png()
    .toBuffer();

  return sharp({
    create: {
      width: SOURCE_SIZE,
      height: SOURCE_SIZE,
      channels: 4,
      background: BRAND_NAVY,
    },
  })
    .composite([
      {
        input: logo,
        top: Math.round((SOURCE_SIZE - logoSize) / 2),
        left: Math.round((SOURCE_SIZE - logoSize) / 2),
        blend: 'over',
      },
    ])
    .flatten({ background: BRAND_NAVY })
    .png()
    .toBuffer();
}

async function main() {
  await mkdir(RESOURCES_DIR, { recursive: true });

  const [icon, splash] = await Promise.all([buildIcon(), buildSplash()]);

  await Promise.all([
    writeFile(ICON_OUTPUT, icon),
    writeFile(SPLASH_OUTPUT, splash),
  ]);

  console.log(`Wrote ${path.relative(projectRoot, ICON_OUTPUT)} (1024x1024)`);
  console.log(`Wrote ${path.relative(projectRoot, SPLASH_OUTPUT)} (1024x1024)`);
  console.log('\nNext: npm run assets:generate');
}

main().catch((error) => {
  console.error('Failed to generate app assets:', error.message);
  process.exitCode = 1;
});
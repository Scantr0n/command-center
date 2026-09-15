// Rasterizes the two icon-*-source.svg files into the PNG sizes the manifest
// and iOS actually require (they don't accept SVG: manifest icons need PNG
// for Android's install flow, and apple-touch-icon needs PNG for iOS). Not a
// repo dependency, since this only ever needs to run when a source icon
// changes: requires `npm install -D playwright` locally first (or point
// PLAYWRIGHT_CHROMIUM at any Chromium binary already on the machine).
//
// Two sources, not one: icon-512.png is the only target the manifest marks
// "any maskable", so it alone needs icon-maskable-source.svg's artwork
// shrunk to fit Android's adaptive-icon safe zone. apple-touch-icon.png and
// icon-192.png (manifest purpose "any") are never cropped by an OS-applied
// mask, so they render from icon-source.svg's full-scale artwork instead;
// rendering them from the maskable source left real dead space around the
// glyph on iOS home screens.
//
// Run whenever either public/icon*-source.svg changes:
//   node scripts/build-icons.js

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const OUT_DIR = path.join(__dirname, '..', 'public');
const STANDARD_SVG = path.join(OUT_DIR, 'icon-source.svg');
const MASKABLE_SVG = path.join(OUT_DIR, 'icon-maskable-source.svg');

const TARGETS = [
  { file: 'apple-touch-icon.png', size: 180, svgPath: STANDARD_SVG },
  { file: 'icon-192.png', size: 192, svgPath: STANDARD_SVG },
  { file: 'icon-512.png', size: 512, svgPath: MASKABLE_SVG }
];

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium' });
  for (const { file, size, svgPath } of TARGETS) {
    const svg = fs.readFileSync(svgPath, 'utf8');
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><html><head><style>
      html, body { margin: 0; padding: 0; }
      svg { display: block; width: ${size}px; height: ${size}px; }
    </style></head><body>${svg}</body></html>`);
    const outPath = path.join(OUT_DIR, file);
    await page.screenshot({ path: outPath, omitBackground: false });
    await page.close();
    console.log(`Wrote ${outPath} (${size}x${size}) from ${path.basename(svgPath)}`);
  }
  await browser.close();
})();

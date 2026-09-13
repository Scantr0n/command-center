// Rasterizes public/icon-maskable-source.svg into the PNG sizes the manifest
// and iOS actually require (they don't accept SVG: manifest icons need PNG
// for Android's install flow, and apple-touch-icon needs PNG for iOS). Not a
// repo dependency, since this only ever needs to run when the source icon
// changes: requires `npm install -D playwright` locally first (or point
// PLAYWRIGHT_CHROMIUM at any Chromium binary already on the machine).
//
// Run whenever public/icon-maskable-source.svg changes:
//   node scripts/build-icons.js

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const SVG_PATH = path.join(__dirname, '..', 'public', 'icon-maskable-source.svg');
const OUT_DIR = path.join(__dirname, '..', 'public');

const TARGETS = [
  { file: 'apple-touch-icon.png', size: 180 },
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 }
];

(async () => {
  const svg = fs.readFileSync(SVG_PATH, 'utf8');
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium' });
  for (const { file, size } of TARGETS) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><html><head><style>
      html, body { margin: 0; padding: 0; }
      svg { display: block; width: ${size}px; height: ${size}px; }
    </style></head><body>${svg}</body></html>`);
    const outPath = path.join(OUT_DIR, file);
    await page.screenshot({ path: outPath, omitBackground: false });
    await page.close();
    console.log(`Wrote ${outPath} (${size}x${size})`);
  }
  await browser.close();
})();

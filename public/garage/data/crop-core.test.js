const test = require('node:test');
const assert = require('node:assert/strict');
const { PLATFORM_CROPS, fitContain, cropBoxFraction, computeCropOverlay } = require('./crop-core.js');

test('PLATFORM_CROPS has the three real per-platform cover-crop ratios, no eBay entry', () => {
  assert.equal(PLATFORM_CROPS.poshmark.ratio, 0.75);
  assert.equal(PLATFORM_CROPS.vinted.ratio, 0.8);
  assert.equal(PLATFORM_CROPS.depop.ratio, 1);
  assert.equal(PLATFORM_CROPS.ebay, undefined);
});

test('fitContain fills the square container edge to edge when the photo is already square', () => {
  const r = fitContain(1, 1);
  assert.deepEqual(r, { widthFrac: 1, heightFrac: 1, offsetXFrac: 0, offsetYFrac: 0 });
});

test('fitContain letterboxes left/right for a portrait photo in a square container', () => {
  const r = fitContain(0.8, 1);
  assert.equal(r.widthFrac, 0.8);
  assert.equal(r.heightFrac, 1);
  assert.ok(Math.abs(r.offsetXFrac - 0.1) < 1e-9);
  assert.equal(r.offsetYFrac, 0);
});

test('fitContain letterboxes top/bottom for a landscape photo in a square container', () => {
  const r = fitContain(1.5, 1);
  assert.equal(r.widthFrac, 1);
  assert.ok(Math.abs(r.heightFrac - 2 / 3) < 1e-9);
  assert.equal(r.offsetXFrac, 0);
  assert.ok(r.offsetYFrac > 0);
});

test('fitContain rejects a non-positive aspect ratio', () => {
  assert.equal(fitContain(0, 1), null);
  assert.equal(fitContain(1, -1), null);
});

test('cropBoxFraction keeps the full photo when its ratio already matches the target', () => {
  const r = cropBoxFraction(0.75, 0.75);
  assert.deepEqual(r, { leftFrac: 0, topFrac: 0, widthFrac: 1, heightFrac: 1 });
});

test('cropBoxFraction takes a centered vertical slice off a wider-than-target photo', () => {
  // A 1:1 photo cropped to Poshmark's 3:4: keeps full height, 75% of the width, centered.
  const r = cropBoxFraction(1, 0.75);
  assert.equal(r.widthFrac, 0.75);
  assert.equal(r.heightFrac, 1);
  assert.equal(r.leftFrac, 0.125);
  assert.equal(r.topFrac, 0);
});

test('cropBoxFraction takes a centered horizontal slice off a taller-than-target photo', () => {
  // A 0.8-ratio (4:5) photo cropped to Depop's 1:1 square: keeps full width, 80% of the height, centered.
  const r = cropBoxFraction(0.8, 1);
  assert.equal(r.widthFrac, 1);
  assert.equal(r.heightFrac, 0.8);
  assert.equal(r.leftFrac, 0);
  assert.ok(Math.abs(r.topFrac - 0.1) < 1e-9);
});

test('computeCropOverlay: square 1000x1000 photo previewed as Poshmark 3:4', () => {
  const r = computeCropOverlay(1000, 1000, 0.75);
  assert.ok(Math.abs(r.leftPct - 12.5) < 1e-9);
  assert.equal(r.topPct, 0);
  assert.ok(Math.abs(r.widthPct - 75) < 1e-9);
  assert.equal(r.heightPct, 100);
});

test('computeCropOverlay: 800x1000 portrait photo previewed as Depop 1:1, accounts for its own letterbox', () => {
  const r = computeCropOverlay(800, 1000, 1);
  assert.ok(Math.abs(r.leftPct - 10) < 1e-9);
  assert.ok(Math.abs(r.topPct - 10) < 1e-9);
  assert.ok(Math.abs(r.widthPct - 80) < 1e-9);
  assert.ok(Math.abs(r.heightPct - 80) < 1e-9);
});

test('computeCropOverlay: a photo already shot at the target ratio previews as its full rendered frame', () => {
  // 900x1200 is exactly 3:4, so the Poshmark overlay should cover the whole letterboxed photo, not a slice of it.
  const r = computeCropOverlay(900, 1200, 0.75);
  assert.ok(Math.abs(r.leftPct - 12.5) < 1e-9);
  assert.equal(r.topPct, 0);
  assert.ok(Math.abs(r.widthPct - 75) < 1e-9);
  assert.equal(r.heightPct, 100);
});

test('computeCropOverlay rejects non-positive dimensions or ratio', () => {
  assert.equal(computeCropOverlay(0, 1000, 0.75), null);
  assert.equal(computeCropOverlay(1000, -5, 0.75), null);
  assert.equal(computeCropOverlay(1000, 1000, 0), null);
});

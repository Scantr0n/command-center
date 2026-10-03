#!/usr/bin/env node
/*
 * Regression tests for import-core.js, the CSV-parsing/row-building logic
 * behind the "Import CSV" bulk listings importer (import.js). No test
 * framework or dependency: node:test and node:assert ship with Node itself,
 * matching this repo's own no-extra-dependency convention (see
 * public/csm/data/import-core.test.js for the same pattern).
 *
 * Usage: node --test public/garage/data/import-core.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeHeader, slugifyForListingId, normalizePlatform, parsePlatformList,
  normalizeStatus, normalizeCategory, coerceField, csvField, parseCsv,
  guessMapping, buildRowFromMapping
} = require('./import-core.js');

test('normalizeHeader lowercases and strips non-alphanumerics', () => {
  assert.equal(normalizeHeader('Ebay Return Policy'), 'ebayreturnpolicy');
  assert.equal(normalizeHeader('  Handling_Time-Days  '), 'handlingtimedays');
});

test('slugifyForListingId matches app.js\'s own Quick Log rule exactly', () => {
  assert.equal(slugifyForListingId('Black Boots'), 'black-boots');
  assert.equal(slugifyForListingId('  Haggar Corduroy Pants!! '), 'haggar-corduroy-pants');
  assert.equal(slugifyForListingId(''), 'item');
  assert.equal(slugifyForListingId(null), 'item');
});

test('slugifyForListingId caps at 60 characters, same as app.js\'s copy', () => {
  const id = slugifyForListingId('x'.repeat(100));
  assert.equal(id.length, 60);
});

test('normalizePlatform maps real variants to the four real platform ids', () => {
  assert.equal(normalizePlatform('eBay'), 'ebay');
  assert.equal(normalizePlatform('Posh'), 'poshmark');
  assert.equal(normalizePlatform('Poshmark'), 'poshmark');
  assert.equal(normalizePlatform('DEPOP'), 'depop');
});

test('normalizePlatform leaves an unrecognized value as-is rather than guessing, so it fails validateListings visibly', () => {
  assert.equal(normalizePlatform('mercari'), 'mercari');
});

test('parsePlatformList splits on comma, semicolon, pipe, and slash, and normalizes each token', () => {
  assert.deepEqual(parsePlatformList('ebay, Poshmark'), ['ebay', 'poshmark']);
  assert.deepEqual(parsePlatformList('ebay; vinted'), ['ebay', 'vinted']);
  assert.deepEqual(parsePlatformList('ebay|depop'), ['ebay', 'depop']);
  assert.deepEqual(parsePlatformList('ebay/vinted/poshmark/depop'), ['ebay', 'vinted', 'poshmark', 'depop']);
});

test('parsePlatformList returns an empty array for a blank cell, not a one-item array of empty string', () => {
  assert.deepEqual(parsePlatformList(''), []);
  assert.deepEqual(parsePlatformList(null), []);
});

test('normalizeStatus defaults a blank cell to "ready-to-post", a freshly-imported row by definition', () => {
  assert.equal(normalizeStatus(''), 'ready-to-post');
  assert.equal(normalizeStatus(null), 'ready-to-post');
});

test('normalizeStatus maps real spreadsheet variants to the exact status values listings.json uses', () => {
  assert.equal(normalizeStatus('Active'), 'live');
  assert.equal(normalizeStatus('Published'), 'live');
  assert.equal(normalizeStatus('Ready'), 'ready-to-post');
  assert.equal(normalizeStatus('SOLD'), 'sold');
});

test('normalizeStatus leaves an unrecognized value as-is rather than guessing', () => {
  assert.equal(normalizeStatus('pending-review'), 'pending-review');
});

test('normalizeCategory maps real variants to the two real category ids, and a blank cell to null', () => {
  assert.equal(normalizeCategory('Boots'), 'shoes');
  assert.equal(normalizeCategory('Electronic'), 'electronics');
  assert.equal(normalizeCategory(''), null);
  assert.equal(normalizeCategory(null), null);
});

test('coerceField parses a number/int field, stripping $/, but rejects non-numeric text as null', () => {
  assert.equal(coerceField('$85.00', 'number'), 85);
  assert.equal(coerceField('2', 'int'), 2);
  assert.equal(coerceField('not a number', 'number'), null);
});

test('coerceField returns null for a null/undefined value regardless of type', () => {
  assert.equal(coerceField(null, 'number'), null);
  assert.equal(coerceField(undefined, 'status'), null);
});

test('coerceField with no type returns the value unchanged (plain trimmed text)', () => {
  assert.equal(coerceField('No Return Accepted', undefined), 'No Return Accepted');
});

test('csvField quotes a value containing a comma, quote, or newline; leaves a plain value bare', () => {
  assert.equal(csvField('plain'), 'plain');
  assert.equal(csvField('a,b'), '"a,b"');
  assert.equal(csvField('say "hi"'), '"say ""hi"""');
  assert.equal(csvField(null), '');
});

test('parseCsv handles a quoted field containing a comma and an escaped quote', () => {
  const rows = parseCsv('title,notes\n"Black Boots, size 9","said ""mint"" condition"\n');
  assert.deepEqual(rows, [['title', 'notes'], ['Black Boots, size 9', 'said "mint" condition']]);
});

test('parseCsv handles both \\n and \\r\\n line endings and strips a leading BOM', () => {
  const rows = parseCsv('﻿a,b\r\n1,2\n3,4');
  assert.deepEqual(rows, [['a', 'b'], ['1', '2'], ['3', '4']]);
});

test('parseCsv drops a fully blank trailing line rather than returning a phantom empty row', () => {
  const rows = parseCsv('a,b\n1,2\n');
  assert.deepEqual(rows, [['a', 'b'], ['1', '2']]);
});

const FIELD_DEFS = [
  { key: 'id', aliases: ['id', 'slug'] },
  { key: 'title', aliases: ['title'] },
  { key: 'price', aliases: ['price'], type: 'number' },
  { key: 'costBasis', aliases: ['costbasis'], type: 'number' },
  { key: 'category', aliases: ['category'], type: 'category' },
  { key: 'platforms', aliases: ['platforms'], type: 'platformList' },
  { key: 'status', aliases: ['status'], type: 'status' },
  { key: 'datePublished', aliases: ['datepublished'] },
  { key: 'notes', aliases: ['notes'] },
  { key: 'location', aliases: ['location'] },
  { key: 'ebayReturnPolicy', aliases: ['ebayreturnpolicy'] },
  { key: 'handlingTimeDays', aliases: ['handlingtimedays'], type: 'int' },
  { key: 'brand', aliases: ['brand'] },
  { key: 'size', aliases: ['size'] },
  { key: 'color', aliases: ['color'] },
  { key: 'condition', aliases: ['condition'] }
];

test('guessMapping auto-maps headers to field keys by normalized alias, ignoring an unmatched header', () => {
  const guesses = guessMapping(['Title', 'Price', 'Random Column'], FIELD_DEFS);
  assert.deepEqual(guesses, ['title', 'price', '']);
});

test('guessMapping only auto-maps a given field once, so two similarly-named columns don\'t collide', () => {
  const defs = [{ key: 'title', aliases: ['title'] }];
  const guesses = guessMapping(['Title', 'Item Title (title)'], defs);
  assert.deepEqual(guesses, ['title', '']);
});

test('buildRowFromMapping builds the real listings.json shape from flat CSV columns, including itemSpecifics and platforms', () => {
  const header = ['title', 'price', 'platforms', 'brand', 'size', 'color', 'condition'];
  const row = ['Black Boots', '$85', 'ebay, poshmark', 'Timberland', '9', 'Black', 'Pre-owned'];
  const mapping = Object.fromEntries(guessMapping(header, FIELD_DEFS).map((f, i) => [i, f]).filter(([, f]) => f));
  const usedIds = new Set();
  const built = buildRowFromMapping(row, mapping, usedIds, FIELD_DEFS);

  assert.equal(built.title, 'Black Boots');
  assert.equal(built.price, 85);
  assert.deepEqual(built.platforms, ['ebay', 'poshmark']);
  assert.deepEqual(built.soldOn, []);
  assert.deepEqual(built.listingUrls, {});
  assert.equal(built.status, 'ready-to-post');
  assert.deepEqual(built.itemSpecifics, { brand: 'Timberland', size: '9', color: 'Black', condition: 'Pre-owned' });
  assert.equal(built.id, 'black-boots');
});

test('buildRowFromMapping leaves platforms as an empty array when no platforms column was mapped/filled', () => {
  const mapping = { 0: 'title' };
  const built = buildRowFromMapping(['Black Boots'], mapping, new Set(), FIELD_DEFS);
  assert.deepEqual(built.platforms, []);
});

test('buildRowFromMapping defaults a blank status cell to "ready-to-post"', () => {
  const mapping = { 0: 'title' };
  const built = buildRowFromMapping(['Black Boots'], mapping, new Set(), FIELD_DEFS);
  assert.equal(built.status, 'ready-to-post');
});

test('buildRowFromMapping de-dupes a generated id against already-used ids with a numeric suffix', () => {
  const mapping = { 0: 'title' };
  const usedIds = new Set();
  const first = buildRowFromMapping(['Black Boots'], mapping, usedIds, FIELD_DEFS);
  const second = buildRowFromMapping(['Black Boots'], mapping, usedIds, FIELD_DEFS);
  assert.equal(first.id, 'black-boots');
  assert.equal(second.id, 'black-boots-2');
  assert.notEqual(first.id, second.id);
});

test('buildRowFromMapping respects an explicit id column instead of generating one from the title', () => {
  const mapping = { 0: 'id', 1: 'title' };
  const built = buildRowFromMapping(['custom-slug', 'Black Boots'], mapping, new Set(), FIELD_DEFS);
  assert.equal(built.id, 'custom-slug');
});

test('buildRowFromMapping treats a blank mapped cell as null, not an empty string', () => {
  const mapping = { 0: 'title', 1: 'location' };
  const built = buildRowFromMapping(['Black Boots', ''], mapping, new Set(), FIELD_DEFS);
  assert.equal(built.location, null);
});

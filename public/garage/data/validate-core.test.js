#!/usr/bin/env node
/*
 * Regression tests for validate-core.js: the shared platform list and
 * title-length caps, plus the duplicate-listing, suspicious-return-policy,
 * and missing-item-specifics rules, that the CLI validator (validate.js) and
 * the dashboard (app.js) both rely on. No test framework or dependency:
 * node:test and node:assert ship with Node itself, matching this repo's own
 * no-extra-dependency convention (see public/cgt/data/validate-core.test.js
 * and public/csm/data/validate-core.test.js for the same pattern).
 *
 * Usage: node --test public/garage/data/validate-core.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PLATFORMS,
  TITLE_HARD_LIMITS,
  DEPOP_TITLE_SOFT_LIMIT,
  findDuplicateListings,
  isSuspiciousEbayReturnPolicy,
  requiredItemSpecificFields,
  missingItemSpecifics,
  isDepopIneligible,
  emDashFields
} = require('./validate-core.js');

test('PLATFORMS is the real 4-platform list, the single source validate.js and app.js both read', () => {
  assert.deepEqual(PLATFORMS, ['ebay', 'vinted', 'poshmark', 'depop']);
});

test('TITLE_HARD_LIMITS: Vinted is really 100, not the 70 that once drifted into two separate copies (a1fd471)', () => {
  assert.deepEqual(TITLE_HARD_LIMITS, { ebay: 80, vinted: 100, poshmark: 80 });
  assert.equal(DEPOP_TITLE_SOFT_LIMIT, 50);
});

test('findDuplicateListings flags two live listings with the same title and price', () => {
  const listings = [
    { id: 'a', title: 'Black Boots', price: 85, status: 'live' },
    { id: 'b', title: '  black boots  ', price: 85, status: 'live' }
  ];
  const groups = findDuplicateListings(listings);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].map(l => l.id).sort(), ['a', 'b']);
});

test('findDuplicateListings does not flag the same title at a different real price', () => {
  const listings = [
    { id: 'a', title: 'Black Boots', price: 85, status: 'live' },
    { id: 'b', title: 'Black Boots', price: 65, status: 'live' }
  ];
  assert.deepEqual(findDuplicateListings(listings), []);
});

test('findDuplicateListings ignores a legitimately relisted sold item sharing title/price with a live one', () => {
  const listings = [
    { id: 'a', title: 'Black Boots', price: 85, status: 'live' },
    { id: 'b', title: 'Black Boots', price: 85, status: 'sold' }
  ];
  assert.deepEqual(findDuplicateListings(listings), []);
});

test('findDuplicateListings skips listings with no title or no price rather than grouping them on a blank key', () => {
  const listings = [
    { id: 'a', title: null, price: 85, status: 'live' },
    { id: 'b', title: null, price: 85, status: 'live' },
    { id: 'c', title: 'Sneakers', price: null, status: 'live' },
    { id: 'd', title: 'Sneakers', price: null, status: 'live' }
  ];
  assert.deepEqual(findDuplicateListings(listings), []);
});

test('isSuspiciousEbayReturnPolicy flags a policy meant for auto parts', () => {
  assert.equal(
    isSuspiciousEbayReturnPolicy('30-Day Seller-Paid Returns (Parts & Accessories)'),
    true
  );
  assert.equal(isSuspiciousEbayReturnPolicy('Automotive Returns Policy'), true);
});

test('isSuspiciousEbayReturnPolicy does not flag a real policy for this store\'s inventory', () => {
  assert.equal(isSuspiciousEbayReturnPolicy('No Return Accepted'), false);
  assert.equal(isSuspiciousEbayReturnPolicy('30-Day Free Returns'), false);
  assert.equal(isSuspiciousEbayReturnPolicy(null), false);
  assert.equal(isSuspiciousEbayReturnPolicy(undefined), false);
});

test('requiredItemSpecificFields requires size and color only for shoes', () => {
  assert.deepEqual(requiredItemSpecificFields({ category: 'shoes' }), ['brand', 'condition', 'size', 'color']);
  assert.deepEqual(requiredItemSpecificFields({ category: 'electronics' }), ['brand', 'condition']);
  assert.deepEqual(requiredItemSpecificFields({}), ['brand', 'condition']);
});

test('missingItemSpecifics flags only the fields actually required for that listing\'s category', () => {
  const shoe = { category: 'shoes', itemSpecifics: { brand: null, size: null, color: 'Black', condition: null } };
  assert.deepEqual(missingItemSpecifics(shoe), ['brand', 'condition', 'size']);

  const electronics = { category: 'electronics', itemSpecifics: { brand: 'Sony', condition: null } };
  assert.deepEqual(missingItemSpecifics(electronics), ['condition']);
});

test('missingItemSpecifics treats a missing itemSpecifics object as every required field missing', () => {
  assert.deepEqual(missingItemSpecifics({ category: 'electronics' }), ['brand', 'condition']);
});

test('isDepopIneligible flags only the "electronics" category, Depop\'s real blanket ban', () => {
  assert.equal(isDepopIneligible({ category: 'electronics' }), true);
  assert.equal(isDepopIneligible({ category: 'shoes' }), false);
  assert.equal(isDepopIneligible({}), false);
  assert.equal(isDepopIneligible(null), false);
});

test('the real listings.json on disk has no duplicate live listings', () => {
  const data = require('./listings.json');
  const listings = data.listings || [];
  assert.deepEqual(findDuplicateListings(listings), []);
});

test('the real listings.json on disk has no electronics listing actually live on Depop', () => {
  const data = require('./listings.json');
  const listings = data.listings || [];
  const violations = listings.filter(l => isDepopIneligible(l) && (l.platforms || []).includes('depop'));
  assert.deepEqual(violations, []);
});

test('emDashFields flags only the fields that actually contain an em dash', () => {
  const listing = { title: 'Nice Boots ' + String.fromCharCode(8212) + ' barely worn', location: 'Home' };
  assert.deepEqual(emDashFields(listing, ['title', 'location']), ['title']);
});

test('emDashFields skips a non-string field rather than throwing', () => {
  assert.deepEqual(emDashFields({ title: 42 }, ['title']), []);
});

test('emDashFields returns no hits for a missing object, same as CSM\'s copy', () => {
  assert.deepEqual(emDashFields(null, ['title']), []);
  assert.deepEqual(emDashFields(undefined, ['title']), []);
});

test('the real listings.json on disk has no em dash pasted into a title or location', () => {
  const data = require('./listings.json');
  const listings = data.listings || [];
  const hits = listings.filter(l => emDashFields(l, ['title', 'location']).length);
  assert.deepEqual(hits, []);
});

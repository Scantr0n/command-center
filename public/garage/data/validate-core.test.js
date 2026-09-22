#!/usr/bin/env node
/*
 * Regression tests for validate-core.js, the shared duplicate-listing,
 * suspicious-return-policy, and missing-item-specifics rules the CLI
 * validator (validate.js) and the dashboard's own "Possible duplicates"
 * panel (app.js) both rely on. No test framework or dependency: node:test
 * and node:assert ship with Node itself, matching this repo's own
 * no-extra-dependency convention (see public/cgt/data/validate-core.test.js
 * and public/csm/data/validate-core.test.js for the same pattern).
 *
 * Usage: node --test public/garage/data/validate-core.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  findDuplicateListings,
  isSuspiciousEbayReturnPolicy,
  requiredItemSpecificFields,
  missingItemSpecifics
} = require('./validate-core.js');

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

test('the real listings.json on disk has no duplicate live listings', () => {
  const data = require('./listings.json');
  const listings = data.listings || [];
  assert.deepEqual(findDuplicateListings(listings), []);
});

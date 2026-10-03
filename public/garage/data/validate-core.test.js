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
  emDashFields,
  validateListings
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

test('findDuplicateListings skips a truthy non-string title instead of throwing on .trim()', () => {
  const listings = [
    { id: 'a', title: 85, price: 85, status: 'live' },
    { id: 'b', title: 85, price: 85, status: 'live' }
  ];
  assert.doesNotThrow(() => findDuplicateListings(listings));
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

// validateListings pulls the same per-listing rules validate.js's CLI runs
// out into a shared function (see the comment above it in validate-core.js),
// so import.js's own CSV preview can run them in the browser. These mirror
// the exact fixtures/messages validate.js's own inline checks used to cover
// before the extraction, so the behavior stays provably unchanged.
function baseListing(overrides) {
  return Object.assign({
    id: 'black-boots', title: 'Black Boots', price: 85, costBasis: null, category: null,
    platforms: ['ebay'], soldOn: [], listingUrls: {}, status: 'draft', datePublished: null,
    notes: null, location: null, ebayReturnPolicy: null, handlingTimeDays: null,
    itemSpecifics: { brand: null, size: null, color: null, condition: null }
  }, overrides);
}

test('validateListings accepts a minimal real draft listing with no errors or warnings', () => {
  const { errors, warnings } = validateListings([baseListing()]);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
});

test('validateListings flags a missing id and a duplicate id', () => {
  const { errors } = validateListings([
    baseListing({ id: undefined }),
    baseListing({ id: 'dup' }),
    baseListing({ id: 'dup' })
  ]);
  assert.ok(errors.some(e => e.includes('missing "id"')));
  assert.ok(errors.some(e => e.includes('duplicate id "dup"')));
});

test('validateListings requires a non-empty platforms array and rejects an unknown platform', () => {
  const { errors } = validateListings([baseListing({ platforms: [] }), baseListing({ id: 'b', platforms: ['mercari'] })]);
  assert.ok(errors.some(e => e.includes('"platforms" must be a non-empty array')));
  assert.ok(errors.some(e => e.includes('platform "mercari" is not one of')));
});

test('validateListings blocks an electronics listing from being published to Depop', () => {
  const { errors } = validateListings([baseListing({ category: 'electronics', platforms: ['ebay', 'depop'] })]);
  assert.ok(errors.some(e => e.includes('Depop bans battery-powered/electronic items outright')));
});

test('validateListings rejects a listingUrls platform not in this listing\'s own platforms', () => {
  const { errors } = validateListings([baseListing({ platforms: ['ebay'], listingUrls: { vinted: 'https://vinted.com/x' } })]);
  assert.ok(errors.some(e => e.includes('listingUrls platform "vinted" is not in this listing\'s "platforms"')));
});

test('validateListings rejects a non-http(s) listingUrls value instead of accepting a placeholder', () => {
  const { errors } = validateListings([baseListing({ platforms: ['ebay'], listingUrls: { ebay: 'TBD' } })]);
  assert.ok(errors.some(e => e.includes('must be a real http(s) URL string')));
});

test('validateListings rejects an unknown status and a malformed datePublished', () => {
  const { errors } = validateListings([baseListing({ status: 'listed' }), baseListing({ id: 'b', datePublished: '2026-13-40' })]);
  assert.ok(errors.some(e => e.includes('status "listed" is not one of')));
  assert.ok(errors.some(e => e.includes('"datePublished" is not a YYYY-MM-DD date or null')));
});

test('validateListings warns about a live eBay listing missing ebayReturnPolicy and handlingTimeDays, same real bug this guards against', () => {
  const { warnings } = validateListings([baseListing({ status: 'live', platforms: ['ebay'], itemSpecifics: { brand: 'Timberland', size: null, color: null, condition: 'Pre-owned' } })]);
  assert.ok(warnings.some(w => w.includes('no "ebayReturnPolicy" logged')));
  assert.ok(warnings.some(w => w.includes('no "handlingTimeDays" logged')));
});

test('validateListings warns when a live eBay listing\'s return policy still looks like the inherited auto-parts template', () => {
  const { warnings } = validateListings([baseListing({
    status: 'live', platforms: ['ebay'], handlingTimeDays: 2,
    ebayReturnPolicy: '30-Day Seller-Paid Returns (Parts & Accessories)',
    itemSpecifics: { brand: 'Timberland', size: null, color: null, condition: 'Pre-owned' }
  })]);
  assert.ok(warnings.some(w => w.includes('mentions parts/accessories/auto')));
});

test('validateListings warns about missing itemSpecifics only for fields actually required on a live listing\'s category', () => {
  const { warnings } = validateListings([baseListing({
    status: 'live', platforms: ['ebay'], handlingTimeDays: 2, ebayReturnPolicy: 'No Return Accepted', category: 'shoes'
  })]);
  const specificsWarning = warnings.find(w => w.includes('logged in "itemSpecifics"'));
  assert.ok(specificsWarning);
  assert.ok(specificsWarning.includes('"brand", "condition", "size", "color"'));
});

test('validateListings warns once per platform a title busts that platform\'s own hard character cap', () => {
  const longTitle = 'X'.repeat(90);
  const { warnings } = validateListings([baseListing({ title: longTitle, platforms: ['ebay', 'poshmark'] })]);
  assert.equal(warnings.filter(w => w.includes("char cap")).length, 2);
});

test('validateListings warns on an em dash in a title, same rule emDashFields already covers', () => {
  const { warnings } = validateListings([baseListing({ title: 'Nice Boots ' + String.fromCharCode(8212) + ' barely worn' })]);
  assert.ok(warnings.some(w => w.includes('"title" contains an em dash')));
});

test('validateListings warns about two live listings sharing the same title and price, same rule findDuplicateListings already covers', () => {
  const { warnings } = validateListings([
    baseListing({ id: 'a', status: 'live', handlingTimeDays: 2, ebayReturnPolicy: 'No Return Accepted', itemSpecifics: { brand: 'Timberland', size: null, color: null, condition: 'Pre-owned' } }),
    baseListing({ id: 'b', status: 'live', handlingTimeDays: 2, ebayReturnPolicy: 'No Return Accepted', itemSpecifics: { brand: 'Timberland', size: null, color: null, condition: 'Pre-owned' } })
  ]);
  assert.ok(warnings.some(w => w.includes('possible duplicate listing')));
});

test('the real listings.json on disk has no validateListings errors', () => {
  const data = require('./listings.json');
  const { errors } = validateListings(data.listings || []);
  assert.deepEqual(errors, []);
});

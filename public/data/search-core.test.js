#!/usr/bin/env node
/*
 * Regression tests for search-core.js. The real bug this guards against:
 * a hub's app.js learns to consume a new record-level query param, but
 * recordHref()'s own type-to-param list never gets told, so a global
 * search result for that type silently stops deep-linking, with nothing
 * to catch it short of clicking one by eye (exactly what happened to
 * Sondrik's lead/channel/release/goal types, see search-core.js's comment).
 *
 * Usage: node --test public/data/search-core.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { RECORD_TYPE_PARAMS, recordHref } = require('./search-core.js');
const { SEARCH_SOURCES } = require('../../data/search-sources-core.js');

// Garage's five bulk-tracked entity types have no per-record modal or
// highlight target on their own hub page yet, and (unlike every other real
// type below) still have zero real rows logged in any of their five files,
// so there is nothing real yet to jump to: a real, small, explicit allowlist
// of intentional exceptions, not a silent skip. Requiring SEARCH_SOURCES
// directly here (rather than a second hand-typed snapshot of "every type it
// emits", which is exactly the kind of copy that drifted for Sondrik's own
// lead/channel/release/goal types before search-core.js existed) means a
// genuinely new type added there is real input to the assertion below on
// its very next test run, not something this file also has to be told
// about by hand.
const INTENTIONALLY_UNLINKED_TYPES = new Set(['sale', 'expense', 'dispute', 'supply', 'acquisition']);

test('every real SEARCH_SOURCES type either has a param mapping or is a documented, intentional exception', () => {
  const realTypes = [...new Set(SEARCH_SOURCES.map(s => s.type))];
  assert.ok(realTypes.length > 0, 'sanity check: SEARCH_SOURCES actually loaded something');
  for (const type of realTypes) {
    const hasMapping = !!RECORD_TYPE_PARAMS[type];
    const isDocumentedException = INTENTIONALLY_UNLINKED_TYPES.has(type);
    assert.ok(hasMapping || isDocumentedException,
      `"${type}" is a real SEARCH_SOURCES type with no param mapping and no documented exception, likely drift`);
  }
});

test('RECORD_TYPE_PARAMS never carries a stale entry for a type SEARCH_SOURCES no longer emits', () => {
  const realTypes = new Set(SEARCH_SOURCES.map(s => s.type));
  for (const type of Object.keys(RECORD_TYPE_PARAMS)) {
    assert.ok(realTypes.has(type), `"${type}" has a param mapping but SEARCH_SOURCES no longer emits it`);
  }
});

test('recordHref builds a hub-relative link with the matching query param', () => {
  assert.equal(recordHref({ hub: 'sondrik', type: 'lead', id: 'reddit-imadethis-tester-offer' }),
    '/sondrik/?lead=reddit-imadethis-tester-offer');
  assert.equal(recordHref({ hub: 'sondrik', type: 'channel', id: 'reddit' }),
    '/sondrik/?channel=reddit');
  assert.equal(recordHref({ hub: 'sondrik', type: 'release', id: 'v0.3.7' }),
    '/sondrik/?release=v0.3.7');
  assert.equal(recordHref({ hub: 'sondrik', type: 'goal', id: 'downloads-dec-31' }),
    '/sondrik/?goal=downloads-dec-31');
  assert.equal(recordHref({ hub: 'cgt', type: 'card', id: 'malkin-210' }),
    '/cgt/?card=malkin-210');
  assert.equal(recordHref({ hub: 'job-search', type: 'application', id: '42' }),
    '/job-search/?application=42');
});

test('recordHref falls back to the bare hub page for an unsupported type or a missing id', () => {
  assert.equal(recordHref({ hub: 'garage', type: 'sale', id: 'sale-1' }), '/garage/');
  assert.equal(recordHref({ hub: 'cgt', type: 'card', id: null }), '/cgt/');
});

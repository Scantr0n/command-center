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

// Every type server.js's SEARCH_SOURCES currently emits, and whether that
// hub's own app.js supports a record-level query param for it yet. Keep
// this list in sync with server.js's SEARCH_SOURCES types: a new source
// there should show up here as either `true` (once its hub's app.js reads
// the matching param) or `false` with a real reason.
const SERVER_SEARCH_SOURCE_TYPES = {
  card: true, prospect: true, listing: true, lead: true, application: true,
  submission: true, candidate: true, sale: false, expense: false,
  dispute: false, supply: false, acquisition: false, channel: true,
  release: true, goal: true
};

test('every deep-linkable search source type has a real param mapping', () => {
  Object.entries(SERVER_SEARCH_SOURCE_TYPES).forEach(([type, supported]) => {
    if (supported) assert.ok(RECORD_TYPE_PARAMS[type], `${type} should map to a query param`);
  });
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

#!/usr/bin/env node
/*
 * Regression tests for search-sources-core.js: the real per-source
 * label/detail/fields/exclude logic /api/search (server.js) and
 * public/data/search-core.test.js's own drift guard both depend on.
 *
 * Usage: node --test data/search-sources-core.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { SEARCH_SOURCES, SEARCH_RESULT_CAP, SEARCH_PER_SOURCE_CAP } = require('./search-sources-core.js');

function sourceFor(type) {
  const source = SEARCH_SOURCES.find(s => s.type === type);
  assert.ok(source, `no SEARCH_SOURCES entry for type "${type}"`);
  return source;
}

test('every source has the real shape /api/search relies on: hub, clusterId, file, key, type, label, detail, fields', () => {
  for (const source of SEARCH_SOURCES) {
    for (const key of ['hub', 'clusterId', 'file', 'key', 'type']) {
      assert.equal(typeof source[key], 'string', `${source.type || '?'}.${key} should be a real string`);
    }
    assert.equal(typeof source.label, 'function', `${source.type}.label should be a function`);
    assert.equal(typeof source.detail, 'function', `${source.type}.detail should be a function`);
    assert.equal(typeof source.fields, 'function', `${source.type}.fields should return an array of fields`);
    assert.ok(Array.isArray(source.fields({})), `${source.type}.fields(item) should return an array`);
  }
});

test('every source.type is unique, so /api/search results never collide on the same deep-link type', () => {
  const types = SEARCH_SOURCES.map(s => s.type);
  assert.equal(new Set(types).size, types.length);
});

test('the card source excludes the seeded example row, never surfacing it as a real card', () => {
  const cards = sourceFor('card');
  assert.equal(cards.exclude({ id: 'example-row-not-real' }), true);
  assert.equal(cards.exclude({ id: 'a-real-card-id' }), false);
});

test('the submission source excludes its own seeded example row', () => {
  const submissions = sourceFor('submission');
  assert.equal(submissions.exclude({ id: 'example-submission-not-real' }), true);
  assert.equal(submissions.exclude({ id: 'a-real-submission-id' }), false);
});

test('the candidate source excludes its own seeded example row', () => {
  const candidates = sourceFor('candidate');
  assert.equal(candidates.exclude({ id: 'example-candidate-not-real' }), true);
  assert.equal(candidates.exclude({ id: 'a-real-candidate-id' }), false);
});

test('sources with no exclude function (every non-CGT source) never gate out a real row', () => {
  for (const type of ['prospect', 'listing', 'lead', 'application', 'sale', 'expense', 'dispute', 'supply', 'acquisition', 'channel', 'release', 'goal']) {
    const source = sourceFor(type);
    assert.equal(source.exclude, undefined, `${type} should not have an exclude function`);
  }
});

test('label falls back to a real secondary field when the primary one is missing, never a blank string', () => {
  const leads = sourceFor('lead');
  assert.equal(leads.label({ sourceDetail: 'r/IMadeThis commenter' }), 'r/IMadeThis commenter');
  assert.equal(leads.label({ source: 'reddit' }), 'reddit');
  assert.equal(leads.label({}), 'Lead', 'a lead with neither real field still gets a real fallback label, not undefined');
});

test('detail never throws on a missing nested field (garage listing itemSpecifics)', () => {
  const listings = sourceFor('listing');
  assert.doesNotThrow(() => listings.fields({ title: 'Boots' }));
  assert.deepEqual(listings.fields({ title: 'Boots' }), ['Boots', undefined, undefined, undefined]);
});

test('SEARCH_RESULT_CAP and SEARCH_PER_SOURCE_CAP are real positive numbers, never accidentally zero/undefined', () => {
  assert.equal(typeof SEARCH_RESULT_CAP, 'number');
  assert.ok(SEARCH_RESULT_CAP > 0);
  assert.equal(typeof SEARCH_PER_SOURCE_CAP, 'number');
  assert.ok(SEARCH_PER_SOURCE_CAP > 0);
  assert.ok(SEARCH_PER_SOURCE_CAP <= SEARCH_RESULT_CAP, 'a single source should never be able to exceed the overall cap on its own');
});

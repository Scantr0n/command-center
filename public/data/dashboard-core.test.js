#!/usr/bin/env node
/*
 * Regression tests for dashboard-core.js, the staleness and grid-sort math
 * the hub's own page (public/index.html) renders live: the graph's dashed
 * stale ring, the grid's stale badge, the tab's glance favicon dot, and the
 * grid's four sort orders. Every per-project hub already has this kind of
 * coverage for its own date math; this gives the hub page itself the same.
 *
 * Usage: node --test public/data/dashboard-core.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  daysAgoLocal,
  shortRelativeTime,
  relativeTime,
  isStale,
  STATUS_SEVERITY,
  sortForGrid
} = require('./dashboard-core.js');

const NOW = new Date(2026, 8, 24, 15, 0, 0); // local midday, 2026-09-24

test('daysAgoLocal counts local calendar days, not 24h windows', () => {
  assert.equal(daysAgoLocal('2026-09-24', NOW), 0);
  assert.equal(daysAgoLocal('2026-09-23', NOW), 1);
  assert.equal(daysAgoLocal('2026-08-25', NOW), 30);
  // A date in the future (clock skew, a typo'd year) should read negative,
  // not throw or silently clamp to 0.
  assert.equal(daysAgoLocal('2026-09-25', NOW), -1);
});

test('shortRelativeTime buckets into today/Nd/Nmo, and null for no date', () => {
  assert.equal(shortRelativeTime(null, NOW), null);
  assert.equal(shortRelativeTime('2026-09-24', NOW), 'today');
  assert.equal(shortRelativeTime('2026-09-20', NOW), '4d');
  assert.equal(shortRelativeTime('2026-07-20', NOW), '2mo');
});

test('relativeTime pluralizes correctly and falls back to a plain phrase for no date', () => {
  assert.equal(relativeTime(null, NOW), 'no date on record');
  assert.equal(relativeTime('2026-09-24', NOW), 'today');
  assert.equal(relativeTime('2026-09-23', NOW), '1 day ago');
  assert.equal(relativeTime('2026-09-20', NOW), '4 days ago');
  assert.equal(relativeTime('2026-08-25', NOW), '1 month ago');
  assert.equal(relativeTime('2026-06-25', NOW), '3 months ago');
});

test('isStale flags a date over 30 days old, and is exactly 30-day inclusive of "not yet stale"', () => {
  assert.equal(isStale({ status: 'active', lastUpdate: '2026-09-24' }, NOW), false);
  assert.equal(isStale({ status: 'active', lastUpdate: '2026-08-25' }, NOW), false); // exactly 30 days
  assert.equal(isStale({ status: 'active', lastUpdate: '2026-08-24' }, NOW), true); // 31 days
});

test('isStale on a null lastUpdate reads stale only for active/stalled, not done/unknown/broken', () => {
  assert.equal(isStale({ status: 'active', lastUpdate: null }, NOW), true);
  assert.equal(isStale({ status: 'stalled', lastUpdate: null }, NOW), true);
  assert.equal(isStale({ status: 'done', lastUpdate: null }, NOW), false);
  assert.equal(isStale({ status: 'unknown', lastUpdate: null }, NOW), false);
  assert.equal(isStale({ status: 'broken', lastUpdate: null }, NOW), false);
});

test('STATUS_SEVERITY ranks broken worst, done last', () => {
  assert.equal(STATUS_SEVERITY.broken, 0);
  assert.ok(STATUS_SEVERITY.broken < STATUS_SEVERITY.stalled);
  assert.ok(STATUS_SEVERITY.stalled < STATUS_SEVERITY.active);
  assert.ok(STATUS_SEVERITY.active < STATUS_SEVERITY.unknown);
  assert.ok(STATUS_SEVERITY.unknown < STATUS_SEVERITY.done);
});

const SAMPLE = [
  { name: 'Zebra', status: 'done', lastUpdate: '2026-01-01' },
  { name: 'Alpha', status: 'broken', lastUpdate: '2026-09-20' },
  { name: 'Mango', status: 'active', lastUpdate: null },
  { name: 'Beta', status: 'stalled', lastUpdate: '2026-05-01' }
];

test('sortForGrid("name") sorts alphabetically regardless of input order', () => {
  const sorted = sortForGrid(SAMPLE, 'name').map(c => c.name);
  assert.deepEqual(sorted, ['Alpha', 'Beta', 'Mango', 'Zebra']);
});

test('sortForGrid("updated") sorts newest lastUpdate first, treating null as oldest', () => {
  const sorted = sortForGrid(SAMPLE, 'updated').map(c => c.name);
  assert.deepEqual(sorted, ['Alpha', 'Beta', 'Zebra', 'Mango']);
});

test('sortForGrid("status") ranks by STATUS_SEVERITY, broken first', () => {
  const sorted = sortForGrid(SAMPLE, 'status').map(c => c.name);
  assert.deepEqual(sorted, ['Alpha', 'Beta', 'Mango', 'Zebra']);
});

test('sortForGrid("priority") and an unrecognized sortBy both leave input order untouched', () => {
  assert.deepEqual(sortForGrid(SAMPLE, 'priority').map(c => c.name), ['Zebra', 'Alpha', 'Mango', 'Beta']);
  assert.deepEqual(sortForGrid(SAMPLE, 'bogus').map(c => c.name), ['Zebra', 'Alpha', 'Mango', 'Beta']);
});

test('sortForGrid never mutates the input list', () => {
  const copy = SAMPLE.slice();
  sortForGrid(SAMPLE, 'name');
  assert.deepEqual(SAMPLE, copy);
});

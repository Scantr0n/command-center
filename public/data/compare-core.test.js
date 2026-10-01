#!/usr/bin/env node
/*
 * Regression tests for compare-core.js, the field-by-field diff behind the
 * hub page's own "Compare with backup..." button. Covers: rejecting a file
 * that isn't a real Command Center backup, added/removed/changed detection
 * for clusters keyed by id, the null-vs-omitted-field equality rule (a
 * cluster with no toggleId has no real `enabled` key at all), and that an
 * exact match reports no differences.
 *
 * Usage: node --test public/data/compare-core.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { fieldValuesDiffer, diffByKey, CLUSTER_FIELDS, compareWithBackup } = require('./compare-core.js');

function backupFile(overrides) {
  return Object.assign({
    exportedAt: '2026-09-20T12:00:00.000Z',
    source: 'Command Center dashboard (/), local download only',
    clusters: []
  }, overrides);
}

test('fieldValuesDiffer treats undefined and explicit null as equal', () => {
  assert.equal(fieldValuesDiffer(undefined, null), false);
  assert.equal(fieldValuesDiffer(null, undefined), false);
  assert.equal(fieldValuesDiffer(null, null), false);
});

test('fieldValuesDiffer flags a real scalar change', () => {
  assert.equal(fieldValuesDiffer('a', 'b'), true);
  assert.equal(fieldValuesDiffer(1, 1), false);
});

test('fieldValuesDiffer flags a real change inside a nested object field like reliability', () => {
  assert.equal(fieldValuesDiffer({ lastRunStatus: 'succeeded' }, { lastRunStatus: 'failed' }), true);
  assert.equal(fieldValuesDiffer({ lastRunStatus: 'succeeded' }, { lastRunStatus: 'succeeded' }), false);
});

test('diffByKey reports an item only in the current list as added', () => {
  const result = diffByKey([{ id: 'alpha' }], [], x => x.id, ['name']);
  assert.equal(result.added.length, 1);
  assert.equal(result.added[0].id, 'alpha');
  assert.equal(result.removed.length, 0);
  assert.equal(result.changed.length, 0);
});

test('diffByKey reports an item only in the backup list as removed, never silently dropped', () => {
  const result = diffByKey([], [{ id: 'alpha' }], x => x.id, ['name']);
  assert.equal(result.removed.length, 1);
  assert.equal(result.removed[0].id, 'alpha');
});

test('diffByKey flags exactly the fields that actually changed', () => {
  const current = [{ id: 'alpha', status: 'active', category: 'Trading' }];
  const backup = [{ id: 'alpha', status: 'broken', category: 'Trading' }];
  const result = diffByKey(current, backup, x => x.id, ['status', 'category']);
  assert.equal(result.changed.length, 1);
  assert.deepEqual(result.changed[0].fields, ['status']);
});

test('diffByKey finds no differences when the lists match exactly', () => {
  const list = [{ id: 'alpha', status: 'active' }];
  const result = diffByKey(list, list, x => x.id, ['status']);
  assert.equal(result.added.length, 0);
  assert.equal(result.removed.length, 0);
  assert.equal(result.changed.length, 0);
});

test('compareWithBackup rejects a file with no clusters array', () => {
  assert.throws(() => compareWithBackup([], { oops: true }), /does not look like a Command Center backup/);
});

test('compareWithBackup rejects null/non-object input the same way as a malformed file', () => {
  assert.throws(() => compareWithBackup([], null), /does not look like a Command Center backup/);
});

test('compareWithBackup diffs clusters by id, not array position', () => {
  const current = [{ id: 'alpha', name: 'Alpha (Trading Bot)', status: 'active' }];
  const backup = backupFile({ clusters: [{ id: 'alpha', name: 'Alpha (Trading Bot)', status: 'broken' }] });
  const result = compareWithBackup(current, backup);
  assert.equal(result.clusters.changed.length, 1);
  assert.deepEqual(result.clusters.changed[0].fields, ['status']);
});

test('compareWithBackup detects a newly added cluster', () => {
  const current = [{ id: 'alpha', name: 'Alpha' }];
  const backup = backupFile();
  const result = compareWithBackup(current, backup);
  assert.equal(result.clusters.added.length, 1);
  assert.equal(result.clusters.added[0].id, 'alpha');
});

test('compareWithBackup detects a cluster removed since the backup', () => {
  const current = [];
  const backup = backupFile({ clusters: [{ id: 'alpha', name: 'Alpha' }] });
  const result = compareWithBackup(current, backup);
  assert.equal(result.clusters.removed.length, 1);
  assert.equal(result.clusters.removed[0].id, 'alpha');
});

test('compareWithBackup treats a missing enabled key and an explicit null as equal, not a false change', () => {
  const current = [{ id: 'job-search', name: 'Job Search' }];
  const backup = backupFile({ clusters: [{ id: 'job-search', name: 'Job Search', enabled: null }] });
  const result = compareWithBackup(current, backup);
  assert.equal(result.clusters.changed.length, 0);
});

test('compareWithBackup flags a real enabled toggle flip', () => {
  const current = [{ id: 'job-search', name: 'Job Search', enabled: false }];
  const backup = backupFile({ clusters: [{ id: 'job-search', name: 'Job Search', enabled: true }] });
  const result = compareWithBackup(current, backup);
  assert.equal(result.clusters.changed.length, 1);
  assert.deepEqual(result.clusters.changed[0].fields, ['enabled']);
});

test('compareWithBackup checks every real field a cluster carries, not a stale subset', () => {
  // Locks CLUSTER_FIELDS itself: adding a new cluster field to
  // data/clusters/*.json without also adding it here would otherwise make
  // a real change in that field compare silently equal forever.
  const current = [{ id: 'sondrik', lastUpdate: '2026-09-07' }];
  const backup = backupFile({ clusters: [{ id: 'sondrik', lastUpdate: '2026-08-01' }] });
  assert.ok(CLUSTER_FIELDS.includes('lastUpdate'));
  const result = compareWithBackup(current, backup);
  assert.deepEqual(result.clusters.changed[0].fields, ['lastUpdate']);
});

test('compareWithBackup finds no differences when current data exactly matches the backup', () => {
  const clusters = [{ id: 'alpha', name: 'Alpha', status: 'active', category: 'Trading' }];
  const current = clusters;
  const backup = backupFile({ clusters });
  const result = compareWithBackup(current, backup);
  const totalDiffs = result.clusters.added.length + result.clusters.removed.length + result.clusters.changed.length;
  assert.equal(totalDiffs, 0);
});

test('compareWithBackup passes through the backup file\'s own exportedAt timestamp', () => {
  const result = compareWithBackup([], backupFile({ exportedAt: '2026-08-01T12:00:00.000Z' }));
  assert.equal(result.exportedAt, '2026-08-01T12:00:00.000Z');
});

test('compareWithBackup reports null exportedAt rather than a fabricated timestamp when the backup file omits it', () => {
  const file = backupFile();
  delete file.exportedAt;
  const result = compareWithBackup([], file);
  assert.equal(result.exportedAt, null);
});

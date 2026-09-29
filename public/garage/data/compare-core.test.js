#!/usr/bin/env node
/*
 * Regression tests for compare-core.js, the field-by-field diff behind the
 * page's "Compare with backup..." button. Covers: rejecting a file that
 * isn't a real Garage backup, added/removed/changed detection across all
 * nine lists (pipeline stages keyed by stage name, everything else keyed by
 * id), the null-vs-omitted-field equality rule, and that an exact match
 * reports no differences.
 *
 * Usage: node --test public/garage/data/compare-core.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { fieldValuesDiffer, diffByKey, compareWithBackup } = require('./compare-core.js');

function backupFile(overrides) {
  return Object.assign({
    exportedAt: '2026-09-20T12:00:00.000Z',
    source: 'Command Center Garage (/garage), local download only',
    listingsJson: { listings: [] },
    pipelineJson: { stages: [] },
    activityJson: { events: [] },
    salesJson: { sales: [] },
    expensesJson: { expenses: [] },
    disputesJson: { disputes: [] },
    suppliesJson: { supplies: [] },
    acquisitionsJson: { acquisitions: [] },
    compsJson: { comps: [] }
  }, overrides);
}

test('fieldValuesDiffer treats undefined and explicit null as equal', () => {
  assert.equal(fieldValuesDiffer(undefined, null), false);
  assert.equal(fieldValuesDiffer(null, undefined), false);
  assert.equal(fieldValuesDiffer(null, null), false);
});

test('fieldValuesDiffer flags a real scalar and nested-array change', () => {
  assert.equal(fieldValuesDiffer('a', 'b'), true);
  assert.equal(fieldValuesDiffer(['ebay'], ['ebay', 'poshmark']), true);
  assert.equal(fieldValuesDiffer(['ebay'], ['ebay']), false);
});

test('diffByKey reports an item only in the current list as added', () => {
  const result = diffByKey([{ id: 'a' }], [], x => x.id, ['title']);
  assert.equal(result.added.length, 1);
  assert.equal(result.added[0].id, 'a');
  assert.equal(result.removed.length, 0);
  assert.equal(result.changed.length, 0);
});

test('diffByKey reports an item only in the backup list as removed, never silently dropped', () => {
  const result = diffByKey([], [{ id: 'a' }], x => x.id, ['title']);
  assert.equal(result.removed.length, 1);
  assert.equal(result.removed[0].id, 'a');
});

test('diffByKey flags exactly the fields that actually changed', () => {
  const current = [{ id: 'a', price: 25, notes: 'same' }];
  const backup = [{ id: 'a', price: 20, notes: 'same' }];
  const result = diffByKey(current, backup, x => x.id, ['price', 'notes']);
  assert.equal(result.changed.length, 1);
  assert.deepEqual(result.changed[0].fields, ['price']);
});

test('diffByKey finds no differences when the lists match exactly', () => {
  const list = [{ id: 'a', price: 25 }];
  const result = diffByKey(list, list, x => x.id, ['price']);
  assert.equal(result.added.length, 0);
  assert.equal(result.removed.length, 0);
  assert.equal(result.changed.length, 0);
});

test('diffByKey keys pipeline stages by stage name, not an id field they do not have', () => {
  const current = [{ stage: 'listed', count: 5, note: null }];
  const backup = [{ stage: 'listed', count: 3, note: null }];
  const result = diffByKey(current, backup, x => x.stage, ['count', 'note']);
  assert.equal(result.changed.length, 1);
  assert.deepEqual(result.changed[0].fields, ['count']);
});

test('compareWithBackup rejects a file missing any of the nine expected *Json keys', () => {
  assert.throws(() => compareWithBackup({}, { oops: true }), /does not look like a Garage backup/);
});

test('compareWithBackup rejects null/non-object input the same way as a malformed file', () => {
  assert.throws(() => compareWithBackup({}, null), /does not look like a Garage backup/);
});

test('compareWithBackup diffs listings by id, catching a real price change', () => {
  const current = { rawListingsData: { listings: [{ id: 'x', title: 'Vintage jacket', price: 45 }] } };
  const backup = backupFile({ listingsJson: { listings: [{ id: 'x', title: 'Vintage jacket', price: 35 }] } });
  const result = compareWithBackup(current, backup);
  assert.equal(result.listings.changed.length, 1);
  assert.deepEqual(result.listings.changed[0].fields, ['price']);
});

test('compareWithBackup diffs pipeline stages by stage name', () => {
  const current = { rawPipelineData: { stages: [{ stage: 'sold', count: 2, note: null }] } };
  const backup = backupFile({ pipelineJson: { stages: [{ stage: 'sold', count: 1, note: null }] } });
  const result = compareWithBackup(current, backup);
  assert.equal(result.pipeline.changed.length, 1);
  assert.deepEqual(result.pipeline.changed[0].fields, ['count']);
});

test('compareWithBackup detects a new sale added since the backup', () => {
  const current = { rawSalesData: { sales: [{ id: 'sale1', title: 'Jacket', salePrice: 40 }] } };
  const backup = backupFile({ salesJson: { sales: [] } });
  const result = compareWithBackup(current, backup);
  assert.equal(result.sales.added.length, 1);
  assert.equal(result.sales.added[0].id, 'sale1');
});

test('compareWithBackup detects an expense removed since the backup, without silently dropping it', () => {
  const current = { rawExpensesData: { expenses: [] } };
  const backup = backupFile({ expensesJson: { expenses: [{ id: 'exp1', description: 'Shipping tape', amount: 12 }] } });
  const result = compareWithBackup(current, backup);
  assert.equal(result.expenses.removed.length, 1);
  assert.equal(result.expenses.removed[0].id, 'exp1');
});

test('compareWithBackup detects a dispute status change', () => {
  const current = { rawDisputesData: { disputes: [{ id: 'd1', status: 'resolved', outcome: 'refunded' }] } };
  const backup = backupFile({ disputesJson: { disputes: [{ id: 'd1', status: 'open', outcome: null }] } });
  const result = compareWithBackup(current, backup);
  assert.equal(result.disputes.changed.length, 1);
  assert.ok(result.disputes.changed[0].fields.includes('status'));
});

test('compareWithBackup treats a missing key and an explicit null note as equal, not a false change', () => {
  const current = { rawSuppliesData: { supplies: [{ id: 'sup1', name: 'Poly mailers' }] } };
  const backup = backupFile({ suppliesJson: { supplies: [{ id: 'sup1', name: 'Poly mailers', notes: null }] } });
  const result = compareWithBackup(current, backup);
  assert.equal(result.supplies.changed.length, 0);
});

test('compareWithBackup finds no differences when current data exactly matches the backup', () => {
  const listings = [{ id: 'x', title: 'Vintage jacket', price: 45, notes: null }];
  const comps = [{ id: 'c1', listingId: 'x', platform: 'ebay', title: 'Similar jacket', soldPrice: 40 }];
  const current = { rawListingsData: { listings }, rawCompsData: { comps } };
  const backup = backupFile({ listingsJson: { listings }, compsJson: { comps } });
  const result = compareWithBackup(current, backup);
  const totalDiffs = ['listings', 'pipeline', 'activity', 'sales', 'expenses', 'disputes', 'supplies', 'acquisitions', 'comps']
    .reduce((n, k) => n + result[k].added.length + result[k].removed.length + result[k].changed.length, 0);
  assert.equal(totalDiffs, 0);
});

test('compareWithBackup passes through the backup file\'s own exportedAt timestamp', () => {
  const result = compareWithBackup({}, backupFile({ exportedAt: '2026-08-01T12:00:00.000Z' }));
  assert.equal(result.exportedAt, '2026-08-01T12:00:00.000Z');
});

test('compareWithBackup reports null exportedAt rather than a fabricated timestamp when the backup file omits it', () => {
  const file = backupFile();
  delete file.exportedAt;
  const result = compareWithBackup({}, file);
  assert.equal(result.exportedAt, null);
});

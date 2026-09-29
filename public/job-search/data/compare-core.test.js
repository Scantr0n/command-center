#!/usr/bin/env node
/*
 * Regression tests for compare-core.js, the field-by-field diff behind the
 * page's "Compare with backup..." button. Covers: rejecting a file that
 * isn't a real Job Search backup, added/removed/changed detection across
 * applications (keyed by num), dropped/skipped (keyed by company), the
 * scalar savedCount diff, the null-vs-omitted-field equality rule, and that
 * an exact match reports no differences.
 *
 * Usage: node --test public/job-search/data/compare-core.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { fieldValuesDiffer, diffByKey, compareWithBackup } = require('./compare-core.js');

function backupFile(overrides) {
  return Object.assign({
    exportedAt: '2026-09-20T12:00:00.000Z',
    applicationsJson: { applications: [], dropped: [], skipped: [], savedCount: { count: 0, asOfDate: null, note: null } }
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

test('diffByKey reports an item only in the current list as added', () => {
  const result = diffByKey([{ num: 1 }], [], x => x.num, ['role']);
  assert.equal(result.added.length, 1);
  assert.equal(result.added[0].num, 1);
  assert.equal(result.removed.length, 0);
  assert.equal(result.changed.length, 0);
});

test('diffByKey reports an item only in the backup list as removed, never silently dropped', () => {
  const result = diffByKey([], [{ num: 1 }], x => x.num, ['role']);
  assert.equal(result.removed.length, 1);
  assert.equal(result.removed[0].num, 1);
});

test('diffByKey flags exactly the fields that actually changed', () => {
  const current = [{ num: 1, role: 'new title', company: 'same' }];
  const backup = [{ num: 1, role: 'old title', company: 'same' }];
  const result = diffByKey(current, backup, x => x.num, ['role', 'company']);
  assert.equal(result.changed.length, 1);
  assert.deepEqual(result.changed[0].fields, ['role']);
});

test('diffByKey finds no differences when the lists match exactly', () => {
  const list = [{ num: 1, role: 'x' }];
  const result = diffByKey(list, list, x => x.num, ['role']);
  assert.equal(result.added.length, 0);
  assert.equal(result.removed.length, 0);
  assert.equal(result.changed.length, 0);
});

test('compareWithBackup rejects a file with no applicationsJson key', () => {
  assert.throws(() => compareWithBackup({}, { oops: true }), /does not look like a Job Search backup/);
});

test('compareWithBackup rejects null/non-object input the same way as a malformed file', () => {
  assert.throws(() => compareWithBackup({}, null), /does not look like a Job Search backup/);
});

test('compareWithBackup diffs applications by num, not array position', () => {
  const current = { applications: [{ num: 1, role: 'Marketing Intern', company: 'Acme', location: 'Remote', pay: '$20/hr', appliedDate: '2026-08-11' }] };
  const backup = backupFile({ applicationsJson: { applications: [{ num: 1, role: 'Old Title', company: 'Acme', location: 'Remote', pay: '$20/hr', appliedDate: '2026-08-11' }] } });
  const result = compareWithBackup(current, backup);
  assert.equal(result.applications.changed.length, 1);
  assert.deepEqual(result.applications.changed[0].fields, ['role']);
});

test('compareWithBackup detects a newly added application', () => {
  const current = { applications: [{ num: 1, role: 'Intern', company: 'Acme', location: 'Remote', pay: '$20/hr', appliedDate: '2026-08-11' }] };
  const backup = backupFile();
  const result = compareWithBackup(current, backup);
  assert.equal(result.applications.added.length, 1);
  assert.equal(result.applications.added[0].company, 'Acme');
});

test('compareWithBackup diffs dropped/skipped by company', () => {
  const current = { dropped: [{ company: 'BRUNA', reason: 'New reason' }] };
  const backup = backupFile({ applicationsJson: { dropped: [{ company: 'BRUNA', reason: 'Old reason' }] } });
  const result = compareWithBackup(current, backup);
  assert.equal(result.dropped.changed.length, 1);
  assert.deepEqual(result.dropped.changed[0].fields, ['reason']);
});

test('compareWithBackup treats a missing key and an explicit null reason as equal, not a false change', () => {
  const current = { skipped: [{ company: 'Dayforce' }] };
  const backup = backupFile({ applicationsJson: { skipped: [{ company: 'Dayforce', reason: null }] } });
  const result = compareWithBackup(current, backup);
  assert.equal(result.skipped.changed.length, 0);
});

test('compareWithBackup flags a changed savedCount field', () => {
  const current = { savedCount: { count: 2, asOfDate: '2026-09-20', note: null } };
  const backup = backupFile({ applicationsJson: { savedCount: { count: 0, asOfDate: '2026-08-12', note: null } } });
  const result = compareWithBackup(current, backup);
  const fields = result.savedCount.map(f => f.field);
  assert.deepEqual(fields.sort(), ['asOfDate', 'count']);
});

test('compareWithBackup finds no differences when current data exactly matches the backup', () => {
  const applications = [{ num: 1, role: 'Intern', company: 'Acme', location: 'Remote', pay: '$20/hr', appliedDate: '2026-08-11' }];
  const dropped = [{ company: 'BRUNA', reason: 'Not a fit' }];
  const savedCount = { count: 0, asOfDate: '2026-08-12', note: null };
  const current = { applications, dropped, savedCount };
  const backup = backupFile({ applicationsJson: { applications, dropped, savedCount } });
  const result = compareWithBackup(current, backup);
  const totalDiffs = result.applications.added.length + result.applications.removed.length + result.applications.changed.length +
    result.dropped.added.length + result.dropped.removed.length + result.dropped.changed.length +
    result.skipped.added.length + result.skipped.removed.length + result.skipped.changed.length +
    result.savedCount.length;
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

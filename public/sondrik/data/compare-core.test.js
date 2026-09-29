#!/usr/bin/env node
/*
 * Regression tests for compare-core.js, the field-by-field diff behind the
 * page's "Compare with backup..." button. Covers: rejecting a file that
 * isn't a real Sondrik backup, added/removed/changed detection across all
 * five data lists (releases keyed by version, download checks keyed by
 * date, leads/channels/goals keyed by id), the null-vs-omitted-field
 * equality rule, and that an exact match reports no differences.
 *
 * Usage: node --test public/sondrik/data/compare-core.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { fieldValuesDiffer, diffByKey, compareWithBackup } = require('./compare-core.js');

function backupFile(overrides) {
  return Object.assign({
    exportedAt: '2026-09-20T12:00:00.000Z',
    releasesJson: { releases: [] },
    downloadsJson: { metric: { checks: [] } },
    leadsJson: { leads: [] },
    channelsJson: { channels: [] },
    goalsJson: { goals: [] }
  }, overrides);
}

test('fieldValuesDiffer treats undefined and explicit null as equal', () => {
  assert.equal(fieldValuesDiffer(undefined, null), false);
  assert.equal(fieldValuesDiffer(null, undefined), false);
  assert.equal(fieldValuesDiffer(null, null), false);
});

test('fieldValuesDiffer flags a real scalar and nested-object change', () => {
  assert.equal(fieldValuesDiffer('a', 'b'), true);
  assert.equal(fieldValuesDiffer({ a: 1 }, { a: 2 }), true);
  assert.equal(fieldValuesDiffer({ a: 1 }, { a: 1 }), false);
});

test('diffByKey reports an item only in the current list as added', () => {
  const result = diffByKey([{ id: 'a' }], [], x => x.id, ['label']);
  assert.equal(result.added.length, 1);
  assert.equal(result.added[0].id, 'a');
  assert.equal(result.removed.length, 0);
  assert.equal(result.changed.length, 0);
});

test('diffByKey reports an item only in the backup list as removed, never silently dropped', () => {
  const result = diffByKey([], [{ id: 'a' }], x => x.id, ['label']);
  assert.equal(result.removed.length, 1);
  assert.equal(result.removed[0].id, 'a');
});

test('diffByKey flags exactly the fields that actually changed', () => {
  const current = [{ id: 'a', label: 'new', note: 'same' }];
  const backup = [{ id: 'a', label: 'old', note: 'same' }];
  const result = diffByKey(current, backup, x => x.id, ['label', 'note']);
  assert.equal(result.changed.length, 1);
  assert.deepEqual(result.changed[0].fields, ['label']);
});

test('diffByKey finds no differences when the lists match exactly', () => {
  const list = [{ id: 'a', label: 'x' }];
  const result = diffByKey(list, list, x => x.id, ['label']);
  assert.equal(result.added.length, 0);
  assert.equal(result.removed.length, 0);
  assert.equal(result.changed.length, 0);
});

test('compareWithBackup rejects a file with no releasesJson/downloadsJson/leadsJson/channelsJson/goalsJson keys', () => {
  assert.throws(() => compareWithBackup({}, { oops: true }), /does not look like a Sondrik hub backup/);
});

test('compareWithBackup rejects null/non-object input the same way as a malformed file', () => {
  assert.throws(() => compareWithBackup({}, null), /does not look like a Sondrik hub backup/);
});

test('compareWithBackup diffs releases by version, not array position', () => {
  const current = { releasesData: { releases: [{ version: '0.3.7', date: '2026-09-07', summary: 'fixed seed data' }] } };
  const backup = backupFile({ releasesJson: { releases: [{ version: '0.3.7', date: '2026-09-07', summary: 'old summary' }] } });
  const result = compareWithBackup(current, backup);
  assert.equal(result.releases.changed.length, 1);
  assert.deepEqual(result.releases.changed[0].fields, ['summary']);
});

test('compareWithBackup diffs download checks by date', () => {
  const current = { downloadsData: { metric: { checks: [{ date: '2026-09-20', count: 15, note: null }] } } };
  const backup = backupFile({ downloadsJson: { metric: { checks: [] } } });
  const result = compareWithBackup(current, backup);
  assert.equal(result.downloadChecks.added.length, 1);
  assert.equal(result.downloadChecks.added[0].count, 15);
});

test('compareWithBackup detects a nested outreach field change on a lead', () => {
  const lead = id => ({
    id: 'reddit-imadethis-tester-offer', channelId: 'reddit',
    outreach: { draftStatus: 'drafted', approvalStatus: id, sent: false }
  });
  const current = { leadsData: { leads: [lead('approved')] } };
  const backup = backupFile({ leadsJson: { leads: [lead('awaiting-approval')] } });
  const result = compareWithBackup(current, backup);
  assert.equal(result.leads.changed.length, 1);
  assert.deepEqual(result.leads.changed[0].fields, ['outreach']);
});

test('compareWithBackup treats a missing key and an explicit null note as equal, not a false change', () => {
  const current = { channelsData: { channels: [{ id: 'reddit', name: 'Reddit', status: 'manual-log' }] } };
  const backup = backupFile({ channelsJson: { channels: [{ id: 'reddit', name: 'Reddit', status: 'manual-log', note: null }] } });
  const result = compareWithBackup(current, backup);
  assert.equal(result.channels.changed.length, 0);
});

test('compareWithBackup finds no differences when current data exactly matches the backup', () => {
  const releases = [{ version: '0.3.7', date: '2026-09-07', type: 'bugfix', summary: 'fixed seed data', notes: null }];
  const goals = [{ id: 'launch-push-eoy-2026', label: 'downloads by EOY', metric: 'downloads', target: 150, targetDate: '2026-12-31', setDate: '2026-09-20', note: null }];
  const current = { releasesData: { releases }, goalsData: { goals } };
  const backup = backupFile({ releasesJson: { releases }, goalsJson: { goals } });
  const result = compareWithBackup(current, backup);
  const totalDiffs = ['releases', 'downloadChecks', 'leads', 'channels', 'goals']
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

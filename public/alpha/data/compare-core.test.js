#!/usr/bin/env node
/*
 * Regression tests for compare-core.js, the field-by-field diff behind the
 * page's "Compare with backup..." button. Covers: rejecting a file that
 * isn't a real Alpha backup, the null-vs-omitted-field equality rule,
 * scalar system.* field diffing, features[] added/removed/changed
 * detection keyed by id, and that an exact match reports no differences.
 *
 * Usage: node --test public/alpha/data/compare-core.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { fieldValuesDiffer, diffByKey, diffSystemScalars, compareWithBackup } = require('./compare-core.js');

function backupFile(systemOverrides) {
  return {
    exportedAt: '2026-09-20T12:00:00.000Z',
    source: 'Command Center Alpha overview (/alpha), local download only',
    status: {
      system: Object.assign({
        name: 'Alpha',
        kind: 'Live trading daemon, real money, runs on Jack’s Mac',
        host: 'Jack’s Mac, port 3847',
        agentCount: 33,
        agentKind: 'Evolved trading agents',
        lastVerifiedAt: '2026-09-16T19:55:06Z',
        features: [
          { id: 'kill-switch', label: 'Kill switch', note: null, pending: false }
        ]
      }, systemOverrides)
    }
  };
}

test('fieldValuesDiffer treats undefined and explicit null as equal', () => {
  assert.equal(fieldValuesDiffer(undefined, null), false);
  assert.equal(fieldValuesDiffer(null, undefined), false);
  assert.equal(fieldValuesDiffer(null, null), false);
});

test('fieldValuesDiffer flags a real scalar change', () => {
  assert.equal(fieldValuesDiffer(33, 30), true);
  assert.equal(fieldValuesDiffer('a', 'a'), false);
});

test('diffByKey reports an item only in the current list as added', () => {
  const result = diffByKey([{ id: 'a' }], [], x => x.id, ['label']);
  assert.equal(result.added.length, 1);
  assert.equal(result.removed.length, 0);
  assert.equal(result.changed.length, 0);
});

test('diffByKey reports an item only in the backup list as removed, never silently dropped', () => {
  const result = diffByKey([], [{ id: 'a' }], x => x.id, ['label']);
  assert.equal(result.removed.length, 1);
  assert.equal(result.removed[0].id, 'a');
});

test('diffByKey flags exactly the fields that actually changed', () => {
  const current = [{ id: 'debate-panel', label: 'Debate panel', pending: false }];
  const backup = [{ id: 'debate-panel', label: 'Debate panel', pending: true }];
  const result = diffByKey(current, backup, x => x.id, ['label', 'pending']);
  assert.equal(result.changed.length, 1);
  assert.deepEqual(result.changed[0].fields, ['pending']);
});

test('diffByKey finds no differences when the lists match exactly', () => {
  const list = [{ id: 'a', label: 'A' }];
  const result = diffByKey(list, list, x => x.id, ['label']);
  assert.equal(result.added.length, 0);
  assert.equal(result.removed.length, 0);
  assert.equal(result.changed.length, 0);
});

test('diffSystemScalars finds no differences when every tracked field matches', () => {
  const system = { name: 'Alpha', kind: 'k', host: 'h', agentCount: 33, agentKind: 'ak', lastVerifiedAt: 't' };
  assert.deepEqual(diffSystemScalars(system, system), []);
});

test('diffSystemScalars flags a real agentCount change', () => {
  const current = { name: 'Alpha', agentCount: 34 };
  const backup = { name: 'Alpha', agentCount: 33 };
  const result = diffSystemScalars(current, backup);
  assert.equal(result.length, 1);
  assert.equal(result[0].field, 'agentCount');
  assert.equal(result[0].current, 34);
  assert.equal(result[0].backup, 33);
});

test('diffSystemScalars ignores fields outside the tracked scalar list', () => {
  const current = { name: 'Alpha', features: [{ id: 'a' }] };
  const backup = { name: 'Alpha', features: [{ id: 'b' }] };
  assert.deepEqual(diffSystemScalars(current, backup), []);
});

test('compareWithBackup rejects a file with no status.system object', () => {
  assert.throws(() => compareWithBackup({ system: {} }, { status: {} }), /does not look like an Alpha backup/);
  assert.throws(() => compareWithBackup({ system: {} }, null), /does not look like an Alpha backup/);
  assert.throws(() => compareWithBackup({ system: {} }, { foo: 'bar' }), /does not look like an Alpha backup/);
});

test('compareWithBackup reports no differences for an exact match', () => {
  const backup = backupFile();
  const current = backup.status.system;
  const result = compareWithBackup({ system: current }, backup);
  assert.equal(result.systemFields.length, 0);
  assert.equal(result.features.added.length, 0);
  assert.equal(result.features.removed.length, 0);
  assert.equal(result.features.changed.length, 0);
  assert.equal(result.exportedAt, '2026-09-20T12:00:00.000Z');
});

test('compareWithBackup surfaces a real hand-edit to agentCount and lastVerifiedAt', () => {
  const backup = backupFile();
  const current = Object.assign({}, backup.status.system, { agentCount: 34, lastVerifiedAt: '2026-09-25T00:00:00Z' });
  const result = compareWithBackup({ system: current }, backup);
  const fields = result.systemFields.map(f => f.field).sort();
  assert.deepEqual(fields, ['agentCount', 'lastVerifiedAt']);
});

test('compareWithBackup surfaces a feature added since the backup', () => {
  const backup = backupFile();
  const current = Object.assign({}, backup.status.system, {
    features: backup.status.system.features.concat([{ id: 'debate-panel', label: 'Debate panel', note: null, pending: true }])
  });
  const result = compareWithBackup({ system: current }, backup);
  assert.equal(result.features.added.length, 1);
  assert.equal(result.features.added[0].id, 'debate-panel');
});

test('compareWithBackup surfaces a feature removed since the backup', () => {
  const backup = backupFile();
  const result = compareWithBackup({ system: { name: 'Alpha', features: [] } }, backup);
  assert.equal(result.features.removed.length, 1);
  assert.equal(result.features.removed[0].id, 'kill-switch');
});

test('compareWithBackup surfaces a feature field flip, e.g. pending going false to true', () => {
  const backup = backupFile();
  const current = Object.assign({}, backup.status.system, {
    features: [{ id: 'kill-switch', label: 'Kill switch', note: null, pending: true }]
  });
  const result = compareWithBackup({ system: current }, backup);
  assert.equal(result.features.changed.length, 1);
  assert.deepEqual(result.features.changed[0].fields, ['pending']);
});

test('compareWithBackup treats a missing current system as an empty one rather than throwing', () => {
  const backup = backupFile();
  const result = compareWithBackup({}, backup);
  assert.ok(result.systemFields.length > 0);
});

#!/usr/bin/env node
/*
 * Regression tests for compare-core.js, the field-by-field diff behind the
 * page's "Compare with backup..." button. Covers: rejecting a file that
 * isn't a real CGT backup, added/removed/changed detection across all three
 * id-keyed lists (cards, submissions, candidates), the null-vs-omitted-field
 * equality rule, and that an exact match reports no differences.
 *
 * Usage: node --test public/cgt/data/compare-core.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { fieldValuesDiffer, diffById, compareWithBackup } = require('./compare-core.js');

function backupFile(overrides) {
  return Object.assign({
    exportedAt: '2026-09-20T12:00:00.000Z',
    source: 'Command Center CGT inventory (/cgt), local download only',
    cardsJson: { cards: [] },
    submissionsJson: { submissions: [] },
    candidatesJson: { candidates: [] }
  }, overrides);
}

test('fieldValuesDiffer treats undefined and explicit null as equal', () => {
  assert.equal(fieldValuesDiffer(undefined, null), false);
  assert.equal(fieldValuesDiffer(null, undefined), false);
  assert.equal(fieldValuesDiffer(null, null), false);
});

test('fieldValuesDiffer treats an object-valued field as equal regardless of key order', () => {
  assert.equal(fieldValuesDiffer({ a: 1, b: 2 }, { b: 2, a: 1 }), false);
  assert.equal(fieldValuesDiffer({ a: 1, b: 2 }, { b: 3, a: 1 }), true);
});

test('fieldValuesDiffer flags a real scalar and nested-array change', () => {
  assert.equal(fieldValuesDiffer('a', 'b'), true);
  assert.equal(fieldValuesDiffer([1], [1, 2]), true);
  assert.equal(fieldValuesDiffer([1], [1]), false);
});

test('diffById reports an item only in the current list as added', () => {
  const result = diffById([{ id: 'a' }], [], ['cardName']);
  assert.equal(result.added.length, 1);
  assert.equal(result.added[0].id, 'a');
  assert.equal(result.removed.length, 0);
  assert.equal(result.changed.length, 0);
});

test('diffById reports an item only in the backup list as removed, never silently dropped', () => {
  const result = diffById([], [{ id: 'a' }], ['cardName']);
  assert.equal(result.removed.length, 1);
  assert.equal(result.removed[0].id, 'a');
});

test('diffById flags exactly the fields that actually changed', () => {
  const current = [{ id: 'a', grade: '9', notes: 'same' }];
  const backup = [{ id: 'a', grade: '8', notes: 'same' }];
  const result = diffById(current, backup, ['grade', 'notes']);
  assert.equal(result.changed.length, 1);
  assert.deepEqual(result.changed[0].fields, ['grade']);
});

test('diffById finds no differences when the lists match exactly', () => {
  const list = [{ id: 'a', grade: '9' }];
  const result = diffById(list, list, ['grade']);
  assert.equal(result.added.length, 0);
  assert.equal(result.removed.length, 0);
  assert.equal(result.changed.length, 0);
});

test('diffById ignores an item on either side with no real id, rather than crashing on undefined keys', () => {
  const result = diffById([{ id: 'a' }, {}], [{ id: 'a' }, { notes: 'no id' }], ['notes']);
  assert.equal(result.added.length, 0);
  assert.equal(result.removed.length, 0);
});

test('compareWithBackup rejects a file with no cardsJson/submissionsJson/candidatesJson keys', () => {
  assert.throws(() => compareWithBackup({}, { oops: true }), /does not look like a CGT backup/);
});

test('compareWithBackup rejects null/non-object input the same way as a malformed file', () => {
  assert.throws(() => compareWithBackup({}, null), /does not look like a CGT backup/);
});

test('compareWithBackup diffs cards by id, catching a real regrade', () => {
  const current = { rawCardsData: { cards: [{ id: 'x', cardName: 'Neal Broten Rookie', grade: '5' }] } };
  const backup = backupFile({ cardsJson: { cards: [{ id: 'x', cardName: 'Neal Broten Rookie', grade: '4' }] } });
  const result = compareWithBackup(current, backup);
  assert.equal(result.cards.changed.length, 1);
  assert.deepEqual(result.cards.changed[0].fields, ['grade']);
});

test('compareWithBackup detects a new submission added since the backup', () => {
  const current = { rawSubmissionsData: { submissions: [{ id: 's1', status: 'in-queue' }] } };
  const backup = backupFile({ submissionsJson: { submissions: [] } });
  const result = compareWithBackup(current, backup);
  assert.equal(result.submissions.added.length, 1);
  assert.equal(result.submissions.added[0].id, 's1');
});

test('compareWithBackup detects a candidate decision change', () => {
  const current = { rawCandidatesData: { candidates: [{ id: 'c1', decision: 'worth-grading' }] } };
  const backup = backupFile({ candidatesJson: { candidates: [{ id: 'c1', decision: null }] } });
  const result = compareWithBackup(current, backup);
  assert.equal(result.candidates.changed.length, 1);
  assert.deepEqual(result.candidates.changed[0].fields, ['decision']);
});

test('compareWithBackup catches a BGS subgrade or photo URL change, not just the fields cards.json started with', () => {
  const current = { rawCardsData: { cards: [{ id: 'x', cardName: 'Neal Broten Rookie', subgradeCentering: 9.5, imageUrl: 'https://example.com/new.jpg' }] } };
  const backup = backupFile({ cardsJson: { cards: [{ id: 'x', cardName: 'Neal Broten Rookie', subgradeCentering: 9, imageUrl: 'https://example.com/old.jpg' }] } });
  const result = compareWithBackup(current, backup);
  assert.equal(result.cards.changed.length, 1);
  assert.deepEqual(result.cards.changed[0].fields.sort(), ['imageUrl', 'subgradeCentering']);
});

test('compareWithBackup treats a missing key and an explicit null certNumber as equal, not a false change', () => {
  const current = { rawCardsData: { cards: [{ id: 'x', cardName: 'Neal Broten Rookie' }] } };
  const backup = backupFile({ cardsJson: { cards: [{ id: 'x', cardName: 'Neal Broten Rookie', certNumber: null }] } });
  const result = compareWithBackup(current, backup);
  assert.equal(result.cards.changed.length, 0);
});

test('compareWithBackup finds no differences when current data exactly matches the backup', () => {
  const cards = [{ id: 'x', cardName: 'Neal Broten Rookie', grade: '5', notes: null }];
  const submissions = [{ id: 's1', status: 'in-queue', notes: null }];
  const current = { rawCardsData: { cards }, rawSubmissionsData: { submissions } };
  const backup = backupFile({ cardsJson: { cards }, submissionsJson: { submissions } });
  const result = compareWithBackup(current, backup);
  const totalDiffs = ['cards', 'submissions', 'candidates']
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

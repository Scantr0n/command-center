const test = require('node:test');
const assert = require('node:assert/strict');
const { WATCH_AFTER_DAYS, COLD_AFTER_DAYS, daysSinceApplied, awaitingResponseTier } = require('./followup-core.js');

test('daysSinceApplied returns null for a missing or invalid appliedDate', () => {
  assert.equal(daysSinceApplied(null, '2026-09-29'), null);
  assert.equal(daysSinceApplied(undefined, '2026-09-29'), null);
  assert.equal(daysSinceApplied('not-a-date', '2026-09-29'), null);
});

test('daysSinceApplied counts real elapsed calendar days', () => {
  assert.equal(daysSinceApplied('2026-08-11', '2026-09-29'), 49);
  assert.equal(daysSinceApplied('2026-09-29', '2026-09-29'), 0);
});

test('daysSinceApplied returns a negative count for a future appliedDate typo, not null', () => {
  assert.equal(daysSinceApplied('2026-10-05', '2026-09-29'), -6);
});

test('awaitingResponseTier stays null before the watch threshold', () => {
  assert.equal(awaitingResponseTier('2026-09-20', '2026-09-29'), null);
  assert.equal(awaitingResponseTier(null, '2026-09-29'), null);
});

test('awaitingResponseTier reports watch right at the 14-day threshold, not before', () => {
  assert.equal(awaitingResponseTier('2026-09-16', '2026-09-29'), null);
  assert.equal(awaitingResponseTier('2026-09-15', '2026-09-29'), 'watch');
});

test('awaitingResponseTier reports cold right at the 28-day threshold, not before', () => {
  assert.equal(awaitingResponseTier('2026-09-02', '2026-09-29'), 'watch');
  assert.equal(awaitingResponseTier('2026-09-01', '2026-09-29'), 'cold');
});

test('awaitingResponseTier ignores a future appliedDate typo rather than flagging it as overdue', () => {
  assert.equal(awaitingResponseTier('2026-10-05', '2026-09-29'), null);
});

test('WATCH_AFTER_DAYS/COLD_AFTER_DAYS are the real documented thresholds, not silently drifted', () => {
  assert.equal(WATCH_AFTER_DAYS, 14);
  assert.equal(COLD_AFTER_DAYS, 28);
});

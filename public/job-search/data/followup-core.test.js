const test = require('node:test');
const assert = require('node:assert/strict');
const { WATCH_AFTER_DAYS, COLD_AFTER_DAYS, STATUS_LABELS, isTerminalStatus, daysSinceApplied, awaitingResponseTier, hasNewDueId } = require('./followup-core.js');

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

test('isTerminalStatus recognizes exactly the four hand-loggable statuses', () => {
  assert.equal(isTerminalStatus('interview'), true);
  assert.equal(isTerminalStatus('offer'), true);
  assert.equal(isTerminalStatus('rejected'), true);
  assert.equal(isTerminalStatus('withdrawn'), true);
  assert.equal(isTerminalStatus(undefined), false);
  assert.equal(isTerminalStatus(null), false);
  assert.equal(isTerminalStatus('applied'), false);
  assert.equal(isTerminalStatus(''), false);
});

test('STATUS_LABELS has a real label for every terminal status', () => {
  assert.deepEqual(Object.keys(STATUS_LABELS).sort(), ['interview', 'offer', 'rejected', 'withdrawn']);
  Object.values(STATUS_LABELS).forEach(label => assert.ok(label && label.length > 0));
});

test('awaitingResponseTier returns null once a terminal status is logged, even 28+ days quiet', () => {
  assert.equal(awaitingResponseTier('2026-08-01', '2026-09-29', 'rejected'), null);
  assert.equal(awaitingResponseTier('2026-08-01', '2026-09-29', 'interview'), null);
  assert.equal(awaitingResponseTier('2026-08-01', '2026-09-29', 'offer'), null);
  assert.equal(awaitingResponseTier('2026-08-01', '2026-09-29', 'withdrawn'), null);
});

test('awaitingResponseTier still applies the silence rule when no status is logged', () => {
  assert.equal(awaitingResponseTier('2026-08-01', '2026-09-29', undefined), 'cold');
  assert.equal(awaitingResponseTier('2026-08-01', '2026-09-29', null), 'cold');
});

test('hasNewDueId returns false on the first check, previousKeys null', () => {
  assert.equal(hasNewDueId([1, 2], null), false);
});

test('hasNewDueId returns false when the same applications just stay awaiting', () => {
  assert.equal(hasNewDueId([1, 2], [1, 2]), false);
});

test('hasNewDueId returns true when a new application starts awaiting even if the count also fell', () => {
  // Application #2 got a real response the same poll window #3 newly
  // crossed into awaiting: count stays 2, but #3 is a real, new transition
  // the old count-only check would miss.
  assert.equal(hasNewDueId([1, 3], [1, 2]), true);
});

test('hasNewDueId returns false when an application drops out and nothing new starts awaiting', () => {
  assert.equal(hasNewDueId([1], [1, 2]), false);
});

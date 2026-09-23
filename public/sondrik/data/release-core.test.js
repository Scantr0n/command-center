#!/usr/bin/env node
/*
 * Regression tests for release-core.js, the shared bugfix-checkin date math
 * both the live dashboard (app.js) and this file rely on to render the
 * Latest Release card's checkin pill and the Next Steps entry it feeds.
 * Covers the two real bugs this exact logic already produced (see
 * release-core.js's own header comment): the NaN-date crash from a
 * malformed release.date, and the checkpoint whose grace window closes
 * before the next checkpoint opens getting silently dropped instead of
 * reported as missed.
 *
 * Usage: node --test public/sondrik/data/release-core.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { daysBetween, addDays, isValidDateStr, BUGFIX_CHECKPOINTS, bugfixCheckinStatus } = require('./release-core.js');

const identity = iso => iso;

test('BUGFIX_CHECKPOINTS is the real 7/14-day pair the grace-window math below assumes', () => {
  assert.deepEqual(BUGFIX_CHECKPOINTS, [7, 14]);
});

test('bugfixCheckinStatus returns null for a non-bugfix release, an undated release, or no release', () => {
  assert.equal(bugfixCheckinStatus(null, '2026-09-23', identity), null);
  assert.equal(bugfixCheckinStatus({ type: 'feature', date: '2026-09-07' }, '2026-09-23', identity), null);
  assert.equal(bugfixCheckinStatus({ type: 'bugfix', date: null }, '2026-09-23', identity), null);
});

test('bugfixCheckinStatus returns null rather than "day NaN" for a malformed release.date, the real 244bb86-style bug', () => {
  assert.equal(isValidDateStr('2026-9-7'), false, 'non-zero-padded month/day');
  assert.equal(bugfixCheckinStatus({ type: 'bugfix', date: '2026-9-7' }, '2026-09-23', identity), null);
  assert.equal(bugfixCheckinStatus({ type: 'bugfix', date: 'not-a-date' }, '2026-09-23', identity), null);
});

test('bugfixCheckinStatus returns null for a future-dated release (a typo, not a real elapsed span)', () => {
  assert.equal(bugfixCheckinStatus({ type: 'bugfix', date: '2026-09-30' }, '2026-09-23', identity), null);
});

test('bugfixCheckinStatus tiers "upcoming" before day 7, using the real 2026-09-07 ship date', () => {
  const release = { type: 'bugfix', date: '2026-09-07' };
  const status = bugfixCheckinStatus(release, '2026-09-10', identity);
  assert.equal(status.tier, 'upcoming');
  assert.match(status.text, /7-day check-in in 4 days \(2026-09-14\)/);
});

test('bugfixCheckinStatus tiers "due" inside the 7-day checkpoint\'s grace window (days 7-9)', () => {
  const release = { type: 'bugfix', date: '2026-09-07' };
  const status = bugfixCheckinStatus(release, '2026-09-14', identity);
  assert.equal(status.tier, 'due');
  assert.match(status.text, /Past the 7-day check-in \(day 7\)/);
});

test('bugfixCheckinStatus tiers "missed" (7-day only, 14-day next) once the 7-day grace window closes but before day 14, the overlap bug case (7+3=10 is before 14)', () => {
  const release = { type: 'bugfix', date: '2026-09-07' };
  const status = bugfixCheckinStatus(release, '2026-09-17', identity);
  assert.equal(status.tier, 'missed');
  assert.match(status.text, /Missed the 7-day check-in \(day 10\); next is the 14-day check-in in 4 days \(2026-09-21\)/);
});

test('bugfixCheckinStatus tiers "missed" (7-day) with the 14-day one also due now, the real 2026-09-23 (day 16) case this page shows today', () => {
  const release = { type: 'bugfix', date: '2026-09-07' };
  const status = bugfixCheckinStatus(release, '2026-09-23', identity);
  assert.equal(status.tier, 'missed');
  assert.match(status.text, /Missed the 7-day check-in \(day 16\); the 14-day check-in is also due now/);
});

test('bugfixCheckinStatus tiers "missed" with both checkpoints named once the 14-day grace window also closes (day 17+)', () => {
  const release = { type: 'bugfix', date: '2026-09-07' };
  const status = bugfixCheckinStatus(release, '2026-09-24', identity);
  assert.equal(status.tier, 'missed');
  assert.match(status.text, /Missed the 7 and 14-day check-ins \(day 17\)/);
});

// The `tier: 'passed'` branch after the loop is unreachable in practice: with
// BUGFIX_CHECKPOINTS = [7, 14], any checkpoint the loop finishes visiting
// without an early return has already been pushed onto missedCheckpoints
// (that's the only way to fall through to the next iteration), so by the
// time the loop completes normally missedCheckpoints always has both
// entries and the post-loop `if (missedCheckpoints.length)` branch always
// wins first. This documents that rather than asserting the dead branch is
// reachable, which an earlier version of this test incorrectly did.
test('bugfixCheckinStatus never actually reaches its own "passed" branch given the real checkpoint/grace values', () => {
  const release = { type: 'bugfix', date: '2026-09-07' };
  const status = bugfixCheckinStatus(release, '2027-01-01', identity);
  assert.equal(status.tier, 'missed');
});

test('bugfixCheckinStatus runs the caller-supplied date formatter over checkpoint dates, not the raw ISO string', () => {
  const release = { type: 'bugfix', date: '2026-09-07' };
  const fmtDate = iso => 'FMT(' + iso + ')';
  const status = bugfixCheckinStatus(release, '2026-09-10', fmtDate);
  assert.match(status.text, /\(FMT\(2026-09-14\)\)/);
});

test('the real releases.json on disk produces a real, non-crashing checkin status', () => {
  const releases = require('./releases.json');
  const latest = releases.releases[0];
  assert.equal(latest.version, '0.3.7');
  const status = bugfixCheckinStatus(latest, '2026-09-23', identity);
  assert.ok(status, 'a real bugfix release with a valid date should never return null this many days after 2026-09-07');
  assert.equal(status.tier, 'missed');
});

test('daysBetween and addDays match the real 2026-09-07 to 2026-09-23 span used above', () => {
  assert.equal(daysBetween('2026-09-07', '2026-09-23'), 16);
  assert.equal(addDays('2026-09-07', 14), '2026-09-21');
});

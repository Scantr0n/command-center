#!/usr/bin/env node
/*
 * Regression tests for goals-core.js, the shared goal/pace date math both
 * the CLI and the live dashboard (app.js) rely on to render the Goals
 * card. Covers, specifically, the two real bugs this math has already
 * produced (see goals-core.js's own header comment and changelog.json):
 * the elapsed-days-past-the-window clamping bug (cdc1ac4) and the
 * malformed targetDate/setDate guard (244bb86). goals.json is empty as of
 * this writing (no real goal has been set yet), so nothing exercises this
 * code on a real page load; this is the only thing that would catch either
 * bug coming back before Jack sets a real target and sees it live.
 *
 * Usage: node --test public/sondrik/data/goals-core.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  daysBetween, addDays, isValidDateStr, downloadsPerDayRate,
  goalReachedDate, computeGoalProgressPct, computeGoalPaceStatus
} = require('./goals-core.js');

test('daysBetween counts whole days between two local dates', () => {
  assert.equal(daysBetween('2026-09-04', '2026-09-07'), 3);
  assert.equal(daysBetween('2026-09-07', '2026-09-04'), -3);
  assert.equal(daysBetween('2026-09-07', '2026-09-07'), 0);
});

test('addDays rolls over month/year boundaries', () => {
  assert.equal(addDays('2026-09-28', 5), '2026-10-03');
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
});

test('isValidDateStr rejects non-zero-padded, out-of-range, and non-date input', () => {
  assert.equal(isValidDateStr('2026-09-07'), true);
  assert.equal(isValidDateStr('2026-9-7'), false, 'non-zero-padded month/day');
  assert.equal(isValidDateStr('2026-02-30'), false, 'Feb 30 does not exist');
  assert.equal(isValidDateStr('not-a-date'), false);
  assert.equal(isValidDateStr(null), false);
  assert.equal(isValidDateStr(undefined), false);
  assert.equal(isValidDateStr(''), false);
});

test('downloadsPerDayRate needs at least two checks and a positive span', () => {
  assert.equal(downloadsPerDayRate({ metric: { checks: [] } }), null);
  assert.equal(downloadsPerDayRate({ metric: { checks: [{ date: '2026-09-07', count: 8 }] } }), null);
  // Same-day-typo case: two checks logged with the same date divide by zero.
  assert.equal(downloadsPerDayRate({ metric: { checks: [
    { date: '2026-09-07', count: 5 }, { date: '2026-09-07', count: 8 }
  ] } }), null);
  const rate = downloadsPerDayRate({ metric: { checks: [
    { date: '2026-09-04', count: 0 }, { date: '2026-09-07', count: 8 }
  ] } });
  assert.equal(rate.perDay, 8 / 3);
  assert.equal(rate.first.date, '2026-09-04');
  assert.equal(rate.latest.date, '2026-09-07');
});

test('goalReachedDate for downloads returns the first check that hit the target', () => {
  const downloadsData = { metric: { checks: [
    { date: '2026-09-04', count: 0 }, { date: '2026-09-07', count: 8 }, { date: '2026-09-14', count: 15 }
  ] } };
  assert.equal(goalReachedDate({ metric: 'downloads', target: 8 }, downloadsData, null), '2026-09-07');
  assert.equal(goalReachedDate({ metric: 'downloads', target: 20 }, downloadsData, null), null, 'not reached yet');
});

test('goalReachedDate for leads is honest-null when any earlier lead has no loggedDate', () => {
  const leadsData = { leads: [
    { loggedDate: null }, { loggedDate: '2026-09-10' }
  ] };
  // Real crossing point for a target of 2 is unknowable: the first lead's
  // real date isn't on record, so the ordering that would tell us which
  // lead was actually second can't be trusted either.
  assert.equal(goalReachedDate({ metric: 'leads', target: 2 }, null, leadsData), null);
  assert.equal(goalReachedDate({ metric: 'leads', target: 3 }, null, leadsData), null, 'target not even reached yet');
});

test('goalReachedDate for leads returns the Nth lead by real logged date once every earlier one has one', () => {
  const leadsData = { leads: [
    { loggedDate: '2026-09-12' }, { loggedDate: '2026-09-05' }, { loggedDate: '2026-09-20' }
  ] };
  assert.equal(goalReachedDate({ metric: 'leads', target: 2 }, null, leadsData), '2026-09-12');
});

test('computeGoalProgressPct clamps and guards a zero/negative target instead of NaN', () => {
  assert.equal(computeGoalProgressPct(10, 3), 30);
  assert.equal(computeGoalProgressPct(10, 15), 100, 'clamped, not 150');
  assert.equal(computeGoalProgressPct(0, 5), 0, 'zero target never divides');
  assert.equal(computeGoalProgressPct(-5, 5), 0, 'negative target never divides');
});

test('computeGoalPaceStatus is null without two real, valid, positive-span dates', () => {
  assert.equal(computeGoalPaceStatus(null, '2026-10-01', 10, '2026-09-15'), null, 'no setDate');
  assert.equal(computeGoalPaceStatus('2026-09-01', '2026-9-5', 10, '2026-09-15'), null, 'malformed targetDate, the 244bb86 case');
  assert.equal(computeGoalPaceStatus('2026-09-01', '2026-08-01', 10, '2026-09-15'), null, 'targetDate before setDate, totalDays not positive');
  assert.equal(computeGoalPaceStatus('2026-09-20', '2026-10-01', 10, '2026-09-15'), null, 'today before setDate, elapsedDays not positive');
});

test('computeGoalPaceStatus clamps elapsed days to the window once the target date has passed, the cdc1ac4 case', () => {
  // Goal set 2026-08-01, due 2026-09-01 (31-day window), checked on
  // 2026-09-20, 50 real days after setDate: before the fix this printed
  // "50 of 31 days elapsed", self-contradictory against its own 100%-clamped
  // expectedPct.
  const status = computeGoalPaceStatus('2026-08-01', '2026-09-01', 40, '2026-09-20');
  assert.equal(status.totalDays, 31);
  assert.equal(status.elapsedDays, 50);
  assert.equal(status.clampedElapsedDays, 31, 'never exceeds totalDays');
  assert.equal(status.expectedPct, 100);
  assert.equal(status.tier, 'behind', '40% actual vs 100% expected');
});

test('computeGoalPaceStatus tiers behind/on/ahead at the +-10 point thresholds', () => {
  // 10-day window, 5 days elapsed => 50% expected.
  assert.equal(computeGoalPaceStatus('2026-09-01', '2026-09-11', 39, '2026-09-06').tier, 'behind');
  assert.equal(computeGoalPaceStatus('2026-09-01', '2026-09-11', 45, '2026-09-06').tier, 'on');
  assert.equal(computeGoalPaceStatus('2026-09-01', '2026-09-11', 61, '2026-09-06').tier, 'ahead');
});

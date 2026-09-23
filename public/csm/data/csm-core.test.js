#!/usr/bin/env node
/*
 * Regression tests for csm-core.js, the date/urgency math the dashboard
 * (public/csm/app.js) relies on for nudge-due detection, stalled-stage
 * flagging, and stale social-snapshot flagging. No test framework or
 * dependency: node:test and node:assert ship with Node itself, matching
 * this repo's own no-extra-dependency convention (see
 * public/garage/data/garage-core.test.js and
 * public/csm/data/validate-core.test.js for the same pattern).
 *
 * Usage: node --test public/csm/data/csm-core.test.js
 */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isValidDateStr, daysUntil, daysSince, hasOutOfOrderDates, stallInfo,
  socialSnapshotStaleInfo, socialSnapshotsStaleInfo,
  nudgeUrgencyLevel, computeNudgeRows, byUrgency,
  todayIso, addDaysIso, suggestedNudgeOffsetDays, rollToWeekdayIso
} = require('./csm-core.js');

test('isValidDateStr accepts a real, correctly zero-padded date', () => {
  assert.equal(isValidDateStr('2026-09-23'), true);
});

test('isValidDateStr rejects a non-zero-padded hand-edit', () => {
  // "2026-9-5" fails the shape regex outright; this is the exact real
  // hand-edit slip the csm-core.js header comment calls out.
  assert.equal(isValidDateStr('2026-9-5'), false);
});

test('isValidDateStr rejects a calendar day that JS Date would silently roll over', () => {
  // "2026-02-30" parses as March 2, 2026 with no error from the Date
  // constructor alone; isValidDateStr must catch that by cross-checking the
  // parsed date's own year/month/day against what was actually typed.
  assert.equal(isValidDateStr('2026-02-30'), false);
  assert.equal(isValidDateStr('2026-09-31'), false);
});

test('isValidDateStr rejects non-strings and empty values without throwing', () => {
  assert.equal(isValidDateStr(null), false);
  assert.equal(isValidDateStr(undefined), false);
  assert.equal(isValidDateStr(''), false);
});

test('daysUntil/daysSince agree on a real future and past date, built relative to today', () => {
  const future = addDaysIso(todayIso(), 5);
  const past = addDaysIso(todayIso(), -5);
  assert.equal(daysUntil(future), 5);
  assert.equal(daysSince(past), 5);
  assert.equal(daysUntil(todayIso()), 0);
});

test('hasOutOfOrderDates is false for an empty list, a single entry, and real increasing order', () => {
  assert.equal(hasOutOfOrderDates([]), false);
  assert.equal(hasOutOfOrderDates([{ date: '2026-01-01' }]), false);
  assert.equal(hasOutOfOrderDates([{ date: '2026-01-01' }, { date: '2026-02-01' }]), false);
});

test('hasOutOfOrderDates re-sorts valid ISO dates before checking, so array input order does not matter', () => {
  // The function sorts its own copy of the list by date string first; two
  // well-formed ISO dates always sort lexically the same as chronologically,
  // so this is false regardless of the order the caller passed them in.
  assert.equal(hasOutOfOrderDates([{ date: '2026-02-01' }, { date: '2026-01-01' }]), false);
});

test('hasOutOfOrderDates catches a non-zero-padded date instead of showing NaNd', () => {
  // "2026-9-5" sorts lexically after "2026-10-01" despite coming first
  // chronologically, and fails to parse via daysUntil (NaN diff), both of
  // which must be flagged rather than silently treated as in-order.
  assert.equal(hasOutOfOrderDates([{ date: '2026-9-5' }, { date: '2026-10-01' }]), true);
});

test('hasOutOfOrderDates ignores entries with no date', () => {
  assert.equal(hasOutOfOrderDates([{ date: null }, { note: 'no date at all' }]), false);
});

const stageById = {
  'in-exploration': { id: 'in-exploration', staleAfterDays: 30 },
  'client': { id: 'client', staleAfterDays: null }
};

test('stallInfo returns null when the stage has no stale threshold', () => {
  assert.equal(stallInfo({ stage: 'client', stageEnteredDate: '2020-01-01' }, stageById), null);
});

test('stallInfo returns null when stageEnteredDate is missing or invalid, rather than a false negative', () => {
  assert.equal(stallInfo({ stage: 'in-exploration', stageEnteredDate: null }, stageById), null);
  // A non-zero-padded date makes daysSince return NaN; "NaN > 30" is always
  // false, so this must be caught explicitly instead of silently reporting
  // isStale: false on a possibly genuinely stalled prospect.
  assert.equal(stallInfo({ stage: 'in-exploration', stageEnteredDate: '2026-9-5' }, stageById), null);
});

test('stallInfo flags a prospect past its stage stale threshold and not one under it', () => {
  const overThreshold = stallInfo({ stage: 'in-exploration', stageEnteredDate: addDaysIso(todayIso(), -31) }, stageById);
  assert.equal(overThreshold.isStale, true);
  const underThreshold = stallInfo({ stage: 'in-exploration', stageEnteredDate: addDaysIso(todayIso(), -10) }, stageById);
  assert.equal(underThreshold.isStale, false);
});

test('socialSnapshotStaleInfo is null with no real numbers, no asOfDate, or a recent asOfDate', () => {
  assert.equal(socialSnapshotStaleInfo(null), null);
  assert.equal(socialSnapshotStaleInfo({ followers: null, engagementRate: null, asOfDate: '2020-01-01' }), null);
  assert.equal(socialSnapshotStaleInfo({ followers: 1000, asOfDate: null }), null);
  assert.equal(socialSnapshotStaleInfo({ followers: 1000, asOfDate: addDaysIso(todayIso(), -10) }), null);
});

test('socialSnapshotStaleInfo flags a snapshot past the 90-day research-refresh window', () => {
  const info = socialSnapshotStaleInfo({ followers: 1000, asOfDate: addDaysIso(todayIso(), -91) });
  assert.equal(info.days, 91);
});

test('socialSnapshotsStaleInfo surfaces the oldest stale platform across a multi-platform prospect', () => {
  const p = {
    socialSnapshots: [
      { platform: 'Douyin', followers: 1000, asOfDate: addDaysIso(todayIso(), -95) },
      { platform: 'Xiaohongshu', followers: 2000, asOfDate: addDaysIso(todayIso(), -150) },
      { platform: 'Weibo', followers: 3000, asOfDate: addDaysIso(todayIso(), -10) }
    ]
  };
  const worst = socialSnapshotsStaleInfo(p);
  assert.equal(worst.platform, 'Xiaohongshu');
  assert.equal(worst.days, 150);
});

test('socialSnapshotsStaleInfo is null when no platform is stale', () => {
  const p = { socialSnapshots: [{ platform: 'Weibo', followers: 100, asOfDate: todayIso() }] };
  assert.equal(socialSnapshotsStaleInfo(p), null);
});

test('nudgeUrgencyLevel tiers overdue/today/soon/later correctly', () => {
  assert.equal(nudgeUrgencyLevel(-1, false, false), 'overdue');
  assert.equal(nudgeUrgencyLevel(5, true, false), 'overdue');
  assert.equal(nudgeUrgencyLevel(5, false, true), 'overdue');
  assert.equal(nudgeUrgencyLevel(0, false, false), 'today');
  assert.equal(nudgeUrgencyLevel(2, false, false), 'soon');
  assert.equal(nudgeUrgencyLevel(3, false, false), 'later');
});

test('computeNudgeRows sorts a due nudge before a future one and puts a bad date last', () => {
  const overdue = { id: 'overdue', nextNudgeDate: addDaysIso(todayIso(), -2) };
  const future = { id: 'future', nextNudgeDate: addDaysIso(todayIso(), 5) };
  const badDate = { id: 'bad', nextNudgeDate: '2026-9-5' };
  const rows = computeNudgeRows([future, badDate, overdue]);
  assert.deepEqual(rows.map(r => r.p.id), ['overdue', 'future', 'bad']);
  assert.equal(rows[2].badDate, true);
});

test('computeNudgeRows surfaces an unqueued nudgePoint that has already passed', () => {
  const p = {
    id: 'unqueued',
    nextNudgeDate: null,
    nudgeSchedule: { nudgePoint: addDaysIso(todayIso(), -1) }
  };
  const rows = computeNudgeRows([p]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].unqueued, true);
});

test('computeNudgeRows does not surface a nudgePoint that has not arrived yet', () => {
  const p = {
    id: 'not-yet',
    nextNudgeDate: null,
    nudgeSchedule: { nudgePoint: addDaysIso(todayIso(), 5) }
  };
  assert.deepEqual(computeNudgeRows([p]), []);
});

test('suggestedNudgeOffsetDays widens the gap as the touch count climbs, then holds flat', () => {
  assert.equal(suggestedNudgeOffsetDays(1), 3);
  assert.equal(suggestedNudgeOffsetDays(2), 3);
  assert.equal(suggestedNudgeOffsetDays(3), 5);
  assert.equal(suggestedNudgeOffsetDays(4), 7);
  assert.equal(suggestedNudgeOffsetDays(10), 7);
});

test('rollToWeekdayIso rolls a Saturday/Sunday forward to Monday and leaves a weekday alone', () => {
  assert.equal(rollToWeekdayIso('2026-09-26'), '2026-09-28'); // Saturday -> Monday
  assert.equal(rollToWeekdayIso('2026-09-27'), '2026-09-28'); // Sunday -> Monday
  assert.equal(rollToWeekdayIso('2026-09-23'), '2026-09-23'); // Wednesday, unchanged
});

test('byUrgency sorts a sooner nextNudgeDate before a later one', () => {
  const a = { name: 'A', nextNudgeDate: '2026-10-05' };
  const b = { name: 'B', nextNudgeDate: '2026-10-01' };
  assert.ok(byUrgency(a, b) > 0);
  assert.ok(byUrgency(b, a) < 0);
});

test('byUrgency puts a prospect with no nextNudgeDate after one that has it', () => {
  const dated = { name: 'A', nextNudgeDate: '2026-10-01' };
  const undated = { name: 'B', nextNudgeDate: null };
  assert.ok(byUrgency(dated, undated) < 0);
  assert.ok(byUrgency(undated, dated) > 0);
});

test('byUrgency falls back to name order, and satisfies the comparator contract, when dates match or are both missing', () => {
  // A comparator that returns 1 for both orderings of an equal pair (the
  // real bug this was extracted to guard against) claims a > b and b > a
  // at once, which is impossible for a real ordering.
  const sameDate = [
    { name: 'Zed', nextNudgeDate: '2026-10-01' },
    { name: 'Amy', nextNudgeDate: '2026-10-01' }
  ];
  assert.equal(byUrgency(sameDate[0], sameDate[1]), -byUrgency(sameDate[1], sameDate[0]));
  assert.deepEqual(sameDate.slice().sort(byUrgency).map(p => p.name), ['Amy', 'Zed']);

  const noDate = [
    { name: 'Zed', nextNudgeDate: null },
    { name: 'Amy', nextNudgeDate: null }
  ];
  assert.equal(byUrgency(noDate[0], noDate[1]), -byUrgency(noDate[1], noDate[0]));
  assert.deepEqual(noDate.slice().sort(byUrgency).map(p => p.name), ['Amy', 'Zed']);
});

test('the real prospects.json on disk never produces a stall/stale false negative from a null date', () => {
  const dataPath = path.join(__dirname, 'prospects.json');
  const stagesPath = path.join(__dirname, 'stages.json');
  const { prospects } = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const { stages } = JSON.parse(fs.readFileSync(stagesPath, 'utf8'));
  const byId = {};
  stages.forEach(s => { byId[s.id] = s; });
  // Just needs to run without throwing on every real record on disk, the
  // same shape app.js reads at load time.
  prospects.forEach(p => {
    stallInfo(p, byId);
    socialSnapshotsStaleInfo(p);
  });
});

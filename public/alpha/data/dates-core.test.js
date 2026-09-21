#!/usr/bin/env node
/*
 * Regression tests for dates-core.js, the market-calendar and connectivity/
 * uptime date math the Alpha hub's page (app.js) renders live. The market
 * calendar in particular hand-encodes NYSE's 2026 holidays and early
 * closes; none of those dates have occurred yet as of this writing, so a
 * real page load has never actually exercised the holiday, early-close, or
 * after-hours branches below. This is what catches a regression there
 * before the first real one does.
 *
 * Usage: node --test public/alpha/data/dates-core.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  computeMarketStatus,
  timeAgo,
  freshnessClass,
  formatDuration,
  mostRecentConnectedAt,
  currentStateStartedAt,
  computeIncidents,
  dayKeyLocal,
  computeDailyUptimeBuckets,
  dailyUptimeClass
} = require('./dates-core.js');

// A time built from real ET wall-clock hour/minute on a real 2026 date,
// expressed as a UTC instant. 2026 DST runs 2026-03-08 through 2026-11-01
// (EDT, UTC-4); outside that window ET is EST (UTC-5), which matters for
// the November early-close test below. Keeps each test's intent readable as
// "9:35am ET" rather than a pre-computed UTC offset.
function etInstant(dateKey, hour, minute) {
  const isEdt = dateKey >= '2026-03-08' && dateKey < '2026-11-01';
  const offset = isEdt ? '-04:00' : '-05:00';
  return new Date(`${dateKey}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00${offset}`);
}

test('computeMarketStatus: open during a regular Tuesday session', () => {
  const status = computeMarketStatus(etInstant('2026-09-15', 10, 0));
  assert.equal(status.isOpen, true);
  assert.equal(status.label, 'Market open · closes in 6h');
  assert.match(status.detail, /4:00 PM ET/);
});

test('computeMarketStatus: closed before the open and after the close on a trading day', () => {
  const before = computeMarketStatus(etInstant('2026-09-15', 8, 0));
  assert.equal(before.isOpen, false);
  assert.equal(before.label, 'Market closed · opens in 1h 30m');
  assert.match(before.detail, /Opens today 9:30 AM ET/);

  const after = computeMarketStatus(etInstant('2026-09-15', 17, 0));
  assert.equal(after.isOpen, false);
  // Next real open is tomorrow, not later today, so no same-day countdown
  // to append (see computeMarketStatus's own comment on why a cross-day
  // countdown is deliberately left unmodeled).
  assert.equal(after.label, 'Market closed');
  assert.match(after.detail, /Opens .* 9:30 AM ET/);
});

test('computeMarketStatus: close countdown crosses the early-close boundary correctly', () => {
  // Day after Thanksgiving 2026, 1pm ET early close: 30 minutes out.
  const status = computeMarketStatus(etInstant('2026-11-27', 12, 30));
  assert.equal(status.isOpen, true);
  assert.equal(status.label, 'Market open · closes in 30m');
});

test('computeMarketStatus: weekend/holiday closures never get a same-day open countdown', () => {
  const weekend = computeMarketStatus(etInstant('2026-09-19', 12, 0));
  assert.equal(weekend.label, 'Market closed (weekend)');
  const holiday = computeMarketStatus(etInstant('2026-09-07', 12, 0));
  assert.equal(holiday.label, 'Market closed (holiday)');
});

test('computeMarketStatus: closed on a weekend, names the reason', () => {
  // 2026-09-19 is a Saturday.
  const status = computeMarketStatus(etInstant('2026-09-19', 12, 0));
  assert.equal(status.isOpen, false);
  assert.equal(status.label, 'Market closed (weekend)');
});

test('computeMarketStatus: closed on a real 2026 NYSE holiday, names the reason', () => {
  // Labor Day 2026.
  const status = computeMarketStatus(etInstant('2026-09-07', 12, 0));
  assert.equal(status.isOpen, false);
  assert.equal(status.label, 'Market closed (holiday)');
});

test('computeMarketStatus: open before 1pm but closed after on an early-close day', () => {
  // Day after Thanksgiving 2026, 1pm ET early close.
  const stillOpen = computeMarketStatus(etInstant('2026-11-27', 12, 30));
  assert.equal(stillOpen.isOpen, true);
  assert.match(stillOpen.detail, /1:00 PM ET \(early close\)/);

  const closedAfter = computeMarketStatus(etInstant('2026-11-27', 13, 30));
  assert.equal(closedAfter.isOpen, false);
});

test('computeMarketStatus: skips a weekend/holiday run to find the real next open', () => {
  // Thursday before Labor Day weekend + the Monday holiday: Friday 2026-09-04
  // after the close should point to Tuesday 2026-09-08, not Monday.
  const status = computeMarketStatus(etInstant('2026-09-04', 17, 0));
  assert.equal(status.isOpen, false);
  assert.match(status.detail, /Opens Tue, Sep 8 9:30 AM ET/);
});

test('computeMarketStatus: honestly unknown once the real date rolls past the covered calendar year', () => {
  const status = computeMarketStatus(etInstant('2027-01-04', 10, 0));
  assert.equal(status.isOpen, false);
  assert.equal(status.isUnknown, true);
  assert.equal(status.label, 'Market status unknown');
});

test('timeAgo buckets by minute/hour/day and rejects a bad timestamp', () => {
  const now = new Date('2026-09-15T12:00:00Z').getTime();
  assert.equal(timeAgo('2026-09-15T11:59:40Z', now), 'just now');
  assert.equal(timeAgo('2026-09-15T11:55:00Z', now), '5m ago');
  assert.equal(timeAgo('2026-09-15T09:00:00Z', now), '3h ago');
  assert.equal(timeAgo('2026-09-13T12:00:00Z', now), '2d ago');
  assert.equal(timeAgo('not-a-date', now), null);
});

test('freshnessClass tiers live/stale/down at the 1-minute and 15-minute marks', () => {
  const now = new Date('2026-09-15T12:00:00Z').getTime();
  assert.equal(freshnessClass('2026-09-15T11:59:30Z', now), 'live');
  assert.equal(freshnessClass('2026-09-15T11:50:00Z', now), 'stale');
  assert.equal(freshnessClass('2026-09-15T11:00:00Z', now), 'down');
  assert.equal(freshnessClass('garbage', now), 'down');
});

test('formatDuration rejects negative/non-finite and rolls minutes/hours/days', () => {
  assert.equal(formatDuration(-1), null);
  assert.equal(formatDuration(NaN), null);
  assert.equal(formatDuration(30000), 'under 1m');
  assert.equal(formatDuration(5 * 60000), '5m');
  assert.equal(formatDuration(90 * 60000), '1h 30m');
  assert.equal(formatDuration(120 * 60000), '2h', 'no trailing " 0m"');
  assert.equal(formatDuration(26 * 3600000), '1d 2h');
  assert.equal(formatDuration(48 * 3600000), '2d', 'no trailing " 0h"');
});

test('mostRecentConnectedAt finds the newest connected=true entry, null with none', () => {
  const history = [
    { at: '2026-09-15T10:00:00Z', connected: true },
    { at: '2026-09-15T10:05:00Z', connected: false },
    { at: '2026-09-15T10:10:00Z', connected: false }
  ];
  assert.equal(mostRecentConnectedAt(history), '2026-09-15T10:00:00Z');
  assert.equal(mostRecentConnectedAt([{ at: 'x', connected: false }]), null);
});

test('currentStateStartedAt walks back only while the state keeps matching', () => {
  const downThenUp = [
    { at: '2026-09-15T10:00:00Z', connected: true },
    { at: '2026-09-15T10:05:00Z', connected: false },
    { at: '2026-09-15T10:10:00Z', connected: false },
    { at: '2026-09-15T10:15:00Z', connected: false }
  ];
  assert.equal(currentStateStartedAt(downThenUp, false), '2026-09-15T10:05:00Z');

  const backUp = [
    { at: '2026-09-15T09:00:00Z', connected: false },
    { at: '2026-09-15T10:00:00Z', connected: true },
    { at: '2026-09-15T10:05:00Z', connected: true }
  ];
  assert.equal(currentStateStartedAt(backUp, true), '2026-09-15T10:00:00Z');
  assert.equal(currentStateStartedAt([], false), null);
});

test('computeIncidents groups consecutive down runs and leaves a trailing one ongoing', () => {
  const history = [
    { at: '2026-09-15T10:00:00Z', connected: true },
    { at: '2026-09-15T10:05:00Z', connected: false },
    { at: '2026-09-15T10:10:00Z', connected: false },
    { at: '2026-09-15T10:15:00Z', connected: true },
    { at: '2026-09-15T10:20:00Z', connected: false }
  ];
  const incidents = computeIncidents(history);
  assert.equal(incidents.length, 2);
  assert.deepEqual(incidents[0], { start: '2026-09-15T10:05:00Z', end: '2026-09-15T10:15:00Z', ongoing: false });
  assert.equal(incidents[1].start, '2026-09-15T10:20:00Z');
  assert.equal(incidents[1].ongoing, true);
  assert.equal(incidents[1].end, null);
});

test('computeIncidents is empty for an all-connected history, and for no history', () => {
  assert.deepEqual(computeIncidents([]), []);
  assert.deepEqual(computeIncidents([{ at: 'x', connected: true }]), []);
});

test('dayKeyLocal formats a zero-padded local calendar day, null for a bad timestamp', () => {
  assert.equal(dayKeyLocal('2026-09-05T04:00:00'), '2026-09-05');
  assert.equal(dayKeyLocal('not-a-date'), null);
});

test('computeDailyUptimeBuckets buckets by local day and computes a real per-day percentage', () => {
  const history = [
    { at: '2026-09-15T01:00:00', connected: true },
    { at: '2026-09-15T02:00:00', connected: false },
    { at: '2026-09-16T01:00:00', connected: true }
  ];
  const buckets = computeDailyUptimeBuckets(history);
  assert.equal(buckets.length, 2);
  assert.equal(buckets[0].dateKey, '2026-09-15');
  assert.equal(buckets[0].total, 2);
  assert.equal(buckets[0].up, 1);
  assert.equal(buckets[0].pct, 50);
  assert.equal(buckets[1].pct, 100);
});

test('computeDailyUptimeBuckets respects a custom day-window cap', () => {
  const history = [
    { at: '2026-09-01T01:00:00', connected: true },
    { at: '2026-09-02T01:00:00', connected: true },
    { at: '2026-09-03T01:00:00', connected: true }
  ];
  const buckets = computeDailyUptimeBuckets(history, 2);
  assert.equal(buckets.length, 2);
  assert.equal(buckets[0].dateKey, '2026-09-02', 'oldest day dropped by the cap');
  assert.equal(buckets[1].dateKey, '2026-09-03');
});

test('dailyUptimeClass tiers full/degraded/down', () => {
  assert.equal(dailyUptimeClass(100), 'full');
  assert.equal(dailyUptimeClass(99.9), 'full');
  assert.equal(dailyUptimeClass(50), 'degraded');
  assert.equal(dailyUptimeClass(0.1), 'degraded');
  assert.equal(dailyUptimeClass(0), 'down');
});

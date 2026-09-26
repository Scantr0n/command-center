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
  computeHeadline,
  appendDedupedStringObservation,
  formatDuration,
  mostRecentConnectedAt,
  currentStateStartedAt,
  computeIncidents,
  dayKeyLocal,
  computeDailyUptimeBuckets,
  dailyUptimeClass
} = require('./dates-core.js');

// A time built from real ET wall-clock hour/minute on a real date, expressed
// as a UTC instant. 2026 DST runs 2026-03-08 through 2026-11-01, 2027 DST
// runs 2027-03-14 through 2027-11-07 (each year's real US DST window: second
// Sunday of March to first Sunday of November); outside those windows ET is
// EST (UTC-5), which matters for the November early-close test below. Keeps
// each test's intent readable as "9:35am ET" rather than a pre-computed UTC
// offset.
function etInstant(dateKey, hour, minute) {
  const isEdt = (dateKey >= '2026-03-08' && dateKey < '2026-11-01') ||
    (dateKey >= '2027-03-14' && dateKey < '2027-11-07');
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

test('computeMarketStatus: open during a regular 2027 session', () => {
  // 2027-01-04 is a Monday, and not a holiday: the calendar's 2027 coverage
  // should make this an ordinary open trading day, not "unknown".
  const status = computeMarketStatus(etInstant('2027-01-04', 10, 0));
  assert.equal(status.isOpen, true);
  assert.equal(status.isUnknown, undefined);
});

test('computeMarketStatus: closed on a real 2027 NYSE holiday, names the reason', () => {
  const status = computeMarketStatus(etInstant('2027-01-01', 10, 0));
  assert.equal(status.isOpen, false);
  assert.equal(status.isUnknown, undefined);
  assert.match(status.label, /holiday/);
});

test('computeMarketStatus: skips New Year\'s Day crossing the year boundary into 2027', () => {
  // Thursday 2026-12-31 after the close: the real next trading day is Monday
  // 2027-01-04, skipping New Year's Day (a 2027 holiday) and the weekend.
  // This is the exact regression a single-year-only holiday set produces:
  // nextTradingDayFrom would otherwise walk right through 2027-01-01 as if
  // it were an ordinary trading day, since "today" is still 2026 when this
  // walk starts.
  const status = computeMarketStatus(etInstant('2026-12-31', 17, 0));
  assert.equal(status.isOpen, false);
  assert.match(status.detail, /Opens Mon, Jan 4 9:30 AM ET/);
});

test('computeMarketStatus: honestly unknown once the real date rolls past every covered calendar year', () => {
  const status = computeMarketStatus(etInstant('2028-01-04', 10, 0));
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

// computeHeadline is the single most prominent text on the whole page, so
// every real branch (and their real priority order) gets its own case here.
// NOW is a fixed instant so the freshness/age boundaries below (live/stale/
// down, "just now"/"Nm ago") are exercised deterministically rather than
// depending on when the test happens to run.
const NOW = new Date('2026-09-23T18:00:00Z').getTime();
const FRESH_ASOF = new Date(NOW - 10 * 1000).toISOString(); // 10s ago: 'live'
const AGING_ASOF = new Date(NOW - 5 * 60 * 1000).toISOString(); // 5m ago: 'stale'
const OLD_ASOF = new Date(NOW - 60 * 60 * 1000).toISOString(); // 1h ago: 'down'

test('computeHeadline: kill switch engaged always wins, even while otherwise connected and fresh', () => {
  const data = { connection: { connected: true }, live: { asOf: FRESH_ASOF, killSwitch: { engaged: true } } };
  const result = computeHeadline(data, false, NOW);
  assert.equal(result.level, 'critical');
  assert.equal(result.text, 'KILL SWITCH ENGAGED');
});

test('computeHeadline: kill switch engaged while showing a last-known reading says so explicitly', () => {
  const data = { connection: { connected: false }, live: { asOf: OLD_ASOF, killSwitch: { engaged: true } } };
  const result = computeHeadline(data, true, NOW);
  assert.equal(result.level, 'critical');
  assert.equal(result.text, 'KILL SWITCH ENGAGED (last known, now disconnected)');
});

test('computeHeadline: last-known state (kill switch not engaged) reports a real relative age', () => {
  const data = { connection: { connected: false }, live: { asOf: AGING_ASOF, killSwitch: { engaged: false } } };
  const result = computeHeadline(data, true, NOW);
  assert.equal(result.level, 'lastknown');
  assert.equal(result.text, 'Disconnected - showing last known state from 5m ago');
});

test('computeHeadline: disconnected with no cached last-known reading is a plain awaiting state, not a crash', () => {
  const data = { connection: { connected: false }, live: {} };
  const result = computeHeadline(data, false, NOW);
  assert.deepEqual(result, { level: 'awaiting', text: 'Awaiting live connection', asOf: undefined });
});

test('computeHeadline: connected but missing asOf is also awaiting, never a fabricated freshness read', () => {
  const data = { connection: { connected: true }, live: { asOf: null } };
  const result = computeHeadline(data, false, NOW);
  assert.equal(result.level, 'awaiting');
  assert.equal(result.text, 'Awaiting live connection');
});

test('computeHeadline: connected and fresh (under 1 minute) reads good/Connected', () => {
  const data = { connection: { connected: true }, live: { asOf: FRESH_ASOF } };
  const result = computeHeadline(data, false, NOW);
  assert.deepEqual(result, { level: 'good', text: 'Connected', asOf: FRESH_ASOF });
});

test('computeHeadline: connected but aging (1-15 minutes) reads caution, not a false-calm good', () => {
  const data = { connection: { connected: true }, live: { asOf: AGING_ASOF } };
  const result = computeHeadline(data, false, NOW);
  assert.deepEqual(result, { level: 'caution', text: 'Connected, reading aging', asOf: AGING_ASOF });
});

test('computeHeadline: connected but truly stale (15+ minutes) reads awaiting, not a false-calm good', () => {
  const data = { connection: { connected: true }, live: { asOf: OLD_ASOF } };
  const result = computeHeadline(data, false, NOW);
  assert.deepEqual(result, { level: 'awaiting', text: 'Connected, reading stale', asOf: OLD_ASOF });
});

test('computeHeadline: connected and fresh with a real stuck-agent count reads caution, not a false-calm good', () => {
  const data = { connection: { connected: true }, live: { asOf: FRESH_ASOF, anomalies: { stuckCount: 2 } } };
  const result = computeHeadline(data, false, NOW);
  assert.deepEqual(result, { level: 'caution', text: 'Connected, 2 stuck agents detected', asOf: FRESH_ASOF });
});

test('computeHeadline: singular stuck agent gets singular wording', () => {
  const data = { connection: { connected: true }, live: { asOf: FRESH_ASOF, anomalies: { stuckCount: 1 } } };
  const result = computeHeadline(data, false, NOW);
  assert.equal(result.text, 'Connected, 1 stuck agent detected');
});

test('computeHeadline: a zero stuck-agent count (a real check that found nothing) stays good', () => {
  const data = { connection: { connected: true }, live: { asOf: FRESH_ASOF, anomalies: { stuckCount: 0 } } };
  const result = computeHeadline(data, false, NOW);
  assert.deepEqual(result, { level: 'good', text: 'Connected', asOf: FRESH_ASOF });
});

test('computeHeadline: a null stuck-agent count (the /anomalies check itself failed) is never treated as zero', () => {
  const data = { connection: { connected: true }, live: { asOf: FRESH_ASOF, anomalies: { stuckCount: null } } };
  const result = computeHeadline(data, false, NOW);
  assert.deepEqual(result, { level: 'good', text: 'Connected', asOf: FRESH_ASOF });
});

test('computeHeadline: aging reading with a real stuck-agent count combines both facts', () => {
  const data = { connection: { connected: true }, live: { asOf: AGING_ASOF, anomalies: { stuckCount: 3 } } };
  const result = computeHeadline(data, false, NOW);
  assert.deepEqual(result, { level: 'caution', text: 'Connected, reading aging, 3 stuck agents detected', asOf: AGING_ASOF });
});

test('computeHeadline: kill switch engaged still wins over a stuck-agent count', () => {
  const data = { connection: { connected: true }, live: { asOf: FRESH_ASOF, killSwitch: { engaged: true }, anomalies: { stuckCount: 5 } } };
  const result = computeHeadline(data, false, NOW);
  assert.equal(result.level, 'critical');
  assert.equal(result.text, 'KILL SWITCH ENGAGED');
});

// Shared decision logic behind recordClientRegimeObservation and
// recordClientSizingModeObservation in app.js.
test('appendDedupedStringObservation never records while disconnected or with a falsy value', () => {
  const history = [{ at: '2026-01-01T00:00:00.000Z', regime: 'trending' }];
  assert.equal(appendDedupedStringObservation(history, false, 'trending', 'regime', 200), history);
  assert.equal(appendDedupedStringObservation(history, true, null, 'regime', 200), history);
  assert.equal(appendDedupedStringObservation(history, true, '', 'regime', 200), history);
});

test('appendDedupedStringObservation skips a repeat of the last recorded value, returning the same array reference', () => {
  const history = [{ at: '2026-01-01T00:00:00.000Z', regime: 'trending' }];
  const result = appendDedupedStringObservation(history, true, 'trending', 'regime', 200, Date.now());
  assert.equal(result, history, 'no real change, so the exact same reference comes back, not a new equal-looking array');
});

test('appendDedupedStringObservation appends a real new value with a real timestamp, keyed under the given field', () => {
  const history = [{ at: '2026-01-01T00:00:00.000Z', regime: 'trending' }];
  const now = new Date('2026-01-02T00:00:00.000Z').getTime();
  const result = appendDedupedStringObservation(history, true, 'choppy', 'regime', 200, now);
  assert.notEqual(result, history);
  assert.equal(result.length, 2);
  assert.deepEqual(result[1], { at: '2026-01-02T00:00:00.000Z', regime: 'choppy' });
});

test('appendDedupedStringObservation records the first observation into an empty history', () => {
  const now = new Date('2026-01-01T00:00:00.000Z').getTime();
  const result = appendDedupedStringObservation([], true, 'drawdown-based', 'mode', 200, now);
  assert.deepEqual(result, [{ at: '2026-01-01T00:00:00.000Z', mode: 'drawdown-based' }]);
});

test('appendDedupedStringObservation caps the history to the most recent entries', () => {
  const history = Array.from({ length: 5 }, (_, i) => ({ at: `2026-01-0${i + 1}T00:00:00.000Z`, mode: 'drawdown-based' }));
  const now = new Date('2026-01-10T00:00:00.000Z').getTime();
  const result = appendDedupedStringObservation(history, true, 'robustness-based', 'mode', 3, now);
  assert.equal(result.length, 3);
  assert.equal(result[result.length - 1].mode, 'robustness-based');
});

test('appendDedupedStringObservation records a real transition back to a previous value, not just forward ones', () => {
  const history = [
    { at: '2026-01-01T00:00:00.000Z', mode: 'drawdown-based' },
    { at: '2026-01-02T00:00:00.000Z', mode: 'robustness-based' }
  ];
  const now = new Date('2026-01-03T00:00:00.000Z').getTime();
  const result = appendDedupedStringObservation(history, true, 'drawdown-based', 'mode', 200, now);
  assert.equal(result.length, 3);
  assert.equal(result[2].mode, 'drawdown-based');
});

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
const {
  daysBetween, addDays, isValidDateStr, BUGFIX_CHECKPOINTS, bugfixCheckinStatus,
  suggestedCheckCadence, computeReminders, releaseMarkersForChecks
} = require('./release-core.js');

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

test('suggestedCheckCadence returns null with fewer than 2 real checks', () => {
  assert.equal(suggestedCheckCadence(null), null);
  assert.equal(suggestedCheckCadence({ metric: { checks: [] } }), null);
  assert.equal(suggestedCheckCadence({ metric: { checks: [{ date: '2026-01-01', count: 5 }] } }), null);
});

test('suggestedCheckCadence averages real gaps and projects the next date off the latest check', () => {
  const result = suggestedCheckCadence({
    metric: { checks: [{ date: '2026-01-01', count: 5 }, { date: '2026-01-11', count: 8 }, { date: '2026-01-21', count: 12 }] }
  });
  assert.equal(result.avgGap, 10, 'two real gaps of 10 days each');
  assert.equal(result.gapCount, 2);
  assert.equal(result.nextDate, '2026-01-31', 'latest check date plus the average gap');
  assert.equal(result.latest.date, '2026-01-21');
});

test('suggestedCheckCadence sorts unsorted checks before computing gaps, never trusting input order', () => {
  const result = suggestedCheckCadence({
    metric: { checks: [{ date: '2026-01-21', count: 12 }, { date: '2026-01-01', count: 5 }, { date: '2026-01-11', count: 8 }] }
  });
  assert.equal(result.avgGap, 10);
  assert.equal(result.nextDate, '2026-01-31');
});

test('suggestedCheckCadence rounds a fractional average gap to the nearest whole day', () => {
  // Gaps of 10 and 11 average to 10.5, rounds to 11.
  const result = suggestedCheckCadence({
    metric: { checks: [{ date: '2026-01-01', count: 5 }, { date: '2026-01-11', count: 8 }, { date: '2026-01-22', count: 12 }] }
  });
  assert.equal(result.avgGap, 11);
});

test('computeReminders returns no reminders when there is nothing forward-looking to remind about', () => {
  assert.deepEqual(computeReminders({}, {}, '2026-09-23'), []);
  assert.deepEqual(computeReminders(null, null, '2026-09-23'), []);
});

test('computeReminders only includes bugfix checkpoints for a bugfix release, never a major/minor one', () => {
  const majorRelease = { releases: [{ version: '1.0.0', type: 'major', date: '2026-09-01' }] };
  assert.deepEqual(computeReminders(majorRelease, {}, '2026-09-05'), []);
});

test('computeReminders includes both real bugfix checkpoints when both are still ahead of today', () => {
  const releasesData = { releases: [{ version: '0.3.7', type: 'bugfix', date: '2026-09-07', summary: 'Fixed the crash' }] };
  const reminders = computeReminders(releasesData, {}, '2026-09-08');
  assert.equal(reminders.length, 2);
  assert.equal(reminders[0].date, '2026-09-14', '7-day checkpoint');
  assert.equal(reminders[1].date, '2026-09-21', '14-day checkpoint');
  assert.equal(reminders[0].uid, 'sondrik-checkin-v0.3.7-7@command-center');
  assert.match(reminders[0].summary, /0\.3\.7.*7-day check-in/);
  assert.match(reminders[0].description, /Fixed the crash/);
});

test('computeReminders drops a bugfix checkpoint that has already passed, never a stale calendar entry', () => {
  const releasesData = { releases: [{ version: '0.3.7', type: 'bugfix', date: '2026-09-07' }] };
  // 2026-09-16 is past the 7-day checkpoint (2026-09-14) but before the 14-day one (2026-09-21).
  const reminders = computeReminders(releasesData, {}, '2026-09-16');
  assert.equal(reminders.length, 1);
  assert.equal(reminders[0].date, '2026-09-21');
});

test('computeReminders includes the real download-cadence reminder when its projected date is still ahead', () => {
  const downloadsData = { metric: { label: 'DMG downloads', source: 'GitHub Releases', checks: [{ date: '2026-09-01', count: 10 }, { date: '2026-09-11', count: 15 }] } };
  const reminders = computeReminders({}, downloadsData, '2026-09-15');
  assert.equal(reminders.length, 1);
  assert.equal(reminders[0].date, '2026-09-21', 'latest check (09-11) plus the 10-day avg gap');
  assert.match(reminders[0].summary, /pull a fresh DMG downloads count/);
  assert.match(reminders[0].description, /GitHub Releases/);
});

test('computeReminders drops the download-cadence reminder once its projected date has already passed', () => {
  const downloadsData = { metric: { checks: [{ date: '2026-09-01', count: 10 }, { date: '2026-09-11', count: 15 }] } };
  const reminders = computeReminders({}, downloadsData, '2026-09-25'); // projected next check was 09-21, already past
  assert.equal(reminders.length, 0);
});

test('computeReminders sorts a real mix of bugfix and cadence reminders chronologically, not by insertion order', () => {
  const releasesData = { releases: [{ version: '0.3.7', type: 'bugfix', date: '2026-09-20' }] }; // 7-day: 09-27, 14-day: 10-04
  const downloadsData = { metric: { checks: [{ date: '2026-09-01', count: 10 }, { date: '2026-09-11', count: 15 }] } }; // next: 09-21
  const reminders = computeReminders(releasesData, downloadsData, '2026-09-21');
  const dates = reminders.map(r => r.date);
  assert.deepEqual(dates, [...dates].sort(), 'reminders come back in real chronological order');
  assert.deepEqual(dates, ['2026-09-21', '2026-09-27', '2026-10-04']);
});

test('releaseMarkersForChecks attaches a release to the earliest real check on or after its ship date, the real v0.3.7 case', () => {
  const checks = [{ date: '2026-09-04', count: 0 }, { date: '2026-09-07', count: 8 }, { date: '2026-09-20', count: 15 }];
  const releases = [{ version: '0.3.7', date: '2026-09-07', summary: 'Fixed default CRM seed data' }];
  const markers = releaseMarkersForChecks(releases, checks);
  assert.equal(markers.length, 3, 'one entry per check, parallel arrays');
  assert.deepEqual(markers[0], [], 'the 09-04 check is before the release, no marker');
  assert.equal(markers[1].length, 1, 'the 09-07 check is the real ship date itself');
  assert.equal(markers[1][0].version, '0.3.7');
  assert.deepEqual(markers[2], []);
});

test('releaseMarkersForChecks attaches a release that shipped between two checks to the next check after it, never an invented one', () => {
  const checks = [{ date: '2026-09-01', count: 5 }, { date: '2026-09-15', count: 20 }];
  const releases = [{ version: '0.4.0', date: '2026-09-10' }];
  const markers = releaseMarkersForChecks(releases, checks);
  assert.deepEqual(markers[0], []);
  assert.equal(markers[1].length, 1, 'the 09-15 check is the first real check on or after the 09-10 ship date');
  assert.equal(markers[1][0].version, '0.4.0');
});

test('releaseMarkersForChecks drops a release shipped after the most recent check, no real check to attach it to yet', () => {
  const checks = [{ date: '2026-09-01', count: 5 }];
  const releases = [{ version: '0.4.0', date: '2026-09-10' }];
  const markers = releaseMarkersForChecks(releases, checks);
  assert.deepEqual(markers[0], []);
});

test('releaseMarkersForChecks skips an undated or malformed-date release rather than crashing', () => {
  const checks = [{ date: '2026-09-01', count: 5 }];
  const releases = [{ version: '0.3.6', date: null }, { version: '0.3.5', date: '2026-9-1' }];
  const markers = releaseMarkersForChecks(releases, checks);
  assert.deepEqual(markers[0], []);
});

test('releaseMarkersForChecks attaches two releases shipped in the same gap to the same next check, both kept', () => {
  const checks = [{ date: '2026-09-01', count: 5 }, { date: '2026-09-20', count: 30 }];
  const releases = [{ version: '0.4.0', date: '2026-09-05' }, { version: '0.4.1', date: '2026-09-08' }];
  const markers = releaseMarkersForChecks(releases, checks);
  assert.equal(markers[1].length, 2);
  assert.deepEqual(markers[1].map(r => r.version), ['0.4.0', '0.4.1'], 'in real chronological ship order');
});

test('releaseMarkersForChecks returns an all-empty parallel array for no releases or no checks, not undefined/null entries', () => {
  const checks = [{ date: '2026-09-01', count: 5 }];
  assert.deepEqual(releaseMarkersForChecks([], checks), [[]]);
  assert.deepEqual(releaseMarkersForChecks(null, checks), [[]]);
  assert.deepEqual(releaseMarkersForChecks([{ version: '0.3.7', date: '2026-09-01' }], []), []);
});

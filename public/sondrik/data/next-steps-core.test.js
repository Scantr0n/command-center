#!/usr/bin/env node
/*
 * Regression tests for next-steps-core.js, the shared "what needs Jack's
 * attention right now" logic behind the Next Steps section and the
 * header's attention pill. Uses the real bugfixCheckinStatus/
 * computeGoalProgressPct/computeGoalPaceStatus/findDuplicateLeads from
 * release-core.js/goals-core.js/validate-core.js (already covered by their
 * own test files) as deps, rather than stubs, so this suite also catches a
 * real wiring mistake between computeNextSteps and any of them, not just a
 * bug local to this file.
 *
 * Usage: node --test public/sondrik/data/next-steps-core.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { computeNextSteps } = require('./next-steps-core.js');
const { bugfixCheckinStatus } = require('./release-core.js');
const {
  isValidDateStr, daysBetween, computeGoalProgressPct, computeGoalPaceStatus,
  computeRequiredPerDay, recentDownloadsPerDayRate
} = require('./goals-core.js');
const { findDuplicateLeads } = require('./validate-core.js');

const TODAY = '2026-09-24';
const fmtDate = iso => iso; // identity, same reason release-core.test.js uses it: locale-independent tests

function baseDeps(overrides) {
  return Object.assign({
    todayIsoStr: TODAY,
    fmtDate,
    staleAfterDays: 7,
    agingAfterDays: 4,
    bugfixCheckinStatus,
    currentMetricValue: () => null,
    computeGoalProgressPct,
    computeGoalPaceStatus,
    computeRequiredPerDay,
    recentDownloadsPerDayRate,
    findDuplicateLeads,
    isValidDateStr,
    daysBetween
  }, overrides);
}

function urgentTexts(steps) { return steps.filter(s => s.urgent).map(s => s.text); }
function infoTexts(steps) { return steps.filter(s => !s.urgent).map(s => s.text); }

// A goal with no targetDate and the default currentMetricValue stub (which
// returns null) never reaches either the target-date-passed or the pace
// branch, so it adds no step of its own; used below to isolate a single
// section under test from the "no goals set" and "no downloads logged"
// steps that would otherwise always fire on data this test isn't about.
function quietData(overrides) {
  return Object.assign({
    downloadsData: { metric: { label: 'downloads', source: 'gh api', checks: [{ date: TODAY, count: 1 }] } },
    goalsData: { goals: [{ id: 'quiet', label: 'quiet', metric: 'downloads', target: 100 }] }
  }, overrides);
}

test('with entirely empty/missing data, only the "no downloads yet" and "no goal set" steps fire', () => {
  const steps = computeNextSteps({}, baseDeps());
  assert.deepEqual(steps.map(s => s.text).sort(), [
    'Log a first download check in downloads.json once you have a real count to record.',
    'Set a real target in goals.json once there is one worth tracking against.'
  ].sort());
  assert.ok(steps.every(s => !s.urgent));
});

test('flags a drifted changelog as urgent with a real recorded/real count', () => {
  const steps = computeNextSteps(
    { changelogStatusData: { drifted: true, recordedCount: 3, realCount: 5 } },
    baseDeps()
  );
  assert.ok(urgentTexts(steps).some(t => t.includes('3 recorded vs 5 real commits')));
});

test('does not flag an undrifted changelog', () => {
  const steps = computeNextSteps(
    quietData({ changelogStatusData: { drifted: false, recordedCount: 5, realCount: 5 } }),
    baseDeps()
  );
  assert.equal(steps.length, 0);
});

test('flags a single undated release by version, non-urgent', () => {
  const steps = computeNextSteps(
    { releasesData: { releases: [{ version: '0.3.7', type: 'bugfix' }] } },
    baseDeps()
  );
  assert.ok(infoTexts(steps).some(t => t.includes('v0.3.7') && t.includes('no date is on record')));
});

test('flags multiple undated releases by count', () => {
  const steps = computeNextSteps(
    { releasesData: { releases: [{ version: '0.3.7' }, { version: '0.3.8' }] } },
    baseDeps()
  );
  assert.ok(infoTexts(steps).some(t => t.startsWith('Log the ship date for 2 releases')));
});

test('flags a bugfix release past its check-in window as urgent', () => {
  // v0.3.7 shipped 2026-09-07, 17 real days before TODAY: past both the
  // 7-day and 14-day checkpoints (real bugfixCheckinStatus tier "missed").
  const steps = computeNextSteps(
    { releasesData: { releases: [{ version: '0.3.7', type: 'bugfix', date: '2026-09-07' }] } },
    baseDeps()
  );
  assert.ok(urgentTexts(steps).some(t => t.startsWith('v0.3.7:') && t.includes('check-in')));
});

test('does not flag a bugfix release still well inside its check-in window', () => {
  const steps = computeNextSteps(
    { releasesData: { releases: [{ version: '0.3.9', type: 'bugfix', date: TODAY }] } },
    baseDeps()
  );
  assert.equal(urgentTexts(steps).some(t => t.startsWith('v0.3.9:')), false);
});

test('flags a single undated lead by its source detail', () => {
  const steps = computeNextSteps(
    { leadsData: { leads: [{ id: 'a', sourceDetail: 'Commenter on r/IMadeThis' }] } },
    baseDeps()
  );
  assert.ok(infoTexts(steps).some(t => t.includes('Commenter on r/IMadeThis actually came in')));
});

test('flags multiple undated leads by count', () => {
  const steps = computeNextSteps(
    { leadsData: { leads: [{ id: 'a' }, { id: 'b' }] } },
    baseDeps()
  );
  assert.ok(infoTexts(steps).some(t => t.startsWith('Log the real date 2 leads actually came in')));
});

test('flags an awaiting-approval unsent lead as urgent, and a missing draftText as a separate non-urgent step', () => {
  const steps = computeNextSteps(
    {
      leadsData: {
        leads: [{
          id: 'a', loggedDate: TODAY, sourceDetail: 'Commenter on r/IMadeThis',
          outreach: { sent: false, approvalStatus: 'awaiting-approval', draftText: null }
        }]
      }
    },
    baseDeps()
  );
  assert.ok(urgentTexts(steps).some(t => t.includes('Approve or send the drafted message to Commenter on r/IMadeThis')));
  assert.ok(infoTexts(steps).some(t => t.includes('Paste the actual drafted text for Commenter on r/IMadeThis')));
});

test('does not add the missing-draftText step once draftText is actually logged', () => {
  const steps = computeNextSteps(
    {
      leadsData: {
        leads: [{
          id: 'a', loggedDate: TODAY, sourceDetail: 'Commenter on r/IMadeThis',
          outreach: { sent: false, approvalStatus: 'awaiting-approval', draftText: 'Hey, saw your comment...' }
        }]
      }
    },
    baseDeps()
  );
  assert.equal(infoTexts(steps).some(t => t.includes('Paste the actual drafted text')), false);
});

test('does not flag a lead once it has actually been sent', () => {
  const steps = computeNextSteps(
    quietData({
      leadsData: {
        leads: [{ id: 'a', loggedDate: TODAY, outreach: { sent: true, approvalStatus: 'approved' } }]
      }
    }),
    baseDeps()
  );
  assert.equal(steps.length, 0);
});

test('flags no download checks logged yet, non-urgent', () => {
  const steps = computeNextSteps({ downloadsData: { metric: { checks: [] } } }, baseDeps());
  assert.ok(infoTexts(steps).some(t => t.startsWith('Log a first download check')));
});

test('flags a download check older than staleAfterDays as urgent', () => {
  const steps = computeNextSteps(
    { downloadsData: { metric: { label: 'downloads', source: 'gh api', checks: [{ date: '2026-09-10', count: 15 }] } } },
    baseDeps()
  );
  // 2026-09-10 to 2026-09-24 is 14 days, past the 7-day staleAfterDays default.
  assert.ok(urgentTexts(steps).some(t => t.includes('last one logged is 14 days old')));
});

test('flags a download check older than agingAfterDays but not yet stale as non-urgent', () => {
  const steps = computeNextSteps(
    { downloadsData: { metric: { label: 'downloads', source: 'gh api', checks: [{ date: '2026-09-19', count: 15 }] } } },
    baseDeps()
  );
  // 5 days old: past agingAfterDays (4), not past staleAfterDays (7).
  assert.ok(infoTexts(steps).some(t => t.includes('is 5 days old, plan to pull a fresh one')));
  assert.equal(urgentTexts(steps).length, 0);
});

test('does not flag a fresh download check', () => {
  const steps = computeNextSteps(
    quietData({ downloadsData: { metric: { label: 'downloads', source: 'gh api', checks: [{ date: TODAY, count: 15 }] } } }),
    baseDeps()
  );
  assert.equal(steps.length, 0);
});

test('flags a download metric with no cited source', () => {
  const steps = computeNextSteps(
    { downloadsData: { metric: { label: 'downloads', checks: [{ date: TODAY, count: 15 }] } } },
    baseDeps()
  );
  assert.ok(infoTexts(steps).some(t => t.startsWith('Cite a source for the downloads count')));
});

test('flags a single count regression as urgent, naming the date and count', () => {
  const steps = computeNextSteps(
    {
      downloadsData: {
        metric: {
          label: 'downloads', source: 'gh api',
          checks: [{ date: '2026-09-20', count: 15 }, { date: TODAY, count: 12 }]
        }
      }
    },
    baseDeps()
  );
  assert.ok(urgentTexts(steps).some(t => t.includes('The ' + TODAY + ' check (12)') && t.includes('should not go down')));
});

test('flags multiple count regressions by count', () => {
  const steps = computeNextSteps(
    {
      downloadsData: {
        metric: {
          label: 'downloads', source: 'gh api',
          checks: [{ date: '2026-09-18', count: 20 }, { date: '2026-09-20', count: 15 }, { date: TODAY, count: 12 }]
        }
      }
    },
    baseDeps()
  );
  assert.ok(urgentTexts(steps).some(t => t.startsWith('2 checks') && t.includes('should not go down')));
});

test('flags a not-tracked channel with no explanatory note', () => {
  const steps = computeNextSteps(
    { channelsData: { channels: [{ id: 'x', name: 'Product Hunt', status: 'not-tracked', note: null }] } },
    baseDeps()
  );
  assert.ok(infoTexts(steps).some(t => t.includes('Product Hunt is not tracked yet')));
});

test('does not flag a not-tracked channel that already has a note', () => {
  const steps = computeNextSteps(
    quietData({ channelsData: { channels: [{ id: 'x', name: 'Product Hunt', status: 'not-tracked', note: 'Not wired in yet.' }] } }),
    baseDeps()
  );
  assert.equal(steps.length, 0);
});

test('flags a tracked channel with no linkedMetric wired up', () => {
  const steps = computeNextSteps(
    { channelsData: { channels: [{ id: 'x', name: 'GitHub Releases', status: 'tracked', linkedMetric: null }] } },
    baseDeps()
  );
  assert.ok(infoTexts(steps).some(t => t.includes('Wire up a linkedMetric') && t.includes('GitHub Releases')));
});

test('flags having no goals set at all', () => {
  const steps = computeNextSteps({ goalsData: { goals: [] } }, baseDeps());
  assert.ok(infoTexts(steps).some(t => t.startsWith('Set a real target in goals.json')));
});

test('flags a goal whose target date has passed and is not yet met, urgent', () => {
  const steps = computeNextSteps(
    { goalsData: { goals: [{ id: 'g', label: '150 downloads', metric: 'downloads', target: 150, targetDate: '2026-09-01', setDate: '2026-08-01' }] } },
    baseDeps({ currentMetricValue: () => ({ count: 15, asOf: TODAY }) })
  );
  assert.ok(urgentTexts(steps).some(t => t.includes('"150 downloads" target date has passed') && t.includes('15 of 150')));
});

test('does not flag an already-achieved goal even past its target date', () => {
  const steps = computeNextSteps(
    quietData({ goalsData: { goals: [{ id: 'g', label: '150 downloads', metric: 'downloads', target: 150, targetDate: '2026-09-01', setDate: '2026-08-01' }] } }),
    baseDeps({ currentMetricValue: () => ({ count: 200, asOf: TODAY }) })
  );
  assert.equal(steps.length, 0);
});

test('flags a goal that is behind pace, non-urgent', () => {
  // setDate to targetDate spans 61 days, 54 elapsed by TODAY (~89%
  // expected), but only 15 of 150 (10%) reached: well behind, tier "behind".
  const steps = computeNextSteps(
    { goalsData: { goals: [{ id: 'g', label: '150 downloads', metric: 'downloads', target: 150, targetDate: '2026-10-01', setDate: '2026-08-01' }] } },
    baseDeps({ currentMetricValue: () => ({ count: 15, asOf: TODAY }) })
  );
  assert.ok(infoTexts(steps).some(t => t.includes('"150 downloads" is behind pace')));
});

test('does not flag a goal on pace', () => {
  // setDate to targetDate spans 4 days, 1 day elapsed by TODAY (25%
  // expected), 15 of 60 (25%) reached: exactly on pace, tier "on".
  const steps = computeNextSteps(
    quietData({ goalsData: { goals: [{ id: 'g', label: 'On track', metric: 'downloads', target: 60, targetDate: '2026-09-27', setDate: '2026-09-23' }] } } ),
    baseDeps({ currentMetricValue: () => ({ count: 15, asOf: TODAY }) })
  );
  assert.equal(steps.length, 0);
});

test('flags a goal whose elapsed-time pace looks fine but the real recent download trend will not reach it', () => {
  // Sondrik's own real numbers: setDate to targetDate spans 102 days, only
  // 4 elapsed by TODAY (~4% expected), 15 of 150 (10%) reached, well ahead
  // of the elapsed-time expectation, computeGoalPaceStatus's own tier is
  // "on" (would even round to "ahead" a few points either way), so the
  // existing behind-pace branch above stays silent. But the last logged
  // check-to-check gap (8 on 09-07 to 15 on 09-20) is only ~0.54/day,
  // while the 2026-12-31 date actually needs ~1.38/day from today: a real
  // gap the elaped-time signal alone cannot see this early in the window.
  const steps = computeNextSteps(
    {
      downloadsData: { metric: { label: 'downloads', source: 'gh api', checks: [
        { date: '2026-09-07', count: 8 }, { date: '2026-09-20', count: 15 }
      ] } },
      goalsData: { goals: [{ id: 'g', label: '150 downloads', metric: 'downloads', target: 150, targetDate: '2026-12-31', setDate: '2026-09-20' }] }
    },
    baseDeps({ currentMetricValue: () => ({ count: 15, asOf: '2026-09-20' }) })
  );
  assert.ok(infoTexts(steps).some(t =>
    t.includes('"150 downloads" needs ~1.4/day from here to hit 2026-12-31') && t.includes('recent pace is only ~0.5/day')));
});

test('does not flag the recent-trend gap once the recent pace already clears what is needed', () => {
  const steps = computeNextSteps(
    {
      downloadsData: { metric: { label: 'downloads', source: 'gh api', checks: [
        { date: '2026-09-07', count: 8 }, { date: '2026-09-20', count: 100 }
      ] } },
      goalsData: { goals: [{ id: 'g', label: '150 downloads', metric: 'downloads', target: 150, targetDate: '2026-12-31', setDate: '2026-09-20' }] }
    },
    baseDeps({ currentMetricValue: () => ({ count: 100, asOf: '2026-09-20' }) })
  );
  assert.ok(!infoTexts(steps).some(t => t.includes('needs ~') && t.includes('recent pace')));
});

test('does not double-flag a goal that is already behind pace with the recent-trend step too', () => {
  const steps = computeNextSteps(
    {
      downloadsData: { metric: { label: 'downloads', source: 'gh api', checks: [
        { date: '2026-08-01', count: 1 }, { date: '2026-08-15', count: 2 }
      ] } },
      goalsData: { goals: [{ id: 'g', label: '150 downloads', metric: 'downloads', target: 150, targetDate: '2026-10-01', setDate: '2026-08-01' }] }
    },
    baseDeps({ currentMetricValue: () => ({ count: 15, asOf: TODAY }) })
  );
  assert.ok(infoTexts(steps).some(t => t.includes('"150 downloads" is behind pace')));
  assert.ok(!infoTexts(steps).some(t => t.includes('needs ~') && t.includes('recent pace')));
});

test('flags two leads sharing a channel and source detail as a likely duplicate', () => {
  const steps = computeNextSteps(
    {
      leadsData: {
        leads: [
          { id: 'a', loggedDate: TODAY, channelId: 'reddit', sourceDetail: 'Commenter on r/IMadeThis' },
          { id: 'b', loggedDate: TODAY, channelId: 'reddit', sourceDetail: 'Commenter on r/IMadeThis' }
        ]
      }
    },
    baseDeps()
  );
  assert.ok(infoTexts(steps).some(t => t.startsWith('2 leads look like the same real contact logged twice')));
});

test('sorts every urgent step before every non-urgent step regardless of insertion order', () => {
  const steps = computeNextSteps(
    {
      channelsData: { channels: [{ id: 'x', name: 'Product Hunt', status: 'not-tracked', note: null }] }, // non-urgent, computed first
      releasesData: { releases: [{ version: '0.3.7', type: 'bugfix', date: '2026-09-07' }] } // urgent, computed after
    },
    baseDeps()
  );
  const urgentCount = steps.filter(s => s.urgent).length;
  assert.ok(urgentCount > 0 && urgentCount < steps.length);
  assert.ok(steps.slice(0, urgentCount).every(s => s.urgent));
  assert.ok(steps.slice(urgentCount).every(s => !s.urgent));
});

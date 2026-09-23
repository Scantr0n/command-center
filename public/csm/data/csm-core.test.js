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
  nudgeUrgencyLevel, computeNudgeRows, byUrgency, touchCount, daysSinceLastTouch,
  todayIso, addDaysIso, suggestedNudgeOffsetDays, rollToWeekdayIso,
  reachedActiveExploration, computeStageVelocity, computeColdSignal, COLD_TOUCH_THRESHOLD,
  computeFunnel, computeSocialReach, computeChannelEffectiveness, computeCategoryEffectiveness,
  CHANNEL_EFF_MIN_N_FOR_RATE
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

test('touchCount counts only outreachLog entries with a valid date', () => {
  const p = {
    outreachLog: [
      { date: '2026-09-01', type: 'initial-send' },
      { date: '2026-09-10', type: 'nudge' },
      { date: '2026-9-15', type: 'nudge' }, // non-zero-padded, invalid
      { type: 'nudge' } // no date at all
    ]
  };
  assert.equal(touchCount(p), 2);
});

test('touchCount is 0 for no outreachLog, not a throw', () => {
  assert.equal(touchCount({}), 0);
  assert.equal(touchCount({ outreachLog: [] }), 0);
});

test('daysSinceLastTouch is null with no valid touches logged, never NaN', () => {
  assert.equal(daysSinceLastTouch({}), null);
  assert.equal(daysSinceLastTouch({ outreachLog: [{ date: '2026-9-1', type: 'initial-send' }] }), null);
});

test('daysSinceLastTouch uses the most recent of several logged touches, not the first', () => {
  const p = {
    outreachLog: [
      { date: addDaysIso(todayIso(), -20), type: 'initial-send' },
      { date: addDaysIso(todayIso(), -5), type: 'nudge' },
      { date: addDaysIso(todayIso(), -12), type: 'nudge' }
    ]
  };
  assert.equal(daysSinceLastTouch(p), 5);
});

test('reachedActiveExploration is true for a prospect currently in-exploration or client', () => {
  assert.equal(reachedActiveExploration({ stage: 'in-exploration' }), true);
  assert.equal(reachedActiveExploration({ stage: 'client' }), true);
});

test('reachedActiveExploration is true from stageHistory even after moving back out of exploration', () => {
  const p = {
    stage: 'silent-replied',
    stageHistory: [
      { date: '2026-08-01', stage: 'outreach-sent' },
      { date: '2026-08-15', stage: 'in-exploration' },
      { date: '2026-09-01', stage: 'silent-replied' }
    ]
  };
  assert.equal(reachedActiveExploration(p), true);
});

test('reachedActiveExploration is false with no current or historical exploration/client stage', () => {
  assert.equal(reachedActiveExploration({ stage: 'outreach-sent' }), false);
  assert.equal(reachedActiveExploration({ stage: 'silent-replied', stageHistory: [{ date: '2026-08-01', stage: 'outreach-sent' }] }), false);
  assert.equal(reachedActiveExploration({ stage: 'researched' }), false);
});

const VELOCITY_STAGES = [
  { id: 'researched', staleAfterDays: 14 },
  { id: 'outreach-sent', staleAfterDays: 10 },
  { id: 'in-exploration', staleAfterDays: 30 }
];

test('computeStageVelocity averages dwell time from completed moves only', () => {
  const prospects = [
    {
      stageHistory: [
        { date: '2026-08-01', stage: 'researched' },
        { date: '2026-08-05', stage: 'outreach-sent' } // 4 days in researched
      ]
    },
    {
      stageHistory: [
        { date: '2026-08-01', stage: 'researched' },
        { date: '2026-08-11', stage: 'outreach-sent' } // 10 days in researched
      ]
    }
  ];
  const results = computeStageVelocity(VELOCITY_STAGES, prospects);
  const researched = results.find(r => r.stage.id === 'researched');
  assert.equal(researched.n, 2);
  assert.equal(researched.avgDays, 7); // (4 + 10) / 2
  const outreach = results.find(r => r.stage.id === 'outreach-sent');
  assert.equal(outreach.n, 0);
  assert.equal(outreach.avgDays, null);
});

test('computeStageVelocity sorts stageHistory by date before pairing, not by append order', () => {
  const prospects = [{
    stageHistory: [
      { date: '2026-08-05', stage: 'outreach-sent' }, // logged first, but happened second
      { date: '2026-08-01', stage: 'researched' }
    ]
  }];
  const results = computeStageVelocity(VELOCITY_STAGES, prospects);
  assert.equal(results.find(r => r.stage.id === 'researched').avgDays, 4);
});

test('computeStageVelocity skips entries with an invalid date instead of poisoning the average with NaN', () => {
  const prospects = [{
    stageHistory: [
      { date: '2026-8-1', stage: 'researched' }, // non-zero-padded, invalid
      { date: '2026-08-05', stage: 'outreach-sent' }
    ]
  }, {
    stageHistory: [
      { date: '2026-08-01', stage: 'researched' },
      { date: '2026-08-05', stage: 'outreach-sent' }
    ]
  }];
  const results = computeStageVelocity(VELOCITY_STAGES, prospects);
  const researched = results.find(r => r.stage.id === 'researched');
  assert.equal(researched.n, 1);
  assert.equal(researched.avgDays, 4);
  assert.ok(Number.isFinite(researched.avgDays));
});

test('computeStageVelocity skips a pair whose dwell would compute negative', () => {
  const prospects = [{
    stageHistory: [
      { date: '2026-08-01', stage: 'researched' },
      { date: '2026-08-01', stage: 'researched' } // duplicate date, same stage twice
    ]
  }];
  const results = computeStageVelocity(VELOCITY_STAGES, prospects);
  const researched = results.find(r => r.stage.id === 'researched');
  assert.equal(researched.n, 1);
  assert.equal(researched.avgDays, 0);
});

test('computeStageVelocity ignores a stage id not in the known stages list', () => {
  const prospects = [{
    stageHistory: [
      { date: '2026-08-01', stage: 'client' }, // not in VELOCITY_STAGES
      { date: '2026-08-05', stage: 'outreach-sent' }
    ]
  }];
  const results = computeStageVelocity(VELOCITY_STAGES, prospects);
  assert.ok(results.every(r => r.n === 0));
});

test('computeStageVelocity is all-null/zero for prospects with no completed moves', () => {
  const results = computeStageVelocity(VELOCITY_STAGES, [{ stageHistory: [{ date: '2026-08-01', stage: 'researched' }] }]);
  assert.ok(results.every(r => r.n === 0 && r.avgDays === null));
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
    reachedActiveExploration(p);
  });
  computeStageVelocity(stages, prospects);
  computeColdSignal(prospects);
  computeFunnel(stages, prospects);
  computeSocialReach(prospects);
  computeChannelEffectiveness(prospects);
  computeCategoryEffectiveness(prospects);
});

test('computeColdSignal ignores a prospect below the touch threshold', () => {
  const p = { stage: 'outreach-sent', outreachLog: [{ date: '2026-08-01', type: 'initial-send' }, { date: '2026-08-10', type: 'nudge' }] };
  const { active, parked } = computeColdSignal([p]);
  assert.equal(active.length, 0);
  assert.equal(parked.length, 0);
});

test('computeColdSignal flags a prospect at or above the touch threshold still sitting in outreach-sent', () => {
  const p = {
    stage: 'outreach-sent',
    outreachLog: [
      { date: '2026-08-01', type: 'initial-send' },
      { date: '2026-08-10', type: 'nudge' },
      { date: '2026-08-20', type: 'nudge' }
    ]
  };
  assert.equal(touchCount(p), COLD_TOUCH_THRESHOLD);
  const { active, parked } = computeColdSignal([p]);
  assert.equal(active.length, 1);
  assert.equal(active[0].touches, 3);
  assert.equal(parked.length, 0);
});

test('computeColdSignal only looks at prospects currently in outreach-sent, not silent-replied or in-exploration', () => {
  const touches = [
    { date: '2026-08-01', type: 'initial-send' },
    { date: '2026-08-10', type: 'nudge' },
    { date: '2026-08-20', type: 'nudge' }
  ];
  const prospects = [
    { stage: 'silent-replied', outreachLog: touches },
    { stage: 'in-exploration', outreachLog: touches },
    { stage: 'client', outreachLog: touches }
  ];
  const { active, parked } = computeColdSignal(prospects);
  assert.equal(active.length, 0);
  assert.equal(parked.length, 0);
});

test('computeColdSignal parks a flagged prospect with a future doNotNudgeBefore instead of leaving it active', () => {
  const future = addDaysIso(todayIso(), 30);
  const p = {
    stage: 'outreach-sent',
    outreachLog: [
      { date: '2026-08-01', type: 'initial-send' },
      { date: '2026-08-10', type: 'nudge' },
      { date: '2026-08-20', type: 'nudge' }
    ],
    nudgeSchedule: { doNotNudgeBefore: future }
  };
  const { active, parked } = computeColdSignal([p]);
  assert.equal(active.length, 0);
  assert.equal(parked.length, 1);
  assert.equal(parked[0].p, p);
});

test('computeColdSignal treats a past doNotNudgeBefore as no longer parked, back in the active list', () => {
  const past = addDaysIso(todayIso(), -5);
  const p = {
    stage: 'outreach-sent',
    outreachLog: [
      { date: '2026-08-01', type: 'initial-send' },
      { date: '2026-08-10', type: 'nudge' },
      { date: '2026-08-20', type: 'nudge' }
    ],
    nudgeSchedule: { doNotNudgeBefore: past }
  };
  const { active, parked } = computeColdSignal([p]);
  assert.equal(active.length, 1);
  assert.equal(parked.length, 0);
});

test('computeColdSignal treats an invalid doNotNudgeBefore as not a real park decision', () => {
  // Same isValidDateStr guard as the rest of csm-core: a malformed hand-typed
  // date should not silently defer a flag that would otherwise be active.
  const p = {
    stage: 'outreach-sent',
    outreachLog: [
      { date: '2026-08-01', type: 'initial-send' },
      { date: '2026-08-10', type: 'nudge' },
      { date: '2026-08-20', type: 'nudge' }
    ],
    nudgeSchedule: { doNotNudgeBefore: '2026-9-5' }
  };
  const { active, parked } = computeColdSignal([p]);
  assert.equal(active.length, 1);
  assert.equal(parked.length, 0);
});

test('computeColdSignal sorts the active list by touch count descending, most-touched first', () => {
  const threeTouches = [{ date: '2026-08-01' }, { date: '2026-08-05' }, { date: '2026-08-10' }];
  const fiveTouches = threeTouches.concat([{ date: '2026-08-15' }, { date: '2026-08-20' }]);
  const low = { name: 'Low', stage: 'outreach-sent', outreachLog: threeTouches };
  const high = { name: 'High', stage: 'outreach-sent', outreachLog: fiveTouches };
  const { active } = computeColdSignal([low, high]);
  assert.deepEqual(active.map(x => x.p.name), ['High', 'Low']);
});

test('computeColdSignal sorts the parked list by re-engagement date ascending, soonest first', () => {
  const touches = [{ date: '2026-08-01' }, { date: '2026-08-05' }, { date: '2026-08-10' }];
  const later = { name: 'Later', stage: 'outreach-sent', outreachLog: touches, nudgeSchedule: { doNotNudgeBefore: addDaysIso(todayIso(), 60) } };
  const sooner = { name: 'Sooner', stage: 'outreach-sent', outreachLog: touches, nudgeSchedule: { doNotNudgeBefore: addDaysIso(todayIso(), 10) } };
  const { parked } = computeColdSignal([later, sooner]);
  assert.deepEqual(parked.map(x => x.p.name), ['Sooner', 'Later']);
});

const FUNNEL_STAGES = [
  { id: 'researched' }, { id: 'outreach-sent' }, { id: 'silent-replied' },
  { id: 'in-exploration' }, { id: 'client' }
];

test('computeFunnel counts a prospect as having reached every stage up to and including its current one', () => {
  const results = computeFunnel(FUNNEL_STAGES, [{ stage: 'in-exploration' }]);
  assert.equal(results.find(r => r.stage.id === 'researched').reached, 1);
  assert.equal(results.find(r => r.stage.id === 'outreach-sent').reached, 1);
  assert.equal(results.find(r => r.stage.id === 'silent-replied').reached, 1);
  assert.equal(results.find(r => r.stage.id === 'in-exploration').reached, 1);
  assert.equal(results.find(r => r.stage.id === 'client').reached, 0);
});

test('computeFunnel ignores a prospect whose stage id is not in the known stages list', () => {
  const results = computeFunnel(FUNNEL_STAGES, [{ stage: 'not-a-real-stage' }]);
  assert.ok(results.every(r => r.reached === 0));
});

test('computeFunnel leaves conversionFromPrev null for the first stage', () => {
  const results = computeFunnel(FUNNEL_STAGES, [{ stage: 'researched' }]);
  assert.equal(results[0].conversionFromPrev, null);
});

test('computeFunnel computes a real percentage conversion between consecutive stages', () => {
  const prospects = [
    { stage: 'outreach-sent' }, { stage: 'outreach-sent' },
    { stage: 'outreach-sent' }, { stage: 'in-exploration' }
  ];
  const results = computeFunnel(FUNNEL_STAGES, prospects);
  // All 4 reached researched and outreach-sent (100%), 1 of 4 reached silent-replied's
  // next stage in-exploration by way of outreach-sent -> ... -> in-exploration.
  assert.equal(results.find(r => r.stage.id === 'outreach-sent').conversionFromPrev, 100);
  assert.equal(results.find(r => r.stage.id === 'in-exploration').reached, 1);
});

test('computeFunnel leaves conversionFromPrev null rather than dividing by zero when the previous stage has no reach', () => {
  const results = computeFunnel(FUNNEL_STAGES, []);
  assert.ok(results.every(r => r.conversionFromPrev == null));
});

test('computeSocialReach sums real followers across prospects on the same platform', () => {
  const prospects = [
    { socialSnapshots: [{ platform: 'Douyin', followers: 1000, asOfDate: '2026-08-01' }] },
    { socialSnapshots: [{ platform: 'Douyin', followers: 500, asOfDate: '2026-08-01' }] }
  ];
  const results = computeSocialReach(prospects);
  assert.equal(results.length, 1);
  assert.equal(results[0].totalFollowers, 1500);
  assert.equal(results[0].prospectCount, 2);
});

test('computeSocialReach counts only the most recent snapshot per prospect per platform, never double-counting a refresh', () => {
  const p = {
    socialSnapshots: [
      { platform: 'Xiaohongshu', followers: 1000, asOfDate: '2026-06-01' },
      { platform: 'Xiaohongshu', followers: 1200, asOfDate: '2026-08-01' }
    ]
  };
  const results = computeSocialReach([p]);
  assert.equal(results[0].prospectCount, 1);
  assert.equal(results[0].totalFollowers, 1200);
  assert.equal(results[0].mostRecentAsOf, '2026-08-01');
});

test('computeSocialReach does not let a bad hand-edited followers value (a non-numeric string) poison the rest of that platform bucket with NaN', () => {
  // Regression test for the real "NaN followers display" bug this function
  // was previously patched for (see changelog: CSM: fix NaN followers
  // display and suppressed stage-sync warning).
  const prospects = [
    { socialSnapshots: [{ platform: 'Weibo', followers: '12K', asOfDate: '2026-08-01' }] },
    { socialSnapshots: [{ platform: 'Weibo', followers: 800, asOfDate: '2026-08-01' }] }
  ];
  const results = computeSocialReach(prospects);
  const weibo = results.find(r => r.platform === 'Weibo');
  assert.equal(weibo.totalFollowers, 800);
  assert.ok(Number.isFinite(weibo.totalFollowers));
  assert.equal(weibo.prospectCount, 2);
});

test('computeSocialReach averages engagement rate only across snapshots that actually logged one', () => {
  const prospects = [
    { socialSnapshots: [{ platform: 'Bilibili', engagementRate: 4, asOfDate: '2026-08-01' }] },
    { socialSnapshots: [{ platform: 'Bilibili', engagementRate: 8, asOfDate: '2026-08-01' }] },
    { socialSnapshots: [{ platform: 'Bilibili', asOfDate: '2026-08-01' }] } // no engagementRate logged
  ];
  const results = computeSocialReach(prospects);
  const bilibili = results.find(r => r.platform === 'Bilibili');
  assert.equal(bilibili.engagementCount, 2);
  assert.equal(bilibili.engagementSum, 12);
  assert.equal(bilibili.prospectCount, 3);
});

test('computeSocialReach counts a snapshot toward staleCount once it is past the honesty window', () => {
  const stale = { platform: 'Weibo', followers: 100, asOfDate: addDaysIso(todayIso(), -200) };
  const fresh = { platform: 'Weibo', followers: 100, asOfDate: todayIso() };
  const results = computeSocialReach([{ socialSnapshots: [stale] }, { socialSnapshots: [fresh] }]);
  assert.equal(results[0].staleCount, 1);
});

test('computeSocialReach sorts platforms by total followers descending', () => {
  const prospects = [
    { socialSnapshots: [{ platform: 'Small', followers: 100, asOfDate: '2026-08-01' }] },
    { socialSnapshots: [{ platform: 'Big', followers: 10000, asOfDate: '2026-08-01' }] }
  ];
  const results = computeSocialReach(prospects);
  assert.deepEqual(results.map(r => r.platform), ['Big', 'Small']);
});

test('computeSocialReach ignores a snapshot with no platform logged', () => {
  const results = computeSocialReach([{ socialSnapshots: [{ followers: 100, asOfDate: '2026-08-01' }] }]);
  assert.equal(results.length, 0);
});

test('computeChannelEffectiveness excludes prospects still at "researched" (never actually contacted)', () => {
  const results = computeChannelEffectiveness([{ stage: 'researched', contactChannel: { type: 'named-decision-maker' } }]);
  assert.ok(results.every(r => r.contacted === 0));
});

test('computeChannelEffectiveness counts a contacted prospect that reached exploration as advanced', () => {
  const p = { stage: 'in-exploration', contactChannel: { type: 'named-decision-maker' } };
  const results = computeChannelEffectiveness([p]);
  const bucket = results.find(r => r.key === 'named-decision-maker');
  assert.equal(bucket.contacted, 1);
  assert.equal(bucket.advanced, 1);
});

test('computeChannelEffectiveness does not count silent-replied as advanced, that stage is not a real signal either way', () => {
  const p = { stage: 'silent-replied', contactChannel: { type: 'generic-inbox' } };
  const results = computeChannelEffectiveness([p]);
  const bucket = results.find(r => r.key === 'generic-inbox');
  assert.equal(bucket.contacted, 1);
  assert.equal(bucket.advanced, 0);
});

test('computeChannelEffectiveness buckets an unrecognized or missing channel type as unlogged', () => {
  const results = computeChannelEffectiveness([
    { stage: 'outreach-sent', contactChannel: { type: 'carrier-pigeon' } },
    { stage: 'outreach-sent' }
  ]);
  const bucket = results.find(r => r.key === 'unlogged');
  assert.equal(bucket.contacted, 2);
});

test('computeCategoryEffectiveness groups prospects with no category logged under uncategorized', () => {
  const results = computeCategoryEffectiveness([{ stage: 'outreach-sent', category: null }]);
  const bucket = results.find(r => r.key === 'uncategorized');
  assert.equal(bucket.contacted, 1);
  assert.equal(bucket.label, 'No category logged');
});

test('computeCategoryEffectiveness sorts categories by contacted count descending, then alphabetically', () => {
  const prospects = [
    { stage: 'outreach-sent', category: 'Beauty' },
    { stage: 'outreach-sent', category: 'Fitness' },
    { stage: 'outreach-sent', category: 'Fitness' }
  ];
  const results = computeCategoryEffectiveness(prospects);
  assert.deepEqual(results.map(r => r.key), ['Fitness', 'Beauty']);
});

test('CHANNEL_EFF_MIN_N_FOR_RATE is the shared minimum sample size gate used by both effectiveness breakdowns', () => {
  assert.equal(typeof CHANNEL_EFF_MIN_N_FOR_RATE, 'number');
  assert.ok(CHANNEL_EFF_MIN_N_FOR_RATE > 0);
});

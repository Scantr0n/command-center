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
  nudgeUrgencyLevel, computeNudgeRows, byUrgency, touchCount, daysSinceLastTouch, daysToFirstReply,
  todayIso, addDaysIso, suggestedNudgeOffsetDays, rollToWeekdayIso, beijingTimeInfo,
  reachedActiveExploration, computeStageVelocity, computeColdSignal, COLD_TOUCH_THRESHOLD,
  computeFunnel, computeSocialReach, computeChannelEffectiveness, computeCategoryEffectiveness,
  CHANNEL_EFF_MIN_N_FOR_RATE, computeStalled, hasNudgePlan, computeDataQualityFlags,
  escapeHtml, csvField, icsEscapeText, icsFoldLine, outreachReadinessWarnings, stageEntryCriteriaStatus,
  channelSortRank, listComparator, slugifyProspectId, nextAvailableId,
  findCategoryCasingClash, findProspectByNameCompany, findHookReuseMatch,
  missingContactChannelType, missingVerifiedHook, channelTypeLoggedWithNoDetail, missingFollowUpPlan,
  hasStaleNudgePlanAfterReply,
  emDashFields, emDashHits
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

test('beijingTimeInfo converts a UTC instant to China Standard Time (UTC+8, no DST)', () => {
  // 2026-09-22T01:30:00Z is a real Tuesday; +8h lands at 09:30 Beijing time,
  // still Tuesday.
  const info = beijingTimeInfo(new Date('2026-09-22T01:30:00Z'));
  assert.equal(info.hour, 9);
  assert.equal(info.minute, 30);
  assert.equal(info.weekdayName, 'Tuesday');
  assert.equal(info.isWeekday, true);
});

test('beijingTimeInfo flags a weekday mid-week morning as the prime reply window', () => {
  const info = beijingTimeInfo(new Date('2026-09-22T01:30:00Z')); // Tue 09:30 Beijing
  assert.equal(info.isBusinessHours, true);
  assert.equal(info.isPrimeReplyWindow, true);
});

test('beijingTimeInfo does not flag business hours or the prime window on a real weekend', () => {
  // 2026-09-25T20:00:00Z (Friday) +8h lands at 2026-09-26 04:00, a Saturday.
  const info = beijingTimeInfo(new Date('2026-09-25T20:00:00Z'));
  assert.equal(info.weekdayName, 'Saturday');
  assert.equal(info.isWeekday, false);
  assert.equal(info.isBusinessHours, false);
  assert.equal(info.isPrimeReplyWindow, false);
});

test('beijingTimeInfo treats a weekday evening as business-hours-over, outside the prime reply window', () => {
  // 2026-09-23T14:00:00Z +8h lands at 22:00 Beijing time, a Wednesday.
  const info = beijingTimeInfo(new Date('2026-09-23T14:00:00Z'));
  assert.equal(info.weekdayName, 'Wednesday');
  assert.equal(info.hour, 22);
  assert.equal(info.isWeekday, true);
  assert.equal(info.isBusinessHours, false);
  assert.equal(info.isPrimeReplyWindow, false);
});

test('beijingTimeInfo defaults to the real current instant when called with no argument', () => {
  const info = beijingTimeInfo();
  assert.ok(info.hour >= 0 && info.hour <= 23);
  assert.ok(info.dayOfWeek >= 0 && info.dayOfWeek <= 6);
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

test('daysToFirstReply is null with no outbound touch, no reply touch, or neither', () => {
  assert.equal(daysToFirstReply({}), null);
  assert.equal(daysToFirstReply({ outreachLog: [{ date: '2026-09-01', type: 'initial-send' }] }), null);
  assert.equal(daysToFirstReply({ outreachLog: [{ date: '2026-09-01', type: 'reply' }] }), null);
});

test('daysToFirstReply is the gap from the first outbound touch to the first reply', () => {
  const p = {
    outreachLog: [
      { date: '2026-09-01', type: 'initial-send' },
      { date: '2026-09-08', type: 'nudge' },
      { date: '2026-09-10', type: 'reply' }
    ]
  };
  assert.equal(daysToFirstReply(p), 9);
});

test('daysToFirstReply falls back to the earliest nudge when no initial-send was logged', () => {
  const p = {
    outreachLog: [
      { date: '2026-09-05', type: 'nudge' },
      { date: '2026-09-07', type: 'reply' }
    ]
  };
  assert.equal(daysToFirstReply(p), 2);
});

test('daysToFirstReply is null, not negative, when a reply predates every outbound touch', () => {
  const p = {
    outreachLog: [
      { date: '2026-09-10', type: 'initial-send' },
      { date: '2026-09-05', type: 'reply' } // bad data, reply before the outbound touch
    ]
  };
  assert.equal(daysToFirstReply(p), null);
});

test('daysToFirstReply skips entries with an invalid date, never NaN', () => {
  const p = {
    outreachLog: [
      { date: '2026-9-1', type: 'initial-send' }, // non-zero-padded, invalid
      { date: '2026-09-10', type: 'reply' }
    ]
  };
  assert.equal(daysToFirstReply(p), null);
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
    outreachReadinessWarnings(p);
  });
  computeStageVelocity(stages, prospects);
  computeColdSignal(prospects);
  computeFunnel(stages, prospects);
  computeSocialReach(prospects);
  computeChannelEffectiveness(prospects);
  computeCategoryEffectiveness(prospects);
  computeStalled(stages, prospects);
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

const STALL_STAGES = [{ id: 'outreach-sent', staleAfterDays: 10 }, { id: 'in-exploration', staleAfterDays: 30 }];

test('computeStalled flags a prospect past its stage staleAfterDays threshold', () => {
  const p = { name: 'Past due', stage: 'outreach-sent', stageEnteredDate: addDaysIso(todayIso(), -15) };
  const results = computeStalled(STALL_STAGES, [p]);
  assert.equal(results.length, 1);
  assert.equal(results[0].p, p);
  assert.equal(results[0].info.isStale, true);
});

test('computeStalled leaves out a prospect still within its stage threshold', () => {
  const p = { stage: 'outreach-sent', stageEnteredDate: addDaysIso(todayIso(), -2) };
  assert.equal(computeStalled(STALL_STAGES, [p]).length, 0);
});

test('computeStalled leaves out a prospect with no stageEnteredDate logged, rather than treating it as stale', () => {
  const p = { stage: 'outreach-sent', stageEnteredDate: null };
  assert.equal(computeStalled(STALL_STAGES, [p]).length, 0);
});

test('computeStalled sorts worst (longest stalled) first', () => {
  const barely = { name: 'Barely', stage: 'outreach-sent', stageEnteredDate: addDaysIso(todayIso(), -11) };
  const way = { name: 'Way over', stage: 'outreach-sent', stageEnteredDate: addDaysIso(todayIso(), -40) };
  const results = computeStalled(STALL_STAGES, [barely, way]);
  assert.deepEqual(results.map(r => r.p.name), ['Way over', 'Barely']);
});

test('hasNudgePlan is true from a queued nextNudgeDate alone', () => {
  assert.equal(hasNudgePlan({ nextNudgeDate: '2026-10-01' }), true);
});

test('hasNudgePlan is true from a planned nudgeSchedule.nudgePoint alone', () => {
  assert.equal(hasNudgePlan({ nudgeSchedule: { nudgePoint: '2026-10-01' } }), true);
});

test('hasNudgePlan is true from a deliberate doNotNudgeBefore park date alone', () => {
  assert.equal(hasNudgePlan({ nudgeSchedule: { doNotNudgeBefore: '2026-12-01' } }), true);
});

test('hasNudgePlan is false with no nudge fields logged at all', () => {
  assert.equal(hasNudgePlan({}), false);
  assert.equal(hasNudgePlan({ nudgeSchedule: {} }), false);
});

test('hasNudgePlan treats an invalid hand-typed date as not a real plan', () => {
  assert.equal(hasNudgePlan({ nextNudgeDate: '2026-9-5' }), false);
  assert.equal(hasNudgePlan({ nudgeSchedule: { nudgePoint: '2026-9-5' } }), false);
  assert.equal(hasNudgePlan({ nudgeSchedule: { doNotNudgeBefore: '2026-9-5' } }), false);
});

test('escapeHtml leaves an ordinary value untouched', () => {
  assert.equal(escapeHtml('City Bound'), 'City Bound');
});

test('escapeHtml returns an empty string for null/undefined, never the literal "null"', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
});

test('escapeHtml neutralizes a script tag rather than letting it render as live markup', () => {
  // Real XSS guard (OWASP): this page renders hand-editable JSON field
  // values straight into innerHTML, so a prospect name or note containing
  // "<script>" has to come out as inert text.
  assert.equal(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
});

test('escapeHtml neutralizes an attribute-breakout attempt', () => {
  assert.equal(
    escapeHtml('"><img src=x onerror=alert(1)>'),
    '&quot;&gt;&lt;img src=x onerror=alert(1)&gt;'
  );
});

test('escapeHtml escapes each of the five reserved characters', () => {
  assert.equal(escapeHtml('& < > " \''), '&amp; &lt; &gt; &quot; &#39;');
});

test('csvField leaves an ordinary value untouched', () => {
  assert.equal(csvField('City Bound'), 'City Bound');
});

test('csvField returns an empty string for null/undefined, never the literal "null"', () => {
  assert.equal(csvField(null), '');
  assert.equal(csvField(undefined), '');
});

test('csvField quotes a value containing a comma, quote, or newline, doubling embedded quotes', () => {
  assert.equal(csvField('Fraga, David'), '"Fraga, David"');
  assert.equal(csvField('say "hi"'), '"say ""hi"""');
  assert.equal(csvField('line1\nline2'), '"line1\nline2"');
});

test('csvField prefixes a leading single quote onto a value that would otherwise be read as a live formula', () => {
  // Real CSV/formula injection mitigation (OWASP): Excel/Sheets treats a
  // cell starting with =, +, -, @, tab, or CR as a formula to execute, not
  // plain text, when a hand-typed note or name happens to start with one.
  assert.equal(csvField('=cmd|/c calc'), "'=cmd|/c calc");
  assert.equal(csvField('+1234'), "'+1234");
  assert.equal(csvField('-1234'), "'-1234");
  assert.equal(csvField('@mention'), "'@mention");
});

test('csvField does not prefix a value that merely contains one of the formula characters mid-string', () => {
  assert.equal(csvField('reply@company.com'), 'reply@company.com');
});

test('icsEscapeText backslash-escapes backslash, semicolon, comma, and newline per RFC 5545', () => {
  assert.equal(icsEscapeText('a\\b;c,d\ne'), 'a\\\\b\\;c\\,d\\ne');
});

test('icsEscapeText returns an empty string for null/undefined', () => {
  assert.equal(icsEscapeText(null), '');
  assert.equal(icsEscapeText(undefined), '');
});

test('icsFoldLine leaves a short line (under 75 octets) unfolded', () => {
  const line = 'SUMMARY:Short line';
  assert.equal(icsFoldLine(line), line);
});

test('icsFoldLine folds a long ASCII line at 75 octets with a CRLF + single-space continuation', () => {
  const line = 'DESCRIPTION:' + 'x'.repeat(100);
  const folded = icsFoldLine(line);
  const parts = folded.split('\r\n');
  assert.ok(parts.length > 1);
  parts.forEach((part, i) => {
    const bytes = Buffer.byteLength(i === 0 ? part : part.slice(1), 'utf8');
    assert.ok(bytes <= 75, 'segment ' + i + ' is ' + bytes + ' octets');
  });
  assert.ok(parts.slice(1).every(p => p.startsWith(' ')));
});

test('icsFoldLine never splits a multi-byte UTF-8 character across a fold boundary', () => {
  // Real prospect names/notes for Chinese social platforms are the exact
  // case this guards: counting UTF-16 code units instead of UTF-8 bytes
  // here would cut a non-ASCII character in half mid-fold, and each 3-byte
  // CJK character straddling a naive 75-unit cut is exactly how that would
  // show up. Rejoining every fragment must reproduce the original line
  // exactly, and every fragment must stay within the real 75-octet budget.
  const line = 'SUMMARY:' + '中文名字'.repeat(20); // repeated CJK text, well past 75 octets
  const folded = icsFoldLine(line);
  const parts = folded.split('\r\n');
  assert.ok(parts.length > 1);
  const rejoined = parts.map((p, i) => (i === 0 ? p : p.slice(1))).join('');
  assert.equal(rejoined, line);
  parts.forEach((part, i) => {
    const bytes = Buffer.byteLength(i === 0 ? part : part.slice(1), 'utf8');
    assert.ok(bytes <= 75, 'segment ' + i + ' is ' + bytes + ' octets');
  });
});

test('outreachReadinessWarnings flags both a missing verifiedHook and a missing contact channel type', () => {
  const warnings = outreachReadinessWarnings({});
  assert.equal(warnings.length, 2);
});

test('outreachReadinessWarnings has nothing to say once both real fields are logged', () => {
  const p = { verifiedHook: 'Runs a real expat community brand', contactChannel: { type: 'named-decision-maker' } };
  assert.deepEqual(outreachReadinessWarnings(p), []);
});

test('outreachReadinessWarnings still flags a missing channel type when contactChannel exists but has no type', () => {
  const p = { verifiedHook: 'Real hook', contactChannel: { detail: 'someone@example.com' } };
  const warnings = outreachReadinessWarnings(p);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /contactChannel\.type/);
});

test('stageEntryCriteriaStatus returns an empty list for a stage with no entryCriteria', () => {
  assert.deepEqual(stageEntryCriteriaStatus({}, { entryCriteria: [] }), []);
  assert.deepEqual(stageEntryCriteriaStatus({}, {}), []);
});

test('stageEntryCriteriaStatus marks a criterion unmet when the real field is missing', () => {
  const stage = { entryCriteria: [{ id: 'verified-hook', label: 'verifiedHook logged' }] };
  const status = stageEntryCriteriaStatus({}, stage);
  assert.equal(status.length, 1);
  assert.equal(status[0].met, false);
  assert.equal(status[0].label, 'verifiedHook logged');
});

test('stageEntryCriteriaStatus marks a criterion met once the real field is logged', () => {
  const stage = { entryCriteria: [{ id: 'verified-hook', label: 'verifiedHook logged' }] };
  const status = stageEntryCriteriaStatus({ verifiedHook: 'Real, checked reason' }, stage);
  assert.equal(status[0].met, true);
});

test('stageEntryCriteriaStatus checks contact-channel against contactChannel.type, not just the object existing', () => {
  const stage = { entryCriteria: [{ id: 'contact-channel', label: 'contactChannel.type logged' }] };
  assert.equal(stageEntryCriteriaStatus({ contactChannel: { detail: 'x@example.com' } }, stage)[0].met, false);
  assert.equal(stageEntryCriteriaStatus({ contactChannel: { type: 'generic-inbox' } }, stage)[0].met, true);
});

test('stageEntryCriteriaStatus checks send-logged against either sendDate or a real outreachLog entry', () => {
  const stage = { entryCriteria: [{ id: 'send-logged', label: 'A real send is logged' }] };
  assert.equal(stageEntryCriteriaStatus({}, stage)[0].met, false);
  assert.equal(stageEntryCriteriaStatus({ sendDate: '2026-09-01' }, stage)[0].met, true);
  assert.equal(stageEntryCriteriaStatus({ outreachLog: [{ date: '2026-09-01', type: 'initial-send' }] }, stage)[0].met, true);
  assert.equal(stageEntryCriteriaStatus({ outreachLog: [] }, stage)[0].met, false);
});

test('stageEntryCriteriaStatus checks reply-logged against a real replyStatus', () => {
  const stage = { entryCriteria: [{ id: 'reply-logged', label: 'replyStatus logged' }] };
  assert.equal(stageEntryCriteriaStatus({}, stage)[0].met, false);
  assert.equal(stageEntryCriteriaStatus({ replyStatus: 'Real ongoing conversation.' }, stage)[0].met, true);
});

test('stageEntryCriteriaStatus reads an unknown criterion id as unmet instead of throwing', () => {
  const stage = { entryCriteria: [{ id: 'not-a-real-checker', label: 'Something not wired up yet' }] };
  const status = stageEntryCriteriaStatus({ anything: true }, stage);
  assert.equal(status[0].met, false);
});

test('the real stages.json entryCriteria ids on disk all resolve to a real checker (no typo left unwired)', () => {
  const stagesData = JSON.parse(fs.readFileSync(path.join(__dirname, 'stages.json'), 'utf8'));
  const KNOWN_IDS = ['verified-hook', 'contact-channel', 'send-logged', 'reply-logged'];
  (stagesData.stages || []).forEach(stage => {
    (stage.entryCriteria || []).forEach(c => {
      assert.ok(KNOWN_IDS.includes(c.id), stage.id + ' entryCriteria has unknown id "' + c.id + '"');
    });
  });
});

test('channelSortRank ranks a named decision-maker ahead of a generic inbox, ahead of no channel logged', () => {
  assert.equal(channelSortRank({ type: 'named-decision-maker' }), 0);
  assert.equal(channelSortRank({ type: 'generic-inbox' }), 1);
  assert.equal(channelSortRank({ type: 'something-else' }), 2);
  assert.equal(channelSortRank(null), 2);
  assert.equal(channelSortRank(undefined), 2);
});

const listStageById = {
  'in-exploration': { id: 'in-exploration', staleAfterDays: 30 },
  client: { id: 'client', staleAfterDays: null }
};
const listStageOrderIndex = { 'in-exploration': 0, negotiating: 1, client: 2 };

test('listComparator sorts by name ascending/descending, case-insensitively', () => {
  const rows = [{ name: 'charlie' }, { name: 'Alice' }, { name: 'bob' }];
  const asc = rows.slice().sort(listComparator('name', 'asc', listStageById, listStageOrderIndex));
  assert.deepEqual(asc.map(r => r.name), ['Alice', 'bob', 'charlie']);
  const desc = rows.slice().sort(listComparator('name', 'desc', listStageById, listStageOrderIndex));
  assert.deepEqual(desc.map(r => r.name), ['charlie', 'bob', 'Alice']);
});

test('listComparator by stage sorts unrecognized stage ids last (999), never first or crashing', () => {
  const rows = [
    { name: 'z', stage: 'unknown-stage-id' },
    { name: 'a', stage: 'client' },
    { name: 'm', stage: 'in-exploration' }
  ];
  const sorted = rows.slice().sort(listComparator('stage', 'asc', listStageById, listStageOrderIndex));
  assert.deepEqual(sorted.map(r => r.name), ['m', 'a', 'z']);
});

test('listComparator by nextNudge treats no nudge date logged as the real worst case, sorting it last', () => {
  const rows = [
    { name: 'no-plan' },
    { name: 'due-soon', nextNudgeDate: '2026-01-01' },
    { name: 'due-later', nextNudgeDate: '2026-06-01' }
  ];
  const sorted = rows.slice().sort(listComparator('nextNudge', 'asc', listStageById, listStageOrderIndex));
  assert.deepEqual(sorted.map(r => r.name), ['due-soon', 'due-later', 'no-plan']);
});

test('listComparator by channel ranks a named decision-maker ahead of a generic inbox, ahead of none logged', () => {
  const rows = [
    { name: 'none' },
    { name: 'generic', contactChannel: { type: 'generic-inbox' } },
    { name: 'named', contactChannel: { type: 'named-decision-maker' } }
  ];
  const sorted = rows.slice().sort(listComparator('channel', 'asc', listStageById, listStageOrderIndex));
  assert.deepEqual(sorted.map(r => r.name), ['named', 'generic', 'none']);
});

test('listComparator by stalled sorts a non-stalled/no-stage-data prospect (-1) below every real stalled day count', () => {
  const rows = [
    { name: 'no-stage-data', stage: 'client' }, // staleAfterDays null -> stallInfo null -> -1
    { name: 'stalled-a-lot', stage: 'in-exploration', stageEnteredDate: addDaysIso(todayIso(), -60) },
    { name: 'stalled-a-little', stage: 'in-exploration', stageEnteredDate: addDaysIso(todayIso(), -35) }
  ];
  const sorted = rows.slice().sort(listComparator('stalled', 'desc', listStageById, listStageOrderIndex));
  assert.deepEqual(sorted.map(r => r.name), ['stalled-a-lot', 'stalled-a-little', 'no-stage-data']);
});

test('listComparator by lastTouch sorts a prospect with no real touches (-1) below one with a real touch, even a very old one', () => {
  const rows = [
    { name: 'never-touched', outreachLog: [] },
    { name: 'touched-long-ago', outreachLog: [{ date: addDaysIso(todayIso(), -200) }] }
  ];
  const sorted = rows.slice().sort(listComparator('lastTouch', 'desc', listStageById, listStageOrderIndex));
  assert.deepEqual(sorted.map(r => r.name), ['touched-long-ago', 'never-touched']);
});

test('listComparator by touches counts only real valid-date outreachLog entries', () => {
  const rows = [
    { name: 'few', outreachLog: [{ date: '2026-01-01' }] },
    { name: 'many', outreachLog: [{ date: '2026-01-01' }, { date: '2026-02-01' }, { date: 'not-a-date' }] }
  ];
  const sorted = rows.slice().sort(listComparator('touches', 'desc', listStageById, listStageOrderIndex));
  assert.deepEqual(sorted.map(r => r.name), ['many', 'few'], 'many has 2 real touches (the malformed date is not counted), few has 1');
});

test('listComparator ties break by real name, never leaving equal rows in an arbitrary order', () => {
  const rows = [
    { name: 'zeta', category: 'beauty' },
    { name: 'alpha', category: 'beauty' }
  ];
  const sorted = rows.slice().sort(listComparator('category', 'asc', listStageById, listStageOrderIndex));
  assert.deepEqual(sorted.map(r => r.name), ['alpha', 'zeta'], 'same category, so the tie-break falls to name');
});

test('listComparator falls back to name sort for an unrecognized key, the same as the explicit default case', () => {
  const rows = [{ name: 'charlie' }, { name: 'alice' }];
  const sorted = rows.slice().sort(listComparator('not-a-real-key', 'asc', listStageById, listStageOrderIndex));
  assert.deepEqual(sorted.map(r => r.name), ['alice', 'charlie']);
});

test('computeDataQualityFlags has nothing to say about a researched prospect missing channel/hook, since neither is expected pre-outreach', () => {
  const p = { stage: 'researched', name: 'a' };
  assert.deepEqual(computeDataQualityFlags([], [p]), []);
});

test('computeDataQualityFlags flags a past-outreach prospect missing both contact channel type and verified hook', () => {
  const p = { stage: 'in-exploration', name: 'a' };
  const flagged = computeDataQualityFlags([], [p]);
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].p, p);
  assert.ok(flagged[0].reasons.includes('NO CONTACT CHANNEL TYPE LOGGED'));
  assert.ok(flagged[0].reasons.includes('NO VERIFIED HOOK LOGGED'));
});

test('computeDataQualityFlags flags a contact channel type logged with no contact detail', () => {
  const p = { stage: 'in-exploration', verifiedHook: 'real hook', contactChannel: { type: 'named-decision-maker', detail: null } };
  const flagged = computeDataQualityFlags([], [p]);
  assert.deepEqual(flagged[0].reasons, ['CONTACT CHANNEL TYPE LOGGED BUT NO CONTACT DETAIL']);
});

test('computeDataQualityFlags flags an already-contacted prospect with no follow-up scheduled, and clears once one is', () => {
  const base = { stage: 'outreach-sent', verifiedHook: 'real hook', contactChannel: { type: 'named-decision-maker', detail: 'someone@example.com' } };
  const noPlan = computeDataQualityFlags([], [base]);
  assert.equal(noPlan.length, 1);
  assert.ok(noPlan[0].reasons.includes('NO FOLLOW-UP SCHEDULED, ALREADY CONTACTED WITH NOTHING PLANNED NEXT'));
  const withPlan = Object.assign({}, base, { nextNudgeDate: addDaysIso(todayIso(), 3) });
  assert.deepEqual(computeDataQualityFlags([], [withPlan]), []);
});

test('computeDataQualityFlags surfaces a stale social snapshot with its day count and uppercased platform', () => {
  const p = {
    stage: 'researched',
    socialSnapshots: [{ platform: 'Douyin', followers: 1000, asOfDate: addDaysIso(todayIso(), -95) }]
  };
  const flagged = computeDataQualityFlags([], [p]);
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].reasons[0], '95D OLD DOUYIN SNAPSHOT, DUE FOR REFRESH');
});

test('computeDataQualityFlags catches out-of-order stage history and outreach log dates', () => {
  const p = {
    stage: 'researched',
    stageHistory: [{ date: '2026-02-01' }, { date: '2026-9-5' }],
    outreachLog: [{ date: '2026-02-01' }, { date: '2026-9-5' }]
  };
  const flagged = computeDataQualityFlags([], [p]);
  assert.ok(flagged[0].reasons.includes('STAGE HISTORY DATES OUT OF ORDER, CHECK FORMATTING'));
  assert.ok(flagged[0].reasons.includes('OUTREACH LOG DATES OUT OF ORDER, CHECK FORMATTING'));
});

test('computeDataQualityFlags catches a malformed nextNudgeDate', () => {
  const p = { stage: 'researched', nextNudgeDate: '2026-9-5' };
  const flagged = computeDataQualityFlags([], [p]);
  assert.deepEqual(flagged[0].reasons, ['NEXT NUDGE DATE IS NOT A VALID DATE, CHECK FORMATTING']);
});

const EM_DASH = String.fromCharCode(8212);

test('emDashFields only reports the fields that actually contain an em dash', () => {
  assert.deepEqual(emDashFields({ name: 'Jane' + EM_DASH + 'Doe', company: 'Real Co' }, ['name', 'company']), ['name']);
  assert.deepEqual(emDashFields({ name: 'Jane Doe' }, ['name']), []);
  assert.deepEqual(emDashFields(null, ['name']), []);
});

test('emDashHits checks the top-level fields, contactChannel.detail, and every outreachLog/contentIdeas entry', () => {
  assert.deepEqual(emDashHits({ name: 'Jane' + EM_DASH + 'Doe' }), ['name']);
  assert.deepEqual(emDashHits({ name: 'Jane Doe', contactChannel: { detail: 'via' + EM_DASH + 'form' } }), ['contactChannel.detail']);
  assert.deepEqual(
    emDashHits({ name: 'Jane Doe', outreachLog: [{ note: 'clean' }, { note: 'follow up' + EM_DASH + 'soon' }] }),
    ['outreachLog[1].note']
  );
  assert.deepEqual(
    emDashHits({ name: 'Jane Doe', contentIdeas: [{ idea: 'idea' + EM_DASH + 'one' }] }),
    ['contentIdeas[0].idea']
  );
  assert.deepEqual(emDashHits({ name: 'Jane Doe' }), []);
});

test('computeDataQualityFlags flags a pasted-in em dash and names the field it is in', () => {
  const p = { stage: 'researched', name: 'Jane Doe', nextAction: 'Call them' + EM_DASH + 'soon' };
  const flagged = computeDataQualityFlags([], [p]);
  assert.deepEqual(flagged[0].reasons, ['EM DASH IN NEXTACTION, CHECK FOR A PASTE-IN']);
});

test('slugifyProspectId builds a real, readable id from a real name and company', () => {
  const result = slugifyProspectId('David Fraga', 'City Bound');
  assert.deepEqual(result, { id: 'city-bound-david-fraga', collapsedFromRealInput: false });
});

test('slugifyProspectId works from a name alone, no company', () => {
  const result = slugifyProspectId('Jane Doe', null);
  assert.deepEqual(result, { id: 'jane-doe', collapsedFromRealInput: false });
});

test('slugifyProspectId strips punctuation and collapses runs of it to one hyphen', () => {
  const result = slugifyProspectId("O'Brien & Co.!!", null);
  assert.equal(result.id, 'o-brien-co');
});

test('slugifyProspectId falls back to "new-prospect" and flags it for a Chinese-only name with no [a-z0-9] characters', () => {
  const result = slugifyProspectId('张伟', null);
  assert.deepEqual(result, { id: 'new-prospect', collapsedFromRealInput: true });
});

test('slugifyProspectId falls back to "new-prospect" without flagging it when there was no real input at all', () => {
  const result = slugifyProspectId(null, null);
  assert.deepEqual(result, { id: 'new-prospect', collapsedFromRealInput: false });
});

test('nextAvailableId returns the base id unchanged when nothing collides', () => {
  const result = nextAvailableId('city-bound-david-fraga', ['some-other-id']);
  assert.deepEqual(result, { id: 'city-bound-david-fraga', isDuplicateId: false });
});

test('nextAvailableId suffixes -2 on a real exact collision', () => {
  const result = nextAvailableId('jane-doe', ['jane-doe']);
  assert.deepEqual(result, { id: 'jane-doe-2', isDuplicateId: true });
});

test('nextAvailableId keeps counting up past an already-taken -2', () => {
  const result = nextAvailableId('jane-doe', ['jane-doe', 'jane-doe-2']);
  assert.deepEqual(result, { id: 'jane-doe-3', isDuplicateId: true });
});

test('nextAvailableId accepts a Set the same way it accepts a plain array', () => {
  const result = nextAvailableId('jane-doe', new Set(['jane-doe']));
  assert.deepEqual(result, { id: 'jane-doe-2', isDuplicateId: true });
});

test('nextAvailableId lets a batch of same-named rows each get their own suffix by growing the same Set as it goes, the real quick-add-paste use case', () => {
  const seen = new Set(['jane-doe']);
  const first = nextAvailableId('jane-doe', seen);
  seen.add(first.id);
  const second = nextAvailableId('jane-doe', seen);
  seen.add(second.id);
  assert.equal(first.id, 'jane-doe-2');
  assert.equal(second.id, 'jane-doe-3');
});

test('findCategoryCasingClash finds a differently-cased existing category', () => {
  const existing = [{ category: 'Lifestyle' }, { category: 'Fitness' }];
  assert.equal(findCategoryCasingClash('lifestyle', existing), 'Lifestyle');
});

test('findCategoryCasingClash returns null for the exact same spelling already in use', () => {
  const existing = [{ category: 'Lifestyle' }];
  assert.equal(findCategoryCasingClash('Lifestyle', existing), null);
});

test('findCategoryCasingClash returns null for a genuinely new category and for no category at all', () => {
  const existing = [{ category: 'Lifestyle' }];
  assert.equal(findCategoryCasingClash('Travel', existing), null);
  assert.equal(findCategoryCasingClash(null, existing), null);
});

test('findProspectByNameCompany matches case/whitespace-insensitively on name and company', () => {
  const existing = [{ id: 'city-bound-david-fraga', name: 'David Fraga', company: 'City Bound' }];
  const match = findProspectByNameCompany('  david fraga ', 'CITY BOUND', existing);
  assert.equal(match.id, 'city-bound-david-fraga');
});

test('findProspectByNameCompany returns null when nothing real matches, or when there is no name to match on', () => {
  const existing = [{ id: 'city-bound-david-fraga', name: 'David Fraga', company: 'City Bound' }];
  assert.equal(findProspectByNameCompany('David Fraga', 'A Different Company', existing), null);
  assert.equal(findProspectByNameCompany(null, null, existing), null);
});

test('findHookReuseMatch flags a hook already logged on a different prospect, case/whitespace-insensitively', () => {
  const existing = [{ id: 'a', verifiedHook: 'Runs a Douyin fitness account with real engagement.' }];
  const match = findHookReuseMatch('  RUNS A DOUYIN FITNESS ACCOUNT WITH REAL ENGAGEMENT.  ', existing);
  assert.equal(match.id, 'a');
});

test('findHookReuseMatch returns null for a genuinely distinct hook, or when there is no hook to match on', () => {
  const existing = [{ id: 'a', verifiedHook: 'Real hook for prospect A.' }];
  assert.equal(findHookReuseMatch('Real hook for prospect B.', existing), null);
  assert.equal(findHookReuseMatch(null, existing), null);
  assert.equal(findHookReuseMatch('Real hook for prospect A.', [{ id: 'b', verifiedHook: null }]), null);
});

test('missingContactChannelType is false while still researched, true once past it with nothing logged', () => {
  assert.equal(missingContactChannelType({ stage: 'researched' }), false);
  assert.equal(missingContactChannelType({ stage: 'in-exploration' }), true);
  assert.equal(missingContactChannelType({ stage: 'in-exploration', contactChannel: { type: 'generic-inbox' } }), false);
});

test('missingVerifiedHook is false while still researched, true once past it with no hook logged', () => {
  assert.equal(missingVerifiedHook({ stage: 'researched' }), false);
  assert.equal(missingVerifiedHook({ stage: 'in-exploration' }), true);
  assert.equal(missingVerifiedHook({ stage: 'in-exploration', verifiedHook: 'Real hook' }), false);
});

test('channelTypeLoggedWithNoDetail only fires once a type is logged with no way to actually reach them', () => {
  assert.equal(channelTypeLoggedWithNoDetail({}), false);
  assert.equal(channelTypeLoggedWithNoDetail({ contactChannel: { type: 'named-decision-maker', detail: 'a@b.com' } }), false);
  assert.equal(channelTypeLoggedWithNoDetail({ contactChannel: { type: 'named-decision-maker', detail: null } }), true);
});

test('missingFollowUpPlan only fires once contacted with nothing scheduled, and clears once something is', () => {
  assert.equal(missingFollowUpPlan({ stage: 'researched' }), false);
  assert.equal(missingFollowUpPlan({ stage: 'outreach-sent' }), true);
  assert.equal(missingFollowUpPlan({ stage: 'silent-replied' }), true);
  assert.equal(missingFollowUpPlan({ stage: 'outreach-sent', nextNudgeDate: addDaysIso(todayIso(), 3) }), false);
});

test('hasStaleNudgePlanAfterReply is false with no nextNudgeDate, no outreachLog, or the reply not being the latest touch', () => {
  assert.equal(hasStaleNudgePlanAfterReply({}), false);
  assert.equal(hasStaleNudgePlanAfterReply({ nextNudgeDate: '2026-10-01' }), false);
  assert.equal(hasStaleNudgePlanAfterReply({
    nextNudgeDate: '2026-10-01',
    outreachLog: [{ date: '2026-09-01', type: 'reply' }, { date: '2026-09-08', type: 'nudge' }]
  }), false);
});

test('hasStaleNudgePlanAfterReply fires once a queued nextNudgeDate is set but the most recent real touch is a reply', () => {
  assert.equal(hasStaleNudgePlanAfterReply({
    nextNudgeDate: '2026-10-01',
    outreachLog: [{ date: '2026-09-01', type: 'initial-send' }, { date: '2026-09-08', type: 'reply' }]
  }), true);
});

test('hasStaleNudgePlanAfterReply ignores an invalid nextNudgeDate rather than throwing', () => {
  assert.equal(hasStaleNudgePlanAfterReply({
    nextNudgeDate: '2026-13-40',
    outreachLog: [{ date: '2026-09-08', type: 'reply' }]
  }), false);
});

test('computeDataQualityFlags filters out every prospect with nothing wrong', () => {
  const clean = { stage: 'client', name: 'clean', verifiedHook: 'x', contactChannel: { type: 'named-decision-maker', detail: 'x' } };
  assert.deepEqual(computeDataQualityFlags([], [clean]), []);
});

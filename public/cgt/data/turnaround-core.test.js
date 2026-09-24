#!/usr/bin/env node
/*
 * Regression tests for turnaround-core.js: the published per-tier
 * turnaround table, its tier-name matching, the real-history average, and
 * the date math that turns either into a projected return date for the
 * on-page "est. back ~" label and the exported .ics reminder. No test
 * framework or dependency: node:test and node:assert ship with Node itself,
 * matching this repo's own no-extra-dependency convention (see
 * public/sondrik/data/*.test.js for the same pattern).
 *
 * Usage: node --test public/cgt/data/turnaround-core.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isPsaPausedValueTier, publishedTurnaroundDays, businessDaysToCalendarDays,
  addDaysIso, daysSince, computeTurnaroundDays, buildTurnaroundByGrader,
  estimatedReturnFor, PSA_VALUE_TIERS_PAUSED
} = require('./turnaround-core.js');

test('publishedTurnaroundDays matches an exact tier name before falling back to substring matching', () => {
  // "express" and "value" are each a real shorter tier name that "super
  // express"/"value max" etc. also contain -- an exact match must win so
  // the shorter, more common tier never silently gets the longer tier's
  // number.
  assert.equal(publishedTurnaroundDays('PSA', 'Express'), 25);
  assert.equal(publishedTurnaroundDays('PSA', 'Super Express'), 13);
  assert.equal(publishedTurnaroundDays('PSA', 'Value'), 110);
  assert.equal(publishedTurnaroundDays('PSA', 'Value Max'), 45);
});

test('publishedTurnaroundDays falls back to the company default for an unrecognized tier or no tier at all', () => {
  assert.equal(publishedTurnaroundDays('PSA', 'Some Made-Up Tier'), 43);
  assert.equal(publishedTurnaroundDays('PSA', null), 43);
  assert.equal(publishedTurnaroundDays('PSA', ''), 43);
});

test('publishedTurnaroundDays returns null for an unknown grading company', () => {
  assert.equal(publishedTurnaroundDays('HGA', 'Regular'), null);
  assert.equal(publishedTurnaroundDays(null, 'Regular'), null);
});

test('publishedTurnaroundDays keeps BGS and SGC numbers distinct (regression for the real BGS-vs-SGC turnaround mixup)', () => {
  assert.equal(publishedTurnaroundDays('BGS', 'Standard'), 45);
  assert.equal(publishedTurnaroundDays('SGC', 'Standard'), 58);
  assert.notEqual(publishedTurnaroundDays('BGS', 'Standard'), publishedTurnaroundDays('SGC', 'Standard'));
});

test('isPsaPausedValueTier flags all four paused PSA Value tiers, in either old or new naming', () => {
  assert.equal(PSA_VALUE_TIERS_PAUSED, true, 'flip this in turnaround-core.js once PSA reopens Value tiers, not here');
  assert.equal(isPsaPausedValueTier('PSA', 'Value'), true);
  assert.equal(isPsaPausedValueTier('PSA', 'Value Plus'), true);
  assert.equal(isPsaPausedValueTier('PSA', 'Value Max'), true);
  assert.equal(isPsaPausedValueTier('PSA', 'Value Bulk'), true);
});

test('isPsaPausedValueTier does not flag an open PSA tier or a non-PSA grader', () => {
  assert.equal(isPsaPausedValueTier('PSA', 'Priority'), false);
  assert.equal(isPsaPausedValueTier('PSA', null), false);
  assert.equal(isPsaPausedValueTier('BGS', 'Value'), false);
});

test('businessDaysToCalendarDays applies the documented 1.4x weekend factor', () => {
  assert.equal(businessDaysToCalendarDays(10), 14);
  assert.equal(businessDaysToCalendarDays(0), 0);
});

test('addDaysIso projects a real calendar date forward, including a month/year rollover', () => {
  assert.equal(addDaysIso('2026-01-30', 5), '2026-02-04');
  assert.equal(addDaysIso('2026-12-28', 10), '2027-01-07');
});

test('addDaysIso returns null instead of "NaN-NaN-NaN" for a malformed date (regression, was reaching the on-page label and the .ics file)', () => {
  assert.equal(addDaysIso('2026-13-40', 5), null);
  assert.equal(addDaysIso('not-a-date', 5), null);
});

test('daysSince computes a whole number of local calendar days against an injected "now"', () => {
  assert.equal(daysSince('2026-09-01', new Date(2026, 8, 15)), 14);
  assert.equal(daysSince('2026-09-15', new Date(2026, 8, 15)), 0);
});

test('daysSince returns null for a missing or unparseable date', () => {
  assert.equal(daysSince(null, new Date(2026, 8, 15)), null);
  assert.equal(daysSince('not-a-date', new Date(2026, 8, 15)), null);
});

test('computeTurnaroundDays only returns a value for a returned submission with both dates logged', () => {
  assert.equal(computeTurnaroundDays({ status: 'in-queue', submittedDate: '2026-01-01', returnedDate: '2026-02-01' }), null);
  assert.equal(computeTurnaroundDays({ status: 'returned', submittedDate: null, returnedDate: '2026-02-01' }), null);
  assert.equal(computeTurnaroundDays({ status: 'returned', submittedDate: '2026-01-01', returnedDate: '2026-01-15' }), 14);
});

test('buildTurnaroundByGrader averages only returned submissions and reports min/max/count per grader', () => {
  const submissions = [
    { gradingCompany: 'PSA', status: 'returned', submittedDate: '2026-01-01', returnedDate: '2026-02-10' }, // 40
    { gradingCompany: 'PSA', status: 'returned', submittedDate: '2026-01-01', returnedDate: '2026-02-20' }, // 50
    { gradingCompany: 'PSA', status: 'in-queue', submittedDate: '2026-03-01', returnedDate: null },
    { gradingCompany: 'BGS', status: 'returned', submittedDate: '2026-01-01', returnedDate: '2026-01-16' } // 15
  ];
  const result = buildTurnaroundByGrader(submissions);
  const psa = result.find(g => g.label === 'PSA');
  assert.equal(psa.count, 2);
  assert.equal(psa.value, 45);
  assert.equal(psa.min, 40);
  assert.equal(psa.max, 50);
  const bgs = result.find(g => g.label === 'BGS');
  assert.equal(bgs.count, 1);
  assert.equal(bgs.value, 15);
});

test('buildTurnaroundByGrader returns an empty list for no submissions or none returned yet', () => {
  assert.deepEqual(buildTurnaroundByGrader([]), []);
  assert.deepEqual(buildTurnaroundByGrader([{ status: 'in-queue' }]), []);
});

test('estimatedReturnFor prefers real per-grader history over the published estimate once 2+ returns exist', () => {
  const turnaroundByGrader = new Map([['PSA', { label: 'PSA', value: 30, count: 2, min: 28, max: 32 }]]);
  const est = estimatedReturnFor({ gradingCompany: 'PSA', serviceLevel: 'Regular', submittedDate: '2026-08-01' }, turnaroundByGrader, new Date(2026, 8, 1));
  assert.equal(est.hasRealHistory, true);
  assert.equal(est.estReturnDate, '2026-08-31');
  assert.equal(est.estReturnIsPublished, false);
});

test('estimatedReturnFor falls back to the published estimate when fewer than 2 real returns exist for that grader', () => {
  const turnaroundByGrader = new Map();
  const est = estimatedReturnFor({ gradingCompany: 'CGC', serviceLevel: 'Standard', submittedDate: '2026-08-01' }, turnaroundByGrader, new Date(2026, 8, 1));
  assert.ok(!est.hasRealHistory, 'no returned CGC submissions logged yet');
  assert.equal(est.publishedDays, 10);
  assert.equal(est.estReturnDate, addDaysIso('2026-08-01', businessDaysToCalendarDays(10)));
  assert.equal(est.estReturnIsPublished, true);
});

test('estimatedReturnFor flags runningLong once real elapsed days exceed the grader\'s own real average', () => {
  const turnaroundByGrader = new Map([['PSA', { label: 'PSA', value: 10, count: 3, min: 8, max: 12 }]]);
  const est = estimatedReturnFor({ gradingCompany: 'PSA', submittedDate: '2026-08-01' }, turnaroundByGrader, new Date(2026, 8, 1));
  assert.equal(est.days, 31);
  assert.equal(est.runningLong, true);
});

test('estimatedReturnFor still computes estReturnDate while runningLong, so an overdue reminder can still pin to a real past date', () => {
  const turnaroundByGrader = new Map([['PSA', { label: 'PSA', value: 10, count: 3, min: 8, max: 12 }]]);
  const est = estimatedReturnFor({ gradingCompany: 'PSA', submittedDate: '2026-08-01' }, turnaroundByGrader, new Date(2026, 8, 15));
  assert.equal(est.runningLong, true);
  assert.equal(est.estReturnDate, '2026-08-11');
});

test('estimatedReturnFor returns no estimate for a submission with no gradingCompany logged and no history', () => {
  const est = estimatedReturnFor({ gradingCompany: null, submittedDate: '2026-08-01' }, new Map(), new Date(2026, 8, 1));
  assert.equal(est.estReturnDate, null);
  assert.equal(est.publishedDays, null);
});

test('the real submissions.json never crashes computeTurnaroundDays/buildTurnaroundByGrader/estimatedReturnFor on any row', () => {
  const data = require('./submissions.json');
  const submissions = data.submissions || [];
  assert.doesNotThrow(() => submissions.forEach(s => computeTurnaroundDays(s)));
  const byGrader = buildTurnaroundByGrader(submissions);
  const map = new Map(byGrader.map(g => [g.label, g]));
  assert.doesNotThrow(() => submissions.forEach(s => estimatedReturnFor(s, map)));
});

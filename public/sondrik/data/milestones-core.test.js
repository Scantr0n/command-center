#!/usr/bin/env node
/*
 * Regression tests for milestones-core.js, the shared download-milestone
 * and trend-confidence math behind the Timeline's "MILESTONE" badge,
 * Traction's "N more to reach M" line, and the "too early to call this a
 * trend" caveat shown on both the Traction rate line and the Goals
 * projection line.
 *
 * Usage: node --test public/sondrik/data/milestones-core.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DOWNLOAD_MILESTONES, nextMilestone, milestonesCrossed, MIN_TREND_CHECKS, trendCaveatText
} = require('./milestones-core.js');

test('DOWNLOAD_MILESTONES is the real fixed round-number sequence the rest of this file assumes', () => {
  assert.deepEqual(DOWNLOAD_MILESTONES, [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000]);
});

test('nextMilestone returns the smallest milestone strictly greater than the real count', () => {
  assert.equal(nextMilestone(0), 1);
  assert.equal(nextMilestone(1), 5, 'exactly at a milestone, the next one is still ahead');
  assert.equal(nextMilestone(15), 25);
  assert.equal(nextMilestone(24), 25);
});

test('nextMilestone returns null once every real milestone has already been passed', () => {
  assert.equal(nextMilestone(1000000), null);
  assert.equal(nextMilestone(5000000), null);
});

test('milestonesCrossed returns every milestone strictly greater than prevCount and at most count', () => {
  assert.deepEqual(milestonesCrossed(0, 8), [1, 5]);
  assert.deepEqual(milestonesCrossed(8, 15), [10]);
  assert.deepEqual(milestonesCrossed(8, 8), [], 'no movement, nothing newly crossed');
});

test('milestonesCrossed treats a null/undefined prevCount as below every milestone, not as zero', () => {
  // The real first check on record: even if it already logged a nonzero
  // count, it should be credited with every milestone up to that count,
  // not just the ones above zero.
  assert.deepEqual(milestonesCrossed(null, 8), [1, 5]);
  assert.deepEqual(milestonesCrossed(undefined, 0), [], 'a real first check of exactly 0 crosses nothing yet');
  assert.deepEqual(milestonesCrossed(null, 1), [1], 'a real first check already at 1 still credits the 1 milestone');
});

test('MIN_TREND_CHECKS is the real threshold trendCaveatText is built on', () => {
  assert.equal(MIN_TREND_CHECKS, 4);
});

test('trendCaveatText is null once enough real checks exist to call it a trend', () => {
  assert.equal(trendCaveatText(4), null);
  assert.equal(trendCaveatText(10), null);
});

test('trendCaveatText singles out the two-check case by name, a single real interval', () => {
  assert.match(trendCaveatText(2), /based on a single interval \(2 checks\)/);
});

test('trendCaveatText states the real check count for three checks', () => {
  assert.match(trendCaveatText(3), /based on only 3 checks/);
});

test('the real downloads.json on disk has too few checks to clear MIN_TREND_CHECKS, so the caveat is expected to show', () => {
  const downloadsData = require('./downloads.json');
  const checkCount = (downloadsData.metric && downloadsData.metric.checks || []).length;
  assert.notEqual(trendCaveatText(checkCount), null);
});

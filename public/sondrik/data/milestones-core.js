/*
 * Pure download-milestone and trend-confidence math pulled out of app.js so
 * it can be required directly from a Node test (milestones-core.test.js)
 * without loading the rest of the dashboard's DOM-touching code. Same
 * reasoning as goals-core.js/release-core.js/badge-core.js in this same
 * folder: this drives real, on-page-visible facts (the Timeline's
 * "MILESTONE: 10" badge, Traction's "N more to reach M" line, and the
 * "too early to call this a trend" caveat shown on both the Traction rate
 * line and the Goals projection line), and until now none of it had a
 * regression test.
 *
 * DOWNLOAD_MILESTONES/nextMilestone/milestonesCrossed are independent of
 * goals.json (which stays empty until Jack sets an actual target): a fixed,
 * generic round-number sequence, never a claim specific to Sondrik, so it
 * adds no fact beyond "this many downloads happened". MIN_TREND_CHECKS/
 * trendCaveatText is a judgment call, not a statistical threshold: below it,
 * a per-day rate or projected date still renders (the real math is still
 * shown), it just carries an explicit caveat about how thin the real sample
 * behind it is instead of silently reading as an established trend.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SondrikMilestonesCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const DOWNLOAD_MILESTONES = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000];

  function nextMilestone(count) {
    const m = DOWNLOAD_MILESTONES.find(v => v > count);
    return m === undefined ? null : m;
  }

  // Which milestones a check newly crossed versus the check before it. A
  // null prevCount (the very first check on record) is treated as below
  // every milestone rather than as zero, so a first check logged already at
  // a nonzero count still credits it with every milestone up to that count.
  function milestonesCrossed(prevCount, count) {
    const lowerBound = (prevCount === null || prevCount === undefined) ? -1 : prevCount;
    return DOWNLOAD_MILESTONES.filter(m => m > lowerBound && m <= count);
  }

  const MIN_TREND_CHECKS = 4;
  function trendCaveatText(checkCount) {
    if (checkCount >= MIN_TREND_CHECKS) return null;
    return checkCount === 2
      ? 'based on a single interval (2 checks), too early to call this a trend'
      : 'based on only ' + checkCount + ' checks, too early to call this a trend';
  }

  return { DOWNLOAD_MILESTONES, nextMilestone, milestonesCrossed, MIN_TREND_CHECKS, trendCaveatText };
});

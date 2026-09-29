/*
 * Pure date math for flagging an application that has gone quiet, pulled out
 * so it can be unit tested directly (followup-core.test.js) same as every
 * other -core.js in this directory.
 *
 * applications.json only ever logs appliedDate, no status field, so silence
 * is the only real signal this hub has. The two thresholds below aren't a
 * guess: checked against current job-search advice (Indeed's own follow-up
 * guide and others, 2026-09-29) which puts a first reasonable follow-up at
 * 1-2 weeks with no word back, and treats silence past roughly 4 weeks as a
 * real soft no. 14/28 days turns that into the same two-tier severity
 * pattern CSM's own nudge overdue/today already uses elsewhere in this app.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.JobSearchFollowupCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const WATCH_AFTER_DAYS = 14;
  const COLD_AFTER_DAYS = 28;

  // nowIso defaults to the real current date, kept as a parameter (rather
  // than always reading `new Date()` internally) so the regression tests
  // below can check specific day boundaries without the assertions drifting
  // a day every time they happen to run.
  function daysSinceApplied(appliedDate, nowIso) {
    if (!appliedDate) return null;
    const applied = new Date(appliedDate + 'T00:00:00');
    if (isNaN(applied.getTime())) return null;
    const now = new Date((nowIso || new Date().toISOString().slice(0, 10)) + 'T00:00:00');
    if (isNaN(now.getTime())) return null;
    return Math.round((now - applied) / 86400000);
  }

  // null: too soon to flag, or no/invalid appliedDate. 'watch': 14-27 days
  // out, worth a first follow-up. 'cold': 28+ days, likely a soft no.
  function awaitingResponseTier(appliedDate, nowIso) {
    const days = daysSinceApplied(appliedDate, nowIso);
    if (days === null || days < WATCH_AFTER_DAYS) return null;
    return days < COLD_AFTER_DAYS ? 'watch' : 'cold';
  }

  return { WATCH_AFTER_DAYS, COLD_AFTER_DAYS, daysSinceApplied, awaitingResponseTier };
});

/*
 * Pure date math for flagging an application that has gone quiet, pulled out
 * so it can be unit tested directly (followup-core.test.js) same as every
 * other -core.js in this directory.
 *
 * applications.json otherwise only ever logs appliedDate, so before status
 * existed silence was the only real signal this hub had. The two thresholds
 * below aren't a guess: checked against current job-search advice (Indeed's
 * own follow-up guide and others, 2026-09-29) which puts a first reasonable
 * follow-up at 1-2 weeks with no word back, and treats silence past roughly
 * 4 weeks as a real soft no. 14/28 days turns that into the same two-tier
 * severity pattern CSM's own nudge overdue/today already uses elsewhere in
 * this app.
 *
 * status is optional and hand-logged once Jack actually hears something:
 * once set, it's a real fact overriding the silence guess above, so an
 * application marked interview/offer/rejected/withdrawn stops nagging for a
 * follow-up even if it's been quiet past 28 days, same real taxonomy every
 * job tracker guide checked on 2026-09-30 converges on (Applied, Interview,
 * Offer, Rejected, Withdrawn).
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

  // The only real statuses Jack can hand-log once an employer actually
  // responds (interview/offer/rejected) or he takes himself out of the
  // running (withdrawn). Any of these is a real, final-enough fact that
  // overrides the silence-based guess below, so an application marked with
  // one of them stops reading as "awaiting response" regardless of how
  // stale appliedDate has gotten.
  const STATUS_LABELS = { interview: 'Interviewing', offer: 'Offer', rejected: 'Rejected', withdrawn: 'Withdrawn' };

  function isTerminalStatus(status) {
    return Object.prototype.hasOwnProperty.call(STATUS_LABELS, status);
  }

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

  // null: too soon to flag, no/invalid appliedDate, or a real status is
  // already logged (isTerminalStatus). 'watch': 14-27 days out, worth a
  // first follow-up. 'cold': 28+ days, likely a soft no.
  function awaitingResponseTier(appliedDate, nowIso, status) {
    if (isTerminalStatus(status)) return null;
    const days = daysSinceApplied(appliedDate, nowIso);
    if (days === null || days < WATCH_AFTER_DAYS) return null;
    return days < COLD_AFTER_DAYS ? 'watch' : 'cold';
  }

  // The on-page follow-up notify check used to fire only when the awaiting
  // count went up (currentCount > previousCount), which misses a real
  // transition: one application getting a real response in the same poll
  // window a different one newly crosses into "worth a follow-up" leaves
  // the count flat (or lower), so the count-only check never fires even
  // though something genuinely new is now worth following up on. Comparing
  // the actual set of application keys catches that: previousKeys null
  // means this is the first check ever (no real transition to report yet,
  // same as the count-only version's isFirstCheck guard).
  function hasNewDueId(currentKeys, previousKeys) {
    if (!previousKeys) return false;
    const prev = new Set(previousKeys);
    return currentKeys.some(k => !prev.has(k));
  }

  return { WATCH_AFTER_DAYS, COLD_AFTER_DAYS, STATUS_LABELS, isTerminalStatus, daysSinceApplied, awaitingResponseTier, hasNewDueId };
});

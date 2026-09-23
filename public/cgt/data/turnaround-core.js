/*
 * Pure grading-turnaround/return-date math pulled out of app.js so it can be
 * required directly from a Node test (turnaround-core.test.js) without
 * loading the rest of the dashboard's DOM-touching code. Same reasoning as
 * grading-core.js/validate-core.js in this same folder. This is the "how
 * long will a submission actually take, and when should the on-page 'est.
 * back ~' line and the exported .ics calendar reminder say it's due" logic:
 * the published per-tier turnaround table, the tier-name matching against
 * it, the real-history average once enough returned submissions exist to
 * compute one, and the date math that turns either into a real projected
 * date. daysSince/addDaysIso ride along here (rather than staying
 * generic app.js helpers) because estimatedReturnFor is built directly out
 * of them and this is where their one previously-real bug (addDaysIso
 * silently returning the string "NaN-NaN-NaN" for a malformed date, which
 * reached both the on-page label and the .ics file before being caught) was
 * actually reached from.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CGTTurnaroundCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  // Each grader's own published per-tier turnaround, business days, midpoint
  // of the range shown in the "Grading service tiers reference" section
  // (index.html), reviewed September 2026 -- see that section for sources
  // and caveats (PSA's Value tiers paused, Beckett's Base/Standard closed,
  // SGC's own published windows disagreeing across sources). This is only
  // ever used as a fallback estimate, for a grader/company with fewer than 2
  // real returned submissions logged to average from; once real history
  // exists, buildTurnaroundByGrader's own real average always wins over
  // this. "default" is used when serviceLevel doesn't match a known tier
  // name (including no serviceLevel logged at all).
  //
  // PSA renamed Walk-Through to Premier and Regular to Priority, and added a
  // new Standard tier, on 2026-09-14 (see the reference section). The old
  // "walk-through"/"regular" keys are kept alongside the new ones so a real
  // submission logged before that date under its then-current tier name
  // still resolves to the turnaround that was actually published for it at
  // the time, rather than getting silently reinterpreted under the new
  // name. PSA's "default" (no serviceLevel logged) is the rough average
  // across its currently open tiers (Premier/Super Express/Express/Priority/
  // Standard), not one specific tier's own number.
  const PUBLISHED_TURNAROUND_DAYS = {
    PSA: { default: 43, tiers: {
      'walk-through': 6, walkthrough: 6, premier: 9,
      'super express': 13, express: 25,
      regular: 35, priority: 75,
      standard: 95,
      'value max': 45, 'value plus': 70, 'value bulk': 150, value: 110
    } },
    BGS: { default: 45, tiers: { base: 75, standard: 45, express: 15, priority: 5 } },
    CGC: { default: 20, tiers: { bulk: 40, economy: 20, standard: 10, express: 5, walkthrough: 2, 'walk-through': 2 } },
    SGC: { default: 58, tiers: { entry: 58, standard: 58, expedited: 3 } }
  };

  // Business days -> calendar days, weekends only (no holiday calendar
  // here), same rough conversion used nowhere else in this file since every
  // other date math here already works in real calendar days from a real
  // logged date. Good enough for a "published estimate, not a guarantee"
  // figure, not meant to be exact to the day.
  function businessDaysToCalendarDays(businessDays) {
    return Math.round(businessDays * 1.4);
  }

  // PSA's four Value tiers (Value, Value Plus, Value Max, Value Bulk) have
  // been closed to new submissions since 2026-06-02, tied to PSA's own
  // public backlog tracker falling to 5 million cards -- see the "Grading
  // service tiers reference" section (index.html) for the full writeup and
  // sources. Flip PSA_VALUE_TIERS_PAUSED to false once PSA's backlog tracker
  // (psacard.com/info/backlog-tracker) shows the tiers reopened -- do not
  // leave this true past that date, it would misinform every open candidate
  // targeting a normal, open PSA tier.
  const PSA_VALUE_TIERS_PAUSED = true;
  const PSA_PAUSED_VALUE_TIER_NAMES = ['value', 'value plus', 'value max', 'value bulk'];
  function isPsaPausedValueTier(gradingCompany, serviceLevel) {
    if (!PSA_VALUE_TIERS_PAUSED || gradingCompany !== 'PSA' || !serviceLevel) return false;
    const norm = serviceLevel.toLowerCase().trim();
    return PSA_PAUSED_VALUE_TIER_NAMES.some(tierName => norm === tierName || norm.includes(tierName) || tierName.includes(norm));
  }

  function publishedTurnaroundDays(gradingCompany, serviceLevel) {
    const entry = gradingCompany && PUBLISHED_TURNAROUND_DAYS[gradingCompany];
    if (!entry) return null;
    if (serviceLevel) {
      const norm = serviceLevel.toLowerCase().trim();
      // Exact tier name first: PSA's "super express" and "value max"/"value
      // plus"/"value bulk" each contain a shorter real tier name ("express",
      // "value"), so a plain bidirectional substring match on those returns
      // the wrong tier's turnaround for the shorter, more common one. Only
      // fall back to substring matching for a serviceLevel that doesn't
      // exactly match any known tier (e.g. minor wording variations).
      if (Object.prototype.hasOwnProperty.call(entry.tiers, norm)) return entry.tiers[norm];
      for (const [tierName, days] of Object.entries(entry.tiers)) {
        if (norm.includes(tierName) || tierName.includes(norm)) return days;
      }
    }
    return entry.default;
  }

  // Projects an ISO date forward by a whole number of days, local calendar
  // semantics (no time-of-day component). Used to turn a grader's own
  // average turnaround into a real projected date rather than leaving Jack
  // to do the day-math on a "days in queue" figure himself.
  function addDaysIso(isoDate, days) {
    const d = new Date(isoDate + 'T00:00:00');
    // A malformed isoDate (a hand-edit that skipped validate-core's own
    // isDateOrNull, e.g. "2026-13-40") produces an Invalid Date, and every
    // field pulled off it below is NaN, silently returning the literal
    // string "NaN-NaN-NaN" instead of erroring. That string is truthy, so
    // estimatedReturnFor's own `estReturnDate ?` checks never caught it, and
    // it was reaching both the on-page "est. back ~" line and the exported
    // .ics reminder's description before this guard was added.
    if (Number.isNaN(d.getTime())) return null;
    d.setDate(d.getDate() + days);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // `now` defaults to the real current instant; a test passes a fixed Date
  // so "days since" is deterministic instead of only checkable on the one
  // real calendar day it happens to be run on (same convention as Alpha's
  // dates-core.js nowInET).
  function daysSince(isoDate, now) {
    if (!isoDate) return null;
    // Local midnight, not UTC (no trailing Z), same convention as Sondrik's
    // daysBetween and the main dashboard's relativeTime: a submittedDate is
    // logged against Jack's own calendar day, so anchoring to UTC midnight
    // instead overstates the age by up to a day for anyone west of UTC.
    const then = new Date(isoDate + 'T00:00:00');
    if (Number.isNaN(then.getTime())) return null;
    // Real Y/M/D-component subtraction, not a flat /86400000 divide: a fixed
    // 86400000ms divisor silently loses or gains the real DST-transition
    // hour, making every date logged before the year's spring-forward read
    // one calendar day "fresher" than real for the several months until
    // fall-back.
    const nowDate = now || new Date();
    const thenMidnight = new Date(then.getFullYear(), then.getMonth(), then.getDate());
    const nowMidnight = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate());
    return Math.round((nowMidnight - thenMidnight) / 86400000);
  }

  function computeTurnaroundDays(s) {
    if (s.status !== 'returned' || !s.submittedDate || !s.returnedDate) return null;
    const start = new Date(s.submittedDate + 'T00:00:00').getTime();
    const end = new Date(s.returnedDate + 'T00:00:00').getTime();
    if (Number.isNaN(start) || Number.isNaN(end)) return null;
    return Math.round((end - start) / 86400000);
  }

  // Averages real turnaround per grading company, which is the practical
  // question this data answers over time: which grader has actually been
  // fastest for cards Jack has sent, not a published/advertised turnaround
  // time. min/max are carried alongside the average since one outlier batch
  // (e.g. a holiday-season slowdown) can otherwise make an average look more
  // consistent than the real spread was. Takes an already-filtered
  // submissions array (the caller drops the example row) so this stays a
  // plain function of its input rather than reaching for app.js's own
  // module-level state.
  function buildTurnaroundByGrader(submissions) {
    const byGrader = new Map();
    (submissions || []).forEach(s => {
      const days = computeTurnaroundDays(s);
      if (days == null) return;
      const key = s.gradingCompany || 'Unknown';
      if (!byGrader.has(key)) byGrader.set(key, []);
      byGrader.get(key).push(days);
    });
    return [...byGrader.entries()]
      .map(([grader, list]) => ({
        label: grader,
        value: Math.round(list.reduce((a, b) => a + b, 0) / list.length),
        count: list.length,
        min: Math.min(...list),
        max: Math.max(...list)
      }))
      .sort((a, b) => a.value - b.value);
  }

  // Shared by the on-page "est. back ~" label and the .ics export, so the
  // two never drift: same real-history-beats-published-estimate rule, same
  // "no estimate once it's already running long" cutoff. `now` defaults to
  // the real current instant, same convention as daysSince above.
  function estimatedReturnFor(s, turnaroundByGrader, now) {
    const days = daysSince(s.submittedDate, now);
    const graderStats = s.gradingCompany && turnaroundByGrader.get(s.gradingCompany);
    const hasRealHistory = graderStats && graderStats.count >= 2;
    const runningLong = days != null && hasRealHistory && days > graderStats.value;
    const publishedDays = !hasRealHistory && s.gradingCompany ? publishedTurnaroundDays(s.gradingCompany, s.serviceLevel) : null;
    // Computed regardless of runningLong: a caller building a calendar
    // reminder needs a real past date to detect and pin an overdue
    // submission's reminder to today, which is impossible if runningLong
    // forces this to null before it ever gets a chance to be in the past.
    // A caller rendering the on-page label is the one place that still
    // wants this hidden once running long, so it checks runningLong itself
    // instead of relying on this being null.
    const estReturnDate = (s.submittedDate && hasRealHistory)
      ? addDaysIso(s.submittedDate, graderStats.value)
      : (s.submittedDate && publishedDays != null)
        ? addDaysIso(s.submittedDate, businessDaysToCalendarDays(publishedDays))
        : null;
    const estReturnIsPublished = estReturnDate != null && !hasRealHistory;
    return { days, graderStats, hasRealHistory, runningLong, publishedDays, estReturnDate, estReturnIsPublished };
  }

  return {
    PUBLISHED_TURNAROUND_DAYS, PSA_VALUE_TIERS_PAUSED, PSA_PAUSED_VALUE_TIER_NAMES,
    isPsaPausedValueTier, publishedTurnaroundDays, businessDaysToCalendarDays,
    addDaysIso, daysSince, computeTurnaroundDays, buildTurnaroundByGrader, estimatedReturnFor
  };
});

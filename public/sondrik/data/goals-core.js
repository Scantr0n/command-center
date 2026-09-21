/*
 * Pure date/goal math shared between the dashboard's own Goals section
 * (public/sondrik/app.js) and this file's own test suite
 * (goals-core.test.js). No Node-only APIs, same shared-core pattern as
 * validate-core.js in this same directory, so the math that renders the
 * Goals card can actually be unit-tested instead of only ever running live
 * in a browser.
 *
 * This is exactly the code that has already produced two real bugs even
 * though goals.json has sat empty the whole time (no goal has ever been set
 * to exercise it on a real page load): cdc1ac4 fixed a pace tooltip showing
 * more elapsed days than the goal's own window, 244bb86 guarded the same
 * math against a malformed targetDate/setDate. Neither had a regression
 * test, so nothing would have caught either bug coming back the day Jack
 * actually sets a real goal. This gives that math the same test coverage
 * validate-core.js already gives the duplicate-lead check.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SondrikGoalsCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  function daysBetween(a, b) {
    return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
  }

  function addDays(iso, days) {
    const d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  // goals.json's setDate/targetDate are hand-typed, and daysBetween above has
  // no guard of its own: a malformed string (a non-zero-padded "2026-9-5")
  // makes it return NaN, and every caller compares that against 0 with < or
  // >, both of which are always false for NaN, so a goal with a bad date
  // used to silently fall through to the wrong branch instead of erroring.
  function isValidDateStr(iso) {
    if (typeof iso !== 'string' || !DATE_RE.test(iso)) return false;
    const [y, m, d] = iso.split('-').map(Number);
    const parsed = new Date(y, m - 1, d);
    return parsed.getFullYear() === y && parsed.getMonth() === m - 1 && parsed.getDate() === d;
  }

  // The real per-day rate between the first and latest logged download
  // check. Needs at least two real checks (no rate exists off a single
  // point) and a positive span (guards the same same-day-typo case
  // daysBetween otherwise has to guard).
  function downloadsPerDayRate(downloadsData) {
    const metric = (downloadsData && downloadsData.metric) || {};
    const checks = (metric.checks || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    if (checks.length < 2) return null;
    const first = checks[0];
    const latest = checks[checks.length - 1];
    const span = daysBetween(first.date, latest.date);
    if (span <= 0) return null;
    return { perDay: (latest.count - first.count) / span, first, latest };
  }

  // The real date a now-met goal actually crossed its target, derived only
  // from dates already logged elsewhere, never estimated. For downloads,
  // that's the first real check whose count reached the target. For leads,
  // it's the loggedDate of the Nth lead once leads are ordered by that same
  // real date, and only if every lead up to that point actually has one, an
  // undated lead earlier in the queue could put the real crossing point
  // anywhere, so this returns null (an honest "reached, exact date
  // unknown") rather than guess an ordering that isn't backed by real
  // logged dates.
  function goalReachedDate(g, downloadsData, leadsData) {
    if (g.metric === 'downloads') {
      const checks = (((downloadsData && downloadsData.metric) || {}).checks || [])
        .slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      const hit = checks.find(c => c.count >= g.target && c.date);
      return hit ? hit.date : null;
    }
    if (g.metric === 'leads') {
      const leads = (leadsData && leadsData.leads) || [];
      if (leads.length < g.target || leads.some(l => !l.loggedDate)) return null;
      const sorted = leads.slice().sort((a, b) => a.loggedDate.localeCompare(b.loggedDate));
      return sorted[g.target - 1].loggedDate;
    }
    return null;
  }

  // A target of 0 (or a negative typo) would otherwise divide out to
  // NaN/Infinity, which Math.max/min don't clamp away, so guard it
  // explicitly rather than rendering "NaN%".
  function computeGoalProgressPct(target, currentCount) {
    if (!(target > 0)) return 0;
    return Math.max(0, Math.min(100, Math.round((currentCount / target) * 100)));
  }

  // Compares actual progress to how much of the goal's own timeframe has
  // elapsed (e.g. 40% of the days gone but only 10% of the target hit is a
  // real behind-pace signal, not just a raw percent-of-target number).
  // Returns null when either date is missing/malformed or the window/elapsed
  // span isn't positive, the same "nothing honest to say yet" cases the
  // caller already had to guard before this was extracted.
  function computeGoalPaceStatus(setDate, targetDate, pct, todayIsoStr) {
    if (!isValidDateStr(setDate) || !isValidDateStr(targetDate)) return null;
    const totalDays = daysBetween(setDate, targetDate);
    const elapsedDays = daysBetween(setDate, todayIsoStr);
    if (!(totalDays > 0) || !(elapsedDays > 0)) return null;
    // Once the target date itself has passed, elapsedDays can run past
    // totalDays (e.g. a goal set 50 days ago against a 31-day window), which
    // used to print a self-contradictory "50 of 31 days elapsed" even though
    // expectedPct was already clamped to 100%. Clamping the elapsed figure
    // the same way keeps both numbers consistent with each other.
    const clampedElapsedDays = Math.min(elapsedDays, totalDays);
    const expectedPct = Math.round((clampedElapsedDays / totalDays) * 100);
    const diff = pct - expectedPct;
    const tier = diff <= -10 ? 'behind' : diff >= 10 ? 'ahead' : 'on';
    return { totalDays, elapsedDays, clampedElapsedDays, expectedPct, diff, tier };
  }

  return {
    daysBetween,
    addDays,
    isValidDateStr,
    downloadsPerDayRate,
    goalReachedDate,
    computeGoalProgressPct,
    computeGoalPaceStatus
  };
});

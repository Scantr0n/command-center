/*
 * Pure date/staleness/sort math shared between the hub's own page
 * (public/index.html, inline script) and this file's own test suite
 * (dashboard-core.test.js). No DOM, no Node-only APIs, same shared-core
 * pattern already proven at public/alpha/data/dates-core.js and
 * public/sondrik/data/goals-core.js.
 *
 * Every per-project hub (Alpha, CGT, CSM, Garage, Job Search, Sondrik) has
 * had its own date/status math pulled into a tested core module like this
 * one. The hub page itself, the one Jack actually leaves open, never had,
 * so "stale" (the dashed graph ring, the grid's stale badge, the glance
 * favicon dot) and the grid's four sort orders were only ever exercised
 * live in a browser. This closes that gap.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DashboardCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  // Real calendar-day difference between dateStr's local date and today's
  // local date. Dividing a raw ms gap by a fixed 86400000 (the old approach
  // here) silently loses or gains whatever hour a DST transition falls in
  // between the two, so for the several months between a spring-forward
  // and the following fall-back, any date logged before that transition
  // read as one calendar day "fresher" than it really was on every single
  // render. Naively swapping Math.floor for Math.round doesn't fix this: it
  // would round the ordinary second half of *today* (any time from noon on)
  // up to "1 day ago". Subtracting two Date objects built straight from
  // Y/M/D components instead, each resolved by the runtime to its own
  // correct local-midnight instant, cancels the DST hour out entirely and
  // stays exact for the plain same-day case too.
  //
  // `now` defaults to the real clock for every real page load; tests pass a
  // fixed Date so "how many days ago" doesn't depend on when the suite runs.
  function daysAgoLocal(dateStr, now = new Date()) {
    const then = new Date(dateStr + 'T00:00:00');
    const thenMidnight = new Date(then.getFullYear(), then.getMonth(), then.getDate());
    const nowMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((nowMidnight - thenMidnight) / 86400000);
  }

  // Compact form of relativeTime() for the graph's connector badges, where
  // "3 days ago" is too wide to sit on a spoke without crowding a 22-node
  // canvas. No real date means no badge at all (return null, skip rendering)
  // rather than force an awkward "no date on record" pill onto the graph.
  function shortRelativeTime(dateStr, now = new Date()) {
    if (!dateStr) return null;
    const days = daysAgoLocal(dateStr, now);
    if (days <= 0) return 'today';
    if (days < 30) return `${days}d`;
    const months = Math.floor(days / 30);
    return `${months}mo`;
  }

  function relativeTime(dateStr, now = new Date()) {
    if (!dateStr) return 'no date on record';
    const days = daysAgoLocal(dateStr, now);
    if (days <= 0) return 'today';
    if (days === 1) return '1 day ago';
    if (days < 30) return `${days} days ago`;
    const months = Math.floor(days / 30);
    return months === 1 ? '1 month ago' : `${months} months ago`;
  }

  // 30-day threshold the graph's own dashed-ring treatment uses, shared here
  // so Grid flags the same thing instead of silently dropping it.
  //
  // An active/stalled cluster with lastUpdate === null falls straight
  // through the `c.lastUpdate &&` short-circuit and would read as never
  // stale, no matter how long it actually sat untouched: a project that has
  // never once logged a date is at least as neglected as one that logged a
  // date 31+ days ago, not less. done/unknown/broken clusters are left
  // alone here: "done" genuinely doesn't need a date, "unknown" and
  // "broken" already render with their own distinct, honest status
  // treatment elsewhere on the page.
  function isStale(c, now = new Date()) {
    if (!c.lastUpdate) return c.status === 'active' || c.status === 'stalled';
    return daysAgoLocal(c.lastUpdate, now) > 30;
  }

  const STATUS_SEVERITY = { broken: 0, stalled: 1, active: 2, unknown: 3, done: 4 };

  // Grid's own sort, independent of the `clusters` array order the graph
  // relies on for its priority-orbit and category-sector angles, so
  // re-sorting the grid never nudges graph node positions. sortBy is passed
  // in rather than read off a module-level variable so this stays a pure
  // function callers can unit-test without any page state.
  function sortForGrid(list, sortBy) {
    const sorted = list.slice();
    if (sortBy === 'name') {
      sorted.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortBy === 'updated') {
      sorted.sort((a, b) => (b.lastUpdate || '').localeCompare(a.lastUpdate || ''));
    } else if (sortBy === 'status') {
      sorted.sort((a, b) => (STATUS_SEVERITY[a.status] ?? 3) - (STATUS_SEVERITY[b.status] ?? 3));
    }
    // 'priority' needs no re-sort, the input list is already priority-ordered.
    return sorted;
  }

  return {
    daysAgoLocal,
    shortRelativeTime,
    relativeTime,
    isStale,
    STATUS_SEVERITY,
    sortForGrid
  };
});

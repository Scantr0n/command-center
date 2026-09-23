/*
 * Pure regime-segment math shared between the Alpha hub's own page
 * (public/alpha/app.js) and this file's own test suite
 * (regime-core.test.js). No DOM, no Node-only APIs, same shared-core
 * pattern already proven at dates-core.js and account-core.js in this same
 * directory, so the regime-history segmenting and distribution math that
 * renders the "Regime history" section can actually be unit-tested instead
 * of only ever running live in a browser against whatever transitions this
 * browser happens to have recorded.
 *
 * Alpha's live feed sends only the current regime label, never a history
 * (see live.regime in index.html's schema table); app.js turns this
 * browser's own recorded transitions (recordClientRegimeObservation) into
 * readable segments and an aggregated time-in-each-regime breakdown using
 * the functions below.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AlphaRegimeCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  // Real regime labels come from Alpha's own live feed as arbitrary strings,
  // never a fixed enum this page controls, so there is no way to pre-assign
  // a meaningful color per regime the way, say, pl-good/pl-bad can for a
  // known up/down axis. hashStringToIndex instead hashes each label to a
  // stable index into this fixed, distinguishable palette, so the same
  // regime label always gets the same color across renders and reloads (as
  // long as the label spelling itself doesn't change), without needing to
  // know the real regime vocabulary in advance. Kept distinct from the
  // page's existing green/amber/red status hues (used everywhere else for
  // good/caution/critical) so a "trending" or "volatile" swatch here is
  // never mistaken for a status reading.
  const REGIME_PALETTE = ['#7CA8E0', '#3DDC84', '#E0A030', '#B892E0', '#5FD0C0', '#E0819A'];

  function hashStringToIndex(str, mod) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash * 31 + str.charCodeAt(i)) | 0;
    }
    return Math.abs(hash) % mod;
  }

  function regimeColor(label) {
    return REGIME_PALETTE[hashStringToIndex(String(label), REGIME_PALETTE.length)];
  }

  // Turns the flat transition log this browser recorded into readable
  // segments: each entry marks when a regime started, so the segment it
  // started runs until the next entry's timestamp (or now, for the most
  // recent one, which is still current). history is oldest-first, same
  // assumption the connection-history helpers in dates-core.js make.
  //
  // frozenAsOf (real server-timestamp string, or falsy while connected) caps
  // the current segment's end instead of Date.now(): this browser only
  // appends a new observation while genuinely connected, so during a real
  // outage nothing confirms the regime hasn't changed in the meantime, yet
  // the "current" segment would otherwise keep ticking its displayed
  // duration up to now regardless, the one place on this page that would
  // show a frozen reading as though still live.
  function computeRegimeSegments(history, frozenAsOf) {
    if (!Array.isArray(history) || !history.length) return [];
    return history.map((entry, i) => ({
      regime: entry.regime,
      start: entry.at,
      end: i + 1 < history.length ? history[i + 1].at : null,
      current: i === history.length - 1,
      frozenAsOf: (i === history.length - 1 && frozenAsOf) ? frozenAsOf : null
    }));
  }

  // Shared by the regime-history list item and computeRegimeDistribution
  // below, which used to each carry their own copy of this same rule: a fix
  // or change to how a segment's end is capped applied to only one copy
  // would silently desync the per-item duration shown in the regime history
  // list from the aggregated duration shown in the regime distribution
  // totals, two different totals for the same underlying data. `now`
  // defaults to the real current instant; a test passes a fixed timestamp so
  // the "still open, ongoing" branch is exercised deterministically.
  function regimeSegmentEndMs(seg, now) {
    if (!seg.current) return new Date(seg.end).getTime();
    if (seg.frozenAsOf) return new Date(seg.frozenAsOf).getTime();
    return now == null ? Date.now() : now;
  }

  // Aggregates the same real per-segment durations the regime-history list
  // already shows chronologically into a total time spent in each distinct
  // regime label, real trading-dashboard "regime analytics" UX
  // (breakdown/explainability widgets pairing the current label with how
  // conditions have actually evolved) rather than only a moment-to-moment
  // transition log. Sorted by real total duration, longest first, so the
  // dominant regime this browser has actually observed leads. The current,
  // still-open segment's duration is measured up to `now` (or to
  // seg.frozenAsOf during a real outage, same reasoning as
  // regimeSegmentEndMs), so the totals stay accurate between polls rather
  // than freezing at whenever the last transition was recorded, but also
  // never grow on a segment nothing has actually reconfirmed since the
  // connection dropped.
  function computeRegimeDistribution(segments, now) {
    if (!Array.isArray(segments) || !segments.length) return { totalMs: 0, rows: [] };
    const byLabel = new Map();
    let totalMs = 0;
    segments.forEach(seg => {
      const endMs = regimeSegmentEndMs(seg, now);
      const ms = Math.max(0, endMs - new Date(seg.start).getTime());
      totalMs += ms;
      byLabel.set(seg.regime, (byLabel.get(seg.regime) || 0) + ms);
    });
    const rows = [...byLabel.entries()]
      .map(([regime, ms]) => ({ regime, ms, pct: totalMs > 0 ? (ms / totalMs) * 100 : 0 }))
      .sort((a, b) => b.ms - a.ms);
    return { totalMs, rows };
  }

  return {
    REGIME_PALETTE,
    hashStringToIndex,
    regimeColor,
    computeRegimeSegments,
    regimeSegmentEndMs,
    computeRegimeDistribution
  };
});

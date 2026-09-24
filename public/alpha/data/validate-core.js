/*
 * Pure validation-support rules for status.json, with no Node-only APIs (no
 * fs/path/child_process), so this logic can be regression-tested directly
 * (validate-core.test.js) instead of only ever running inside the CLI
 * validator (public/alpha/data/validate.js, which requires this and adds the
 * file I/O and git-drift checks around it). Same shared-core pattern already
 * proven at CGT's, Garage's, and CSM's own validate-core.js, applied here for
 * testability rather than app.js reuse: Alpha's live page already gets this
 * script's real pass/fail counts from server.js's dataQualityHandler, which
 * runs the whole CLI as a subprocess rather than needing the raw detection
 * functions in the browser.
 *
 * scanForForbiddenKeys in particular is the one check standing between this
 * page and silently displaying a fabricated dollar figure on a real,
 * live-money system, so it gets the same real regression coverage every
 * other shared-math module in this hub (account-core, dates-core,
 * regime-core, sparkline-core) already has, not just a hand run of the CLI.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AlphaValidateCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

  // Keys that would only legitimately appear here if real performance data
  // had been wired in, which it never has been from this sandbox.
  const FORBIDDEN_KEY_PATTERN = /pnl|profit|balance|equity|winrate|win_rate|winRate|tradecount|trade_count|tradeCount|dollaramount|returnpct|roi/i;

  function isIsoDatetimeOrNull(v) {
    return v === null || v === undefined || (typeof v === 'string' && ISO_DATETIME_RE.test(v));
  }

  // A few minutes of tolerance for real clock skew between whatever wrote
  // this file and whatever validates it.
  const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;
  function isFutureDatetime(v) {
    if (!v || !ISO_DATETIME_RE.test(v)) return false;
    return new Date(v).getTime() > Date.now() + CLOCK_SKEW_TOLERANCE_MS;
  }

  // Every real free-text field this page renders is written without em
  // dashes, so a hand-typed or pasted-in field that has one reads as coming
  // from somewhere else rather than this product's own voice. Returns the
  // subset of `fields` that actually contain one.
  function emDashFields(obj, fields) {
    const hits = [];
    if (!obj) return hits;
    fields.forEach(f => {
      const v = obj[f];
      if (typeof v === 'string' && v.includes(String.fromCharCode(8212))) hits.push(f);
    });
    return hits;
  }

  // Walks the whole object tree and returns every dotted key path whose key
  // name looks like real trading performance data (P&L, balance, win rate,
  // trade counts, etc). This sandbox has no access to Alpha's real numbers,
  // so any hit here almost certainly means someone guessed instead of wiring
  // in a real feed.
  function findForbiddenKeys(obj, pathSoFar) {
    const hits = [];
    if (obj === null || typeof obj !== 'object') return hits;
    for (const key of Object.keys(obj)) {
      const where = pathSoFar ? pathSoFar + '.' + key : key;
      if (FORBIDDEN_KEY_PATTERN.test(key)) hits.push(where);
      hits.push(...findForbiddenKeys(obj[key], where));
    }
    return hits;
  }

  return {
    FORBIDDEN_KEY_PATTERN,
    isIsoDatetimeOrNull,
    isFutureDatetime,
    emDashFields,
    findForbiddenKeys
  };
});

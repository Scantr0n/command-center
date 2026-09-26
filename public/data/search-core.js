/*
 * Pure URL-building logic shared between the hub's own page
 * (public/index.html, inline script's renderPaletteResults) and this file's
 * own test suite (search-core.test.js). No DOM, no Node-only APIs, same
 * shared-core pattern already proven at dashboard-core.js/graph-core.js/
 * html-core.js in this same directory.
 *
 * RECORD_TYPE_PARAMS is the single list of which /api/search record `type`
 * values (server.js's own SEARCH_SOURCES) map to which hub's deep-link query
 * param. Before this file existed, recordHref() carried its own inline
 * if/else chain that fell out of sync the moment Sondrik's own app.js
 * learned to consume ?lead=/?channel=/?release=/?goal=<id> (see
 * public/sondrik/app.js's INITIAL_RECORD): search results for those four
 * types kept landing on the bare hub page with no highlight, silently, with
 * nothing to catch it, for exactly as long as nobody happened to search for
 * one and notice by eye. One shared list, checked here against every type
 * server.js's SEARCH_SOURCES actually emits, is what closes that gap for
 * good instead of just for today's four types.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SearchCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  // Keep in lockstep with server.js's SEARCH_SOURCES: every `type` a source
  // there emits needs an entry here once that hub's own app.js supports the
  // matching query param, or a real one-line comment (like job-search's)
  // saying why it deliberately doesn't yet.
  const RECORD_TYPE_PARAMS = {
    prospect: 'prospect',
    listing: 'listing',
    card: 'card',
    submission: 'submission',
    candidate: 'candidate',
    lead: 'lead',
    channel: 'channel',
    release: 'release',
    goal: 'goal',
    application: 'application'
    // sale/expense/dispute/supply/acquisition (garage) have no per-record
    // modal or highlight target yet, and (unlike application above) still
    // have zero real rows logged in any of the five files, so there's
    // nothing real yet to jump to: intentionally absent, not an oversight.
  };

  function recordHref(r) {
    const base = '/' + r.hub + '/';
    if (!r.id) return base;
    const param = RECORD_TYPE_PARAMS[r.type];
    if (!param) return base;
    return base + '?' + new URLSearchParams([[param, r.id]]).toString();
  }

  return { RECORD_TYPE_PARAMS, recordHref };
});

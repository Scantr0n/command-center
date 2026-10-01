/*
 * Pure HTML-escaping helper shared between the hub's own page
 * (public/index.html, inline script) and this file's own test suite
 * (html-core.test.js). No DOM, no Node-only APIs, same shared-core pattern
 * already proven at dashboard-core.js/graph-core.js in this same directory.
 *
 * escapeHtml is a real XSS guard (OWASP): the hub page renders hand-edited
 * cluster JSON (a project name, a summary, a chat message) straight into
 * innerHTML, so a value containing "<script>" or an "onerror=" attribute
 * has to come out as inert text rather than live markup. Every per-project
 * hub (Alpha, CGT, CSM, Garage, Job Search, Sondrik) already had its own
 * copy of this exact function pulled into a tested core module; the hub
 * page itself, the one Jack actually leaves open, never had.
 *
 * highlightMatch backs the hub's own Jump-to palette (public/index.html,
 * renderPaletteResults): 2026 command-palette UX research (see this
 * repo's own commit history for the citation) converges on one specific
 * point beyond fuzzy-vs-substring matching, which this app already
 * deliberately settled on substring for (see paletteScore's own comment) -
 * ship a visible highlight on the matched characters, since without one
 * the result order looks arbitrary and a user assumes the palette is
 * broken. Returns real HTML (escaped text with the match, if any, wrapped
 * in a <mark>), never a boolean/index, so a caller can drop the result
 * straight into innerHTML the same way escapeHtml's return value already
 * is everywhere else on this page.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.HtmlCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // Case-insensitive, first-occurrence only (matches paletteScore's own
  // String.includes check, so the highlight always lands on the exact
  // substring that actually made this result match). text/term are both
  // raw, unescaped values straight out of cluster JSON or a live search
  // input; every real character ends up passed through escapeHtml before
  // it reaches the returned string, including the matched slice itself, so
  // a term or text value containing "<"/"&"/etc. can never break out of the
  // <mark> tag or inject markup.
  function highlightMatch(text, term) {
    const str = String(text ?? '');
    const t = String(term ?? '').trim();
    if (!t) return escapeHtml(str);
    const idx = str.toLowerCase().indexOf(t.toLowerCase());
    if (idx === -1) return escapeHtml(str);
    const before = str.slice(0, idx);
    const match = str.slice(idx, idx + t.length);
    const after = str.slice(idx + t.length);
    return escapeHtml(before) + '<mark>' + escapeHtml(match) + '</mark>' + escapeHtml(after);
  }

  return { escapeHtml, highlightMatch };
});

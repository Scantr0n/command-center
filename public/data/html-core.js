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

  return { escapeHtml };
});

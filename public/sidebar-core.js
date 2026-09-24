/*
 * Pure HTML-escaping helper pulled out of sidebar.js so it can be required
 * directly from a Node test (sidebar-core.test.js) without loading the rest
 * of the DOM-touching nav code. Same shared-core pattern already proven at
 * every hub's own html-core.js and public/data/html-core.js, applied here
 * to the one file those don't cover: sidebar.js is the single shared script
 * injected on every page (index + all six hubs), so its own copy of this
 * function was the last untested one left in the app.
 *
 * escapeHtml is a real XSS guard (OWASP): the sidebar renders each cluster's
 * hand-edited name and status straight into innerHTML, so a value
 * containing "<script>" or an "onerror=" attribute has to come out as inert
 * text rather than live markup.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SidebarCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  return { escapeHtml };
});

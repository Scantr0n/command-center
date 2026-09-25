/*
 * Pure HTML-escaping helper pulled out of app.js so it can be required
 * directly from a Node test (html-core.test.js) without loading the rest
 * of the dashboard's DOM-touching code. Same shared-core pattern already
 * proven at export-core.js in this same directory.
 *
 * escapeHtml is a real XSS guard (OWASP): every hub renders hand-editable
 * JSON field values (a symbol, a note, a side) straight into innerHTML, so
 * a value containing "<script>" or an "onerror=" attribute has to come out
 * as inert text rather than live markup. It has run untested in every hub
 * since this dashboard's first version; this gives it the same regression
 * coverage csvField already has.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AlphaHtmlCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  return { escapeHtml };
});

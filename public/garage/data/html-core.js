/*
 * Pure HTML-escaping helper pulled out of app.js so it can be required
 * directly from a Node test (html-core.test.js) without loading the rest
 * of the dashboard's DOM-touching code. Same shared-core pattern already
 * proven at garage-core.js/validate-core.js/export-core.js in this same
 * directory.
 *
 * escapeHtml is a real XSS guard (OWASP): this page renders hand-editable
 * JSON field values (a listing title, a note, a location) straight into
 * innerHTML, so a value containing "<script>" or an "onerror=" attribute
 * has to come out as inert text rather than live markup. It has run
 * untested since this hub's first version; this gives it the same
 * regression coverage csvField already has.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GarageHtmlCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  return { escapeHtml };
});

/*
 * Pure helpers pulled out of sidebar.js so they can be required directly
 * from a Node test (sidebar-core.test.js) without loading the rest of the
 * DOM-touching nav code. Same shared-core pattern already proven at
 * every hub's own html-core.js and public/data/html-core.js, applied here
 * to the one file those don't cover: sidebar.js is the single shared script
 * injected on every page (index + all six hubs), so its own copy of this
 * function was the last untested one left in the app.
 *
 * escapeHtml is a real XSS guard (OWASP): the sidebar renders each cluster's
 * hand-edited name and status straight into innerHTML, so a value
 * containing "<script>" or an "onerror=" attribute has to come out as inert
 * text rather than live markup.
 *
 * STATUS_COLOR is the same per-status dot color used by the hub's own
 * statusColor() (index.html) and the sidebar's nav row dots (sidebar.js).
 * Both used to keep their own hand-copied object literal, which had already
 * drifted to a slightly different shade once (a status dot in the sidebar
 * read as a different color than the same status's dot on the dashboard
 * itself); this is loaded on every page before either one runs, so both can
 * read the one real copy instead of a copy that can silently drift again.
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

  const STATUS_COLOR = {
    active: '#3DDC84', done: '#4A9EDB', stalled: '#E0A030',
    broken: '#E35959', unknown: '#838992'
  };

  return { escapeHtml, STATUS_COLOR };
});

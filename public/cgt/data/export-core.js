/*
 * Pure CSV serialization helper pulled out of app.js so it can be required
 * directly from a Node test (export-core.test.js) without loading the rest
 * of the dashboard's DOM-touching code. Same shared-core pattern already
 * proven at grading-core.js/turnaround-core.js/validate-core.js in this
 * same directory, and at export-core.js in public/sondrik/data,
 * public/alpha/data, and public/garage/data.
 *
 * csvField carries a real security guard (CSV/formula injection, OWASP):
 * all three CSV export buttons on this page (card inventory, candidates,
 * submissions) run every field through it before it ever touches a
 * downloaded file. Sondrik, Alpha, and Garage already extracted the
 * identical function into their own tested core files; this closes the
 * same gap for CGT, which had it copied into app.js untested.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CgtExportCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  function csvField(v) {
    let s = v == null ? '' : String(v);
    // CSV/formula injection (OWASP): a value starting with =, +, -, @, tab,
    // or a carriage return is read as a live formula by Excel/Sheets when
    // this export is opened there, not as plain text. A leading single
    // quote is the standard mitigation both recommend.
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  return { csvField };
});

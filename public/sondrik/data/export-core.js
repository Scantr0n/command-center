/*
 * Pure CSV/ICS serialization helpers pulled out of app.js so they can be
 * required directly from a Node test (export-core.test.js) without loading
 * the rest of the dashboard's DOM-touching code. Same reasoning as
 * goals-core.js/release-core.js/validate-core.js in this same folder.
 *
 * csvField carries a real security guard (CSV/formula injection, OWASP):
 * every CSV export button on this page (downloads, releases, leads,
 * channels, goals) runs every field through it. icsEscapeText/icsFoldLine
 * back the "Add reminders to calendar (.ics)" export. CSM already extracted
 * the identical three functions into csm-core.js with tests; this file
 * closes the same gap for Sondrik, which had them copied into app.js
 * untested.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SondrikExportCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  function csvField(v) {
    let s = v == null ? '' : String(v);
    // CSV/formula injection (OWASP): a hand-typed note starting with
    // =, +, -, @, tab, or a carriage return is read as a live formula by
    // Excel/Sheets when this export is opened there, not as plain text.
    // A leading single quote is the standard mitigation both recommend.
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  // RFC 5545 (iCalendar) text escaping.
  function icsEscapeText(s) {
    return String(s == null ? '' : s)
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\n/g, '\\n');
  }

  // RFC 5545 75-octet line folding, UTF-8-byte-aware so a multi-byte
  // character never gets split across the line break (counting UTF-16 code
  // units instead of real UTF-8 bytes here would cut a non-ASCII character
  // in half mid-fold).
  const icsEncoder = new TextEncoder();
  function icsFoldLine(line) {
    if (icsEncoder.encode(line).length <= 75) return line;
    const segments = [];
    let seg = '';
    let segBytes = 0;
    let budget = 75;
    for (const ch of line) { // for...of walks by code point, never a lone surrogate half
      const chBytes = icsEncoder.encode(ch).length;
      if (segBytes + chBytes > budget) {
        segments.push(seg);
        seg = '';
        segBytes = 0;
        budget = 74; // continuation lines carry a leading space, counted separately below
      }
      seg += ch;
      segBytes += chBytes;
    }
    if (seg) segments.push(seg);
    return segments.map((s, i) => (i === 0 ? s : ' ' + s)).join('\r\n');
  }

  return { csvField, icsEscapeText, icsFoldLine };
});

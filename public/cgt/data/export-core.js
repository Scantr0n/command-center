/*
 * Pure CSV/ICS serialization helpers pulled out of app.js so they can be
 * required directly from a Node test (export-core.test.js) without loading
 * the rest of the dashboard's DOM-touching code. Same shared-core pattern
 * already proven at grading-core.js/turnaround-core.js/validate-core.js in
 * this same directory, and at export-core.js in public/sondrik/data,
 * public/alpha/data, and public/garage/data.
 *
 * csvField carries a real security guard (CSV/formula injection, OWASP):
 * all three CSV export buttons on this page (card inventory, candidates,
 * submissions) run every field through it before it ever touches a
 * downloaded file. Sondrik, Alpha, and Garage already extracted the
 * identical function into their own tested core files; this closed the
 * same gap for CGT, which had it copied into app.js untested.
 *
 * icsEscapeText/icsFoldLine back the submissions "Add reminders to
 * calendar (.ics)" export. Sondrik's copy of these two was already fixed to
 * fold by real UTF-8 byte length instead of UTF-16 code units (a CJK or
 * accented character split across a fold boundary corrupts the exported
 * file's byte stream and violates RFC 5545's 75-octet cap); CGT's copy in
 * app.js still folded by line.length, so it's ported here byte-aware too.
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

/*
 * Pure CSV serialization helper pulled out of app.js so it can be required
 * directly from a Node test (export-core.test.js) without loading the rest
 * of the dashboard's DOM-touching code. Same shared-core pattern already
 * proven at garage-core.js/validate-core.js in this same directory, and at
 * export-core.js in public/sondrik/data and public/alpha/data.
 *
 * csvField carries a real security guard (CSV/formula injection, OWASP):
 * every CSV export button on this page (listings, sales, expenses,
 * disputes, supplies, acquisitions, comps, engagement) runs every field
 * through it before it ever touches a downloaded file, and it matters here
 * specifically since the sales/expenses CSVs get opened in a spreadsheet
 * for real Schedule C bookkeeping. Sondrik and Alpha already extracted the
 * identical function into their own tested core files; this closes the
 * same gap for Garage, which had it copied into app.js untested.
 *
 * icsEscapeText/icsFoldLine/icsDateStamp/buildIcsCalendar are the same
 * relist/dispute-reminder .ics builder that used to live in app.js
 * untested. icsFoldLine in particular used to fold on JS string .length
 * (UTF-16 code units), not the 75 octets RFC 5545 section 3.1 actually
 * requires, the exact bug CSM's own csm-core.js already found and fixed
 * for its icsFoldLine. A listing title or dispute note with any non-ASCII
 * character (an accented brand name, a curly quote pasted from somewhere
 * else) pushing a line past 75 of those units would cut a multi-byte
 * character in half mid-fold, producing a line some calendar apps reject
 * on import. Moved here, with CSM's same byte-counting fix, so this stays
 * correct and is checked by a real test instead of hoping nobody ever
 * pastes a non-ASCII title.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GarageExportCore = factory();
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

  // RFC 5545 (iCalendar) text escaping: backslash, comma, semicolon, and
  // newline all need a backslash escape inside a property value.
  function icsEscapeText(text) {
    return String(text == null ? '' : text)
      .replace(/\\/g, '\\\\')
      .replace(/,/g, '\\,')
      .replace(/;/g, '\\;')
      .replace(/\n/g, '\\n');
  }

  // Folds a single logical property line at 75 octets with a CRLF + single
  // space continuation, per RFC 5545 section 3.1, counting real UTF-8 bytes
  // (not JS string .length) and never splitting a multi-byte character
  // across the boundary.
  const icsTextEncoder = new TextEncoder();
  function icsFoldLine(line) {
    if (icsTextEncoder.encode(line).length <= 75) return line;
    const segments = [];
    let seg = '';
    let segBytes = 0;
    let budget = 75;
    for (const ch of line) { // for...of walks by code point, never a lone surrogate half
      const chBytes = icsTextEncoder.encode(ch).length;
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

  function icsDateStamp(date) {
    return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  }

  // One all-day VEVENT per reminder, each with a DISPLAY alarm at 9am on the
  // day so it actually shows up rather than sitting silent on an all-day row.
  function buildIcsCalendar(reminders, now) {
    const stamp = icsDateStamp(now || new Date());
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Command Center//Garage Reminders//EN', 'CALSCALE:GREGORIAN'];
    reminders.forEach(r => {
      lines.push('BEGIN:VEVENT');
      lines.push(`UID:garage-${r.id}-${r.date}@command-center.local`);
      lines.push(`DTSTAMP:${stamp}`);
      lines.push(`DTSTART;VALUE=DATE:${r.date.replace(/-/g, '')}`);
      lines.push(icsFoldLine(`SUMMARY:${icsEscapeText(r.summary)}`));
      lines.push(icsFoldLine(`DESCRIPTION:${icsEscapeText(r.description)}`));
      lines.push('BEGIN:VALARM');
      lines.push('ACTION:DISPLAY');
      lines.push(icsFoldLine(`DESCRIPTION:${icsEscapeText(r.summary)}`));
      lines.push('TRIGGER:PT9H');
      lines.push('END:VALARM');
      lines.push('END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    return lines.join('\r\n') + '\r\n';
  }

  return { csvField, icsEscapeText, icsFoldLine, icsDateStamp, buildIcsCalendar };
});

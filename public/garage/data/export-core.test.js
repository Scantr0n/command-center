const test = require('node:test');
const assert = require('node:assert/strict');
const { csvField, icsEscapeText, icsFoldLine, icsDateStamp, buildIcsCalendar } = require('./export-core.js');

test('csvField leaves an ordinary value untouched', () => {
  assert.equal(csvField('black-boots'), 'black-boots');
});

test('csvField returns an empty string for null/undefined, never the literal "null"', () => {
  assert.equal(csvField(null), '');
  assert.equal(csvField(undefined), '');
});

test('csvField quotes a value containing a comma, quote, or newline, doubling embedded quotes', () => {
  assert.equal(csvField('worn once, like new'), '"worn once, like new"');
  assert.equal(csvField('say "hi"'), '"say ""hi"""');
  assert.equal(csvField('line1\nline2'), '"line1\nline2"');
});

test('csvField prefixes a leading single quote onto a value that would otherwise be read as a live formula', () => {
  // Real CSV/formula injection mitigation (OWASP): Excel/Sheets treats a
  // cell starting with =, +, -, @, tab, or CR as a formula to execute, not
  // plain text, if a note, item title, or platform field ever happened to
  // start with one of these, and the sales/expenses CSVs here get opened
  // in a spreadsheet for real Schedule C bookkeeping.
  assert.equal(csvField('=cmd|/c calc'), "'=cmd|/c calc");
  assert.equal(csvField('+1234'), "'+1234");
  assert.equal(csvField('-1234'), "'-1234");
  assert.equal(csvField('@mention'), "'@mention");
});

test('csvField does not prefix a value that merely contains one of the formula characters mid-string', () => {
  assert.equal(csvField('poshmark-relist'), 'poshmark-relist');
});

test('csvField coerces a number to its plain string form', () => {
  assert.equal(csvField(12.5), '12.5');
  assert.equal(csvField(0), '0');
});

test('icsEscapeText backslash-escapes backslash, comma, semicolon, and newline per RFC 5545', () => {
  assert.equal(icsEscapeText('a\\b;c,d\ne'), 'a\\\\b\\;c\\,d\\ne');
});

test('icsEscapeText returns an empty string for null/undefined', () => {
  assert.equal(icsEscapeText(null), '');
  assert.equal(icsEscapeText(undefined), '');
});

test('icsFoldLine leaves a short line (under 75 octets) unfolded', () => {
  const line = 'SUMMARY:Relist/renew: black-boots';
  assert.equal(icsFoldLine(line), line);
});

test('icsFoldLine folds a long ASCII line at 75 octets with a CRLF + single-space continuation', () => {
  const line = 'DESCRIPTION:' + 'x'.repeat(100);
  const folded = icsFoldLine(line);
  const parts = folded.split('\r\n');
  assert.ok(parts.length > 1);
  parts.forEach((part, i) => {
    const bytes = Buffer.byteLength(i === 0 ? part : part.slice(1), 'utf8');
    assert.ok(bytes <= 75, 'segment ' + i + ' is ' + bytes + ' octets');
  });
  assert.ok(parts.slice(1).every(p => p.startsWith(' ')));
});

test('icsFoldLine never splits a multi-byte UTF-8 character across a fold boundary', () => {
  // A listing title or dispute note with real non-ASCII text (an accented
  // brand name, a curly quote) is exactly the case this guards: counting
  // UTF-16 code units instead of UTF-8 bytes here would cut a non-ASCII
  // character in half mid-fold. Rejoining every fragment must reproduce the
  // original line exactly, and every fragment must stay within the real
  // 75-octet budget.
  const line = 'SUMMARY:Relist/renew: ' + 'Côté café™ dépôt'.repeat(10);
  const folded = icsFoldLine(line);
  const parts = folded.split('\r\n');
  assert.ok(parts.length > 1);
  const rejoined = parts.map((p, i) => (i === 0 ? p : p.slice(1))).join('');
  assert.equal(rejoined, line);
  parts.forEach((part, i) => {
    const bytes = Buffer.byteLength(i === 0 ? part : part.slice(1), 'utf8');
    assert.ok(bytes <= 75, 'segment ' + i + ' is ' + bytes + ' octets');
  });
});

test('icsDateStamp formats a date as a UTC DTSTAMP value', () => {
  assert.equal(icsDateStamp(new Date('2026-09-24T09:00:00Z')), '20260924T090000Z');
});

test('buildIcsCalendar builds one all-day VEVENT with a 9am DISPLAY alarm per reminder', () => {
  const ics = buildIcsCalendar([
    { id: 'black-boots-relist', date: '2026-10-05', summary: 'Relist/renew: black-boots', description: 'Refresh on eBay, 30 days without a sale.' }
  ], new Date('2026-09-24T09:00:00Z'));
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.ok(ics.includes('UID:garage-black-boots-relist-2026-10-05@command-center.local'));
  assert.ok(ics.includes('DTSTART;VALUE=DATE:20261005'));
  assert.ok(ics.includes('SUMMARY:Relist/renew: black-boots'));
  assert.ok(ics.includes('BEGIN:VALARM'));
  assert.ok(ics.includes('TRIGGER:PT9H'));
});

test('buildIcsCalendar escapes a comma in a reminder summary so it is not read as a property-value separator', () => {
  const ics = buildIcsCalendar([
    { id: 'x', date: '2026-10-05', summary: 'Relist: boots, black', description: 'd' }
  ], new Date('2026-09-24T09:00:00Z'));
  assert.ok(ics.includes('SUMMARY:Relist: boots\\, black'));
});

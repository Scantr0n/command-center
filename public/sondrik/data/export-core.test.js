const test = require('node:test');
const assert = require('node:assert/strict');
const { csvField, icsEscapeText, icsFoldLine } = require('./export-core.js');

test('csvField leaves an ordinary value untouched', () => {
  assert.equal(csvField('v0.3.7'), 'v0.3.7');
});

test('csvField returns an empty string for null/undefined, never the literal "null"', () => {
  assert.equal(csvField(null), '');
  assert.equal(csvField(undefined), '');
});

test('csvField quotes a value containing a comma, quote, or newline, doubling embedded quotes', () => {
  assert.equal(csvField('Fixed, mostly'), '"Fixed, mostly"');
  assert.equal(csvField('say "hi"'), '"say ""hi"""');
  assert.equal(csvField('line1\nline2'), '"line1\nline2"');
});

test('csvField prefixes a leading single quote onto a value that would otherwise be read as a live formula', () => {
  // Real CSV/formula injection mitigation (OWASP): Excel/Sheets treats a
  // cell starting with =, +, -, @, tab, or CR as a formula to execute, not
  // plain text, when a hand-typed release/lead note happens to start with
  // one of these.
  assert.equal(csvField('=cmd|/c calc'), "'=cmd|/c calc");
  assert.equal(csvField('+1234'), "'+1234");
  assert.equal(csvField('-1234'), "'-1234");
  assert.equal(csvField('@mention'), "'@mention");
});

test('csvField does not prefix a value that merely contains one of the formula characters mid-string', () => {
  assert.equal(csvField('reply@sondrik.app'), 'reply@sondrik.app');
});

test('icsEscapeText backslash-escapes backslash, semicolon, comma, and newline per RFC 5545', () => {
  assert.equal(icsEscapeText('a\\b;c,d\ne'), 'a\\\\b\\;c\\,d\\ne');
});

test('icsEscapeText returns an empty string for null/undefined', () => {
  assert.equal(icsEscapeText(null), '');
  assert.equal(icsEscapeText(undefined), '');
});

test('icsFoldLine leaves a short line (under 75 octets) unfolded', () => {
  const line = 'SUMMARY:Sondrik v0.3.7: 7-day check-in';
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
  // Real bugfix summaries/notes can contain non-ASCII text, and counting
  // UTF-16 code units instead of UTF-8 bytes here would cut a multi-byte
  // character in half mid-fold. Rejoining every fragment must reproduce the
  // original line exactly, and every fragment must stay within the real
  // 75-octet budget.
  const line = 'SUMMARY:' + '中文名字'.repeat(20); // repeated CJK text, well past 75 octets
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

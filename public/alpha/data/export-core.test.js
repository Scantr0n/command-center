const test = require('node:test');
const assert = require('node:assert/strict');
const { csvField } = require('./export-core.js');

test('csvField leaves an ordinary value untouched', () => {
  assert.equal(csvField('AAPL'), 'AAPL');
});

test('csvField returns an empty string for null/undefined, never the literal "null"', () => {
  assert.equal(csvField(null), '');
  assert.equal(csvField(undefined), '');
});

test('csvField quotes a value containing a comma, quote, or newline, doubling embedded quotes', () => {
  assert.equal(csvField('long, mostly'), '"long, mostly"');
  assert.equal(csvField('say "hi"'), '"say ""hi"""');
  assert.equal(csvField('line1\nline2'), '"line1\nline2"');
});

test('csvField prefixes a leading single quote onto a value that would otherwise be read as a live formula', () => {
  // Real CSV/formula injection mitigation (OWASP): Excel/Sheets treats a
  // cell starting with =, +, -, @, tab, or CR as a formula to execute, not
  // plain text, if a symbol, side, or event label ever happened to start
  // with one of these.
  assert.equal(csvField('=cmd|/c calc'), "'=cmd|/c calc");
  assert.equal(csvField('+1234'), "'+1234");
  assert.equal(csvField('-1234'), "'-1234");
  assert.equal(csvField('@mention'), "'@mention");
});

test('csvField does not prefix a value that merely contains one of the formula characters mid-string', () => {
  assert.equal(csvField('kill-switch'), 'kill-switch');
});

test('csvField coerces a number to its plain string form', () => {
  assert.equal(csvField(12.5), '12.5');
  assert.equal(csvField(0), '0');
});

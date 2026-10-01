const test = require('node:test');
const assert = require('node:assert/strict');
const { escapeHtml, highlightMatch } = require('./html-core.js');

test('escapeHtml leaves an ordinary value untouched', () => {
  assert.equal(escapeHtml('Command Center'), 'Command Center');
});

test('escapeHtml returns an empty string for null/undefined, never the literal "null"', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
});

test('escapeHtml neutralizes a script tag rather than letting it render as live markup', () => {
  // Real XSS guard (OWASP): the hub page renders hand-edited cluster JSON
  // straight into innerHTML, so a project name or summary containing
  // "<script>" has to come out as inert text.
  assert.equal(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
});

test('escapeHtml neutralizes an attribute-breakout attempt', () => {
  assert.equal(
    escapeHtml('"><img src=x onerror=alert(1)>'),
    '&quot;&gt;&lt;img src=x onerror=alert(1)&gt;'
  );
});

test('escapeHtml escapes each of the five reserved characters', () => {
  assert.equal(escapeHtml('& < > " \''), '&amp; &lt; &gt; &quot; &#39;');
});

test('escapeHtml coerces a number to its plain string form', () => {
  assert.equal(escapeHtml(12.5), '12.5');
  assert.equal(escapeHtml(0), '0');
});

test('highlightMatch wraps the matched substring in a <mark>, case-insensitively', () => {
  assert.equal(highlightMatch('Card Grading Tracker', 'grading'), 'Card <mark>Grading</mark> Tracker');
});

test('highlightMatch matches the first occurrence only, not every occurrence', () => {
  assert.equal(highlightMatch('Sondrik Sondrik', 'son'), '<mark>Son</mark>drik Sondrik');
});

test('highlightMatch returns the plain escaped text, no <mark>, when the term is not found', () => {
  assert.equal(highlightMatch('Alpha (Trading Bot)', 'zzz'), 'Alpha (Trading Bot)');
});

test('highlightMatch returns the plain escaped text, no <mark>, for an empty/whitespace term', () => {
  assert.equal(highlightMatch('Alpha (Trading Bot)', ''), 'Alpha (Trading Bot)');
  assert.equal(highlightMatch('Alpha (Trading Bot)', '   '), 'Alpha (Trading Bot)');
});

test('highlightMatch escapes HTML-significant characters both inside and outside the match', () => {
  assert.equal(
    highlightMatch('<script>alert(1)</script>', 'script'),
    '&lt;<mark>script</mark>&gt;alert(1)&lt;/script&gt;'
  );
});

test('highlightMatch escapes a term that itself contains HTML-significant characters', () => {
  // The matched slice is taken from `text` (already real data), but a
  // search term typed by a user could itself contain "<"/"&"/etc, and
  // since the matched slice is echoed back through escapeHtml same as
  // everything else, this can never inject markup via the term either.
  assert.equal(highlightMatch('a <b> b', '<b>'), 'a <mark>&lt;b&gt;</mark> b');
});

test('highlightMatch returns null/undefined text as an empty string, like escapeHtml does', () => {
  assert.equal(highlightMatch(null, 'x'), '');
  assert.equal(highlightMatch(undefined, 'x'), '');
});

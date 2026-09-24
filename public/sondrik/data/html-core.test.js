const test = require('node:test');
const assert = require('node:assert/strict');
const { escapeHtml } = require('./html-core.js');

test('escapeHtml leaves an ordinary value untouched', () => {
  assert.equal(escapeHtml('v1.4.0'), 'v1.4.0');
});

test('escapeHtml returns an empty string for null/undefined, never the literal "null"', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
});

test('escapeHtml neutralizes a script tag rather than letting it render as live markup', () => {
  // Real XSS guard (OWASP): this page renders hand-editable JSON field
  // values straight into innerHTML, so a lead summary or release note
  // containing "<script>" has to come out as inert text.
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

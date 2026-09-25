const test = require('node:test');
const assert = require('node:assert/strict');
const { escapeHtml, STATUS_COLOR } = require('./sidebar-core.js');

test('escapeHtml leaves an ordinary value untouched', () => {
  assert.equal(escapeHtml('Command Center'), 'Command Center');
});

test('escapeHtml returns an empty string for null/undefined, never the literal "null"', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
});

test('escapeHtml neutralizes a script tag rather than letting it render as live markup', () => {
  // Real XSS guard (OWASP): the sidebar renders each cluster's hand-edited
  // name and status straight into innerHTML, so a value containing
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

test('STATUS_COLOR has one real color for every status the dashboard renders', () => {
  // The one real copy both index.html's statusColor() and sidebar.js's own
  // nav-row dots read from, replacing two hand-copied literals that had
  // already drifted to a slightly different shade once before.
  assert.deepEqual(Object.keys(STATUS_COLOR).sort(), ['active', 'broken', 'done', 'stalled', 'unknown']);
  Object.values(STATUS_COLOR).forEach(v => assert.match(v, /^#[0-9A-Fa-f]{6}$/));
});

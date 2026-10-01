const test = require('node:test');
const assert = require('node:assert/strict');
const { formatChatReply } = require('./chat-format-core.js');

test('formatChatReply wraps a single line of plain text in one <p>', () => {
  assert.equal(formatChatReply('Alpha is live, no open positions right now.'), '<p>Alpha is live, no open positions right now.</p>');
});

test('formatChatReply returns an empty string for empty/whitespace/null input', () => {
  assert.equal(formatChatReply(''), '');
  assert.equal(formatChatReply('   '), '');
  assert.equal(formatChatReply(null), '');
  assert.equal(formatChatReply(undefined), '');
});

test('formatChatReply renders **bold** and __bold__ as <strong>', () => {
  assert.equal(formatChatReply('**Status:** active'), '<p><strong>Status:</strong> active</p>');
  assert.equal(formatChatReply('__Status:__ active'), '<p><strong>Status:</strong> active</p>');
});

test('formatChatReply renders *emphasis* and _emphasis_ as <em>', () => {
  assert.equal(formatChatReply('this is *not confirmed* yet'), '<p>this is <em>not confirmed</em> yet</p>');
  assert.equal(formatChatReply('this is _not confirmed_ yet'), '<p>this is <em>not confirmed</em> yet</p>');
});

test('formatChatReply does not read an underscore inside an identifier as emphasis', () => {
  // snake_case_name has real underscores that are not markdown emphasis;
  // the word-boundary guard on the plain _..._ pattern must leave it alone.
  assert.equal(formatChatReply('see next_nudge_date for the real field'), '<p>see next_nudge_date for the real field</p>');
});

test('formatChatReply renders a real emphasis span nested inside a bold one, not stray asterisks', () => {
  // "**bold *emphasis* still bold**" is a common real reply shape. Bold's
  // content must be matched up to the nearest closing delimiter, not "no
  // delimiter char at all", or this whole span falls through unconverted.
  assert.equal(
    formatChatReply('**bold *emphasis* still bold**'),
    '<p><strong>bold <em>emphasis</em> still bold</strong></p>'
  );
});

test('formatChatReply renders two separate **bold** spans on one line independently', () => {
  assert.equal(formatChatReply('**a** plain **b**'), '<p><strong>a</strong> plain <strong>b</strong></p>');
});

test('formatChatReply renders a `code` span as <code>', () => {
  assert.equal(formatChatReply('run `npm test` first'), '<p>run <code>npm test</code> first</p>');
});

test('formatChatReply never reads markdown syntax inside a code span', () => {
  assert.equal(formatChatReply('the real flag is `*ngrok*`'), '<p>the real flag is <code>*ngrok*</code></p>');
});

test('formatChatReply groups consecutive "- " lines into one <ul>', () => {
  assert.equal(
    formatChatReply('Open items:\n- backfill contactChannel\n- backfill verifiedHook'),
    '<p>Open items:</p><ul><li>backfill contactChannel</li><li>backfill verifiedHook</li></ul>'
  );
});

test('formatChatReply groups consecutive "1. " lines into one <ol>', () => {
  assert.equal(
    formatChatReply('1. ship the draft\n2. confirm the comp'),
    '<ol><li>ship the draft</li><li>confirm the comp</li></ol>'
  );
});

test('formatChatReply starts a new <ul> after an <ol> run, no merging across list types', () => {
  assert.equal(
    formatChatReply('1. first\n- second'),
    '<ol><li>first</li></ol><ul><li>second</li></ul>'
  );
});

test('formatChatReply joins consecutive plain lines inside one paragraph with <br>, no blank line between them', () => {
  assert.equal(formatChatReply('line one\nline two'), '<p>line one<br>line two</p>');
});

test('formatChatReply starts a new <p> after a blank line', () => {
  assert.equal(formatChatReply('first paragraph\n\nsecond paragraph'), '<p>first paragraph</p><p>second paragraph</p>');
});

test('formatChatReply still escapes real HTML-significant characters before applying any markdown', () => {
  assert.equal(formatChatReply('<script>alert(1)</script>'), '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
});

test('formatChatReply escapes HTML inside a bold span rather than letting it break out', () => {
  assert.equal(formatChatReply('**<img src=x onerror=alert(1)>**'), '<p><strong>&lt;img src=x onerror=alert(1)&gt;</strong></p>');
});

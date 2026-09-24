#!/usr/bin/env node
/*
 * Regression tests for server-core.js: request validation, Anthropic
 * error-shaping, and the data-quality regex parser every hub's on-page
 * "Self-check" badge depends on. Previously lived inline in server.js with
 * no test coverage at all; see server-core.js's own header comment.
 *
 * Usage: node --test data/server-core.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyDriveError, validateChatMessages, anthropicErrorMessage, parseValidateCounts,
  MAX_CHAT_MESSAGES, MAX_CHAT_MESSAGE_LENGTH
} = require('./server-core.js');

test('classifyDriveError reports not-configured for a missing credentials file, real error otherwise', () => {
  assert.equal(classifyDriveError(null), null);
  assert.deepEqual(classifyDriveError({ code: 'ENOENT', message: 'no such file' }), { state: 'not-configured' });
  assert.deepEqual(classifyDriveError({ code: 'EACCES', message: 'permission denied' }), { state: 'error', message: 'permission denied' });
  assert.deepEqual(classifyDriveError(new Error('invalid_grant')), { state: 'error', message: 'invalid_grant' });
});

test('validateChatMessages accepts a real short conversation', () => {
  assert.equal(validateChatMessages([{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }]), null);
});

test('validateChatMessages rejects a missing, empty, or non-array body', () => {
  assert.match(validateChatMessages(undefined), /non-empty array/);
  assert.match(validateChatMessages([]), /non-empty array/);
  assert.match(validateChatMessages('hi'), /non-empty array/);
});

test('validateChatMessages rejects more than MAX_CHAT_MESSAGES entries', () => {
  const messages = Array.from({ length: MAX_CHAT_MESSAGES + 1 }, () => ({ role: 'user', content: 'hi' }));
  assert.match(validateChatMessages(messages), new RegExp(`${MAX_CHAT_MESSAGES} entries`));
});

test('validateChatMessages rejects a bad role, missing content, or blank content', () => {
  assert.match(validateChatMessages([{ role: 'system', content: 'hi' }]), /role of "user" or "assistant"/);
  assert.match(validateChatMessages([{ role: 'user' }]), /non-empty string content/);
  assert.match(validateChatMessages([{ role: 'user', content: '   ' }]), /non-empty string content/, 'whitespace-only content is not a real message');
});

test('validateChatMessages rejects a single message over MAX_CHAT_MESSAGE_LENGTH', () => {
  const tooLong = 'a'.repeat(MAX_CHAT_MESSAGE_LENGTH + 1);
  assert.match(validateChatMessages([{ role: 'user', content: tooLong }]), new RegExp(`${MAX_CHAT_MESSAGE_LENGTH} characters`));
  const atLimit = 'a'.repeat(MAX_CHAT_MESSAGE_LENGTH);
  assert.equal(validateChatMessages([{ role: 'user', content: atLimit }]), null, 'exactly at the limit is still valid');
});

test('anthropicErrorMessage pulls the real nested message out of Anthropic\'s error shape', () => {
  assert.equal(anthropicErrorMessage({ type: 'error', error: { type: 'rate_limit_error', message: 'Rate limit exceeded' } }), 'Rate limit exceeded');
});

test('anthropicErrorMessage falls back to a plain string or a generic message, never "[object Object]"', () => {
  assert.equal(anthropicErrorMessage('raw string error'), 'raw string error');
  assert.equal(anthropicErrorMessage({}), 'Anthropic API error');
  assert.equal(anthropicErrorMessage(null), 'Anthropic API error');
  assert.equal(anthropicErrorMessage({ error: {} }), 'Anthropic API error', 'error object with no string message falls back too');
});

test('parseValidateCounts sums every real "N warning(s)"/"N error(s)" line, ignoring unrelated text', () => {
  const text = 'cards.json is valid (3 item(s)).\n2 warning(s)\nsubmissions.json is valid.\n1 error(s)\n';
  assert.deepEqual(parseValidateCounts(text), { warnings: 2, errors: 1 });
});

test('parseValidateCounts sums across multiple separate warning/error lines, not just the last one', () => {
  // Real shape: several hub data files each print their own count line
  // (e.g. cards.json's own warnings, then submissions.json's own warnings).
  const text = '2 warning(s)\n0 error(s)\n1 warning(s)\n0 error(s)\n';
  assert.deepEqual(parseValidateCounts(text), { warnings: 3, errors: 0 });
});

test('parseValidateCounts reports zero for real output with no warnings or errors at all', () => {
  assert.deepEqual(parseValidateCounts('All 22 cluster file(s) are valid.\n'), { warnings: 0, errors: 0 });
  assert.deepEqual(parseValidateCounts(''), { warnings: 0, errors: 0 });
});

test('parseValidateCounts never false-matches the word "warning"/"error" without a real leading count', () => {
  // A crash message or a sentence mentioning "error" with no digit/"(s)"
  // shape must never be silently counted as a real validation error, the
  // exact false-clean/false-dirty risk this parser exists to avoid.
  const text = 'TypeError: Cannot read properties of undefined\nWarning: something happened\n';
  assert.deepEqual(parseValidateCounts(text), { warnings: 0, errors: 0 });
});

test('parseValidateCounts correctly counts an explicit real zero rather than skipping it', () => {
  assert.deepEqual(parseValidateCounts('0 warning(s)\n0 error(s)\n'), { warnings: 0, errors: 0 });
});

test('parseValidateCounts handles large real counts and both keywords on the same line', () => {
  assert.deepEqual(parseValidateCounts('12 warning(s), 3 error(s) found across all files'), { warnings: 12, errors: 3 });
});

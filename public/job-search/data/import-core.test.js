#!/usr/bin/env node
/*
 * Regression tests for import-core.js, the CSV-parsing/row-building logic
 * behind the Job Search CSV importer (import.js). No test framework or
 * dependency: node:test and node:assert ship with Node itself, matching
 * every other hub's own *-core.test.js in this repo.
 *
 * Usage: node --test public/job-search/data/import-core.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeHeader, normalizeStatus, nextAvailableNum, csvField, parseCsv, guessMapping, buildRowFromMapping
} = require('./import-core.js');

const FIELD_DEFS = [
  { key: 'role', label: 'Role', aliases: ['role', 'title', 'position'] },
  { key: 'company', label: 'Company', aliases: ['company', 'employer'] },
  { key: 'location', label: 'Location', aliases: ['location', 'loc'] },
  { key: 'pay', label: 'Pay', aliases: ['pay', 'salary', 'compensation'] },
  { key: 'appliedDate', label: 'Applied date', aliases: ['applieddate', 'dateapplied', 'date'] },
  { key: 'status', label: 'Status', aliases: ['status'], type: 'status' }
];

test('normalizeHeader lowercases and strips non-alphanumeric characters', () => {
  assert.equal(normalizeHeader('Applied Date'), 'applieddate');
  assert.equal(normalizeHeader('Company / Employer'), 'companyemployer');
  assert.equal(normalizeHeader(null), '');
});

test('normalizeStatus lowercases a real status and leaves an unrecognized one as-is', () => {
  assert.equal(normalizeStatus('Interview'), 'interview');
  assert.equal(normalizeStatus('ghosted'), 'ghosted');
  assert.equal(normalizeStatus(''), null);
  assert.equal(normalizeStatus(null), null);
});

test('nextAvailableNum returns 1 for an empty set and seeds it', () => {
  const used = new Set();
  assert.equal(nextAvailableNum(used), 1);
  assert.ok(used.has(1));
});

test('nextAvailableNum returns one past the real current max', () => {
  const used = new Set([1, 2, 5]);
  assert.equal(nextAvailableNum(used), 6);
});

test('nextAvailableNum assigns a run of distinct numbers across repeated calls, not the same max+1 each time', () => {
  const used = new Set([3]);
  const nums = [nextAvailableNum(used), nextAvailableNum(used), nextAvailableNum(used)];
  assert.deepEqual(nums, [4, 5, 6]);
});

test('csvField quotes a value containing a comma, quote, or newline', () => {
  assert.equal(csvField('Acme, Inc'), '"Acme, Inc"');
  assert.equal(csvField('Say "hi"'), '"Say ""hi"""');
  assert.equal(csvField('plain'), 'plain');
  assert.equal(csvField(null), '');
});

test('parseCsv splits a simple header + data row', () => {
  const rows = parseCsv('role,company\nIntern,Acme\n');
  assert.deepEqual(rows, [['role', 'company'], ['Intern', 'Acme']]);
});

test('parseCsv handles a quoted field containing a comma', () => {
  const rows = parseCsv('role,pay\nIntern,"$20,000/yr"\n');
  assert.deepEqual(rows[1], ['Intern', '$20,000/yr']);
});

test('parseCsv strips a leading UTF-8 BOM', () => {
  const rows = parseCsv('﻿role,company\nIntern,Acme\n');
  assert.deepEqual(rows[0], ['role', 'company']);
});

test('parseCsv ignores a trailing blank line', () => {
  const rows = parseCsv('role\nIntern\n\n');
  assert.equal(rows.length, 2);
});

test('guessMapping matches headers to field keys by normalized alias, each field used at most once', () => {
  const headers = ['Role', 'Company', 'Unknown Column'];
  const guesses = guessMapping(headers, FIELD_DEFS);
  assert.deepEqual(guesses, ['role', 'company', '']);
});

test('guessMapping does not double-assign the same field to two headers', () => {
  const headers = ['Role', 'Position']; // both alias to "role"
  const guesses = guessMapping(headers, FIELD_DEFS);
  assert.deepEqual(guesses, ['role', '']);
});

test('buildRowFromMapping builds a real application object with explicit nulls for unmapped fields', () => {
  const row = ['Marketing Intern', 'Acme', '', '$20/hr', '2026-08-11', ''];
  const mapping = { 0: 'role', 1: 'company', 2: 'location', 3: 'pay', 4: 'appliedDate', 5: 'status' };
  const used = new Set();
  const built = buildRowFromMapping(row, mapping, FIELD_DEFS, used);
  assert.deepEqual(built, {
    num: 1, role: 'Marketing Intern', company: 'Acme', location: null, pay: '$20/hr',
    appliedDate: '2026-08-11', status: null
  });
});

test('buildRowFromMapping assigns distinct, increasing nums across a batch seeded with real existing nums', () => {
  const mapping = { 0: 'role', 1: 'company' };
  const used = new Set([1, 2]);
  const first = buildRowFromMapping(['Intern', 'Acme'], mapping, FIELD_DEFS, used);
  const second = buildRowFromMapping(['Analyst', 'Widgets'], mapping, FIELD_DEFS, used);
  assert.equal(first.num, 3);
  assert.equal(second.num, 4);
});

test('buildRowFromMapping normalizes a mapped status column', () => {
  const mapping = { 0: 'status' };
  const built = buildRowFromMapping(['Interview'], mapping, FIELD_DEFS, new Set());
  assert.equal(built.status, 'interview');
});

test('buildRowFromMapping leaves every field not present in the mapping as null, not undefined', () => {
  const mapping = { 0: 'role' };
  const built = buildRowFromMapping(['Intern'], mapping, FIELD_DEFS, new Set());
  assert.equal(built.company, null);
  assert.ok(Object.prototype.hasOwnProperty.call(built, 'company'));
});

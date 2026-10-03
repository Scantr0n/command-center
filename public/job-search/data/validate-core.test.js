#!/usr/bin/env node
/*
 * Regression tests for validate-core.js, the date/text/duplicate rules
 * public/job-search/data/validate.js relies on. No test framework or
 * dependency: node:test and node:assert ship with Node itself, matching
 * every other hub's own *-core.test.js in this repo.
 *
 * Usage: node --test public/job-search/data/validate-core.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isDateOrNull, isFutureDate, emDashFields, isValidSourceUrlOrNull, findDuplicateApplications,
  validateApplications
} = require('./validate-core.js');

const STATUS_LABELS = { interview: 'Interviewing', offer: 'Offer', rejected: 'Rejected', withdrawn: 'Withdrawn' };

test('isDateOrNull accepts null and undefined', () => {
  assert.equal(isDateOrNull(null), true);
  assert.equal(isDateOrNull(undefined), true);
});

test('isDateOrNull accepts a real, correctly zero-padded date', () => {
  assert.equal(isDateOrNull('2026-09-23'), true);
});

test('isDateOrNull rejects a non-zero-padded hand-edit', () => {
  assert.equal(isDateOrNull('2026-9-5'), false);
});

test('isDateOrNull rejects a calendar day that JS Date would silently roll over', () => {
  // "2026-02-30" parses as March 2, 2026 with no error from the Date
  // constructor alone; isDateOrNull must catch that by cross-checking the
  // parsed date's own year/month/day against what was actually typed.
  assert.equal(isDateOrNull('2026-02-30'), false);
  assert.equal(isDateOrNull('2026-09-31'), false);
});

test('isFutureDate is false for null, today, and the past', () => {
  assert.equal(isFutureDate(null), false);
  const today = new Date().toISOString().slice(0, 10);
  assert.equal(isFutureDate(today), false);
  assert.equal(isFutureDate('2020-01-01'), false);
});

test('isFutureDate is true for tomorrow and any date after it', () => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  assert.equal(isFutureDate(tomorrow.toISOString().slice(0, 10)), true);
  assert.equal(isFutureDate('2099-01-01'), true);
});

test('emDashFields flags only the fields that actually contain one', () => {
  const obj = { role: 'Intern' + String.fromCharCode(8212) + 'Marketing', company: 'Acme' };
  assert.deepEqual(emDashFields(obj, ['role', 'company']), ['role']);
});

test('emDashFields returns empty for a missing object', () => {
  assert.deepEqual(emDashFields(null, ['role']), []);
});

test('isValidSourceUrlOrNull accepts null, http(s), and mailto', () => {
  assert.equal(isValidSourceUrlOrNull(null), true);
  assert.equal(isValidSourceUrlOrNull('https://example.com/job'), true);
  assert.equal(isValidSourceUrlOrNull('mailto:jobs@example.com'), true);
});

test('isValidSourceUrlOrNull rejects a placeholder string', () => {
  assert.equal(isValidSourceUrlOrNull('TBD'), false);
});

test('findDuplicateApplications groups entries matching on company + role, case/whitespace-insensitive', () => {
  const apps = [
    { num: 1, company: 'Acme Inc', role: 'Growth Intern' },
    { num: 2, company: ' acme inc ', role: 'growth intern' },
    { num: 3, company: 'Acme Inc', role: 'Design Intern' }
  ];
  const groups = findDuplicateApplications(apps);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].map(a => a.num), [1, 2]);
});

test('findDuplicateApplications never groups on a missing company or role', () => {
  const apps = [
    { num: 1, company: '', role: 'Growth Intern' },
    { num: 2, company: '', role: 'Growth Intern' }
  ];
  assert.deepEqual(findDuplicateApplications(apps), []);
});

test('findDuplicateApplications returns nothing for an all-unique list', () => {
  const apps = [
    { num: 1, company: 'Acme', role: 'Growth Intern' },
    { num: 2, company: 'Widgets Co', role: 'Growth Intern' }
  ];
  assert.deepEqual(findDuplicateApplications(apps), []);
});

test('findDuplicateApplications skips a truthy non-string company or role instead of throwing on .trim()', () => {
  const apps = [
    { num: 1, company: 42, role: 'Growth Intern' },
    { num: 2, company: 'Acme', role: 42 }
  ];
  assert.doesNotThrow(() => findDuplicateApplications(apps));
});

test('validateApplications accepts a fully real, complete application with no errors or warnings', () => {
  const apps = [{ num: 1, role: 'Marketing Intern', company: 'Acme', location: 'NY (Remote)', pay: '$20/hr', appliedDate: '2026-08-11' }];
  const { errors, warnings } = validateApplications(apps, STATUS_LABELS);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
});

test('validateApplications flags a missing "num" and a missing required string field', () => {
  const apps = [{ role: 'Intern', company: 'Acme', location: '', pay: '$20/hr', appliedDate: '2026-08-11' }];
  const { errors } = validateApplications(apps, STATUS_LABELS);
  assert.ok(errors.some(e => e.includes('missing numeric "num"')));
  assert.ok(errors.some(e => e.includes('missing "location"')));
});

test('validateApplications flags a duplicate "num" across two rows', () => {
  const apps = [
    { num: 1, role: 'Intern', company: 'Acme', location: 'NY', pay: '$20/hr', appliedDate: '2026-08-11' },
    { num: 1, role: 'Analyst', company: 'Widgets', location: 'CA', pay: '$22/hr', appliedDate: '2026-08-12' }
  ];
  const { errors } = validateApplications(apps, STATUS_LABELS);
  assert.ok(errors.some(e => e.includes('duplicate "num" 1')));
});

test('validateApplications rejects a status outside the real taxonomy', () => {
  const apps = [{ num: 1, role: 'Intern', company: 'Acme', location: 'NY', pay: '$20/hr', appliedDate: '2026-08-11', status: 'ghosted' }];
  const { errors } = validateApplications(apps, STATUS_LABELS);
  assert.ok(errors.some(e => e.includes('"status" must be one of')));
});

test('validateApplications accepts a real status from the taxonomy', () => {
  const apps = [{ num: 1, role: 'Intern', company: 'Acme', location: 'NY', pay: '$20/hr', appliedDate: '2026-08-11', status: 'interview' }];
  const { errors } = validateApplications(apps, STATUS_LABELS);
  assert.deepEqual(errors, []);
});

test('validateApplications warns on a company+role duplicate across two real rows', () => {
  const apps = [
    { num: 1, role: 'Growth Intern', company: 'Acme Inc', location: 'NY', pay: '$20/hr', appliedDate: '2026-08-11' },
    { num: 2, role: 'Growth Intern', company: 'Acme Inc', location: 'NY', pay: '$20/hr', appliedDate: '2026-08-12' }
  ];
  const { warnings } = validateApplications(apps, STATUS_LABELS);
  assert.ok(warnings.some(w => w.includes('entries match on company + role')));
});

test('validateApplications warns on an em dash in a transcription field without blocking on it', () => {
  const apps = [{ num: 1, role: 'Intern' + String.fromCharCode(8212) + 'Marketing', company: 'Acme', location: 'NY', pay: '$20/hr', appliedDate: '2026-08-11' }];
  const { errors, warnings } = validateApplications(apps, STATUS_LABELS);
  assert.deepEqual(errors, []);
  assert.ok(warnings.some(w => w.includes('"role" contains an em dash')));
});

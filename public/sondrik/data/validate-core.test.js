#!/usr/bin/env node
/*
 * Regression tests for validate-core.js, the shared duplicate-lead logic
 * that both the CLI validator (validate.js) and the live dashboard
 * (app.js) rely on to flag a real contact possibly logged twice. No test
 * framework or dependency: node:test and node:assert ship with Node itself,
 * matching this repo's own no-extra-dependency convention for its data
 * validators. This repo has no test suite anywhere else yet; this covers
 * the one piece of Sondrik's logic worth protecting most, since a silent
 * regression here would mean a real duplicate lead going uncaught, or safe
 * data getting wrongly flagged, in the same trust-sensitive area that
 * caused the real 2026-09-17 incident (see changelog.json).
 *
 * Usage: node --test public/sondrik/data/validate-core.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { findDuplicateLeads, emDashFields } = require('./validate-core.js');

test('empty and single-lead input never flags a duplicate', () => {
  assert.deepEqual(findDuplicateLeads([]), []);
  assert.deepEqual(findDuplicateLeads([{ id: 'a', channelId: 'reddit', sourceDetail: 'Commenter on r/IMadeThis' }]), []);
});

test('same channel + sourceDetail groups as a duplicate, case/whitespace-insensitive', () => {
  const leads = [
    { id: 'a', channelId: 'reddit', sourceDetail: 'Commenter on r/IMadeThis' },
    { id: 'b', channelId: 'reddit', sourceDetail: '  commenter on r/IMadeThis  ' }
  ];
  const groups = findDuplicateLeads(leads);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].map(l => l.id).sort(), ['a', 'b']);
});

test('same sourceDetail on a different channel is not a duplicate', () => {
  const leads = [
    { id: 'a', channelId: 'reddit', sourceDetail: 'Commenter on r/IMadeThis' },
    { id: 'b', channelId: 'hacker-news', sourceDetail: 'Commenter on r/IMadeThis' }
  ];
  assert.deepEqual(findDuplicateLeads(leads), []);
});

test('falls back to channel + source + summary when sourceDetail is unset', () => {
  const leads = [
    { id: 'a', channelId: 'reddit', source: 'Reddit', summary: 'Offered to test the product' },
    { id: 'b', channelId: 'reddit', source: 'Reddit', summary: 'Offered to test the product' }
  ];
  const groups = findDuplicateLeads(leads);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].map(l => l.id).sort(), ['a', 'b']);
});

test('two leads with no sourceDetail and no source/summary never group on an empty key', () => {
  const leads = [
    { id: 'a', channelId: 'reddit' },
    { id: 'b', channelId: 'reddit' }
  ];
  assert.deepEqual(findDuplicateLeads(leads), []);
});

test('three-way duplicate returns all three in one group, not pairwise', () => {
  const leads = [
    { id: 'a', channelId: 'reddit', sourceDetail: 'Same commenter' },
    { id: 'b', channelId: 'reddit', sourceDetail: 'Same commenter' },
    { id: 'c', channelId: 'reddit', sourceDetail: 'Same commenter' }
  ];
  const groups = findDuplicateLeads(leads);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].length, 3);
});

test('the real leads.json on disk has no duplicate lead logged twice', () => {
  const leadsData = require('./leads.json');
  assert.deepEqual(findDuplicateLeads(leadsData.leads || []), []);
});

test('emDashFields flags only the fields that actually contain an em dash', () => {
  const lead = { summary: 'Offered to test the product ' + String.fromCharCode(8212) + ' interested', source: 'Reddit' };
  assert.deepEqual(emDashFields(lead, ['summary', 'source']), ['summary']);
});

test('emDashFields skips a non-string field rather than throwing', () => {
  assert.deepEqual(emDashFields({ label: 42 }, ['label']), []);
});

test('emDashFields returns no hits for a missing object, same as CSM\'s and Garage\'s copies', () => {
  assert.deepEqual(emDashFields(null, ['label']), []);
  assert.deepEqual(emDashFields(undefined, ['label']), []);
});

test('the real releases.json, downloads.json, leads.json, channels.json, and goals.json have no em dash pasted into a free-text field', () => {
  const releases = require('./releases.json').releases || [];
  assert.deepEqual(releases.filter(r => emDashFields(r, ['summary', 'notes']).length), []);

  const downloads = require('./downloads.json');
  const checks = (downloads.metric && downloads.metric.checks) || [];
  assert.deepEqual(checks.filter(c => emDashFields(c, ['note']).length), []);

  const leadsData = require('./leads.json').leads || [];
  assert.deepEqual(leadsData.filter(l => emDashFields(l, ['summary', 'sourceDetail', 'source', 'type']).length), []);
  assert.deepEqual(leadsData.filter(l => emDashFields(l.outreach, ['note', 'draftText']).length), []);

  const channels = require('./channels.json').channels || [];
  assert.deepEqual(channels.filter(c => emDashFields(c, ['name', 'note']).length), []);

  const goals = require('./goals.json').goals || [];
  assert.deepEqual(goals.filter(g => emDashFields(g, ['label', 'note']).length), []);
});

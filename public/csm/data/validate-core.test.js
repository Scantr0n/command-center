#!/usr/bin/env node
/*
 * Regression tests for validate-core.js, the shared duplicate-prospect and
 * casing-drift rules the CLI validator (validate.js) and the dashboard's own
 * "Possible duplicates" / "Casing drift" panels (app.js) both rely on. No
 * test framework or dependency: node:test and node:assert ship with Node
 * itself, matching this repo's own no-extra-dependency convention (see
 * public/cgt/data/validate-core.test.js and public/garage/data/*.test.js for
 * the same pattern).
 *
 * Usage: node --test public/csm/data/validate-core.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { findDuplicateProspects, findCasingDrift } = require('./validate-core.js');

test('findDuplicateProspects flags the same name/company logged under two ids', () => {
  const prospects = [
    { id: 'a', name: 'David Fraga', company: 'City Bound' },
    { id: 'b', name: '  david fraga  ', company: 'CITY BOUND' }
  ];
  const groups = findDuplicateProspects(prospects);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].map(p => p.id).sort(), ['a', 'b']);
});

test('findDuplicateProspects does not flag the same name at a different real company', () => {
  const prospects = [
    { id: 'a', name: 'David Fraga', company: 'City Bound' },
    { id: 'b', name: 'David Fraga', company: 'Other Co' }
  ];
  assert.deepEqual(findDuplicateProspects(prospects), []);
});

test('findDuplicateProspects skips prospects with no name rather than grouping them on a blank key', () => {
  const prospects = [
    { id: 'a', name: null, company: 'City Bound' },
    { id: 'b', name: null, company: 'City Bound' }
  ];
  assert.deepEqual(findDuplicateProspects(prospects), []);
});

test('findDuplicateProspects treats a missing company the same as any other matching company value', () => {
  const prospects = [
    { id: 'a', name: 'David Fraga', company: null },
    { id: 'b', name: 'David Fraga', company: null }
  ];
  const groups = findDuplicateProspects(prospects);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].map(p => p.id).sort(), ['a', 'b']);
});

test('findCasingDrift flags a single-valued field spelled two different ways', () => {
  const prospects = [
    { id: 'a', category: 'Fitness Influencer' },
    { id: 'b', category: 'fitness influencer' }
  ];
  const drift = findCasingDrift(prospects, p => [p.category]);
  assert.equal(drift.length, 1);
  assert.equal(drift[0].variants.size, 2);
  assert.deepEqual(drift[0].prospects.map(p => p.id).sort(), ['a', 'b']);
});

test('findCasingDrift does not flag consistent spelling, or a value only used once', () => {
  const prospects = [
    { id: 'a', category: 'Fitness Influencer' },
    { id: 'b', category: 'Fitness Influencer' },
    { id: 'c', category: 'Tech Reviewer' }
  ];
  assert.deepEqual(findCasingDrift(prospects, p => [p.category]), []);
});

test('findCasingDrift ignores null/empty values rather than grouping them as a variant', () => {
  const prospects = [
    { id: 'a', category: null },
    { id: 'b', category: '' },
    { id: 'c', category: 'Tech Reviewer' }
  ];
  assert.deepEqual(findCasingDrift(prospects, p => [p.category]), []);
});

test('findCasingDrift counts a multi-valued field once per prospect, not once per raw value', () => {
  // A single prospect with two of its own socialSnapshots differently-cased
  // for the same real platform used to inflate the drift count as if two
  // separate prospects needed the same fix, see validate-core.js's own
  // comment on this. One prospect contributing two raw variants of the same
  // platform should still only add that prospect to entry.prospects once.
  const prospects = [
    { id: 'a', socialSnapshots: [{ platform: 'Douyin' }, { platform: 'douyin' }] },
    { id: 'b', socialSnapshots: [{ platform: 'Weibo' }] }
  ];
  const drift = findCasingDrift(prospects, p => (p.socialSnapshots || []).map(s => s.platform));
  assert.equal(drift.length, 1);
  assert.deepEqual(drift[0].prospects.map(p => p.id), ['a']);
});

test('findCasingDrift still flags real cross-prospect drift on a multi-valued field', () => {
  const prospects = [
    { id: 'a', socialSnapshots: [{ platform: 'Douyin' }] },
    { id: 'b', socialSnapshots: [{ platform: 'douyin' }] }
  ];
  const drift = findCasingDrift(prospects, p => (p.socialSnapshots || []).map(s => s.platform));
  assert.equal(drift.length, 1);
  assert.deepEqual(drift[0].prospects.map(p => p.id).sort(), ['a', 'b']);
});

test('the real prospects.json on disk has no duplicate prospects or casing drift', () => {
  const data = require('./prospects.json');
  const prospects = data.prospects || [];
  assert.deepEqual(findDuplicateProspects(prospects), []);
  assert.deepEqual(findCasingDrift(prospects, p => [p.category]), []);
  assert.deepEqual(
    findCasingDrift(prospects, p => (p.socialSnapshots || []).map(s => s.platform)),
    []
  );
});

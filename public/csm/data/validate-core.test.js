#!/usr/bin/env node
/*
 * Regression tests for validate-core.js, the shared duplicate-prospect,
 * casing-drift, reused-hook, and reused-contact rules the CLI validator
 * (validate.js) and the
 * dashboard's own "Possible duplicates" / "Casing drift" / "Reused verified
 * hook" / "Reused named contact" panels (app.js) both rely on. No
 * test framework or dependency: node:test and node:assert ship with Node
 * itself, matching this repo's own no-extra-dependency convention (see
 * public/cgt/data/validate-core.test.js and public/garage/data/*.test.js for
 * the same pattern).
 *
 * Usage: node --test public/csm/data/validate-core.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { findDuplicateProspects, findCasingDrift, findDuplicateHooks, findReusedContactDetail, isDateOrNull, validateProspects } = require('./validate-core.js');
const { emDashFields, hasLegacySocialSnapshotField } = require('./csm-core.js');
const REAL_HELPERS = { emDashFields, hasLegacySocialSnapshotField };
const STAGES = require('./stages.json').stages;

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

test('findDuplicateProspects skips a truthy non-string name or company instead of throwing on .trim()', () => {
  assert.doesNotThrow(() => findDuplicateProspects([
    { id: 'a', name: 42, company: 'City Bound' },
    { id: 'b', name: 'David Fraga', company: 42 }
  ]));
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

test('findCasingDrift skips a truthy non-string value instead of throwing on .trim()', () => {
  assert.doesNotThrow(() => findCasingDrift([{ id: 'a', category: 42 }, { id: 'b', category: 42 }], p => [p.category]));
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

test('findDuplicateHooks flags the same hook text logged on two different prospects', () => {
  const prospects = [
    { id: 'a', verifiedHook: 'Runs a Douyin fitness account with real engagement in our niche.' },
    { id: 'b', verifiedHook: '  RUNS A DOUYIN FITNESS ACCOUNT WITH REAL ENGAGEMENT IN OUR NICHE.  ' }
  ];
  const groups = findDuplicateHooks(prospects);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].map(p => p.id).sort(), ['a', 'b']);
});

test('findDuplicateHooks collapses internal whitespace differences, not just casing', () => {
  const prospects = [
    { id: 'a', verifiedHook: 'Real  hook   text' },
    { id: 'b', verifiedHook: 'real hook text' }
  ];
  const groups = findDuplicateHooks(prospects);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].map(p => p.id).sort(), ['a', 'b']);
});

test('findDuplicateHooks does not flag two real, distinct hooks', () => {
  const prospects = [
    { id: 'a', verifiedHook: 'Real hook for prospect A.' },
    { id: 'b', verifiedHook: 'Real hook for prospect B.' }
  ];
  assert.deepEqual(findDuplicateHooks(prospects), []);
});

test('findDuplicateHooks skips prospects with no verifiedHook rather than grouping them on a blank key', () => {
  const prospects = [
    { id: 'a', verifiedHook: null },
    { id: 'b', verifiedHook: '' },
    { id: 'c', verifiedHook: '   ' }
  ];
  assert.deepEqual(findDuplicateHooks(prospects), []);
});

test('findReusedContactDetail flags the same named-decision-maker detail logged on two different prospects', () => {
  const prospects = [
    { id: 'a', contactChannel: { type: 'named-decision-maker', detail: 'Someone@Brand.com' } },
    { id: 'b', contactChannel: { type: 'named-decision-maker', detail: '  someone@brand.com  ' } }
  ];
  const groups = findReusedContactDetail(prospects);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].map(p => p.id).sort(), ['a', 'b']);
});

test('findReusedContactDetail never flags a reused generic-inbox detail, only named-decision-maker', () => {
  const prospects = [
    { id: 'a', contactChannel: { type: 'generic-inbox', detail: 'business@agency.com' } },
    { id: 'b', contactChannel: { type: 'generic-inbox', detail: 'business@agency.com' } }
  ];
  assert.deepEqual(findReusedContactDetail(prospects), []);
});

test('findReusedContactDetail does not flag two real, distinct named contacts', () => {
  const prospects = [
    { id: 'a', contactChannel: { type: 'named-decision-maker', detail: 'a@brand.com' } },
    { id: 'b', contactChannel: { type: 'named-decision-maker', detail: 'b@brand.com' } }
  ];
  assert.deepEqual(findReusedContactDetail(prospects), []);
});

test('findReusedContactDetail skips prospects with no logged detail, or no contactChannel at all, rather than grouping them on a blank key', () => {
  const prospects = [
    { id: 'a', contactChannel: { type: 'named-decision-maker', detail: null } },
    { id: 'b', contactChannel: { type: 'named-decision-maker', detail: '' } },
    { id: 'c', contactChannel: null },
    { id: 'd' }
  ];
  assert.deepEqual(findReusedContactDetail(prospects), []);
});

test('the real prospects.json on disk has no duplicate prospects, casing drift, reused hooks, or reused named contacts', () => {
  const data = require('./prospects.json');
  const prospects = data.prospects || [];
  assert.deepEqual(findDuplicateProspects(prospects), []);
  assert.deepEqual(findCasingDrift(prospects, p => [p.category]), []);
  assert.deepEqual(
    findCasingDrift(prospects, p => (p.socialSnapshots || []).map(s => s.platform)),
    []
  );
  assert.deepEqual(findDuplicateHooks(prospects), []);
  assert.deepEqual(findReusedContactDetail(prospects), []);
});

test('isDateOrNull accepts null/undefined, a real YYYY-MM-DD date, rejects a rolled-over impossible date', () => {
  assert.equal(isDateOrNull(null), true);
  assert.equal(isDateOrNull(undefined), true);
  assert.equal(isDateOrNull('2026-09-05'), true);
  assert.equal(isDateOrNull('2026-02-30'), false);
  assert.equal(isDateOrNull('not-a-date'), false);
});

test('validateProspects flags a minimal valid prospect with no errors', () => {
  const prospects = [{
    id: 'a', name: 'Real Name', stage: 'researched',
    contactChannel: { type: null, detail: null }, nudgeSchedule: {},
    socialSnapshots: [], contentIdeas: [], stageHistory: [], outreachLog: []
  }];
  const { errors } = validateProspects(prospects, STAGES, REAL_HELPERS);
  assert.deepEqual(errors, []);
});

test('validateProspects errors on a stage id that does not match any real stage (the silent-vanish bug)', () => {
  const prospects = [{ id: 'a', name: 'Real Name', stage: 'not-a-real-stage' }];
  const { errors } = validateProspects(prospects, STAGES, REAL_HELPERS);
  assert.ok(errors.some(e => e.includes('does not match any id in stages.json')));
});

test('validateProspects errors on a missing id or name', () => {
  const { errors } = validateProspects([{ name: 'Real Name', stage: 'researched' }, { id: 'a', stage: 'researched' }], STAGES, REAL_HELPERS);
  assert.ok(errors.some(e => e.includes('missing "id"')));
  assert.ok(errors.some(e => e.includes('missing "name"')));
});

test('validateProspects errors on a duplicate id across two prospects', () => {
  const { errors } = validateProspects([
    { id: 'a', name: 'First', stage: 'researched' },
    { id: 'a', name: 'Second', stage: 'researched' }
  ], STAGES, REAL_HELPERS);
  assert.ok(errors.some(e => e.includes('duplicate id "a"')));
});

test('validateProspects warns when outreach-sent has no verifiedHook or contactChannel.type logged', () => {
  const { warnings } = validateProspects([{ id: 'a', name: 'Real Name', stage: 'outreach-sent' }], STAGES, REAL_HELPERS);
  assert.ok(warnings.some(w => w.includes('contactChannel.type is not logged')));
  assert.ok(warnings.some(w => w.includes('verifiedHook is not logged')));
});

test('validateProspects errors on an out-of-order nudgeSchedule (doNotNudgeBefore after nudgePoint)', () => {
  const { errors } = validateProspects([{
    id: 'a', name: 'Real Name', stage: 'outreach-sent',
    nudgeSchedule: { doNotNudgeBefore: '2026-10-10', nudgePoint: '2026-10-01' }
  }], STAGES, REAL_HELPERS);
  assert.ok(errors.some(e => e.includes('doNotNudgeBefore is after')));
});

test('validateProspects runs the em-dash and legacy-field checks only when helpers are passed in', () => {
  const prospects = [{ id: 'a', name: 'Real Name' + String.fromCharCode(8212) + 'Inc', stage: 'researched', socialSnapshot: { platform: 'Douyin' } }];
  const withHelpers = validateProspects(prospects, STAGES, REAL_HELPERS);
  assert.ok(withHelpers.warnings.some(w => w.includes('em dash')));
  assert.ok(withHelpers.errors.some(e => e.includes('legacy "socialSnapshot"')));
  const withoutHelpers = validateProspects(prospects, STAGES);
  assert.ok(!withoutHelpers.warnings.some(w => w.includes('em dash')));
  assert.ok(!withoutHelpers.errors.some(e => e.includes('legacy "socialSnapshot"')));
});

test('validateProspects on the real prospects.json/stages.json on disk matches the CLI validator: no errors', () => {
  const prospects = require('./prospects.json').prospects || [];
  const { errors } = validateProspects(prospects, STAGES, REAL_HELPERS);
  assert.deepEqual(errors, []);
});

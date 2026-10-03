#!/usr/bin/env node
/*
 * Regression tests for import-core.js, the CSV-parsing/row-building logic
 * behind the "Import CSV" bulk prospect importer (import.js). No test
 * framework or dependency: node:test and node:assert ship with Node itself,
 * matching this repo's own no-extra-dependency convention (see
 * public/cgt/data/import-core.test.js for the same pattern).
 *
 * Usage: node --test public/csm/data/import-core.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeHeader, normalizeStage, normalizeChannelType, coerceField, csvField,
  parseCsv, guessMapping, buildRowFromMapping
} = require('./import-core.js');
const { slugifyProspectId, nextAvailableId } = require('./csm-core.js');

function idGenerator(name, company) {
  return slugifyProspectId(name, company).id;
}

test('normalizeHeader lowercases and strips non-alphanumerics', () => {
  assert.equal(normalizeHeader('Contact Channel Type'), 'contactchanneltype');
  assert.equal(normalizeHeader('  Next-Nudge_Date  '), 'nextnudgedate');
});

test('normalizeStage maps real spreadsheet variants to the exact stage ids stages.json uses', () => {
  assert.equal(normalizeStage('Researched'), 'researched');
  assert.equal(normalizeStage('Outreach Sent'), 'outreach-sent');
  assert.equal(normalizeStage('contacted'), 'outreach-sent');
  assert.equal(normalizeStage('Exploring'), 'in-exploration');
  assert.equal(normalizeStage('Won'), 'client');
});

test('normalizeStage defaults a blank cell to "researched", a freshly-imported row by definition', () => {
  assert.equal(normalizeStage(''), 'researched');
  assert.equal(normalizeStage(null), 'researched');
});

test('normalizeStage leaves an unrecognized value as-is rather than guessing, so it fails validation visibly', () => {
  assert.equal(normalizeStage('somehow-won-already'), 'somehow-won-already');
});

test('normalizeChannelType maps real variants to the two schema values', () => {
  assert.equal(normalizeChannelType('Named Decision Maker'), 'named-decision-maker');
  assert.equal(normalizeChannelType('DM'), 'named-decision-maker');
  assert.equal(normalizeChannelType('Agency Inbox'), 'generic-inbox');
  assert.equal(normalizeChannelType('generic'), 'generic-inbox');
});

test('normalizeChannelType returns null for a blank cell, not a guessed value', () => {
  assert.equal(normalizeChannelType(''), null);
  assert.equal(normalizeChannelType(null), null);
});

test('coerceField parses a number field, stripping $/,/% but rejects non-numeric text as null', () => {
  assert.equal(coerceField('12,000', 'number'), 12000);
  assert.equal(coerceField('4.2%', 'number'), 4.2);
  assert.equal(coerceField('not a number', 'number'), null);
});

test('coerceField returns null for a null/undefined value regardless of type', () => {
  assert.equal(coerceField(null, 'number'), null);
  assert.equal(coerceField(undefined, 'stage'), null);
});

test('coerceField with no type returns the value unchanged (plain trimmed text)', () => {
  assert.equal(coerceField('Hello', undefined), 'Hello');
});

test('csvField quotes a value containing a comma, quote, or newline; leaves a plain value bare', () => {
  assert.equal(csvField('plain'), 'plain');
  assert.equal(csvField('a,b'), '"a,b"');
  assert.equal(csvField('say "hi"'), '"say ""hi"""');
  assert.equal(csvField(null), '');
});

test('parseCsv handles a quoted field containing a comma and an escaped quote', () => {
  const rows = parseCsv('name,note\n"Doe, Jane","said ""hi"" once"\n');
  assert.deepEqual(rows, [['name', 'note'], ['Doe, Jane', 'said "hi" once']]);
});

test('parseCsv handles both \\n and \\r\\n line endings and strips a leading BOM', () => {
  const rows = parseCsv('﻿a,b\r\n1,2\n3,4');
  assert.deepEqual(rows, [['a', 'b'], ['1', '2'], ['3', '4']]);
});

test('parseCsv drops a fully blank trailing line rather than returning a phantom empty row', () => {
  const rows = parseCsv('a,b\n1,2\n');
  assert.deepEqual(rows, [['a', 'b'], ['1', '2']]);
});

const FIELD_DEFS = [
  { key: 'id', aliases: ['id', 'slug'] },
  { key: 'name', aliases: ['name'] },
  { key: 'company', aliases: ['company'] },
  { key: 'stage', aliases: ['stage'], type: 'stage' },
  { key: 'channelType', aliases: ['contactchanneltype', 'channeltype'], type: 'channelType' },
  { key: 'channelDetail', aliases: ['contactchanneldetail', 'channeldetail'] },
  { key: 'doNotNudgeBefore', aliases: ['donotnudgebefore'] },
  { key: 'nudgePoint', aliases: ['nudgepoint'] },
  { key: 'snapPlatform', aliases: ['platform'] },
  { key: 'snapFollowers', aliases: ['followers'], type: 'number' },
  { key: 'snapEngagementRate', aliases: ['engagementrate'], type: 'number' },
  { key: 'snapAsOfDate', aliases: ['asofdate'] },
  { key: 'snapProfileUrl', aliases: ['profileurl'] },
  { key: 'notes', aliases: ['notes'] }
];

test('guessMapping auto-maps headers to field keys by normalized alias, ignoring an unmatched header', () => {
  const guesses = guessMapping(['Name', 'Company', 'Random Column'], FIELD_DEFS);
  assert.deepEqual(guesses, ['name', 'company', '']);
});

test('guessMapping only auto-maps a given field once, so two similarly-named columns don\'t collide', () => {
  const defs = [{ key: 'name', aliases: ['name'] }];
  const guesses = guessMapping(['Name', 'Full Name (name)'], defs);
  assert.deepEqual(guesses, ['name', '']);
});

test('buildRowFromMapping builds the real nested prospects.json shape from flat CSV columns', () => {
  const header = ['name', 'company', 'stage', 'contactchanneltype', 'contactchanneldetail', 'platform', 'followers', 'asofdate'];
  const row = ['Jane Doe', 'Example Co', 'outreach sent', 'named decision maker', 'jane@example.com', 'Douyin', '12,500', '2026-09-01'];
  const mapping = Object.fromEntries(guessMapping(header, FIELD_DEFS).map((f, i) => [i, f]).filter(([, f]) => f));
  const usedIds = new Set();
  const built = buildRowFromMapping(row, mapping, usedIds, FIELD_DEFS, idGenerator);

  assert.equal(built.name, 'Jane Doe');
  assert.equal(built.company, 'Example Co');
  assert.equal(built.stage, 'outreach-sent');
  assert.deepEqual(built.contactChannel, { type: 'named-decision-maker', detail: 'jane@example.com' });
  assert.deepEqual(built.nudgeSchedule, { doNotNudgeBefore: null, nudgePoint: null });
  assert.deepEqual(built.socialSnapshots, [{ platform: 'Douyin', followers: 12500, engagementRate: null, asOfDate: '2026-09-01', profileUrl: null }]);
  assert.deepEqual(built.contentIdeas, []);
  assert.deepEqual(built.stageHistory, []);
  assert.deepEqual(built.outreachLog, []);
  assert.equal(built.id, 'example-co-jane-doe');
});

test('buildRowFromMapping leaves socialSnapshots empty when no platform column was mapped/filled', () => {
  const mapping = { 0: 'name' };
  const built = buildRowFromMapping(['Jane Doe'], mapping, new Set(), FIELD_DEFS, idGenerator);
  assert.deepEqual(built.socialSnapshots, []);
});

test('buildRowFromMapping defaults a blank stage cell to "researched"', () => {
  const mapping = { 0: 'name' };
  const built = buildRowFromMapping(['Jane Doe'], mapping, new Set(), FIELD_DEFS, idGenerator);
  assert.equal(built.stage, 'researched');
});

test('buildRowFromMapping de-dupes a generated id against already-used ids, matching nextAvailableId\'s own suffix rule', () => {
  const mapping = { 0: 'name', 1: 'company' };
  const usedIds = new Set();
  const first = buildRowFromMapping(['Jane Doe', 'Example Co'], mapping, usedIds, FIELD_DEFS, idGenerator);
  const second = buildRowFromMapping(['Jane Doe', 'Example Co'], mapping, usedIds, FIELD_DEFS, idGenerator);
  assert.equal(first.id, 'example-co-jane-doe');
  assert.equal(second.id, nextAvailableId('example-co-jane-doe', new Set([first.id])).id);
  assert.notEqual(first.id, second.id);
});

test('buildRowFromMapping respects an explicit id column instead of generating one', () => {
  const mapping = { 0: 'id', 1: 'name' };
  const built = buildRowFromMapping(['custom-id', 'Jane Doe'], mapping, new Set(), FIELD_DEFS, idGenerator);
  assert.equal(built.id, 'custom-id');
});

test('buildRowFromMapping treats a blank mapped cell as null, not an empty string', () => {
  const mapping = { 0: 'name', 1: 'company' };
  const built = buildRowFromMapping(['Jane Doe', ''], mapping, new Set(), FIELD_DEFS, idGenerator);
  assert.equal(built.company, null);
});

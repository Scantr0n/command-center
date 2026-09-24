#!/usr/bin/env node
/*
 * Regression tests for import-core.js: the CSV parser, cell coercion,
 * id-slugging, and column-guessing behind the CSV importer's parse -> map
 * -> preview -> validate -> download pipeline. No test framework or
 * dependency: node:test and node:assert ship with Node itself, matching
 * this repo's own no-extra-dependency convention (see
 * public/sondrik/data/*.test.js for the same pattern).
 *
 * Usage: node --test public/cgt/data/import-core.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeHeader, normalizeBasis, coerceField, slugify, csvField,
  parseCsv, guessMapping, buildRowFromMapping
} = require('./import-core.js');

test('normalizeHeader lowercases and strips non-alphanumeric characters', () => {
  assert.equal(normalizeHeader('Card Name'), 'cardname');
  assert.equal(normalizeHeader('Est. Value ($)'), 'estvalue');
  assert.equal(normalizeHeader(''), '');
  assert.equal(normalizeHeader(null), '');
});

test('normalizeBasis maps every documented alias to its canonical value', () => {
  assert.equal(normalizeBasis('Sale'), 'recent-sale');
  assert.equal(normalizeBasis('recent sale'), 'recent-sale');
  assert.equal(normalizeBasis('sold'), 'recent-sale');
  assert.equal(normalizeBasis('Comp'), 'comp-estimate');
  assert.equal(normalizeBasis('comp estimate'), 'comp-estimate');
  assert.equal(normalizeBasis(''), null);
  assert.equal(normalizeBasis(null), null);
});

test('normalizeBasis leaves an unrecognized value as-is so validation flags it, rather than guessing', () => {
  assert.equal(normalizeBasis('guesstimate'), 'guesstimate');
});

test('coerceField strips currency symbols and commas before parsing a number', () => {
  assert.equal(coerceField('$1,250.50', 'number'), 1250.5);
  assert.equal(coerceField('1,250', 'int'), 1250);
});

test('coerceField rounds int type but keeps number type exact', () => {
  assert.equal(coerceField('10.6', 'int'), 11);
  assert.equal(coerceField('10.6', 'number'), 10.6);
});

test('coerceField returns null for unparseable numbers instead of NaN', () => {
  assert.equal(coerceField('n/a', 'number'), null);
  assert.equal(coerceField('n/a', 'int'), null);
});

test('coerceField returns null for a null value regardless of type', () => {
  assert.equal(coerceField(null, 'number'), null);
  assert.equal(coerceField(null, 'upper'), null);
});

test('coerceField upper/lower-cases text fields', () => {
  assert.equal(coerceField('psa', 'upper'), 'PSA');
  assert.equal(coerceField('Baseball', 'lower'), 'baseball');
});

test('coerceField passes plain text through untouched when no type is given', () => {
  assert.equal(coerceField('2021 Topps Chrome', undefined), '2021 Topps Chrome');
});

test('slugify lowercases, replaces runs of non-alphanumerics with a single hyphen, and trims edge hyphens', () => {
  assert.equal(slugify('2021 Topps Chrome!!  Julio Rodriguez', 'row'), '2021-topps-chrome-julio-rodriguez');
  assert.equal(slugify('--leading and trailing--', 'row'), 'leading-and-trailing');
});

test('slugify falls back when the input reduces to nothing', () => {
  assert.equal(slugify('', 'card'), 'card');
  assert.equal(slugify('!!!', 'card'), 'card');
  assert.equal(slugify(null, 'row'), 'row');
});

test('csvField quotes a field containing a comma, quote, or newline; leaves plain text bare', () => {
  assert.equal(csvField('plain'), 'plain');
  assert.equal(csvField('a,b'), '"a,b"');
  assert.equal(csvField('a"b'), '"a""b"');
  assert.equal(csvField('a\nb'), '"a\nb"');
  assert.equal(csvField(null), '');
});

test('parseCsv splits a simple header and data row on commas', () => {
  const rows = parseCsv('a,b,c\n1,2,3\n');
  assert.deepEqual(rows, [['a', 'b', 'c'], ['1', '2', '3']]);
});

test('parseCsv keeps a comma inside a quoted field as part of that field', () => {
  const rows = parseCsv('name,note\n"Smith, John",fine\n');
  assert.deepEqual(rows, [['name', 'note'], ['Smith, John', 'fine']]);
});

test('parseCsv unescapes a doubled quote inside a quoted field', () => {
  const rows = parseCsv('note\n"she said ""hi"""\n');
  assert.deepEqual(rows, [['note'], ['she said "hi"']]);
});

test('parseCsv keeps a newline inside a quoted field as part of that field, not a new row', () => {
  const rows = parseCsv('note\n"line one\nline two"\n');
  assert.deepEqual(rows, [['note'], ['line one\nline two']]);
});

test('parseCsv handles both \\n and \\r\\n line endings', () => {
  const lf = parseCsv('a,b\n1,2\n');
  const crlf = parseCsv('a,b\r\n1,2\r\n');
  assert.deepEqual(lf, crlf);
});

test('parseCsv strips a leading BOM without leaving it in the first header cell', () => {
  const rows = parseCsv('﻿a,b\n1,2\n');
  assert.equal(rows[0][0], 'a');
});

test('parseCsv drops a genuinely blank trailing line but keeps a row of all-empty cells', () => {
  const rows = parseCsv('a,b\n1,2\n\n');
  assert.deepEqual(rows, [['a', 'b'], ['1', '2']]);
  const blankCells = parseCsv('a,b\n,\n');
  assert.deepEqual(blankCells, [['a', 'b'], ['', '']]);
});

test('guessMapping auto-maps a header to the field whose alias list contains it', () => {
  const dataset = { fieldDefs: [
    { key: 'cardName', aliases: ['cardname', 'card', 'name'] },
    { key: 'year', aliases: ['year', 'cardyear'] }
  ] };
  assert.deepEqual(guessMapping(['Card Name', 'Year'], dataset), ['cardName', 'year']);
});

test('guessMapping leaves an unrecognized header unmapped rather than guessing', () => {
  const dataset = { fieldDefs: [{ key: 'cardName', aliases: ['cardname'] }] };
  assert.deepEqual(guessMapping(['Some Random Column'], dataset), ['']);
});

test('guessMapping only auto-maps a field to the first matching column, so a second similarly-named column is left unmapped', () => {
  // Regression guard for the exact bug class this file exists to prevent:
  // two columns whose normalized header both match "grader"'s alias list
  // (e.g. a real export with both "Grader" and "Grading Co" columns) must
  // not both silently collapse onto the same schema field.
  const dataset = { fieldDefs: [{ key: 'gradingCompany', aliases: ['grader', 'gradingcompany'] }] };
  assert.deepEqual(guessMapping(['Grader', 'Grading Company'], dataset), ['gradingCompany', '']);
});

test('buildRowFromMapping coerces mapped columns, leaves unmapped fields undefined, and turns blank cells into null', () => {
  const dataset = {
    idFields: ['cardName'], idFallback: 'card',
    fieldDefs: [
      { key: 'id' },
      { key: 'cardName' },
      { key: 'year', type: 'number' },
      { key: 'notes' }
    ]
  };
  const row = buildRowFromMapping(['Julio Rodriguez RC', '2021', ''], { 0: 'cardName', 1: 'year', 2: 'notes' }, new Set(), dataset);
  assert.equal(row.cardName, 'Julio Rodriguez RC');
  assert.equal(row.year, 2021);
  assert.equal(row.notes, null);
  assert.equal(row.id, 'julio-rodriguez-rc');
});

test('buildRowFromMapping never drops an unrelated field silently, the exact BGS-subgrade-column round-trip bug', () => {
  // A real shipped bug: a mapping for BGS subgrade columns was silently
  // dropped on a CSV round-trip. Every mapped column, subgrade or not, must
  // land on its schema field.
  const dataset = {
    idFields: ['cardName'], idFallback: 'card',
    fieldDefs: [
      { key: 'id' },
      { key: 'cardName' },
      { key: 'subgradeCentering', type: 'number' },
      { key: 'subgradeCorners', type: 'number' },
      { key: 'subgradeEdges', type: 'number' },
      { key: 'subgradeSurface', type: 'number' }
    ]
  };
  const mapping = { 0: 'cardName', 1: 'subgradeCentering', 2: 'subgradeCorners', 3: 'subgradeEdges', 4: 'subgradeSurface' };
  const row = buildRowFromMapping(['Some BGS Card', '9.5', '9', '9.5', '10'], mapping, new Set(), dataset);
  assert.equal(row.subgradeCentering, 9.5);
  assert.equal(row.subgradeCorners, 9);
  assert.equal(row.subgradeEdges, 9.5);
  assert.equal(row.subgradeSurface, 10);
});

test('buildRowFromMapping uses the explicit id column when given, slugified, ignoring idFields', () => {
  const dataset = { idFields: ['cardName'], idFallback: 'card', fieldDefs: [{ key: 'id' }, { key: 'cardName' }] };
  const row = buildRowFromMapping(['My Custom ID!', 'Ignored Name'], { 0: 'id', 1: 'cardName' }, new Set(), dataset);
  assert.equal(row.id, 'my-custom-id');
});

test('buildRowFromMapping appends idSuffix only to an auto-generated id, never to an explicit one', () => {
  const dataset = { idFields: ['cardName'], idFallback: 'candidate', idSuffix: '-raw', fieldDefs: [{ key: 'id' }, { key: 'cardName' }] };
  const auto = buildRowFromMapping(['Upper Deck Rookie'], { 0: 'cardName' }, new Set(), dataset);
  assert.equal(auto.id, 'upper-deck-rookie-raw');
  const explicit = buildRowFromMapping(['Upper Deck Rookie', 'custom-id'], { 0: 'cardName', 1: 'id' }, new Set(), dataset);
  assert.equal(explicit.id, 'custom-id');
});

test('buildRowFromMapping de-duplicates a generated id against ids already seen, including pre-seeded ones', () => {
  const dataset = { idFields: ['cardName'], idFallback: 'card', fieldDefs: [{ key: 'id' }, { key: 'cardName' }] };
  const usedIds = new Set(['same-name']);
  const first = buildRowFromMapping(['Same Name'], { 0: 'cardName' }, usedIds, dataset);
  const second = buildRowFromMapping(['Same Name'], { 0: 'cardName' }, usedIds, dataset);
  assert.equal(first.id, 'same-name-2');
  assert.equal(second.id, 'same-name-3');
});

test('buildRowFromMapping falls back to idFallback when every idFields value is missing', () => {
  const dataset = { idFields: ['cardName', 'year'], idFallback: 'card', fieldDefs: [{ key: 'id' }, { key: 'cardName' }] };
  const row = buildRowFromMapping([''], { 0: 'cardName' }, new Set(), dataset);
  assert.equal(row.id, 'card');
});

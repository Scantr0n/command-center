#!/usr/bin/env node
/*
 * Regression tests for validate-core.js, the shared cards/submissions/
 * candidates validation rules both the CLI validator (validate.js) and the
 * browser-side CSV import tool (import.js) rely on. No test framework or
 * dependency: node:test and node:assert ship with Node itself, matching
 * this repo's own no-extra-dependency convention (see
 * public/sondrik/data/*.test.js for the same pattern). Covers the two real
 * cross-row checks (possible duplicate, grade/price mix-up) plus the date
 * guard and the top-level validators' "never guess a price" rule, since a
 * silent regression in any of these means a real bad row goes uncaught, or
 * a real clean row gets wrongly flagged.
 *
 * Usage: node --test public/cgt/data/validate-core.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isDateOrNull, findDuplicateGroups, findDuplicateCertGroups, findDuplicateCandidateGroups, findGradeLadderInversions,
  findListingPriceMismatches, validateCards, validateSubmissions, validateCandidates
} = require('./validate-core.js');

test('isDateOrNull accepts null and real calendar dates, rejects impossible ones', () => {
  assert.equal(isDateOrNull(null), true);
  assert.equal(isDateOrNull(undefined), true);
  assert.equal(isDateOrNull('2026-08-08'), true);
  assert.equal(isDateOrNull('2026-13-01'), false); // no month 13
  assert.equal(isDateOrNull('2026-02-30'), false); // Feb never has 30 days
  assert.equal(isDateOrNull('not-a-date'), false);
  assert.equal(isDateOrNull(20260808), false); // must be a string, not a number
});

test('findDuplicateGroups flags the same card name/year/company/grade on two rows', () => {
  const cards = [
    { id: 'a', cardName: 'Connor McDavid Rookie', year: 2015, gradingCompany: 'PSA', grade: '9' },
    { id: 'b', cardName: '  connor mcdavid rookie  ', year: 2015, gradingCompany: 'PSA', grade: '9' }
  ];
  const groups = findDuplicateGroups(cards);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].cards.map(c => c.id).sort(), ['a', 'b']);
});

test('findDuplicateGroups does not flag the same card at a different real grade', () => {
  const cards = [
    { id: 'a', cardName: 'Connor McDavid Rookie', year: 2015, gradingCompany: 'PSA', grade: '9' },
    { id: 'b', cardName: 'Connor McDavid Rookie', year: 2015, gradingCompany: 'PSA', grade: '10' }
  ];
  assert.deepEqual(findDuplicateGroups(cards), []);
});

test('findDuplicateGroups skips rows missing cardName, gradingCompany, or grade rather than grouping on a blank key', () => {
  const cards = [
    { id: 'a', cardName: null, year: 2015, gradingCompany: 'PSA', grade: '9' },
    { id: 'b', cardName: null, year: 2015, gradingCompany: 'PSA', grade: '9' }
  ];
  assert.deepEqual(findDuplicateGroups(cards), []);
});

test('findDuplicateCertGroups flags the same grading company and cert number on two rows', () => {
  const cards = [
    { id: 'a', cardName: 'Connor McDavid Rookie', gradingCompany: 'PSA', certNumber: '12345678' },
    { id: 'b', cardName: 'Different Name Entirely', gradingCompany: 'PSA', certNumber: '12345678' }
  ];
  const groups = findDuplicateCertGroups(cards);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].cards.map(c => c.id).sort(), ['a', 'b']);
});

test('findDuplicateCertGroups does not flag the same cert number at two different grading companies', () => {
  const cards = [
    { id: 'a', cardName: 'Connor McDavid Rookie', gradingCompany: 'PSA', certNumber: '12345678' },
    { id: 'b', cardName: 'Connor McDavid Rookie', gradingCompany: 'BGS', certNumber: '12345678' }
  ];
  assert.deepEqual(findDuplicateCertGroups(cards), []);
});

test('findDuplicateCertGroups skips rows missing certNumber or gradingCompany rather than grouping on a blank key', () => {
  const cards = [
    { id: 'a', cardName: 'Connor McDavid Rookie', gradingCompany: 'PSA', certNumber: null },
    { id: 'b', cardName: 'Connor McDavid Rookie', gradingCompany: 'PSA', certNumber: null }
  ];
  assert.deepEqual(findDuplicateCertGroups(cards), []);
});

test('findDuplicateCandidateGroups flags the same card name/year/sport on two rows, ignoring grading fields the candidate does not have yet', () => {
  const candidates = [
    { id: 'a', cardName: 'Cam Neely', year: 1990, sport: 'hockey' },
    { id: 'b', cardName: '  cam neely  ', year: 1990, sport: 'hockey' }
  ];
  const groups = findDuplicateCandidateGroups(candidates);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].candidates.map(c => c.id).sort(), ['a', 'b']);
});

test('findDuplicateCandidateGroups does not flag the same card name in a different year or sport', () => {
  const candidates = [
    { id: 'a', cardName: 'Cam Neely', year: 1990, sport: 'hockey' },
    { id: 'b', cardName: 'Cam Neely', year: 1991, sport: 'hockey' },
    { id: 'c', cardName: 'Cam Neely', year: 1990, sport: 'baseball' }
  ];
  assert.deepEqual(findDuplicateCandidateGroups(candidates), []);
});

test('findDuplicateCandidateGroups skips rows missing cardName or sport rather than grouping on a blank key', () => {
  const candidates = [
    { id: 'a', cardName: null, year: 1990, sport: 'hockey' },
    { id: 'b', cardName: null, year: 1990, sport: 'hockey' }
  ];
  assert.deepEqual(findDuplicateCandidateGroups(candidates), []);
});

test('findGradeLadderInversions flags a higher grade priced below a lower grade of the same card', () => {
  const cards = [
    { id: 'low', cardName: 'Neal Broten Rookie', year: 1982, sport: 'hockey', gradingCompany: 'PSA', grade: '9', estimatedValue: 200 },
    { id: 'high', cardName: 'Neal Broten Rookie', year: 1982, sport: 'hockey', gradingCompany: 'PSA', grade: '10', estimatedValue: 150 }
  ];
  const flags = findGradeLadderInversions(cards);
  assert.equal(flags.length, 1);
  assert.equal(flags[0].lower.id, 'low');
  assert.equal(flags[0].higher.id, 'high');
});

test('findGradeLadderInversions does not flag a normal, correctly-ordered grade ladder', () => {
  const cards = [
    { id: 'low', cardName: 'Neal Broten Rookie', year: 1982, sport: 'hockey', gradingCompany: 'PSA', grade: '5', estimatedValue: 2 },
    { id: 'high', cardName: 'Neal Broten Rookie', year: 1982, sport: 'hockey', gradingCompany: 'PSA', grade: '9', estimatedValue: 55 }
  ];
  assert.deepEqual(findGradeLadderInversions(cards), []);
});

test('findGradeLadderInversions skips unpriced rows and non-numeric grades', () => {
  const cards = [
    { id: 'a', cardName: 'X', year: 2000, sport: 'hockey', gradingCompany: 'PSA', grade: '9', estimatedValue: null },
    { id: 'b', cardName: 'X', year: 2000, sport: 'hockey', gradingCompany: 'PSA', grade: 'Authentic', estimatedValue: 10 }
  ];
  assert.deepEqual(findGradeLadderInversions(cards), []);
});

test('validateCards requires a labeled valuationBasis whenever estimatedValue is set', () => {
  const { errors } = validateCards([
    { id: 'a', cardName: 'X', sport: 'hockey', estimatedValue: 50, valuationBasis: null }
  ]);
  assert.ok(errors.some(e => e.includes('valuationBasis')));
});

test('validateCards requires a compNote whenever valuationBasis is comp-estimate', () => {
  const { errors } = validateCards([
    { id: 'a', cardName: 'X', sport: 'hockey', estimatedValue: 50, valuationBasis: 'comp-estimate', compNote: null }
  ]);
  assert.ok(errors.some(e => e.includes('compNote')));
});

test('validateCards passes a fully-labeled real-sale card clean', () => {
  const { errors } = validateCards([
    { id: 'a', cardName: 'X', sport: 'hockey', estimatedValue: 50, valuationBasis: 'recent-sale', datePriced: '2026-08-08' }
  ]);
  assert.deepEqual(errors, []);
});

test('validateCards requires soldDate and soldPrice together, not one without the other', () => {
  const missingDate = validateCards([{ id: 'a', cardName: 'X', sport: 'hockey', soldPrice: 20, soldDate: null }]);
  assert.ok(missingDate.errors.some(e => e.includes('soldDate')));

  const missingPrice = validateCards([{ id: 'a', cardName: 'X', sport: 'hockey', soldDate: '2026-08-08', soldPrice: null }]);
  assert.ok(missingPrice.errors.some(e => e.includes('soldPrice')));
});

test('validateCards rejects a negative or non-numeric sellingFees, accepts null', () => {
  const negative = validateCards([{ id: 'a', cardName: 'X', sport: 'hockey', soldDate: '2026-08-08', soldPrice: 20, sellingFees: -1 }]);
  assert.ok(negative.errors.some(e => e.includes('sellingFees')));

  const nullOk = validateCards([{ id: 'a', cardName: 'X', sport: 'hockey', soldDate: '2026-08-08', soldPrice: 20, sellingFees: null }]);
  assert.ok(!nullOk.errors.some(e => e.includes('sellingFees')));
});

test('validateCards errors when sellingFees is logged with no real sale to apply it to', () => {
  const { errors } = validateCards([{ id: 'a', cardName: 'X', sport: 'hockey', soldPrice: null, soldDate: null, sellingFees: 5 }]);
  assert.ok(errors.some(e => e.includes('sellingFees') && e.includes('soldPrice')));
});

test('validateCards warns, but does not error, when sellingFees meets or exceeds the gross soldPrice', () => {
  const { errors, warnings } = validateCards([{ id: 'a', cardName: 'X', sport: 'hockey', soldDate: '2026-08-08', soldPrice: 20, sellingFees: 20 }]);
  assert.deepEqual(errors, []);
  assert.ok(warnings.some(w => w.includes('sellingFees') && w.includes('soldPrice')));
});

test('validateCards passes a real sale with a logged sellingFees clean', () => {
  const { errors } = validateCards([{ id: 'a', cardName: 'X', sport: 'hockey', soldDate: '2026-08-08', soldPrice: 20, sellingFees: 2.75 }]);
  assert.deepEqual(errors, []);
});

test('validateCards rejects a bad acquisitionDate but accepts null', () => {
  const bad = validateCards([{ id: 'a', cardName: 'X', sport: 'hockey', acquisitionDate: '2026-02-30' }]);
  assert.ok(bad.errors.some(e => e.includes('acquisitionDate')));

  const nullOk = validateCards([{ id: 'a', cardName: 'X', sport: 'hockey', acquisitionDate: null }]);
  assert.deepEqual(nullOk.errors, []);
});

test('validateCards warns when costBasis is logged with no acquisitionDate to classify a future sale by', () => {
  const { warnings } = validateCards([{ id: 'a', cardName: 'X', sport: 'hockey', costBasis: 20, acquisitionDate: null }]);
  assert.ok(warnings.some(w => w.includes('acquisitionDate')));
});

test('validateCards does not warn about acquisitionDate when costBasis is not logged, or when both are logged', () => {
  const noCostBasis = validateCards([{ id: 'a', cardName: 'X', sport: 'hockey', costBasis: null, acquisitionDate: null }]);
  assert.ok(!noCostBasis.warnings.some(w => w.includes('acquisitionDate')));

  const both = validateCards([{ id: 'a', cardName: 'X', sport: 'hockey', costBasis: 20, acquisitionDate: '2025-01-01' }]);
  assert.ok(!both.warnings.some(w => w.includes('acquisitionDate')));
});

test('validateCards errors when soldDate is before acquisitionDate, a real impossibility', () => {
  const { errors } = validateCards([{
    id: 'a', cardName: 'X', sport: 'hockey', acquisitionDate: '2026-08-08', soldDate: '2026-01-01', soldPrice: 20
  }]);
  assert.ok(errors.some(e => e.includes('soldDate') && e.includes('acquisitionDate')));
});

test('validateCards passes a normal acquisitionDate-before-soldDate card clean', () => {
  const { errors } = validateCards([{
    id: 'a', cardName: 'X', sport: 'hockey', acquisitionDate: '2024-01-01', soldDate: '2026-01-01', soldPrice: 20
  }]);
  assert.deepEqual(errors, []);
});

test('validateCards requires listedDate and listedPrice together, not one without the other', () => {
  const missingDate = validateCards([{ id: 'a', cardName: 'X', sport: 'hockey', listedPrice: 20, listedDate: null }]);
  assert.ok(missingDate.errors.some(e => e.includes('listedDate')));

  const missingPrice = validateCards([{ id: 'a', cardName: 'X', sport: 'hockey', listedDate: '2026-08-08', listedPrice: null }]);
  assert.ok(missingPrice.errors.some(e => e.includes('listedPrice')));
});

test('validateCards warns when a card is both sold and still carries listing fields', () => {
  const { warnings } = validateCards([{
    id: 'a', cardName: 'X', sport: 'hockey',
    soldDate: '2026-08-08', soldPrice: 40,
    listedDate: '2026-07-01', listedPrice: 45
  }]);
  assert.ok(warnings.some(w => w.includes('listedPrice') && w.includes('soldPrice')));
});

test('validateCards passes a currently-listed unsold card clean, and does not require it to match estimatedValue', () => {
  const { errors } = validateCards([{
    id: 'a', cardName: 'X', sport: 'hockey',
    estimatedValue: 50, valuationBasis: 'recent-sale', datePriced: '2026-08-08',
    listedDate: '2026-08-15', listedPrice: 55
  }]);
  assert.deepEqual(errors, []);
});

test('findListingPriceMismatches flags a listing far above its own researched estimate', () => {
  const cards = [
    { id: 'a', cardName: 'X', estimatedValue: 50, listedPrice: 100, listedDate: '2026-08-08' }
  ];
  const flags = findListingPriceMismatches(cards);
  assert.equal(flags.length, 1);
  assert.equal(flags[0].direction, 'above');
});

test('findListingPriceMismatches flags a listing far below its own researched estimate', () => {
  const cards = [
    { id: 'a', cardName: 'X', estimatedValue: 100, listedPrice: 40, listedDate: '2026-08-08' }
  ];
  const flags = findListingPriceMismatches(cards);
  assert.equal(flags.length, 1);
  assert.equal(flags[0].direction, 'below');
});

test('findListingPriceMismatches does not flag a listing that is only modestly above book, or a sold card', () => {
  const cards = [
    { id: 'a', cardName: 'X', estimatedValue: 100, listedPrice: 120, listedDate: '2026-08-08' },
    { id: 'b', cardName: 'Y', estimatedValue: 100, listedPrice: 300, listedDate: '2026-08-08', soldDate: '2026-08-09', soldPrice: 290 }
  ];
  assert.deepEqual(findListingPriceMismatches(cards), []);
});

test('validateCards accepts real BGS subgrades in half-point steps, rejects out-of-range or off-step values', () => {
  const clean = validateCards([
    { id: 'a', cardName: 'X', sport: 'hockey', gradingCompany: 'BGS', grade: '9.5',
      subgradeCentering: 9.5, subgradeCorners: 10, subgradeEdges: 9.5, subgradeSurface: 9.5 }
  ]);
  assert.deepEqual(clean.errors, []);

  const outOfRange = validateCards([{ id: 'a', cardName: 'X', sport: 'hockey', gradingCompany: 'BGS', subgradeCentering: 11 }]);
  assert.ok(outOfRange.errors.some(e => e.includes('subgradeCentering')));

  const offStep = validateCards([{ id: 'a', cardName: 'X', sport: 'hockey', gradingCompany: 'BGS', subgradeCorners: 9.3 }]);
  assert.ok(offStep.errors.some(e => e.includes('subgradeCorners')));
});

test('validateCards warns when a subgrade is logged against a non-BGS card', () => {
  const { warnings } = validateCards([{ id: 'a', cardName: 'X', sport: 'hockey', gradingCompany: 'PSA', subgradeSurface: 10 }]);
  assert.ok(warnings.some(w => w.includes('subgrade') && w.includes('BGS')));
});

test('validateSubmissions requires returnedDate once status is returned', () => {
  const { warnings } = validateSubmissions([
    { id: 'a', description: 'test batch', gradingCompany: 'PSA', status: 'returned', returnedDate: null }
  ]);
  assert.ok(warnings.some(w => w.includes('returnedDate')));
});

test('validateCandidates requires a labeled basis on rawValue and expectedGradedValue independently', () => {
  const rawOnly = validateCandidates([
    { id: 'a', cardName: 'X', sport: 'hockey', rawValue: 5, rawValueBasis: null }
  ]);
  assert.ok(rawOnly.errors.some(e => e.includes('rawValueBasis')));

  const gradedOnly = validateCandidates([
    { id: 'a', cardName: 'X', sport: 'hockey', expectedGradedValue: 50, gradedValueBasis: null }
  ]);
  assert.ok(gradedOnly.errors.some(e => e.includes('gradedValueBasis')));
});

test('validateCandidates warns on a possible duplicate candidate (same card name/year/sport on two rows)', () => {
  const { warnings } = validateCandidates([
    { id: 'a', cardName: 'Cam Neely', year: 1990, sport: 'hockey' },
    { id: 'b', cardName: 'Cam Neely', year: 1990, sport: 'hockey' }
  ]);
  assert.ok(warnings.some(w => w.includes('possible duplicate candidate') && w.includes('a') && w.includes('b')));
});

test('the real cards.json, submissions.json, and candidates.json on disk each validate clean', () => {
  const cardsData = require('./cards.json');
  const submissionsData = require('./submissions.json');
  const candidatesData = require('./candidates.json');
  assert.deepEqual(validateCards(cardsData.cards || []).errors, []);
  assert.deepEqual(validateSubmissions(submissionsData.submissions || []).errors, []);
  assert.deepEqual(validateCandidates(candidatesData.candidates || []).errors, []);
});

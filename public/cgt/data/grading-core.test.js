#!/usr/bin/env node
/*
 * Regression tests for grading-core.js, the "is this raw card worth
 * grading?" 2x-margin math the "Worth grading?" section and its CSV export
 * both depend on. No test framework or dependency: node:test and
 * node:assert ship with Node itself, matching this repo's own
 * no-extra-dependency convention for its data validators (see
 * public/sondrik/data/*.test.js for the same pattern).
 *
 * Usage: node --test public/cgt/data/grading-core.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { computeGradingMath, GRADING_RISK_MULTIPLE } = require('./grading-core.js');

test('missing rawValue, expectedGradedValue, or estimatedGradingCost returns null, never a guessed verdict', () => {
  assert.equal(computeGradingMath({ rawValue: null, expectedGradedValue: 50, estimatedGradingCost: 10 }), null);
  assert.equal(computeGradingMath({ rawValue: 5, expectedGradedValue: null, estimatedGradingCost: 10 }), null);
  assert.equal(computeGradingMath({ rawValue: 5, expectedGradedValue: 50, estimatedGradingCost: null }), null);
  assert.equal(computeGradingMath({}), null);
});

test('gross gain exactly at the 2x-margin threshold counts as worth grading, not marginal', () => {
  // totalCost 10, gross gain must be >= 20 to hit the documented 2x rule.
  const math = computeGradingMath({ rawValue: 5, expectedGradedValue: 25, estimatedGradingCost: 10, shippingCost: null });
  assert.equal(math.totalCost, 10);
  assert.equal(math.expectedGain, 10);
  assert.equal(math.verdict, 'worth-grading');
});

test('gross gain one dollar under the 2x threshold is marginal, not worth-grading', () => {
  const math = computeGradingMath({ rawValue: 5, expectedGradedValue: 24, estimatedGradingCost: 10, shippingCost: null });
  assert.equal(math.verdict, 'marginal');
  assert.ok(math.expectedGain > 0, 'marginal still means a net positive expected gain');
});

test('expected gain at or below zero is not worth it', () => {
  const breakEven = computeGradingMath({ rawValue: 5, expectedGradedValue: 15, estimatedGradingCost: 10, shippingCost: null });
  assert.equal(breakEven.expectedGain, 0);
  assert.equal(breakEven.verdict, 'not-worth');

  const losing = computeGradingMath({ rawValue: 5, expectedGradedValue: 10, estimatedGradingCost: 10, shippingCost: null });
  assert.ok(losing.expectedGain < 0);
  assert.equal(losing.verdict, 'not-worth');
});

test('shippingCost is added into totalCost when present, and defaults to zero when null/omitted', () => {
  const withShipping = computeGradingMath({ rawValue: 0, expectedGradedValue: 50, estimatedGradingCost: 10, shippingCost: 5 });
  assert.equal(withShipping.totalCost, 15);

  const withoutShipping = computeGradingMath({ rawValue: 0, expectedGradedValue: 50, estimatedGradingCost: 10, shippingCost: null });
  assert.equal(withoutShipping.totalCost, 10);

  const omittedShipping = computeGradingMath({ rawValue: 0, expectedGradedValue: 50, estimatedGradingCost: 10 });
  assert.equal(omittedShipping.totalCost, 10);
});

test('the documented multiple is 2x, not some other threshold silently changed later', () => {
  assert.equal(GRADING_RISK_MULTIPLE, 2);
});

test('the real candidates.json never crashes computeGradingMath on any row', () => {
  const data = require('./candidates.json');
  for (const c of data.candidates || []) {
    assert.doesNotThrow(() => computeGradingMath(c), `candidate ${c.id} should not throw`);
  }
});

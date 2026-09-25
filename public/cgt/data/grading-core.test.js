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
const {
  computeGradingMath, GRADING_RISK_MULTIPLE, TYPICAL_MARKETPLACE_FEE_RATE,
  classifyHoldingPeriod, isLongTermHolding, estimateCollectiblesTax,
  COLLECTIBLES_LONG_TERM_MAX_RATE, TOP_ORDINARY_INCOME_RATE,
  isSold, isListed, costPerCard, computeGainLoss, computeRealizedGainLoss,
  estimateCardCollectiblesTax, lastPriceHistoryEntry, computeValueTrend,
  buildPortfolioValueTimeline
} = require('./grading-core.js');

test('missing rawValue, expectedGradedValue, or estimatedGradingCost returns null, never a guessed verdict', () => {
  assert.equal(computeGradingMath({ rawValue: null, expectedGradedValue: 50, estimatedGradingCost: 10 }), null);
  assert.equal(computeGradingMath({ rawValue: 5, expectedGradedValue: null, estimatedGradingCost: 10 }), null);
  assert.equal(computeGradingMath({ rawValue: 5, expectedGradedValue: 50, estimatedGradingCost: null }), null);
  assert.equal(computeGradingMath({}), null);
});

// expectedGradedValue is netted against TYPICAL_MARKETPLACE_FEE_RATE before
// anything else runs, so these derive the raw expectedGradedValue input from
// a target *net* graded value instead of hardcoding a pre-fee number, same
// as computeGradingMath itself does. Keeps the tests correct regardless of
// the exact published rate rather than baking today's 13.25% into every
// expected number by hand.
function gradedValueForNet(netGradedValue) {
  return netGradedValue / (1 - TYPICAL_MARKETPLACE_FEE_RATE);
}

test('gross gain exactly at the 2x-margin threshold, net of the marketplace fee, counts as worth grading, not marginal', () => {
  // totalCost 10, net-of-fee gross gain must be >= 20 to hit the documented 2x rule.
  const math = computeGradingMath({ rawValue: 5, expectedGradedValue: gradedValueForNet(25), estimatedGradingCost: 10, shippingCost: null });
  assert.equal(math.totalCost, 10);
  assert.ok(Math.abs(math.grossGain - 20) < 1e-9);
  assert.ok(Math.abs(math.expectedGain - 10) < 1e-9);
  assert.equal(math.verdict, 'worth-grading');
});

test('net-of-fee gross gain one dollar under the 2x threshold is marginal, not worth-grading', () => {
  const math = computeGradingMath({ rawValue: 5, expectedGradedValue: gradedValueForNet(24), estimatedGradingCost: 10, shippingCost: null });
  assert.equal(math.verdict, 'marginal');
  assert.ok(math.expectedGain > 0, 'marginal still means a net positive expected gain');
});

test('expected gain at or below zero (after the marketplace fee) is not worth it', () => {
  const breakEven = computeGradingMath({ rawValue: 5, expectedGradedValue: gradedValueForNet(15), estimatedGradingCost: 10, shippingCost: null });
  assert.ok(Math.abs(breakEven.expectedGain) < 1e-9);
  assert.equal(breakEven.verdict, 'not-worth');

  const losing = computeGradingMath({ rawValue: 5, expectedGradedValue: gradedValueForNet(10), estimatedGradingCost: 10, shippingCost: null });
  assert.ok(losing.expectedGain < 0);
  assert.equal(losing.verdict, 'not-worth');
});

test('the marketplace fee is netted off expectedGradedValue only, never off rawValue', () => {
  const math = computeGradingMath({ rawValue: 100, expectedGradedValue: 200, estimatedGradingCost: 10, shippingCost: null });
  const expectedNet = 200 * (1 - TYPICAL_MARKETPLACE_FEE_RATE);
  assert.ok(Math.abs(math.netGradedValue - expectedNet) < 1e-9);
  assert.ok(Math.abs(math.grossGain - (expectedNet - 100)) < 1e-9);
});

test('the documented marketplace fee rate is eBay\'s real 13.25% Sports Trading Cards rate, not some other category\'s', () => {
  assert.equal(TYPICAL_MARKETPLACE_FEE_RATE, 0.1325);
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

test('isLongTermHolding/classifyHoldingPeriod return null when either date is missing or unparseable', () => {
  assert.equal(isLongTermHolding(null, '2026-01-01'), null);
  assert.equal(isLongTermHolding('2025-01-01', null), null);
  assert.equal(isLongTermHolding('not-a-date', '2026-01-01'), null);
  assert.equal(classifyHoldingPeriod(null, null), null);
});

test('a sale on the exact one-year anniversary is still short-term, not long-term', () => {
  // IRS Pub. 550: the day acquired is excluded from the count, so "more than
  // one year" requires at least one day past the anniversary date.
  assert.equal(isLongTermHolding('2025-01-15', '2026-01-15'), false);
  assert.equal(classifyHoldingPeriod('2025-01-15', '2026-01-15'), 'short-term');
});

test('a sale the day after the one-year anniversary is long-term', () => {
  assert.equal(isLongTermHolding('2025-01-15', '2026-01-16'), true);
  assert.equal(classifyHoldingPeriod('2025-01-15', '2026-01-16'), 'long-term');
});

test('holding period math handles a leap-day (Feb 29) acquisition without throwing or misdating', () => {
  // 2024 is a leap year; 2025 is not, so "the anniversary of 2024-02-29" has
  // no literal 2025-02-29 to land on. JS Date's own month/day rollover
  // normalizes new Date(2025, 1, 29) to 2025-03-01, so that date (and
  // anything before it) is still short-term, and only the day after,
  // 2025-03-02, is long-term. A rare edge case, but a real one (leap-day
  // acquisitions happen), and this is deterministic rather than throwing or
  // silently misclassifying it.
  assert.equal(classifyHoldingPeriod('2024-02-29', '2025-03-01'), 'short-term');
  assert.equal(classifyHoldingPeriod('2024-02-29', '2025-03-02'), 'long-term');
});

test('a sale well under a year old is short-term', () => {
  assert.equal(classifyHoldingPeriod('2026-06-01', '2026-08-01'), 'short-term');
});

test('estimateCollectiblesTax returns null for a missing, zero, or negative gain', () => {
  assert.equal(estimateCollectiblesTax(null, '2024-01-01', '2026-01-01'), null);
  assert.equal(estimateCollectiblesTax(0, '2024-01-01', '2026-01-01'), null);
  assert.equal(estimateCollectiblesTax(-5, '2024-01-01', '2026-01-01'), null);
});

test('estimateCollectiblesTax returns null when the holding period can\'t be classified', () => {
  assert.equal(estimateCollectiblesTax(100, null, '2026-01-01'), null);
  assert.equal(estimateCollectiblesTax(100, '2024-01-01', null), null);
});

test('estimateCollectiblesTax caps a long-term gain at the documented 28% collectibles rate', () => {
  const est = estimateCollectiblesTax(1000, '2024-01-01', '2026-01-02');
  assert.equal(est.holding, 'long-term');
  assert.equal(est.maxRate, COLLECTIBLES_LONG_TERM_MAX_RATE);
  assert.equal(est.maxTax, 280);
});

test('estimateCollectiblesTax uses the top ordinary-income rate as a short-term ceiling', () => {
  const est = estimateCollectiblesTax(1000, '2026-06-01', '2026-08-01');
  assert.equal(est.holding, 'short-term');
  assert.equal(est.maxRate, TOP_ORDINARY_INCOME_RATE);
  assert.equal(est.maxTax, 370);
});

test('the documented collectibles rates have not silently drifted', () => {
  assert.equal(COLLECTIBLES_LONG_TERM_MAX_RATE, 0.28);
  assert.equal(TOP_ORDINARY_INCOME_RATE, 0.37);
});

test('the real cards.json never crashes estimateCollectiblesTax on any sold row', () => {
  const data = require('./cards.json');
  for (const c of data.cards || []) {
    if (c.soldDate == null || c.soldPrice == null) continue;
    const gain = c.costBasis != null ? c.soldPrice - c.costBasis : null;
    assert.doesNotThrow(() => estimateCollectiblesTax(gain, c.acquisitionDate, c.soldDate), `card ${c.id} should not throw`);
  }
});

test('isSold/isListed read soldDate/listedDate directly, independent of each other', () => {
  assert.equal(isSold({ soldDate: '2026-01-01' }), true);
  assert.equal(isSold({ soldDate: null }), false);
  assert.equal(isListed({ listedDate: '2026-01-01' }), true);
  assert.equal(isListed({ listedDate: null }), false);
  // A sold card can still carry a stale listedDate (validate-core.js only
  // warns, doesn't block), so the two are independent flags, not opposites.
  assert.equal(isSold({ soldDate: '2026-01-01', listedDate: '2025-06-01' }), true);
});

test('costPerCard divides cost by cardCount, and returns null rather than a misleading average when either is missing', () => {
  assert.equal(costPerCard({ cost: 45, cardCount: 12 }), 3.75);
  assert.equal(costPerCard({ cost: null, cardCount: 12 }), null);
  assert.equal(costPerCard({ cost: 45, cardCount: 0 }), null);
  assert.equal(costPerCard({ cost: 45, cardCount: null }), null);
});

test('computeGainLoss requires both costBasis and estimatedValue, never guesses a missing side as zero', () => {
  assert.equal(computeGainLoss({ costBasis: null, estimatedValue: 50 }), null);
  assert.equal(computeGainLoss({ costBasis: 10, estimatedValue: null }), null);
  const gl = computeGainLoss({ costBasis: 10, estimatedValue: 25 });
  assert.equal(gl.abs, 15);
  assert.equal(gl.pct, 150);
});

test('computeRealizedGainLoss only counts a card that is actually sold with both a real cost basis and sale price', () => {
  assert.equal(computeRealizedGainLoss({ soldDate: null, costBasis: 10, soldPrice: 25 }), null, 'not sold');
  assert.equal(computeRealizedGainLoss({ soldDate: '2026-01-01', costBasis: null, soldPrice: 25 }), null, 'no cost basis');
  assert.equal(computeRealizedGainLoss({ soldDate: '2026-01-01', costBasis: 10, soldPrice: null }), null, 'no sale price');
  const rgl = computeRealizedGainLoss({ soldDate: '2026-01-01', costBasis: 10, soldPrice: 30 });
  assert.equal(rgl.abs, 20);
  assert.equal(rgl.pct, 200);
  assert.equal(rgl.netProceeds, 30, 'no sellingFees logged falls back to the gross soldPrice');
});

test('computeRealizedGainLoss nets a real logged sellingFees out of the gross soldPrice before comparing to costBasis', () => {
  const rgl = computeRealizedGainLoss({ soldDate: '2026-01-01', costBasis: 10, soldPrice: 30, sellingFees: 4 });
  assert.equal(rgl.netProceeds, 26, 'net proceeds is soldPrice minus the real fee');
  assert.equal(rgl.abs, 16, 'gain is measured off net proceeds, not the gross sale price');
  assert.equal(rgl.pct, 160);
});

test('computeRealizedGainLoss with sellingFees that would flip a gross gain into a net loss', () => {
  const rgl = computeRealizedGainLoss({ soldDate: '2026-01-01', costBasis: 20, soldPrice: 22, sellingFees: 5 });
  assert.equal(rgl.netProceeds, 17);
  assert.equal(rgl.abs, -3, 'a fee can turn what looked like a gross profit into a real net loss');
});

test('estimateCardCollectiblesTax returns null for an unsold card, a loss, or a sale with no acquisitionDate', () => {
  assert.equal(estimateCardCollectiblesTax({ soldDate: null }), null, 'unsold');
  assert.equal(estimateCardCollectiblesTax({ soldDate: '2026-06-01', costBasis: 30, soldPrice: 10 }), null, 'a loss');
  assert.equal(estimateCardCollectiblesTax({ soldDate: '2026-06-01', costBasis: 10, soldPrice: 30, acquisitionDate: null }), null, 'no acquisitionDate');
});

test('estimateCardCollectiblesTax computes a real long-term-vs-short-term estimate off a real realized gain', () => {
  const est = estimateCardCollectiblesTax({
    soldDate: '2026-06-01', acquisitionDate: '2024-01-01', costBasis: 100, soldPrice: 500
  });
  assert.equal(est.holding, 'long-term');
  assert.equal(est.maxRate, COLLECTIBLES_LONG_TERM_MAX_RATE);
  assert.equal(est.maxTax, 400 * COLLECTIBLES_LONG_TERM_MAX_RATE);
});

test('lastPriceHistoryEntry returns the most recent entry by date, regardless of array order', () => {
  assert.equal(lastPriceHistoryEntry({ priceHistory: [] }), null);
  assert.equal(lastPriceHistoryEntry({}), null);
  const unsorted = [{ date: '2026-01-01', value: 10 }, { date: '2026-06-01', value: 25 }, { date: '2026-03-01', value: 15 }];
  assert.deepEqual(lastPriceHistoryEntry({ priceHistory: unsorted }), { date: '2026-06-01', value: 25 });
});

test('computeValueTrend compares current estimatedValue against the most recent prior priceHistory entry', () => {
  assert.equal(computeValueTrend({ priceHistory: [], estimatedValue: 50 }), null, 'no prior entry to compare against');
  assert.equal(computeValueTrend({ priceHistory: [{ date: '2026-01-01', value: 10 }], estimatedValue: null }), null, 'no current value');
  const trend = computeValueTrend({ priceHistory: [{ date: '2026-01-01', value: 10 }], estimatedValue: 15 });
  assert.equal(trend.abs, 5);
  assert.equal(trend.pct, 50);
  assert.equal(trend.prevValue, 10);
  assert.equal(trend.prevDate, '2026-01-01');
});

test('the real cards.json never crashes computeGainLoss/computeRealizedGainLoss/estimateCardCollectiblesTax/computeValueTrend on any row', () => {
  const data = require('./cards.json');
  for (const c of data.cards || []) {
    assert.doesNotThrow(() => computeGainLoss(c), `card ${c.id} computeGainLoss should not throw`);
    assert.doesNotThrow(() => computeRealizedGainLoss(c), `card ${c.id} computeRealizedGainLoss should not throw`);
    assert.doesNotThrow(() => estimateCardCollectiblesTax(c), `card ${c.id} estimateCardCollectiblesTax should not throw`);
    assert.doesNotThrow(() => computeValueTrend(c), `card ${c.id} computeValueTrend should not throw`);
  }
});

test('buildPortfolioValueTimeline returns null for no cards, or fewer than 2 distinct priced dates', () => {
  assert.equal(buildPortfolioValueTimeline([]), null);
  assert.equal(buildPortfolioValueTimeline(null), null);
  assert.equal(buildPortfolioValueTimeline([{ estimatedValue: 10, datePriced: '2026-01-01' }]), null, 'one card, one date, not a trend');
  // Two cards, but both priced on the exact same single date, is still one distinct date.
  assert.equal(buildPortfolioValueTimeline([
    { estimatedValue: 10, datePriced: '2026-01-01' },
    { estimatedValue: 20, datePriced: '2026-01-01' }
  ]), null);
});

test('buildPortfolioValueTimeline excludes a card missing estimatedValue or datePriced entirely, including its priceHistory dates', () => {
  const result = buildPortfolioValueTimeline([
    { estimatedValue: 10, datePriced: '2026-01-01' },
    { estimatedValue: null, datePriced: '2026-02-01', priceHistory: [{ date: '2026-01-15', value: 5 }] },
    { estimatedValue: 20, datePriced: null, priceHistory: [{ date: '2026-01-20', value: 8 }] },
    { estimatedValue: 30, datePriced: '2026-03-01' }
  ]);
  const dates = result.map(t => t.date);
  assert.deepEqual(dates, ['2026-01-01', '2026-03-01'], 'the unpriced/undated cards never contribute a date at all');
});

test('buildPortfolioValueTimeline sums every card counted at that date and tracks countedCards', () => {
  const result = buildPortfolioValueTimeline([
    { estimatedValue: 100, datePriced: '2026-01-01' },
    { estimatedValue: 50, datePriced: '2026-02-01' }
  ]);
  assert.deepEqual(result, [
    { date: '2026-01-01', total: 100, countedCards: 1 },
    { date: '2026-02-01', total: 150, countedCards: 2 }
  ]);
});

test('buildPortfolioValueTimeline uses each card\'s latest real point on or before a date, not a straight-line guess', () => {
  // Card re-priced 10 -> 25 -> 15 over time; a snapshot date between two
  // real points must use the earlier one, never interpolate or peek ahead.
  const card = {
    estimatedValue: 15, datePriced: '2026-04-01',
    priceHistory: [{ date: '2026-01-01', value: 10 }, { date: '2026-03-01', value: 25 }]
  };
  const other = { estimatedValue: 1, datePriced: '2026-02-15' }; // just to create a 3rd distinct date
  const result = buildPortfolioValueTimeline([card, other]);
  const byDate = Object.fromEntries(result.map(r => [r.date, r]));
  assert.equal(byDate['2026-01-01'].total, 10, 'first real point');
  assert.equal(byDate['2026-02-15'].total, 10 + 1, 'still the Jan point, Mar point is still in the future');
  assert.equal(byDate['2026-03-01'].total, 25 + 1, 'the Mar re-price point');
  assert.equal(byDate['2026-04-01'].total, 15 + 1, 'the current estimatedValue/datePriced point');
});

test('buildPortfolioValueTimeline never counts a card before its own first real point', () => {
  const lateCard = { estimatedValue: 40, datePriced: '2026-05-01' };
  const earlyCard = { estimatedValue: 10, datePriced: '2026-01-01' };
  const result = buildPortfolioValueTimeline([lateCard, earlyCard]);
  const byDate = Object.fromEntries(result.map(r => [r.date, r]));
  assert.equal(byDate['2026-01-01'].countedCards, 1, 'only the early card has a real point yet');
  assert.equal(byDate['2026-01-01'].total, 10);
  assert.equal(byDate['2026-05-01'].countedCards, 2);
  assert.equal(byDate['2026-05-01'].total, 50);
});

test('buildPortfolioValueTimeline drops a card entirely from the date its soldDate lands on, never counting a sold card\'s value', () => {
  const soldCard = { estimatedValue: 20, datePriced: '2026-01-01', soldDate: '2026-03-01', soldPrice: 25 };
  const heldCard = { estimatedValue: 5, datePriced: '2026-02-01' };
  const result = buildPortfolioValueTimeline([soldCard, heldCard]);
  const byDate = Object.fromEntries(result.map(r => [r.date, r]));
  assert.equal(byDate['2026-01-01'].countedCards, 1, 'sold card still counts before its own soldDate');
  assert.equal(byDate['2026-02-01'].countedCards, 2);
  // '2026-03-01' is the soldDate itself: the break condition is soldDate <=
  // date, so the sold card drops out on its OWN sale date too, not just
  // strictly after it.
  const soldDatePoint = result.find(r => r.date === '2026-03-01');
  if (soldDatePoint) {
    assert.equal(soldDatePoint.countedCards, 1, 'the sold card is excluded on its own sale date, the held card remains');
    assert.equal(soldDatePoint.total, 5);
  }
});

test('the real cards.json never crashes buildPortfolioValueTimeline', () => {
  const data = require('./cards.json');
  assert.doesNotThrow(() => buildPortfolioValueTimeline(data.cards || []));
});

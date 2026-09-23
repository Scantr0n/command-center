#!/usr/bin/env node
/*
 * Regression tests for garage-core.js, the fee/date math both the live
 * dashboard (public/garage/app.js) and this file rely on. Covers, in
 * particular, the four real bugs this exact math has already produced (see
 * garage-core.js's own header comment and changelog.json): a double-charged
 * eBay processing fee, a "shoes category" rate mixed up with an effective
 * rate (twice, in opposite directions), a Poshmark dispute deadline computed
 * on business days instead of the real-time clock it runs on, and a relist
 * stat counting a listing with nothing left to relist.
 *
 * Usage: node --test public/garage/data/garage-core.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  estimateNetPayout, ebayMinPriceForNet, depopMinPriceForNet, poshmarkMinPriceForNet,
  minListingPriceForNet, addDaysToDateStr, addBusinessDays, disputeResponseDeadline,
  remainingPlatforms, daysSincePublished, isDueForRelist, relistGuidanceParts,
  poshmarkWeightTier, bundleNetComparison,
  irsMileageRateForDate, mileageRateGapReason, computeExpenseAmount,
  computePoshmarkShareStreak,
  RELIST_FRESH_DAYS, POSHMARK_HOLD_DAYS, DEPOP_BOOST_FEE_PCT
} = require('./garage-core.js');

test('estimateNetPayout: eBay charges the 13.6% standard rate + the $0.30/$0.40 per-order step for a non-shoes/unset category', () => {
  // A $30 sale with no category nets 30 - (30*0.136 + 0.40) = 25.52, not the
  // ~14.9% effective rate an earlier bug mistook for a category-specific
  // percentage.
  assert.equal(Math.round(estimateNetPayout('ebay', 30) * 100) / 100, 25.52);
  // At/under $10 the per-order fee is $0.30, not $0.40.
  assert.equal(Math.round(estimateNetPayout('ebay', 10) * 100) / 100, 8.34);
  // No leftover 2.9% + $0.30 card-processing surcharge on top of the
  // managed-payments final value fee (the real double-charge bug).
  assert.equal(estimateNetPayout('ebay', 100), 100 - (100 * 0.136 + 0.40));
});

test('estimateNetPayout: eBay charges the real 15.3% Clothing, Shoes & Accessories rate for category "shoes", not the 13.6% standard rate', () => {
  // Both real live boots listings are category "shoes": a $30 sale there
  // nets 30 - (30*0.153 + 0.40) = 25.01, not the 25.52 the 13.6% standard
  // rate (or the debunked ~14.9% "shoes rate" from the earlier bug) would
  // give. An earlier version of this file charged every category, shoes
  // included, the 13.6% standard rate, undercounting both real listings.
  assert.equal(Math.round(estimateNetPayout('ebay', 30, 'shoes') * 100) / 100, 25.01);
  // Consumer Electronics is not a special-rate category, it still gets the
  // 13.6% standard rate.
  assert.equal(Math.round(estimateNetPayout('ebay', 95, 'electronics') * 100) / 100,
    Math.round((95 - (95 * 0.136 + 0.40)) * 100) / 100);
});

test('estimateNetPayout: Vinted has no seller fee, Poshmark and Depop use their published formulas', () => {
  assert.equal(estimateNetPayout('vinted', 85), 85);
  assert.equal(estimateNetPayout('poshmark', 14.99), 14.99 - 2.95);
  assert.equal(estimateNetPayout('poshmark', 15), 15 * 0.80);
  assert.equal(Math.round(estimateNetPayout('depop', 95) * 100) / 100, Math.round((95 - (95 * 0.033 + 0.45)) * 100) / 100);
});

test('estimateNetPayout: null price or unknown platform never guesses a payout', () => {
  assert.equal(estimateNetPayout('ebay', null), null);
  assert.equal(estimateNetPayout('mercari', 50), null);
});

test('minListingPriceForNet inverts estimateNetPayout for every platform', () => {
  for (const platform of ['ebay', 'vinted', 'poshmark', 'depop']) {
    const targetNet = 20;
    const price = minListingPriceForNet(platform, targetNet, false);
    assert.ok(Math.abs(estimateNetPayout(platform, price) - targetNet) < 0.01, platform);
  }
});

test('minListingPriceForNet threads category through to eBay\'s real 15.3% shoes rate', () => {
  const targetNet = 20;
  const price = minListingPriceForNet('ebay', targetNet, false, 'shoes');
  assert.ok(Math.abs(estimateNetPayout('ebay', price, 'shoes') - targetNet) < 0.01);
  // The shoes-rate price should be strictly higher than the standard-rate
  // price to clear the same target net, since 15.3% takes a bigger bite.
  const standardPrice = minListingPriceForNet('ebay', targetNet, false);
  assert.ok(price > standardPrice);
});

test('ebayMinPriceForNet picks the $0.30 branch only when it actually lands at/under $10', () => {
  const price = ebayMinPriceForNet(5);
  assert.ok(price <= 10);
  assert.equal(Math.round(price * 100) / 100, Math.round((5.30 / 0.864) * 100) / 100);
});

test('depopMinPriceForNet adds the boost fee only when applyBoost is true', () => {
  const withoutBoost = depopMinPriceForNet(20, false);
  const withBoost = depopMinPriceForNet(20, true);
  assert.ok(withBoost > withoutBoost);
  assert.equal(Math.round((withBoost - withoutBoost) * 100) / 100 > 0, true);
  assert.equal(DEPOP_BOOST_FEE_PCT, 0.12);
});

test('poshmarkMinPriceForNet falls back to the 20% commission branch once the flat-fee price would clear $15', () => {
  const price = poshmarkMinPriceForNet(13);
  assert.ok(price >= 15, 'a target net whose flat-fee price would land at/over $15 must use the commission formula');
});

test('addDaysToDateStr rolls over month/year boundaries', () => {
  assert.equal(addDaysToDateStr('2026-09-28', 5), '2026-10-03');
  assert.equal(addDaysToDateStr('2026-12-30', 3), '2027-01-02');
});

test('addBusinessDays skips Saturday and Sunday', () => {
  // Friday 2026-09-18 + 3 business days = Wed 2026-09-23 (skips the weekend).
  assert.equal(addBusinessDays('2026-09-18', 3), '2026-09-23');
});

test('disputeResponseDeadline: eBay gets 3 business days, Poshmark gets the plain next calendar day', () => {
  assert.equal(disputeResponseDeadline({ status: 'open', platform: 'ebay', openedDate: '2026-09-18' }), '2026-09-23');
  // The real bug (1e44742): a Poshmark case opened Friday must be due
  // Saturday, not pushed to Monday by business-day math.
  assert.equal(disputeResponseDeadline({ status: 'open', platform: 'poshmark', openedDate: '2026-09-18' }), '2026-09-19');
});

test('disputeResponseDeadline returns null for a resolved case, a missing openedDate, or a no-fixed-clock platform', () => {
  assert.equal(disputeResponseDeadline({ status: 'resolved', platform: 'ebay', openedDate: '2026-09-18' }), null);
  assert.equal(disputeResponseDeadline({ status: 'open', platform: 'ebay', openedDate: null }), null);
  assert.equal(disputeResponseDeadline({ status: 'open', platform: 'vinted', openedDate: '2026-09-18' }), null);
  assert.equal(disputeResponseDeadline({ status: 'open', platform: 'depop', openedDate: '2026-09-18' }), null);
});

test('remainingPlatforms drops platforms already recorded as sold elsewhere', () => {
  assert.deepEqual(remainingPlatforms({ platforms: ['ebay', 'vinted'], soldOn: ['vinted'] }), ['ebay']);
  assert.deepEqual(remainingPlatforms({ platforms: ['ebay'], soldOn: [] }), ['ebay']);
  assert.deepEqual(remainingPlatforms({ platforms: [] }), []);
});

test('daysSincePublished returns null for no date or an invalid date, not a misleading 0', () => {
  assert.equal(daysSincePublished(null), null);
  assert.equal(daysSincePublished('not-a-date'), null);
});

test('daysSincePublished counts whole days against a fixed reference clock', () => {
  const now = new Date('2026-09-25T12:00:00').getTime();
  assert.equal(daysSincePublished('2026-09-18', now), 7);
  assert.equal(daysSincePublished('2026-09-25', now), 0);
});

test('isDueForRelist: the real bug (c142a62), a stale listing sold on its only platform is not due', () => {
  const soldOutListing = { platforms: ['ebay'], soldOn: ['ebay'] };
  assert.equal(isDueForRelist(soldOutListing, RELIST_FRESH_DAYS), false);
  const stillLiveListing = { platforms: ['ebay', 'vinted'], soldOn: ['vinted'] };
  assert.equal(isDueForRelist(stillLiveListing, RELIST_FRESH_DAYS), true);
  assert.equal(isDueForRelist(stillLiveListing, RELIST_FRESH_DAYS - 1), false);
  assert.equal(isDueForRelist(stillLiveListing, null), false);
});

test('relistGuidanceParts: no publish date logged is its own honest state, not treated as fresh', () => {
  const parts = relistGuidanceParts({ platforms: ['ebay'] }, null);
  assert.equal(parts[0].tier, 'unknown');
});

test('relistGuidanceParts: fresh listing under the threshold counts down, does not suggest relisting yet', () => {
  const parts = relistGuidanceParts({ platforms: ['ebay'] }, RELIST_FRESH_DAYS - 5);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].tier, 'fresh');
  assert.match(parts[0].text, /5d/);
});

test('relistGuidanceParts: past the threshold, Poshmark is held separately until its own 60-day window', () => {
  const parts = relistGuidanceParts({ platforms: ['ebay', 'poshmark'] }, RELIST_FRESH_DAYS + 1, { ebay: 'eBay', poshmark: 'Poshmark' });
  const tiers = parts.map(p => p.tier);
  assert.ok(tiers.includes('due'), 'eBay is due for relist past 30 days');
  assert.ok(tiers.includes('hold'), 'Poshmark is held until day 60');
  const eligible = relistGuidanceParts({ platforms: ['poshmark'] }, POSHMARK_HOLD_DAYS, { poshmark: 'Poshmark' });
  assert.equal(eligible[0].tier, 'due');
});

test('relistGuidanceParts: nothing left to relist (sold on its only platform) is its own honest state', () => {
  const parts = relistGuidanceParts({ platforms: ['ebay'], soldOn: ['ebay'] }, RELIST_FRESH_DAYS + 10);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].tier, 'unknown');
  assert.equal(parts[0].text, 'nothing left to relist');
});

test('poshmarkWeightTier: stays free under 5 lb, steps up to the $11.49/$16.49 label past it', () => {
  assert.equal(poshmarkWeightTier(5).sellerCost, 0);
  assert.equal(poshmarkWeightTier(5.1).sellerCost, 5);
  assert.equal(poshmarkWeightTier(5.1).labelCost, 11.49);
  assert.equal(poshmarkWeightTier(10).labelCost, 11.49);
  assert.equal(poshmarkWeightTier(10.1).sellerCost, 10);
  assert.equal(poshmarkWeightTier(10.1).labelCost, 16.49);
  assert.equal(poshmarkWeightTier(15).labelCost, 16.49);
});

test('poshmarkWeightTier: past all flat-rate tiers or an invalid weight returns null, not a guess', () => {
  assert.equal(poshmarkWeightTier(15.1), null);
  assert.equal(poshmarkWeightTier(-1), null);
  assert.equal(poshmarkWeightTier(null), null);
  assert.equal(poshmarkWeightTier(NaN), null);
});

test('bundleNetComparison: routes both legs through estimateNetPayout, discount only applies to the bundled leg', () => {
  const r = bundleNetComparison('vinted', [40, 30], 0);
  assert.equal(r.separateNet, 70);
  assert.equal(r.bundledNet, 70);
  assert.equal(r.swing, 0);
  const discounted = bundleNetComparison('vinted', [40, 30], 10);
  assert.equal(discounted.bundleTotal, 63);
  assert.equal(discounted.bundledNet, 63);
  assert.equal(discounted.swing, -7);
});

test('bundleNetComparison: an out-of-range discount clamps to 0-100 instead of inverting the math', () => {
  const negative = bundleNetComparison('vinted', [50, 50], -20);
  assert.equal(negative.bundleTotal, 100);
  const over = bundleNetComparison('vinted', [50, 50], 150);
  assert.equal(over.bundleTotal, 0);
});

test('irsMileageRateForDate: 72.5 cents Jan-Jun, 76 cents Jul-Dec, null outside 2026 or with no date', () => {
  assert.equal(irsMileageRateForDate('2026-01-01'), 0.725);
  assert.equal(irsMileageRateForDate('2026-06-30'), 0.725);
  assert.equal(irsMileageRateForDate('2026-07-01'), 0.76);
  assert.equal(irsMileageRateForDate('2026-12-31'), 0.76);
  assert.equal(irsMileageRateForDate('2025-12-31'), null);
  assert.equal(irsMileageRateForDate('2027-01-01'), null);
  assert.equal(irsMileageRateForDate(null), null);
});

test('computeExpenseAmount: a logged amount always wins, otherwise mileage computes from miles x the real rate for its date', () => {
  assert.equal(computeExpenseAmount({ amount: 12.5, category: 'mileage', miles: 999 }), 12.5);
  assert.equal(computeExpenseAmount({ category: 'mileage', miles: 100, date: '2026-01-15' }), 72.5);
  assert.equal(computeExpenseAmount({ category: 'mileage', miles: 100, date: '2026-08-01' }), 76);
  // No amount, not mileage: honestly un-computable, never assumed $0.
  assert.equal(computeExpenseAmount({ category: 'supplies' }), null);
  // Mileage with no known rate for the date: also un-computable.
  assert.equal(computeExpenseAmount({ category: 'mileage', miles: 100, date: '2025-01-01' }), null);
});

test('mileageRateGapReason: only fires for an uncomputed mileage expense with real miles/date but no known rate', () => {
  // Already has an amount, category isn't mileage, or missing miles/date: no gap to report.
  assert.equal(mileageRateGapReason({ amount: 10, category: 'mileage', miles: 100, date: '2025-01-01' }), null);
  assert.equal(mileageRateGapReason({ category: 'supplies', miles: 100, date: '2025-01-01' }), null);
  assert.equal(mileageRateGapReason({ category: 'mileage', date: '2025-01-01' }), null);
  assert.equal(mileageRateGapReason({ category: 'mileage', miles: 100 }), null);
  // A real rate exists for this date: no gap.
  assert.equal(mileageRateGapReason({ category: 'mileage', miles: 100, date: '2026-03-01' }), null);
  // Dated after the table's last known range: distinct "past" message naming the table itself.
  const past = mileageRateGapReason({ category: 'mileage', miles: 100, date: '2027-01-01' });
  assert.match(past, /No IRS rate known past 2026-12-31/);
  // Dated before 2026 (or any other gap inside the table's span): the general message.
  const before = mileageRateGapReason({ category: 'mileage', miles: 100, date: '2025-06-01' });
  assert.match(before, /No IRS rate known for 2025-06-01/);
});

test('computePoshmarkShareStreak: counts consecutive logged days walking back from today', () => {
  const log = { '2026-09-21': 1, '2026-09-22': 1, '2026-09-23': 1 };
  assert.equal(computePoshmarkShareStreak(log, '2026-09-23'), 3);
  // A gap two days back stops the walk there.
  const withGap = { '2026-09-20': 1, '2026-09-22': 1, '2026-09-23': 1 };
  assert.equal(computePoshmarkShareStreak(withGap, '2026-09-23'), 2);
});

test('computePoshmarkShareStreak: today not logged yet still counts yesterday onward, not a broken streak', () => {
  const log = { '2026-09-21': 1, '2026-09-22': 1 };
  assert.equal(computePoshmarkShareStreak(log, '2026-09-23'), 2);
});

test('computePoshmarkShareStreak: no logged days at all is a real zero, not a guess', () => {
  assert.equal(computePoshmarkShareStreak({}, '2026-09-23'), 0);
  assert.equal(computePoshmarkShareStreak({ '2026-09-10': 1 }, '2026-09-23'), 0);
});

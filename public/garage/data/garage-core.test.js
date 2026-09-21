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
  RELIST_FRESH_DAYS, POSHMARK_HOLD_DAYS, DEPOP_BOOST_FEE_PCT
} = require('./garage-core.js');

test('estimateNetPayout: eBay charges 13.6% + the $0.30/$0.40 per-order step, never a shoes-specific rate', () => {
  // A $30 sale nets 30 - (30*0.136 + 0.40) = 25.52, not the ~14.9% effective
  // rate an earlier bug mistook for a category-specific percentage.
  assert.equal(Math.round(estimateNetPayout('ebay', 30, 'shoes') * 100) / 100, 25.52);
  // At/under $10 the per-order fee is $0.30, not $0.40.
  assert.equal(Math.round(estimateNetPayout('ebay', 10) * 100) / 100, 8.34);
  // No leftover 2.9% + $0.30 card-processing surcharge on top of the
  // managed-payments final value fee (the real double-charge bug).
  assert.equal(estimateNetPayout('ebay', 100), 100 - (100 * 0.136 + 0.40));
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

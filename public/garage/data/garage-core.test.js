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
  estimateNetPayout, computeSaleProfit, computeSaleMarginPct, ebayMinPriceForNet, depopMinPriceForNet, poshmarkMinPriceForNet,
  minListingPriceForNet, addDaysToDateStr, addBusinessDays, disputeResponseDeadline,
  openDisputesDueForResponse,
  remainingPlatforms, daysSincePublished, daysUntil, isDueForRelist, relistGuidanceParts,
  poshmarkWeightTier, bundleNetComparison,
  irsMileageRateForDate, mileageRateGapReason, computeExpenseAmount, computeYtdNetProfit,
  homeOfficeDeduction, HOME_OFFICE_RATE_PER_SQFT, HOME_OFFICE_MAX_SQFT,
  computePoshmarkShareStreak, offerTier, offerCounterAmount,
  ebayTrsProgress, depopTopSellerProgress, daysBetweenDates, actualPostingPace,
  shipDeadline, isLateShipment, ebayLateShipmentRate, expectedBalanceDate,
  RELIST_FRESH_DAYS, POSHMARK_HOLD_DAYS, DEPOP_BOOST_FEE_PCT,
  DEPOP_TOP_SELLER_SHIP_WITHIN_DAYS, DEPOP_TOP_SELLER_ON_TIME_SHIP_RATE_TARGET,
  isSupplyLowStock,
  sortEngagementSnapshots, annotateEngagementTrend, hasNewDueId,
  daysToSell, avgDaysToSell, sellThroughRate,
  buildEngagementCheckFlags,
  USPS_PEAK_SURCHARGE_START, USPS_PEAK_SURCHARGE_END, uspsPeakSurchargeStatus,
  HOLIDAY_SHIP_BY_DATES, HOLIDAY_SHIP_BY_SEASON_YEAR, holidayShipByStatus, isHolidayShipBySeasonStale
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

test('computeSaleProfit: a sale with cost logged but no salePrice yet returns null, never a phantom loss', () => {
  // Real bug: renderStats in app.js used to substitute $0 for the missing
  // salePrice here, folding the sale's full logged cost in as a real
  // negative number on the "Realized profit" stat tile, while the sales
  // table and CSV export (both already correct) showed no profit figure at
  // all for that same row. net is null whenever salePrice is null
  // (estimateNetPayout's own contract), so this must match.
  const sale = { platform: 'ebay', salePrice: null, costBasis: 12, shippingCost: 4 };
  const net = estimateNetPayout(sale.platform, sale.salePrice);
  assert.equal(net, null);
  assert.equal(computeSaleProfit(net, sale), null);
});

test('computeSaleProfit: neither cost basis nor shipping logged returns null even with a real net payout', () => {
  const sale = { platform: 'vinted', salePrice: 40, costBasis: null, shippingCost: null };
  const net = estimateNetPayout(sale.platform, sale.salePrice);
  assert.equal(computeSaleProfit(net, sale), null);
});

test('computeSaleProfit: real net payout minus cost basis and shipping, missing field treated as $0', () => {
  const sale = { platform: 'vinted', salePrice: 40, costBasis: 10, shippingCost: null };
  const net = estimateNetPayout(sale.platform, sale.salePrice);
  assert.equal(computeSaleProfit(net, sale), 30);

  const sale2 = { platform: 'vinted', salePrice: 40, costBasis: null, shippingCost: 5 };
  const net2 = estimateNetPayout(sale2.platform, sale2.salePrice);
  assert.equal(computeSaleProfit(net2, sale2), 35);
});

test('computeSaleMarginPct: no profit yet or zero/missing cost basis never guesses a percent', () => {
  assert.equal(computeSaleMarginPct(null, 10), null);
  assert.equal(computeSaleMarginPct(30, null), null);
  assert.equal(computeSaleMarginPct(30, 0), null);
});

test('computeSaleMarginPct: profit as a real percent of cost basis, loss gives a real negative percent', () => {
  // $30 profit on a $10 cost basis is 300% ROI, the real reseller margin
  // figure the dollar-only Profit column can't show on its own.
  assert.equal(computeSaleMarginPct(30, 10), 300);
  assert.equal(computeSaleMarginPct(-5, 20), -25);
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

test('openDisputesDueForResponse includes a dispute due today or already overdue, and only those', () => {
  const disputes = [
    // eBay: opened Mon 2026-09-14, 3 business days -> due Thu 2026-09-17, before "today" -> overdue, included.
    { id: 'a', status: 'open', platform: 'ebay', openedDate: '2026-09-14' },
    // Poshmark: opened yesterday -> due today -> included.
    { id: 'b', status: 'open', platform: 'poshmark', openedDate: '2026-09-19' },
    // eBay: opened today -> due in 3 business days, in the future -> not yet due, excluded.
    { id: 'c', status: 'open', platform: 'ebay', openedDate: '2026-09-20' },
    // Resolved case has no computable deadline at all -> excluded.
    { id: 'd', status: 'resolved-seller', platform: 'ebay', openedDate: '2026-09-10' },
    // Vinted has no fixed response clock -> disputeResponseDeadline returns null -> excluded.
    { id: 'e', status: 'open', platform: 'vinted', openedDate: '2026-09-10' }
  ];
  const due = openDisputesDueForResponse(disputes, '2026-09-20');
  assert.deepEqual(due.map(d => d.id), ['a', 'b']);
});

test('openDisputesDueForResponse returns an empty array for no disputes, not null or an error', () => {
  assert.deepEqual(openDisputesDueForResponse([], '2026-09-20'), []);
  assert.deepEqual(openDisputesDueForResponse(undefined, '2026-09-20'), []);
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

test('daysUntil returns null for a missing or invalid date on either side', () => {
  assert.equal(daysUntil(null, '2026-09-25'), null);
  assert.equal(daysUntil('2026-10-01', null), null);
  assert.equal(daysUntil('not-a-date', '2026-09-25'), null);
});

test('daysUntil is signed: positive ahead of today, negative once the date has passed, zero on the day itself', () => {
  assert.equal(daysUntil('2026-10-15', '2026-09-25'), 20);
  assert.equal(daysUntil('2026-09-01', '2026-09-25'), -24);
  assert.equal(daysUntil('2026-09-25', '2026-09-25'), 0);
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

test('homeOfficeDeduction: $5/sqft, capped at 300 sqft, null for no real square footage logged', () => {
  assert.equal(homeOfficeDeduction(null), null);
  assert.equal(homeOfficeDeduction(undefined), null);
  assert.equal(homeOfficeDeduction(0), null);
  assert.equal(homeOfficeDeduction(-50), null);
  assert.equal(homeOfficeDeduction(NaN), null);

  const under = homeOfficeDeduction(120);
  assert.equal(under.countedSqft, 120);
  assert.equal(under.cappedBy, 0);
  assert.equal(under.deduction, 600);

  const atCap = homeOfficeDeduction(HOME_OFFICE_MAX_SQFT);
  assert.equal(atCap.countedSqft, 300);
  assert.equal(atCap.cappedBy, 0);
  assert.equal(atCap.deduction, 1500);

  const over = homeOfficeDeduction(400);
  assert.equal(over.countedSqft, 300);
  assert.equal(over.cappedBy, 100);
  assert.equal(over.deduction, 1500);

  assert.equal(HOME_OFFICE_RATE_PER_SQFT, 5);
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

test('offerTier: real counteroffer-ladder boundaries, each threshold is inclusive on its own tier', () => {
  assert.equal(offerTier(1.0), 'accept');
  assert.equal(offerTier(0.90), 'accept');
  assert.equal(offerTier(0.899), 'counter');
  assert.equal(offerTier(0.75), 'counter');
  assert.equal(offerTier(0.749), 'borderline');
  assert.equal(offerTier(0.50), 'borderline');
  assert.equal(offerTier(0.499), 'decline');
  assert.equal(offerTier(0), 'decline');
});

test('offerCounterAmount: accept/decline have nothing to counter', () => {
  assert.equal(offerCounterAmount('accept', 90, 100, 10), null);
  assert.equal(offerCounterAmount('decline', 40, 100, 10), null);
});

test('offerCounterAmount: counter tier always splits the gap 50/50, regardless of listing age', () => {
  assert.equal(offerCounterAmount('counter', 80, 100, null), 90);
  assert.equal(offerCounterAmount('counter', 80, 100, 5), 90);
  assert.equal(offerCounterAmount('counter', 80, 100, 90), 90);
});

test('offerCounterAmount: borderline tier splits closer to the offer once past RELIST_FRESH_DAYS, a stale listing has more to gain from moving', () => {
  assert.equal(offerCounterAmount('borderline', 60, 100, RELIST_FRESH_DAYS), 70);
  assert.equal(offerCounterAmount('borderline', 60, 100, RELIST_FRESH_DAYS + 20), 70);
});

test('offerCounterAmount: borderline tier splits closer to asking while still fresh, or with no logged date at all', () => {
  assert.equal(offerCounterAmount('borderline', 60, 100, RELIST_FRESH_DAYS - 1), 90);
  assert.equal(offerCounterAmount('borderline', 60, 100, 0), 90);
  // No listing date logged defaults to the same firmer split as a genuinely
  // fresh listing, never the stale-listing split with no real evidence for it.
  assert.equal(offerCounterAmount('borderline', 60, 100, null), 90);
});

test('ebayTrsProgress: counts only real ebay sales within the trailing 365 days, ignores other platforms and out-of-window dates', () => {
  const sales = [
    { platform: 'ebay', salePrice: 100, saleDate: '2026-09-01' },
    { platform: 'ebay', salePrice: 50, saleDate: '2025-10-01' }, // in window
    { platform: 'ebay', salePrice: 999, saleDate: '2025-09-01' }, // just outside window
    { platform: 'depop', salePrice: 999, saleDate: '2026-09-01' } // wrong platform
  ];
  const result = ebayTrsProgress(sales, [], '2026-09-24');
  assert.equal(result.transactions, 2);
  assert.equal(result.grossSales, 150);
  assert.equal(result.meetsCountTargets, false);
});

test('ebayTrsProgress: meetsCountTargets is true only once both the transaction count and dollar targets are actually hit', () => {
  const hundredSales = Array.from({ length: 100 }, (_, i) => ({ platform: 'ebay', salePrice: 10, saleDate: '2026-09-01' }));
  const shortOfDollars = ebayTrsProgress(hundredSales, [], '2026-09-24');
  assert.equal(shortOfDollars.transactions, 100);
  assert.equal(shortOfDollars.grossSales, 1000);
  assert.equal(shortOfDollars.meetsCountTargets, true);

  const shortOfCount = ebayTrsProgress([{ platform: 'ebay', salePrice: 5000, saleDate: '2026-09-01' }], [], '2026-09-24');
  assert.equal(shortOfCount.meetsCountTargets, false);
});

test('ebayTrsProgress: nonSellerResolvedRate is null with no sales yet, not a misleading 0%', () => {
  assert.equal(ebayTrsProgress([], [], '2026-09-24').nonSellerResolvedRate, null);
});

test('ebayTrsProgress: nonSellerResolvedRate only counts disputes resolved against the seller, and only within the same window', () => {
  const sales = [
    { platform: 'ebay', salePrice: 50, saleDate: '2026-09-01' },
    { platform: 'ebay', salePrice: 50, saleDate: '2026-09-02' }
  ];
  const disputes = [
    { platform: 'ebay', status: 'resolved-buyer', openedDate: '2026-09-03' },
    { platform: 'ebay', status: 'resolved-seller', openedDate: '2026-09-03' }, // doesn't count against the seller
    { platform: 'ebay', status: 'resolved-buyer', openedDate: '2024-01-01' }, // outside the window
    { platform: 'depop', status: 'resolved-buyer', openedDate: '2026-09-03' } // wrong platform
  ];
  assert.equal(ebayTrsProgress(sales, disputes, '2026-09-24').nonSellerResolvedRate, 0.5);
});

test('depopTopSellerProgress: sums real depop sales within the rolling 30 days only', () => {
  const sales = [
    { platform: 'depop', salePrice: 400, saleDate: '2026-09-20' },
    { platform: 'depop', salePrice: 400, saleDate: '2026-09-01' }, // 23 days back, still in window
    { platform: 'depop', salePrice: 999, saleDate: '2026-08-01' }, // outside the 30-day window
    { platform: 'ebay', salePrice: 999, saleDate: '2026-09-20' } // wrong platform
  ];
  const result = depopTopSellerProgress(sales, [], '2026-09-24');
  assert.equal(result.grossSales, 800);
  assert.equal(result.meetsCountTargets, false);
  assert.equal(depopTopSellerProgress([{ platform: 'depop', salePrice: 1000, saleDate: '2026-09-24' }], [], '2026-09-24').meetsCountTargets, true);
});

test('daysBetweenDates: whole-day gap between a real saleDate and a real shipDate', () => {
  assert.equal(daysBetweenDates('2026-09-20', '2026-09-25'), 5);
  assert.equal(daysBetweenDates('2026-09-20', '2026-09-20'), 0);
});

test('daysBetweenDates: null when either date is missing, invalid, or shipDate falls before saleDate', () => {
  assert.equal(daysBetweenDates(null, '2026-09-25'), null);
  assert.equal(daysBetweenDates('2026-09-20', null), null);
  assert.equal(daysBetweenDates('2026-09-20', 'not-a-date'), null);
  assert.equal(daysBetweenDates('2026-09-25', '2026-09-20'), null, 'shipping before selling is a logging mistake, not a negative duration');
});

test('depopTopSellerProgress: onTimeShipRate only counts sales with a real shipDate logged, null (not 0) with none', () => {
  const noShipDates = [
    { platform: 'depop', salePrice: 40, saleDate: '2026-09-20' },
    { platform: 'depop', salePrice: 40, saleDate: '2026-09-21' }
  ];
  const result = depopTopSellerProgress(noShipDates, [], '2026-09-24');
  assert.equal(result.onTimeShipRate, null);
  assert.equal(result.onTimeShipSampleSize, 0);
  assert.equal(result.shipWithinDaysTarget, DEPOP_TOP_SELLER_SHIP_WITHIN_DAYS);
  assert.equal(result.onTimeShipRateTarget, DEPOP_TOP_SELLER_ON_TIME_SHIP_RATE_TARGET);
});

test('depopTopSellerProgress: onTimeShipRate is the real fraction shipped within the 5-day target, only among judged sales', () => {
  const sales = [
    { platform: 'depop', salePrice: 40, saleDate: '2026-09-01', shipDate: '2026-09-03' }, // 2 days, on time
    { platform: 'depop', salePrice: 40, saleDate: '2026-09-05', shipDate: '2026-09-06' }, // 1 day, on time
    { platform: 'depop', salePrice: 40, saleDate: '2026-09-10', shipDate: '2026-09-20' }, // 10 days, late
    { platform: 'depop', salePrice: 40, saleDate: '2026-09-15' } // no shipDate, not judged
  ];
  const result = depopTopSellerProgress(sales, [], '2026-09-24');
  assert.equal(result.onTimeShipSampleSize, 3, 'the undated sale is excluded from the sample entirely');
  assert.ok(Math.abs(result.onTimeShipRate - (2 / 3)) < 1e-9);
});

test('ebayTrsProgress: avgDaysToShip is informational only, null with no real ship dates logged', () => {
  const noShipDates = [{ platform: 'ebay', salePrice: 50, saleDate: '2026-09-01' }];
  const result = ebayTrsProgress(noShipDates, [], '2026-09-24');
  assert.equal(result.avgDaysToShip, null);
  assert.equal(result.avgDaysToShipSampleSize, 0);
});

test('ebayTrsProgress: avgDaysToShip averages only the sales with a real shipDate logged', () => {
  const sales = [
    { platform: 'ebay', salePrice: 50, saleDate: '2026-09-01', shipDate: '2026-09-02' }, // 1 day
    { platform: 'ebay', salePrice: 50, saleDate: '2026-09-05', shipDate: '2026-09-08' }, // 3 days
    { platform: 'ebay', salePrice: 50, saleDate: '2026-09-10' } // no shipDate
  ];
  const result = ebayTrsProgress(sales, [], '2026-09-24');
  assert.equal(result.avgDaysToShipSampleSize, 2);
  assert.equal(result.avgDaysToShip, 2);
});

test('shipDeadline: a real handlingTimeDays gives a business-day-only deadline, same helper as the eBay dispute clock', () => {
  // Friday + 3 business days skips the weekend, same as the
  // addBusinessDays('2026-09-18', 3) case already covered above.
  assert.equal(shipDeadline('2026-09-18', 3), '2026-09-23');
});

test('shipDeadline: null with no real saleDate or handlingTimeDays to compute from, never a guess', () => {
  assert.equal(shipDeadline(null, 3), null);
  assert.equal(shipDeadline('2026-09-18', null), null);
  assert.equal(shipDeadline('2026-09-18', undefined), null);
});

test('isLateShipment: true once the real shipDate falls after the listing\'s own handling-time deadline', () => {
  const sale = { saleDate: '2026-09-18', shipDate: '2026-09-24' }; // deadline is 2026-09-23
  assert.equal(isLateShipment(sale, { handlingTimeDays: 3 }), true);
});

test('isLateShipment: false when shipped by the deadline, including exactly on it', () => {
  const onTime = { saleDate: '2026-09-18', shipDate: '2026-09-22' };
  const exactlyOnDeadline = { saleDate: '2026-09-18', shipDate: '2026-09-23' };
  assert.equal(isLateShipment(onTime, { handlingTimeDays: 3 }), false);
  assert.equal(isLateShipment(exactlyOnDeadline, { handlingTimeDays: 3 }), false);
});

test('isLateShipment: null (not false) with no real shipDate or no matched listing handlingTimeDays, never a false pass', () => {
  assert.equal(isLateShipment({ saleDate: '2026-09-18' }, { handlingTimeDays: 3 }), null, 'never shipped yet');
  assert.equal(isLateShipment({ saleDate: '2026-09-18', shipDate: '2026-09-24' }, { handlingTimeDays: null }), null, 'no handling time logged on the listing');
  assert.equal(isLateShipment({ saleDate: '2026-09-18', shipDate: '2026-09-24' }, null), null, 'no matched listing at all');
});

test('ebayLateShipmentRate: joins sales to listings by listingId, only judges sales with both a real handlingTimeDays and shipDate', () => {
  const listings = [
    { id: 'black-boots', handlingTimeDays: 2 },
    { id: 'white-boots', handlingTimeDays: null } // logged listing, but no handling time yet
  ];
  const sales = [
    { listingId: 'black-boots', saleDate: '2026-09-01', shipDate: '2026-09-02' }, // on time (1 <= 2 business days)
    { listingId: 'black-boots', saleDate: '2026-09-14', shipDate: '2026-09-18' }, // late (deadline was 09-16, a Wed)
    { listingId: 'white-boots', saleDate: '2026-09-01', shipDate: '2026-09-02' }, // no handlingTimeDays, excluded
    { listingId: 'unknown-item', saleDate: '2026-09-01', shipDate: '2026-09-02' }, // no matching listing, excluded
    { listingId: 'black-boots', saleDate: '2026-09-05' } // no shipDate yet, excluded
  ];
  const result = ebayLateShipmentRate(sales, listings);
  assert.equal(result.sampleSize, 2);
  assert.equal(result.rate, 0.5);
});

test('ebayLateShipmentRate: null rate (not 0) with nothing real to judge yet', () => {
  assert.deepEqual(ebayLateShipmentRate([], []), { rate: null, sampleSize: 0 });
  assert.deepEqual(ebayLateShipmentRate([{ listingId: 'black-boots', saleDate: '2026-09-01', shipDate: '2026-09-02' }], []), { rate: null, sampleSize: 0 });
});

test('expectedBalanceDate: eBay, 2 calendar days after the real saleDate (Seller Hub funds-available timing)', () => {
  assert.equal(expectedBalanceDate({ platform: 'ebay', saleDate: '2026-09-18' }), '2026-09-20');
  assert.equal(expectedBalanceDate({ platform: 'ebay', saleDate: null }), null, 'no real saleDate to compute from');
});

test('expectedBalanceDate: Poshmark, 3 calendar days after a real deliveryDate, never keyed off saleDate', () => {
  assert.equal(expectedBalanceDate({ platform: 'poshmark', deliveryDate: '2026-09-18' }), '2026-09-21');
  assert.equal(
    expectedBalanceDate({ platform: 'poshmark', saleDate: '2026-09-18', deliveryDate: null }),
    null,
    'Poshmark\'s own clock runs from delivery, a sale date alone can\'t compute it'
  );
});

test('expectedBalanceDate: Vinted, 2 calendar days after a real deliveryDate, never keyed off saleDate', () => {
  assert.equal(expectedBalanceDate({ platform: 'vinted', deliveryDate: '2026-09-18' }), '2026-09-20');
  assert.equal(expectedBalanceDate({ platform: 'vinted', saleDate: '2026-09-18', deliveryDate: null }), null);
});

test('expectedBalanceDate: Depop, whichever real rule fires first, delivery+2 business days winning on a fast delivery', () => {
  // Delivered fast (4 days after sale): 2 business days after delivery
  // (2026-09-16) lands before 10 business days after the sale (2026-09-24),
  // so the earlier, delivery-based date is the real one that applies.
  assert.equal(
    expectedBalanceDate({ platform: 'depop', saleDate: '2026-09-10', deliveryDate: '2026-09-14' }),
    '2026-09-16'
  );
});

test('expectedBalanceDate: Depop, whichever real rule fires first, sale+10 business days winning on a slow/unconfirmed delivery', () => {
  // Delivery confirmation lagged (17 days after sale): 10 business days
  // after the sale (2026-09-15) lands before 2 business days after that
  // late delivery (2026-09-22), so the sale-based cap is the real one that
  // applies, the actual protection the "whichever comes first" rule gives
  // a seller against a buyer who never confirms.
  assert.equal(
    expectedBalanceDate({ platform: 'depop', saleDate: '2026-09-01', deliveryDate: '2026-09-18' }),
    '2026-09-15'
  );
});

test('expectedBalanceDate: Depop, computes off whichever single date is actually known', () => {
  assert.equal(expectedBalanceDate({ platform: 'depop', saleDate: '2026-09-01' }), '2026-09-15', 'sale date alone');
  assert.equal(expectedBalanceDate({ platform: 'depop', deliveryDate: '2026-09-14' }), '2026-09-16', 'delivery date alone');
});

test('expectedBalanceDate: null (not a guess) with no sale, no platform, or an unknown platform', () => {
  assert.equal(expectedBalanceDate(null), null);
  assert.equal(expectedBalanceDate({}), null);
  assert.equal(expectedBalanceDate({ platform: 'unknown', saleDate: '2026-09-18', deliveryDate: '2026-09-18' }), null);
  assert.equal(expectedBalanceDate({ platform: 'depop' }), null, 'depop with neither date logged');
});

test('ebayTrsProgress: lateShipmentRate stays null when no listings are passed, same as every caller before this existed', () => {
  const sales = [{ platform: 'ebay', salePrice: 50, saleDate: '2026-09-01', shipDate: '2026-09-05', listingId: 'black-boots' }];
  const result = ebayTrsProgress(sales, [], '2026-09-24');
  assert.equal(result.lateShipmentRate, null);
  assert.equal(result.lateShipmentSampleSize, 0);
  assert.equal(result.lateShipmentRateTarget, 0.03);
});

test('ebayTrsProgress: lateShipmentRate is computed for real once listings with handlingTimeDays are passed, scoped to the trailing window', () => {
  const listings = [{ id: 'black-boots', handlingTimeDays: 1 }];
  const sales = [
    { platform: 'ebay', salePrice: 50, saleDate: '2026-09-01', shipDate: '2026-09-02', listingId: 'black-boots' }, // on time
    { platform: 'vinted', salePrice: 50, saleDate: '2026-09-01', shipDate: '2026-09-10', listingId: 'black-boots' } // wrong platform, excluded
  ];
  const result = ebayTrsProgress(sales, [], '2026-09-24', listings);
  assert.equal(result.lateShipmentSampleSize, 1);
  assert.equal(result.lateShipmentRate, 0);
});

test('isSupplyLowStock only fires once both qtyOnHand and reorderThreshold are real logged numbers', () => {
  assert.equal(isSupplyLowStock({ qtyOnHand: null, reorderThreshold: 5 }), false, 'no count logged yet, not judgeable');
  assert.equal(isSupplyLowStock({ qtyOnHand: 3, reorderThreshold: null }), false, 'no reorder point set yet, not judgeable');
  assert.equal(isSupplyLowStock({ qtyOnHand: null, reorderThreshold: null }), false);
});

test('isSupplyLowStock fires at or below the reorder threshold, not only strictly below it', () => {
  assert.equal(isSupplyLowStock({ qtyOnHand: 5, reorderThreshold: 5 }), true, 'exactly at the reorder point counts as low, not just under it');
  assert.equal(isSupplyLowStock({ qtyOnHand: 4, reorderThreshold: 5 }), true);
  assert.equal(isSupplyLowStock({ qtyOnHand: 6, reorderThreshold: 5 }), false);
});

test('isSupplyLowStock treats a real zero count or zero threshold as a real logged number, not a missing one', () => {
  assert.equal(isSupplyLowStock({ qtyOnHand: 0, reorderThreshold: 5 }), true, 'out of stock is the most low-stock case there is');
  assert.equal(isSupplyLowStock({ qtyOnHand: 0, reorderThreshold: 0 }), true, 'a reorder threshold of exactly 0 is still a real logged threshold, and 0 <= 0');
  assert.equal(isSupplyLowStock({ qtyOnHand: 5, reorderThreshold: 0 }), false, 'plenty on hand against a zero reorder point is not low stock');
});

test('computeYtdNetProfit: nets real gross revenue against real cost of goods sold and real business expenses, same year only', () => {
  const sales = [
    { saleDate: '2026-03-01', salePrice: 85, costBasis: 20, shippingCost: 8 }, // profit-tracked
    { saleDate: '2026-06-15', salePrice: 75 }, // revenue counts, no cost data logged yet
    { saleDate: '2025-12-20', salePrice: 500, costBasis: 10, shippingCost: 5 } // wrong year, excluded entirely
  ];
  const expenses = [
    { date: '2026-02-01', category: 'supplies', amount: 15 },
    { date: '2026-07-01', category: 'mileage', miles: 100 }, // computed at the real 76c/mi rate: $76
    { date: '2025-01-01', category: 'other', amount: 999 } // wrong year, excluded entirely
  ];
  const result = computeYtdNetProfit(sales, expenses, 2026);
  assert.equal(result.salesCount, 2);
  assert.equal(result.grossRevenue, 160);
  assert.equal(result.cogsTrackedCount, 1);
  assert.equal(result.costOfGoodsSold, 28);
  assert.equal(result.expensesCount, 2);
  assert.equal(Math.round(result.businessExpenses * 100) / 100, 91);
  assert.equal(result.expensesUncountedCount, 0);
  assert.equal(Math.round(result.netProfit * 100) / 100, 41);
});

test('computeYtdNetProfit: an undated sale or expense is never silently counted toward any year', () => {
  const sales = [{ salePrice: 999, costBasis: 1, shippingCost: 1 }]; // no saleDate at all
  const expenses = [{ category: 'other', amount: 999 }]; // no date at all
  const result = computeYtdNetProfit(sales, expenses, 2026);
  assert.equal(result.salesCount, 0);
  assert.equal(result.grossRevenue, 0);
  assert.equal(result.expensesCount, 0);
  assert.equal(result.netProfit, 0);
});

test('computeYtdNetProfit: an expense with no computable amount counts toward expensesUncountedCount, not as a real zero', () => {
  const expenses = [
    { date: '2026-05-01', category: 'other', amount: null }, // no amount logged
    { date: '2027-01-01', category: 'mileage', miles: 50 } // real miles, but no rate published for 2027 yet
  ];
  const result = computeYtdNetProfit([], expenses, 2027);
  assert.equal(result.expensesCount, 1, 'only the real 2027-dated row counts toward the 2027 total');
  assert.equal(result.expensesUncountedCount, 1);
  assert.equal(result.businessExpenses, 0);
});

test('sortEngagementSnapshots: sorts ascending by date, undated entries first (empty string sorts before any real date)', () => {
  const snapshots = [
    { id: 'c', date: '2026-09-20' },
    { id: 'a', date: '2026-09-01' },
    { id: 'b', date: null }
  ];
  assert.deepEqual(sortEngagementSnapshots(snapshots).map(s => s.id), ['b', 'a', 'c']);
});

test('annotateEngagementTrend: a listing+platform pair\'s first-ever snapshot gets null deltas, not a misleading flat 0', () => {
  const [first] = annotateEngagementTrend([
    { id: 's1', listingId: 'black-boots', platform: 'ebay', date: '2026-09-01', views: 10, saves: 2 }
  ]);
  assert.equal(first.viewsDelta, null);
  assert.equal(first.savesDelta, null);
  assert.equal(first.previousDate, null);
});

test('annotateEngagementTrend: computes a real delta against the immediately prior snapshot for the same listing+platform pair', () => {
  const result = annotateEngagementTrend([
    { id: 's2', listingId: 'black-boots', platform: 'ebay', date: '2026-09-15', views: 47, saves: 6 },
    { id: 's1', listingId: 'black-boots', platform: 'ebay', date: '2026-09-01', views: 10, saves: 2 }
  ]);
  const second = result.find(s => s.id === 's2');
  assert.equal(second.viewsDelta, 37);
  assert.equal(second.savesDelta, 4);
  assert.equal(second.previousDate, '2026-09-01');
});

test('annotateEngagementTrend: never mixes up two different listings, or two different platforms of the same listing', () => {
  const result = annotateEngagementTrend([
    { id: 'boots-ebay-1', listingId: 'black-boots', platform: 'ebay', date: '2026-09-01', views: 10, saves: 1 },
    { id: 'boots-vinted-1', listingId: 'black-boots', platform: 'vinted', date: '2026-09-05', views: 50, saves: 5 },
    { id: 'white-boots-ebay-1', listingId: 'white-boots', platform: 'ebay', date: '2026-09-10', views: 20, saves: 2 }
  ]);
  // Each is the first-ever snapshot for its own real listingId+platform pair,
  // even though "ebay" repeats and "black-boots" repeats separately.
  result.forEach(s => {
    assert.equal(s.viewsDelta, null);
    assert.equal(s.savesDelta, null);
  });
});

test('annotateEngagementTrend: a delta stays null when either side of the comparison never had that field logged', () => {
  const result = annotateEngagementTrend([
    { id: 's1', listingId: 'black-boots', platform: 'depop', date: '2026-09-01', views: null, saves: 3 },
    { id: 's2', listingId: 'black-boots', platform: 'depop', date: '2026-09-10', views: 15, saves: null }
  ]);
  const second = result.find(s => s.id === 's2');
  assert.equal(second.viewsDelta, null, 'the earlier snapshot never logged a real views count to compare against');
  assert.equal(second.savesDelta, null, 'this snapshot itself never logged a real saves count');
});

test('hasNewDueId returns false on the first check, previousIds null', () => {
  assert.equal(hasNewDueId(['a-dispute-respond'], null), false);
});

test('hasNewDueId returns false when the same reminders just stay due', () => {
  assert.equal(hasNewDueId(['a-dispute-respond', 'b-dispute-respond'], ['a-dispute-respond', 'b-dispute-respond']), false);
});

test('hasNewDueId returns true when a new reminder becomes due even if the count also fell', () => {
  // b's dispute got resolved the same poll window c's newly became due:
  // count stays 2, but c is a real, new transition the old count-only check
  // would miss.
  assert.equal(hasNewDueId(['a-dispute-respond', 'c-dispute-respond'], ['a-dispute-respond', 'b-dispute-respond']), true);
});

test('hasNewDueId returns false when a reminder drops out and nothing new becomes due', () => {
  assert.equal(hasNewDueId(['a-dispute-respond'], ['a-dispute-respond', 'b-dispute-respond']), false);
});

test('actualPostingPace returns a null rate with no posting log entries yet, not a divide-by-zero', () => {
  const result = actualPostingPace([], '2026-10-05');
  assert.equal(result.postedCount, 0);
  assert.equal(result.firstDate, null);
  assert.equal(result.daysActive, 0);
  assert.equal(result.postedPerDay, null);
});

test('actualPostingPace ignores an entry missing a date or a count rather than throwing', () => {
  const result = actualPostingPace([{ id: 'a', date: null, count: 5 }, { id: 'b', date: '2026-10-01', count: null }], '2026-10-05');
  assert.equal(result.postedCount, 0);
  assert.equal(result.postedPerDay, null);
});

test('actualPostingPace: a single day logged today is a 1-day-active rate', () => {
  const result = actualPostingPace([{ id: 'a', date: '2026-10-05', count: 6 }], '2026-10-05');
  assert.equal(result.postedCount, 6);
  assert.equal(result.firstDate, '2026-10-05');
  assert.equal(result.daysActive, 1);
  assert.equal(result.postedPerDay, 6);
});

test('actualPostingPace sums every entry and spans from the earliest logged date through today, inclusive', () => {
  const log = [
    { id: 'a', date: '2026-10-03', count: 4 },
    { id: 'b', date: '2026-10-01', count: 2 },
    { id: 'c', date: '2026-10-03', count: 3 }
  ];
  const result = actualPostingPace(log, '2026-10-05');
  assert.equal(result.postedCount, 9);
  assert.equal(result.firstDate, '2026-10-01');
  assert.equal(result.daysActive, 5);
  assert.ok(Math.abs(result.postedPerDay - 9 / 5) < 1e-9);
});

test('actualPostingPace returns a null rate rather than a negative span when every entry is dated after todayStr', () => {
  const result = actualPostingPace([{ id: 'a', date: '2026-10-10', count: 3 }], '2026-10-05');
  assert.equal(result.postedCount, 3);
  assert.equal(result.daysActive, 0);
  assert.equal(result.postedPerDay, null);
});

test('daysToSell: real gap between a listing\'s datePublished and the matching sale\'s saleDate', () => {
  const listings = [{ id: 'black-boots', datePublished: '2026-09-01' }];
  const sale = { listingId: 'black-boots', saleDate: '2026-09-11' };
  assert.equal(daysToSell(listings, sale), 10);
});

test('daysToSell: null when the sale has no listingId, the listingId resolves to nothing, or either date is missing', () => {
  const listings = [{ id: 'black-boots', datePublished: '2026-09-01' }];
  assert.equal(daysToSell(listings, { saleDate: '2026-09-11' }), null, 'no listingId logged on the sale');
  assert.equal(daysToSell(listings, { listingId: 'white-boots', saleDate: '2026-09-11' }), null, 'listingId does not match any real listing');
  assert.equal(daysToSell(listings, { listingId: 'black-boots', saleDate: null }), null, 'no saleDate logged');
  assert.equal(daysToSell([{ id: 'black-boots', datePublished: null }], { listingId: 'black-boots', saleDate: '2026-09-11' }), null, 'no datePublished logged on the listing');
});

test('avgDaysToSell: averages only the sales that actually resolve to both real dates, dropping the rest rather than treating them as 0', () => {
  const listings = [
    { id: 'black-boots', datePublished: '2026-09-01' },
    { id: 'white-boots', datePublished: '2026-09-01' }
  ];
  const sales = [
    { listingId: 'black-boots', saleDate: '2026-09-11' },
    { listingId: 'white-boots', saleDate: '2026-09-21' },
    { listingId: 'unknown-item', saleDate: '2026-09-11' },
    { listingId: 'black-boots', saleDate: null }
  ];
  assert.equal(avgDaysToSell(listings, sales), 15);
});

test('avgDaysToSell: null when there are no sales, or none resolve to a usable pair of dates', () => {
  assert.equal(avgDaysToSell([], []), null);
  assert.equal(avgDaysToSell([{ id: 'black-boots', datePublished: null }], [{ listingId: 'black-boots', saleDate: '2026-09-11' }]), null);
});

test('sellThroughRate: item-level, not per-platform-instance, draft/ready-to-post never count either way', () => {
  const listings = [
    { id: 'a', status: 'sold' },
    { id: 'b', status: 'live' },
    { id: 'c', status: 'live' },
    { id: 'd', status: 'draft' },
    { id: 'e', status: 'ready-to-post' }
  ];
  const result = sellThroughRate(listings);
  assert.equal(result.sold, 1);
  assert.equal(result.total, 3, 'only live+sold count as ever actually published, draft and ready-to-post are excluded');
  assert.ok(Math.abs(result.rate - 1 / 3) < 1e-9);
});

test('sellThroughRate: null rather than a divide-by-zero rate when nothing has ever actually been published', () => {
  assert.equal(sellThroughRate([]), null);
  assert.equal(sellThroughRate([{ id: 'a', status: 'draft' }]), null);
});

test('buildEngagementCheckFlags: flags a live listing+platform with zero snapshots ever logged', () => {
  const listings = [{ id: 'black-boots', status: 'live', platforms: ['ebay'] }];
  const flags = buildEngagementCheckFlags(listings, [], '2026-09-20', 14);
  assert.equal(flags.length, 1);
  assert.deepEqual(flags[0], { listingId: 'black-boots', platform: 'ebay', lastDate: null, daysSince: null });
});

test('buildEngagementCheckFlags: a recent snapshot clears the flag, a stale one past dueDays re-raises it', () => {
  const listings = [{ id: 'black-boots', status: 'live', platforms: ['ebay'] }];
  const recent = buildEngagementCheckFlags(listings, [
    { listingId: 'black-boots', platform: 'ebay', date: '2026-09-10' }
  ], '2026-09-20', 14);
  assert.equal(recent.length, 0, '10 days ago is inside the 14-day window, not due yet');

  const stale = buildEngagementCheckFlags(listings, [
    { listingId: 'black-boots', platform: 'ebay', date: '2026-08-20' }
  ], '2026-09-20', 14);
  assert.equal(stale.length, 1);
  assert.equal(stale[0].lastDate, '2026-08-20');
  assert.equal(stale[0].daysSince, 31);
});

test('buildEngagementCheckFlags: each platform a listing is live on is checked separately, and picks that platform\'s own latest snapshot', () => {
  const listings = [{ id: 'black-boots', status: 'live', platforms: ['ebay', 'vinted'] }];
  const flags = buildEngagementCheckFlags(listings, [
    { listingId: 'black-boots', platform: 'ebay', date: '2026-09-01' },
    { listingId: 'black-boots', platform: 'ebay', date: '2026-09-18' },
    { listingId: 'black-boots', platform: 'vinted', date: '2026-08-01' }
  ], '2026-09-20', 14);
  assert.equal(flags.length, 1, 'ebay has a snapshot from 2 days ago (the latest of its two), vinted is stale');
  assert.equal(flags[0].platform, 'vinted');
});

test('buildEngagementCheckFlags: never flags a draft, ready-to-post, or sold listing, only live ones', () => {
  const listings = [
    { id: 'a', status: 'draft', platforms: ['ebay'] },
    { id: 'b', status: 'ready-to-post', platforms: ['ebay'] },
    { id: 'c', status: 'sold', platforms: ['ebay'] }
  ];
  assert.deepEqual(buildEngagementCheckFlags(listings, [], '2026-09-20', 14), []);
});

test('uspsPeakSurchargeStatus: "upcoming" before the real Oct 4, 2026 start date, with a real day count', () => {
  const status = uspsPeakSurchargeStatus('2026-10-02');
  assert.equal(status.state, 'upcoming');
  assert.equal(status.daysUntilStart, 2);
});

test('uspsPeakSurchargeStatus: "active" on the start date itself, on the end date itself, and in between', () => {
  assert.equal(uspsPeakSurchargeStatus(USPS_PEAK_SURCHARGE_START).state, 'active');
  assert.equal(uspsPeakSurchargeStatus(USPS_PEAK_SURCHARGE_END).state, 'active');
  const mid = uspsPeakSurchargeStatus('2026-12-01');
  assert.equal(mid.state, 'active');
  assert.equal(mid.daysUntilEnd, 47);
});

test('uspsPeakSurchargeStatus: "past" the day after the real Jan 17, 2027 end date', () => {
  assert.equal(uspsPeakSurchargeStatus('2027-01-18').state, 'past');
});

test('uspsPeakSurchargeStatus: null with no real today to judge from', () => {
  assert.equal(uspsPeakSurchargeStatus(null), null);
  assert.equal(uspsPeakSurchargeStatus(undefined), null);
});

test('holidayShipByStatus: contiguous US region gives the real Dec 17/17/18/19 dates, with a signed day count', () => {
  const rows = holidayShipByStatus('2026-12-10', 'contiguous');
  assert.deepEqual(rows.map(r => r.service), ['USPS Ground Advantage', 'First-Class Mail', 'Priority Mail', 'Priority Mail Express']);
  assert.deepEqual(rows.map(r => r.date), ['2026-12-17', '2026-12-17', '2026-12-18', '2026-12-19']);
  assert.deepEqual(rows.map(r => r.daysUntil), [7, 7, 8, 9]);
  assert.deepEqual(rows.map(r => r.passed), [false, false, false, false]);
});

test('holidayShipByStatus: territories region ships Ground Advantage a day earlier (Dec 16), the rest match contiguous', () => {
  const rows = holidayShipByStatus('2026-12-10', 'territories');
  const ground = rows.find(r => r.service === 'USPS Ground Advantage');
  assert.equal(ground.date, '2026-12-16');
  const express = rows.find(r => r.service === 'Priority Mail Express');
  assert.equal(express.date, '2026-12-19');
});

test('holidayShipByStatus: a date already passed reads as passed with a negative daysUntil, not silently dropped', () => {
  const rows = holidayShipByStatus('2026-12-20', 'contiguous');
  assert.ok(rows.every(r => r.passed === true));
  assert.ok(rows.every(r => r.daysUntil < 0));
});

test('holidayShipByStatus: an unknown region falls back to contiguous rather than throwing', () => {
  const rows = holidayShipByStatus('2026-12-10', 'nowhere');
  assert.deepEqual(rows, holidayShipByStatus('2026-12-10', 'contiguous'));
});

test('isHolidayShipBySeasonStale: false all through the real 2026 season, including right after every date has passed', () => {
  assert.equal(isHolidayShipBySeasonStale('2026-09-22'), false);
  assert.equal(isHolidayShipBySeasonStale('2026-12-10'), false);
  // Every real row has already passed by here (see the "already passed"
  // test above), but it's still the same 2026 season this table covers,
  // the one honest non-stale case this function has to tell apart from a
  // real later year with no refreshed table.
  assert.equal(isHolidayShipBySeasonStale('2026-12-20'), false);
  assert.equal(isHolidayShipBySeasonStale('2026-12-31'), false);
});

test('isHolidayShipBySeasonStale: true once a real later calendar year has started', () => {
  assert.equal(isHolidayShipBySeasonStale('2027-01-01'), true);
  assert.equal(isHolidayShipBySeasonStale('2027-11-01'), true);
  assert.equal(isHolidayShipBySeasonStale('2030-06-15'), true);
});

test('isHolidayShipBySeasonStale: false with no real today to judge from', () => {
  assert.equal(isHolidayShipBySeasonStale(null), false);
  assert.equal(isHolidayShipBySeasonStale(undefined), false);
  assert.equal(isHolidayShipBySeasonStale(''), false);
});

test('HOLIDAY_SHIP_BY_SEASON_YEAR matches the real year every HOLIDAY_SHIP_BY_DATES entry is dated to', () => {
  const allDates = [...HOLIDAY_SHIP_BY_DATES.contiguous, ...HOLIDAY_SHIP_BY_DATES.territories].map(r => r.date.slice(0, 4));
  assert.ok(allDates.every(y => Number(y) === HOLIDAY_SHIP_BY_SEASON_YEAR));
});

test('HOLIDAY_SHIP_BY_DATES: both regions land on the same Priority Mail / Priority Mail Express dates', () => {
  assert.equal(
    HOLIDAY_SHIP_BY_DATES.contiguous.find(r => r.service === 'Priority Mail').date,
    HOLIDAY_SHIP_BY_DATES.territories.find(r => r.service === 'Priority Mail').date
  );
  assert.equal(
    HOLIDAY_SHIP_BY_DATES.contiguous.find(r => r.service === 'Priority Mail Express').date,
    HOLIDAY_SHIP_BY_DATES.territories.find(r => r.service === 'Priority Mail Express').date
  );
});

/*
 * Pure money/date math pulled out of app.js so it can be required directly
 * from a Node test (grading-core.test.js) without loading the rest of the
 * dashboard's DOM-touching code. Same reasoning as validate-core.js in this
 * same folder: one copy of the real rule, usable from both the browser
 * (app.js, via window.CGTGradingCore) and a plain Node test. Three unrelated
 * real questions live here for that same reason, not because they're the
 * same math: "is this raw card worth grading?" (computeGradingMath, the
 * original reason this file exists), "roughly what would a realized sale
 * owe in federal collectibles tax?" (estimateCollectiblesTax/
 * estimateCardCollectiblesTax, added once cards.json grew an acquisitionDate
 * to classify a sale's holding period), and "what is a card's own real
 * gain/loss" (computeGainLoss/computeRealizedGainLoss/computeValueTrend and
 * the isSold/isListed/costPerCard/lastPriceHistoryEntry helpers those are
 * built from), which estimateCardCollectiblesTax itself depends on.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CGTGradingCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  // Applies the published "2x margin" rule of thumb for whether grading a raw
  // card is actually worth it (see e.g. CardGrade.io's and PreGradeCards' 2026
  // grading-ROI writeups): the expected gain over raw value should clear the
  // full cost of grading by at least 2x before committing, since the card
  // could come back at a lower grade than expected and a 1x-or-less margin
  // leaves no room for that risk. Returns null (not a verdict) whenever any of
  // the three real numbers this depends on hasn't actually been researched
  // yet, same "never guess at a missing input" rule as everything else here.
  const GRADING_RISK_MULTIPLE = 2;

  // eBay's own real, published Final Value Fee for its "Sports Trading
  // Cards" category: 13.25% of the sale total up to $7,500/item (2.35% on
  // any portion above that, which a graded single card practically never
  // reaches), confirmed on eBay's 2026 fee-by-category page and cross-
  // checked against seller reports on community.ebay.com and
  // sportscollectorsdaily.com. Lower than eBay's general 13.60% default rate
  // the same way Garage's own real 15.3% shoes-category rate differs from
  // its category default -- categories really do carry different real
  // rates, this is trading cards' specific one, not the general figure.
  // Applied only to expectedGradedValue, the card's own eventual sale once
  // graded: rawValue is not itself being sold here, it is the baseline the
  // card is being upgraded from, so it carries no sale fee of its own. This
  // is a published rate applied to a number that, by definition, has not
  // been sold yet (that is the whole question computeGradingMath answers),
  // so there is no real logged fee to require the way computeRealizedGainLoss
  // requires one for an actual sold card below -- same category of
  // documented rule-of-thumb GRADING_RISK_MULTIPLE already is above, not a
  // silent guess.
  const TYPICAL_MARKETPLACE_FEE_RATE = 0.1325;

  function computeGradingMath(c) {
    if (c.rawValue == null || c.expectedGradedValue == null || c.estimatedGradingCost == null) return null;
    const totalCost = c.estimatedGradingCost + (c.shippingCost || 0);
    const netGradedValue = c.expectedGradedValue * (1 - TYPICAL_MARKETPLACE_FEE_RATE);
    // The "2x margin" rule above is about the raw upside (net-of-fee graded
    // value over raw value) clearing the cost of grading by 2x, not the
    // already-cost-net expectedGain clearing it a second time (that silently
    // demanded a 3x margin instead of the documented 2x, since expectedGain
    // is gross minus totalCost already). expectedGain itself stays net, it
    // is the real "Expected gain" figure shown and sorted on elsewhere.
    const grossGain = netGradedValue - c.rawValue;
    const expectedGain = grossGain - totalCost;
    let verdict;
    if (grossGain >= totalCost * GRADING_RISK_MULTIPLE) verdict = 'worth-grading';
    else if (expectedGain > 0) verdict = 'marginal';
    else verdict = 'not-worth';
    return { totalCost, expectedGain, grossGain, netGradedValue, verdict };
  }

  // Collectibles get a different federal capital-gains treatment than stocks:
  // the IRS treats trading cards as "collectibles" under IRC 408(m), and 26
  // U.S.C. 1(h)(5) caps the long-term rate (held more than one year) at 28%
  // instead of the usual 0/15/20% brackets. Held one year or less, a gain is
  // short-term instead and taxed as plain ordinary income with no cap, up to
  // whatever the seller's real marginal bracket is (see e.g. Weston Tax
  // Associates' and PreGradeCards' 2026 collectibles-tax writeups for the
  // same 28%/one-year rule, cross-checked against 26 U.S.C. 1(h)(5) itself).
  // TOP_ORDINARY_INCOME_RATE is the 2026 top federal marginal bracket (37%,
  // the TCJA rate the One Big Beautiful Bill Act made permanent in July
  // 2025), used only as the same-shape "worst case" ceiling on the
  // short-term side that the long-term case already has a real one for.
  // Neither rate is a promise of Jack's actual tax bill: the real number
  // depends on his whole return (total taxable income, filing status, state
  // tax) and on whether the IRS would treat frequent selling as a
  // dealer/business under 162(a) instead of an investor, which loses
  // capital-gains treatment (and this 28% cap) entirely. This is a real
  // published ceiling to plan around, not tax advice and not a guess.
  const COLLECTIBLES_LONG_TERM_MAX_RATE = 0.28;
  const TOP_ORDINARY_INCOME_RATE = 0.37;

  // "Held more than one year" per the IRS's own holding-period rule (Pub.
  // 550): the day acquired is excluded from the count, so a sale on the
  // exact one-year anniversary of acquisitionDate is still short-term --
  // long-term only starts the day after that anniversary. Returns null
  // (never a guess) whenever either date is missing or not a real calendar
  // date, same convention as computeGradingMath's null-when-missing-inputs
  // above.
  function isLongTermHolding(acquisitionDate, saleDate) {
    const a = typeof acquisitionDate === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(acquisitionDate);
    const s = typeof saleDate === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(saleDate);
    if (!a || !s) return null;
    const anniversary = new Date(Number(a[1]) + 1, Number(a[2]) - 1, Number(a[3]));
    const sale = new Date(Number(s[1]), Number(s[2]) - 1, Number(s[3]));
    if (Number.isNaN(anniversary.getTime()) || Number.isNaN(sale.getTime())) return null;
    return sale.getTime() > anniversary.getTime();
  }

  function classifyHoldingPeriod(acquisitionDate, saleDate) {
    const longTerm = isLongTermHolding(acquisitionDate, saleDate);
    if (longTerm === null) return null;
    return longTerm ? 'long-term' : 'short-term';
  }

  // gain must be a real positive realized gain: a loss or a break-even sale
  // owes no federal tax to estimate, so this returns null rather than a
  // meaningless $0 or negative "tax". Also null whenever the holding period
  // can't actually be classified yet (acquisitionDate and/or saleDate
  // missing), the same "never guess at a missing input" rule
  // computeGradingMath already follows above.
  function estimateCollectiblesTax(gain, acquisitionDate, saleDate) {
    if (gain == null || Number.isNaN(gain) || gain <= 0) return null;
    const holding = classifyHoldingPeriod(acquisitionDate, saleDate);
    if (holding == null) return null;
    const maxRate = holding === 'long-term' ? COLLECTIBLES_LONG_TERM_MAX_RATE : TOP_ORDINARY_INCOME_RATE;
    return { holding, maxRate, maxTax: gain * maxRate };
  }

  // A card is sold once it has a real soldDate (validate-core.js requires
  // soldPrice and soldDate together, so either field alone is enough to
  // check here). Sold cards stay in cards.json as a permanent record of what
  // was owned, but drop out of every "what do I currently hold" total
  // (portfolio value, breakdowns, unrealized gain/loss, the insurance
  // summary) the same way an unpriced card drops out of the priced total
  // instead of counting as $0: no longer owning it isn't a $0 value, it's a
  // different question.
  function isSold(c) {
    return c.soldDate != null;
  }

  // Same "either field alone is enough, validate-core.js requires both"
  // logic as isSold above, for a card that's currently listed for sale but
  // not yet sold. A sold card can still carry stale listing fields
  // (validate-core.js only warns about it, doesn't block), so callers that
  // care about "what's actively for sale right now" should also check
  // !isSold(c).
  function isListed(c) {
    return c.listedDate != null;
  }

  // A submission logs its cost as one invoiced batch total (real, since that
  // is what actually gets paid) and cardCount separately, so nothing on the
  // page ever divided the two even though both were already sitting right
  // there. Null whenever either half is missing or cardCount is 0, same "no
  // value means no value" convention as the rest of this file, not a 0 or a
  // misleading average.
  function costPerCard(s) {
    if (s.cost == null || !s.cardCount) return null;
    return s.cost / s.cardCount;
  }

  // Gain/loss only exists to compute where both a real purchase price
  // (costBasis) and a real researched value (estimatedValue) are on record.
  // Neither field requires the other: plenty of cards will have a price
  // logged with no memory of what was paid, or vice versa, so this returns
  // null rather than treating a missing side as zero.
  function computeGainLoss(c) {
    if (c.costBasis == null || c.estimatedValue == null) return null;
    const abs = c.estimatedValue - c.costBasis;
    const pct = c.costBasis > 0 ? (abs / c.costBasis) * 100 : null;
    return { abs, pct };
  }

  // Only counts when both a real purchase price and a real sale price are on
  // record, same "never guess at a missing side" rule as computeGainLoss's
  // unrealized version. A card sold with no logged costBasis has a real sale
  // price but no real realized gain/loss to compute against.
  //
  // soldPrice is the real gross sale price (what a buyer paid, matching a
  // platform's own 1099-K gross-payment-volume figure), not what actually
  // landed in Jack's payout: a marketplace's final-value fee comes out of
  // that before it does. sellingFees, when logged, is the real fee amount
  // from the actual payout statement (never an estimated rate, same
  // never-guess convention as every other money field here), netted out
  // here so a real profit isn't overstated by the fee the platform kept. An
  // unlogged sellingFees (still null) falls back to 0, i.e. the same gross-
  // only number this always computed before the field existed.
  function computeRealizedGainLoss(c) {
    if (!isSold(c) || c.costBasis == null || c.soldPrice == null) return null;
    const netProceeds = c.soldPrice - (c.sellingFees || 0);
    const abs = netProceeds - c.costBasis;
    const pct = c.costBasis > 0 ? (abs / c.costBasis) * 100 : null;
    return { abs, pct, netProceeds };
  }

  // Wraps estimateCollectiblesTax above with the two real numbers only
  // cards.json actually has: a realized gain/loss (computeRealizedGainLoss
  // above) and the card's own acquisitionDate/soldDate. Only ever computed
  // for a sold card with a real positive realized gain and a real
  // acquisitionDate on record; returns null otherwise (never a guessed tax
  // on a loss, an unsold card, or a sale with no acquisitionDate logged to
  // classify the holding period from).
  function estimateCardCollectiblesTax(c) {
    if (!isSold(c)) return null;
    const rgl = computeRealizedGainLoss(c);
    if (!rgl) return null;
    return estimateCollectiblesTax(rgl.abs, c.acquisitionDate, c.soldDate);
  }

  // priceHistory holds prior researched prices for a card, oldest first,
  // logged when a re-check changes the number instead of silently
  // overwriting it. This reads the most recent prior entry (regardless of
  // what order it was actually written in the JSON) so a hand-edited file
  // that didn't bother sorting the array still compares against the right
  // one.
  function lastPriceHistoryEntry(c) {
    if (!c.priceHistory || !c.priceHistory.length) return null;
    return c.priceHistory.slice().sort((a, b) => (a.date || '').localeCompare(b.date || '')).pop();
  }

  // Same "only compute when both real numbers exist" rule as
  // computeGainLoss: a card with no priceHistory yet (priced exactly once)
  // has no trend to show, not a 0% change.
  function computeValueTrend(c) {
    const prev = lastPriceHistoryEntry(c);
    if (!prev || c.estimatedValue == null) return null;
    const abs = c.estimatedValue - prev.value;
    const pct = prev.value > 0 ? (abs / prev.value) * 100 : null;
    return { abs, pct, prevValue: prev.value, prevDate: prev.date };
  }

  // Reconstructs the real collection's total value at every distinct date any
  // unsold, priced real card actually had a value on record (its current
  // datePriced plus every dated entry in its own priceHistory), the "value
  // over time" trend CollX and Card Ladder-style trackers lead with once a
  // collection has real re-pricing history. At each snapshot date a card
  // counts at the latest real value it had on or before that date (not
  // counted at all before its first real price, dropped entirely once its
  // own soldDate has passed, same scope as every other portfolio total on
  // this page). Returns null when fewer than two distinct real dates exist
  // across the whole collection, since one shared date (or none) is not a
  // trend, it is everything having been priced once on the same day.
  //
  // Takes `cards` already filtered to whatever the caller counts as "real"
  // (app.js excludes the seeded example row before calling this), same
  // separation every other function here keeps: this module only knows real
  // card-shape rules (estimatedValue, datePriced, priceHistory, soldDate),
  // never "is this the demo row", which is a presentation concern the caller
  // owns.
  function buildPortfolioValueTimeline(cards) {
    const perCard = (cards || [])
      .filter(c => c.estimatedValue != null && c.datePriced)
      .map(c => {
        const points = (c.priceHistory || [])
          .filter(p => p.date && p.value != null)
          .map(p => ({ date: p.date, value: p.value }));
        points.push({ date: c.datePriced, value: c.estimatedValue });
        points.sort((a, b) => a.date.localeCompare(b.date));
        return { card: c, points };
      });
    if (!perCard.length) return null;

    const allDates = new Set();
    perCard.forEach(({ points }) => points.forEach(p => allDates.add(p.date)));
    const sortedDates = [...allDates].sort();
    if (sortedDates.length < 2) return null;

    // Was one full points.filter() per (card, date) pair, O(dates x cards x
    // points), re-scanning every card's whole price history from scratch at
    // every single date. Harmless with 3 cards, but the same "recompute over
    // everything on every render" shape the 13x-candidate-list-rebuild and
    // O(n^2) photo-audit-grid perf fixes already caught elsewhere on this
    // hub. Since both sortedDates and each card's own points are already
    // ascending, a single forward-walking pointer per card finds the same
    // "latest point on or before this date" value without re-scanning: dates
    // and a card's points only ever move forward together, never backward.
    const totals = sortedDates.map(date => ({ date, total: 0, countedCards: 0 }));
    perCard.forEach(({ card, points }) => {
      let pointIdx = -1;
      for (let i = 0; i < sortedDates.length; i++) {
        const date = sortedDates[i];
        // soldDate <= date only ever gets truer as date increases, so once a
        // card drops out here it stays out for every later date too.
        if (isSold(card) && card.soldDate && card.soldDate <= date) break;
        while (pointIdx + 1 < points.length && points[pointIdx + 1].date <= date) pointIdx++;
        if (pointIdx < 0) continue;
        totals[i].total += points[pointIdx].value;
        totals[i].countedCards++;
      }
    });
    return totals;
  }

  return {
    computeGradingMath, GRADING_RISK_MULTIPLE, TYPICAL_MARKETPLACE_FEE_RATE,
    classifyHoldingPeriod, isLongTermHolding, estimateCollectiblesTax,
    COLLECTIBLES_LONG_TERM_MAX_RATE, TOP_ORDINARY_INCOME_RATE,
    isSold, isListed, costPerCard, computeGainLoss, computeRealizedGainLoss,
    estimateCardCollectiblesTax, lastPriceHistoryEntry, computeValueTrend,
    buildPortfolioValueTimeline
  };
});

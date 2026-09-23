/*
 * Pure money/date math pulled out of app.js so it can be required directly
 * from a Node test (grading-core.test.js) without loading the rest of the
 * dashboard's DOM-touching code. Same reasoning as validate-core.js in this
 * same folder: one copy of the real rule, usable from both the browser
 * (app.js, via window.CGTGradingCore) and a plain Node test. Two unrelated
 * real questions live here for that same reason, not because they're the
 * same math: "is this raw card worth grading?" (computeGradingMath, the
 * original reason this file exists) and "roughly what would a realized sale
 * owe in federal collectibles tax?" (estimateCollectiblesTax, added once
 * cards.json grew an acquisitionDate to classify a sale's holding period).
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

  function computeGradingMath(c) {
    if (c.rawValue == null || c.expectedGradedValue == null || c.estimatedGradingCost == null) return null;
    const totalCost = c.estimatedGradingCost + (c.shippingCost || 0);
    // The "2x margin" rule above is about the raw upside (graded value over
    // raw value) clearing the cost of grading by 2x, not the already-cost-net
    // expectedGain clearing it a second time (that silently demanded a 3x
    // margin instead of the documented 2x, since expectedGain is gross minus
    // totalCost already). expectedGain itself stays net, it is the real
    // "Expected gain" figure shown and sorted on elsewhere.
    const grossGain = c.expectedGradedValue - c.rawValue;
    const expectedGain = grossGain - totalCost;
    let verdict;
    if (grossGain >= totalCost * GRADING_RISK_MULTIPLE) verdict = 'worth-grading';
    else if (expectedGain > 0) verdict = 'marginal';
    else verdict = 'not-worth';
    return { totalCost, expectedGain, verdict };
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

  return {
    computeGradingMath, GRADING_RISK_MULTIPLE,
    classifyHoldingPeriod, isLongTermHolding, estimateCollectiblesTax,
    COLLECTIBLES_LONG_TERM_MAX_RATE, TOP_ORDINARY_INCOME_RATE
  };
});

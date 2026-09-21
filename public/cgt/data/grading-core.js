/*
 * Pure "is this raw card worth grading?" math, pulled out of app.js so it can
 * be required directly from a Node test (grading-core.test.js) without
 * loading the rest of the dashboard's DOM-touching code. Same reasoning as
 * validate-core.js in this same folder: one copy of the real rule, usable
 * from both the browser (app.js, via window.CGTGradingCore) and a plain
 * Node test.
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

  return { computeGradingMath, GRADING_RISK_MULTIPLE };
});

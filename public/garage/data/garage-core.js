/*
 * Pure fee/date math shared between the dashboard itself (public/garage/app.js)
 * and this file's own regression test suite (garage-core.test.js). No
 * Node-only APIs, same shared-core pattern as validate-core.js in this same
 * directory (see GarageValidateCore) and goals-core.js in public/sondrik/data,
 * so the math that renders real dollar figures and real deadlines can
 * actually be unit-tested instead of only ever running live in a browser.
 *
 * This is exactly the kind of code that has already produced real, deployed
 * bugs on this page (see changelog.json): a double-charged eBay processing
 * fee undercounting every net payout, a "shoes category" rate mixed up with
 * an effective rate twice in a row (fb89c3e then d1d3c45), a Poshmark
 * dispute deadline computed on business days instead of the real-time clock
 * it actually runs on (1e44742), and a relist stat counting an item with
 * nothing left to relist (c142a62). None of those had a regression test, so
 * nothing would have caught any of them coming back. This gives that math
 * the same coverage validate-core.js already gives the duplicate-listing
 * check.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GarageCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const PLATFORM_LABELS = { ebay: 'eBay', vinted: 'Vinted', poshmark: 'Poshmark', depop: 'Depop' };

  // Real, optional Depop add-on fee: Boosted Listings, opt-in per listing,
  // charged only on a sale that actually went through that boost. Not part
  // of Depop's baseline fee, kept as its own constant so callers only add it
  // when they mean to.
  const DEPOP_BOOST_FEE_PCT = 0.12;

  // Real reseller-tooling convention (Vendoo, Crosslist, etc.): eBay, Vinted,
  // and Depop's search all favor listing recency, so ~30 days without a sale
  // is the common point to relist or renew. Poshmark is the opposite case,
  // its Excessive Listing Removal Policy blocks relisting the same item
  // again before day 60, so it needs its own later threshold instead of the
  // general 30-day one.
  const RELIST_FRESH_DAYS = 30;
  const POSHMARK_HOLD_DAYS = 60;

  // Standard published 2026 seller fee schedules, not a live account
  // connection. eBay moved to managed payments years ago: the final value
  // fee is one combined rate with no separate card-processing surcharge on
  // top, so an earlier "13.25% + 2.9% + $0.30" formula here was
  // double-charging a processing fee that no longer exists, and
  // undercounting every eBay net payout on the page by it.
  function estimateNetPayout(platform, price, category) {
    if (price == null) return null;
    switch (platform) {
      // Clothing, Shoes & Accessories is one of eBay's standard-rate
      // categories, 13.6% same as most others, not a higher rate of its own
      // (eBay's published seller fee schedule; the only shoes-specific
      // exception is a *lower* 8% rate for qualifying athletic shoes sold at
      // $150+, which doesn't apply to either real boots listing here). An
      // earlier version of this charged the "shoes" category 14.9%, mixing
      // up that flat rate with the effective rate a small sale gets once the
      // fixed per-order fee is folded in (13.6% + $0.40 on a $30 sale really
      // is ~14.9% of the total), which isn't a category-specific number.
      case 'ebay':
        return price - (price * 0.136 + (price > 10 ? 0.40 : 0.30));
      case 'vinted': return price;
      case 'poshmark': return price < 15 ? price - 2.95 : price * 0.80;
      case 'depop': return price - (price * 0.033 + 0.45);
      default: return null;
    }
  }

  function ebayMinPriceForNet(targetNet) {
    const lowStep = (targetNet + 0.30) / (1 - 0.136);
    if (lowStep <= 10) return lowStep;
    return (targetNet + 0.40) / (1 - 0.136);
  }

  function depopMinPriceForNet(targetNet, applyBoost) {
    const feeRate = 0.033 + (applyBoost ? DEPOP_BOOST_FEE_PCT : 0);
    return (targetNet + 0.45) / (1 - feeRate);
  }

  // Poshmark's fee is flat $2.95 under $15, else a 20% commission, so the
  // same assume-then-check approach as eBay above: try the flat-fee branch
  // first, and fall back to the commission branch if that price wouldn't
  // actually land under $15.
  function poshmarkMinPriceForNet(targetNet) {
    const flatStep = targetNet + 2.95;
    if (flatStep < 15) return flatStep;
    return targetNet / 0.80;
  }

  function minListingPriceForNet(platform, targetNet, applyBoost) {
    switch (platform) {
      case 'ebay': return ebayMinPriceForNet(targetNet);
      case 'vinted': return targetNet;
      case 'poshmark': return poshmarkMinPriceForNet(targetNet);
      case 'depop': return depopMinPriceForNet(targetNet, applyBoost);
      default: return null;
    }
  }

  function addDaysToDateStr(dateStr, days) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // Real response-clock math for the two platforms with a published fixed
  // window (see the "Return & dispute handling, by platform" reference table
  // on the page, sourced from each platform's own help-center docs as of
  // September 2026): eBay gives the seller 3 *business* days before the
  // buyer can ask eBay to step in, Poshmark gives about 24 hours. Vinted and
  // Depop have no fixed clock, so there's no real deadline date to compute
  // for them.
  function addBusinessDays(dateStr, days) {
    const d = new Date(dateStr + 'T00:00:00');
    let added = 0;
    while (added < days) {
      d.setDate(d.getDate() + 1);
      const day = d.getDay();
      if (day !== 0 && day !== 6) added++;
    }
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // Only ever computed for a dispute that's still open and has a real
  // openedDate logged, a resolved case or one missing its open date has
  // nothing left to respond to (or nothing to compute a deadline from).
  function disputeResponseDeadline(d) {
    if (d.status !== 'open' || !d.openedDate) return null;
    if (d.platform === 'ebay') return addBusinessDays(d.openedDate, 3);
    // Poshmark's ~24-hour window runs on the real-time clock, not business
    // days (see the comment above addBusinessDays), so a case opened Friday
    // or Saturday needs the plain next-calendar-day helper above, not the
    // weekend-skipping one: addBusinessDays(d.openedDate, 1) on a Friday
    // reported Monday as the deadline, up to 2 real days late on a window
    // this short, and Jack could have already missed it before ever seeing
    // "by Monday" as still-safe.
    if (d.platform === 'poshmark') return addDaysToDateStr(d.openedDate, 1);
    return null;
  }

  // Poshmark's prepaid USPS Ground Advantage label is a flat $6.49 buyer-paid
  // rate only up to a 5 lb boxed weight (current 2026 rate); past that the
  // label steps up to $11.49 (5.1-10 lb) or $16.49 (10.1-15 lb) and the
  // seller absorbs the $5/$10 difference out of the sale. Boots are the real
  // risk case in this inventory, easy to misjudge without a scale. This was
  // inline-only in app.js's renderPoshWeightCheck, the same kind of untested
  // real money math that already produced the bugs listed in this file's
  // header comment, so it lives here now with the rest of that math.
  const POSHMARK_WEIGHT_TIERS = [
    { max: 5, buyerRate: 6.49, sellerCost: 0, labelCost: 6.49 },
    { max: 10, buyerRate: 6.49, sellerCost: 5, labelCost: 11.49 },
    { max: 15, buyerRate: 6.49, sellerCost: 10, labelCost: 16.49 }
  ];

  // Returns the matching tier, or null once a boxed weight is past all of
  // Poshmark's flat-rate tiers (a real case this calculator doesn't cover,
  // the caller should say so rather than guess).
  function poshmarkWeightTier(weight) {
    if (weight == null || Number.isNaN(weight) || weight < 0) return null;
    return POSHMARK_WEIGHT_TIERS.find(t => weight <= t.max) || null;
  }

  // Pure bundle-discount math: separateNet is what each item would net
  // listed on its own, bundledNet is the discounted total run through the
  // same per-platform fee formula once, swing is the real difference. Both
  // legs go through estimateNetPayout so a fee-schedule fix in one place
  // never has to be re-applied here separately.
  function bundleNetComparison(platform, prices, discountPct) {
    const pct = Math.min(100, Math.max(0, discountPct || 0));
    const bundleTotal = prices.reduce((s, p) => s + p, 0) * (1 - pct / 100);
    const separateNet = prices.reduce((s, p) => s + estimateNetPayout(platform, p), 0);
    const bundledNet = estimateNetPayout(platform, bundleTotal);
    return { bundleTotal, separateNet, bundledNet, swing: bundledNet - separateNet };
  }

  function remainingPlatforms(l) {
    const soldOn = l.soldOn || [];
    return (l.platforms || []).filter(p => !soldOn.includes(p));
  }

  // Returns null (not days-ago-unknown-as-zero) when there's no real logged
  // date to compute from, so the UI can show an honest "not logged" state
  // instead of a misleading "0 days". nowMs defaults to the real clock;
  // callers (and this file's tests) can pass a fixed reference time instead.
  function daysSincePublished(dateStr, nowMs) {
    if (!dateStr) return null;
    const published = new Date(dateStr + 'T00:00:00');
    if (Number.isNaN(published.getTime())) return null;
    const now = nowMs == null ? Date.now() : nowMs;
    return Math.max(0, Math.floor((now - published.getTime()) / 86400000));
  }

  // A live listing still counts as "due for relist" only if it actually has
  // a remaining platform to relist on: one sold on its only listed platform
  // but not yet flipped to status 'sold' should not inflate this, the same
  // guard relistGuidanceParts below already applies per-row (see c142a62).
  function isDueForRelist(l, days) {
    return days != null && days >= RELIST_FRESH_DAYS && remainingPlatforms(l).length > 0;
  }

  // Plain-text guidance pieces shared by the on-page badges and the CSV
  // export, so both read the exact same underlying judgment instead of two
  // versions that could quietly drift apart. platformLabels defaults to
  // PLATFORM_LABELS above; callers can pass their own map (tests do, to stay
  // independent of the display strings).
  function relistGuidanceParts(l, days, platformLabels) {
    const labels = platformLabels || PLATFORM_LABELS;
    if (days == null) return [{ tier: 'unknown', text: 'log a publish date for guidance' }];
    if (days < RELIST_FRESH_DAYS) {
      return [{ tier: 'fresh', text: `Fresh, ${RELIST_FRESH_DAYS - days}d until a refresh is worth considering` }];
    }
    const platforms = remainingPlatforms(l);
    const parts = [];
    const nonPoshmark = platforms.filter(p => p !== 'poshmark');
    if (nonPoshmark.length) {
      parts.push({ tier: 'due', text: `Relist/renew on ${nonPoshmark.map(p => labels[p] || p).join(', ')}` });
    }
    if (platforms.includes('poshmark')) {
      parts.push(days < POSHMARK_HOLD_DAYS
        ? { tier: 'hold', text: `Hold off on Poshmark until day ${POSHMARK_HOLD_DAYS}` }
        : { tier: 'due', text: 'Eligible to relist on Poshmark' });
    }
    return parts.length ? parts : [{ tier: 'unknown', text: 'nothing left to relist' }];
  }

  return {
    PLATFORM_LABELS, DEPOP_BOOST_FEE_PCT, RELIST_FRESH_DAYS, POSHMARK_HOLD_DAYS,
    POSHMARK_WEIGHT_TIERS,
    estimateNetPayout,
    ebayMinPriceForNet, depopMinPriceForNet, poshmarkMinPriceForNet, minListingPriceForNet,
    addDaysToDateStr, addBusinessDays, disputeResponseDeadline,
    remainingPlatforms, daysSincePublished, isDueForRelist, relistGuidanceParts,
    poshmarkWeightTier, bundleNetComparison
  };
});

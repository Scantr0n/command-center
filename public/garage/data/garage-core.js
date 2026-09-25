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

  // eBay's final value fee is not one flat percentage across every
  // category. Most categories, including Consumer Electronics, charge the
  // 13.6% standard rate; Clothing, Shoes & Accessories charges 15.3%
  // instead (eBay raised it from 15% to 15.3% during 2026, per eBay's own
  // published seller fee schedule as of September 2026). Both real live
  // boots listings are "shoes", so 15.3% is the rate that actually applies
  // to them, not the standard one, an earlier version of this file charged
  // them 13.6% and undercounted both listings' real net payout by it. This
  // is a genuine eBay-published category rate, and a different number from
  // the ~14.9% figure an earlier bug (fb89c3e, reverted at d1d3c45) briefly
  // charged the "shoes" category: that number was never a real category
  // rate at all, just a small sale's *effective* rate once the flat
  // per-order fee gets folded in (13.6% + $0.40 on a $30 sale works out to
  // ~14.9% of the total). The only other shoes-specific number on this page
  // is the unrelated *lower* 8% rate for qualifying athletic shoes sold at
  // $150+, which doesn't apply to either real boots listing here (both are
  // under $150 and non-athletic).
  const EBAY_STANDARD_RATE = 0.136;
  const EBAY_CATEGORY_RATES = { shoes: 0.153 };

  function ebayFinalValueRate(category) {
    return EBAY_CATEGORY_RATES[category] || EBAY_STANDARD_RATE;
  }

  // Standard published 2026 seller fee schedules, not a live account
  // connection. eBay moved to managed payments years ago: the final value
  // fee is one combined rate with no separate card-processing surcharge on
  // top, so an earlier "13.25% + 2.9% + $0.30" formula here was
  // double-charging a processing fee that no longer exists, and
  // undercounting every eBay net payout on the page by it.
  function estimateNetPayout(platform, price, category) {
    if (price == null) return null;
    switch (platform) {
      case 'ebay':
        return price - (price * ebayFinalValueRate(category) + (price > 10 ? 0.40 : 0.30));
      case 'vinted': return price;
      case 'poshmark': return price < 15 ? price - 2.95 : price * 0.80;
      case 'depop': return price - (price * 0.033 + 0.45);
      default: return null;
    }
  }

  function ebayMinPriceForNet(targetNet, category) {
    const rate = ebayFinalValueRate(category);
    const lowStep = (targetNet + 0.30) / (1 - rate);
    if (lowStep <= 10) return lowStep;
    return (targetNet + 0.40) / (1 - rate);
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

  // Consecutive days of at least one logged Poshmark share, walking back
  // from today through the real logged dates only, never assuming an
  // ungapped day was actually shared. A day not logged yet stays inside the
  // streak until it's actually over, so opening this page in the morning
  // before today's first share doesn't read as a broken streak. todayStr is
  // passed in rather than read from the real clock here, the same reason
  // every other date function in this file takes its "today" as an argument:
  // a pure function of its inputs can actually be unit-tested against a
  // fixed date instead of only ever running live against whatever day it
  // happens to be.
  function computePoshmarkShareStreak(log, todayStr) {
    let cursor = todayStr;
    if (!log[cursor]) cursor = addDaysToDateStr(cursor, -1);
    let streak = 0;
    while (log[cursor]) {
      streak++;
      cursor = addDaysToDateStr(cursor, -1);
    }
    return streak;
  }

  function minListingPriceForNet(platform, targetNet, applyBoost, category) {
    switch (platform) {
      case 'ebay': return ebayMinPriceForNet(targetNet, category);
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

  // Real IRS-published standard business mileage rates for 2026: 72.5
  // cents/mi Jan 1 - Jun 30, then a mid-year increase to 76 cents/mi Jul 1 -
  // Dec 31 announced 2026-07-13 due to fuel prices (irs.gov/newsroom: "IRS
  // sets 2026 business standard mileage rate at 72.5 cents per mile" and
  // "IRS Increases Standard Mileage Rate for Second Half of 2026"). This
  // used to be copy-pasted into both app.js and validate.js separately with
  // a comment on each saying "kept in sync with the other one", the same
  // manual-sync shape as the eBay-fee and Poshmark-deadline bugs above, so
  // it lives here once instead and both files require it from here. Only
  // 2026 is a real published rate right now, an expense dated outside it
  // gets an honest "no rate known" rather than reusing the wrong year's
  // number.
  const MILEAGE_RATES_2026 = [
    { from: '2026-01-01', to: '2026-06-30', rate: 0.725 },
    { from: '2026-07-01', to: '2026-12-31', rate: 0.76 }
  ];
  function irsMileageRateForDate(dateStr) {
    if (!dateStr) return null;
    const hit = MILEAGE_RATES_2026.find(r => dateStr >= r.from && dateStr <= r.to);
    return hit ? hit.rate : null;
  }

  // A mileage expense with real miles and a real date but no computed amount
  // has two very different causes that otherwise render identically as "not
  // logged": a genuine backfill gap (no miles/date logged yet), or this
  // table itself being out of date (dated after MILEAGE_RATES_2026's last
  // known range, e.g. once 2027 starts and the IRS hasn't published or this
  // table hasn't been updated with next year's rate yet). Only the second
  // one is "the app's own fault, not a logging mistake", so it gets a
  // distinct, specific message instead of leaving the two indistinguishable.
  function mileageRateGapReason(e) {
    if (e.amount != null || e.category !== 'mileage' || e.miles == null || !e.date) return null;
    if (irsMileageRateForDate(e.date) != null) return null;
    const lastKnown = MILEAGE_RATES_2026[MILEAGE_RATES_2026.length - 1].to;
    if (e.date > lastKnown) {
      return `No IRS rate known past ${lastKnown}, this tool's rate table only has 2026 rates in it. Log a real ` +
        `manual amount, or add the newly published rate to MILEAGE_RATES_2026 once the IRS announces it.`;
    }
    return `No IRS rate known for ${e.date}, this tool's rate table only has 2026 rates in it. Log a real manual amount instead.`;
  }

  // A logged "amount" always wins (it's a real number someone entered), a
  // mileage entry with no amount falls back to computing one from real
  // miles at the real rate for its real date, everything else with no
  // amount stays honestly un-computable (null) rather than assumed $0.
  function computeExpenseAmount(e) {
    if (e.amount != null) return e.amount;
    if (e.category === 'mileage' && e.miles != null && e.date) {
      const rate = irsMileageRateForDate(e.date);
      return rate != null ? e.miles * rate : null;
    }
    return null;
  }

  // Ties the sales log's own per-sale profit math (real cost basis and
  // shipping cost, see renderSales in app.js) to the business expenses
  // log's own total (computeExpenseAmount above) into the one number
  // neither log shows on its own: real Schedule C net profit for the year,
  // gross revenue minus what was actually spent to source, ship, and run
  // the business. Same calendar-year scope as the 1099-K tracker above
  // (real sales.json/expenses.json rows dated in "year" only) and the same
  // "an unscoped row isn't silently counted" rule every other date-scoped
  // total on this page already follows, since a sale or expense with no
  // real date logged can't honestly be attributed to this year's total.
  function computeYtdNetProfit(sales, expenses, year) {
    const salesThisYear = sales.filter(s => s.saleDate && Number(s.saleDate.slice(0, 4)) === year);
    const expensesThisYear = expenses.filter(e => e.date && Number(e.date.slice(0, 4)) === year);

    const grossRevenue = salesThisYear.reduce((sum, s) => sum + (s.salePrice || 0), 0);

    // Only a sale with a real costBasis or shippingCost logged contributes
    // to cost of goods sold, the same "hasEither" gate renderSales uses for
    // its own per-row profit figure, so this total never silently treats a
    // not-yet-logged cost as a real zero.
    const cogsTrackedSales = salesThisYear.filter(s => s.costBasis != null || s.shippingCost != null);
    const costOfGoodsSold = cogsTrackedSales.reduce((sum, s) => sum + (s.costBasis || 0) + (s.shippingCost || 0), 0);

    const computedExpenseAmounts = expensesThisYear.map(computeExpenseAmount);
    const businessExpenses = computedExpenseAmounts.reduce((sum, a) => sum + (a || 0), 0);
    const expensesUncountedCount = computedExpenseAmounts.filter(a => a == null).length;

    return {
      year,
      salesCount: salesThisYear.length,
      grossRevenue,
      costOfGoodsSold,
      cogsTrackedCount: cogsTrackedSales.length,
      businessExpenses,
      expensesCount: expensesThisYear.length,
      expensesUncountedCount,
      netProfit: grossRevenue - costOfGoodsSold - businessExpenses
    };
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

  // Real reseller counteroffer-ladder convention: accept a near-target offer
  // outright, counter a good-but-low one once splitting the gap, and let a
  // borderline offer's split depend on how long the item's actually been
  // listed (reusing RELIST_FRESH_DAYS above, a stale listing has more to gain
  // from finally moving than a fresh one does from holding the line). This
  // was inline-only in app.js's renderOfferGuide, the exact same untested,
  // branchy real-dollar shape as the bugs listed in this file's header
  // comment (a wrong branch here would suggest a real dollar counteroffer to
  // send a real buyer), so it lives here now with the rest of that math.
  const OFFER_TIER_ACCEPT_PCT = 0.90;
  const OFFER_TIER_COUNTER_PCT = 0.75;
  const OFFER_TIER_BORDERLINE_PCT = 0.50;

  function offerTier(pct) {
    if (pct >= OFFER_TIER_ACCEPT_PCT) return 'accept';
    if (pct >= OFFER_TIER_COUNTER_PCT) return 'counter';
    if (pct >= OFFER_TIER_BORDERLINE_PCT) return 'borderline';
    return 'decline';
  }

  // Returns the suggested counter dollar amount, or null for a tier with
  // nothing to counter (accept it outright, or decline without countering).
  // A borderline offer with no logged listing date defaults to the same
  // firmer split as a genuinely fresh listing, never the stale-listing split,
  // since there's no real evidence yet that it's actually been sitting.
  function offerCounterAmount(tier, offer, asking, days) {
    if (tier === 'counter') return offer + (asking - offer) * 0.5;
    if (tier === 'borderline') {
      return days != null && days >= RELIST_FRESH_DAYS
        ? offer + (asking - offer) * 0.25
        : offer + (asking - offer) * 0.75;
    }
    return null;
  }

  // Real, published, count-based requirements toward eBay's Top Rated Seller
  // tier and Depop's Top Seller tier (see the "Seller status & standards, by
  // platform" reference table on the page), the only two platforms whose
  // status tier has a real numeric threshold this dashboard already logs
  // enough to compute: a trailing-12-month transaction count and dollar
  // volume for eBay, a rolling-30-day dollar volume for Depop, both read
  // straight from real sales.json rows. Vinted and Poshmark's tiers key off
  // a star rating and review count this dashboard has no data source for, so
  // they stay reference-only rather than guessing a number. Neither eBay's
  // defect-rate/late-shipment-rate requirements nor Depop's on-time-shipping
  // requirement are computed either, both need real per-order ship
  // timestamps this dashboard doesn't log; the case-outcome rate below is
  // the one real proxy actually buildable from what disputes.json tracks.
  const EBAY_TRS_WINDOW_DAYS = 365;
  const EBAY_TRS_TRANSACTIONS_TARGET = 100;
  const EBAY_TRS_GROSS_SALES_TARGET = 1000;
  const DEPOP_TOP_SELLER_WINDOW_DAYS = 30;
  const DEPOP_TOP_SELLER_GROSS_SALES_TARGET = 1000;

  function salesInWindow(sales, platform, todayStr, windowDays) {
    const start = addDaysToDateStr(todayStr, -windowDays);
    return (sales || []).filter(s => s.platform === platform && s.saleDate && s.saleDate >= start && s.saleDate <= todayStr);
  }

  function disputesInWindow(disputes, platform, todayStr, windowDays) {
    const start = addDaysToDateStr(todayStr, -windowDays);
    return (disputes || []).filter(d => d.platform === platform && d.openedDate && d.openedDate >= start && d.openedDate <= todayStr);
  }

  // A case resolved in the buyer's favor, or split, is the one outcome that
  // counts against a seller's standing on both platforms below; a case still
  // open or resolved for the seller doesn't. "resolved-buyer"/"resolved-split"
  // are the exact status values the quick-log dispute tool already writes,
  // see the ndStatus options in index.html.
  function isNonSellerResolved(d) {
    return d.status === 'resolved-buyer' || d.status === 'resolved-split';
  }

  // Returns null (not 0) for a rate with no real transactions to divide by
  // yet, same "unknown, not zero" rule daysSincePublished above follows, so
  // an empty sales log reads as "no data yet" rather than a clean 0% record.
  function nonSellerResolvedRate(disputes, sales) {
    return sales.length > 0 ? disputes.filter(isNonSellerResolved).length / sales.length : null;
  }

  function ebayTrsProgress(sales, disputes, todayStr) {
    const windowSales = salesInWindow(sales, 'ebay', todayStr, EBAY_TRS_WINDOW_DAYS);
    const windowDisputes = disputesInWindow(disputes, 'ebay', todayStr, EBAY_TRS_WINDOW_DAYS);
    const transactions = windowSales.length;
    const grossSales = windowSales.reduce((sum, s) => sum + (s.salePrice || 0), 0);
    return {
      windowDays: EBAY_TRS_WINDOW_DAYS,
      transactions, transactionsTarget: EBAY_TRS_TRANSACTIONS_TARGET,
      grossSales, grossSalesTarget: EBAY_TRS_GROSS_SALES_TARGET,
      nonSellerResolvedRate: nonSellerResolvedRate(windowDisputes, windowSales),
      meetsCountTargets: transactions >= EBAY_TRS_TRANSACTIONS_TARGET && grossSales >= EBAY_TRS_GROSS_SALES_TARGET
    };
  }

  function depopTopSellerProgress(sales, disputes, todayStr) {
    const windowSales = salesInWindow(sales, 'depop', todayStr, DEPOP_TOP_SELLER_WINDOW_DAYS);
    const windowDisputes = disputesInWindow(disputes, 'depop', todayStr, DEPOP_TOP_SELLER_WINDOW_DAYS);
    const grossSales = windowSales.reduce((sum, s) => sum + (s.salePrice || 0), 0);
    return {
      windowDays: DEPOP_TOP_SELLER_WINDOW_DAYS,
      grossSales, grossSalesTarget: DEPOP_TOP_SELLER_GROSS_SALES_TARGET,
      nonSellerResolvedRate: nonSellerResolvedRate(windowDisputes, windowSales),
      meetsCountTargets: grossSales >= DEPOP_TOP_SELLER_GROSS_SALES_TARGET
    };
  }

  // Only fires once both real numbers are on file, same "leave it honestly
  // unknown rather than guess" rule as every other computed field on this
  // page: a count with no reorder point set yet can't be judged low or not.
  // Feeds the low-stock stat tile, the top attention bar, the supplies
  // table's low-stock-first sort, and the CSV export, so one real bug here
  // would misreport in all four places at once.
  function isSupplyLowStock(s) {
    return s.qtyOnHand != null && s.reorderThreshold != null && s.qtyOnHand <= s.reorderThreshold;
  }

  return {
    PLATFORM_LABELS, DEPOP_BOOST_FEE_PCT, RELIST_FRESH_DAYS, POSHMARK_HOLD_DAYS,
    POSHMARK_WEIGHT_TIERS, EBAY_STANDARD_RATE, EBAY_CATEGORY_RATES,
    estimateNetPayout, ebayFinalValueRate,
    ebayMinPriceForNet, depopMinPriceForNet, poshmarkMinPriceForNet, minListingPriceForNet,
    MILEAGE_RATES_2026, irsMileageRateForDate, mileageRateGapReason, computeExpenseAmount,
    computeYtdNetProfit,
    addDaysToDateStr, addBusinessDays, disputeResponseDeadline,
    remainingPlatforms, daysSincePublished, isDueForRelist, relistGuidanceParts,
    poshmarkWeightTier, bundleNetComparison,
    computePoshmarkShareStreak,
    OFFER_TIER_ACCEPT_PCT, OFFER_TIER_COUNTER_PCT, OFFER_TIER_BORDERLINE_PCT,
    offerTier, offerCounterAmount,
    EBAY_TRS_WINDOW_DAYS, EBAY_TRS_TRANSACTIONS_TARGET, EBAY_TRS_GROSS_SALES_TARGET,
    DEPOP_TOP_SELLER_WINDOW_DAYS, DEPOP_TOP_SELLER_GROSS_SALES_TARGET,
    ebayTrsProgress, depopTopSellerProgress,
    isSupplyLowStock
  };
});

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

  // One real sale's profit: net payout minus cost basis and shipping, the
  // exact math renderSales/the sales CSV export already used inline. Real
  // gap this closes: renderStats in app.js had its own third copy of this
  // same math that, unlike the other two, substituted a real $0 for a sale
  // with costBasis/shippingCost logged but no salePrice yet (a state the
  // sales table explicitly supports, rendering that row's price as "not
  // set"), silently folding that sale's full logged cost in as a loss on
  // the "Realized profit" stat tile while the same sale showed no profit
  // figure at all in the table or CSV. Returns null, never a guessed
  // number, whenever net payout can't be computed (no salePrice) or neither
  // cost field is logged, so every caller treats "can't compute this sale's
  // profit yet" the same way instead of three different ways.
  function computeSaleProfit(net, sale) {
    const hasEither = sale.costBasis != null || sale.shippingCost != null;
    if (net == null || !hasEither) return null;
    return net - (sale.costBasis || 0) - (sale.shippingCost || 0);
  }

  // Profit as a percent of what the item actually cost to acquire, the real
  // reseller ROI figure: the sales table and CSV already show profit in raw
  // dollars, which doesn't say whether a $20 profit is great (on a $5 thrift
  // find) or a loss of margin (on a $90 wholesale lot item). Needs a real
  // costBasis to divide by, a $0 costBasis is "free item" and would make this
  // read as infinite rather than a real percent, so both return null, same
  // "can't compute this yet" convention as computeSaleProfit above.
  function computeSaleMarginPct(profit, costBasis) {
    if (profit == null || !costBasis) return null;
    return (profit / costBasis) * 100;
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

  // Open disputes whose response deadline has already arrived (or passed),
  // the same "isDueForRelist" cut the Summary row already applies to
  // relists, just not previously surfaced anywhere outside the opt-in
  // browser notification and the .ics export (both easy to miss:
  // notifications are opt-in per device, and nobody opens a calendar file
  // to notice something is already overdue). A dispute past its window can
  // auto-resolve in the buyer's favor, real money, so this belongs next to
  // "Due for a relist" in the stat row. Skips a dispute
  // disputeResponseDeadline can't compute one for (not open, or missing
  // openedDate/an unrecognized platform), same as every other caller of
  // that function.
  function openDisputesDueForResponse(disputes, todayStr) {
    return (disputes || []).filter(d => {
      const deadline = disputeResponseDeadline(d);
      return deadline != null && deadline <= todayStr;
    });
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

  // Signed day count from todayStr to dateStr, negative once dateStr is
  // already in the past, zero on the day itself. Unlike daysSincePublished
  // above (which clamps to a non-negative "age") or daysBetweenDates below
  // (which treats a negative gap as not a real value at all, correct for a
  // ship date that can't precede its sale), a fixed calendar deadline like a
  // quarterly estimated-tax due date genuinely has a distinct "still ahead"
  // vs. "already passed" state worth telling apart, not just a floor of 0.
  function daysUntil(dateStr, todayStr) {
    if (!dateStr || !todayStr) return null;
    const target = new Date(dateStr + 'T00:00:00');
    const today = new Date(todayStr + 'T00:00:00');
    if (Number.isNaN(target.getTime()) || Number.isNaN(today.getTime())) return null;
    return Math.round((target.getTime() - today.getTime()) / 86400000);
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
  // they stay reference-only rather than guessing a number. Depop's real
  // "90%+ shipped within 5 days" requirement is computed below from each
  // sale's own optional shipDate (added once sales.json actually started
  // tracking per-order ship dates). eBay's late-shipment-rate requirement is
  // now judged pass/fail too, once a sale's listingId resolves to a real
  // listing with its own handlingTimeDays logged (added once listings.json
  // actually started tracking each listing's committed eBay handling time):
  // "late" there is relative to that listing's own stated handling time, not
  // a fixed number of days the way Depop's requirement is, so it needs that
  // per-listing join sales.json alone can't provide. The deadline itself is
  // computed with addBusinessDays below, the same weekends-only business-day
  // helper disputeResponseDeadline already uses for eBay's 3-business-day
  // case-response clock; it has no US federal holiday calendar to check
  // against either, same known gap, see the comment above addBusinessDays.
  // A sale whose listing has no handlingTimeDays logged yet, or that has no
  // real shipDate itself, is left out of the rate entirely rather than
  // silently counted as on-time, same "unknown, not a clean pass" rule
  // onTimeShipRate below already follows for Depop. The case-outcome rate
  // below is the one real proxy shared by both platforms, buildable from
  // what disputes.json tracks.
  const EBAY_TRS_WINDOW_DAYS = 365;
  const EBAY_TRS_TRANSACTIONS_TARGET = 100;
  const EBAY_TRS_GROSS_SALES_TARGET = 1000;
  const EBAY_LATE_SHIPMENT_RATE_TARGET = 0.03;
  const DEPOP_TOP_SELLER_WINDOW_DAYS = 30;
  const DEPOP_TOP_SELLER_GROSS_SALES_TARGET = 1000;
  const DEPOP_TOP_SELLER_SHIP_WITHIN_DAYS = 5;
  const DEPOP_TOP_SELLER_ON_TIME_SHIP_RATE_TARGET = 0.9;

  function salesInWindow(sales, platform, todayStr, windowDays) {
    const start = addDaysToDateStr(todayStr, -windowDays);
    return (sales || []).filter(s => s.platform === platform && s.saleDate && s.saleDate >= start && s.saleDate <= todayStr);
  }

  // Whole-day gap between a sale and the day it actually shipped, or null if
  // either date is missing, not a real calendar date, or shipDate falls
  // before saleDate (a logging mistake validate.js also flags, never a real
  // negative shipping time). Same UTC-midnight-anchored Date construction as
  // addDaysToDateStr/daysSincePublished above, so this can't drift a day off
  // from either of them around a timezone boundary.
  function daysBetweenDates(fromStr, toStr) {
    if (!fromStr || !toStr) return null;
    const from = new Date(fromStr + 'T00:00:00');
    const to = new Date(toStr + 'T00:00:00');
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
    const days = Math.round((to.getTime() - from.getTime()) / 86400000);
    return days < 0 ? null : days;
  }

  // Real "time to sell" and "sell-through rate" are the two inventory-velocity
  // numbers every cross-listing tool's own marketing leads with (Vendoo: sellers
  // active on 3+ marketplaces see sell-through 180% higher than single-platform
  // sellers, and regularly delisting/relisting stale inventory drives real
  // sales), and this page tracked neither despite already logging every date
  // needed. Both read straight from fields already on listings.json/sales.json,
  // no new field required. A sale with no listingId, an unresolved listingId, or
  // either date missing honestly drops that one sale from the average rather
  // than guessing one of the two dates.
  function daysToSell(listings, sale) {
    if (!sale || !sale.listingId) return null;
    const listing = (listings || []).find(l => l.id === sale.listingId);
    if (!listing) return null;
    return daysBetweenDates(listing.datePublished, sale.saleDate);
  }

  function avgDaysToSell(listings, sales) {
    const days = (sales || []).map(s => daysToSell(listings, s)).filter(d => d != null);
    if (!days.length) return null;
    return days.reduce((sum, d) => sum + d, 0) / days.length;
  }

  // Item-level, not per-platform-instance: a 4-platform item that sells on
  // just one of them counts once here, same unit the Pipeline stage note
  // already uses ("9 instances, 3 unique items"). "Ever actually published"
  // means status is now live or sold, draft/ready-to-post were never
  // actually offered for sale so they can't count against the rate either
  // way.
  function sellThroughRate(listings) {
    const everPublished = (listings || []).filter(l => l.status === 'live' || l.status === 'sold');
    if (!everPublished.length) return null;
    const sold = everPublished.filter(l => l.status === 'sold');
    return { rate: sold.length / everPublished.length, sold: sold.length, total: everPublished.length };
  }

  // Turns pipeline.json's own real postingLog (one entry per real day items
  // actually got posted from the "ready-to-post" backlog, see the Posting
  // pace planner's quick-log form in app.js) into an actual pace, kept
  // entirely separate from that planner's own "if today's pace holds"
  // figure: that one is a hypothetical rate typed into a plain number
  // input and never checked against anything, this is the real log checked
  // against the real calendar. daysActive spans from the earliest logged
  // date through today, inclusive, using daysBetweenDates above so this
  // can't drift a day off from the rest of this file's date math. Returns a
  // null postedPerDay with no entries logged yet, or with an entry dated
  // after todayStr (daysBetweenDates itself returns null for that, the same
  // "future date" guard validate.js separately enforces), rather than a
  // divide-by-zero or a guessed rate, the same "unknown, not a guess" rule
  // the rest of this file already follows.
  function actualPostingPace(postingLog, todayStr) {
    const entries = (postingLog || []).filter(e => e && e.date && e.count != null);
    const postedCount = entries.reduce((sum, e) => sum + e.count, 0);
    if (!entries.length) return { postedCount: 0, firstDate: null, daysActive: 0, postedPerDay: null };

    const firstDate = entries.reduce((min, e) => (e.date < min ? e.date : min), entries[0].date);
    const daysSinceFirst = daysBetweenDates(firstDate, todayStr);
    if (daysSinceFirst == null) return { postedCount, firstDate, daysActive: 0, postedPerDay: null };

    const daysActive = daysSinceFirst + 1;
    return { postedCount, firstDate, daysActive, postedPerDay: postedCount / daysActive };
  }

  // Real on-time-shipping rate among the sales in the window that actually
  // have both a saleDate and a shipDate logged, e.g. Depop's own "90%+
  // shipped within 5 days" Top Seller requirement. Returns null (not 0) when
  // no sale in the window has both dates logged yet, the same "unknown, not
  // a clean 0%" rule nonSellerResolvedRate above already follows, so a real
  // shortfall never reads identically to "no data logged yet". sampleSize is
  // returned alongside so callers can show a rate has run on the full window
  // or on only a partial, still-growing sample.
  function onTimeShipRate(windowSales, withinDays) {
    const judged = windowSales.filter(s => daysBetweenDates(s.saleDate, s.shipDate) != null);
    if (!judged.length) return { rate: null, sampleSize: 0 };
    const onTime = judged.filter(s => daysBetweenDates(s.saleDate, s.shipDate) <= withinDays).length;
    return { rate: onTime / judged.length, sampleSize: judged.length };
  }

  // Plain average days-to-ship over the same judged sample as onTimeShipRate
  // above, informational only (see the comment above EBAY_TRS_WINDOW_DAYS),
  // never compared against eBay's real late-shipment-rate target.
  function avgDaysToShip(windowSales) {
    const gaps = windowSales.map(s => daysBetweenDates(s.saleDate, s.shipDate)).filter(d => d != null);
    if (!gaps.length) return { avgDays: null, sampleSize: 0 };
    return { avgDays: gaps.reduce((sum, d) => sum + d, 0) / gaps.length, sampleSize: gaps.length };
  }

  // The real calendar date a sale's shipment is due by, given the listing's
  // own committed eBay handling time (a whole number of *business* days,
  // same unit eBay's own handling-time setting uses). Reuses addBusinessDays
  // above rather than a second copy of the weekend-skipping loop, so the two
  // dates can never drift apart the way two independently hand-maintained
  // implementations already have once in this file (see EBAY_CATEGORY_RATES'
  // own history). Returns null with no real saleDate or handlingTimeDays to
  // compute from, same "unknown, not a guess" rule as disputeResponseDeadline.
  function shipDeadline(saleDate, handlingTimeDays) {
    if (!saleDate || handlingTimeDays == null) return null;
    return addBusinessDays(saleDate, handlingTimeDays);
  }

  // A sale is only ever judged late once it has a real deadline to compare
  // against (the matched listing's own handlingTimeDays) and a real shipDate
  // to compare it with; either missing returns null, not false, so a
  // never-shipped or never-timed sale can't silently read as "on time".
  // String comparison is safe here since both sides are the same YYYY-MM-DD
  // shape shipDeadline/addBusinessDays always produce.
  function isLateShipment(sale, listing) {
    const deadline = shipDeadline(sale.saleDate, listing && listing.handlingTimeDays);
    if (!deadline || !sale.shipDate) return null;
    return sale.shipDate > deadline;
  }

  // Real per-platform timing for the first of the two real steps between a
  // sale and money actually sitting in Jack's bank account: funds landing in
  // that platform's own in-app balance (eBay's Seller Hub balance, the
  // Poshmark balance, the Depop Balance, the Vinted Wallet). Each rule below
  // is sourced from that platform's own current help documentation as of
  // September 2026 (see the "Payout timeline by platform" reference table on
  // the page for the full citations). This deliberately stops at that first
  // step and never computes the second one, the actual bank transfer/
  // redemption, because that step depends on a real setting this dashboard
  // has no data source for: eBay's payout schedule (daily vs.
  // weekly/biweekly/monthly, which changes whether the transfer is initiated
  // within 2 days or only on the next Tuesday) and Poshmark's chosen
  // redemption method (Instant Transfer, direct deposit, PayPal/Venmo, or a
  // mailed check all take different real amounts of time). That second step
  // stays reference-only in the table instead of a guessed number here.
  function expectedBalanceDate(sale) {
    if (!sale || !sale.platform) return null;
    if (sale.platform === 'ebay') {
      // eBay generally makes funds available in Seller Hub within 2 days of
      // confirming the buyer's payment (eBay Seller Center, "Payments and
      // earnings"). A sale is only ever logged here once payment is
      // confirmed, so that's 2 real days after the sale's own saleDate.
      return sale.saleDate ? addDaysToDateStr(sale.saleDate, 2) : null;
    }
    if (sale.platform === 'poshmark') {
      // Released to the Poshmark balance 3 days after delivery, sooner if
      // the buyer accepts the order first (support.poshmark.com, "When do I
      // get paid for a shipped order?"). Keyed off delivery, not the sale
      // itself, so this needs a real deliveryDate logged, same as the
      // dispute-window clock on the Return & dispute handling table above.
      return sale.deliveryDate ? addDaysToDateStr(sale.deliveryDate, 3) : null;
    }
    if (sale.platform === 'depop') {
      // Whichever comes first: 2 business days after delivery, or 10
      // business days after the sale (Depop Help Center, "How do I get
      // paid? - US"). Computes both sides when both dates are known and
      // takes the earlier one, the real "whichever comes first" rule;
      // either date alone is enough to compute its own side.
      const fromDelivery = sale.deliveryDate ? addBusinessDays(sale.deliveryDate, 2) : null;
      const fromSale = sale.saleDate ? addBusinessDays(sale.saleDate, 10) : null;
      if (fromDelivery && fromSale) return fromDelivery < fromSale ? fromDelivery : fromSale;
      return fromDelivery || fromSale;
    }
    if (sale.platform === 'vinted') {
      // To the Vinted Wallet within 2 days of delivery, whether or not the
      // buyer actively confirms receipt (vinted.com/help, "Getting paid for
      // a completed sale"). Same delivery-keyed clock as Poshmark's above,
      // just a shorter real window.
      return sale.deliveryDate ? addDaysToDateStr(sale.deliveryDate, 2) : null;
    }
    return null;
  }

  // eBay's own late-shipment-rate requirement, judged for real: for each
  // sale in the window, looks up its matching listing by the sale's own
  // optional listingId (added once sales.json started tracking that join)
  // and only counts the sale toward the rate once that listing has a real
  // handlingTimeDays logged and the sale itself has a real shipDate, the
  // same "leave the unknown ones out rather than guess" rule onTimeShipRate
  // above already follows for Depop. sampleSize is the count actually judged,
  // out of windowSales.length, so a partial sample never reads as a full one.
  function ebayLateShipmentRate(windowSales, listings) {
    const byId = new Map((listings || []).filter(l => l && l.id).map(l => [l.id, l]));
    const judged = windowSales.filter(s => {
      const listing = s.listingId && byId.get(s.listingId);
      return !!(listing && listing.handlingTimeDays != null && s.shipDate);
    });
    if (!judged.length) return { rate: null, sampleSize: 0 };
    const late = judged.filter(s => isLateShipment(s, byId.get(s.listingId))).length;
    return { rate: late / judged.length, sampleSize: judged.length };
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

  // listings is optional (defaults to none, via the `|| []` inside
  // ebayLateShipmentRate/the byId lookup) so every existing caller and test
  // that only ever passed (sales, disputes, todayStr) keeps working exactly
  // as before, just with lateShipmentRate staying null, same as before this
  // was ever computable at all.
  function ebayTrsProgress(sales, disputes, todayStr, listings) {
    const windowSales = salesInWindow(sales, 'ebay', todayStr, EBAY_TRS_WINDOW_DAYS);
    const windowDisputes = disputesInWindow(disputes, 'ebay', todayStr, EBAY_TRS_WINDOW_DAYS);
    const transactions = windowSales.length;
    const grossSales = windowSales.reduce((sum, s) => sum + (s.salePrice || 0), 0);
    const shipStats = avgDaysToShip(windowSales);
    const lateShipStats = ebayLateShipmentRate(windowSales, listings);
    return {
      windowDays: EBAY_TRS_WINDOW_DAYS,
      transactions, transactionsTarget: EBAY_TRS_TRANSACTIONS_TARGET,
      grossSales, grossSalesTarget: EBAY_TRS_GROSS_SALES_TARGET,
      nonSellerResolvedRate: nonSellerResolvedRate(windowDisputes, windowSales),
      avgDaysToShip: shipStats.avgDays, avgDaysToShipSampleSize: shipStats.sampleSize,
      lateShipmentRate: lateShipStats.rate, lateShipmentSampleSize: lateShipStats.sampleSize,
      lateShipmentRateTarget: EBAY_LATE_SHIPMENT_RATE_TARGET,
      meetsCountTargets: transactions >= EBAY_TRS_TRANSACTIONS_TARGET && grossSales >= EBAY_TRS_GROSS_SALES_TARGET
    };
  }

  function depopTopSellerProgress(sales, disputes, todayStr) {
    const windowSales = salesInWindow(sales, 'depop', todayStr, DEPOP_TOP_SELLER_WINDOW_DAYS);
    const windowDisputes = disputesInWindow(disputes, 'depop', todayStr, DEPOP_TOP_SELLER_WINDOW_DAYS);
    const grossSales = windowSales.reduce((sum, s) => sum + (s.salePrice || 0), 0);
    const shipStats = onTimeShipRate(windowSales, DEPOP_TOP_SELLER_SHIP_WITHIN_DAYS);
    return {
      windowDays: DEPOP_TOP_SELLER_WINDOW_DAYS,
      grossSales, grossSalesTarget: DEPOP_TOP_SELLER_GROSS_SALES_TARGET,
      nonSellerResolvedRate: nonSellerResolvedRate(windowDisputes, windowSales),
      onTimeShipRate: shipStats.rate, onTimeShipSampleSize: shipStats.sampleSize,
      shipWithinDaysTarget: DEPOP_TOP_SELLER_SHIP_WITHIN_DAYS, onTimeShipRateTarget: DEPOP_TOP_SELLER_ON_TIME_SHIP_RATE_TARGET,
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

  // No live platform API exists to pull real view/watcher/like counts
  // automatically (see engagement.json's own header comment), so this is a
  // hand-logged snapshot log: date + views/saves for one listing on one
  // platform, same "manual entry, no invention" shape as comps.json. The one
  // thing worth computing over a plain log is the trend between two
  // consecutive real snapshots of the *same* listing+platform pair, since
  // "47 views" alone doesn't say whether that listing is picking up or
  // going cold, but "47 views (+12 since the last log 6 days ago)" does.
  // Sorts ascending by date first (a stable sort, so same-day entries keep
  // their logged order) and walks forward per listingId+platform key, so a
  // snapshot only ever compares against the real previous one for its own
  // listing on its own platform, never a different item or a different
  // platform's numbers.
  function sortEngagementSnapshots(snapshots) {
    return [...(snapshots || [])].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  }

  // Returns every snapshot with viewsDelta/savesDelta/previousDate added,
  // each computed against the real prior snapshot for that same
  // listingId+platform pair (null on all three for a pair's first-ever
  // logged snapshot, honestly "no trend yet" rather than a misleading flat
  // 0). A delta itself stays null whenever either side of the comparison
  // never had that field logged, the same "unknown, not zero" rule
  // daysSincePublished above already follows.
  function annotateEngagementTrend(snapshots) {
    const sorted = sortEngagementSnapshots(snapshots);
    const lastByKey = new Map();
    return sorted.map(s => {
      const key = s.listingId + '|' + s.platform;
      const prev = lastByKey.get(key) || null;
      lastByKey.set(key, s);
      return Object.assign({}, s, {
        viewsDelta: (prev && s.views != null && prev.views != null) ? s.views - prev.views : null,
        savesDelta: (prev && s.saves != null && prev.saves != null) ? s.saves - prev.saves : null,
        previousDate: prev ? prev.date : null
      });
    });
  }

  // How long a live listing's engagement can go unchecked before that's a
  // real gap, not a snapshot cadence choice: half of RELIST_FRESH_DAYS, so
  // there's always at least one real views/watchers reading partway through
  // the relist window to actually judge "gone flat" against before the
  // relist decision itself comes due.
  const ENGAGEMENT_CHECK_DUE_DAYS = 14;

  // Every live listing is live on one or more platforms, and each of those
  // platform instances is a real, separate thing to check (a listing can be
  // flat on eBay and still climbing on Depop). The engagement log only ever
  // shows rows for snapshots someone actually logged, so a listing+platform
  // pair with zero snapshots, or one gone stale past dueDays, is invisible
  // on the page today, not flagged anywhere. This is the same "real gap,
  // not a placeholder" flag buildDataQualityFlags/buildAtRiskListings
  // already give other silent gaps, just for this one. lastDate null means
  // never checked at all; daysSince null (a future-dated snapshot) is
  // treated as not due, same as daysBetweenDates' own "unknown, don't
  // guess" convention everywhere else in this file.
  function buildEngagementCheckFlags(listings, snapshots, todayStr, dueDays) {
    const latestByKey = new Map();
    sortEngagementSnapshots(snapshots).forEach(s => {
      if (!s.listingId || !s.platform || !s.date) return;
      latestByKey.set(s.listingId + '|' + s.platform, s.date);
    });
    const flags = [];
    (listings || []).filter(l => l.status === 'live').forEach(l => {
      (l.platforms || []).forEach(platform => {
        const lastDate = latestByKey.get(l.id + '|' + platform) || null;
        const daysSince = lastDate ? daysBetweenDates(lastDate, todayStr) : null;
        if (lastDate == null || (daysSince != null && daysSince >= dueDays)) {
          flags.push({ listingId: l.id, platform, lastDate, daysSince });
        }
      });
    });
    return flags;
  }

  // The on-page dispute/relist notify checks used to fire only when the due
  // count went up (currentCount > previousCount), which misses a real
  // transition: one due item resolving in the same poll window a different
  // one newly becomes due leaves the count flat (or lower), so the
  // count-only check never fires even though something genuinely new is
  // now due. Comparing the actual set of reminder ids catches that:
  // previousIds null means this is the first check ever (no real
  // transition to report yet, same as the count-only version's
  // isFirstCheck guard). Shared by both checkDisputeAlerts and
  // checkRelistAlerts, each with its own previousIds tracker.
  function hasNewDueId(currentIds, previousIds) {
    if (!previousIds) return false;
    const prev = new Set(previousIds);
    return currentIds.some(id => !prev.has(id));
  }

  return {
    PLATFORM_LABELS, DEPOP_BOOST_FEE_PCT, RELIST_FRESH_DAYS, POSHMARK_HOLD_DAYS,
    POSHMARK_WEIGHT_TIERS, EBAY_STANDARD_RATE, EBAY_CATEGORY_RATES,
    estimateNetPayout, computeSaleProfit, computeSaleMarginPct, ebayFinalValueRate,
    ebayMinPriceForNet, depopMinPriceForNet, poshmarkMinPriceForNet, minListingPriceForNet,
    MILEAGE_RATES_2026, irsMileageRateForDate, mileageRateGapReason, computeExpenseAmount,
    computeYtdNetProfit,
    addDaysToDateStr, addBusinessDays, disputeResponseDeadline, openDisputesDueForResponse,
    remainingPlatforms, daysSincePublished, daysUntil, isDueForRelist, relistGuidanceParts,
    poshmarkWeightTier, bundleNetComparison,
    computePoshmarkShareStreak,
    OFFER_TIER_ACCEPT_PCT, OFFER_TIER_COUNTER_PCT, OFFER_TIER_BORDERLINE_PCT,
    offerTier, offerCounterAmount,
    EBAY_TRS_WINDOW_DAYS, EBAY_TRS_TRANSACTIONS_TARGET, EBAY_TRS_GROSS_SALES_TARGET,
    EBAY_LATE_SHIPMENT_RATE_TARGET,
    DEPOP_TOP_SELLER_WINDOW_DAYS, DEPOP_TOP_SELLER_GROSS_SALES_TARGET,
    DEPOP_TOP_SELLER_SHIP_WITHIN_DAYS, DEPOP_TOP_SELLER_ON_TIME_SHIP_RATE_TARGET,
    daysBetweenDates, actualPostingPace, onTimeShipRate, avgDaysToShip,
    shipDeadline, isLateShipment, ebayLateShipmentRate, expectedBalanceDate,
    ebayTrsProgress, depopTopSellerProgress,
    isSupplyLowStock,
    sortEngagementSnapshots, annotateEngagementTrend,
    ENGAGEMENT_CHECK_DUE_DAYS, buildEngagementCheckFlags,
    hasNewDueId,
    daysToSell, avgDaysToSell, sellThroughRate
  };
});

#!/usr/bin/env node
/*
 * Validates listings.json, pipeline.json, activity.json, sales.json,
 * expenses.json and disputes.json against the field rules documented in
 * public/garage/index.html.
 *
 * The rule this exists to enforce: every listing has a real, known set of
 * platforms and a non-negative price, any platform marked sold in "soldOn"
 * (or linked in "listingUrls") is actually one of the listing's own
 * platforms, every logged listing URL is a real http(s) link rather than a
 * placeholder, every pipeline stage count is a real whole number, and every
 * activity log entry is labeled
 * with a type so a bug fix and a photo audit are never mixed up. It also
 * cross-checks pipeline.json's "draft"/"live"/"sold" stage counts against
 * what listings.json actually contains, since the two files are hand-edited
 * separately and can drift out of sync (the "ready-to-post" stage is left
 * alone: those items, e.g. the 48 Depop drafts, aren't itemized individually
 * in listings.json yet). It also cross-checks sales.json against every
 * listing's "soldOn" array in both directions, since a real sale should show
 * up in exactly one place: logged once as a sale, and marked once as sold on
 * that platform. Every expenses.json entry needs a real, computable dollar
 * amount: either a logged "amount", or (mileage entries only) real "miles"
 * on a real date the IRS has a published 2026 standard mileage rate for,
 * since a mileage deduction with no rate to apply it against isn't a real
 * number yet. Every disputes.json entry needs a real type and status, an
 * "open" dispute shouldn't already carry a resolvedDate and a resolved one
 * should, and a resolvedDate can't fall before its own openedDate.
 *
 * Usage: node public/garage/data/validate.js
 * Exit code 0 = clean, 1 = errors found.
 */
const fs = require('fs');
const path = require('path');
const { findDuplicateListings } = require('./validate-core.js');

const DATA_DIR = __dirname;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PLATFORMS = ['ebay', 'vinted', 'poshmark', 'depop'];
const STATUSES = ['draft', 'ready-to-post', 'live', 'sold'];
const STAGES = ['draft', 'ready-to-post', 'live', 'sold'];
const EVENT_TYPES = ['bug-fix', 'photo-audit', 'other'];
// Real published title-length hard caps as of September 2026 (see the "Title
// & photo specs" reference on the Garage page itself for sourcing). Depop
// has no published hard cap, only a soft mobile-truncation point, so it's
// deliberately left out here rather than treated as a validation error.
const TITLE_HARD_LIMITS = { ebay: 80, vinted: 70, poshmark: 80 };
const EXPENSE_CATEGORIES = ['mileage', 'supplies', 'platform-fees', 'subscriptions', 'other'];
// eBay category classifier: only "shoes" is modeled (that category's 14.9%
// final value fee vs. the 13.6% standard rate other categories get, per
// eBay's own published 2026 seller fee schedule), everything else stays null
// for the standard rate rather than trying to model every category eBay has.
const LISTING_CATEGORIES = ['shoes'];
const DISPUTE_TYPES = ['return', 'not-as-described', 'damaged', 'never-arrived', 'other'];
const DISPUTE_STATUSES = ['open', 'resolved-seller', 'resolved-buyer', 'resolved-split'];
// Real IRS-published standard business mileage rates for 2026: 72.5 cents/mi
// Jan 1 - Jun 30, then a mid-year increase to 76 cents/mi Jul 1 - Dec 31
// announced 2026-07-13 (irs.gov/newsroom: "IRS sets 2026 business standard
// mileage rate at 72.5 cents per mile" and "IRS Increases Standard Mileage
// Rate for Second Half of 2026"). Kept in sync with the same table in app.js.
const MILEAGE_RATES_2026 = [
  { from: '2026-01-01', to: '2026-06-30', rate: 0.725 },
  { from: '2026-07-01', to: '2026-12-31', rate: 0.76 }
];
function irsMileageRateForDate(dateStr) {
  if (!dateStr) return null;
  const hit = MILEAGE_RATES_2026.find(r => dateStr >= r.from && dateStr <= r.to);
  return hit ? hit.rate : null;
}

function loadJson(name) {
  const file = path.join(DATA_DIR, name);
  const raw = fs.readFileSync(file, 'utf8');
  return JSON.parse(raw);
}

function isDateOrNull(v) {
  return v === null || v === undefined || (typeof v === 'string' && DATE_RE.test(v));
}

function main() {
  const errors = [];
  const warnings = [];

  let listingsData, pipelineData, activityData, salesData, expensesData, disputesData;
  try {
    listingsData = loadJson('listings.json');
    pipelineData = loadJson('pipeline.json');
    activityData = loadJson('activity.json');
    salesData = loadJson('sales.json');
    expensesData = loadJson('expenses.json');
    disputesData = loadJson('disputes.json');
  } catch (e) {
    console.error('Failed to read/parse a data file: ' + e.message);
    process.exit(1);
  }

  const listings = listingsData.listings || [];
  const seenIds = new Set();

  listings.forEach((l, idx) => {
    const where = 'listings[' + idx + ']' + (l && l.id ? ' (' + l.id + ')' : '');

    if (!l.id) errors.push(where + ': missing "id"');
    else if (seenIds.has(l.id)) errors.push(where + ': duplicate id "' + l.id + '"');
    else seenIds.add(l.id);

    if (!l.title) errors.push(where + ': missing "title"');

    if (l.price !== null && l.price !== undefined) {
      if (typeof l.price !== 'number' || l.price < 0) {
        errors.push(where + ': "price" must be a non-negative number or null');
      }
    }

    if (l.costBasis !== null && l.costBasis !== undefined) {
      if (typeof l.costBasis !== 'number' || l.costBasis < 0) {
        errors.push(where + ': "costBasis" must be a non-negative number or null');
      }
    }

    if (l.category !== null && l.category !== undefined && !LISTING_CATEGORIES.includes(l.category)) {
      errors.push(where + ': category "' + l.category + '" is not one of ' + LISTING_CATEGORIES.join(', ') + ' (omit or use null for the standard eBay rate)');
    }

    if (!Array.isArray(l.platforms) || l.platforms.length === 0) {
      errors.push(where + ': "platforms" must be a non-empty array');
    } else {
      l.platforms.forEach(p => {
        if (!PLATFORMS.includes(p)) {
          errors.push(where + ': platform "' + p + '" is not one of ' + PLATFORMS.join(', '));
        }
      });
    }

    if (l.listingUrls !== undefined && l.listingUrls !== null) {
      if (typeof l.listingUrls !== 'object' || Array.isArray(l.listingUrls)) {
        errors.push(where + ': "listingUrls" must be an object keyed by platform, or omitted');
      } else {
        Object.keys(l.listingUrls).forEach(p => {
          const v = l.listingUrls[p];
          if (!PLATFORMS.includes(p)) {
            errors.push(where + ': listingUrls platform "' + p + '" is not one of ' + PLATFORMS.join(', '));
          } else if (Array.isArray(l.platforms) && !l.platforms.includes(p)) {
            errors.push(where + ': listingUrls platform "' + p + '" is not in this listing\'s "platforms"');
          }
          if (v !== null && v !== undefined) {
            if (typeof v !== 'string' || !/^https?:\/\//.test(v)) {
              errors.push(where + ': listingUrls.' + p + ' must be a real http(s) URL string, or null until logged');
            }
          }
        });
      }
    }

    if (l.soldOn !== undefined) {
      if (!Array.isArray(l.soldOn)) {
        errors.push(where + ': "soldOn" must be an array');
      } else {
        l.soldOn.forEach(p => {
          if (!PLATFORMS.includes(p)) {
            errors.push(where + ': soldOn platform "' + p + '" is not one of ' + PLATFORMS.join(', '));
          } else if (Array.isArray(l.platforms) && !l.platforms.includes(p)) {
            errors.push(where + ': soldOn platform "' + p + '" is not in this listing\'s "platforms"');
          }
        });
      }
    }

    if (!l.status) {
      errors.push(where + ': missing "status"');
    } else if (!STATUSES.includes(l.status)) {
      errors.push(where + ': status "' + l.status + '" is not one of ' + STATUSES.join(', '));
    }

    if (!isDateOrNull(l.datePublished)) {
      errors.push(where + ': "datePublished" is not a YYYY-MM-DD date or null: ' + JSON.stringify(l.datePublished));
    }

    if (l.location !== null && l.location !== undefined && typeof l.location !== 'string') {
      errors.push(where + ': "location" must be a string (real bin/shelf label) or null');
    }

    if (l.title && Array.isArray(l.platforms)) {
      l.platforms.forEach(p => {
        const limit = TITLE_HARD_LIMITS[p];
        if (limit && l.title.length > limit) {
          warnings.push(where + ': title is ' + l.title.length + ' chars, over ' +
            p + '\'s ' + limit + '-char cap, it will get rejected or truncated there');
        }
      });
    }
  });

  // Mirrors the "Possible duplicates" panel in app.js: the same physical item
  // can end up logged twice (a re-add after a platform sync, or copy-pasting
  // an existing listing as a starting point and forgetting to change the id),
  // and nothing else here catches it since each id is otherwise valid on its
  // own. Grouping logic shared via validate-core.js so the two can never
  // drift.
  findDuplicateListings(listings).forEach(group => {
    const ids = group.map(l => l.id || '(missing id)');
    warnings.push('possible duplicate listing: "' + group[0].title + '" at $' + group[0].price +
      ' appears on ' + ids.length + ' live listings (' + ids.join(', ') + '). Confirm these are really ' +
      'separate items, not the same one logged twice.');
  });

  const stages = pipelineData.stages || [];
  const seenStages = new Set();
  stages.forEach((s, idx) => {
    const where = 'stages[' + idx + ']' + (s && s.stage ? ' (' + s.stage + ')' : '');
    if (!s.stage) errors.push(where + ': missing "stage"');
    else if (!STAGES.includes(s.stage)) errors.push(where + ': stage "' + s.stage + '" is not one of ' + STAGES.join(', '));
    else if (seenStages.has(s.stage)) errors.push(where + ': duplicate stage "' + s.stage + '"');
    else seenStages.add(s.stage);

    if (typeof s.count !== 'number' || s.count < 0 || !Number.isInteger(s.count)) {
      errors.push(where + ': "count" must be a non-negative integer');
    }
  });

  const events = activityData.events || [];
  const seenEventIds = new Set();
  events.forEach((e, idx) => {
    const where = 'events[' + idx + ']' + (e && e.id ? ' (' + e.id + ')' : '');
    if (!e.id) errors.push(where + ': missing "id"');
    else if (seenEventIds.has(e.id)) errors.push(where + ': duplicate id "' + e.id + '"');
    else seenEventIds.add(e.id);

    if (!e.title) errors.push(where + ': missing "title"');

    if (!e.type) {
      errors.push(where + ': missing "type"');
    } else if (!EVENT_TYPES.includes(e.type)) {
      errors.push(where + ': type "' + e.type + '" is not one of ' + EVENT_TYPES.join(', '));
    }

    if (e.platform !== null && e.platform !== undefined && !PLATFORMS.includes(e.platform)) {
      warnings.push(where + ': platform "' + e.platform + '" is not one of the known platforms (' + PLATFORMS.join(', ') + ')');
    }

    if (!isDateOrNull(e.date)) {
      errors.push(where + ': "date" is not a YYYY-MM-DD date or null: ' + JSON.stringify(e.date));
    }
  });

  const sales = salesData.sales || [];
  const seenSaleIds = new Set();
  const listingById = {};
  listings.forEach(l => { if (l.id) listingById[l.id] = l; });

  sales.forEach((s, idx) => {
    const where = 'sales[' + idx + ']' + (s && s.id ? ' (' + s.id + ')' : '');

    if (!s.id) errors.push(where + ': missing "id"');
    else if (seenSaleIds.has(s.id)) errors.push(where + ': duplicate id "' + s.id + '"');
    else seenSaleIds.add(s.id);

    if (!s.title) errors.push(where + ': missing "title"');

    if (s.listingId !== null && s.listingId !== undefined && !listingById[s.listingId]) {
      warnings.push(where + ': listingId "' + s.listingId + '" does not match any listing in listings.json (fine if that listing has since fully sold through and was removed)');
    }

    if (!s.platform) {
      errors.push(where + ': missing "platform"');
    } else if (!PLATFORMS.includes(s.platform)) {
      errors.push(where + ': platform "' + s.platform + '" is not one of ' + PLATFORMS.join(', '));
    }

    if (typeof s.salePrice !== 'number' || s.salePrice < 0) {
      errors.push(where + ': "salePrice" must be a non-negative number');
    }

    if (s.askingPrice !== null && s.askingPrice !== undefined) {
      if (typeof s.askingPrice !== 'number' || s.askingPrice < 0) {
        errors.push(where + ': "askingPrice" must be a non-negative number or null');
      }
    }

    if (s.costBasis !== null && s.costBasis !== undefined) {
      if (typeof s.costBasis !== 'number' || s.costBasis < 0) {
        errors.push(where + ': "costBasis" must be a non-negative number or null');
      }
    }

    if (s.shippingCost !== null && s.shippingCost !== undefined) {
      if (typeof s.shippingCost !== 'number' || s.shippingCost < 0) {
        errors.push(where + ': "shippingCost" must be a non-negative number or null');
      }
    }

    if (!isDateOrNull(s.saleDate)) {
      errors.push(where + ': "saleDate" is not a YYYY-MM-DD date or null: ' + JSON.stringify(s.saleDate));
    }

    if (s.listingId && listingById[s.listingId] && s.platform) {
      const soldOn = listingById[s.listingId].soldOn || [];
      if (!soldOn.includes(s.platform)) {
        warnings.push(where + ': sale logged on ' + s.platform + ' but listing "' + s.listingId +
          '" does not have "' + s.platform + '" in its "soldOn" array yet');
      }
    }
  });

  const expenses = expensesData.expenses || [];
  const seenExpenseIds = new Set();

  expenses.forEach((e, idx) => {
    const where = 'expenses[' + idx + ']' + (e && e.id ? ' (' + e.id + ')' : '');

    if (!e.id) errors.push(where + ': missing "id"');
    else if (seenExpenseIds.has(e.id)) errors.push(where + ': duplicate id "' + e.id + '"');
    else seenExpenseIds.add(e.id);

    if (!e.description) errors.push(where + ': missing "description"');

    if (!e.category) {
      errors.push(where + ': missing "category"');
    } else if (!EXPENSE_CATEGORIES.includes(e.category)) {
      errors.push(where + ': category "' + e.category + '" is not one of ' + EXPENSE_CATEGORIES.join(', '));
    }

    if (!isDateOrNull(e.date)) {
      errors.push(where + ': "date" is not a YYYY-MM-DD date or null: ' + JSON.stringify(e.date));
    }

    if (e.miles !== null && e.miles !== undefined) {
      if (typeof e.miles !== 'number' || e.miles < 0) {
        errors.push(where + ': "miles" must be a non-negative number or null');
      } else if (e.category !== 'mileage') {
        warnings.push(where + ': "miles" is set but category is "' + e.category + '", not "mileage", it will be ignored');
      }
    }

    if (e.amount !== null && e.amount !== undefined) {
      if (typeof e.amount !== 'number' || e.amount < 0) {
        errors.push(where + ': "amount" must be a non-negative number or null');
      }
    }

    // A mileage entry with no logged amount needs real miles on a real date
    // the IRS has a published 2026 rate for, otherwise there's no honest
    // dollar figure to compute, same "leave null rather than guess" rule as
    // every other optional field here.
    if (e.amount == null && e.category === 'mileage') {
      if (e.miles == null) {
        warnings.push(where + ': mileage expense has no "amount" and no "miles" to compute one from');
      } else if (!e.date) {
        warnings.push(where + ': mileage expense has "miles" but no "date", can\'t look up which IRS rate applies');
      } else if (irsMileageRateForDate(e.date) == null) {
        warnings.push(where + ': mileage expense dated ' + e.date + ' has no known IRS rate (only 2026 rates are in this tool), log a manual "amount" instead');
      }
    } else if (e.amount == null && e.category && e.category !== 'mileage') {
      warnings.push(where + ': expense has no "amount" logged yet');
    }
  });

  const disputes = disputesData.disputes || [];
  const seenDisputeIds = new Set();

  disputes.forEach((d, idx) => {
    const where = 'disputes[' + idx + ']' + (d && d.id ? ' (' + d.id + ')' : '');

    if (!d.id) errors.push(where + ': missing "id"');
    else if (seenDisputeIds.has(d.id)) errors.push(where + ': duplicate id "' + d.id + '"');
    else seenDisputeIds.add(d.id);

    if (!d.title) errors.push(where + ': missing "title"');

    if (d.listingId !== null && d.listingId !== undefined && !listingById[d.listingId]) {
      warnings.push(where + ': listingId "' + d.listingId + '" does not match any listing in listings.json (fine if that listing has since fully sold through and was removed)');
    }

    if (!d.platform) {
      errors.push(where + ': missing "platform"');
    } else if (!PLATFORMS.includes(d.platform)) {
      errors.push(where + ': platform "' + d.platform + '" is not one of ' + PLATFORMS.join(', '));
    }

    if (!d.type) {
      errors.push(where + ': missing "type"');
    } else if (!DISPUTE_TYPES.includes(d.type)) {
      errors.push(where + ': type "' + d.type + '" is not one of ' + DISPUTE_TYPES.join(', '));
    }

    if (!d.status) {
      errors.push(where + ': missing "status"');
    } else if (!DISPUTE_STATUSES.includes(d.status)) {
      errors.push(where + ': status "' + d.status + '" is not one of ' + DISPUTE_STATUSES.join(', '));
    }

    if (!isDateOrNull(d.openedDate)) {
      errors.push(where + ': "openedDate" is not a YYYY-MM-DD date or null: ' + JSON.stringify(d.openedDate));
    }
    if (!isDateOrNull(d.resolvedDate)) {
      errors.push(where + ': "resolvedDate" is not a YYYY-MM-DD date or null: ' + JSON.stringify(d.resolvedDate));
    }

    if (d.status === 'open' && d.resolvedDate) {
      warnings.push(where + ': status is "open" but "resolvedDate" is already set, mark it resolved-seller/resolved-buyer/resolved-split instead');
    }
    if (d.status && d.status !== 'open' && !d.resolvedDate) {
      warnings.push(where + ': status "' + d.status + '" but "resolvedDate" is not logged yet');
    }
    if (d.openedDate && d.resolvedDate && d.resolvedDate < d.openedDate) {
      errors.push(where + ': "resolvedDate" (' + d.resolvedDate + ') is before "openedDate" (' + d.openedDate + ')');
    }

    if (d.outcome !== null && d.outcome !== undefined && typeof d.outcome !== 'string') {
      errors.push(where + ': "outcome" must be a string or null');
    }
    if (d.notes !== null && d.notes !== undefined && typeof d.notes !== 'string') {
      errors.push(where + ': "notes" must be a string or null');
    }
  });

  // Every soldOn entry should have a matching sale logged, since a platform
  // only belongs in soldOn once something has actually sold there.
  listings.forEach(l => {
    const soldOn = l.soldOn || [];
    soldOn.forEach(p => {
      const hasSale = sales.some(s => s.listingId === l.id && s.platform === p);
      if (!hasSale) {
        warnings.push('listing "' + l.id + '" has "' + p + '" in "soldOn" but no matching sale logged in sales.json');
      }
    });
  });

  // Cross-check pipeline.json's stage counts against listings.json for the
  // stages that are fully itemized there (draft, live, sold). "Live" is
  // counted as listing instances (one per platform still active, same as
  // the "Live listing instances" stat tile on the page), since that's what
  // the pipeline's "live" count has always represented.
  const stageCount = {};
  stages.forEach(s => { stageCount[s.stage] = s.count; });

  const draftListingCount = listings.filter(l => l.status === 'draft').length;
  if (stageCount['draft'] !== undefined && stageCount['draft'] !== draftListingCount) {
    warnings.push('pipeline "draft" count is ' + stageCount['draft'] + ' but listings.json has ' +
      draftListingCount + ' listing(s) with status "draft"');
  }

  const soldListingCount = listings.filter(l => l.status === 'sold').length;
  if (stageCount['sold'] !== undefined && stageCount['sold'] !== soldListingCount) {
    warnings.push('pipeline "sold" count is ' + stageCount['sold'] + ' but listings.json has ' +
      soldListingCount + ' listing(s) with status "sold"');
  }

  const liveInstanceCount = listings
    .filter(l => l.status === 'live')
    .reduce((sum, l) => {
      const soldOn = Array.isArray(l.soldOn) ? l.soldOn : [];
      const platforms = Array.isArray(l.platforms) ? l.platforms : [];
      return sum + platforms.filter(p => !soldOn.includes(p)).length;
    }, 0);
  if (stageCount['live'] !== undefined && stageCount['live'] !== liveInstanceCount) {
    warnings.push('pipeline "live" count is ' + stageCount['live'] + ' but listings.json implies ' +
      liveInstanceCount + ' live listing instance(s) (platforms minus soldOn, across status:"live" items)');
  }

  if (warnings.length) {
    console.warn(warnings.length + ' warning(s):');
    warnings.forEach(w => console.warn('  - ' + w));
  }

  if (errors.length) {
    console.error((warnings.length ? '\n' : '') + errors.length + ' error(s) in public/garage/data/:');
    errors.forEach(e => console.error('  - ' + e));
    process.exit(1);
  }

  console.log('Garage data is valid (' + listings.length + ' listing(s), ' + stages.length + ' stage(s), ' +
    events.length + ' activity event(s), ' + sales.length + ' sale(s), ' + expenses.length + ' expense(s), ' +
    disputes.length + ' dispute(s)).');
  process.exit(0);
}

main();

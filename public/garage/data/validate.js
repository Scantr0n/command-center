#!/usr/bin/env node
/*
 * Validates listings.json, pipeline.json, activity.json and sales.json
 * against the field rules documented in public/garage/index.html.
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
 * that platform.
 *
 * Usage: node public/garage/data/validate.js
 * Exit code 0 = clean, 1 = errors found.
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = __dirname;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PLATFORMS = ['ebay', 'vinted', 'poshmark', 'depop'];
const STATUSES = ['draft', 'ready-to-post', 'live', 'sold'];
const STAGES = ['draft', 'ready-to-post', 'live', 'sold'];
const EVENT_TYPES = ['bug-fix', 'photo-audit', 'other'];

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

  let listingsData, pipelineData, activityData, salesData;
  try {
    listingsData = loadJson('listings.json');
    pipelineData = loadJson('pipeline.json');
    activityData = loadJson('activity.json');
    salesData = loadJson('sales.json');
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
    events.length + ' activity event(s), ' + sales.length + ' sale(s)).');
  process.exit(0);
}

main();

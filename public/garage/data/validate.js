#!/usr/bin/env node
/*
 * Validates listings.json, pipeline.json and activity.json against the
 * field rules documented in public/garage/index.html.
 *
 * The rule this exists to enforce: every listing has a real, known set of
 * platforms and a non-negative price, any platform marked sold in "soldOn"
 * is actually one of the listing's own platforms, every pipeline stage
 * count is a real whole number, and every activity log entry is labeled
 * with a type so a bug fix and a photo audit are never mixed up. It also
 * cross-checks pipeline.json's "draft"/"live"/"sold" stage counts against
 * what listings.json actually contains, since the two files are hand-edited
 * separately and can drift out of sync (the "ready-to-post" stage is left
 * alone: those items, e.g. the 48 Depop drafts, aren't itemized individually
 * in listings.json yet).
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

  let listingsData, pipelineData, activityData;
  try {
    listingsData = loadJson('listings.json');
    pipelineData = loadJson('pipeline.json');
    activityData = loadJson('activity.json');
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

    if (!Array.isArray(l.platforms) || l.platforms.length === 0) {
      errors.push(where + ': "platforms" must be a non-empty array');
    } else {
      l.platforms.forEach(p => {
        if (!PLATFORMS.includes(p)) {
          errors.push(where + ': platform "' + p + '" is not one of ' + PLATFORMS.join(', '));
        }
      });
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

  console.log('Garage data is valid (' + listings.length + ' listing(s), ' + stages.length + ' stage(s), ' + events.length + ' activity event(s)).');
  process.exit(0);
}

main();

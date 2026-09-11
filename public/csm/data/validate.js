#!/usr/bin/env node
/*
 * Validates prospects.json against stages.json and the field rules documented
 * in public/csm/index.html. Run this after hand-editing prospects.json, since
 * the board silently drops any prospect whose "stage" does not exactly match
 * a stage id (a typo just makes a row disappear, with no error in the UI).
 *
 * Usage: node public/csm/data/validate.js
 * Exit code 0 = clean, 1 = errors found.
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = __dirname;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CHANNEL_TYPES = ['named-decision-maker', 'generic-inbox'];

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

  let stagesData, prospectsData;
  try {
    stagesData = loadJson('stages.json');
  } catch (e) {
    console.error('Failed to read/parse stages.json: ' + e.message);
    process.exit(1);
  }
  try {
    prospectsData = loadJson('prospects.json');
  } catch (e) {
    console.error('Failed to read/parse prospects.json: ' + e.message);
    process.exit(1);
  }

  const stageIds = (stagesData.stages || []).map(s => s.id);
  const prospects = prospectsData.prospects || [];
  const seenIds = new Set();

  prospects.forEach((p, idx) => {
    const where = 'prospects[' + idx + ']' + (p && p.id ? ' (' + p.id + ')' : '');

    if (!p.id) errors.push(where + ': missing "id"');
    else if (seenIds.has(p.id)) errors.push(where + ': duplicate id "' + p.id + '"');
    else seenIds.add(p.id);

    if (!p.name) errors.push(where + ': missing "name"');

    if (!p.stage) {
      errors.push(where + ': missing "stage"');
    } else if (!stageIds.includes(p.stage)) {
      errors.push(where + ': stage "' + p.stage + '" does not match any id in stages.json (' +
        stageIds.join(', ') + '). This prospect will silently vanish from the board.');
    }

    const ct = p.contactChannel && p.contactChannel.type;
    if (ct !== null && ct !== undefined && !CHANNEL_TYPES.includes(ct)) {
      errors.push(where + ': contactChannel.type "' + ct + '" is not "named-decision-maker", ' +
        '"generic-inbox", or null.');
    }
    if (p.stage && p.stage !== 'researched' && (ct === null || ct === undefined)) {
      warnings.push(where + ': stage is "' + p.stage + '" but contactChannel.type is not logged yet. ' +
        'This is the single biggest driver of real reply rate, backfill it when known.');
    }

    ['sendDate', 'nextNudgeDate'].forEach(field => {
      if (!isDateOrNull(p[field])) {
        errors.push(where + ': "' + field + '" is not a YYYY-MM-DD date or null: ' + JSON.stringify(p[field]));
      }
    });

    const ns = p.nudgeSchedule || {};
    ['doNotNudgeBefore', 'nudgePoint'].forEach(field => {
      if (!isDateOrNull(ns[field])) {
        errors.push(where + ': "nudgeSchedule.' + field + '" is not a YYYY-MM-DD date or null: ' + JSON.stringify(ns[field]));
      }
    });
    if (ns.doNotNudgeBefore && ns.nudgePoint && ns.doNotNudgeBefore > ns.nudgePoint) {
      errors.push(where + ': nudgeSchedule.doNotNudgeBefore is after nudgeSchedule.nudgePoint.');
    }

    const snap = p.socialSnapshot || {};
    if (!isDateOrNull(snap.asOfDate)) {
      errors.push(where + ': "socialSnapshot.asOfDate" is not a YYYY-MM-DD date or null: ' + JSON.stringify(snap.asOfDate));
    }
    if ((snap.followers != null || snap.engagementRate != null) && !snap.asOfDate) {
      errors.push(where + ': socialSnapshot has follower/engagement numbers but no asOfDate. ' +
        'Every social number on this board must be labeled with when it was pulled, never shown as if live.');
    }

    if (!Array.isArray(p.contentIdeas || [])) {
      errors.push(where + ': "contentIdeas" must be an array.');
    }
  });

  if (warnings.length) {
    console.warn(warnings.length + ' warning(s):');
    warnings.forEach(w => console.warn('  - ' + w));
  }

  if (errors.length) {
    console.error((warnings.length ? '\n' : '') + errors.length + ' error(s) in public/csm/data/prospects.json:');
    errors.forEach(e => console.error('  - ' + e));
    process.exit(1);
  }

  console.log('prospects.json is valid (' + prospects.length + ' prospect(s), ' + stageIds.length + ' stage(s)).');
  process.exit(0);
}

main();

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
  const stageById = Object.fromEntries((stagesData.stages || []).map(s => [s.id, s]));
  const prospects = prospectsData.prospects || [];
  const seenIds = new Set();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

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

    if (p.stage && p.stage !== 'researched' && !p.verifiedHook) {
      warnings.push(where + ': stage is "' + p.stage + '" but verifiedHook is not logged yet. ' +
        'Backfill why this person/brand is a real fit once known.');
    }

    const stageDef = p.stage && stageById[p.stage];
    if (stageDef && stageDef.staleAfterDays != null && p.stageEnteredDate && DATE_RE.test(p.stageEnteredDate)) {
      const entered = new Date(p.stageEnteredDate + 'T00:00:00');
      const daysInStage = Math.round((today - entered) / 86400000);
      if (daysInStage > stageDef.staleAfterDays) {
        warnings.push(where + ': ' + daysInStage + ' days in stage "' + p.stage + '", past the ' +
          stageDef.staleAfterDays + '-day stall threshold. Worth a real check-in or a stage update.');
      }
    }

    ['sendDate', 'nextNudgeDate', 'stageEnteredDate'].forEach(field => {
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
    if (ns.doNotNudgeBefore && p.nextNudgeDate && p.nextNudgeDate < ns.doNotNudgeBefore) {
      errors.push(where + ': nextNudgeDate (' + p.nextNudgeDate + ') is before nudgeSchedule.doNotNudgeBefore (' +
        ns.doNotNudgeBefore + '). The nudge queue would surface this prospect before it is supposed to be nudged.');
    }
    if (p.nextNudgeDate && !p.nextAction) {
      warnings.push(where + ': nextNudgeDate is set but nextAction is not logged. A due date with no concrete ' +
        'next step is a common way real deals quietly stall, backfill what actually needs to happen.');
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
    } else {
      (p.contentIdeas || []).forEach((entry, ideaIdx) => {
        const ideaWhere = where + '.contentIdeas[' + ideaIdx + ']';
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
          errors.push(ideaWhere + ': must be an object like { "date": "YYYY-MM-DD", "idea": "..." }, not ' +
            JSON.stringify(entry));
          return;
        }
        if (!entry.idea || typeof entry.idea !== 'string') {
          errors.push(ideaWhere + ': missing or non-string "idea"');
        }
        if (!isDateOrNull(entry.date) || entry.date == null) {
          errors.push(ideaWhere + ': "date" must be a YYYY-MM-DD date (when the idea was actually logged): ' +
            JSON.stringify(entry.date));
        }
      });
    }

    if (!Array.isArray(p.stageHistory || [])) {
      errors.push(where + ': "stageHistory" must be an array.');
    } else {
      const history = p.stageHistory || [];
      let prevDate = null;
      history.forEach((entry, hIdx) => {
        const hWhere = where + '.stageHistory[' + hIdx + ']';
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
          errors.push(hWhere + ': must be an object like { "date": "YYYY-MM-DD", "stage": "outreach-sent" }, not ' +
            JSON.stringify(entry));
          return;
        }
        if (!isDateOrNull(entry.date) || entry.date == null) {
          errors.push(hWhere + ': "date" must be a YYYY-MM-DD date (when this stage move actually happened): ' +
            JSON.stringify(entry.date));
        }
        if (!entry.stage || !stageIds.includes(entry.stage)) {
          errors.push(hWhere + ': "stage" ("' + entry.stage + '") does not match any id in stages.json (' +
            stageIds.join(', ') + ')');
        }
        if (entry.date && DATE_RE.test(entry.date) && prevDate && entry.date < prevDate) {
          errors.push(hWhere + ': out of order, dated ' + entry.date + ' but the previous entry is dated ' +
            prevDate + '. Keep stageHistory sorted oldest first.');
        }
        if (entry.date && DATE_RE.test(entry.date)) prevDate = entry.date;
      });
      if (history.length && p.stage && history[history.length - 1].stage !== p.stage) {
        warnings.push(where + ': last stageHistory entry is "' + history[history.length - 1].stage +
          '" but the prospect\'s current stage is "' + p.stage + '". Add the missing move or fix the mismatch.');
      }
    }
  });

  const byNormalizedCategory = {};
  prospects.forEach(p => {
    if (!p.category) return;
    const norm = p.category.trim().toLowerCase();
    (byNormalizedCategory[norm] = byNormalizedCategory[norm] || new Set()).add(p.category);
  });
  Object.values(byNormalizedCategory).forEach(variants => {
    if (variants.size > 1) {
      warnings.push('category has inconsistent casing/spacing across prospects: ' +
        Array.from(variants).map(v => JSON.stringify(v)).join(' vs. ') +
        '. These render as separate filter chips instead of one, pick one spelling.');
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

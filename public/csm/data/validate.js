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
const OUTREACH_TYPES = ['initial-send', 'nudge'];
// Matches SOCIAL_SNAPSHOT_STALE_DAYS in app.js: 90 days is a typical
// social-audit refresh cadence, past which a manual follower/engagement pull
// is old enough to be misleading if shown without a flag.
const SOCIAL_SNAPSHOT_STALE_DAYS = 90;

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
    if (ns.nudgePoint && DATE_RE.test(ns.nudgePoint) && !p.nextNudgeDate) {
      const nudgePointDate = new Date(ns.nudgePoint + 'T00:00:00');
      if (nudgePointDate <= today) {
        warnings.push(where + ': nudgeSchedule.nudgePoint (' + ns.nudgePoint + ') has passed but nextNudgeDate ' +
          'is not set. The Nudge queue only reads nextNudgeDate, so this planned nudge is not showing up ' +
          'anywhere on the board, log a real nextNudgeDate.');
      }
    }

    const snap = p.socialSnapshot || {};
    if (!isDateOrNull(snap.asOfDate)) {
      errors.push(where + ': "socialSnapshot.asOfDate" is not a YYYY-MM-DD date or null: ' + JSON.stringify(snap.asOfDate));
    }
    if ((snap.followers != null || snap.engagementRate != null) && !snap.asOfDate) {
      errors.push(where + ': socialSnapshot has follower/engagement numbers but no asOfDate. ' +
        'Every social number on this board must be labeled with when it was pulled, never shown as if live.');
    }
    if ((snap.followers != null || snap.engagementRate != null) && snap.asOfDate && DATE_RE.test(snap.asOfDate)) {
      const asOf = new Date(snap.asOfDate + 'T00:00:00');
      const daysOld = Math.round((today - asOf) / 86400000);
      if (daysOld > SOCIAL_SNAPSHOT_STALE_DAYS) {
        warnings.push(where + ': socialSnapshot is ' + daysOld + ' days old, past the ' +
          SOCIAL_SNAPSHOT_STALE_DAYS + '-day refresh threshold. Worth a real re-pull before relying on it.');
      }
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

    if (!Array.isArray(p.outreachLog || [])) {
      errors.push(where + ': "outreachLog" must be an array.');
    } else {
      (p.outreachLog || []).forEach((entry, logIdx) => {
        const logWhere = where + '.outreachLog[' + logIdx + ']';
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
          errors.push(logWhere + ': must be an object like { "date": "YYYY-MM-DD", "type": "initial-send" }, not ' +
            JSON.stringify(entry));
          return;
        }
        if (!isDateOrNull(entry.date) || entry.date == null) {
          errors.push(logWhere + ': "date" must be a YYYY-MM-DD date (when this touch actually happened): ' +
            JSON.stringify(entry.date));
        }
        if (!entry.type || !OUTREACH_TYPES.includes(entry.type)) {
          errors.push(logWhere + ': "type" ("' + entry.type + '") must be one of ' + OUTREACH_TYPES.join(', '));
        }
        if (entry.note != null && typeof entry.note !== 'string') {
          errors.push(logWhere + ': "note" must be a string or omitted, not ' + JSON.stringify(entry.note));
        }
      });
      const sendCount = (p.outreachLog || []).filter(e => e && e.type === 'initial-send').length;
      if (sendCount > 1) {
        warnings.push(where + ': outreachLog has ' + sendCount + ' "initial-send" entries, there should only ' +
          'ever be one, later touches should be logged as "nudge".');
      }
      // sendDate and outreachLog are two separate records of the same real
      // first-touch event (sendDate is what the modal/CSV show directly,
      // outreachLog is the touch-by-touch log), so they can silently drift
      // apart the same way stageHistory can drift from stage, checked below.
      const initialSendEntry = (p.outreachLog || []).find(e => e && e.type === 'initial-send');
      if (initialSendEntry && initialSendEntry.date && p.sendDate && initialSendEntry.date !== p.sendDate) {
        warnings.push(where + ': sendDate (' + p.sendDate + ') does not match the "initial-send" date logged in ' +
          'outreachLog (' + initialSendEntry.date + '). Keep them in sync, sendDate is what the modal and CSV ' +
          'export show directly.');
      }
      if (initialSendEntry && initialSendEntry.date && !p.sendDate) {
        warnings.push(where + ': outreachLog has an "initial-send" entry (' + initialSendEntry.date + ') but ' +
          'sendDate is not set. Backfill sendDate to match, it is read on its own elsewhere on the board.');
      }
      // The other direction of the same drift: sendDate says this prospect
      // was sent to, but outreachLog (what the "3+ touches, may need a new
      // approach" flag actually counts from) has no record of it at all.
      // Left unflagged, that flag would silently undercount this prospect's
      // real touches by one, or never fire for them at all.
      if (p.sendDate && !initialSendEntry) {
        warnings.push(where + ': sendDate (' + p.sendDate + ') is set but outreachLog has no "initial-send" ' +
          'entry. Backfill it, the touch-by-touch log (and the "3+ touches" flag it drives) undercounts real ' +
          'outreach without it.');
      }
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

  // Mirrors findDuplicateProspects in app.js: same person can end up logged
  // twice under different ids (e.g. a copy-pasted "Log new prospect" entry),
  // since the only uniqueness check that generator runs is on id itself.
  const byNameCompany = new Map();
  prospects.forEach(p => {
    if (!p.name) return;
    const key = p.name.trim().toLowerCase() + '|' + (p.company || '').trim().toLowerCase();
    if (!byNameCompany.has(key)) byNameCompany.set(key, []);
    byNameCompany.get(key).push(p);
  });
  byNameCompany.forEach(group => {
    if (group.length > 1) {
      warnings.push('possible duplicate prospect: ' + group.map(p => p.id).join(', ') +
        ' all share the same name and company ("' + group[0].name +
        (group[0].company ? ', ' + group[0].company : '') + '"). If this is really the same person, merge into one entry.');
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

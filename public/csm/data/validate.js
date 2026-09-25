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
const { execFileSync } = require('child_process');
const { findDuplicateProspects, findCasingDrift, findDuplicateHooks } = require('./validate-core.js');
const { emDashFields } = require('./csm-core.js');

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

// The shape regex alone accepts any two digits for month/day, including
// "2026-13-45" or a real-looking but impossible "2026-02-30" (which the
// browser-side isValidDateStr in app.js used to silently roll into March 2
// instead of flagging), so this cross-checks the parsed date's own
// year/month/day against what was actually typed: a rolled-over date never
// matches back.
function isDateOrNull(v) {
  if (v === null || v === undefined) return true;
  if (typeof v !== 'string' || !DATE_RE.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const parsed = new Date(y, m - 1, d);
  return parsed.getFullYear() === y && parsed.getMonth() === m - 1 && parsed.getDate() === d;
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
    if (ct && !(p.contactChannel && p.contactChannel.detail)) {
      warnings.push(where + ': contactChannel.type is "' + ct + '" but contactChannel.detail (the actual ' +
        'email/handle/contact) is not logged. Knowing it is a named decision-maker is not useful without the ' +
        'real way to reach them, backfill it when known.');
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
    // Same gap app.js's computeDataQualityFlags now flags on the board: the
    // nudge queue, the unqueued-nudgePoint check above, and the cold-signal
    // panel all only fire once some nudge field already exists. A prospect
    // that was actually contacted and never got any of nextNudgeDate,
    // nudgeSchedule.nudgePoint, or nudgeSchedule.doNotNudgeBefore logged is
    // otherwise invisible everywhere on the board, the real failure mode
    // this pipeline exists to catch.
    if (p.stage === 'outreach-sent' || p.stage === 'silent-replied') {
      const hasPlan = (p.nextNudgeDate && DATE_RE.test(p.nextNudgeDate)) ||
        (ns.nudgePoint && DATE_RE.test(ns.nudgePoint)) ||
        (ns.doNotNudgeBefore && DATE_RE.test(ns.doNotNudgeBefore));
      if (!hasPlan) {
        warnings.push(where + ': stage is "' + p.stage + '" but nothing is scheduled, no nextNudgeDate, ' +
          'nudgeSchedule.nudgePoint, or nudgeSchedule.doNotNudgeBefore. This prospect will not show up anywhere ' +
          'the board flags a follow-up as due, log a real plan even if it is just a rough one.');
      }
    }

    if (!Array.isArray(p.socialSnapshots || [])) {
      errors.push(where + ': "socialSnapshots" must be an array (one entry per platform), not ' +
        JSON.stringify(p.socialSnapshots));
    } else {
      const seenPlatforms = new Set();
      (p.socialSnapshots || []).forEach((snap, snapIdx) => {
        const snapWhere = where + '.socialSnapshots[' + snapIdx + ']';
        if (typeof snap !== 'object' || snap === null || Array.isArray(snap)) {
          errors.push(snapWhere + ': must be an object like { "platform": "...", "followers": 0, ' +
            '"engagementRate": 0, "asOfDate": "YYYY-MM-DD" }, not ' + JSON.stringify(snap));
          return;
        }
        if (!isDateOrNull(snap.asOfDate)) {
          errors.push(snapWhere + ': "asOfDate" is not a YYYY-MM-DD date or null: ' + JSON.stringify(snap.asOfDate));
        }
        // app.js sums these with Number(snap.followers) when building Social Reach
        // totals. A hand-typed "12,000" or "12K" is not an error there, it is a
        // silent NaN that zeroes that platform's contribution out of the total
        // with nothing on the board saying why. Catch the bad value here instead.
        if (snap.followers != null && (typeof snap.followers !== 'number' || !Number.isFinite(snap.followers) || snap.followers < 0)) {
          errors.push(snapWhere + ': "followers" must be a non-negative number or null, not ' +
            JSON.stringify(snap.followers) + '. Digits only, no commas or "k" suffix.');
        }
        if (snap.engagementRate != null && (typeof snap.engagementRate !== 'number' || !Number.isFinite(snap.engagementRate) || snap.engagementRate < 0)) {
          errors.push(snapWhere + ': "engagementRate" must be a non-negative number or null, not ' +
            JSON.stringify(snap.engagementRate) + '.');
        }
        if (typeof snap.engagementRate === 'number' && snap.engagementRate > 100) {
          warnings.push(snapWhere + ': engagementRate ' + snap.engagementRate + ' is over 100. It is logged as a ' +
            'percent (e.g. 4.2 for 4.2%), double check this was not pulled as a raw fraction or a follower count.');
        }
        if ((snap.followers != null || snap.engagementRate != null) && !snap.asOfDate) {
          errors.push(snapWhere + ': has follower/engagement numbers but no asOfDate. ' +
            'Every social number on this board must be labeled with when it was pulled, never shown as if live.');
        }
        if ((snap.followers != null || snap.engagementRate != null) && snap.asOfDate && DATE_RE.test(snap.asOfDate)) {
          const asOf = new Date(snap.asOfDate + 'T00:00:00');
          const daysOld = Math.round((today - asOf) / 86400000);
          if (daysOld > SOCIAL_SNAPSHOT_STALE_DAYS) {
            warnings.push(snapWhere + ': ' + (snap.platform || 'platform not logged') + ' snapshot is ' + daysOld +
              ' days old, past the ' + SOCIAL_SNAPSHOT_STALE_DAYS + '-day refresh threshold. Worth a real ' +
              're-pull before relying on it.');
          }
        }
        if (snap.platform) {
          const norm = snap.platform.trim().toLowerCase();
          if (seenPlatforms.has(norm)) {
            warnings.push(snapWhere + ': another socialSnapshots entry already logs "' + snap.platform + '" for ' +
              'this prospect. Add a new snapshot for a refresh instead of a second one for the same platform, or ' +
              'remove the stale one.');
          }
          seenPlatforms.add(norm);
        }
      });
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
      // Warning, not an error like stageHistory's own ordering check below:
      // app.js's hasOutOfOrderDates flags this same condition as a
      // non-blocking "needs backfill" data-quality item (often a hand-typed
      // formatting slip, e.g. a non-zero-padded "2026-9-5"), so validate.js
      // should surface it too instead of exiting 0 on something the board
      // already treats as worth a second look.
      let prevLogDate = null;
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
        if (entry.date && DATE_RE.test(entry.date) && prevLogDate && entry.date < prevLogDate) {
          warnings.push(logWhere + ': out of order, dated ' + entry.date + ' but the previous entry is dated ' +
            prevLogDate + '. Keep outreachLog sorted oldest first, check for a non-zero-padded date typo.');
        }
        if (entry.date && DATE_RE.test(entry.date)) prevLogDate = entry.date;
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

    emDashFields(p, ['name', 'company', 'verifiedHook', 'nextAction']).forEach(f =>
      warnings.push(where + ': "' + f + '" contains an em dash, this board never uses one, check for a paste-in'));
    emDashFields(p.contactChannel, ['detail']).forEach(f =>
      warnings.push(where + ': contactChannel.' + f + ' contains an em dash, this board never uses one, check for a paste-in'));
    (p.outreachLog || []).forEach((entry, logIdx) => {
      emDashFields(entry, ['note']).forEach(f =>
        warnings.push(where + '.outreachLog[' + logIdx + ']: "' + f + '" contains an em dash, this board never uses one, check for a paste-in'));
    });
    (p.contentIdeas || []).forEach((entry, ideaIdx) => {
      emDashFields(entry, ['idea']).forEach(f =>
        warnings.push(where + '.contentIdeas[' + ideaIdx + ']: "' + f + '" contains an em dash, this board never uses one, check for a paste-in'));
    });
  });

  // Grouping logic itself lives in validate-core.js, shared with app.js's own
  // "Casing drift" panel, so the two rules can never quietly drift apart.
  findCasingDrift(prospects, p => [p.category]).forEach(({ variants }) => {
    warnings.push('category has inconsistent casing/spacing across prospects: ' +
      Array.from(variants.keys()).map(v => JSON.stringify(v)).join(' vs. ') +
      '. These render as separate filter chips instead of one, pick one spelling.');
  });

  // Same drift risk as category above, but for socialSnapshots[].platform: the
  // per-prospect check earlier only catches the same platform logged twice on
  // one prospect, not the same platform spelled differently across different
  // prospects (e.g. "WeChat" vs "Wechat"), which silently fragments the
  // search filter's platform matching (matchesSearchTerm in app.js) the same
  // way an inconsistent category fragments the filter chips.
  findCasingDrift(prospects, p => (p.socialSnapshots || []).map(s => s && s.platform)).forEach(({ variants }) => {
    warnings.push('socialSnapshots platform has inconsistent casing/spacing across prospects: ' +
      Array.from(variants.keys()).map(v => JSON.stringify(v)).join(' vs. ') +
      '. Search filtering matches on this text, pick one spelling.');
  });

  // Mirrors the "Possible duplicates" panel in app.js: same person can end up
  // logged twice under different ids (e.g. a copy-pasted "Log new prospect"
  // entry), since the only uniqueness check that generator runs is on id
  // itself. Grouping logic shared via validate-core.js, same reasoning as
  // the casing-drift checks above.
  findDuplicateProspects(prospects).forEach(group => {
    warnings.push('possible duplicate prospect: ' + group.map(p => p.id).join(', ') +
      ' all share the same name and company ("' + group[0].name +
      (group[0].company ? ', ' + group[0].company : '') + '"). If this is really the same person, merge into one entry.');
  });

  // verifiedHook exists to record a real, checked, per-prospect reason
  // ("why this person/brand fits, for real"), so the exact same sentence
  // logged on two different prospects usually means one of them was never
  // actually researched on its own, not a genuine coincidence. Grouping
  // logic shared with app.js's own "Reused verified hook" panel via
  // CSMValidateCore, same reasoning as the two checks above.
  findDuplicateHooks(prospects).forEach(group => {
    warnings.push('verifiedHook is identical across ' + group.length + ' prospects (' +
      group.map(p => p.id).join(', ') + '): "' + group[0].verifiedHook.trim() + '". A hook copy-pasted across ' +
      'different prospects is not a real, per-prospect verified reason, double check each one was actually ' +
      'researched individually.');
  });

  checkChangelogFreshness(warnings);

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

// changelog.json is generated, not hand-edited (see changelog.js), so it
// can't have the typo-style errors above, only a drift failure mode: it
// silently falls behind the real commit history, or keeps entries from
// before a history rewrite that are no longer reachable from any branch
// (the exact shape found in CGT's and Sondrik's data on 2026-09-19, and in
// this section's own changelog.json before this check was added). Comparing
// the full recorded commit list against this repo's actual commit list for
// these same files, not just the latest hash, is what catches a corrupted
// middle of the list, not only a stale head; git itself is the source of
// truth here, same as changelog.js.
function checkChangelogFreshness(warnings) {
  try {
    // A shallow clone's `git log` for these files only ever sees the commits
    // fetched, which is not the same thing as "these files have no earlier
    // history": comparing that truncated list against a changelog.json
    // generated from a real full clone reports a "drift" that isn't real
    // (this bit CGT and Sondrik for real on 2026-09-19). Skipped the same as
    // "not a git checkout" below, an environment gap, not a data error.
    if (execFileSync('git', ['rev-parse', '--is-shallow-repository'], { cwd: DATA_DIR, encoding: 'utf8' }).trim() === 'true') return;
    const realHashesRaw = execFileSync('git', [
      'log', '--format=%H', '--',
      'prospects.json', 'stages.json'
    ], { cwd: DATA_DIR, encoding: 'utf8' }).trim();
    const realHashes = realHashesRaw ? realHashesRaw.split('\n') : [];
    let changelogData = null;
    try {
      changelogData = loadJson('changelog.json');
    } catch (e) {
      warnings.push('changelog.json is missing or unreadable (' + e.message + '), run node public/csm/data/changelog.js');
      return;
    }
    const recordedHashes = (changelogData.entries || []).map(e => e.fullHash);
    if (recordedHashes.join(',') !== realHashes.join(',')) {
      warnings.push('changelog.json does not match this repo\'s actual commit history for these data files ' +
        '(' + recordedHashes.length + ' entr' + (recordedHashes.length === 1 ? 'y' : 'ies') + ' recorded vs ' +
        realHashes.length + ' real commit' + (realHashes.length === 1 ? '' : 's') + '), run ' +
        'node public/csm/data/changelog.js to refresh it');
    }
  } catch (e) {
    // Not a git checkout, or git isn't on PATH: can't check changelog
    // freshness, but that's an environment gap, not a data error, so this
    // stays silent rather than adding a warning no one can act on.
  }
}

main();

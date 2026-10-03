/*
 * Pure validation-support rules for a CSM prospects array, with no Node-only
 * APIs (no fs/path), so the exact same rules run in two places: the CLI
 * validator (public/csm/data/validate.js, which reads prospects.json off disk
 * and calls this) and the dashboard's own "Possible duplicates", "Casing
 * drift", "Reused verified hook", and "Reused named contact" panels
 * (public/csm/app.js), which need
 * the real prospect objects to render clickable rows, not just a
 * pre-formatted warning string. Keeping one
 * copy of the grouping logic means the two can never quietly drift apart, the
 * same reasoning CGT's own validate-core.js already documents.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CSMValidateCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  // Groups by name + company, case/whitespace-insensitive, to catch the same
  // person logged twice under two different ids (e.g. a copy-pasted "Log new
  // prospect" entry, whose only real uniqueness check is on id itself).
  // Returns every group with more than one member; a prospect with no name
  // is skipped rather than grouped under an empty key.
  function findDuplicateProspects(prospects) {
    const byKey = new Map();
    (prospects || []).forEach(p => {
      // The typeof checks matter as much as the truthiness ones: a truthy
      // non-string name or company (either pasted in wrong) would otherwise
      // reach .trim() below and throw, and both validate.js and app.js's own
      // Data Quality badge call this function unconditionally on every run.
      if (!p.name || typeof p.name !== 'string') return;
      if (p.company !== undefined && p.company !== null && typeof p.company !== 'string') return;
      const key = p.name.trim().toLowerCase() + '|' + (p.company || '').trim().toLowerCase();
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(p);
    });
    return [...byKey.values()].filter(group => group.length > 1);
  }

  // Generic normalize-and-group-by-lowercase check: the same free-text value
  // (a category, a social platform) spelled two different ways doesn't fail
  // validation on its own, both spellings are individually valid strings, but
  // it silently fragments whatever the dashboard groups or filters on that
  // field (category filter chips, platform search matching). getValues pulls
  // whichever raw string(s) off a prospect the caller cares about, so the
  // same function covers both category (one value per prospect) and
  // socialSnapshots[].platform (zero or more per prospect). Returns every
  // normalized bucket that actually contains more than one distinct spelling.
  function findCasingDrift(prospects, getValues) {
    const byNorm = new Map();
    (prospects || []).forEach(p => {
      // A multi-valued getValues (socialSnapshots[].platform: zero or more
      // per prospect) can hand back the same prospect's own two differently-
      // cased snapshots of the same real platform (a real re-pull relogged
      // under a slightly different spelling), which used to push that one
      // prospect into entry.prospects twice, once per raw value seen, not
      // once per prospect. The dashboard's own renderCasingDrift renders one
      // row per prospects[] entry with no dedup of its own, so that one
      // person rendered as two identical rows needing the same fix, an
      // inflated drift count for a single-valued field (category) could
      // never actually trigger, since each prospect only ever contributes at
      // most one raw value there.
      const addedForThisProspect = new Set();
      getValues(p).forEach(raw => {
        // A truthy non-string raw value (category or platform typed as
        // something other than a string) would otherwise reach .trim()
        // below and throw; this runs unconditionally from both validate.js
        // and app.js's Data Quality badge.
        if (!raw || typeof raw !== 'string') return;
        const norm = raw.trim().toLowerCase();
        if (!byNorm.has(norm)) byNorm.set(norm, { variants: new Map(), prospects: [] });
        const entry = byNorm.get(norm);
        entry.variants.set(raw, (entry.variants.get(raw) || 0) + 1);
        if (!addedForThisProspect.has(norm)) {
          addedForThisProspect.add(norm);
          entry.prospects.push(p);
        }
      });
    });
    return [...byNorm.values()].filter(entry => entry.variants.size > 1);
  }

  // Groups by verifiedHook text, case/whitespace-insensitive, to catch a hook
  // copy-pasted across more than one prospect. verifiedHook exists to record
  // the real, checked reason a specific person/brand fits (see index.html's
  // schema help), so the exact same sentence logged on two different
  // prospects is a sign one of them was never actually researched on its own
  // terms, not a real coincidence. Returns every group of two or more
  // prospects sharing the same normalized hook text; a prospect with no
  // verifiedHook is skipped rather than grouped under an empty key.
  function findDuplicateHooks(prospects) {
    const byNorm = new Map();
    (prospects || []).forEach(p => {
      if (!p.verifiedHook || typeof p.verifiedHook !== 'string') return;
      const norm = p.verifiedHook.trim().toLowerCase().replace(/\s+/g, ' ');
      if (!norm) return;
      if (!byNorm.has(norm)) byNorm.set(norm, []);
      byNorm.get(norm).push(p);
    });
    return [...byNorm.values()].filter(group => group.length > 1);
  }

  // Groups by contactChannel.detail, case/whitespace-insensitive, scoped to
  // contactChannel.type === 'named-decision-maker' only: the same generic
  // agency inbox legitimately fields outreach for many unrelated brands (not
  // a bug), but a named decision-maker is a specific real person, so the
  // exact same email/handle logged as the named contact for two different
  // companies is almost always a copy-paste left over from a previous
  // prospect, not a real coincidence. Returns every group of two or more
  // prospects sharing the same normalized detail; a prospect with no detail,
  // or a generic-inbox/unlogged channel, is skipped rather than grouped under
  // an empty key.
  function findReusedContactDetail(prospects) {
    const byNorm = new Map();
    (prospects || []).forEach(p => {
      const cc = p.contactChannel;
      if (!cc || cc.type !== 'named-decision-maker' || !cc.detail || typeof cc.detail !== 'string') return;
      const norm = cc.detail.trim().toLowerCase();
      if (!norm) return;
      if (!byNorm.has(norm)) byNorm.set(norm, []);
      byNorm.get(norm).push(p);
    });
    return [...byNorm.values()].filter(group => group.length > 1);
  }

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const CHANNEL_TYPES = ['named-decision-maker', 'generic-inbox'];
  const OUTREACH_TYPES = ['initial-send', 'nudge', 'reply'];
  // Matches SOCIAL_SNAPSHOT_STALE_DAYS in app.js and validate.js: 90 days is
  // a typical social-audit refresh cadence, past which a manual follower/
  // engagement pull is old enough to be misleading if shown without a flag.
  const SOCIAL_SNAPSHOT_STALE_DAYS = 90;

  // The shape regex alone accepts any two digits for month/day, including
  // "2026-13-45" or a real-looking but impossible "2026-02-30" (which the
  // browser-side isValidDateStr in csm-core.js used to silently roll into
  // March 2 instead of flagging), so this cross-checks the parsed date's own
  // year/month/day against what was actually typed: a rolled-over date
  // never matches back. Unlike csm-core.js's isValidDateStr, null/undefined
  // is accepted here (most date fields on this schema are optional).
  function isDateOrNull(v) {
    if (v === null || v === undefined) return true;
    if (typeof v !== 'string' || !DATE_RE.test(v)) return false;
    const [y, m, d] = v.split('-').map(Number);
    const parsed = new Date(y, m - 1, d);
    return parsed.getFullYear() === y && parsed.getMonth() === m - 1 && parsed.getDate() === d;
  }

  // The real structural/field-rule checks run against a prospects array and
  // its matching stages array, with no fs/path/process access, so the exact
  // same rules run in two places: the CLI validator (validate.js, which
  // reads prospects.json/stages.json off disk and calls this) and the new-
  // prospect CSV importer (import.js), which needs to catch the same real
  // mistakes (a stage id typo that makes a row silently vanish from the
  // board, a missing verifiedHook, an out-of-order nudgeSchedule) before
  // handing back a prospects.json to save over the real file, not after.
  // `helpers` is optional ({ emDashFields, hasLegacySocialSnapshotField }
  // from csm-core.js): those two checks live in csm-core.js, not here, since
  // this file stays dependency-free the same way every other hub's
  // validate-core.js does, so a caller that cares about them (both real
  // callers do) passes them in rather than this file reaching across to
  // require csm-core.js itself.
  function validateProspects(prospects, stages, helpers) {
    const errors = [];
    const warnings = [];
    const emDashFields = helpers && helpers.emDashFields;
    const hasLegacySocialSnapshotField = helpers && helpers.hasLegacySocialSnapshotField;

    const stageIds = (stages || []).map(s => s.id);
    const stageById = Object.fromEntries((stages || []).map(s => [s.id, s]));
    const seenIds = new Set();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    (prospects || []).forEach((p, idx) => {
      const where = 'prospects[' + idx + ']' + (p && p.id ? ' (' + p.id + ')' : '');

      if (!p.id) errors.push(where + ': missing "id"');
      else if (seenIds.has(p.id)) errors.push(where + ': duplicate id "' + p.id + '"');
      else seenIds.add(p.id);

      if (!p.name) errors.push(where + ': missing "name"');
      else if (typeof p.name !== 'string') errors.push(where + ': "name" must be a string, got ' + typeof p.name);

      // None of these free-text fields ever had a type check, only the
      // em-dash scan below (which already guards its own typeof). app.js's
      // matchesSearchTerm reads every one of them as `(p.field || '').toLowerCase()`,
      // and findDuplicateProspects/findCasingDrift above call .trim() on name/
      // company/category directly, so a truthy non-string here throws inside
      // the search box or the Data Quality badge, not just a cosmetic miss.
      ['company', 'category', 'replyStatus', 'notes', 'verifiedHook', 'nextAction'].forEach(f => {
        if (p[f] !== undefined && p[f] !== null && typeof p[f] !== 'string') {
          errors.push(where + ': "' + f + '" must be a string or null, got ' + typeof p[f]);
        }
      });

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

      if (p.stage === 'in-exploration' && !p.nextAction) {
        warnings.push(where + ': stage is "in-exploration" but nextAction is not logged yet. ' +
          'An open deal in active exploration still needs a concrete next step written down, not just a stage.');
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
      // Same gap app.js's computeDataQualityFlags flags on the board: the
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

      // schemaVersion 1's single "socialSnapshot" object was replaced by the
      // plural "socialSnapshots" array in schemaVersion 2 (see prospects.json's
      // own top-of-file note). Nothing in app.js reads the singular key
      // anymore, so a leftover or hand-typed one is real research that never
      // renders anywhere, an error rather than a warning since it is silently
      // lost data, not just a style nit.
      if (hasLegacySocialSnapshotField && hasLegacySocialSnapshotField(p)) {
        errors.push(where + ': has a legacy "socialSnapshot" (singular) field, this schema uses ' +
          '"socialSnapshots" (plural array); move its contents there, this field is never read');
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
              '"engagementRate": 0, "asOfDate": "YYYY-MM-DD", "profileUrl": null }, not ' + JSON.stringify(snap));
            return;
          }
          if (!isDateOrNull(snap.asOfDate)) {
            errors.push(snapWhere + ': "asOfDate" is not a YYYY-MM-DD date or null: ' + JSON.stringify(snap.asOfDate));
          }
          // Same real gap listingUrl closed for CGT: a followers/engagementRate
          // count with no link back to the actual profile means re-checking it
          // later means redoing the whole search from scratch. Optional since
          // most real research so far predates this field, but once present it
          // has to actually be a usable string, not a blank one masquerading
          // as "logged".
          if (snap.profileUrl !== null && snap.profileUrl !== undefined) {
            if (typeof snap.profileUrl !== 'string') {
              errors.push(snapWhere + ': "profileUrl" must be a string or null, got ' + JSON.stringify(snap.profileUrl));
            } else if (!snap.profileUrl.trim()) {
              errors.push(snapWhere + ': "profileUrl" is an empty string, use null instead of a blank string');
            }
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
        // "reply" is the only outreachLog type that logs an inbound touch
        // rather than an outbound one, so it is the only type that can be out
        // of order relative to the rest of the log without tripping the
        // generic prevLogDate check above (a reply dated the same day as, or
        // just after, its outbound touch is normal). A reply with no outbound
        // touch at all, or dated before the earliest one, is the real problem:
        // daysToFirstReply in csm-core.js returns null for both rather than a
        // fabricated or negative response time, so it is worth flagging here
        // too instead of just silently going blank on the board.
        const outboundDates = (p.outreachLog || [])
          .filter(e => e && e.date && DATE_RE.test(e.date) && (e.type === 'initial-send' || e.type === 'nudge'))
          .map(e => e.date);
        const firstOutboundDate = outboundDates.length ? outboundDates.reduce((min, d) => (d < min ? d : min)) : null;
        (p.outreachLog || []).forEach((entry, logIdx) => {
          if (!entry || entry.type !== 'reply' || !entry.date || !DATE_RE.test(entry.date)) return;
          const logWhere = where + '.outreachLog[' + logIdx + ']';
          if (!firstOutboundDate) {
            warnings.push(logWhere + ': a "reply" touch is logged but outreachLog has no outbound ' +
              '("initial-send"/"nudge") touch at all. Backfill the outbound touch it was replying to.');
          } else if (entry.date < firstOutboundDate) {
            warnings.push(logWhere + ': a "reply" touch is dated ' + entry.date + ', before the earliest outbound ' +
              'touch (' + firstOutboundDate + '). A reply cannot come before the outreach that prompted it, check ' +
              'the date.');
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

      if (emDashFields) {
        emDashFields(p, ['name', 'company', 'category', 'verifiedHook', 'nextAction', 'replyStatus', 'notes']).forEach(f =>
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
      }
    });

    // Grouping logic itself lives in this same file, shared with app.js's own
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
    // itself.
    findDuplicateProspects(prospects).forEach(group => {
      warnings.push('possible duplicate prospect: ' + group.map(p => p.id).join(', ') +
        ' all share the same name and company ("' + group[0].name +
        (group[0].company ? ', ' + group[0].company : '') + '"). If this is really the same person, merge into one entry.');
    });

    // verifiedHook exists to record a real, checked, per-prospect reason
    // ("why this person/brand fits, for real"), so the exact same sentence
    // logged on two different prospects usually means one of them was never
    // actually researched on its own, not a genuine coincidence.
    findDuplicateHooks(prospects).forEach(group => {
      warnings.push('verifiedHook is identical across ' + group.length + ' prospects (' +
        group.map(p => p.id).join(', ') + '): "' + group[0].verifiedHook.trim() + '". A hook copy-pasted across ' +
        'different prospects is not a real, per-prospect verified reason, double check each one was actually ' +
        'researched individually.');
    });

    // A generic agency inbox legitimately fields outreach for many unrelated
    // brands, so this is scoped to contactChannel.type === 'named-decision-maker'
    // only: the same named person's contact being logged as the decision-maker
    // detail for two different companies is almost always a copy-paste left
    // over from a previous prospect, not a real coincidence.
    findReusedContactDetail(prospects).forEach(group => {
      warnings.push('contactChannel.detail is identical across ' + group.length + ' named-decision-maker prospects (' +
        group.map(p => p.id).join(', ') + '): "' + group[0].contactChannel.detail.trim() + '". The same named ' +
        'decision-maker logged for different companies is usually a copy-paste left over from a previous prospect, ' +
        'double check each one is a real, distinct contact.');
    });

    return { errors, warnings };
  }

  return {
    findDuplicateProspects, findCasingDrift, findDuplicateHooks, findReusedContactDetail,
    isDateOrNull, validateProspects
  };
});

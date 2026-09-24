/*
 * Pure date/urgency/export-formatting math shared between the dashboard
 * itself (public/csm/app.js) and this file's own regression test suite
 * (csm-core.test.js). No DOM, no Node-only APIs, same shared-core pattern as
 * CSMValidateCore in this same directory and GarageCore/goals-core.js in the
 * other hubs, so the math that decides whether a real nudge is overdue, a
 * stage is stalled, or a social snapshot is too old to trust actually has
 * regression coverage instead of only ever running live in a browser. This
 * is exactly the kind of nudge-schedule math the CSM pipeline exists to get
 * right (a wrong "days until due" silently misses or double-nudges a real
 * contact), so it deserves the same test coverage the other hubs already
 * give their own date math. Also covers the CSV/ICS export string helpers
 * (csvField's formula-injection guard, icsFoldLine's UTF-8 byte counting),
 * since a silent regression there produces a corrupted or unsafe exported
 * file with no error anywhere.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CSMCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  // Same shape check data/validate.js already runs before this data reaches
  // the browser, kept here too since a hand-edit that skipped validate.js
  // (a non-zero-padded "2026-9-5", for example) reaches daysUntil() as a
  // string that parses to Invalid Date/NaN with no error, not a thrown one.
  //
  // The shape regex plus a bare NaN check isn't enough on its own: JS's Date
  // constructor doesn't reject an impossible calendar day, it silently rolls
  // it into the next one ("2026-02-30" parses as March 2, 2026, with no
  // error), so a fat-fingered "Feb 30" or "Sept 31" used to sail through as
  // a fully valid date and quietly shift every days-until/days-since label
  // built from it. Cross-checking the parsed date's own year/month/day
  // against what was actually typed catches that: a rolled-over date never
  // matches back.
  function isValidDateStr(iso) {
    if (typeof iso !== 'string' || !DATE_RE.test(iso)) return false;
    const [y, m, d] = iso.split('-').map(Number);
    const parsed = new Date(y, m - 1, d);
    return parsed.getFullYear() === y && parsed.getMonth() === m - 1 && parsed.getDate() === d;
  }

  function daysUntil(iso) {
    const target = new Date(iso + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((target - today) / 86400000);
  }

  function daysSince(iso) {
    return -daysUntil(iso);
  }

  // True when hand-typed dates in a log don't actually increase in the order
  // sorting them as strings produces. Catches two real hand-edit slips: a
  // genuine out-of-order date, and a non-zero-padded date like "2026-9-5"
  // (sorts after "2026-10-01" lexically despite coming first chronologically,
  // and fails to parse at all via daysUntil, which shows up here as NaN).
  function hasOutOfOrderDates(entries) {
    const dated = (entries || []).filter(e => e && e.date).slice().sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 0; i < dated.length - 1; i++) {
      const diff = daysUntil(dated[i + 1].date) - daysUntil(dated[i].date);
      if (!(diff >= 0)) return true;
    }
    return false;
  }

  function stallInfo(p, stageById) {
    const stageDef = stageById[p.stage];
    // isValidDateStr, not just a truthy check: an invalid stageEnteredDate
    // (a non-zero-padded "2026-9-5", say) makes daysSince return NaN, and
    // "NaN > staleAfterDays" is always false, so a genuinely stalled
    // prospect would silently never get flagged instead of erroring loudly.
    if (!stageDef || stageDef.staleAfterDays == null || !isValidDateStr(p.stageEnteredDate)) return null;
    const days = daysSince(p.stageEnteredDate);
    return { days, staleAfterDays: stageDef.staleAfterDays, isStale: days > stageDef.staleAfterDays };
  }

  // Follower/engagement numbers are a one-time manual pull, never live, so
  // the "as of" date is the only thing keeping them honest. 90 days (a
  // typical social-audit refresh cadence) is the point past which those
  // numbers are old enough that showing them without a loud flag would be
  // misleading, not just informative. A prospect can have one snapshot per
  // real platform (Douyin, Xiaohongshu, Weibo...), so this checks every
  // entry, not just one.
  const SOCIAL_SNAPSHOT_STALE_DAYS = 90;
  function socialSnapshotStaleInfo(snap) {
    if (!snap || (snap.followers == null && snap.engagementRate == null)) return null;
    if (!snap.asOfDate) return null;
    const days = daysSince(snap.asOfDate);
    if (days <= SOCIAL_SNAPSHOT_STALE_DAYS) return null;
    return { days };
  }

  // Worst (oldest) stale snapshot across every platform logged for this
  // prospect, used by the "Needs backfill" flag, which only has room to
  // surface one line per prospect.
  function socialSnapshotsStaleInfo(p) {
    const snaps = p.socialSnapshots || [];
    let worst = null;
    snaps.forEach(snap => {
      const info = socialSnapshotStaleInfo(snap);
      if (info && (!worst || info.days > worst.days)) worst = Object.assign({ platform: snap.platform }, info);
    });
    return worst;
  }

  function nudgeUrgencyLevel(days, unqueued, badDate) {
    if (badDate || unqueued || days < 0) return 'overdue';
    if (days === 0) return 'today';
    if (days <= 2) return 'soon';
    return 'later';
  }

  function computeNudgeRows(prospects) {
    const withDates = prospects
      .filter(p => p.nextNudgeDate && isValidDateStr(p.nextNudgeDate))
      .map(p => ({ p, days: daysUntil(p.nextNudgeDate), unqueued: false, badDate: false }));

    // A nextNudgeDate that fails the same format check validate.js runs
    // (typically a non-zero-padded hand-edit like "2026-9-5") still needs
    // a real row here, not silence: it stays "on the queue" per the data,
    // it just can't be given a real due date, so say so instead of letting
    // it fall through to daysUntil's NaN and print "in NaNd".
    const badDates = prospects
      .filter(p => p.nextNudgeDate && !isValidDateStr(p.nextNudgeDate))
      .map(p => ({ p, days: Infinity, unqueued: false, badDate: true }));

    const unqueued = prospects
      .filter(p => {
        const point = p.nudgeSchedule && p.nudgeSchedule.nudgePoint;
        return point && !p.nextNudgeDate && isValidDateStr(point) && daysUntil(point) <= 0;
      })
      .map(p => ({ p, days: daysUntil(p.nudgeSchedule.nudgePoint), unqueued: true, badDate: false }));

    return withDates.concat(unqueued).concat(badDates).sort((a, b) => a.days - b.days);
  }

  function todayIso() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function addDaysIso(iso, days) {
    const d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // Cold-outreach cadence convention (widening gaps between follow-ups,
  // tightest right after the previous touch): the 2nd touch (first
  // follow-up) is suggested soonest, then the gap widens. Once the
  // suggestion reaches the point computeColdSignal in app.js flags the
  // prospect anyway, the gap stays flat from there instead of growing
  // further, a wider gap would just delay that flag from being acted on.
  function suggestedNudgeOffsetDays(nextTouchNumber) {
    if (nextTouchNumber <= 2) return 3;
    if (nextTouchNumber === 3) return 5;
    return 7;
  }

  // Real B2B cold-outreach cadence practice spaces follow-ups in business
  // days, not calendar days, since a nudge that lands on a Saturday or
  // Sunday sits at the bottom of a Monday-morning inbox and reads as
  // low-effort. A plain +N-days offset from a Thursday or Friday touch
  // lands squarely on a weekend, so the suggestion below rolls forward to
  // the next Monday instead of proposing a weekend send.
  function rollToWeekdayIso(iso) {
    const d = new Date(iso + 'T00:00:00');
    const day = d.getDay();
    if (day === 6) d.setDate(d.getDate() + 2);
    else if (day === 0) d.setDate(d.getDate() + 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // China runs a single national timezone, China Standard Time, UTC+8
  // year-round with no daylight saving, so this offset never needs a real
  // timezone database, unlike almost any other cross-border time
  // conversion. Cold-outreach research is consistent that the recipient's
  // own local business hours matter for reply rate (and specifically
  // weekday mornings), same category of timing signal rollToWeekdayIso
  // above already applies to the day, this covers the hour. Takes a real
  // JS Date (defaults to "now") so it stays testable against a fixed
  // instant instead of only ever running live.
  const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  function beijingTimeInfo(nowUtc) {
    const now = nowUtc instanceof Date ? nowUtc : new Date();
    const shifted = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const hour = shifted.getUTCHours();
    const minute = shifted.getUTCMinutes();
    const dayOfWeek = shifted.getUTCDay();
    const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
    const isBusinessHours = isWeekday && hour >= 9 && hour < 18;
    // Tue-Thu, roughly 8-11am recipient-local: the mid-week-morning window
    // general cold-outreach benchmarks report as the strongest for replies.
    const isPrimeReplyWindow = dayOfWeek >= 2 && dayOfWeek <= 4 && hour >= 8 && hour < 11;
    return {
      hour, minute, dayOfWeek, weekdayName: WEEKDAY_NAMES[dayOfWeek],
      isWeekday, isBusinessHours, isPrimeReplyWindow
    };
  }

  // How many real touches have actually gone out, not just when the last
  // one landed. Cold outreach research is consistent that a real reply
  // typically takes several touches, not one attempt, so this is the count
  // computeColdSignal in app.js compares against its threshold, and what a
  // board scanned at a glance shows as effort-so-far. isValidDateStr, not
  // just a truthy entry, since a malformed hand-typed date should not count
  // as a real logged touch.
  function touchCount(p) {
    return (p.outreachLog || []).filter(e => e && isValidDateStr(e.date)).length;
  }

  // Days since the most recent real outreach touch (initial send or nudge),
  // separate from stallInfo's "days in stage": a prospect can sit in the
  // same stage for a while yet have been touched recently (fresh), or be
  // fresh into a stage yet have gone quiet on actual contact (neglected).
  // isValidDateStr, not just a truthy date: an invalid entry (bad
  // hand-typed format) would otherwise make daysSince return NaN, and every
  // caller checks `!= null`, which NaN passes, so a card or list would
  // render a literal "NaND SINCE LAST TOUCH" badge instead of just skipping
  // the malformed entry.
  function daysSinceLastTouch(p) {
    const log = (p.outreachLog || []).filter(e => e && isValidDateStr(e.date));
    if (log.length === 0) return null;
    const lastDate = log.reduce((max, e) => (e.date > max ? e.date : max), log[0].date);
    return daysSince(lastDate);
  }

  // Board column sort order: soonest real nextNudgeDate first, prospects
  // with no date logged pushed to the end, tied on name so the order is
  // deterministic either way. A prior version of this comparator returned 1
  // (never 0) whenever both dates were equal, which violates a real sort
  // comparator's own contract (compare(a,b) and compare(b,a) can't both be
  // positive) and left same-date rows in effectively arbitrary order.
  function byUrgency(a, b) {
    if (a.nextNudgeDate && b.nextNudgeDate && a.nextNudgeDate !== b.nextNudgeDate) {
      return a.nextNudgeDate < b.nextNudgeDate ? -1 : 1;
    }
    if (a.nextNudgeDate && !b.nextNudgeDate) return -1;
    if (b.nextNudgeDate && !a.nextNudgeDate) return 1;
    return (a.name || '').localeCompare(b.name || '');
  }

  // Shared "did this prospect ever reach real active exploration" check
  // behind both channel-effectiveness and category-effectiveness in app.js:
  // true either right now (stage is in-exploration/client) or at some point
  // in the past (a stageHistory entry recorded reaching one of those two
  // stages, even if the prospect has since moved, e.g. back to
  // silent-replied). Was two separately hand-written copies of this exact
  // condition; a future edit to one without the other would have silently
  // made the two effectiveness breakdowns disagree on the same prospect.
  function reachedActiveExploration(p) {
    return p.stage === 'in-exploration' || p.stage === 'client' ||
      (p.stageHistory || []).some(e => e && (e.stage === 'in-exploration' || e.stage === 'client'));
  }

  // Average real days spent in each stage, from completed moves only (a
  // stageHistory entry into a stage followed by a later one out of it), not
  // from prospects still sitting in a stage right now (that's stallInfo's
  // job). Entries are sorted by date before pairing consecutive ones, since
  // stageHistory is appended in edit order, not necessarily chronological
  // order for a hand-edited record. A pair whose dwell computes negative
  // (an out-of-order or duplicate-dated entry) is skipped rather than
  // pulling the stage's average toward a fabricated negative duration.
  function computeStageVelocity(stages, prospects) {
    const sums = {};
    const counts = {};
    stages.forEach(s => { sums[s.id] = 0; counts[s.id] = 0; });
    prospects.forEach(p => {
      const history = (p.stageHistory || [])
        .filter(e => e && e.date && e.stage && isValidDateStr(e.date))
        .slice()
        .sort((a, b) => a.date.localeCompare(b.date));
      for (let i = 0; i < history.length - 1; i++) {
        const cur = history[i];
        const next = history[i + 1];
        if (!(cur.stage in sums)) continue;
        const dwellDays = daysUntil(next.date) - daysUntil(cur.date);
        if (dwellDays < 0) continue;
        sums[cur.stage] += dwellDays;
        counts[cur.stage] += 1;
      }
    });
    return stages.map(s => ({
      stage: s,
      n: counts[s.id],
      avgDays: counts[s.id] > 0 ? Math.round(sums[s.id] / counts[s.id]) : null
    }));
  }

  // Real signal from cold-outreach practice, not something invented for this
  // board: a contact who has received several real touches (initial send +
  // nudges, from the same outreachLog touchCount above reads) while still
  // sitting in outreach-sent (no reply, no stage move) is a sign the hook or
  // channel isn't landing, not just that another identical nudge is due.
  // Distinct from stallInfo (which only looks at time sitting in a stage
  // regardless of how many touches happened) and from "needs backfill"
  // (missing fields): this looks at real touch count vs. real stage movement.
  const COLD_TOUCH_THRESHOLD = 3;

  // Flagging a cold prospect forever with no way to act on it is its own bad
  // pattern: cold-outreach convention is to stop repeating the identical
  // nudge after a few unanswered touches and deliberately park a real
  // re-attempt months out, not nag on the same cadence or drop the lead.
  // nudgeSchedule.doNotNudgeBefore already exists for exactly this, editable
  // from a prospect's own edit form, so a future date there is read as
  // "already decided, come back later" and split into its own list instead
  // of sitting in the urgent one forever.
  function computeColdSignal(prospects) {
    const today = todayIso();
    const flagged = prospects
      .filter(p => p.stage === 'outreach-sent')
      .map(p => ({ p, touches: touchCount(p) }))
      .filter(x => x.touches >= COLD_TOUCH_THRESHOLD);

    const active = [];
    const parked = [];
    flagged.forEach(x => {
      const notBefore = x.p.nudgeSchedule && x.p.nudgeSchedule.doNotNudgeBefore;
      if (notBefore && isValidDateStr(notBefore) && notBefore > today) parked.push(x);
      else active.push(x);
    });

    active.sort((a, b) => b.touches - a.touches);
    parked.sort((a, b) => a.p.nudgeSchedule.doNotNudgeBefore.localeCompare(b.p.nudgeSchedule.doNotNudgeBefore));
    return { active, parked };
  }

  // How many prospects have reached at least each stage, and the real
  // conversion rate stepping into it from the stage before, from current
  // stage alone: since the pipeline is a straight line (researched ->
  // outreach-sent -> silent-replied -> in-exploration -> client), a prospect
  // sitting at stage index i has necessarily already passed every stage
  // before it, whether or not that move was ever logged in stageHistory.
  // Unlike computeStageVelocity, this works from data every prospect already
  // has (the required "stage" field), not only from optional history logs.
  function computeFunnel(stages, prospects) {
    const indexOfStage = Object.fromEntries(stages.map((s, i) => [s.id, i]));
    const reached = stages.map(() => 0);
    prospects.forEach(p => {
      const idx = indexOfStage[p.stage];
      if (idx == null) return;
      for (let i = 0; i <= idx; i++) reached[i]++;
    });
    return stages.map((stage, i) => ({
      stage,
      reached: reached[i],
      conversionFromPrev: i > 0 && reached[i - 1] > 0 ? Math.round((reached[i] / reached[i - 1]) * 100) : null
    }));
  }

  // Aggregates real socialSnapshots across every prospect into per-platform
  // reach totals. Only the most recent asOfDate entry per prospect per
  // platform counts, so logging a refresh snapshot never double-counts that
  // same account's followers under the same platform. This is a rollup of
  // one-time manual research pulls, never a live number, same honesty rule
  // socialSnapshotStaleInfo already enforces per snapshot in the modal.
  function computeSocialReach(prospects) {
    const byPlatform = {};
    const order = [];
    function bucketFor(platform) {
      if (!byPlatform[platform]) {
        byPlatform[platform] = {
          platform, prospectCount: 0, totalFollowers: 0, hasFollowers: false,
          engagementSum: 0, engagementCount: 0, mostRecentAsOf: null, staleCount: 0
        };
        order.push(platform);
      }
      return byPlatform[platform];
    }
    prospects.forEach(p => {
      const latestByPlatform = {};
      (p.socialSnapshots || []).forEach(snap => {
        if (!snap || !snap.platform) return;
        const existing = latestByPlatform[snap.platform];
        if (!existing || (snap.asOfDate || '') > (existing.asOfDate || '')) {
          latestByPlatform[snap.platform] = snap;
        }
      });
      Object.values(latestByPlatform).forEach(snap => {
        const bucket = bucketFor(snap.platform);
        bucket.prospectCount += 1;
        // validate.js already rejects a non-numeric followers/engagementRate
        // as a hard error, but that only runs from the CLI, not against
        // whatever socialSnapshots data is actually live on disk right now.
        // Without the Number.isFinite guard, one bad hand-edited value (a
        // "12K" string, a typo) turned Number(snap.followers) into NaN,
        // which then poisoned this whole platform's totalFollowers/
        // engagementSum for every other prospect on that platform too, not
        // just the bad entry, showing "NaN followers" for the whole bucket.
        const followers = Number(snap.followers);
        if (snap.followers != null && Number.isFinite(followers)) {
          bucket.totalFollowers += followers;
          bucket.hasFollowers = true;
        }
        const engagementRate = Number(snap.engagementRate);
        if (snap.engagementRate != null && Number.isFinite(engagementRate)) {
          bucket.engagementSum += engagementRate;
          bucket.engagementCount += 1;
        }
        if (snap.asOfDate && (!bucket.mostRecentAsOf || snap.asOfDate > bucket.mostRecentAsOf)) {
          bucket.mostRecentAsOf = snap.asOfDate;
        }
        if (socialSnapshotStaleInfo(snap)) bucket.staleCount += 1;
      });
    });
    return order.map(key => byPlatform[key])
      .sort((a, b) => b.totalFollowers - a.totalFollowers || b.prospectCount - a.prospectCount ||
        a.platform.localeCompare(b.platform));
  }

  // Counts, not rates, per contactChannel.type: how many prospects who have
  // actually been contacted (stage past "researched") went on to reach real
  // active exploration. "silent-replied" is deliberately excluded from the
  // positive count, that stage covers both no-response and an unadvanced
  // reply, so it cannot honestly be read as a signal either way. The minimum
  // sample size a caller should gate a rate on before showing one (so a
  // 1-of-1 record never renders as a misleading "100%") lives alongside this
  // as CHANNEL_EFF_MIN_N_FOR_RATE, used by both effectiveness breakdowns.
  const CHANNEL_EFF_MIN_N_FOR_RATE = 5;
  function computeChannelEffectiveness(prospects) {
    const order = ['named-decision-maker', 'generic-inbox', 'unlogged'];
    const labels = {
      'named-decision-maker': 'Named decision-maker',
      'generic-inbox': 'Generic inbox',
      'unlogged': 'Channel not logged'
    };
    const buckets = {};
    order.forEach(key => { buckets[key] = { key, label: labels[key], contacted: 0, advanced: 0 }; });
    prospects.forEach(p => {
      if (p.stage === 'researched') return;
      const rawType = p.contactChannel && p.contactChannel.type;
      const key = buckets[rawType] ? rawType : 'unlogged';
      buckets[key].contacted += 1;
      if (reachedActiveExploration(p)) buckets[key].advanced += 1;
    });
    return order.map(key => buckets[key]);
  }

  // Same shape as channel effectiveness above, but grouped by category
  // instead of contact channel: of prospects who have actually been
  // contacted, how many reached real active exploration, per category.
  // Category is the other real field this project tracks per prospect
  // (alongside contact channel), so which verticals are actually worth the
  // outreach effort is its own real signal, not folded into the channel
  // breakdown above. Same "silent-replied" exclusion and minimum-sample
  // gating as computeChannelEffectiveness, for the same reasons.
  function computeCategoryEffectiveness(prospects) {
    const buckets = {};
    const order = [];
    function bucketFor(category) {
      const key = category || 'uncategorized';
      if (!buckets[key]) {
        buckets[key] = { key, label: category || 'No category logged', contacted: 0, advanced: 0 };
        order.push(key);
      }
      return buckets[key];
    }
    prospects.forEach(p => {
      if (p.stage === 'researched') return;
      const bucket = bucketFor(p.category);
      bucket.contacted += 1;
      if (reachedActiveExploration(p)) bucket.advanced += 1;
    });
    return order
      .map(key => buckets[key])
      .sort((a, b) => b.contacted - a.contacted || a.label.localeCompare(b.label));
  }

  // Every prospect currently past its stage's real staleAfterDays threshold,
  // worst (longest stalled) first. Thin wrapper over stallInfo across the
  // whole pipeline, same board-wide-rollup role computeColdSignal and
  // computeFunnel play over their own per-prospect primitives.
  function computeStalled(stages, prospects) {
    const stageById = Object.fromEntries(stages.map(s => [s.id, s]));
    return prospects
      .map(p => ({ p, info: stallInfo(p, stageById) }))
      .filter(x => x.info && x.info.isStale)
      .sort((a, b) => b.info.days - a.info.days);
  }

  // True once some forward-looking plan is on record for this prospect, by
  // any of the three real ways one can be logged: a queued nextNudgeDate, a
  // planned nudgeSchedule.nudgePoint, or a deliberate parked
  // nudgeSchedule.doNotNudgeBefore (the same "on purpose, not neglected"
  // signal computeColdSignal's parked list already treats as a real
  // decision, not a gap).
  function hasNudgePlan(p) {
    if (p.nextNudgeDate && isValidDateStr(p.nextNudgeDate)) return true;
    const ns = p.nudgeSchedule || {};
    if (ns.nudgePoint && isValidDateStr(ns.nudgePoint)) return true;
    if (ns.doNotNudgeBefore && isValidDateStr(ns.doNotNudgeBefore)) return true;
    return false;
  }

  // Whether a prospect past the researched stage still has no logged
  // contact channel type (named decision-maker vs. generic inbox), the
  // single field this project's own real history has found most predictive
  // of a reply. Shared between the Data Quality badge below and the "Log
  // new prospect" warnings in app.js so the two can never independently
  // drift on what counts as a real gap.
  function missingContactChannelType(p) {
    return p.stage !== 'researched' && !(p.contactChannel && p.contactChannel.type);
  }

  function missingVerifiedHook(p) {
    return p.stage !== 'researched' && !p.verifiedHook;
  }

  function channelTypeLoggedWithNoDetail(p) {
    return !!(p.contactChannel && p.contactChannel.type && !p.contactChannel.detail);
  }

  function missingFollowUpPlan(p) {
    return (p.stage === 'outreach-sent' || p.stage === 'silent-replied') && !hasNudgePlan(p);
  }

  // Per-prospect data-quality check: every real gap the board can actually
  // detect from a prospect's own fields, not just the stall/cold-signal/
  // duplicate checks that already get their own panels. Reasons are plain
  // text (no HTML escaping here, this module has no DOM); the caller escapes
  // each reason before rendering it, the same split every other CSMCore
  // string this app puts into innerHTML already relies on.
  function computeDataQualityFlags(stages, prospects) {
    return prospects
      .map(p => {
        const reasons = [];
        if (missingContactChannelType(p)) reasons.push('NO CONTACT CHANNEL TYPE LOGGED');
        if (missingVerifiedHook(p)) reasons.push('NO VERIFIED HOOK LOGGED');
        if (channelTypeLoggedWithNoDetail(p)) {
          reasons.push('CONTACT CHANNEL TYPE LOGGED BUT NO CONTACT DETAIL');
        }
        if (missingFollowUpPlan(p)) {
          reasons.push('NO FOLLOW-UP SCHEDULED, ALREADY CONTACTED WITH NOTHING PLANNED NEXT');
        }
        const snapStale = socialSnapshotsStaleInfo(p);
        if (snapStale) reasons.push(snapStale.days + 'D OLD ' + (snapStale.platform ? String(snapStale.platform).toUpperCase() + ' ' : '') + 'SNAPSHOT, DUE FOR REFRESH');
        if (hasOutOfOrderDates(p.stageHistory)) reasons.push('STAGE HISTORY DATES OUT OF ORDER, CHECK FORMATTING');
        if (hasOutOfOrderDates(p.outreachLog)) reasons.push('OUTREACH LOG DATES OUT OF ORDER, CHECK FORMATTING');
        if (p.nextNudgeDate && !isValidDateStr(p.nextNudgeDate)) reasons.push('NEXT NUDGE DATE IS NOT A VALID DATE, CHECK FORMATTING');
        return { p, reasons };
      })
      .filter(x => x.reasons.length > 0);
  }

  // Real XSS guard (OWASP): this page renders hand-editable JSON field
  // values (a prospect's name, a note, a channel detail) straight into
  // innerHTML, so a value containing "<script>" or an "onerror=" attribute
  // has to come out as inert text rather than live markup. Ran untested in
  // app.js since this hub's first version, same gap csvField below used to
  // have before it moved into this file.
  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // CSV/formula injection (OWASP): a hand-typed note starting with
  // =, +, -, @, tab, or a carriage return is read as a live formula by
  // Excel/Sheets when this export is opened there, not as plain text.
  // A leading single quote is the standard mitigation both recommend.
  function csvField(v) {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  // RFC 5545 (iCalendar) text escaping: backslash, comma, semicolon, and
  // newline all need a backslash escape inside a property value.
  function icsEscapeText(s) {
    return String(s == null ? '' : s)
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\n/g, '\\n');
  }

  // Folds a single logical property line at 75 octets with a CRLF + single
  // space continuation, per RFC 5545 section 3.1. Long SUMMARY/DESCRIPTION
  // lines are common here (name + company, or a full next-action sentence),
  // and unfolded lines are technically invalid even though most calendar
  // apps tolerate them.
  // RFC 5545 folds at 75 octets, not 75 characters, and a multi-byte UTF-8
  // character must never be split across the fold. This pipeline logs real
  // prospect names/notes for Chinese social platforms, so counting JS string
  // length here (UTF-16 code units) instead of UTF-8 bytes would cut a
  // non-ASCII character in half the moment a name or note pushed a line past
  // 75 of those units, producing a line some calendar apps reject on import.
  const icsEncoder = new TextEncoder();
  function icsFoldLine(line) {
    if (icsEncoder.encode(line).length <= 75) return line;
    const segments = [];
    let seg = '';
    let segBytes = 0;
    let budget = 75;
    for (const ch of line) { // for...of walks by code point, never a lone surrogate half
      const chBytes = icsEncoder.encode(ch).length;
      if (segBytes + chBytes > budget) {
        segments.push(seg);
        seg = '';
        segBytes = 0;
        budget = 74; // continuation lines carry a leading space, counted separately below
      }
      seg += ch;
      segBytes += chBytes;
    }
    if (seg) segments.push(seg);
    return segments.map((s, i) => (i === 0 ? s : ' ' + s)).join('\r\n');
  }

  // Turns a real name/company into the id a pasted prospect object needs.
  // Strips to [a-z0-9] only, so a real name/company typed entirely in
  // Chinese characters (this hub's whole subject is China social media
  // prospects, a very real, expected case, not an edge case) strips to
  // nothing and would otherwise silently collapse to the generic
  // "new-prospect" id with no indication anything unusual happened.
  // collapsedFromRealInput exposes whether that fallback was hit on real
  // input (as opposed to no input at all) so a caller can warn about it,
  // rather than baking the warning text into this function.
  function slugifyProspectId(name, company) {
    const base = [company, name].filter(Boolean).join('-');
    const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return { id: slug || 'new-prospect', collapsedFromRealInput: !slug && !!base };
  }

  // The "Log new prospect" generator (single-add and paste-a-batch quick-add
  // both use this) only ever guards against an exact id collision, never a
  // near-miss under a slightly different id (that's a separate, real check,
  // see CSMValidateCore.findDuplicateProspects), so getting this exact
  // collision check right matters: two prospects silently sharing one id
  // would make one invisibly overwrite the other's card, modal, and edits
  // everywhere this page looks things up by id. existingIds takes an
  // array or a Set so both the single-add path (ids already on the page)
  // and the batch quick-add path (which also has to fold in ids assigned
  // earlier in the same unsaved batch, before any of them are real) can
  // share one implementation instead of two hand-rolled copies of the same
  // suffix loop drifting apart.
  function nextAvailableId(baseId, existingIds) {
    const idSet = existingIds instanceof Set ? existingIds : new Set(existingIds);
    if (!idSet.has(baseId)) return { id: baseId, isDuplicateId: false };
    let n = 2;
    let id = baseId + '-' + n;
    while (idSet.has(id)) { n++; id = baseId + '-' + n; }
    return { id, isDuplicateId: true };
  }

  // Whether a candidate category collides, case/whitespace-insensitively,
  // with a different-cased spelling an existing prospect already uses (the
  // same fragmentation CSMValidateCore.findCasingDrift catches across a
  // whole saved prospects array, checked here before the new category is
  // even added, so the "Log new prospect" generator can warn about it
  // before it ever gets pasted in). Returns the other real spelling to
  // point at, or null if there is no clash.
  function findCategoryCasingClash(category, existingProspects) {
    if (!category) return null;
    const norm = category.trim().toLowerCase();
    const existing = existingProspects.map(x => x.category).filter(Boolean);
    return existing.find(c => c.trim().toLowerCase() === norm && c !== category) || null;
  }

  // Whether a candidate name+company already matches a real, existing
  // prospect (the same "same person logged twice" case
  // CSMValidateCore.findDuplicateProspects catches across a whole saved
  // prospects array, checked here before the new entry is even added).
  // Returns the matching prospect, or null.
  function findProspectByNameCompany(name, company, existingProspects) {
    if (!name) return null;
    const key = name.trim().toLowerCase() + '|' + (company || '').trim().toLowerCase();
    return existingProspects.find(x => x.name &&
      x.name.trim().toLowerCase() + '|' + (x.company || '').trim().toLowerCase() === key) || null;
  }

  // Warnings shown before drafting a real outreach message (the "Copy
  // outreach brief"/stage-move generators): missing the two fields most
  // predictive of a real reply, so a message goes out without either ever
  // being surfaced as a gap. Deliberately advisory, never blocking: this
  // pipeline has no send step of its own to gate, only ever prepares text
  // for a human to send elsewhere.
  function outreachReadinessWarnings(p) {
    const warnings = [];
    if (!p.verifiedHook) {
      warnings.push('No verifiedHook logged yet for this prospect, the real reason this person/brand fits.');
    }
    if (!p.contactChannel || !p.contactChannel.type) {
      warnings.push('contactChannel.type is not logged yet (named decision-maker vs. generic inbox), the single field most predictive of a real reply.');
    }
    return warnings;
  }

  // Table alternative to the kanban board: same filtered prospects, but
  // sortable across every stage at once instead of grouped into columns.
  // A named decision-maker contact is real, verified outreach leverage a
  // generic inbox isn't, so it sorts ahead of one, which sorts ahead of no
  // channel logged at all yet.
  function channelSortRank(channel) {
    const type = channel && channel.type;
    if (type === 'named-decision-maker') return 0;
    if (type === 'generic-inbox') return 1;
    return 2;
  }

  // Multi-key sort behind the flat prospect list's own column headers. Every
  // "missing value sorts last" placeholder here is deliberate, not a
  // fallback afterthought: stage 999 (a prospect whose stage id no longer
  // matches any real stage), nextNudgeDate '9999-99-99' (no plan logged yet
  // is the real worst case for "soonest nudge due", never treated as
  // already-overdue by sorting it first), stalled/lastTouch -1 (a prospect
  // that isn't actually stalled, or has no logged touch at all, ranks below
  // every prospect with a real number). Ties always break by name, so a
  // resort with an unchanged key set never reorders equal rows for no
  // visible reason.
  function listComparator(key, dir, stageById, stageOrderIndex) {
    const mul = dir === 'desc' ? -1 : 1;
    return (a, b) => {
      let av, bv;
      switch (key) {
        case 'stage':
          av = stageOrderIndex[a.stage]; bv = stageOrderIndex[b.stage];
          av = av == null ? 999 : av; bv = bv == null ? 999 : bv;
          break;
        case 'category':
          av = (a.category || '').toLowerCase(); bv = (b.category || '').toLowerCase();
          break;
        case 'channel':
          av = channelSortRank(a.contactChannel); bv = channelSortRank(b.contactChannel);
          break;
        case 'nextNudge':
          av = a.nextNudgeDate || '9999-99-99'; bv = b.nextNudgeDate || '9999-99-99';
          break;
        case 'stalled': {
          const ai = stallInfo(a, stageById), bi = stallInfo(b, stageById);
          av = ai ? ai.days : -1; bv = bi ? bi.days : -1;
          break;
        }
        case 'lastTouch': {
          const at = daysSinceLastTouch(a), bt = daysSinceLastTouch(b);
          av = at == null ? -1 : at; bv = bt == null ? -1 : bt;
          break;
        }
        case 'touches':
          av = touchCount(a); bv = touchCount(b);
          break;
        case 'name':
        default:
          av = (a.name || '').toLowerCase(); bv = (b.name || '').toLowerCase();
      }
      if (av < bv) return -1 * mul;
      if (av > bv) return 1 * mul;
      return (a.name || '').localeCompare(b.name || '');
    };
  }

  return {
    DATE_RE, SOCIAL_SNAPSHOT_STALE_DAYS, COLD_TOUCH_THRESHOLD, CHANNEL_EFF_MIN_N_FOR_RATE,
    isValidDateStr, daysUntil, daysSince, hasOutOfOrderDates, stallInfo,
    socialSnapshotStaleInfo, socialSnapshotsStaleInfo,
    nudgeUrgencyLevel, computeNudgeRows, byUrgency, touchCount, daysSinceLastTouch,
    todayIso, addDaysIso, suggestedNudgeOffsetDays, rollToWeekdayIso, beijingTimeInfo,
    reachedActiveExploration, computeStageVelocity, computeColdSignal, computeFunnel,
    computeSocialReach, computeChannelEffectiveness, computeCategoryEffectiveness,
    computeStalled, hasNudgePlan, computeDataQualityFlags, escapeHtml, csvField, icsEscapeText, icsFoldLine,
    outreachReadinessWarnings, channelSortRank, listComparator,
    slugifyProspectId, nextAvailableId, findCategoryCasingClash, findProspectByNameCompany,
    missingContactChannelType, missingVerifiedHook, channelTypeLoggedWithNoDetail, missingFollowUpPlan
  };
});

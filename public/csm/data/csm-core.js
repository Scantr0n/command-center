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

  // Real influencer-tracking practice (and this project's own schema docs:
  // "add another dated entry for a refresh rather than overwriting the old
  // one") expects a re-pulled snapshot to show growth since the last real
  // pull, not just sit next to it as an unrelated second row. Still not live
  // data: this only ever compares two manually logged, dated snapshots for
  // the same platform, never anything computed against today. Returns a Map
  // keyed by the newer snapshot object (reference identity, since snapshots
  // carry no id of their own) so a caller can look up "does this entry have
  // a prior one to compare against" without re-sorting per platform itself.
  function computeSocialSnapshotGrowth(snapshots) {
    const growthByRef = new Map();
    const byPlatform = {};
    (snapshots || []).forEach(snap => {
      if (!snap || !snap.platform || !isValidDateStr(snap.asOfDate)) return;
      (byPlatform[snap.platform] = byPlatform[snap.platform] || []).push(snap);
    });
    Object.values(byPlatform).forEach(arr => {
      const sorted = arr.slice().sort((a, b) => a.asOfDate.localeCompare(b.asOfDate));
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1];
        const cur = sorted[i];
        const entry = { previousAsOfDate: prev.asOfDate, daysSincePrevious: daysSince(prev.asOfDate) - daysSince(cur.asOfDate) };
        const prevF = Number(prev.followers);
        const curF = Number(cur.followers);
        if (prev.followers != null && cur.followers != null && Number.isFinite(prevF) && Number.isFinite(curF)) {
          entry.followersDelta = curF - prevF;
          entry.followersPercent = prevF !== 0 ? (entry.followersDelta / prevF) * 100 : null;
        }
        const prevE = Number(prev.engagementRate);
        const curE = Number(cur.engagementRate);
        if (prev.engagementRate != null && cur.engagementRate != null && Number.isFinite(prevE) && Number.isFinite(curE)) {
          entry.engagementDelta = curE - prevE;
        }
        growthByRef.set(cur, entry);
      }
    });
    return growthByRef;
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

  // Official 2026 China public holiday schedule, General Office of the
  // State Council notice published 2025-11-04. A nudge that lands inside
  // one of these is not just low-effort like a weekend send, the recipient
  // is genuinely out of office, so this gets checked separately from
  // rollToWeekdayIso above rather than folded into "weekend". 2026 only:
  // that is the only year with an official notice out as of when this was
  // written, extend with the next year's real notice once one exists
  // instead of guessing a pattern forward.
  const CHINA_HOLIDAYS_2026 = [
    { name: 'New Year', start: '2026-01-01', end: '2026-01-03' },
    { name: 'Spring Festival', start: '2026-02-15', end: '2026-02-23' },
    { name: 'Qingming Festival', start: '2026-04-04', end: '2026-04-06' },
    { name: 'Labour Day', start: '2026-05-01', end: '2026-05-05' },
    { name: 'Dragon Boat Festival', start: '2026-06-19', end: '2026-06-21' },
    { name: 'Mid-Autumn Festival', start: '2026-09-25', end: '2026-09-27' },
    { name: 'National Day (Golden Week)', start: '2026-10-01', end: '2026-10-07' }
  ];

  // The year CHINA_HOLIDAYS_2026 actually covers, exposed separately from
  // the array itself so a caller can tell "not a holiday" (chinaHolidayOnDate
  // returned null because it genuinely is not one) apart from "this date's
  // year was never loaded" (it returned null because nobody has entered next
  // year's real notice yet). Without that distinction, the moment 2027
  // starts every holiday check on this page silently goes back to
  // weekend-only with no visible sign anything changed, same failure mode
  // PLATFORM_REFERENCE_STALE_AFTER_DAYS in app.js exists to avoid for the
  // platform-marketplace table.
  const CHINA_HOLIDAYS_COVERED_YEAR = 2026;

  function chinaHolidayOnDate(iso) {
    return CHINA_HOLIDAYS_2026.find(h => iso >= h.start && iso <= h.end) || null;
  }

  function chinaHolidayCalendarCoversDate(iso) {
    return typeof iso === 'string' && iso.slice(0, 4) === String(CHINA_HOLIDAYS_COVERED_YEAR);
  }

  // Rolls a proposed date past both weekends and the real holiday calendar
  // above, so a suggested nudge date never lands inside a stretch when a
  // Chinese business contact is genuinely unreachable. Loops one range at a
  // time, not a single fixed skip, since Spring Festival (9 days in 2026)
  // straddles a real weekend on both ends, jumping to the day after a
  // holiday can land back on a weekend or, in principle, another holiday.
  function rollPastChinaHolidays(iso) {
    let candidate = rollToWeekdayIso(iso);
    let holiday = chinaHolidayOnDate(candidate);
    while (holiday) {
      candidate = rollToWeekdayIso(addDaysIso(holiday.end, 1));
      holiday = chinaHolidayOnDate(candidate);
    }
    return candidate;
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
    const dateIso = shifted.getUTCFullYear() + '-' + String(shifted.getUTCMonth() + 1).padStart(2, '0') + '-' +
      String(shifted.getUTCDate()).padStart(2, '0');
    return {
      hour, minute, dayOfWeek, weekdayName: WEEKDAY_NAMES[dayOfWeek], dateIso,
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

  // Real, commonly tracked cold-outreach metric: how long from the first
  // real outbound touch ("initial-send", or the earliest "nudge" if no
  // initial-send was ever logged) to the first real inbound "reply" touch.
  // Both ends come only from outreachLog's own dated entries, never from
  // replyStatus (free text, no date) or nextNudgeDate (a plan, not a real
  // event), so this stays null until an actual reply has actually been
  // logged with a date. A reply dated before the earliest outbound touch is
  // a data problem (validate.js already flags it as out of order), not a
  // negative response time, so that also returns null rather than a
  // fabricated negative number.
  function daysToFirstReply(p) {
    const log = (p.outreachLog || []).filter(e => e && isValidDateStr(e.date));
    const outboundDates = log.filter(e => e.type === 'initial-send' || e.type === 'nudge').map(e => e.date);
    const replyDates = log.filter(e => e.type === 'reply').map(e => e.date);
    if (outboundDates.length === 0 || replyDates.length === 0) return null;
    const firstOutbound = outboundDates.reduce((min, d) => (d < min ? d : min));
    const firstReply = replyDates.reduce((min, d) => (d < min ? d : min));
    const gap = daysUntil(firstReply) - daysUntil(firstOutbound);
    return gap >= 0 ? gap : null;
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

  // Real gap this closes: outreachLog's own schema doc (index.html) already
  // says a logged "reply" entry exists "to measure real reply latency", but
  // until now daysToFirstReply only ever surfaced per-prospect (a single
  // field on that prospect's own detail view and CSV row), never rolled up
  // across the pipeline the way stage velocity or channel effectiveness are.
  // Grouped by contactChannel.type for the same reason channel effectiveness
  // is: that field is this project's single most predictive real signal, so
  // whether a named decision-maker actually replies faster than a generic
  // inbox (not just more often) is worth seeing as its own number, not
  // buried one prospect at a time. Same bucket order/labels as
  // computeChannelEffectiveness so the two sections read as one family.
  function computeReplyLatency(prospects) {
    const order = ['named-decision-maker', 'generic-inbox', 'unlogged'];
    const labels = {
      'named-decision-maker': 'Named decision-maker',
      'generic-inbox': 'Generic inbox',
      'unlogged': 'Channel not logged'
    };
    const days = {};
    order.forEach(key => { days[key] = []; });
    prospects.forEach(p => {
      const gap = daysToFirstReply(p);
      if (gap == null) return;
      const rawType = p.contactChannel && p.contactChannel.type;
      const key = days[rawType] ? rawType : 'unlogged';
      days[key].push(gap);
    });
    const allDays = order.reduce((acc, key) => acc.concat(days[key]), []);
    function summarize(list) {
      return {
        n: list.length,
        avgDays: list.length > 0 ? Math.round(list.reduce((sum, d) => sum + d, 0) / list.length) : null,
        minDays: list.length > 0 ? Math.min(...list) : null,
        maxDays: list.length > 0 ? Math.max(...list) : null
      };
    }
    return {
      overall: summarize(allDays),
      byChannel: order.map(key => Object.assign({ key, label: labels[key] }, summarize(days[key])))
    };
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

  // in-exploration is the one open stage missingFollowUpPlan above doesn't
  // cover: an active back-and-forth usually isn't driven by a cold nudge
  // date the way outreach-sent/silent-replied are, so hasNudgePlan doesn't
  // fit it, but "every open deal needs a concrete next step" (real
  // sales-pipeline practice, not specific to a nudge date) still applies.
  // Scoped to just this one stage on purpose: outreach-sent/silent-replied
  // already get their own check above, and researched/client aren't open
  // deals waiting on a next step.
  function missingNextAction(p) {
    return p.stage === 'in-exploration' && !p.nextAction;
  }

  // The opposite real gap from missingFollowUpPlan above: a nextNudgeDate is
  // still queued, but the most recently dated real touch in outreachLog is
  // already a "reply", so that queued cold nudge almost certainly predates
  // the reply and is stale, not a real intention to nudge someone who has
  // already written back. Deliberately only fires when the reply is the
  // single most recent dated entry (not just "a reply exists somewhere in
  // the log"), so a real second cold patch after a reply went nowhere and
  // more outbound touches followed isn't wrongly flagged as stale.
  function hasStaleNudgePlanAfterReply(p) {
    if (!p.nextNudgeDate || !isValidDateStr(p.nextNudgeDate)) return false;
    const log = (p.outreachLog || []).filter(e => e && isValidDateStr(e.date));
    if (log.length === 0) return false;
    const latest = log.reduce((max, e) => (e.date > max.date ? e : max), log[0]);
    return latest.type === 'reply';
  }

  // Every real free-text field on this board is written without em dashes
  // (this project's own convention), so a hand-typed or pasted-in field that
  // has one reads as coming from somewhere else rather than Jack's own
  // voice. Used to live only in validate.js's own copy, checked solely from
  // the command line; moved here so the same rule can also feed the live
  // Data Quality panel, same shared-core-with-tests pattern as every other
  // predicate above. Warning-level only: an em dash never breaks anything
  // rendered, this is a style nudge, not a data error.
  function emDashFields(obj, fields) {
    const hits = [];
    if (!obj) return hits;
    fields.forEach(f => {
      const v = obj[f];
      if (typeof v === 'string' && v.includes(String.fromCharCode(8212))) hits.push(f);
    });
    return hits;
  }

  // Same per-prospect field set validate.js already checks (top-level fields
  // including replyStatus/notes, contactChannel.detail, every outreachLog
  // note, every contentIdeas idea), flattened into one list of
  // human-readable field labels so a caller can report exactly which
  // field(s) tripped it without re-deriving the field list itself.
  // replyStatus and notes were missed when this list was first split out of
  // validate.js: both are free-text fields rendered in the modal and the
  // copyable outreach brief same as verifiedHook/nextAction, so a pasted-in
  // em dash there was going uncaught by both validate.js and this same
  // live Data Quality panel that catches one in every other free-text field.
  function emDashHits(p) {
    const hits = emDashFields(p, ['name', 'company', 'verifiedHook', 'nextAction', 'replyStatus', 'notes']);
    if (emDashFields(p.contactChannel, ['detail']).length) hits.push('contactChannel.detail');
    (p.outreachLog || []).forEach((entry, i) => {
      if (emDashFields(entry, ['note']).length) hits.push('outreachLog[' + i + '].note');
    });
    (p.contentIdeas || []).forEach((entry, i) => {
      if (emDashFields(entry, ['idea']).length) hits.push('contentIdeas[' + i + '].idea');
    });
    return hits;
  }

  // schemaVersion 1 stored one social pull as a single "socialSnapshot"
  // object; schemaVersion 2 (prospects.json's own top-of-file note explains
  // why) moved to "socialSnapshots", an array, since a real China social
  // media prospect is commonly active on more than one platform. Every
  // reader in this app (the board, the modal, the CSV/brief/ics builders,
  // socialSnapshotsStaleInfo below) only ever looks at the plural array, so
  // a leftover or hand-typed singular "socialSnapshot" key is not a second,
  // ignored copy of the data, it is real research that never renders
  // anywhere and never gets caught by any array-shaped check above, since
  // those only ever look at the field they expect.
  function hasLegacySocialSnapshotField(p) {
    return p != null && typeof p === 'object' && Object.prototype.hasOwnProperty.call(p, 'socialSnapshot');
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
        if (missingNextAction(p)) {
          reasons.push('IN ACTIVE EXPLORATION BUT NO NEXT ACTION LOGGED, AN OPEN DEAL STILL NEEDS A CONCRETE NEXT STEP');
        }
        if (hasStaleNudgePlanAfterReply(p)) {
          reasons.push('NEXT NUDGE DATE STILL SET BUT THE MOST RECENT LOGGED TOUCH IS A REPLY, RECONSIDER BEFORE COLD-NUDGING SOMEONE WHO ALREADY WROTE BACK');
        }
        const snapStale = socialSnapshotsStaleInfo(p);
        if (snapStale) reasons.push(snapStale.days + 'D OLD ' + (snapStale.platform ? String(snapStale.platform).toUpperCase() + ' ' : '') + 'SNAPSHOT, DUE FOR REFRESH');
        if (hasOutOfOrderDates(p.stageHistory)) reasons.push('STAGE HISTORY DATES OUT OF ORDER, CHECK FORMATTING');
        if (hasOutOfOrderDates(p.outreachLog)) reasons.push('OUTREACH LOG DATES OUT OF ORDER, CHECK FORMATTING');
        if (p.nextNudgeDate && !isValidDateStr(p.nextNudgeDate)) reasons.push('NEXT NUDGE DATE IS NOT A VALID DATE, CHECK FORMATTING');
        const emDashHitFields = emDashHits(p);
        if (emDashHitFields.length) reasons.push('EM DASH IN ' + emDashHitFields.join(', ').toUpperCase() + ', CHECK FOR A PASTE-IN');
        if (hasLegacySocialSnapshotField(p)) {
          reasons.push('LEGACY "SOCIALSNAPSHOT" (SINGULAR) FIELD PRESENT, THIS SCHEMA USES "SOCIALSNAPSHOTS" (PLURAL ARRAY), NOTHING IN THAT FIELD IS SHOWN ANYWHERE ON THIS PAGE');
        }
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

  // Whether a candidate verifiedHook exactly matches one already logged on a
  // different prospect (case/whitespace-insensitive), the entry-time version
  // of CSMValidateCore.findDuplicateHooks: catches a copy-pasted, not-really-
  // personalized hook before it is ever saved, rather than only after, when
  // the "Reused verified hook" panel would flag it. Returns the matching
  // existing prospect, or null.
  function findHookReuseMatch(hook, existingProspects) {
    if (!hook || typeof hook !== 'string') return null;
    const norm = hook.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!norm) return null;
    return existingProspects.find(x => x.verifiedHook && typeof x.verifiedHook === 'string' &&
      x.verifiedHook.trim().toLowerCase().replace(/\s+/g, ' ') === norm) || null;
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

  // Generalizes the same "not ready yet" idea above (outreachReadinessWarnings
  // is the outreach-sent-specific case of this, kept as-is since it already
  // has its own tests and callers) to every other stage: a real, well-known
  // sales-pipeline pattern is that every stage has entry/exit criteria, not
  // just a color and a description. Each stage's entryCriteria in
  // stages.json names a real structural field this board already tracks
  // (never an invented one), and this checks a real prospect object against
  // it. An id with no matching checker (a typo in stages.json, or a future
  // criterion added there without a checker yet) reads as unmet rather than
  // throwing, so a data-only edit can never crash the board.
  const STAGE_ENTRY_CRITERIA_CHECKERS = {
    'verified-hook': p => !!(p && p.verifiedHook),
    'contact-channel': p => !!(p && p.contactChannel && p.contactChannel.type),
    'send-logged': p => !!(p && (p.sendDate || (Array.isArray(p.outreachLog) && p.outreachLog.length > 0))),
    'reply-logged': p => !!(p && p.replyStatus)
  };

  function stageEntryCriteriaStatus(p, stage) {
    const criteria = (stage && stage.entryCriteria) || [];
    return criteria.map(c => ({
      id: c.id,
      label: c.label,
      met: typeof STAGE_ENTRY_CRITERIA_CHECKERS[c.id] === 'function' && STAGE_ENTRY_CRITERIA_CHECKERS[c.id](p)
    }));
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

  // Field-by-field diff between the pipeline data currently loaded in the
  // browser and a previously downloaded "Download backup (.json)" file (see
  // app.js's backupBtn handler for the exact shape that button writes:
  // { exportedAt, prospectsJson: { prospects: [...] }, stagesJson: { stages: [...] } }).
  // The schema-help text already promises a bad hand-edit "can be diffed
  // against... a known-good copy", but nothing on the page actually did that
  // diffing until this, it was left to eyeballing two JSON files by hand.
  // Pure and read-only: this only ever reads the two objects it is given, it
  // never writes anything back to prospects.json/stages.json itself.
  const PROSPECT_DIFF_FIELDS = [
    'name', 'company', 'category', 'stage', 'stageEnteredDate', 'verifiedHook',
    'contactChannel', 'sendDate', 'nextNudgeDate', 'nextAction', 'nudgeSchedule',
    'replyStatus', 'socialSnapshots', 'contentIdeas', 'stageHistory', 'outreachLog', 'notes'
  ];

  const STAGE_DIFF_FIELDS = ['label', 'shortLabel', 'description', 'color', 'staleAfterDays', 'entryCriteria'];

  // undefined and null both mean "not logged" across this schema (see the
  // null-vs-empty-string convention in prospects.json's own note), so they
  // compare equal here rather than flagging a field as changed just because
  // one side's key was omitted and the other's was explicitly null.
  function fieldValuesDiffer(a, b) {
    const na = a === undefined ? null : a;
    const nb = b === undefined ? null : b;
    return JSON.stringify(na) !== JSON.stringify(nb);
  }

  function diffById(currentList, backupList, fields) {
    const currentById = new Map((currentList || []).filter(x => x && x.id).map(x => [x.id, x]));
    const backupById = new Map((backupList || []).filter(x => x && x.id).map(x => [x.id, x]));
    const added = [];
    const removed = [];
    const changed = [];
    currentById.forEach((item, id) => {
      if (!backupById.has(id)) { added.push(item); return; }
      const prior = backupById.get(id);
      const changedFields = fields.filter(f => fieldValuesDiffer(item[f], prior[f]));
      if (changedFields.length) changed.push({ id, current: item, backup: prior, fields: changedFields });
    });
    backupById.forEach((item, id) => {
      if (!currentById.has(id)) removed.push(item);
    });
    return { added, removed, changed };
  }

  // currentProspectsData/currentStagesData are the raw fetched objects app.js
  // already keeps around as rawProspectsData/rawStagesData (i.e.
  // { prospects: [...] } / { stages: [...] }); backupFile is a backup file's
  // parsed JSON. Throws a plain Error, meant to be shown to the user as-is,
  // if the file handed in was never produced by this page's own backup
  // button (a random JSON file has no real "before" state to diff against).
  function compareWithBackup(currentProspectsData, currentStagesData, backupFile) {
    if (!backupFile || typeof backupFile !== 'object' || !backupFile.prospectsJson || !backupFile.stagesJson) {
      throw new Error('That file does not look like a CSM pipeline backup (expected prospectsJson/stagesJson keys). ' +
        'Use a file downloaded from this page’s "Download backup (.json)" button.');
    }
    const currentProspects = (currentProspectsData && currentProspectsData.prospects) || [];
    const backupProspects = (backupFile.prospectsJson && backupFile.prospectsJson.prospects) || [];
    const currentStages = (currentStagesData && currentStagesData.stages) || [];
    const backupStages = (backupFile.stagesJson && backupFile.stagesJson.stages) || [];
    return {
      exportedAt: backupFile.exportedAt || null,
      prospects: diffById(currentProspects, backupProspects, PROSPECT_DIFF_FIELDS),
      stages: diffById(currentStages, backupStages, STAGE_DIFF_FIELDS)
    };
  }

  return {
    DATE_RE, SOCIAL_SNAPSHOT_STALE_DAYS, COLD_TOUCH_THRESHOLD, CHANNEL_EFF_MIN_N_FOR_RATE,
    isValidDateStr, daysUntil, daysSince, hasOutOfOrderDates, stallInfo,
    socialSnapshotStaleInfo, socialSnapshotsStaleInfo, computeSocialSnapshotGrowth,
    nudgeUrgencyLevel, computeNudgeRows, byUrgency, touchCount, daysSinceLastTouch, daysToFirstReply,
    todayIso, addDaysIso, suggestedNudgeOffsetDays, rollToWeekdayIso, beijingTimeInfo,
    CHINA_HOLIDAYS_2026, CHINA_HOLIDAYS_COVERED_YEAR, chinaHolidayOnDate, chinaHolidayCalendarCoversDate,
    rollPastChinaHolidays,
    reachedActiveExploration, computeStageVelocity, computeColdSignal, computeFunnel,
    computeSocialReach, computeChannelEffectiveness, computeCategoryEffectiveness, computeReplyLatency,
    computeStalled, hasNudgePlan, computeDataQualityFlags, escapeHtml, csvField, icsEscapeText, icsFoldLine,
    outreachReadinessWarnings, stageEntryCriteriaStatus, channelSortRank, listComparator,
    slugifyProspectId, nextAvailableId, findCategoryCasingClash, findProspectByNameCompany, findHookReuseMatch,
    missingContactChannelType, missingVerifiedHook, channelTypeLoggedWithNoDetail, missingFollowUpPlan,
    missingNextAction, hasStaleNudgePlanAfterReply, hasLegacySocialSnapshotField,
    emDashFields, emDashHits, compareWithBackup, hasNewDueId
  };

  // The on-page nudge-overdue notify check used to fire only when the
  // overdue count went up (currentCount > previousCount), which misses a
  // real transition: one overdue prospect getting nudged in the same poll
  // window a different one newly falls overdue leaves the count flat (or
  // lower), so the count-only check never fires even though something
  // genuinely new needs a nudge. Comparing the actual set of prospect ids
  // catches that: previousIds null means this is the first check ever (no
  // real transition to report yet, same as the count-only version's
  // isFirstCheck guard).
  function hasNewDueId(currentIds, previousIds) {
    if (!previousIds) return false;
    const prev = new Set(previousIds);
    return currentIds.some(id => !prev.has(id));
  }
});

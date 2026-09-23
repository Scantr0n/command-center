/*
 * Pure date/urgency math shared between the dashboard itself
 * (public/csm/app.js) and this file's own regression test suite
 * (csm-core.test.js). No DOM, no Node-only APIs, same shared-core pattern as
 * CSMValidateCore in this same directory and GarageCore/goals-core.js in the
 * other hubs, so the math that decides whether a real nudge is overdue, a
 * stage is stalled, or a social snapshot is too old to trust actually has
 * regression coverage instead of only ever running live in a browser. This
 * is exactly the kind of nudge-schedule math the CSM pipeline exists to get
 * right (a wrong "days until due" silently misses or double-nudges a real
 * contact), so it deserves the same test coverage the other hubs already
 * give their own date math.
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

  return {
    DATE_RE, SOCIAL_SNAPSHOT_STALE_DAYS,
    isValidDateStr, daysUntil, daysSince, hasOutOfOrderDates, stallInfo,
    socialSnapshotStaleInfo, socialSnapshotsStaleInfo,
    nudgeUrgencyLevel, computeNudgeRows, byUrgency, touchCount, daysSinceLastTouch,
    todayIso, addDaysIso, suggestedNudgeOffsetDays, rollToWeekdayIso,
    reachedActiveExploration, computeStageVelocity
  };
});

/*
 * Pure release/bugfix-checkin date math pulled out of app.js so it can be
 * required directly from a Node test (release-core.test.js) without loading
 * the rest of the dashboard's DOM-touching code. Same reasoning as
 * goals-core.js/validate-core.js in this same folder.
 *
 * This is the "has the 7-day / 14-day post-bugfix check-in come due, and has
 * one already been missed" logic behind the Latest Release card's checkin
 * pill and the Next Steps / calendar-reminder entries it feeds. It has its
 * own small, self-contained copy of daysBetween/addDays/isValidDateStr
 * (same self-contained pattern turnaround-core.js uses rather than
 * requiring goals-core.js), because bugfixCheckinStatus below was built
 * directly out of them and reached their one previously-real bug: a
 * malformed release.date (a non-zero-padded "2026-9-5") made daysBetween
 * return NaN, and every `days < checkpoint` comparison below is always
 * false for NaN, so the function fell all the way through and rendered
 * "day NaN" instead of erroring or staying silent. There was also a
 * checkpoint-overlap bug: a checkpoint whose grace window closes before the
 * next checkpoint opens (true for 7, since 7+3=10 is before 14) used to
 * fall through the loop unrecorded once the 14-day checkpoint became
 * current, silently dropping the fact the 7-day one had ever been due.
 * Both are already fixed in the function below, but neither had a
 * regression test until this file, so nothing would have caught either
 * coming back the next time Sondrik ships a bugfix release.
 *
 * fmtDateFn lets app.js pass its own locale date formatter (so the on-page
 * text still reads "Sep 14, 2026") while keeping this module itself free of
 * any Intl/locale dependency; every test below passes the identity function
 * and asserts on the plain ISO date instead, which is also what keeps the
 * tests themselves independent of the runner's locale.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SondrikReleaseCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  function daysBetween(a, b) {
    return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
  }

  function addDays(iso, days) {
    const d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  function isValidDateStr(iso) {
    if (typeof iso !== 'string' || !DATE_RE.test(iso)) return false;
    const [y, m, d] = iso.split('-').map(Number);
    const parsed = new Date(y, m - 1, d);
    return parsed.getFullYear() === y && parsed.getMonth() === m - 1 && parsed.getDate() === d;
  }

  const BUGFIX_CHECKPOINTS = [7, 14];
  const BUGFIX_CHECKPOINT_GRACE_DAYS = 3;

  function bugfixCheckinStatus(release, todayIsoStr, fmtDateFn) {
    const fmtDate = fmtDateFn || (iso => iso);
    if (!release || release.type !== 'bugfix' || !release.date) return null;
    if (!isValidDateStr(release.date)) return null;
    const days = daysBetween(release.date, todayIsoStr);
    if (days < 0) return null;

    const missedCheckpoints = [];
    for (const checkpoint of BUGFIX_CHECKPOINTS) {
      if (days < checkpoint) {
        if (missedCheckpoints.length) {
          return {
            tier: 'missed',
            text: 'Missed the ' + missedCheckpoints.join('- and ') + '-day check-in (day ' + days + '); next is the ' +
              checkpoint + '-day check-in in ' + (checkpoint - days) + (checkpoint - days === 1 ? ' day' : ' days') +
              ' (' + fmtDate(addDays(release.date, checkpoint)) + ')'
          };
        }
        return {
          tier: 'upcoming',
          text: checkpoint + '-day check-in in ' + (checkpoint - days) + (checkpoint - days === 1 ? ' day' : ' days') +
            ' (' + fmtDate(addDays(release.date, checkpoint)) + ')'
        };
      }
      if (days < checkpoint + BUGFIX_CHECKPOINT_GRACE_DAYS) {
        if (missedCheckpoints.length) {
          return {
            tier: 'missed',
            text: 'Missed the ' + missedCheckpoints.join(' and ') + '-day check-in' + (missedCheckpoints.length > 1 ? 's' : '') +
              ' (day ' + days + '); the ' + checkpoint + '-day check-in is also due now, confirm no new reports of the fixed bug'
          };
        }
        return {
          tier: 'due',
          text: 'Past the ' + checkpoint + '-day check-in (day ' + days + '), confirm no new reports of the fixed bug'
        };
      }
      missedCheckpoints.push(checkpoint);
    }
    if (missedCheckpoints.length) {
      return {
        tier: 'missed',
        text: 'Missed the ' + missedCheckpoints.join(' and ') + '-day check-in' + (missedCheckpoints.length > 1 ? 's' : '') +
          ' (day ' + days + ')'
      };
    }
    return {
      tier: 'passed',
      text: 'Both the 7- and 14-day check-ins have passed (day ' + days + ')'
    };
  }

  // Shared "how long between real check-ins on average, and when's the next
  // one due" calculation, used both by the cadence line in the Traction
  // section and by the calendar-reminders export below, so the two can
  // never state two different suggested next-check dates off the same real
  // gaps. Needs at least two real checks (no gap exists off a single point).
  function suggestedCheckCadence(downloadsData) {
    const metric = (downloadsData && downloadsData.metric) || {};
    const checks = (metric.checks || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    if (checks.length < 2) return null;
    const gaps = [];
    for (let i = 1; i < checks.length; i++) gaps.push(daysBetween(checks[i - 1].date, checks[i].date));
    const avgGap = Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
    if (avgGap <= 0) return null;
    const latest = checks[checks.length - 1];
    return { avgGap, gapCount: gaps.length, latest, nextDate: addDays(latest.date, avgGap) };
  }

  // Turns the same two forward-looking real dates already computed elsewhere
  // on the page (the bugfix check-in schedule, the check-in cadence estimate)
  // into calendar reminders, so they land somewhere Jack will actually see
  // them instead of only on this page when he happens to visit it. Only ever
  // a date that is today or still in the future: a reminder for one that has
  // already passed isn't useful as a calendar event, Next Steps already
  // flags an overdue one as an action item instead. Adds no new fact, purely
  // a re-expression of real data that already renders elsewhere.
  //
  // todayIsoStr is explicit, same reason bugfixCheckinStatus above takes one:
  // a wrong filter here means Jack's real .ics calendar reminders silently
  // drift (either a stale reminder for a date that's already passed, or a
  // real upcoming one silently dropped), and that's only deterministically
  // testable if "today" isn't read from the real clock inside this function.
  function computeReminders(releasesData, downloadsData, todayIsoStr) {
    const reminders = [];

    const dated = ((releasesData && releasesData.releases) || []).filter(r => r.date)
      .slice().sort((a, b) => b.date.localeCompare(a.date));
    const latestRelease = dated[0];
    if (latestRelease && latestRelease.type === 'bugfix') {
      BUGFIX_CHECKPOINTS.forEach(checkpoint => {
        const date = addDays(latestRelease.date, checkpoint);
        if (date >= todayIsoStr) {
          reminders.push({
            date,
            uid: 'sondrik-checkin-v' + latestRelease.version + '-' + checkpoint + '@command-center',
            summary: 'Sondrik v' + latestRelease.version + ': ' + checkpoint + '-day check-in',
            description: 'Confirm no new reports of the bug fixed in v' + latestRelease.version +
              (latestRelease.summary ? ' (' + latestRelease.summary + ')' : '') + '.'
          });
        }
      });
    }

    const cadence = suggestedCheckCadence(downloadsData);
    if (cadence && cadence.nextDate >= todayIsoStr) {
      const metric = (downloadsData && downloadsData.metric) || {};
      reminders.push({
        date: cadence.nextDate,
        uid: 'sondrik-download-check-' + cadence.nextDate + '@command-center',
        summary: 'Sondrik: pull a fresh ' + (metric.label || 'download') + ' count',
        description: 'Based on ' + (cadence.gapCount === 1
          ? 'your only check-in gap so far' : 'the average of your last ' + cadence.gapCount + ' check-in gaps') +
          ' (~' + cadence.avgGap + (cadence.avgGap === 1 ? ' day' : ' days') + ').' +
          (metric.source ? ' Source: ' + metric.source + '.' : '')
      });
    }

    return reminders.sort((a, b) => a.date.localeCompare(b.date));
  }

  // Attaches each real, dated release to the earliest real download check
  // logged on or after it shipped, so the Traction chart can mark "a release
  // went out around here" on the same axis as the download counts instead of
  // only listing the two kinds of events separately in the Timeline feed.
  // This is the standard release/deploy-annotation pattern from metrics
  // dashboards (e.g. Grafana annotations): overlay a ship-date marker on the
  // metric chart so a real bump (or lack of one) can actually be read next
  // to the release that might explain it, rather than asking the reader to
  // cross-reference two dates by eye.
  //
  // Deliberately approximate, not exact-day: Sondrik logs download counts on
  // whatever days someone actually pulls a fresh one, not daily, so a
  // release that shipped between two checks has no bar of its own to sit on.
  // Attaching it to the next real check after it (rather than inventing an
  // interpolated point) keeps every marker tied to a real logged count, never
  // a fabricated one. A release with no later check yet (shipped after the
  // most recent one on file) gets no marker; there is nothing real to attach
  // it to until the next check is logged.
  //
  // Returns an array parallel to the sorted `checks` input: markers[i] is
  // the list of releases attached to checks[i], possibly empty. `checks` and
  // `releases` must already be real arrays (not wrapped in .metric/.releases),
  // and `checks` must already be sorted ascending by date, same contract
  // renderTraction's own `checks` variable already satisfies.
  function releaseMarkersForChecks(releases, checks) {
    const sortedChecks = (checks || []).filter(c => c && c.date);
    const markers = sortedChecks.map(() => []);
    const dated = (releases || [])
      .filter(r => r && r.date && isValidDateStr(r.date))
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date));
    dated.forEach(release => {
      const idx = sortedChecks.findIndex(c => c.date >= release.date);
      if (idx !== -1) markers[idx].push(release);
    });
    return markers;
  }

  return {
    daysBetween,
    addDays,
    isValidDateStr,
    BUGFIX_CHECKPOINTS,
    BUGFIX_CHECKPOINT_GRACE_DAYS,
    bugfixCheckinStatus,
    suggestedCheckCadence,
    computeReminders,
    releaseMarkersForChecks
  };
});

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

  return {
    daysBetween,
    addDays,
    isValidDateStr,
    BUGFIX_CHECKPOINTS,
    BUGFIX_CHECKPOINT_GRACE_DAYS,
    bugfixCheckinStatus
  };
});

/*
 * Pure "what needs Jack's attention right now" logic pulled out of app.js
 * so it can be required directly from a Node test (next-steps-core.test.js)
 * without loading the rest of the dashboard's DOM-touching code. Same
 * reasoning as goals-core.js/release-core.js/validate-core.js in this same
 * folder: this drives the Next Steps section and the header's attention
 * pill, both real, user-facing signals Jack looks at every visit, and until
 * now neither had any regression test.
 *
 * Every date/pace calculation this function needs (bugfixCheckinStatus,
 * currentMetricValue, computeGoalProgressPct, computeGoalPaceStatus,
 * findDuplicateLeads, isValidDateStr, daysBetween) is already implemented
 * and tested in release-core.js/goals-core.js/validate-core.js/app.js
 * itself, so this module takes them as injected dependencies rather than
 * re-implementing (and risking a second, drifting copy of) any of that
 * math. todayIsoStr and fmtDate are injected for the same determinism
 * reason release-core.js's bugfixCheckinStatus/computeReminders take them:
 * a test has to control "today" and the date format itself rather than
 * reading the real clock or locale.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SondrikNextStepsCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  function computeNextSteps(data, deps) {
    const {
      releasesData, downloadsData, leadsData, goalsData, channelsData, changelogStatusData
    } = data || {};
    const {
      todayIsoStr, fmtDate, staleAfterDays, agingAfterDays,
      bugfixCheckinStatus, currentMetricValue, computeGoalProgressPct, computeGoalPaceStatus,
      findDuplicateLeads, isValidDateStr, daysBetween
    } = deps;

    const steps = [];

    // The one validate.js warning most directly tied to the real 2026-09-17
    // trust incident this changelog section exists to guard against, and
    // previously the one warning with no on-page signal at all: Jack would
    // only find out the changelog had drifted by running the CLI validator
    // himself. Urgent, since a drifted changelog is actively showing
    // something untrustworthy, not just an unfilled field.
    if (changelogStatusData && changelogStatusData.drifted) {
      steps.push({
        urgent: true,
        text: 'The data changelog is out of sync with real git history (' + changelogStatusData.recordedCount +
          ' recorded vs ' + changelogStatusData.realCount + ' real commits), run ' +
          'node public/sondrik/data/changelog.js to refresh it.',
        href: '#changelogSection'
      });
    }

    const releases = (releasesData && releasesData.releases) || [];
    const undatedReleases = releases.filter(r => !r.date);
    if (undatedReleases.length > 0) {
      steps.push({
        urgent: false,
        text: 'Log the ship date for ' +
          (undatedReleases.length === 1 ? 'v' + undatedReleases[0].version : undatedReleases.length + ' releases') +
          ', no date is on record.',
        href: '#releaseSection'
      });
    }

    const datedReleases = releases.filter(r => r.date).slice().sort((a, b) => b.date.localeCompare(a.date));
    if (datedReleases.length > 0) {
      const checkinStatus = bugfixCheckinStatus(datedReleases[0], todayIsoStr, fmtDate);
      if (checkinStatus && (checkinStatus.tier === 'due' || checkinStatus.tier === 'missed')) {
        steps.push({
          urgent: true,
          text: 'v' + datedReleases[0].version + ': ' + checkinStatus.text.charAt(0).toLowerCase() + checkinStatus.text.slice(1) + '.',
          href: '#releaseSection'
        });
      }
    }

    const leads = (leadsData && leadsData.leads) || [];

    // Same "no real date logged" gap as undatedReleases above, for the other
    // record type that carries a real date field: a lead with loggedDate
    // null already renders under the Timeline's "no date on record" list,
    // but that section is easy to miss, and nothing previously surfaced it
    // as an actual next action the way an undated release already did.
    const undatedLeads = leads.filter(l => !l.loggedDate);
    if (undatedLeads.length > 0) {
      steps.push({
        urgent: false,
        text: 'Log the real date ' +
          (undatedLeads.length === 1
            ? (undatedLeads[0].sourceDetail || undatedLeads[0].source || 'this lead') + ' actually came in'
            : undatedLeads.length + ' leads actually came in') +
          ', no date is on record.',
        href: '#leadsSection'
      });
    }

    leads.forEach(l => {
      const o = l.outreach || {};
      if (!o.sent && o.approvalStatus === 'awaiting-approval') {
        steps.push({
          urgent: true,
          text: 'Approve or send the drafted message to ' + (l.sourceDetail || l.source || 'this lead') + '.',
          href: '#leadsSection'
        });
        if (!o.draftText) {
          steps.push({
            urgent: false,
            text: 'Paste the actual drafted text for ' + (l.sourceDetail || l.source || 'this lead') +
              ' into outreach.draftText so it can be previewed on this page before approving it.',
            href: '#leadsSection'
          });
        }
      }
    });

    const metric = (downloadsData && downloadsData.metric) || {};
    const checks = (metric.checks || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    if (checks.length === 0) {
      steps.push({
        urgent: false,
        text: 'Log a first download check in downloads.json once you have a real count to record.',
        href: '#tractionSection'
      });
    } else {
      const latest = checks[checks.length - 1];
      const ageDays = daysBetween(latest.date, todayIsoStr);
      if (ageDays > staleAfterDays) {
        steps.push({
          urgent: true,
          text: 'Pull a fresh ' + (metric.label || 'download') + ' count, the last one logged is ' + ageDays + ' days old.',
          href: '#tractionSection'
        });
      } else if (ageDays > agingAfterDays) {
        steps.push({
          urgent: false,
          text: 'The last ' + (metric.label || 'download') + ' count is ' + ageDays + ' days old, plan to pull a fresh one soon before it goes stale.',
          href: '#tractionSection'
        });
      }
      if (!metric.source) {
        steps.push({
          urgent: false,
          text: 'Cite a source for the ' + (metric.label || 'download') + ' count, an uncited number reads as an estimate.',
          href: '#tractionSection'
        });
      }

      // Same real data-quality gap validate.js already warns on (a
      // cumulative GitHub release download count that reads lower than the
      // check before it almost always means a transposed digit or the wrong
      // number pasted in, not a real drop), but that check previously only
      // ever ran from the command line. This is the exact number the
      // snapshot strip and Traction section currently show as fact, so a
      // regression here is urgent rather than a background nit, same
      // reasoning as the changelog-drift item above.
      const regressions = checks.filter((c, idx) => idx > 0 && c.count < checks[idx - 1].count);
      if (regressions.length > 0) {
        steps.push({
          urgent: true,
          text: (regressions.length === 1
            ? 'The ' + fmtDate(regressions[0].date) + ' check (' + regressions[0].count + ')'
            : regressions.length + ' checks') +
            ' logged a lower ' + (metric.label || 'download') + ' count than the check before it, a real ' +
            'cumulative count should not go down, check for a typo.',
          href: '#tractionSection'
        });
      }
    }

    const channels = (channelsData && channelsData.channels) || [];
    const unexplainedGaps = channels.filter(c => c.status === 'not-tracked' && !c.note);
    if (unexplainedGaps.length > 0) {
      steps.push({
        urgent: false,
        text: 'Add a note explaining why ' +
          (unexplainedGaps.length === 1 ? (unexplainedGaps[0].name || 'this channel') + ' is' : unexplainedGaps.length + ' channels are') +
          ' not tracked yet, an unexplained gap reads as an oversight.',
        href: '#channelsSection'
      });
    }

    // Same gap validate.js already warns on: a channel marked "tracked" with
    // no linkedMetric wired up renders identically to a tracked channel that
    // just has no data logged yet (both fall through to "No number logged
    // yet." in renderChannels' linkedValue), so without this the wiring gap
    // itself was invisible on the page, only ever caught by running the CLI.
    const unwiredTracked = channels.filter(c => c.status === 'tracked' && !c.linkedMetric);
    if (unwiredTracked.length > 0) {
      steps.push({
        urgent: false,
        text: 'Wire up a linkedMetric (downloads or leads) for ' +
          (unwiredTracked.length === 1 ? (unwiredTracked[0].name || 'this channel') : unwiredTracked.length + ' channels') +
          ' marked tracked, without one there is nothing real to display for it.',
        href: '#channelsSection'
      });
    }

    const goals = (goalsData && goalsData.goals) || [];
    if (goals.length === 0) {
      steps.push({
        urgent: false,
        text: 'Set a real target in goals.json once there is one worth tracking against.',
        href: '#goalsSection'
      });
    }

    // The Goals card already computes both of these (see renderGoals: the
    // "TARGET DATE PASSED" pace line and the BEHIND PACE tier from
    // computeGoalPaceStatus), but only ever showed them to someone who
    // scrolled down to that card. Same consolidation this function already
    // does for the stale-check and missed-checkin signals above, applied to
    // the one real goal now on record. Skips an already-met goal entirely,
    // "reached its target late" isn't an open action.
    goals.forEach(g => {
      const current = currentMetricValue(g.metric, downloadsData, leadsData);
      const currentCount = current ? current.count : 0;
      const pct = computeGoalProgressPct(g.target, currentCount);
      const achieved = g.target > 0 && currentCount >= g.target;
      if (achieved) return;

      if (g.targetDate && isValidDateStr(g.targetDate) && daysBetween(todayIsoStr, g.targetDate) < 0) {
        steps.push({
          urgent: true,
          text: '"' + g.label + '" target date has passed (' + fmtDate(g.targetDate) + '), ' +
            currentCount + ' of ' + g.target + ' reached, revise the target or the date.',
          href: '#goalsSection'
        });
      } else if (current) {
        const paceStatus = computeGoalPaceStatus(g.setDate, g.targetDate, pct, todayIsoStr);
        if (paceStatus && paceStatus.tier === 'behind') {
          steps.push({
            urgent: false,
            text: '"' + g.label + '" is behind pace, ' + pct + '% reached vs an expected ~' +
              paceStatus.expectedPct + '% by now.',
            href: '#goalsSection'
          });
        }
      }
    });

    const duplicateLeadGroups = findDuplicateLeads(leads);
    if (duplicateLeadGroups.length > 0) {
      const dupCount = duplicateLeadGroups.reduce((n, g) => n + g.length, 0);
      steps.push({
        urgent: false,
        text: dupCount + ' leads look like the same real contact logged twice (matched on channel + source detail), check before counting both.',
        href: '#leadsSection'
      });
    }

    steps.sort((a, b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0));
    return steps;
  }

  return { computeNextSteps };
});

(function () {
  const timelineSection = document.getElementById('timelineSection');
  const releaseSection = document.getElementById('releaseSection');
  const tractionSection = document.getElementById('tractionSection');
  const goalsSection = document.getElementById('goalsSection');
  const channelsSection = document.getElementById('channelsSection');
  const leadsSection = document.getElementById('leadsSection');
  const changelogSection = document.getElementById('changelogSection');
  const snapshotStrip = document.getElementById('snapshotStrip');
  const nextStepsList = document.getElementById('nextStepsList');
  const csvBtn = document.getElementById('csvBtn');
  const releasesCsvBtn = document.getElementById('releasesCsvBtn');
  const leadsCsvBtn = document.getElementById('leadsCsvBtn');
  const channelsCsvBtn = document.getElementById('channelsCsvBtn');
  const copyStatusBtn = document.getElementById('copyStatusBtn');
  const copyPublicBtn = document.getElementById('copyPublicBtn');
  const copyStatusLive = document.getElementById('copyStatusLive');
  const attentionPill = document.getElementById('attentionPill');
  const newSincePill = document.getElementById('newSincePill');
  const lastUpdatedSub = document.getElementById('lastUpdatedSub');
  const printBtn = document.getElementById('printBtn');
  const backupBtn = document.getElementById('backupBtn');
  const icsBtn = document.getElementById('icsBtn');
  const pageFavicon = document.getElementById('pageFavicon');
  const DEFAULT_FAVICON_HREF = pageFavicon ? pageFavicon.getAttribute('href') : null;

  printBtn.addEventListener('click', () => window.print());

  // "New since your last visit" is a per-browser convenience, not a second
  // copy of any real fact: it only compares real logged dates already on the
  // page (releases, download checks, leads, goals) against a plain date
  // this same browser saw on a previous page load. localStorage can be
  // unavailable (private browsing, blocked site data) or throw, so every
  // access is wrapped and the feature just silently doesn't appear rather
  // than breaking the page.
  const LAST_VISIT_KEY = 'sondrik:lastVisitDate';
  function safeStorageGet(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }
  function safeStorageSet(key, value) {
    try { localStorage.setItem(key, value); } catch { /* ignore */ }
  }

  // Shared read of "how old is a real logged date" used by the traction
  // freshness badge, the header's last-updated line, and the next-steps
  // checklist, so all three agree on the same thresholds instead of each
  // hardcoding its own copy that could drift out of sync if ever retuned.
  // AGING gives a heads-up a few days before STALE actually blocks anything:
  // the two real checks logged so far were 3 days apart, so a reader gets a
  // quiet nudge partway through that real cadence rather than being told
  // "STALE" the moment day 8 arrives with no warning.
  const STALE_AFTER_DAYS = 7;
  const AGING_AFTER_DAYS = 4;

  // Round-number milestones a reader would naturally watch for as the real
  // download count grows, independent of goals.json (which stays empty
  // until Jack sets an actual target). Purely a derived read of the real
  // logged counts against a fixed, generic sequence, never a claim specific
  // to Sondrik, so it adds no fact beyond "this many downloads happened".
  // Used both to flag which check first crossed a milestone (in the
  // timeline) and how far the latest count sits from the next one (in
  // Traction).
  const DOWNLOAD_MILESTONES = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000];

  function nextMilestone(count) {
    const m = DOWNLOAD_MILESTONES.find(v => v > count);
    return m === undefined ? null : m;
  }

  // Which milestones a check newly crossed versus the check before it. A
  // null prevCount (the very first check on record) is treated as below
  // every milestone rather than as zero, so a first check logged already at
  // a nonzero count still credits it with every milestone up to that count.
  function milestonesCrossed(prevCount, count) {
    const lowerBound = (prevCount === null || prevCount === undefined) ? -1 : prevCount;
    return DOWNLOAD_MILESTONES.filter(m => m > lowerBound && m <= count);
  }

  // div.textContent/innerHTML round-trip only escapes &amp;/&lt;/&gt; in text
  // content, not quotes, so a hand-typed value with a " or ' in it (a channel
  // id, a lead field) could break out of an attribute like value="..." or
  // data-foo="...". Same regex-based escape CGT and Garage already use for
  // exactly that reason.
  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function fmtDate(iso) {
    if (!iso) return null;
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // An empty state that just says "add one to whatever.json" is a dead end,
  // the quick-log tool that builds that exact JSON already exists further
  // up the page but stays collapsed and easy to miss. This turns each empty
  // state into a real CTA surface: it opens the <details>, scrolls the
  // matching form into view, and focuses its first field. Delegated on
  // document since the empty-state buttons are re-created on every render.
  function openQuickLogForm(formId) {
    const details = document.getElementById('quickLogTool');
    const form = document.getElementById(formId);
    if (!details || !form) return;
    details.open = true;
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const firstField = form.querySelector('input, select, textarea');
    if (firstField) firstField.focus();
  }
  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-open-quick-log]');
    if (btn) openQuickLogForm(btn.getAttribute('data-open-quick-log'));
  });

  function emptyStateCta(formId, label) {
    return '<button type="button" class="print-btn empty-state-cta" data-open-quick-log="' +
      escapeHtml(formId) + '">' + escapeHtml(label) + '</button>';
  }

  function daysBetween(a, b) {
    return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
  }

  // Local calendar date arithmetic to match daysBetween/todayIso above,
  // used by the check-in cadence estimate to project a suggested next
  // check date from a real logged one plus a real gap.
  function addDays(iso, days) {
    const d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // Local calendar date as YYYY-MM-DD. daysBetween (like CSM's daysUntil)
  // parses logged dates as local midnight, so "today" has to match that or
  // every comparison drifts. new Date().toISOString().slice(0, 10) instead
  // reads the UTC calendar date, which rolls over to tomorrow while it is
  // still today in any timezone behind UTC, so a check logged "today" would
  // read as "1 day ago" for the rest of the evening, local time.
  function todayIso() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // Same "N days ago" phrasing the download freshness badge already uses,
  // applied to any other real logged date so recency reads consistently
  // across the page instead of leaving a reader to do the date math.
  function relativeDaysLabel(iso) {
    if (!iso) return null;
    const age = daysBetween(iso, todayIso());
    if (age < 0) return null;
    if (age === 0) return 'today';
    if (age === 1) return '1 day ago';
    return age + ' days ago';
  }

  // Merges the three data files into one chronological narrative. Indie/solo
  // founder dashboards commonly surface a unified activity timeline rather
  // than making a reader cross-reference separate per-topic sections to
  // reconstruct "what happened when"; this reuses the same real records,
  // it does not add any new fact.
  function renderTimeline(releasesData, downloadsData, leadsData, goalsData) {
    const KIND_LABEL = { release: 'RELEASE', check: 'DOWNLOAD CHECK', lead: 'LEAD', goal: 'GOAL SET' };
    const events = [];
    (releasesData.releases || []).forEach(r => {
      events.push({ date: r.date, kind: 'release', title: 'v' + r.version + ' shipped', detail: r.summary || null });
    });
    const metric = downloadsData.metric || {};
    const sortedChecks = (metric.checks || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    sortedChecks.forEach((c, idx) => {
      const prevCount = idx > 0 ? sortedChecks[idx - 1].count : null;
      const crossed = milestonesCrossed(prevCount, c.count);
      events.push({
        date: c.date,
        kind: 'check',
        title: c.count + ' ' + (metric.label || 'downloads') + ' logged',
        detail: c.note || null,
        milestone: crossed.length ? crossed : null
      });
    });
    (leadsData.leads || []).forEach(l => {
      events.push({ date: l.loggedDate, kind: 'lead', title: l.sourceDetail || l.source || 'Lead logged', detail: l.summary || null });
    });
    ((goalsData && goalsData.goals) || []).forEach(g => {
      events.push({ date: g.setDate, kind: 'goal', title: g.label + ' target set (' + g.target + ')', detail: g.note || null });
    });

    const dated = events.filter(e => e.date).sort((a, b) => b.date.localeCompare(a.date));
    const undated = events.filter(e => !e.date);

    if (dated.length === 0 && undated.length === 0) {
      timelineSection.innerHTML = '<div class="empty-state">No events logged yet.</div>';
      return;
    }

    // Only compares against a real previous visit, never against "today" or
    // an assumed date: on the very first-ever visit (nothing saved yet)
    // nothing is marked new, since flagging every pre-existing item as new
    // the first time someone opens the page would be noise, not signal.
    const previousVisitDate = safeStorageGet(LAST_VISIT_KEY);
    const newCount = previousVisitDate
      ? dated.filter(e => e.date > previousVisitDate).length
      : 0;
    safeStorageSet(LAST_VISIT_KEY, todayIso());

    if (newCount > 0) {
      newSincePill.hidden = false;
      newSincePill.textContent = newCount + (newCount === 1 ? ' update' : ' updates') +
        ' since your last visit (' + fmtDate(previousVisitDate) + ')';
    } else {
      newSincePill.hidden = true;
    }

    function itemHtml(e) {
      const isNew = previousVisitDate && e.date && e.date > previousVisitDate;
      return '<li class="timeline-item timeline-kind-' + e.kind + '">' +
        '<div class="timeline-meta">' +
        '<span class="timeline-badge font-mono">' + KIND_LABEL[e.kind] + '</span>' +
        (e.date
          ? '<span class="timeline-date font-mono">' + fmtDate(e.date) + '</span>'
          : '<span class="timeline-date timeline-date-unknown font-mono">DATE NOT LOGGED</span>') +
        (isNew ? '<span class="timeline-new-badge font-mono">NEW</span>' : '') +
        (e.milestone ? '<span class="timeline-milestone-badge font-mono" title="First real check to reach this round-number count">' +
          escapeHtml('MILESTONE: ' + e.milestone.join(', ')) + '</span>' : '') +
        '</div>' +
        '<div class="timeline-title">' + escapeHtml(e.title) + '</div>' +
        (e.detail ? '<div class="timeline-detail">' + escapeHtml(e.detail) + '</div>' : '') +
        '</li>';
    }

    let html = '<ol class="timeline" aria-label="Chronological history of releases, download checks, and leads, most recent first">' +
      dated.map(itemHtml).join('') + '</ol>';
    if (undated.length > 0) {
      html += '<div class="timeline-undated-label font-mono">Logged, no date on record</div>' +
        '<ul class="timeline timeline-undated" aria-label="Events with no date logged yet">' +
        undated.map(itemHtml).join('') + '</ul>';
    }
    timelineSection.innerHTML = html;
  }

  // A glanceable top-of-page strip of the real headline numbers already
  // computed elsewhere on the page (latest download count, leads logged,
  // days since the last release), so a visitor gets the current state in
  // one look instead of scrolling every section to piece it together.
  // Downloads and leads come from unrelated channels (GitHub releases vs.
  // a Reddit comment) with no confirmed link between them, they are shown
  // as independent facts side by side, never as a funnel one feeds into
  // the next.
  function renderSnapshot(releasesData, downloadsData, leadsData) {
    const chips = [];

    const metric = (downloadsData && downloadsData.metric) || {};
    const checks = (metric.checks || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    if (checks.length > 0) {
      const latest = checks[checks.length - 1];
      chips.push({
        number: String(latest.count),
        label: metric.label || 'downloads',
        meta: latest.date ? 'as of ' + fmtDate(latest.date) : 'no date logged'
      });
    } else {
      chips.push({ number: '0', label: metric.label || 'downloads', meta: 'no checks logged yet' });
    }

    const leads = (leadsData && leadsData.leads) || [];
    const pendingApproval = leads.filter(l => {
      const o = l.outreach || {};
      return !o.sent && o.approvalStatus === 'awaiting-approval';
    }).length;
    chips.push({
      number: String(leads.length),
      label: leads.length === 1 ? 'lead in the queue' : 'leads in the queue',
      meta: pendingApproval > 0
        ? pendingApproval + (pendingApproval === 1 ? ' draft awaiting approval' : ' drafts awaiting approval')
        : (leads.length > 0 ? 'no outreach pending' : 'none logged yet')
    });

    const dated = ((releasesData && releasesData.releases) || []).filter(r => r.date)
      .slice().sort((a, b) => b.date.localeCompare(a.date));
    if (dated.length > 0) {
      const latestRelease = dated[0];
      const age = Math.max(0, daysBetween(latestRelease.date, todayIso()));
      chips.push({
        number: String(age),
        label: (age === 1 ? 'day since v' : 'days since v') + latestRelease.version,
        meta: 'shipped ' + fmtDate(latestRelease.date)
      });
    } else {
      chips.push({ number: '-', label: 'days since last release', meta: 'no ship date logged yet' });
    }

    snapshotStrip.innerHTML = chips.map(c =>
      '<div class="snapshot-chip">' +
      '<div class="snapshot-chip-number font-display">' + escapeHtml(c.number) + '</div>' +
      '<div class="snapshot-chip-label">' + escapeHtml(c.label) + '</div>' +
      '<div class="snapshot-chip-meta">' + escapeHtml(c.meta) + '</div>' +
      '</div>'
    ).join('');
  }

  function renderReleases(data) {
    const releases = (data.releases || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    if (releases.length === 0) {
      releaseSection.innerHTML = '<div class="empty-state">No releases logged yet.' +
        emptyStateCta('quickReleaseForm', 'Log one now') + '</div>';
      return;
    }
    releaseSection.innerHTML = releases.map((r, idx) => {
      const rel = idx === 0 ? relativeDaysLabel(r.date) : null;
      const windowHtml = idx === 0 ? launchWindowHtml(r.date) : '';
      const checkinHtml = idx === 0 ? bugfixCheckinHtml(r) : '';
      return '<div class="release-card">' +
      '<span class="release-version font-display">v' + escapeHtml(r.version) + '</span>' +
      (r.date ? '<span class="release-date">' + fmtDate(r.date) +
        (rel ? ' <span class="release-relative font-mono">(' + rel + ')</span>' : '') + '</span>' : '') +
      (r.type ? '<span class="release-badge">' + escapeHtml(r.type).toUpperCase() + '</span>' : '') +
      '<div class="release-summary">' + escapeHtml(r.summary || 'No summary logged yet.') + '</div>' +
      windowHtml +
      checkinHtml +
      '</div>';
    }).join('');
  }

  // A shipped bugfix is only confirmed fixed once nothing regresses after it;
  // the common post-release practice is to tag the fix and re-check at 7 and
  // 14 days out to confirm it held (see the "revisit the affected metric 7
  // and 14 days later" pattern from post-release monitoring write-ups).
  // Purely a days-since-ship calculation off the real logged date, same
  // future/undated guards as launchWindowHtml, restricted to type "bugfix"
  // since a feature release has no "did the bug stay fixed" question to
  // answer at those checkpoints. Shared by the release card and the next
  // steps checklist below so both agree on the same tier at the same time.
  const BUGFIX_CHECKPOINTS = [7, 14];
  const BUGFIX_CHECKPOINT_GRACE_DAYS = 3;
  function bugfixCheckinStatus(release) {
    if (!release || release.type !== 'bugfix' || !release.date) return null;
    const days = daysBetween(release.date, todayIso());
    if (days < 0) return null;

    // A checkpoint whose grace window closes before the *next* checkpoint
    // arrives (true for 7, since 7+3=10 is before 14) used to just fall
    // through this loop unrecorded: past day 10 with no check-in logged,
    // this jumped straight to treating the 14-day checkpoint as "upcoming"
    // with no trace that the 7-day one was ever due, let alone missed.
    // There's no persisted "confirmed" flag in releases.json (a check-in is
    // just Jack looking and seeing nothing new), so the only honest signal
    // available here is "its grace window closed without this function ever
    // getting to report it as due" -- tracked in missedCheckpoints and
    // surfaced instead of silently dropped.
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

  function bugfixCheckinHtml(release) {
    const status = bugfixCheckinStatus(release);
    if (!status) return '';
    return '<div class="bugfix-checkin bugfix-checkin-' + status.tier + ' font-mono">' +
      escapeHtml(status.text.toUpperCase()) + '</div>';
  }

  // Where the latest real release sits against the 30/60/90-day post-launch
  // windows early-stage products are commonly evaluated against (see the
  // "first 30/60/90 days" framing traction dashboards use). Purely a
  // time-since-ship calculation off the real logged ship date, it states no
  // benchmark or judgment about whether the real numbers elsewhere on the
  // page are good or bad for that window, only which window today falls in.
  // Skipped for an undated release (no real ship date to measure from) or a
  // future-dated one (a typo, not a real elapsed span).
  function launchWindowHtml(shipDateIso) {
    if (!shipDateIso) return '';
    const days = daysBetween(shipDateIso, todayIso());
    if (days < 0) return '';
    const cappedDays = Math.min(days, 90);
    const pct = Math.round((cappedDays / 90) * 100);
    const windowLabel = days <= 30 ? '0-30 day window since ship'
      : days <= 60 ? '30-60 day window since ship'
      : days <= 90 ? '60-90 day window since ship'
      : 'past the 90-day window since ship';
    const dayLabel = 'Day ' + days;
    return '<div class="launch-window">' +
      '<div class="launch-window-label font-mono">' + escapeHtml((dayLabel + ', ' + windowLabel).toUpperCase()) + '</div>' +
      '<div class="launch-window-track" role="img" aria-label="' +
      escapeHtml(dayLabel + ' since ship, in the ' + windowLabel) + '">' +
      '<div class="launch-window-fill" style="width:' + pct + '%"></div>' +
      '<span class="launch-window-tick" style="left:33.33%"></span>' +
      '<span class="launch-window-tick" style="left:66.66%"></span>' +
      '</div>' +
      '<div class="launch-window-marks font-mono" aria-hidden="true"><span>0</span><span>30</span><span>60</span><span>90+</span></div>' +
      '</div>';
  }

  // Shared "how long between real check-ins on average, and when's the next
  // one due" calculation, used both by the cadence line in the Traction
  // section below and by the calendar reminders export, so the two can never
  // state two different suggested next-check dates off the same real gaps.
  // Needs at least two real checks (no gap exists off a single point).
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

  function renderTraction(data) {
    const metric = data.metric || {};
    const checks = (metric.checks || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    if (checks.length === 0) {
      tractionSection.innerHTML = '<div class="empty-state">No download checks logged yet.' +
        emptyStateCta('quickCheckForm', 'Log one now') + '</div>';
      return;
    }

    const latest = checks[checks.length - 1];
    const first = checks[0];
    const maxCount = Math.max(1, ...checks.map(c => c.count));

    let deltaHtml = '';
    let rateHtml = '';
    if (checks.length > 1) {
      const delta = latest.count - first.count;
      const span = daysBetween(first.date, latest.date);
      deltaHtml = '<div class="stat-delta">' + (delta >= 0 ? '+' : '') + delta +
        ' vs ' + fmtDate(first.date) + ' check (' + span + 'd earlier)</div>';
      // A derived helper metric, not a new fact: same two real checks, expressed as a
      // rate so a reader isn't left doing the division themselves.
      if (span > 0) {
        const perDay = delta / span;
        rateHtml = '<div class="stat-rate font-mono">~' + perDay.toFixed(1) + '/day over that span</div>';
      }
    }

    // How far the latest real count sits from the next round-number
    // milestone (see DOWNLOAD_MILESTONES above), a lighter-weight forward
    // reference than a goal that exists even with no real target set yet.
    let milestoneHtml = '';
    const nm = nextMilestone(latest.count);
    if (nm !== null) {
      const remaining = nm - latest.count;
      milestoneHtml = '<div class="stat-milestone font-mono">' + remaining + ' more to reach ' + nm + '</div>';
    }

    // Check-in cadence: a forward-looking companion to the freshness badge
    // below. Freshness only says how old the latest check is against a
    // fixed 4/7-day threshold; this instead projects a suggested next check
    // date from the real gap(s) between Jack's own past checks, so early on
    // (when there's only ever been one real gap) it reads as "based on your
    // only check-in gap so far" rather than implying an established rhythm
    // it hasn't earned yet.
    let cadenceHtml = '';
    const cadence = suggestedCheckCadence(data);
    if (cadence) {
      const gapBasis = cadence.gapCount === 1
        ? 'your only check-in gap so far (' + cadence.avgGap + (cadence.avgGap === 1 ? ' day' : ' days') + ')'
        : 'the average of your last ' + cadence.gapCount + ' check-in gaps (~' + cadence.avgGap + (cadence.avgGap === 1 ? ' day' : ' days') + ')';
      const daysUntilNext = daysBetween(todayIso(), cadence.nextDate);
      let dueLabel;
      if (daysUntilNext > 0) {
        dueLabel = 'next check suggested in ' + daysUntilNext + (daysUntilNext === 1 ? ' day' : ' days') + ' (' + fmtDate(cadence.nextDate) + ')';
      } else if (daysUntilNext === 0) {
        dueLabel = 'next check suggested today (' + fmtDate(cadence.nextDate) + ')';
      } else {
        const overdueDays = -daysUntilNext;
        dueLabel = 'suggested check was ' + overdueDays + (overdueDays === 1 ? ' day' : ' days') + ' ago (' + fmtDate(cadence.nextDate) + ')';
      }
      cadenceHtml = '<div class="stat-cadence font-mono" title="Based on ' + escapeHtml(gapBasis) + '">' + escapeHtml(dueLabel) + '</div>';
    }

    const ageDays = daysBetween(latest.date, todayIso());
    const isStale = ageDays > STALE_AFTER_DAYS;
    const isAging = !isStale && ageDays > AGING_AFTER_DAYS;
    const ageLabel = ageDays <= 0 ? 'checked today' : ageDays === 1 ? 'checked 1 day ago' : 'checked ' + ageDays + ' days ago';
    const freshnessTier = isStale ? 'freshness-stale' : isAging ? 'freshness-aging' : 'freshness-fresh';
    const freshnessHtml = '<div class="freshness-badge ' + freshnessTier + ' font-mono">' +
      (isStale ? 'STALE, ' : isAging ? 'AGING, ' : '') + ageLabel.toUpperCase() +
      (isStale ? ', RE-CHECK GITHUB API' : isAging ? ', CHECK AGAIN SOON' : '') +
      '</div>';

    // The gap note between two bars should reflect the real span between those
    // two specific checks, not a fixed claim, since consecutive daily checks
    // (gap of exactly 1 day) do have daily tracking between them.
    const barsHtml = checks.map((c, i) => {
      const heightPct = c.count === 0 ? 0 : Math.max(4, Math.round((c.count / maxCount) * 100));
      let gapNote = '';
      if (i > 0) {
        const gap = daysBetween(checks[i - 1].date, c.date);
        if (gap > 1) {
          gapNote = '<span class="compare-gap-note" aria-hidden="true">' + gap + ' days between checks, no daily tracking</span>';
        }
      }
      return gapNote + '<div class="compare-bar-col">' +
        '<span class="compare-bar-count font-mono">' + c.count + '</span>' +
        '<div class="compare-bar" style="height:70px">' +
        '<div class="compare-bar-fill" style="height:' + heightPct + '%"></div>' +
        '</div>' +
        '<span class="compare-bar-date">' + fmtDate(c.date) + '</span>' +
        '</div>';
    }).join('');

    // The bars are decorative only, aria-hidden, since a screen reader user
    // gets the same numbers (and the exact dates, which the bars round off
    // visually) from the chartSummary sentence and the linked data table.
    const chartSummary = checks.map(c => fmtDate(c.date) + ': ' + c.count).join(', ');
    const tableRowsHtml = checks.map(c =>
      '<tr><th scope="row">' + fmtDate(c.date) + '</th><td>' + c.count +
      (c.note ? ' - ' + escapeHtml(c.note) : '') + '</td></tr>'
    ).join('');

    tractionSection.innerHTML =
      '<div class="stat-tile">' +
      '<div class="stat-number-block">' +
      '<div class="stat-number font-display">' + latest.count + '</div>' +
      '<div class="stat-label">' + escapeHtml(metric.label || 'downloads') + '</div>' +
      deltaHtml +
      rateHtml +
      milestoneHtml +
      freshnessHtml +
      cadenceHtml +
      (metric.source ? '<div class="stat-source">' + escapeHtml(metric.source).toUpperCase() + '</div>' : '') +
      '</div>' +
      // role="group" is required for aria-label to take effect here: a plain
      // div's implicit role ("generic") prohibits an author-supplied name,
      // so without it screen readers silently drop this label when the
      // wrapper receives keyboard focus (axe-core: aria-prohibited-attr).
      '<div class="chart-scroll" tabindex="0" role="group" aria-label="' +
        escapeHtml('Scrollable ' + (metric.label || 'download') + ' history chart') + '">' +
      '<div class="compare-bars" role="img" aria-label="' +
        escapeHtml((metric.label || 'Download') + ' history by check date: ' + chartSummary) + '">' +
        barsHtml +
      '</div>' +
      '</div>' +
      '</div>' +
      '<table class="sr-only-table">' +
      '<caption>' + escapeHtml(metric.label || 'downloads') + ', full check history</caption>' +
      '<thead><tr><th scope="col">Check date</th><th scope="col">Count</th></tr></thead>' +
      '<tbody>' + tableRowsHtml + '</tbody>' +
      '</table>' +
      (metric.scope ? '<div class="scope-note">' + escapeHtml(metric.scope) + '</div>' : '');

    initChartScrollShadow();
  }

  // Same fade-edge cue CGT/Garage use on their fixed-min-width tables,
  // applied to the download chart, whose width grows with every logged
  // check and has no other visual hint that it scrolls once it no longer
  // fits.
  function initChartScrollShadow() {
    const wrap = tractionSection.querySelector('.chart-scroll');
    if (!wrap) return;
    const update = () => {
      const maxScrollLeft = wrap.scrollWidth - wrap.clientWidth;
      wrap.classList.toggle('can-scroll-left', wrap.scrollLeft > 1);
      wrap.classList.toggle('can-scroll-right', wrap.scrollLeft < maxScrollLeft - 1);
    };
    wrap.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();
  }

  // Looks up the real current value behind a goal's target. Only "downloads"
  // and "leads" have real numbers behind them so far (see VALID_GOAL_METRICS
  // in validate.js); any other metric name would have nothing real to
  // compare the target against, so this returns null rather than guessing
  // at zero.
  function currentMetricValue(metricName, downloadsData, leadsData) {
    if (metricName === 'downloads') {
      const metric = (downloadsData && downloadsData.metric) || {};
      const checks = (metric.checks || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      if (checks.length === 0) return null;
      const latest = checks[checks.length - 1];
      return { count: latest.count, asOf: latest.date };
    }
    if (metricName === 'leads') {
      // Total real leads logged so far, same count the Channels section
      // already shows per-channel. asOf is the most recently logged lead's
      // date, or null if none of them have a real loggedDate yet, rather
      // than defaulting to today and implying a freshness that isn't real.
      const leads = (leadsData && leadsData.leads) || [];
      if (leads.length === 0) return null;
      const dates = leads.map(l => l.loggedDate).filter(Boolean).sort();
      return { count: leads.length, asOf: dates.length ? dates[dates.length - 1] : null };
    }
    return null;
  }

  // The real per-day rate between the first and latest logged download check,
  // the same two checks the traction section's own rateHtml already divides.
  // Needs at least two real checks (no rate exists off a single point) and a
  // positive span (guards the same same-day-typo case daysBetween elsewhere
  // has to guard). Downloads-only: a goal against "leads" has no comparable
  // trend to divide, just one real Reddit comment logged so far, not a
  // history of checks.
  function downloadsPerDayRate(downloadsData) {
    const metric = (downloadsData && downloadsData.metric) || {};
    const checks = (metric.checks || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    if (checks.length < 2) return null;
    const first = checks[0];
    const latest = checks[checks.length - 1];
    const span = daysBetween(first.date, latest.date);
    if (span <= 0) return null;
    return { perDay: (latest.count - first.count) / span, first, latest };
  }

  // The real date a now-met goal actually crossed its target, derived only
  // from dates already logged elsewhere, never estimated. For downloads,
  // that's the first real check whose count reached the target. For leads,
  // it's the loggedDate of the Nth lead once leads are ordered by that same
  // real date, and only if every lead up to that point actually has one, an
  // undated lead earlier in the queue could put the real crossing point
  // anywhere, so this returns null (an honest "reached, exact date unknown")
  // rather than guess an ordering that isn't backed by real logged dates.
  function goalReachedDate(g, downloadsData, leadsData) {
    if (g.metric === 'downloads') {
      const checks = (((downloadsData && downloadsData.metric) || {}).checks || [])
        .slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      const hit = checks.find(c => c.count >= g.target && c.date);
      return hit ? hit.date : null;
    }
    if (g.metric === 'leads') {
      const leads = (leadsData && leadsData.leads) || [];
      if (leads.length < g.target || leads.some(l => !l.loggedDate)) return null;
      const sorted = leads.slice().sort((a, b) => a.loggedDate.localeCompare(b.loggedDate));
      return sorted[g.target - 1].loggedDate;
    }
    return null;
  }

  // Renders the real target-vs-actual goal Jack has logged, if any. This is
  // the standard "target vs actual" pattern from traction dashboards: a
  // benchmark, how the current real number compares to it, and a trend cue
  // (days left) for whether it's on track, at risk, or overdue. An empty
  // goals.json (the honest default until Jack sets a real target) renders
  // as a plain empty state rather than a fabricated placeholder goal.
  function renderGoals(goalsData, downloadsData, leadsData) {
    const goals = (goalsData && goalsData.goals) || [];
    if (goals.length === 0) {
      goalsSection.innerHTML = '<div class="empty-state">No goal set yet. Add one to ' +
        '<code>public/sondrik/data/goals.json</code> once there is a real target to track against.' +
        emptyStateCta('quickGoalForm', 'Log one now') + '</div>';
      return;
    }
    goalsSection.innerHTML = goals.map(g => {
      const current = currentMetricValue(g.metric, downloadsData, leadsData);
      const currentCount = current ? current.count : 0;
      // A target of 0 (or a negative typo) would otherwise divide out to
      // NaN/Infinity here, which Math.max/min don't clamp away, so guard it
      // explicitly rather than rendering "NaN%".
      const pct = g.target > 0 ? Math.max(0, Math.min(100, Math.round((currentCount / g.target) * 100))) : 0;
      const achieved = g.target > 0 && currentCount >= g.target;

      // Once the real number has actually reached the target, "3 days left"
      // or "ahead of pace" reads as if the goal were still in progress. Show
      // a plain "goal met" fact instead, dated from real history where that's
      // derivable (see goalReachedDate above), and skip the still-in-progress
      // pace/projection lines below entirely rather than let them keep
      // narrating a race that's already over.
      let achievedHtml = '';
      if (achieved) {
        const reachedDate = goalReachedDate(g, downloadsData, leadsData);
        let text = 'GOAL MET';
        if (reachedDate) {
          text += ', REACHED ' + fmtDate(reachedDate).toUpperCase();
          if (g.targetDate) {
            const diffDays = daysBetween(reachedDate, g.targetDate);
            if (diffDays > 0) text += ' (' + diffDays + (diffDays === 1 ? ' DAY' : ' DAYS') + ' AHEAD OF THE ' + fmtDate(g.targetDate).toUpperCase() + ' TARGET DATE)';
            else if (diffDays < 0) text += ' (' + (-diffDays) + (diffDays === -1 ? ' DAY' : ' DAYS') + ' AFTER THE ' + fmtDate(g.targetDate).toUpperCase() + ' TARGET DATE)';
            else text += ' (ON THE TARGET DATE)';
          }
        } else {
          text += ', EXACT DATE NOT DERIVABLE FROM LOGGED DATA';
        }
        achievedHtml = '<div class="goal-achieved font-mono">' + text + '</div>';
      }

      let paceHtml = '';
      if (!achieved && g.targetDate) {
        const daysLeft = daysBetween(todayIso(), g.targetDate);
        if (daysLeft < 0) {
          paceHtml = '<div class="goal-pace goal-pace-overdue font-mono">TARGET DATE PASSED, ' + fmtDate(g.targetDate).toUpperCase() + '</div>';
        } else {
          const daysLeftLabel = daysLeft === 0 ? 'DUE TODAY' : daysLeft === 1 ? '1 DAY LEFT' : daysLeft + ' DAYS LEFT';
          paceHtml = '<div class="goal-pace font-mono">' + daysLeftLabel + ', BY ' + fmtDate(g.targetDate).toUpperCase() + '</div>';
        }
      }

      // Compares actual progress to how much of the goal's own timeframe has
      // elapsed (e.g. 40% of the days gone but only 10% of the target hit is
      // a real behind-pace signal, not just a raw percent-of-target number).
      // Only rendered once there is a real logged value for the metric
      // (current, not just currentCount defaulting to 0) so an unlogged
      // metric never reads as "behind pace" when it might just be untracked.
      let paceStatusHtml = '';
      if (!achieved && current && g.setDate && g.targetDate) {
        const totalDays = daysBetween(g.setDate, g.targetDate);
        const elapsedDays = daysBetween(g.setDate, todayIso());
        if (totalDays > 0 && elapsedDays > 0) {
          const expectedPct = Math.round((Math.min(elapsedDays, totalDays) / totalDays) * 100);
          const diff = pct - expectedPct;
          const tier = diff <= -10 ? 'behind' : diff >= 10 ? 'ahead' : 'on';
          const label = tier === 'behind' ? 'BEHIND PACE' : tier === 'ahead' ? 'AHEAD OF PACE' : 'ON PACE';
          paceStatusHtml = '<div class="goal-pace-status goal-pace-status-' + tier + ' font-mono" ' +
            'title="Based on ' + elapsedDays + ' of ' + totalDays + ' days elapsed, expected roughly ' + expectedPct + '% by now">' +
            label + ' (EXPECTED ~' + expectedPct + '%)</div>';
        }
      }

      // A second, independent forward-look from paceStatusHtml above: that one
      // compares progress to elapsed time against a targetDate, this instead
      // projects an ETA straight from the real download trend, so it still
      // has something to say for an open-ended goal with no targetDate at
      // all. Only shown once the goal is not already met (pct reaching 100%
      // above already says that) and only for a positive real rate, since
      // dividing by a flat or negative one would produce a meaningless or
      // negative "days needed".
      let projectionHtml = '';
      if (g.metric === 'downloads' && currentCount < g.target) {
        const rate = downloadsPerDayRate(downloadsData);
        if (rate && rate.perDay > 0) {
          const daysNeeded = Math.ceil((g.target - currentCount) / rate.perDay);
          const projectedDate = addDays(rate.latest.date, daysNeeded);
          projectionHtml = '<div class="goal-projection font-mono" title="Based on ~' + rate.perDay.toFixed(1) +
            '/day between ' + fmtDate(rate.first.date) + ' and ' + fmtDate(rate.latest.date) + '">' +
            'AT CURRENT PACE (~' + rate.perDay.toFixed(1) + '/DAY), TARGET AROUND ' + fmtDate(projectedDate).toUpperCase() +
            ' (~' + daysNeeded + (daysNeeded === 1 ? ' DAY' : ' DAYS') + ')</div>';
        } else if (rate) {
          projectionHtml = '<div class="goal-projection goal-projection-flat font-mono">' +
            'FLAT OR DECLINING PACE SINCE ' + fmtDate(rate.first.date).toUpperCase() + ', NO PROJECTED DATE AT THIS RATE</div>';
        }
      }

      const setLabel = g.setDate ? 'Goal set ' + fmtDate(g.setDate) : 'No set date logged';
      const currentNote = current
        ? 'Current: ' + currentCount + (current.asOf ? ' as of ' + fmtDate(current.asOf) : ', no date logged on the latest one')
        : 'No real data logged for this metric yet';

      return '<div class="goal-card">' +
        '<div class="goal-head">' +
        '<span class="goal-label">' + escapeHtml(g.label) + '</span>' +
        '<span class="goal-set-date font-mono">' + escapeHtml(setLabel) + '</span>' +
        '</div>' +
        '<div class="goal-progress-row">' +
        '<div class="goal-progress-track" role="img" aria-label="' +
        escapeHtml(currentCount + ' of ' + g.target + ' target, ' + pct + ' percent') + '">' +
        '<div class="goal-progress-fill" style="width:' + pct + '%"></div>' +
        '</div>' +
        '<span class="goal-progress-pct font-mono">' + pct + '%</span>' +
        '</div>' +
        '<div class="goal-current font-mono">' + escapeHtml(currentNote) + ', target ' + g.target + '</div>' +
        achievedHtml +
        paceHtml +
        paceStatusHtml +
        projectionHtml +
        (g.note ? '<div class="goal-note">' + escapeHtml(g.note) + '</div>' : '') +
        '</div>';
    }).join('');
  }

  // A glanceable, channel-level overview sitting above the single-metric
  // Traction deep-dive and the per-lead Engagement queue: which distribution
  // channels have a real live-tracked number, which are only hand-logged,
  // and which are an honest "not tracked yet" gap. Reads its numbers from
  // downloads.json/leads.json rather than duplicating them in channels.json,
  // so a channel row can never drift out of sync with the section it links to.
  function renderChannels(channelsData, downloadsData, leadsData) {
    const channels = channelsData.channels || [];
    if (channels.length === 0) {
      channelsSection.innerHTML = '<div class="empty-state">No channels logged yet.' +
        emptyStateCta('quickChannelForm', 'Log one now') + '</div>';
      return;
    }

    const STATUS_LABEL = { tracked: 'TRACKED', 'manual-log': 'MANUAL LOG', 'not-tracked': 'NOT TRACKED' };
    const STATUS_CLASS = { tracked: 'channel-pill-tracked', 'manual-log': 'channel-pill-manual', 'not-tracked': 'channel-pill-gap' };

    function linkedValue(c) {
      if (c.linkedMetric === 'downloads') {
        const metric = (downloadsData && downloadsData.metric) || {};
        const checks = (metric.checks || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
        if (checks.length === 0) return null;
        const latest = checks[checks.length - 1];
        return latest.count + ' ' + (metric.label || 'downloads') + ' as of ' + fmtDate(latest.date);
      }
      if (c.linkedMetric === 'leads') {
        // Leads carry a free-form source, not a channel, so a lead from any
        // channel could otherwise get counted under whichever card happens
        // to have linkedMetric "leads". Filtering on channelId keeps this
        // card honest about leads actually attributed to it.
        const leads = ((leadsData && leadsData.leads) || []).filter(l => l.channelId === c.id);
        if (leads.length === 0) return null;
        return leads.length + (leads.length === 1 ? ' lead logged' : ' leads logged');
      }
      return null;
    }

    channelsSection.innerHTML = '<div class="channel-grid">' + channels.map(c => {
      const value = linkedValue(c);
      return '<div class="channel-card">' +
        '<div class="channel-head">' +
        '<span class="channel-name">' + escapeHtml(c.name || 'Unnamed channel') + '</span>' +
        '<span class="channel-pill ' + (STATUS_CLASS[c.status] || '') + ' font-mono">' +
        (STATUS_LABEL[c.status] || escapeHtml(c.status || 'UNKNOWN')) + '</span>' +
        '</div>' +
        (value ? '<div class="channel-value font-display">' + escapeHtml(value) + '</div>'
               : '<div class="channel-value channel-value-empty">No number logged yet.</div>') +
        (c.note ? '<div class="channel-note">' + escapeHtml(c.note) + '</div>' : '') +
        '</div>';
    }).join('') + '</div>';
  }

  // The download freshness badge only tracks how current the traction
  // number is; a release logged last week or a lead never dated wouldn't
  // show up in that. This scans every real date across all three files so
  // a visitor can tell, at a glance, whether the whole hub (not just the
  // download count) reflects anything recent or is running on old input.
  function renderLastUpdated(releasesData, downloadsData, leadsData, goalsData) {
    const dates = [];
    ((releasesData && releasesData.releases) || []).forEach(r => { if (r.date) dates.push(r.date); });
    (((downloadsData && downloadsData.metric) || {}).checks || []).forEach(c => { if (c.date) dates.push(c.date); });
    ((leadsData && leadsData.leads) || []).forEach(l => { if (l.loggedDate) dates.push(l.loggedDate); });
    ((goalsData && goalsData.goals) || []).forEach(g => { if (g.setDate) dates.push(g.setDate); });

    if (dates.length === 0) {
      lastUpdatedSub.hidden = true;
      return;
    }
    const latest = dates.sort().pop();
    const rel = relativeDaysLabel(latest);
    const isStale = daysBetween(latest, todayIso()) > STALE_AFTER_DAYS;

    lastUpdatedSub.hidden = false;
    lastUpdatedSub.classList.toggle('last-updated-stale', isStale);
    lastUpdatedSub.textContent = 'Last real update logged: ' + fmtDate(latest) + (rel ? ' (' + rel + ')' : '') +
      (isStale ? ', over a week old' : '');
  }

  // Surfaces the single most actionable fact on the page, real drafted
  // outreach sitting on a human approval, as a header pill rather than
  // making a visitor read the whole engagement queue to find it. Also
  // swaps the tab's own favicon to the same amber dot the attention pill
  // uses, the same "glance indicator" convention Alpha's app.js already
  // established for its own tab (favicon + title both carry the state a
  // background tab can't otherwise show), so Jack can tell a draft is
  // waiting on him without this tab being focused. Reverts to the shared
  // favicon.svg, never edits it, once nothing is pending.
  function renderAttentionPill(data) {
    const leads = data.leads || [];
    const pending = leads.filter(l => {
      const o = l.outreach || {};
      return !o.sent && o.approvalStatus === 'awaiting-approval';
    });
    if (pending.length === 0) {
      attentionPill.hidden = true;
      document.title = 'Sondrik / Command Center';
      if (pageFavicon && DEFAULT_FAVICON_HREF) pageFavicon.setAttribute('href', DEFAULT_FAVICON_HREF);
      return;
    }
    attentionPill.hidden = false;
    attentionPill.textContent = pending.length + (pending.length === 1 ? ' draft awaiting your approval' : ' drafts awaiting your approval');
    document.title = '(' + pending.length + ') Sondrik / Command Center';
    if (pageFavicon) {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
        '<circle cx="16" cy="16" r="13" fill="#E0A030"/></svg>';
      pageFavicon.setAttribute('href', 'data:image/svg+xml,' + encodeURIComponent(svg));
    }
  }

  // Grouping logic lives in SondrikValidateCore, shared with validate.js
  // (same reasoning as CGT's, CSM's and Garage's own validate-core.js) so the
  // two can never drift; validate.js also catches an exact duplicate id
  // separately, a different, narrower check.
  function renderLeads(data) {
    const leads = data.leads || [];
    if (leads.length === 0) {
      leadsSection.innerHTML = '<div class="empty-state">No leads logged yet.' +
        emptyStateCta('quickLeadForm', 'Log one now') + '</div>';
      return;
    }
    const duplicateIds = new Set();
    SondrikValidateCore.findDuplicateLeads(leads).forEach(group => group.forEach(l => duplicateIds.add(l.id)));
    leadsSection.innerHTML = leads.map(l => {
      const o = l.outreach || {};
      const pillText = o.sent
        ? 'SENT' + (o.sentDate ? ' ' + fmtDate(o.sentDate) : '')
        : (o.approvalStatus === 'awaiting-approval' ? 'DRAFT READY, AWAITING APPROVAL' : (o.draftStatus || 'NO DRAFT YET').toUpperCase());
      const pillClass = o.sent ? 'status-pill status-pill-sent' : 'status-pill';

      // Shows the actual drafted message text, read-only, so an approval
      // decision can be made from this page instead of Jack having to go
      // find the draft wherever he wrote it. This never sends anything and
      // has no send action anywhere near it, same "display tool, not a send
      // tool" boundary as the rest of the page. Only rendered pre-send: once
      // outreach.sent is true, the message already went out through
      // whatever channel Jack actually used, and re-showing draft text here
      // would read as if this page had a role in that.
      let draftPreviewHtml = '';
      if (!o.sent) {
        if (o.draftText) {
          draftPreviewHtml = '<div class="lead-draft-preview">' +
            '<div class="lead-draft-preview-label font-mono">DRAFT PREVIEW, NOT SENT FROM HERE</div>' +
            '<div class="lead-draft-preview-text">' + escapeHtml(o.draftText) + '</div>' +
            '</div>';
        } else if (o.approvalStatus === 'awaiting-approval') {
          draftPreviewHtml = '<div class="lead-draft-preview lead-draft-preview-empty">' +
            'No draft text logged here yet, review the actual draft wherever it was written until it\'s added here.' +
            '</div>';
        }
      }

      return '<div class="lead-card">' +
        '<div class="lead-head">' +
        '<span class="lead-source">' + escapeHtml(l.sourceDetail || l.source || 'Unknown source') + '</span>' +
        (l.type ? '<span class="lead-type font-mono">' + escapeHtml(l.type.replace(/-/g, ' ').toUpperCase()) + '</span>' : '') +
        '</div>' +
        '<div class="lead-summary">' + escapeHtml(l.summary || 'No summary logged.') + '</div>' +
        '<div class="lead-status-row">' +
        '<span class="' + pillClass + ' font-mono">' + escapeHtml(pillText) + '</span>' +
        (duplicateIds.has(l.id) ? '<span class="status-pill status-pill-duplicate font-mono" title="Another lead matches on channel + source detail. Check this is not the same real contact logged twice before counting both.">POSSIBLE DUPLICATE</span>' : '') +
        '</div>' +
        (o.note ? '<div class="lead-note">' + escapeHtml(o.note) + '</div>' : '') +
        draftPreviewHtml +
        '</div>';
    }).join('');
  }

  // Renders changelog.json, a file no one hand-edits: it's regenerated from
  // this repo's real git history by public/sondrik/data/changelog.js, so
  // every hash, author, and date here is independently checkable against
  // the repo instead of resting on a hand-typed claim. Missing the file
  // entirely (never generated yet) is an honest empty state, not an error,
  // same as an empty goals.json.
  function renderChangelog(data) {
    const entries = data.entries || [];
    if (entries.length === 0) {
      changelogSection.innerHTML = '<div class="empty-state">No changelog generated yet. Run ' +
        '<code>node public/sondrik/data/changelog.js</code> to build one from this repo\'s git history.</div>';
      return;
    }
    const FILE_LABEL = {
      'releases.json': 'releases', 'downloads.json': 'downloads', 'leads.json': 'leads',
      'channels.json': 'channels', 'goals.json': 'goals'
    };
    const html = '<ol class="timeline changelog-list" aria-label="Real git commit history of the data files above, most recent first">' +
      entries.map(e => {
        const files = (e.files || []).map(f => FILE_LABEL[f] || f);
        return '<li class="timeline-item changelog-item">' +
          '<div class="timeline-meta">' +
          '<span class="timeline-badge changelog-hash font-mono" title="' + escapeHtml(e.fullHash || e.hash) + '">' +
          escapeHtml(e.hash) + '</span>' +
          '<span class="timeline-date font-mono">' + fmtDate(e.date) + '</span>' +
          '<span class="changelog-author font-mono">' + escapeHtml(e.author) + '</span>' +
          '</div>' +
          '<div class="timeline-title">' + escapeHtml(e.subject) + '</div>' +
          (files.length ? '<div class="timeline-detail changelog-files">Touched: ' + escapeHtml(files.join(', ')) + '</div>' : '') +
          '</li>';
      }).join('') + '</ol>' +
      '<p class="section-note changelog-generated-note">Generated ' +
      (fmtDate((data.generatedAt || '').slice(0, 10)) || 'at an unknown time') +
      ' from ' + escapeHtml(data.generatedFrom || 'git log') + '.</p>';
    changelogSection.innerHTML = html;
  }

  // Consolidates the "needs a real human action" signals that otherwise sit
  // scattered across three separate sections (the header approval pill, the
  // traction staleness badge, the empty goal state) into one scannable
  // checklist. Every line here is a fact already computed elsewhere on the
  // page, this only decides which of those facts amount to an actual next
  // action and lists them together, it does not add any new data of its own.
  //
  // Also folds in the same data-quality gaps public/sondrik/data/validate.js
  // flags as warnings (an undated release, an uncited metric, an unexplained
  // "not-tracked" channel), so those show up here on page load instead of
  // only when someone remembers to run the validator from the command line.
  function renderNextSteps(releasesData, downloadsData, leadsData, goalsData, channelsData) {
    const steps = [];

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
      const checkinStatus = bugfixCheckinStatus(datedReleases[0]);
      if (checkinStatus && (checkinStatus.tier === 'due' || checkinStatus.tier === 'missed')) {
        steps.push({
          urgent: true,
          text: 'v' + datedReleases[0].version + ': ' + checkinStatus.text.charAt(0).toLowerCase() + checkinStatus.text.slice(1) + '.',
          href: '#releaseSection'
        });
      }
    }

    const leads = (leadsData && leadsData.leads) || [];
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
      const ageDays = daysBetween(latest.date, todayIso());
      if (ageDays > STALE_AFTER_DAYS) {
        steps.push({
          urgent: true,
          text: 'Pull a fresh ' + (metric.label || 'download') + ' count, the last one logged is ' + ageDays + ' days old.',
          href: '#tractionSection'
        });
      } else if (ageDays > AGING_AFTER_DAYS) {
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

    const duplicateLeadGroups = SondrikValidateCore.findDuplicateLeads(leads);
    if (duplicateLeadGroups.length > 0) {
      const dupCount = duplicateLeadGroups.reduce((n, g) => n + g.length, 0);
      steps.push({
        urgent: false,
        text: dupCount + ' leads look like the same real contact logged twice (matched on channel + source detail), check before counting both.',
        href: '#leadsSection'
      });
    }

    if (steps.length === 0) {
      nextStepsList.innerHTML = '<div class="empty-state">Nothing needs your attention right now.</div>';
      return;
    }

    steps.sort((a, b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0));
    nextStepsList.innerHTML = '<ul class="next-steps-list">' + steps.map(s =>
      '<li class="next-step-item ' + (s.urgent ? 'next-step-urgent' : 'next-step-info') + '">' +
      '<a href="' + s.href + '">' +
      '<span class="next-step-pill font-mono">' + (s.urgent ? 'ACTION' : 'WHEN READY') + '</span>' +
      '<span class="next-step-text">' + escapeHtml(s.text) + '</span>' +
      '</a></li>'
    ).join('') + '</ul>';
  }

  // Builds a plain-text snapshot from the same real data files already on
  // the page, for Jack to paste into a build log or status update himself.
  // Purely a clipboard copy, nothing here ever transmits anywhere on its own.
  function buildStatusUpdate(releasesData, downloadsData, leadsData, goalsData, channelsData) {
    const lines = ['Sondrik status snapshot, generated ' + fmtDate(todayIso())];

    const releases = ((releasesData && releasesData.releases) || []).slice()
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    if (releases.length > 0) {
      const r = releases[0];
      const rel = relativeDaysLabel(r.date);
      lines.push('');
      lines.push('Latest release: v' + r.version + (r.date ? ' (' + fmtDate(r.date) + (rel ? ', ' + rel : '') + ')' : '') +
        (r.summary ? ', ' + r.summary : ''));
    }

    const metric = (downloadsData && downloadsData.metric) || {};
    const checks = (metric.checks || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    if (checks.length > 0) {
      const latest = checks[checks.length - 1];
      let line = latest.count + ' ' + (metric.label || 'downloads') + ' as of ' + fmtDate(latest.date);
      if (checks.length > 1) {
        const first = checks[0];
        const delta = latest.count - first.count;
        line += ' (' + (delta >= 0 ? '+' : '') + delta + ' vs ' + fmtDate(first.date) + ' check)';
      }
      if (metric.source) line += '. Source: ' + metric.source;
      lines.push('');
      lines.push(line);
    }

    const leads = (leadsData && leadsData.leads) || [];
    if (leads.length > 0) {
      lines.push('');
      leads.forEach(l => {
        const o = l.outreach || {};
        const status = o.sent ? 'sent'
          : (o.approvalStatus === 'awaiting-approval' ? 'drafted, awaiting approval' : (o.draftStatus || 'no draft yet'));
        lines.push('Lead: ' + (l.sourceDetail || l.source || 'Unknown source') +
          (l.summary ? ', ' + l.summary : '') + ' [' + status + ']');
      });
    }

    const goals = (goalsData && goalsData.goals) || [];
    if (goals.length > 0) {
      lines.push('');
      goals.forEach(g => {
        const current = currentMetricValue(g.metric, downloadsData, leadsData);
        const currentCount = current ? current.count : 0;
        lines.push('Goal: ' + g.label + ', ' + currentCount + ' / ' + g.target +
          (g.targetDate ? ' by ' + fmtDate(g.targetDate) : ''));
      });
    }

    // Not-tracked channels don't have a real number to add to the snapshot
    // above, but leaving them out silently would let a reader assume the
    // downloads/leads figures already cover every channel Jack is watching.
    // Tracked and manual-log channels are skipped here, their real numbers
    // are already the downloads/lead lines above, repeating them would just
    // be the same fact twice.
    const gaps = ((channelsData && channelsData.channels) || []).filter(c => c.status === 'not-tracked');
    if (gaps.length > 0) {
      lines.push('');
      lines.push('Not tracked yet: ' + gaps.map(c => c.name || 'Unnamed channel').join(', ') + '.');
    }

    return lines.join('\n');
  }

  // Indie/solo founder dashboards commonly expose a one-tap "copy a
  // build-in-public post" alongside an internal status log, since sharing real
  // traction on X/Reddit is a normal part of that workflow. This is a
  // separate, shorter composition from buildStatusUpdate above, not a
  // trimmed copy of it: it drops internal-only detail (next steps, the
  // approval-gated lead's draft/approval status) and instead writes the same
  // real facts as a plain sentence or two meant to be posted publicly. It
  // still only ever states what is already real and logged elsewhere on the
  // page, and it is still just a clipboard copy, nothing here posts on its
  // own behalf.
  function buildPublicPost(releasesData, downloadsData, leadsData) {
    const parts = [];

    const releases = ((releasesData && releasesData.releases) || []).slice()
      .filter(r => r.date)
      .sort((a, b) => b.date.localeCompare(a.date));
    if (releases.length > 0) {
      const r = releases[0];
      parts.push('Sondrik v' + r.version + ' shipped ' + fmtDate(r.date) +
        (r.summary ? ' (' + r.summary.replace(/\.$/, '') + ')' : '') + '.');
    }

    const metric = (downloadsData && downloadsData.metric) || {};
    const checks = (metric.checks || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    if (checks.length > 0) {
      const latest = checks[checks.length - 1];
      let line = latest.count + ' ' + (metric.label || 'downloads') + ' as of ' + fmtDate(latest.date);
      if (checks.length > 1) {
        const first = checks[0];
        line += ', up from ' + first.count + ' on ' + fmtDate(first.date);
      }
      parts.push(line + '.');
    }

    const leads = (leadsData && leadsData.leads) || [];
    const testerOffers = leads.filter(l => l.type === 'beta-tester-offer');
    if (testerOffers.length > 0) {
      parts.push((testerOffers.length === 1 ? 'One' : String(testerOffers.length)) +
        ' real reader offered to test it in exchange for lifetime access.');
    }

    if (parts.length === 0) return '';
    return parts.join(' ');
  }

  // Turns the same two forward-looking real dates already computed elsewhere
  // on the page (the bugfix check-in schedule, the check-in cadence estimate)
  // into calendar reminders, so they land somewhere Jack will actually see
  // them instead of only on this page when he happens to visit it. Only ever
  // a date that is today or still in the future: a reminder for one that has
  // already passed isn't useful as a calendar event, Next Steps above already
  // flags an overdue one as an action item instead. Adds no new fact, purely
  // a re-expression of real data that already renders elsewhere.
  function computeReminders(releasesData, downloadsData) {
    const reminders = [];

    const dated = ((releasesData && releasesData.releases) || []).filter(r => r.date)
      .slice().sort((a, b) => b.date.localeCompare(a.date));
    const latestRelease = dated[0];
    if (latestRelease && latestRelease.type === 'bugfix') {
      BUGFIX_CHECKPOINTS.forEach(checkpoint => {
        const date = addDays(latestRelease.date, checkpoint);
        if (date >= todayIso()) {
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
    if (cadence && cadence.nextDate >= todayIso()) {
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

  // RFC 5545 (iCalendar) text escaping and 75-octet line folding, same
  // approach CSM's own nudge-queue calendar export already uses for exactly
  // the same reason (long SUMMARY/DESCRIPTION values, and a UTF-8-safe fold
  // so a multi-byte character never gets split across the line break).
  function icsEscapeText(s) {
    return String(s == null ? '' : s)
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\n/g, '\\n');
  }

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

  // One all-day VEVENT per real reminder, never anything that contacts
  // anyone, this only builds a file for Jack's own calendar app to import.
  function buildRemindersIcs(reminders) {
    const dtstamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const events = reminders.map(r => {
      const lines = [
        'BEGIN:VEVENT',
        'UID:' + icsEscapeText(r.uid),
        'DTSTAMP:' + dtstamp,
        'DTSTART;VALUE=DATE:' + r.date.replace(/-/g, ''),
        'SUMMARY:' + icsEscapeText(r.summary),
        'DESCRIPTION:' + icsEscapeText(r.description),
        'END:VEVENT'
      ];
      return lines.map(icsFoldLine).join('\r\n');
    });
    return [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Command Center//Sondrik//EN',
      'CALSCALE:GREGORIAN',
      events.join('\r\n'),
      'END:VCALENDAR'
    ].join('\r\n') + '\r\n';
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise((resolve, reject) => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-10000px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      ok ? resolve() : reject(new Error('execCommand copy failed'));
    });
  }

  function csvField(v) {
    let s = v == null ? '' : String(v);
    // CSV/formula injection (OWASP): a hand-typed note starting with
    // =, +, -, @, tab, or a carriage return is read as a live formula by
    // Excel/Sheets when this export is opened there, not as plain text.
    // A leading single quote is the standard mitigation both recommend.
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  // Exports the real, logged download-check history only, one row per actual
  // check that was run, never an interpolated or estimated in-between value.
  function exportDownloadsCsv(downloadsData) {
    const metric = downloadsData.metric || {};
    const checks = (metric.checks || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const header = ['Date', 'Count', 'Metric', 'Source', 'Note'].map(csvField).join(',');
    const lines = checks.map(c => [c.date, c.count, metric.label, metric.source, c.note].map(csvField).join(','));
    const csv = [header, ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sondrik-download-checks-' + todayIso() + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Same "real logged history only, one row per record" rule as
  // exportDownloadsCsv above, just for the other two record types that had
  // no export at all: CGT, Garage, and CSM all already provide full-dataset
  // CSV export for every entity type they track, this closes the same gap
  // here. Goals is left out: goals.json is currently empty, an export
  // button for zero real goals has nothing to export yet.
  function exportReleasesCsv(releasesData) {
    const releases = (releasesData.releases || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const header = ['Version', 'Date', 'Type', 'Summary', 'Notes'].map(csvField).join(',');
    const lines = releases.map(r => [r.version, r.date, r.type, r.summary, r.notes].map(csvField).join(','));
    const csv = [header, ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sondrik-releases-' + todayIso() + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function exportLeadsCsv(leadsData) {
    const leads = (leadsData.leads || []).slice().sort((a, b) => (a.loggedDate || '').localeCompare(b.loggedDate || ''));
    const header = ['Id', 'Source', 'Source detail', 'Type', 'Summary', 'Logged date', 'Draft status', 'Approval status', 'Sent', 'Draft text'].map(csvField).join(',');
    const lines = leads.map(l => {
      const o = l.outreach || {};
      return [l.id, l.source, l.sourceDetail, l.type, l.summary, l.loggedDate, o.draftStatus, o.approvalStatus, o.sent ? 'yes' : 'no', o.draftText].map(csvField).join(',');
    });
    const csv = [header, ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sondrik-leads-' + todayIso() + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Same export pattern as releases/downloads/leads above, closing the same
  // gap for the one remaining real-data record type that had no export:
  // channels.json already carries 3 real, hand-logged channels, unlike
  // goals.json (still empty, see the note above exportReleasesCsv for why
  // that one is skipped for now). linkedValue mirrors renderChannels' own
  // lookup so the exported number matches what the card on screen shows,
  // never a second, possibly-stale copy of it.
  function exportChannelsCsv(channelsData, downloadsData, leadsData) {
    const channels = channelsData.channels || [];
    function linkedValue(c) {
      if (c.linkedMetric === 'downloads') {
        const metric = (downloadsData && downloadsData.metric) || {};
        const checks = (metric.checks || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
        if (checks.length === 0) return '';
        return checks[checks.length - 1].count;
      }
      if (c.linkedMetric === 'leads') {
        const leads = ((leadsData && leadsData.leads) || []).filter(l => l.channelId === c.id);
        return leads.length || '';
      }
      return '';
    }
    const header = ['Id', 'Name', 'Status', 'Linked metric', 'Current value', 'Note'].map(csvField).join(',');
    const lines = channels.map(c =>
      [c.id, c.name, c.status, c.linkedMetric, linkedValue(c), c.note].map(csvField).join(','));
    const csv = [header, ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sondrik-channels-' + todayIso() + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Shared client-side draft-autosave for the five quick-log forms below:
  // none of them write to a real file, this app has no backend to save a
  // half-filled form to, so an accidental reload or navigation away used to
  // throw away real typed data with no way back. Same pattern CGT's and
  // Garage's own attachDraftGuard use (public/cgt/app.js, public/garage/
  // app.js), reading whatever real input/select/textarea fields the given
  // form actually has rather than a hand-maintained id list. Autosaved to
  // this browser's localStorage only, never sent anywhere, so it does not
  // conflict with this page's no-fabricated-data rule; a private window or
  // blocked storage just means the draft protection quietly no-ops. Call
  // this only after a form's own defaults (today's date, a populated select)
  // are already set, so a real restored draft value is what wins, not the
  // default it would otherwise overwrite.
  function attachDraftGuard(form, storageKey, opts) {
    const bannerEl = document.getElementById(opts.bannerId);
    const bannerTimeEl = document.getElementById(opts.timeId);
    const discardBtn = document.getElementById(opts.discardId);
    if (!bannerEl || !bannerTimeEl || !discardBtn) return { clearDraft() {} };

    const fields = Array.from(form.querySelectorAll('input[id], select[id], textarea[id]'));
    let saveTimer = null;

    function readValues() {
      const values = {};
      fields.forEach(el => { values[el.id] = el.value; });
      return values;
    }
    function hasAnyValue(values) {
      return fields.some(el => (values[el.id] || '').trim() !== '');
    }
    function clearDraft() {
      try { localStorage.removeItem(storageKey); } catch (e) { /* see saveDraft below */ }
      bannerEl.hidden = true;
    }
    function saveDraft() {
      try {
        const values = readValues();
        if (!hasAnyValue(values)) { clearDraft(); return; }
        localStorage.setItem(storageKey, JSON.stringify({ savedAt: Date.now(), values }));
      } catch (e) { /* localStorage unavailable (private window, blocked storage): draft protection just no-ops */ }
    }

    form.addEventListener('input', () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(saveDraft, 400);
    });
    discardBtn.addEventListener('click', () => {
      clearDraft();
      form.reset();
      if (opts.onDiscard) opts.onDiscard();
    });

    try {
      const raw = localStorage.getItem(storageKey);
      const draft = raw ? JSON.parse(raw) : null;
      if (draft && hasAnyValue(draft.values || {})) {
        fields.forEach(el => { if (el.id in draft.values) el.value = draft.values[el.id]; });
        bannerTimeEl.textContent = new Date(draft.savedAt).toLocaleString();
        bannerEl.hidden = false;
      }
    } catch (e) { /* see saveDraft above */ }

    return { clearDraft };
  }

  // Quick-log tool: turns a small form into the exact JSON object to paste
  // into downloads.json or leads.json by hand, same "generate paste-ready
  // JSON, save nothing" pattern CSM's quick-add uses for prospects. Never
  // writes a file and never calls a server, it only builds text and puts it
  // on the clipboard; the real edit still happens by hand, same as every
  // other update to these files (see the "How to log a real update" details
  // above). Warnings here mirror validate.js's own checks (future dates,
  // duplicate ids/dates) so a mistake surfaces before it's even pasted in.
  function initQuickLogTool(channelsData, downloadsData, leadsData, releasesData, goalsData) {
    const qcForm = document.getElementById('quickCheckForm');
    const qcDate = document.getElementById('qcDate');
    const qcCount = document.getElementById('qcCount');
    const qcNote = document.getElementById('qcNote');
    const qcWarnings = document.getElementById('qcWarnings');
    const qcOutput = document.getElementById('qcOutput');
    const qcCopyBtn = document.getElementById('qcCopyBtn');
    const quickLogLive = document.getElementById('quickLogLive');

    qcDate.value = todayIso();
    qcDate.max = todayIso();
    const qcDraftGuard = attachDraftGuard(qcForm, 'sondrik-qc-draft-v1', {
      bannerId: 'qcDraftBanner', timeId: 'qcDraftBannerTime', discardId: 'qcDiscardDraftBtn',
      onDiscard: () => { qcOutput.hidden = true; qcCopyBtn.hidden = true; qcWarnings.textContent = ''; qcDate.value = todayIso(); }
    });

    qcForm.addEventListener('submit', e => {
      e.preventDefault();
      const date = qcDate.value;
      const count = Number(qcCount.value);
      const note = qcNote.value.trim();
      const countValid = Number.isInteger(count) && count >= 0;
      const blockers = [];
      const advisory = [];

      if (!date) blockers.push('Date is required, this is when you actually ran the check.');
      if (!countValid) blockers.push('Count must be a whole number, zero or more.');

      const existingChecks = ((downloadsData && downloadsData.metric && downloadsData.metric.checks) || []);
      if (date && existingChecks.some(c => c.date === date)) {
        blockers.push('There is already a check logged for ' + date + '. The validator rejects duplicate dates.');
      }
      const latest = existingChecks.slice().sort((a, b) => (a.date || '').localeCompare(b.date || '')).pop();
      if (latest && countValid && count < latest.count) {
        advisory.push('This count (' + count + ') is lower than the last logged check (' + latest.count +
          ' on ' + fmtDate(latest.date) + '). GitHub release download counts only go up, double check this is real.');
      }

      if (blockers.length) {
        qcWarnings.textContent = blockers.join(' ');
        qcOutput.hidden = true;
        qcCopyBtn.hidden = true;
        return;
      }

      const obj = { date, count };
      if (note) obj.note = note;
      qcWarnings.textContent = advisory.join(' ');

      qcOutput.value = JSON.stringify(obj, null, 2) + ',';
      qcOutput.hidden = false;
      qcCopyBtn.hidden = false;
    });

    qcCopyBtn.addEventListener('click', () => {
      copyText(qcOutput.value).then(() => {
        const original = qcCopyBtn.textContent;
        qcCopyBtn.textContent = 'Copied!';
        quickLogLive.textContent = 'Download check JSON copied to clipboard.';
        qcDraftGuard.clearDraft();
        setTimeout(() => { qcCopyBtn.textContent = original; }, 1800);
      }).catch(() => { quickLogLive.textContent = 'Could not copy to clipboard.'; });
    });

    // The one record type on this page that previously had no quick-log
    // form, unlike releases/goals/downloads/leads, meaning adding a channel
    // was the only edit still requiring a hand-typed JSON blob. Warnings
    // mirror validate.js's own channel checks (duplicate id, a "tracked"
    // channel with no linkedMetric, a "not-tracked" channel with no note)
    // so the same gaps surface here instead of only on the next
    // `node validate.js` run.
    const qchForm = document.getElementById('quickChannelForm');
    const qchId = document.getElementById('qchId');
    const qchName = document.getElementById('qchName');
    const qchLinkedMetric = document.getElementById('qchLinkedMetric');
    const qchStatus = document.getElementById('qchStatus');
    const qchNote = document.getElementById('qchNote');
    const qchWarnings = document.getElementById('qchWarnings');
    const qchOutput = document.getElementById('qchOutput');
    const qchCopyBtn = document.getElementById('qchCopyBtn');
    const qchDraftGuard = attachDraftGuard(qchForm, 'sondrik-qch-draft-v1', {
      bannerId: 'qchDraftBanner', timeId: 'qchDraftBannerTime', discardId: 'qchDiscardDraftBtn',
      onDiscard: () => { qchOutput.hidden = true; qchCopyBtn.hidden = true; qchWarnings.textContent = ''; }
    });

    qchForm.addEventListener('submit', e => {
      e.preventDefault();
      const id = qchId.value.trim();
      const name = qchName.value.trim();
      const linkedMetric = qchLinkedMetric.value || null;
      const status = qchStatus.value;
      const note = qchNote.value.trim();
      const blockers = [];
      const advisory = [];

      if (!id) blockers.push('An id is required.');
      const existingIds = new Set(((channelsData && channelsData.channels) || []).map(c => c.id));
      if (id && existingIds.has(id)) blockers.push('"' + id + '" is already used by another channel, ids must be unique.');
      if (!name) blockers.push('A name is required.');

      if (status === 'tracked' && !linkedMetric) {
        advisory.push('Status is "tracked" but no linked metric is set, nothing real will display for it.');
      }
      if (status === 'not-tracked' && !note) {
        advisory.push('Status is "not-tracked" with no note, add one explaining why so this reads as an honest gap, not an unexplained one.');
      }

      if (blockers.length) {
        qchWarnings.textContent = blockers.join(' ');
        qchOutput.hidden = true;
        qchCopyBtn.hidden = true;
        return;
      }
      qchWarnings.textContent = advisory.join(' ');

      const obj = { id, name, linkedMetric, status, note: note || null };
      qchOutput.value = JSON.stringify(obj, null, 2) + ',';
      qchOutput.hidden = false;
      qchCopyBtn.hidden = false;
    });

    qchCopyBtn.addEventListener('click', () => {
      copyText(qchOutput.value).then(() => {
        const original = qchCopyBtn.textContent;
        qchCopyBtn.textContent = 'Copied!';
        quickLogLive.textContent = 'Channel JSON copied to clipboard.';
        qchDraftGuard.clearDraft();
        setTimeout(() => { qchCopyBtn.textContent = original; }, 1800);
      }).catch(() => { quickLogLive.textContent = 'Could not copy to clipboard.'; });
    });

    const qlForm = document.getElementById('quickLeadForm');
    const qlId = document.getElementById('qlId');
    const qlChannel = document.getElementById('qlChannel');
    const qlSourceDetail = document.getElementById('qlSourceDetail');
    const qlType = document.getElementById('qlType');
    const qlSummary = document.getElementById('qlSummary');
    const qlDate = document.getElementById('qlDate');
    const qlWarnings = document.getElementById('qlWarnings');
    const qlOutput = document.getElementById('qlOutput');
    const qlCopyBtn = document.getElementById('qlCopyBtn');

    qlDate.value = todayIso();
    qlDate.max = todayIso();

    const channels = (channelsData && channelsData.channels) || [];
    qlChannel.innerHTML = '<option value="">No tracked channel / not sure</option>' +
      channels.map(c => '<option value="' + escapeHtml(c.id) + '">' + escapeHtml(c.name || c.id) + '</option>').join('');

    // Attached after qlChannel's real options are populated above, so a
    // restored draft's channel id can actually be selected (setting .value
    // to an id with no matching <option> yet would silently no-op).
    const qlDraftGuard = attachDraftGuard(qlForm, 'sondrik-ql-draft-v1', {
      bannerId: 'qlDraftBanner', timeId: 'qlDraftBannerTime', discardId: 'qlDiscardDraftBtn',
      onDiscard: () => { qlOutput.hidden = true; qlCopyBtn.hidden = true; qlWarnings.textContent = ''; qlDate.value = todayIso(); }
    });

    qlForm.addEventListener('submit', e => {
      e.preventDefault();
      const id = qlId.value.trim();
      const channelId = qlChannel.value || null;
      const sourceDetail = qlSourceDetail.value.trim();
      const type = qlType.value.trim();
      const summary = qlSummary.value.trim();
      const date = qlDate.value;
      const blockers = [];

      if (!id) blockers.push('An id is required.');
      const existingIds = new Set(((leadsData && leadsData.leads) || []).map(l => l.id));
      if (id && existingIds.has(id)) blockers.push('"' + id + '" is already used by another lead, ids must be unique.');
      if (!summary) blockers.push('A summary is required.');
      if (!date) blockers.push('Date logged is required.');

      qlWarnings.textContent = blockers.join(' ');
      if (blockers.length) {
        qlOutput.hidden = true;
        qlCopyBtn.hidden = true;
        return;
      }

      const obj = {
        id,
        channelId,
        source: channelId ? (channels.find(c => c.id === channelId) || {}).name || null : null,
        sourceDetail: sourceDetail || null,
        type: type || null,
        summary,
        loggedDate: date,
        outreach: {
          draftStatus: null,
          approvalStatus: null,
          sent: false,
          note: null
        }
      };

      qlOutput.value = JSON.stringify(obj, null, 2) + ',';
      qlOutput.hidden = false;
      qlCopyBtn.hidden = false;
    });

    qlCopyBtn.addEventListener('click', () => {
      copyText(qlOutput.value).then(() => {
        const original = qlCopyBtn.textContent;
        qlCopyBtn.textContent = 'Copied!';
        quickLogLive.textContent = 'Lead JSON copied to clipboard.';
        qlDraftGuard.clearDraft();
        setTimeout(() => { qlCopyBtn.textContent = original; }, 1800);
      }).catch(() => { quickLogLive.textContent = 'Could not copy to clipboard.'; });
    });

    // Same generate-only, save-nothing pattern as the two forms above,
    // covering the two record types (releases, goals) that previously had
    // no quick-log form at all, only the hand-edit instructions in the
    // schema-help table. Warnings mirror validate.js's own checks for each
    // file (duplicate version/id, a future-dated real event) so a mistake
    // surfaces here instead of only on the next `node validate.js` run.
    const qrForm = document.getElementById('quickReleaseForm');
    const qrVersion = document.getElementById('qrVersion');
    const qrDate = document.getElementById('qrDate');
    const qrType = document.getElementById('qrType');
    const qrSummary = document.getElementById('qrSummary');
    const qrWarnings = document.getElementById('qrWarnings');
    const qrOutput = document.getElementById('qrOutput');
    const qrCopyBtn = document.getElementById('qrCopyBtn');

    qrDate.value = todayIso();
    qrDate.max = todayIso();
    const qrDraftGuard = attachDraftGuard(qrForm, 'sondrik-qr-draft-v1', {
      bannerId: 'qrDraftBanner', timeId: 'qrDraftBannerTime', discardId: 'qrDiscardDraftBtn',
      onDiscard: () => { qrOutput.hidden = true; qrCopyBtn.hidden = true; qrWarnings.textContent = ''; qrDate.value = todayIso(); }
    });

    qrForm.addEventListener('submit', e => {
      e.preventDefault();
      const version = qrVersion.value.trim();
      const date = qrDate.value;
      const type = qrType.value.trim();
      const summary = qrSummary.value.trim();
      const blockers = [];

      if (!version) blockers.push('Version is required.');
      const existingVersions = new Set(((releasesData && releasesData.releases) || []).map(r => r.version));
      if (version && existingVersions.has(version)) {
        blockers.push('"' + version + '" is already logged, the validator rejects duplicate versions.');
      }
      if (!date) blockers.push('Ship date is required, this is when it actually shipped.');
      if (!summary) blockers.push('A summary is required, what actually changed in this release.');

      if (blockers.length) {
        qrWarnings.textContent = blockers.join(' ');
        qrOutput.hidden = true;
        qrCopyBtn.hidden = true;
        return;
      }
      qrWarnings.textContent = '';

      const obj = { version, date, type: type || null, summary, notes: null };
      qrOutput.value = JSON.stringify(obj, null, 2) + ',';
      qrOutput.hidden = false;
      qrCopyBtn.hidden = false;
    });

    qrCopyBtn.addEventListener('click', () => {
      copyText(qrOutput.value).then(() => {
        const original = qrCopyBtn.textContent;
        qrCopyBtn.textContent = 'Copied!';
        quickLogLive.textContent = 'Release JSON copied to clipboard.';
        qrDraftGuard.clearDraft();
        setTimeout(() => { qrCopyBtn.textContent = original; }, 1800);
      }).catch(() => { quickLogLive.textContent = 'Could not copy to clipboard.'; });
    });

    const qgForm = document.getElementById('quickGoalForm');
    const qgId = document.getElementById('qgId');
    const qgLabel = document.getElementById('qgLabel');
    const qgMetric = document.getElementById('qgMetric');
    const qgTarget = document.getElementById('qgTarget');
    const qgTargetDate = document.getElementById('qgTargetDate');
    const qgSetDate = document.getElementById('qgSetDate');
    const qgWarnings = document.getElementById('qgWarnings');
    const qgOutput = document.getElementById('qgOutput');
    const qgCopyBtn = document.getElementById('qgCopyBtn');

    qgSetDate.value = todayIso();
    qgSetDate.max = todayIso();
    const qgDraftGuard = attachDraftGuard(qgForm, 'sondrik-qg-draft-v1', {
      bannerId: 'qgDraftBanner', timeId: 'qgDraftBannerTime', discardId: 'qgDiscardDraftBtn',
      onDiscard: () => { qgOutput.hidden = true; qgCopyBtn.hidden = true; qgWarnings.textContent = ''; qgSetDate.value = todayIso(); }
    });

    qgForm.addEventListener('submit', e => {
      e.preventDefault();
      const id = qgId.value.trim();
      const label = qgLabel.value.trim();
      const metric = qgMetric.value;
      const target = Number(qgTarget.value);
      const targetDate = qgTargetDate.value || null;
      const setDate = qgSetDate.value;
      const blockers = [];

      if (!id) blockers.push('An id is required.');
      const existingIds = new Set(((goalsData && goalsData.goals) || []).map(g => g.id));
      if (id && existingIds.has(id)) blockers.push('"' + id + '" is already used by another goal, ids must be unique.');
      if (!label) blockers.push('A label is required.');
      if (!(Number.isFinite(target) && target > 0)) blockers.push('Target must be a positive number, this is the real number Jack is aiming for.');
      if (!setDate) blockers.push('Set date is required, the actual date this target was set.');

      if (blockers.length) {
        qgWarnings.textContent = blockers.join(' ');
        qgOutput.hidden = true;
        qgCopyBtn.hidden = true;
        return;
      }
      qgWarnings.textContent = '';

      const obj = { id, label, metric, target, targetDate, setDate, note: null };
      qgOutput.value = JSON.stringify(obj, null, 2) + ',';
      qgOutput.hidden = false;
      qgCopyBtn.hidden = false;
    });

    qgCopyBtn.addEventListener('click', () => {
      copyText(qgOutput.value).then(() => {
        const original = qgCopyBtn.textContent;
        qgCopyBtn.textContent = 'Copied!';
        quickLogLive.textContent = 'Goal JSON copied to clipboard.';
        qgDraftGuard.clearDraft();
        setTimeout(() => { qgCopyBtn.textContent = original; }, 1800);
      }).catch(() => { quickLogLive.textContent = 'Could not copy to clipboard.'; });
    });
  }

  function loadDataFile(name) {
    return fetch('/sondrik/data/' + name + '.json').then(r => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  // Each of the three files is a hand-edited record Jack can typo at any
  // time (that's the whole point of validate.js). One bad edit should only
  // degrade the section(s) that actually depend on that file, the same way
  // server.js's readLocalClusters skips one broken cluster file instead of
  // taking the whole dashboard down. Promise.all would fail all four
  // sections over a single JSON typo in, say, leads.json alone.
  Promise.allSettled([
    loadDataFile('releases'),
    loadDataFile('downloads'),
    loadDataFile('leads'),
    loadDataFile('channels'),
    loadDataFile('goals'),
    loadDataFile('changelog')
  ]).then(([releasesResult, downloadsResult, leadsResult, channelsResult, goalsResult, changelogResult]) => {
    const releasesData = releasesResult.status === 'fulfilled' ? releasesResult.value : null;
    const downloadsData = downloadsResult.status === 'fulfilled' ? downloadsResult.value : null;
    const leadsData = leadsResult.status === 'fulfilled' ? leadsResult.value : null;
    const channelsData = channelsResult.status === 'fulfilled' ? channelsResult.value : null;
    const goalsData = goalsResult.status === 'fulfilled' ? goalsResult.value : null;
    const changelogData = changelogResult.status === 'fulfilled' ? changelogResult.value : null;

    const failures = [];
    if (releasesResult.status === 'rejected') failures.push('releases.json: ' + releasesResult.reason.message);
    if (downloadsResult.status === 'rejected') failures.push('downloads.json: ' + downloadsResult.reason.message);
    if (leadsResult.status === 'rejected') failures.push('leads.json: ' + leadsResult.reason.message);
    if (channelsResult.status === 'rejected') failures.push('channels.json: ' + channelsResult.reason.message);
    if (goalsResult.status === 'rejected') failures.push('goals.json: ' + goalsResult.reason.message);

    // goalsData is included here (and below) because renderTimeline/
    // renderLastUpdated/buildStatusUpdate all genuinely read it (a GOAL SET
    // timeline event, a goal's setDate feeding "last updated"), so if
    // releases/downloads/leads all fail to load but goals.json succeeds,
    // that real data should still render instead of the section reporting
    // a total failure it didn't actually have.
    if (releasesData || downloadsData || leadsData || goalsData) {
      renderTimeline(releasesData || {}, downloadsData || {}, leadsData || {}, goalsData || {});
      renderLastUpdated(releasesData || {}, downloadsData || {}, leadsData || {}, goalsData || {});
      if (failures.length) {
        timelineSection.insertAdjacentHTML('afterbegin',
          '<div class="empty-state file-error" role="alert">Showing partial data, failed to load: ' +
          failures.map(escapeHtml).join('; ') + '</div>');
      }
    } else {
      timelineSection.innerHTML = '<div class="empty-state" role="alert">Failed to load timeline data: ' +
        failures.map(escapeHtml).join('; ') + '</div>';
    }

    if (releasesData || downloadsData || leadsData) {
      renderSnapshot(releasesData, downloadsData, leadsData);
    } else {
      snapshotStrip.innerHTML = '<div class="empty-state" role="alert">Could not compute the snapshot, data failed to load.</div>';
    }

    if (releasesData) {
      renderReleases(releasesData);
      releasesCsvBtn.addEventListener('click', () => exportReleasesCsv(releasesData));
    } else {
      releaseSection.innerHTML = '<div class="empty-state" role="alert">Failed to load release data: ' +
        escapeHtml(releasesResult.reason.message) + '</div>';
      releasesCsvBtn.disabled = true;
    }

    if (downloadsData) {
      renderTraction(downloadsData);
      csvBtn.addEventListener('click', () => exportDownloadsCsv(downloadsData));
    } else {
      tractionSection.innerHTML = '<div class="empty-state" role="alert">Failed to load traction data: ' +
        escapeHtml(downloadsResult.reason.message) + '</div>';
      csvBtn.disabled = true;
    }

    if (goalsData) {
      renderGoals(goalsData, downloadsData, leadsData);
    } else {
      goalsSection.innerHTML = '<div class="empty-state" role="alert">Failed to load goal data: ' +
        escapeHtml(goalsResult.reason.message) + '</div>';
    }

    if (channelsData) {
      renderChannels(channelsData, downloadsData, leadsData);
      channelsCsvBtn.addEventListener('click', () => exportChannelsCsv(channelsData, downloadsData, leadsData));
    } else {
      channelsSection.innerHTML = '<div class="empty-state" role="alert">Failed to load channels data: ' +
        escapeHtml(channelsResult.reason.message) + '</div>';
      channelsCsvBtn.disabled = true;
    }

    if (leadsData) {
      renderLeads(leadsData);
      renderAttentionPill(leadsData);
      leadsCsvBtn.addEventListener('click', () => exportLeadsCsv(leadsData));
    } else {
      leadsSection.innerHTML = '<div class="empty-state" role="alert">Failed to load engagement queue data: ' +
        escapeHtml(leadsResult.reason.message) + '</div>';
      leadsCsvBtn.disabled = true;
    }

    // Unlike the other files, a missing changelog.json means it just hasn't
    // been generated yet (a fresh clone before anyone ran changelog.js),
    // not necessarily a real error, so a 404 gets the same "empty" render
    // renderChangelog already gives an empty entries array rather than the
    // alarmed "Failed to load" wording the other sections use.
    if (changelogData) {
      renderChangelog(changelogData);
    } else if (changelogResult.reason && /HTTP 404/.test(changelogResult.reason.message)) {
      renderChangelog({ entries: [] });
    } else {
      changelogSection.innerHTML = '<div class="empty-state" role="alert">Failed to load the data changelog: ' +
        escapeHtml(changelogResult.reason.message) + '</div>';
    }

    if (releasesData || downloadsData || leadsData || goalsData || channelsData) {
      renderNextSteps(releasesData, downloadsData, leadsData, goalsData, channelsData);
    } else {
      nextStepsList.innerHTML = '<div class="empty-state" role="alert">Could not compute next steps, data failed to load.</div>';
    }

    if (releasesData || downloadsData || leadsData || goalsData) {
      copyStatusBtn.addEventListener('click', () => {
        const text = buildStatusUpdate(releasesData || {}, downloadsData || {}, leadsData || {}, goalsData || {}, channelsData || {});
        copyText(text).then(() => {
          const original = copyStatusBtn.textContent;
          copyStatusBtn.textContent = 'Copied!';
          copyStatusLive.textContent = 'Status update copied to clipboard.';
          setTimeout(() => { copyStatusBtn.textContent = original; }, 1800);
        }).catch(() => {
          copyStatusLive.textContent = 'Could not copy to clipboard.';
        });
      });
    } else {
      copyStatusBtn.disabled = true;
    }

    const publicPostText = buildPublicPost(releasesData || {}, downloadsData || {}, leadsData || {});
    if (publicPostText) {
      // A plain length count of the real composed text, not a guess: lets
      // Jack see at a glance whether it fits a platform's post limit (X's
      // free-tier limit is 280 characters) before he pastes it anywhere.
      copyPublicBtn.title = publicPostText.length + ' characters';
      copyPublicBtn.addEventListener('click', () => {
        copyText(publicPostText).then(() => {
          const original = copyPublicBtn.textContent;
          copyPublicBtn.textContent = 'Copied!';
          copyStatusLive.textContent = 'Build-in-public post copied to clipboard.';
          setTimeout(() => { copyPublicBtn.textContent = original; }, 1800);
        }).catch(() => {
          copyStatusLive.textContent = 'Could not copy to clipboard.';
        });
      });
    } else {
      copyPublicBtn.disabled = true;
    }

    if (releasesData || downloadsData) {
      const reminders = computeReminders(releasesData || {}, downloadsData || {});
      icsBtn.disabled = reminders.length === 0;
      if (reminders.length > 0) {
        icsBtn.addEventListener('click', () => {
          const blob = new Blob([buildRemindersIcs(reminders)], { type: 'text/calendar;charset=utf-8;' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'sondrik-reminders-' + todayIso() + '.ics';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        });
      } else {
        icsBtn.title = 'No upcoming real dates to remind on right now';
      }
    } else {
      icsBtn.disabled = true;
    }

    initQuickLogTool(channelsData || {}, downloadsData || {}, leadsData || {}, releasesData || {}, goalsData || {});

    // Full-fidelity backup: unlike the per-section CSV exports, which
    // flatten one table at a time, this keeps releases.json, downloads.json,
    // leads.json, channels.json, and goals.json exactly as loaded, so a bad
    // hand-edit to any of them can be diffed against or restored from a
    // known-good copy. Local download only, nothing is sent anywhere. Same
    // approach as CSM's own backup button.
    if (releasesData || downloadsData || leadsData || channelsData || goalsData) {
      backupBtn.disabled = false;
      backupBtn.addEventListener('click', () => {
        const backup = {
          exportedAt: new Date().toISOString(),
          source: 'Command Center Sondrik hub (/sondrik), local download only',
          releasesJson: releasesData,
          downloadsJson: downloadsData,
          leadsJson: leadsData,
          channelsJson: channelsData,
          goalsJson: goalsData,
          changelogJson: changelogData
        };
        const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'sondrik-backup-' + todayIso() + '.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      });
    } else {
      backupBtn.disabled = true;
      backupBtn.title = "Can't back up, all data files failed to load";
    }
  });

  // "?" keyboard shortcuts overlay, same markup, CSS classes, and focus-trap
  // behavior as the CGT, Garage, Alpha, and CSM hubs, closing the one gap
  // that left Sondrik as the only hub without it. Wired independently of the
  // Promise.allSettled data load above (it works even if every data file
  // fails to load), since none of its real shortcuts depend on the fetched
  // data, only on buttons and DOM structure that exist unconditionally.
  let shortcutsOpen = false;
  let shortcutsLastFocusedEl = null;

  // Only the shortcuts this page actually wires up, never an invented or
  // aspirational one. This page has no search box or custom list navigation
  // like CGT/Garage/CSM, so "C" opens the one real single-key action already
  // on the page (copy status update), the same pattern Alpha uses for its
  // own single-key actions.
  const SHORTCUTS = [
    { keys: ['C'], label: 'Copy status update' },
    { keys: ['Tab'], label: 'Cycle focus inside an open dialog' },
    { keys: ['Esc'], label: 'Close the open dialog' },
    { keys: ['?'], label: 'Show this help' }
  ];

  function renderShortcutsList() {
    document.getElementById('shortcutsList').innerHTML = SHORTCUTS.map(s =>
      '<div class="shortcut-row">' +
      '<span class="shortcut-label">' + escapeHtml(s.label) + '</span>' +
      '<span class="shortcut-keys">' +
      s.keys.map(k => '<kbd class="shortcut-key">' + escapeHtml(k) + '</kbd>').join('<span class="shortcut-label">or</span>') +
      '</span></div>'
    ).join('');
  }

  function getShortcutsFocusable() {
    return Array.from(document.getElementById('shortcutsModal').querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )).filter(el => !el.hasAttribute('disabled') && el.offsetParent !== null);
  }

  function openShortcuts() {
    if (shortcutsOpen) return;
    shortcutsOpen = true;
    shortcutsLastFocusedEl = document.activeElement;
    renderShortcutsList();
    document.getElementById('shortcutsOverlay').hidden = false;
    document.getElementById('shortcutsClose').focus();
  }

  function closeShortcuts() {
    if (!shortcutsOpen) return;
    shortcutsOpen = false;
    document.getElementById('shortcutsOverlay').hidden = true;
    if (shortcutsLastFocusedEl && typeof shortcutsLastFocusedEl.focus === 'function') shortcutsLastFocusedEl.focus();
    shortcutsLastFocusedEl = null;
  }

  document.getElementById('shortcutsBtn').addEventListener('click', openShortcuts);
  document.getElementById('shortcutsClose').addEventListener('click', closeShortcuts);
  document.getElementById('shortcutsOverlay').addEventListener('click', e => {
    if (e.target.id === 'shortcutsOverlay') closeShortcuts();
  });

  document.addEventListener('keydown', e => {
    if (!shortcutsOpen) return;
    if (e.key === 'Escape') { closeShortcuts(); return; }
    if (e.key === 'Tab') {
      const focusable = getShortcutsFocusable();
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });

  // "?" opens the overlay and "C" copies the status update, but never while
  // the shortcuts overlay is already open (Tab/Esc above own that case) or
  // while focus sits in a real text field (the quick-log forms all take
  // free text, including one with a literal "?" placeholder character).
  document.addEventListener('keydown', e => {
    if (shortcutsOpen) return;
    const active = document.activeElement;
    const tag = active && active.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (active && active.isContentEditable)) return;

    if (e.key === '?') {
      e.preventDefault();
      openShortcuts();
      return;
    }
    if (e.key === 'c' || e.key === 'C') {
      if (copyStatusBtn.disabled) return;
      e.preventDefault();
      copyStatusBtn.click();
    }
  });

  // This device's own network path (navigator.onLine plus the real
  // online/offline events), a different question from whether the last fetch
  // succeeded: the service worker can serve a cached /data/*.json response
  // successfully while genuinely offline, so "the fetch resolved" is not
  // proof this page is current. Same banner Alpha already shows for the
  // same reason.
  function updateOfflineBanner() {
    const banner = document.getElementById('offlineBanner');
    if (banner) banner.hidden = navigator.onLine;
  }
  window.addEventListener('offline', updateOfflineBanner);
  window.addEventListener('online', updateOfflineBanner);
  updateOfflineBanner();
})();

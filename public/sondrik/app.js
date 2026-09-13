(function () {
  const timelineSection = document.getElementById('timelineSection');
  const releaseSection = document.getElementById('releaseSection');
  const tractionSection = document.getElementById('tractionSection');
  const goalsSection = document.getElementById('goalsSection');
  const channelsSection = document.getElementById('channelsSection');
  const leadsSection = document.getElementById('leadsSection');
  const nextStepsList = document.getElementById('nextStepsList');
  const csvBtn = document.getElementById('csvBtn');
  const copyStatusBtn = document.getElementById('copyStatusBtn');
  const copyStatusLive = document.getElementById('copyStatusLive');
  const attentionPill = document.getElementById('attentionPill');
  const lastUpdatedSub = document.getElementById('lastUpdatedSub');

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = String(s);
    return div.innerHTML;
  }

  function fmtDate(iso) {
    if (!iso) return null;
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function daysBetween(a, b) {
    return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
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
    (metric.checks || []).forEach(c => {
      events.push({ date: c.date, kind: 'check', title: c.count + ' ' + (metric.label || 'downloads') + ' logged', detail: c.note || null });
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

    function itemHtml(e) {
      return '<li class="timeline-item timeline-kind-' + e.kind + '">' +
        '<div class="timeline-meta">' +
        '<span class="timeline-badge font-mono">' + KIND_LABEL[e.kind] + '</span>' +
        (e.date
          ? '<span class="timeline-date font-mono">' + fmtDate(e.date) + '</span>'
          : '<span class="timeline-date timeline-date-unknown font-mono">DATE NOT LOGGED</span>') +
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

  function renderReleases(data) {
    const releases = (data.releases || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    if (releases.length === 0) {
      releaseSection.innerHTML = '<div class="empty-state">No releases logged yet.</div>';
      return;
    }
    releaseSection.innerHTML = releases.map((r, idx) => {
      const rel = idx === 0 ? relativeDaysLabel(r.date) : null;
      return '<div class="release-card">' +
      '<span class="release-version font-display">v' + escapeHtml(r.version) + '</span>' +
      (r.date ? '<span class="release-date">' + fmtDate(r.date) +
        (rel ? ' <span class="release-relative font-mono">(' + rel + ')</span>' : '') + '</span>' : '') +
      (r.type ? '<span class="release-badge">' + escapeHtml(r.type).toUpperCase() + '</span>' : '') +
      '<div class="release-summary">' + escapeHtml(r.summary || 'No summary logged yet.') + '</div>' +
      '</div>';
    }).join('');
  }

  function renderTraction(data) {
    const metric = data.metric || {};
    const checks = (metric.checks || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    if (checks.length === 0) {
      tractionSection.innerHTML = '<div class="empty-state">No download checks logged yet.</div>';
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

    const ageDays = daysBetween(latest.date, todayIso());
    const STALE_AFTER_DAYS = 7;
    const isStale = ageDays > STALE_AFTER_DAYS;
    const ageLabel = ageDays <= 0 ? 'checked today' : ageDays === 1 ? 'checked 1 day ago' : 'checked ' + ageDays + ' days ago';
    const freshnessHtml = '<div class="freshness-badge ' + (isStale ? 'freshness-stale' : 'freshness-fresh') + ' font-mono">' +
      (isStale ? 'STALE, ' : '') + ageLabel.toUpperCase() +
      (isStale ? ', RE-CHECK GITHUB API' : '') +
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
      freshnessHtml +
      (metric.source ? '<div class="stat-source">' + escapeHtml(metric.source).toUpperCase() + '</div>' : '') +
      '</div>' +
      '<div class="chart-scroll">' +
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
  // has real numbers behind it so far (see VALID_GOAL_METRICS in validate.js);
  // any other metric name would have nothing real to compare the target
  // against, so this returns null rather than guessing at zero.
  function currentMetricValue(metricName, downloadsData) {
    if (metricName !== 'downloads') return null;
    const metric = (downloadsData && downloadsData.metric) || {};
    const checks = (metric.checks || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    if (checks.length === 0) return null;
    const latest = checks[checks.length - 1];
    return { count: latest.count, asOf: latest.date };
  }

  // Renders the real target-vs-actual goal Jack has logged, if any. This is
  // the standard "target vs actual" pattern from traction dashboards: a
  // benchmark, how the current real number compares to it, and a trend cue
  // (days left) for whether it's on track, at risk, or overdue. An empty
  // goals.json (the honest default until Jack sets a real target) renders
  // as a plain empty state rather than a fabricated placeholder goal.
  function renderGoals(goalsData, downloadsData) {
    const goals = (goalsData && goalsData.goals) || [];
    if (goals.length === 0) {
      goalsSection.innerHTML = '<div class="empty-state">No goal set yet. Add one to ' +
        '<code>public/sondrik/data/goals.json</code> once there is a real target to track against.</div>';
      return;
    }
    goalsSection.innerHTML = goals.map(g => {
      const current = currentMetricValue(g.metric, downloadsData);
      const currentCount = current ? current.count : 0;
      const pct = Math.max(0, Math.min(100, Math.round((currentCount / g.target) * 100)));

      let paceHtml = '';
      if (g.targetDate) {
        const daysLeft = daysBetween(todayIso(), g.targetDate);
        if (daysLeft < 0) {
          paceHtml = '<div class="goal-pace goal-pace-overdue font-mono">TARGET DATE PASSED, ' + fmtDate(g.targetDate).toUpperCase() + '</div>';
        } else {
          const daysLeftLabel = daysLeft === 0 ? 'DUE TODAY' : daysLeft === 1 ? '1 DAY LEFT' : daysLeft + ' DAYS LEFT';
          paceHtml = '<div class="goal-pace font-mono">' + daysLeftLabel + ', BY ' + fmtDate(g.targetDate).toUpperCase() + '</div>';
        }
      }

      const setLabel = g.setDate ? 'Goal set ' + fmtDate(g.setDate) : 'No set date logged';
      const currentNote = current
        ? 'Current: ' + currentCount + ' as of ' + fmtDate(current.asOf)
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
        paceHtml +
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
      channelsSection.innerHTML = '<div class="empty-state">No channels logged yet.</div>';
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
    const STALE_AFTER_DAYS = 7;
    const isStale = daysBetween(latest, todayIso()) > STALE_AFTER_DAYS;

    lastUpdatedSub.hidden = false;
    lastUpdatedSub.classList.toggle('last-updated-stale', isStale);
    lastUpdatedSub.textContent = 'Last real update logged: ' + fmtDate(latest) + (rel ? ' (' + rel + ')' : '') +
      (isStale ? ', over a week old' : '');
  }

  // Surfaces the single most actionable fact on the page, real drafted
  // outreach sitting on a human approval, as a header pill rather than
  // making a visitor read the whole engagement queue to find it.
  function renderAttentionPill(data) {
    const leads = data.leads || [];
    const pending = leads.filter(l => {
      const o = l.outreach || {};
      return !o.sent && o.approvalStatus === 'awaiting-approval';
    });
    if (pending.length === 0) {
      attentionPill.hidden = true;
      document.title = 'Sondrik / Command Center';
      return;
    }
    attentionPill.hidden = false;
    attentionPill.textContent = pending.length + (pending.length === 1 ? ' draft awaiting your approval' : ' drafts awaiting your approval');
    document.title = '(' + pending.length + ') Sondrik / Command Center';
  }

  function renderLeads(data) {
    const leads = data.leads || [];
    if (leads.length === 0) {
      leadsSection.innerHTML = '<div class="empty-state">No leads logged yet.</div>';
      return;
    }
    leadsSection.innerHTML = leads.map(l => {
      const o = l.outreach || {};
      const pillText = o.sent
        ? 'SENT'
        : (o.approvalStatus === 'awaiting-approval' ? 'DRAFT READY, AWAITING APPROVAL' : (o.draftStatus || 'NO DRAFT YET').toUpperCase());
      const pillClass = o.sent ? 'status-pill status-pill-sent' : 'status-pill';
      return '<div class="lead-card">' +
        '<div class="lead-head">' +
        '<span class="lead-source">' + escapeHtml(l.sourceDetail || l.source || 'Unknown source') + '</span>' +
        (l.type ? '<span class="lead-type font-mono">' + escapeHtml(l.type.replace(/-/g, ' ').toUpperCase()) + '</span>' : '') +
        '</div>' +
        '<div class="lead-summary">' + escapeHtml(l.summary || 'No summary logged.') + '</div>' +
        '<div class="lead-status-row">' +
        '<span class="' + pillClass + ' font-mono">' + escapeHtml(pillText) + '</span>' +
        '</div>' +
        (o.note ? '<div class="lead-note">' + escapeHtml(o.note) + '</div>' : '') +
        '</div>';
    }).join('');
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
    const STALE_AFTER_DAYS = 7;
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

    const leads = (leadsData && leadsData.leads) || [];
    leads.forEach(l => {
      const o = l.outreach || {};
      if (!o.sent && o.approvalStatus === 'awaiting-approval') {
        steps.push({
          urgent: true,
          text: 'Approve or send the drafted message to ' + (l.sourceDetail || l.source || 'this lead') + '.',
          href: '#leadsSection'
        });
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

    const goals = (goalsData && goalsData.goals) || [];
    if (goals.length === 0) {
      steps.push({
        urgent: false,
        text: 'Set a real target in goals.json once there is one worth tracking against.',
        href: '#goalsSection'
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
  function buildStatusUpdate(releasesData, downloadsData, leadsData, goalsData) {
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
        const current = currentMetricValue(g.metric, downloadsData);
        const currentCount = current ? current.count : 0;
        lines.push('Goal: ' + g.label + ', ' + currentCount + ' / ' + g.target +
          (g.targetDate ? ' by ' + fmtDate(g.targetDate) : ''));
      });
    }

    return lines.join('\n');
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
    const s = v == null ? '' : String(v);
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
    a.download = 'sondrik-download-checks-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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
    loadDataFile('goals')
  ]).then(([releasesResult, downloadsResult, leadsResult, channelsResult, goalsResult]) => {
    const releasesData = releasesResult.status === 'fulfilled' ? releasesResult.value : null;
    const downloadsData = downloadsResult.status === 'fulfilled' ? downloadsResult.value : null;
    const leadsData = leadsResult.status === 'fulfilled' ? leadsResult.value : null;
    const channelsData = channelsResult.status === 'fulfilled' ? channelsResult.value : null;
    const goalsData = goalsResult.status === 'fulfilled' ? goalsResult.value : null;

    const failures = [];
    if (releasesResult.status === 'rejected') failures.push('releases.json: ' + releasesResult.reason.message);
    if (downloadsResult.status === 'rejected') failures.push('downloads.json: ' + downloadsResult.reason.message);
    if (leadsResult.status === 'rejected') failures.push('leads.json: ' + leadsResult.reason.message);
    if (channelsResult.status === 'rejected') failures.push('channels.json: ' + channelsResult.reason.message);
    if (goalsResult.status === 'rejected') failures.push('goals.json: ' + goalsResult.reason.message);

    if (releasesData || downloadsData || leadsData) {
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

    if (releasesData) {
      renderReleases(releasesData);
    } else {
      releaseSection.innerHTML = '<div class="empty-state" role="alert">Failed to load release data: ' +
        escapeHtml(releasesResult.reason.message) + '</div>';
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
      renderGoals(goalsData, downloadsData);
    } else {
      goalsSection.innerHTML = '<div class="empty-state" role="alert">Failed to load goal data: ' +
        escapeHtml(goalsResult.reason.message) + '</div>';
    }

    if (channelsData) {
      renderChannels(channelsData, downloadsData, leadsData);
    } else {
      channelsSection.innerHTML = '<div class="empty-state" role="alert">Failed to load channels data: ' +
        escapeHtml(channelsResult.reason.message) + '</div>';
    }

    if (leadsData) {
      renderLeads(leadsData);
      renderAttentionPill(leadsData);
    } else {
      leadsSection.innerHTML = '<div class="empty-state" role="alert">Failed to load engagement queue data: ' +
        escapeHtml(leadsResult.reason.message) + '</div>';
    }

    if (releasesData || downloadsData || leadsData || goalsData || channelsData) {
      renderNextSteps(releasesData, downloadsData, leadsData, goalsData, channelsData);
    } else {
      nextStepsList.innerHTML = '<div class="empty-state" role="alert">Could not compute next steps, data failed to load.</div>';
    }

    if (releasesData || downloadsData || leadsData) {
      copyStatusBtn.addEventListener('click', () => {
        const text = buildStatusUpdate(releasesData || {}, downloadsData || {}, leadsData || {}, goalsData || {});
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
  });
})();

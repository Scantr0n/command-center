(function () {
  const timelineSection = document.getElementById('timelineSection');
  const releaseSection = document.getElementById('releaseSection');
  const tractionSection = document.getElementById('tractionSection');
  const leadsSection = document.getElementById('leadsSection');
  const csvBtn = document.getElementById('csvBtn');
  const copyStatusBtn = document.getElementById('copyStatusBtn');
  const copyStatusLive = document.getElementById('copyStatusLive');
  const attentionPill = document.getElementById('attentionPill');

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

  // Same "N days ago" phrasing the download freshness badge already uses,
  // applied to any other real logged date so recency reads consistently
  // across the page instead of leaving a reader to do the date math.
  function relativeDaysLabel(iso) {
    if (!iso) return null;
    const todayIso = new Date().toISOString().slice(0, 10);
    const age = daysBetween(iso, todayIso);
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
  function renderTimeline(releasesData, downloadsData, leadsData) {
    const KIND_LABEL = { release: 'RELEASE', check: 'DOWNLOAD CHECK', lead: 'LEAD' };
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

    const todayIso = new Date().toISOString().slice(0, 10);
    const ageDays = daysBetween(latest.date, todayIso);
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
      '<div class="compare-bars" role="img" aria-label="' +
        escapeHtml((metric.label || 'Download') + ' history by check date: ' + chartSummary) + '">' +
        barsHtml +
      '</div>' +
      '</div>' +
      '<table class="sr-only-table">' +
      '<caption>' + escapeHtml(metric.label || 'downloads') + ', full check history</caption>' +
      '<thead><tr><th scope="col">Check date</th><th scope="col">Count</th></tr></thead>' +
      '<tbody>' + tableRowsHtml + '</tbody>' +
      '</table>' +
      (metric.scope ? '<div class="scope-note">' + escapeHtml(metric.scope) + '</div>' : '');
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

  // Builds a plain-text snapshot from the same three real data files already
  // on the page, for Jack to paste into a build log or status update himself.
  // Purely a clipboard copy, nothing here ever transmits anywhere on its own.
  function buildStatusUpdate(releasesData, downloadsData, leadsData) {
    const lines = ['Sondrik status snapshot, generated ' + fmtDate(new Date().toISOString().slice(0, 10))];

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
    loadDataFile('leads')
  ]).then(([releasesResult, downloadsResult, leadsResult]) => {
    const releasesData = releasesResult.status === 'fulfilled' ? releasesResult.value : null;
    const downloadsData = downloadsResult.status === 'fulfilled' ? downloadsResult.value : null;
    const leadsData = leadsResult.status === 'fulfilled' ? leadsResult.value : null;

    const failures = [];
    if (releasesResult.status === 'rejected') failures.push('releases.json: ' + releasesResult.reason.message);
    if (downloadsResult.status === 'rejected') failures.push('downloads.json: ' + downloadsResult.reason.message);
    if (leadsResult.status === 'rejected') failures.push('leads.json: ' + leadsResult.reason.message);

    if (releasesData || downloadsData || leadsData) {
      renderTimeline(releasesData || {}, downloadsData || {}, leadsData || {});
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

    if (leadsData) {
      renderLeads(leadsData);
      renderAttentionPill(leadsData);
    } else {
      leadsSection.innerHTML = '<div class="empty-state" role="alert">Failed to load engagement queue data: ' +
        escapeHtml(leadsResult.reason.message) + '</div>';
    }

    if (releasesData || downloadsData || leadsData) {
      copyStatusBtn.addEventListener('click', () => {
        const text = buildStatusUpdate(releasesData || {}, downloadsData || {}, leadsData || {});
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

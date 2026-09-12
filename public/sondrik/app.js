(function () {
  const releaseSection = document.getElementById('releaseSection');
  const tractionSection = document.getElementById('tractionSection');
  const leadsSection = document.getElementById('leadsSection');
  const csvBtn = document.getElementById('csvBtn');
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

  function renderReleases(data) {
    const releases = (data.releases || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    if (releases.length === 0) {
      releaseSection.innerHTML = '<div class="empty-state">No releases logged yet.</div>';
      return;
    }
    releaseSection.innerHTML = releases.map(r =>
      '<div class="release-card">' +
      '<span class="release-version font-display">v' + escapeHtml(r.version) + '</span>' +
      (r.date ? '<span class="release-date">' + fmtDate(r.date) + '</span>' : '') +
      (r.type ? '<span class="release-badge">' + escapeHtml(r.type).toUpperCase() + '</span>' : '') +
      '<div class="release-summary">' + escapeHtml(r.summary || 'No summary logged yet.') + '</div>' +
      '</div>'
    ).join('');
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
    if (checks.length > 1) {
      const delta = latest.count - first.count;
      const span = daysBetween(first.date, latest.date);
      deltaHtml = '<div class="stat-delta">' + (delta >= 0 ? '+' : '') + delta +
        ' vs ' + fmtDate(first.date) + ' check (' + span + 'd earlier)</div>';
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

    const barsHtml = checks.map(c => {
      const heightPct = c.count === 0 ? 0 : Math.max(4, Math.round((c.count / maxCount) * 100));
      return '<div class="compare-bar-col">' +
        '<span class="compare-bar-count font-mono">' + c.count + '</span>' +
        '<div class="compare-bar" style="height:70px">' +
        '<div class="compare-bar-fill" style="height:' + heightPct + '%"></div>' +
        '</div>' +
        '<span class="compare-bar-date">' + fmtDate(c.date) + '</span>' +
        '</div>';
    }).join('<span class="compare-gap-note" aria-hidden="true">no daily tracking between checks</span>');

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
        '</div>' +
        '<div class="lead-summary">' + escapeHtml(l.summary || 'No summary logged.') + '</div>' +
        '<div class="lead-status-row">' +
        '<span class="' + pillClass + ' font-mono">' + escapeHtml(pillText) + '</span>' +
        '</div>' +
        (o.note ? '<div class="lead-note">' + escapeHtml(o.note) + '</div>' : '') +
        '</div>';
    }).join('');
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

  Promise.all([
    fetch('/sondrik/data/releases.json').then(r => r.json()),
    fetch('/sondrik/data/downloads.json').then(r => r.json()),
    fetch('/sondrik/data/leads.json').then(r => r.json())
  ]).then(([releasesData, downloadsData, leadsData]) => {
    renderReleases(releasesData);
    renderTraction(downloadsData);
    renderLeads(leadsData);
    renderAttentionPill(leadsData);
    csvBtn.addEventListener('click', () => exportDownloadsCsv(downloadsData));
  }).catch(err => {
    releaseSection.innerHTML = '<div class="empty-state" role="alert">Failed to load release data: ' + escapeHtml(err.message) + '</div>';
    tractionSection.innerHTML = '<div class="empty-state">Failed to load.</div>';
    leadsSection.innerHTML = '<div class="empty-state">Failed to load.</div>';
    csvBtn.disabled = true;
  });
})();

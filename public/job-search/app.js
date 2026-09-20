(function () {
  // Real loaded data, kept at module scope (same convention as the other 5
  // hubs' rawXData variables) so the backup button below can bundle exactly
  // what actually rendered, not force a redundant re-fetch on click.
  let rawApplicationsData = null;
  let rawCriteriaData = null;
  let rawNextUpData = null;
  let rawDigestData = null;

  const snapshotStrip = document.getElementById('snapshotStrip');
  const applicationsTableWrap = document.getElementById('applicationsTableWrap');
  const applicationsAsides = document.getElementById('applicationsAsides');
  const criteriaList = document.getElementById('criteriaList');
  const dealbreakerIntro = document.getElementById('dealbreakerIntro');
  const dealbreakerList = document.getElementById('dealbreakerList');
  const nextUpTitle = document.getElementById('nextUpTitle');
  const nextUpIntro = document.getElementById('nextUpIntro');
  const nextUpCostNote = document.getElementById('nextUpCostNote');
  const nextUpGrid = document.getElementById('nextUpGrid');
  const nextUpOlderNote = document.getElementById('nextUpOlderNote');
  const digestTitle = document.getElementById('digestTitle');
  const digestSummary = document.getElementById('digestSummary');
  const digestGrid = document.getElementById('digestGrid');
  const digestRelocationNote = document.getElementById('digestRelocationNote');
  const digestExcludedNote = document.getElementById('digestExcludedNote');
  const digestSourcingNote = document.getElementById('digestSourcingNote');
  const printBtn = document.getElementById('printBtn');

  printBtn.addEventListener('click', () => window.print());

  // Same real local-download-only backup the other 5 hubs already have;
  // this one just never got it when the hub shipped. Only bundles whatever
  // actually loaded, real honest gaps stay gaps rather than getting padded
  // with a fabricated empty section for a file that failed to fetch.
  document.getElementById('backupBtn').addEventListener('click', () => {
    if (!rawApplicationsData && !rawCriteriaData && !rawNextUpData && !rawDigestData) return;
    const backup = {
      exportedAt: new Date().toISOString(),
      source: 'Command Center Job Search hub (/job-search), local download only',
      applicationsJson: rawApplicationsData,
      criteriaJson: rawCriteriaData,
      nextUpJson: rawNextUpData,
      digestLatestJson: rawDigestData
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'job-search-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  // div.textContent round-trips escape &amp;/&lt;/&gt; but not quotes, so a
  // hand-typed value with a " or ' could break out of an attribute. Same
  // regex-based escape Sondrik/CGT/Garage all use for exactly that reason.
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

  function loadDataFile(name) {
    return fetch('/job-search/data/' + name + '.json').then(r => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function renderSnapshot(applicationsData, digestData) {
    const apps = (applicationsData && applicationsData.applications) || [];
    const saved = (applicationsData && applicationsData.savedCount) || {};
    const chips = [];

    chips.push({
      number: apps.length,
      label: 'Applications submitted',
      meta: apps.length ? 'Most recent: ' + (fmtDate(apps[apps.length - 1].appliedDate) || 'undated') : null
    });

    chips.push({
      number: typeof saved.count === 'number' ? saved.count : 'N/A',
      label: 'Currently saved',
      meta: saved.asOfDate
        ? 'Last stated ' + fmtDate(saved.asOfDate) + ', not reconfirmed since'
        : 'No dated confirmation on record'
    });

    if (digestData && digestData.runDate) {
      chips.push({ number: fmtDate(digestData.runDate), label: 'Most recent digest run', meta: 'Automated daily digest' });
      chips.push({
        number: typeof digestData.fullyVerifiedCount === 'number' ? digestData.fullyVerifiedCount : 'N/A',
        label: 'Verified leads in latest run',
        meta: typeof digestData.totalItemsCount === 'number' ? (digestData.totalItemsCount + ' item(s) reviewed total') : null
      });
    }

    snapshotStrip.innerHTML = chips.map(c =>
      '<div class="snapshot-chip">' +
      '<div class="snapshot-chip-number font-display">' + escapeHtml(String(c.number)) + '</div>' +
      '<div class="snapshot-chip-label">' + escapeHtml(c.label) + '</div>' +
      (c.meta ? '<div class="snapshot-chip-meta">' + escapeHtml(c.meta) + '</div>' : '') +
      '</div>'
    ).join('');
  }

  function renderApplications(data) {
    const apps = data.applications || [];
    if (!apps.length) {
      applicationsTableWrap.innerHTML = '<div class="empty-state">No applications logged yet.</div>';
    } else {
      applicationsTableWrap.innerHTML =
        '<div class="data-table-wrap"><table class="data-table"><thead><tr>' +
        '<th>#</th><th>Role</th><th>Company</th><th>Location</th><th>Pay</th><th>Applied</th>' +
        '</tr></thead><tbody>' +
        apps.map(a =>
          '<tr>' +
          '<td class="num-col" data-label="#">' + escapeHtml(String(a.num)) + '</td>' +
          '<td data-label="Role">' + escapeHtml(a.role) + '</td>' +
          '<td data-label="Company">' + escapeHtml(a.company) + '</td>' +
          '<td data-label="Location">' + escapeHtml(a.location) + '</td>' +
          '<td class="pay-col" data-label="Pay">' + escapeHtml(a.pay) + '</td>' +
          '<td data-label="Applied">' + escapeHtml(fmtDate(a.appliedDate) || 'undated') + '</td>' +
          '</tr>'
        ).join('') +
        '</tbody></table></div>';
    }

    const asides = [];
    const dropped = data.dropped || [];
    const skipped = data.skipped || [];
    if (dropped.length) {
      asides.push(
        '<div class="sub-list-heading">Dropped after verification passed, by Jack’s own judgment</div>' +
        '<ul class="sub-list">' + dropped.map(d =>
          '<li class="sub-list-item"><strong>' + escapeHtml(d.company) + '</strong>: ' + escapeHtml(d.reason) + '</li>'
        ).join('') + '</ul>'
      );
    }
    if (skipped.length) {
      asides.push(
        '<div class="sub-list-heading">Skipped, real logistics conflict, not a fit-quality issue</div>' +
        '<ul class="sub-list">' + skipped.map(s =>
          '<li class="sub-list-item"><strong>' + escapeHtml(s.company) + '</strong>: ' + escapeHtml(s.reason) + '</li>'
        ).join('') + '</ul>'
      );
    }
    applicationsAsides.innerHTML = asides.join('');
  }

  function renderCriteria(data) {
    const items = data.standingCriteria || [];
    criteriaList.innerHTML = items.length
      ? items.map(c => '<li class="criteria-item">' + escapeHtml(c) + '</li>').join('')
      : '<div class="empty-state">No standing criteria logged yet.</div>';

    const db = data.dealbreakers || {};
    dealbreakerIntro.textContent = db.intro || '';
    const dbItems = db.items || [];
    dealbreakerList.innerHTML = dbItems.length
      ? dbItems.map((it, i) =>
          '<li class="dealbreaker-item"><span class="dealbreaker-num">' + (i + 1) + '.</span><span>' + escapeHtml(it) + '</span></li>'
        ).join('')
      : '<div class="empty-state">No dealbreaker checklist logged yet.</div>';
  }

  function leadMetaRow(lead) {
    const parts = [];
    if (lead.pay) parts.push(lead.pay);
    if (lead.hours) parts.push(lead.hours);
    if (lead.remote) parts.push(lead.remote);
    if (lead.location) parts.push(lead.location);
    if (!parts.length) return '';
    return '<div class="lead-meta-row">' + parts.map(p => '<span>' + escapeHtml(p) + '</span>').join('') + '</div>';
  }

  function leadCard(lead, opts) {
    opts = opts || {};
    return '<div class="lead-card' + (opts.best ? ' lead-best' : '') + '">' +
      (opts.best ? '<span class="lead-badge">Best overall fit</span>' : '') +
      '<div class="lead-name">' + escapeHtml(lead.name) + '</div>' +
      leadMetaRow(lead) +
      (lead.detail ? '<div class="lead-detail">' + escapeHtml(lead.detail) + '</div>' : '') +
      (lead.caveat ? '<div class="lead-caveat">' + escapeHtml(lead.caveat) + '</div>' : '') +
      (lead.sourceUrl
        ? '<a class="lead-source" href="' + escapeHtml(lead.sourceUrl) + '" target="_blank" rel="noopener noreferrer">' +
          escapeHtml(lead.sourceLabel || 'Source link') + ' ↗</a>'
        : '') +
      '</div>';
  }

  function renderNextUp(data) {
    nextUpTitle.textContent = 'Next up / current focus (as of ' + (fmtDate(data.asOfDate) || data.asOfDate) + ')';
    nextUpIntro.textContent = data.intro || '';
    nextUpCostNote.textContent = data.costOfWaitingNote || '';
    const standouts = data.standouts || [];
    nextUpGrid.innerHTML = standouts.length
      ? standouts.map(s => leadCard(s)).join('')
      : '<div class="empty-state">No standout leads logged in this section.</div>';
    nextUpOlderNote.textContent = data.olderLeadsNote || '';
  }

  function renderDigest(data) {
    digestTitle.textContent = 'Latest digest run (' + (fmtDate(data.runDate) || data.runDate) + ')';
    // Same typeof guard renderSnapshot already applies to these two exact
    // fields (see its own fullyVerifiedCount/totalItemsCount chips above):
    // this file is hand-edited, so a missing or typo'd field should read as
    // "N/A", never interpolate as the literal string "undefined"/"null".
    const verifiedCount = typeof data.fullyVerifiedCount === 'number' ? data.fullyVerifiedCount : 'N/A';
    const totalCount = typeof data.totalItemsCount === 'number' ? data.totalItemsCount : 'N/A';
    digestSummary.textContent = 'Fully verified (' + verifiedCount + '), ' + totalCount + ' items total.';

    const cards = [];
    if (data.bestOverallFit) cards.push(leadCard(data.bestOverallFit, { best: true }));
    (data.otherVerifiedByPay || []).forEach(l => cards.push(leadCard(l)));
    (data.verifiedPayUndisclosed || []).forEach(l => cards.push(leadCard(Object.assign({}, l, {
      pay: 'Pay undisclosed'
    }))));

    digestGrid.innerHTML = cards.length ? cards.join('') : '<div class="empty-state">No verified leads logged for this run.</div>';
    digestRelocationNote.textContent = data.relocationSponsorshipNote || '';
    digestExcludedNote.textContent = data.excludedNote || '';
    digestSourcingNote.textContent = data.sourcingNotes || '';
  }

  // Each data file is a hand-edited record Jack (or a session working on his
  // behalf) can typo at any time, that's the whole point of validate.js. One
  // bad edit should only degrade the section(s) that actually depend on that
  // file, not take the whole page down, same convention as Sondrik's app.js.
  Promise.allSettled([
    loadDataFile('applications'),
    loadDataFile('criteria'),
    loadDataFile('next-up'),
    loadDataFile('digest-latest')
  ]).then(([applicationsResult, criteriaResult, nextUpResult, digestResult]) => {
    const applicationsData = applicationsResult.status === 'fulfilled' ? applicationsResult.value : null;
    const criteriaData = criteriaResult.status === 'fulfilled' ? criteriaResult.value : null;
    const nextUpData = nextUpResult.status === 'fulfilled' ? nextUpResult.value : null;
    const digestData = digestResult.status === 'fulfilled' ? digestResult.value : null;
    rawApplicationsData = applicationsData;
    rawCriteriaData = criteriaData;
    rawNextUpData = nextUpData;
    rawDigestData = digestData;
    const backupBtn = document.getElementById('backupBtn');
    if (applicationsData || criteriaData || nextUpData || digestData) {
      backupBtn.disabled = false;
      backupBtn.title = (applicationsData && criteriaData && nextUpData && digestData)
        ? ''
        : 'Some data failed to load, backup will only include what actually loaded';
    } else {
      backupBtn.disabled = true;
      backupBtn.title = "Can't back up, no data loaded (see errors below)";
    }

    if (applicationsData || digestData) {
      renderSnapshot(applicationsData || {}, digestData);
    } else {
      snapshotStrip.innerHTML = '<div class="empty-state" role="alert">Could not compute the snapshot, data failed to load.</div>';
    }

    if (applicationsData) {
      renderApplications(applicationsData);
    } else {
      applicationsTableWrap.innerHTML = '<div class="empty-state" role="alert">Failed to load applications data: ' +
        escapeHtml(applicationsResult.reason.message) + '</div>';
    }

    if (criteriaData) {
      renderCriteria(criteriaData);
    } else {
      const msg = '<div class="empty-state" role="alert">Failed to load criteria data: ' +
        escapeHtml(criteriaResult.reason.message) + '</div>';
      criteriaList.innerHTML = msg;
      dealbreakerList.innerHTML = msg;
    }

    if (nextUpData) {
      renderNextUp(nextUpData);
    } else {
      nextUpGrid.innerHTML = '<div class="empty-state" role="alert">Failed to load next-up data: ' +
        escapeHtml(nextUpResult.reason.message) + '</div>';
    }

    if (digestData) {
      renderDigest(digestData);
    } else {
      digestGrid.innerHTML = '<div class="empty-state" role="alert">Failed to load latest-digest data: ' +
        escapeHtml(digestResult.reason.message) + '</div>';
    }
  });

  // Keyboard shortcuts overlay, same markup/behavior as the other hubs.
  let shortcutsOpen = false;
  let shortcutsLastFocusedEl = null;
  const SHORTCUTS = [
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

  function lockBodyScroll() { document.body.style.overflow = 'hidden'; }
  function unlockBodyScroll() { document.body.style.overflow = ''; }

  function openShortcuts() {
    if (shortcutsOpen) return;
    shortcutsOpen = true;
    shortcutsLastFocusedEl = document.activeElement;
    renderShortcutsList();
    document.getElementById('shortcutsOverlay').hidden = false;
    lockBodyScroll();
    document.getElementById('shortcutsClose').focus();
  }

  function closeShortcuts() {
    if (!shortcutsOpen) return;
    shortcutsOpen = false;
    document.getElementById('shortcutsOverlay').hidden = true;
    unlockBodyScroll();
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

  document.addEventListener('keydown', e => {
    if (shortcutsOpen) return;
    const active = document.activeElement;
    const tag = active && active.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (active && active.isContentEditable)) return;
    if (e.key === '?') {
      e.preventDefault();
      openShortcuts();
    }
  });

  // This device's own network path (navigator.onLine plus the real
  // online/offline events), same banner Sondrik/Alpha already show for the
  // same reason: a successful fetch doesn't prove the page is current if a
  // service worker served a cached response while genuinely offline.
  function updateOfflineBanner() {
    const banner = document.getElementById('offlineBanner');
    if (banner) banner.hidden = navigator.onLine;
  }
  window.addEventListener('offline', updateOfflineBanner);
  window.addEventListener('online', updateOfflineBanner);
  updateOfflineBanner();
})();

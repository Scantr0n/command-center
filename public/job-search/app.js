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

  // Same csvField escape the other 5 hubs already use, copied verbatim: CSV
  // formula injection (OWASP) is a real risk here too, since a hand-typed
  // note starting with =, +, -, @, tab, or a carriage return is read as a
  // live formula by Excel/Sheets when this export is opened there, not as
  // plain text. A leading single quote is the standard mitigation both
  // recommend.
  function csvField(v) {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  // Same real local CSV export the other 5 hubs already have, just never
  // shipped on this one. Exports the same 6 columns as the on-page
  // Applications table (renderApplications below), in the same order,
  // so the file matches what's on screen.
  document.getElementById('csvBtn').addEventListener('click', () => {
    if (!rawApplicationsData) return;
    const apps = rawApplicationsData.applications || [];
    const header = ['#', 'Role', 'Company', 'Location', 'Pay', 'Applied'].map(csvField).join(',');
    const lines = apps.map(a => [
      a.num, a.role, a.company, a.location, a.pay, fmtDate(a.appliedDate) || 'undated'
    ].map(csvField).join(','));
    const csv = [header, ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'job-search-applications-' + new Date().toISOString().slice(0, 10) + '.csv';
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

  // ISO "YYYY-MM-DD" strings compare correctly with plain >, so this finds
  // the real most-recent appliedDate rather than assuming applications.json
  // is always hand-edited in chronological append order (a backfilled entry
  // added out of order would otherwise silently show the wrong "most recent"
  // date below). Entries with no appliedDate logged yet are skipped, not
  // treated as older or newer than a real date.
  function mostRecentAppliedDate(apps) {
    let latest = null;
    apps.forEach(a => {
      if (a.appliedDate && (!latest || a.appliedDate > latest)) latest = a.appliedDate;
    });
    return latest;
  }

  function loadDataFile(name) {
    return fetch('/job-search/data/' + name + '.json').then(r => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  // Real glyphs, one per snapshot card, same "hub within a hub" pattern
  // just shipped on Sondrik: each card is a real link into the section it
  // summarizes (jumpToSection below), not a dead number tile. Centered on
  // (0,0) at roughly an 18x18 box.
  const SNAPSHOT_ICON = {
    applications: '<path d="M-6,-8 L4,-8 Q6,-8 6,-6 L6,7 Q6,9 4,9 L-6,9 Q-8,9 -8,7 L-8,-6 Q-8,-8 -6,-8 Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M-4.5,0 L-1,3.5 L5,-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
    saved: '<path d="M-5,-8 L5,-8 Q6,-8 6,-7 L6,8 L0,4 L-6,8 L-6,-7 Q-6,-8 -5,-8 Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
    digest: '<rect x="-7.5" y="-6.5" width="15" height="14" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><line x1="-7.5" y1="-2.5" x2="7.5" y2="-2.5" stroke="currentColor" stroke-width="1.4"/><line x1="-4" y1="-8.5" x2="-4" y2="-5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><line x1="4" y1="-8.5" x2="4" y2="-5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
    verified: '<circle cx="0" cy="0" r="8.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M-4,0 L-1,3.5 L4.5,-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>'
  };
  const SNAPSHOT_TARGET = { applications: 'applicationsSection', saved: 'applicationsSection', digest: 'digestSection', verified: 'digestSection' };

  // Real "clicked through" confirmation, identical pattern to Sondrik's
  // jumpToSection: a brief highlight on the section a card actually jumps
  // to, so a click on this long, mostly-static page gives visible feedback
  // instead of a silent scroll.
  let sectionFlashTimer = null;
  function jumpToSection(targetId) {
    const el = document.getElementById(targetId);
    if (!el) return;
    el.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    clearTimeout(sectionFlashTimer);
    document.querySelectorAll('.section-flash').forEach(n => n.classList.remove('section-flash'));
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el.classList.add('section-flash');
      sectionFlashTimer = setTimeout(() => el.classList.remove('section-flash'), 1600);
    }));
  }

  function renderSnapshot(applicationsData, digestData) {
    const apps = (applicationsData && applicationsData.applications) || [];
    const saved = (applicationsData && applicationsData.savedCount) || {};
    const chips = [];

    chips.push({
      kind: 'applications',
      number: apps.length,
      label: 'Applications submitted',
      meta: apps.length ? 'Most recent: ' + (fmtDate(mostRecentAppliedDate(apps)) || 'undated') : null
    });

    chips.push({
      kind: 'saved',
      number: typeof saved.count === 'number' ? saved.count : 'N/A',
      label: 'Currently saved',
      meta: saved.asOfDate
        ? 'Last stated ' + fmtDate(saved.asOfDate) + ', not reconfirmed since'
        : 'No dated confirmation on record'
    });

    if (digestData && digestData.runDate) {
      chips.push({ kind: 'digest', number: fmtDate(digestData.runDate), label: 'Most recent digest run', meta: 'Automated daily digest' });
      chips.push({
        kind: 'verified',
        number: typeof digestData.fullyVerifiedCount === 'number' ? digestData.fullyVerifiedCount : 'N/A',
        label: 'Verified leads in latest run',
        meta: typeof digestData.totalItemsCount === 'number' ? (digestData.totalItemsCount + ' item(s) reviewed total') : null
      });
    }

    snapshotStrip.innerHTML = chips.map(c =>
      '<a href="#' + SNAPSHOT_TARGET[c.kind] + '" class="snapshot-chip snapshot-chip-' + c.kind + '" data-target="' + SNAPSHOT_TARGET[c.kind] + '">' +
      '<div class="snapshot-chip-icon"><svg viewBox="-10 -10 20 20" width="18" height="18" aria-hidden="true">' + SNAPSHOT_ICON[c.kind] + '</svg></div>' +
      '<div class="snapshot-chip-number font-display">' + escapeHtml(String(c.number)) + '</div>' +
      '<div class="snapshot-chip-label">' + escapeHtml(c.label) + '</div>' +
      (c.meta ? '<div class="snapshot-chip-meta">' + escapeHtml(c.meta) + '</div>' : '') +
      '</a>'
    ).join('');

    snapshotStrip.querySelectorAll('.snapshot-chip').forEach(el => {
      el.addEventListener('click', (event) => {
        event.preventDefault();
        jumpToSection(el.dataset.target);
      });
    });
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
    // CSV export only needs the applications table itself, unlike the
    // full-fidelity backup above which bundles whatever loaded across all
    // four files, so it's gated on applicationsData alone rather than any
    // of the four.
    const csvBtn = document.getElementById('csvBtn');
    if (applicationsData) {
      csvBtn.disabled = false;
      csvBtn.title = '';
    } else {
      csvBtn.disabled = true;
      csvBtn.title = "Can't export, applications data failed to load";
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

  // Same scrollbar-width compensation the other 5 hubs already have: without
  // it, hiding the scrollbar on overflow:hidden shifts all page content
  // left by its width for as long as the shortcuts modal is open, a real,
  // visible jump on any page tall enough to actually have a scrollbar.
  function lockBodyScroll() {
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    if (scrollbarWidth > 0) document.body.style.paddingRight = scrollbarWidth + 'px';
    document.body.style.overflow = 'hidden';
  }
  function unlockBodyScroll() {
    document.body.style.overflow = '';
    document.body.style.paddingRight = '';
  }

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

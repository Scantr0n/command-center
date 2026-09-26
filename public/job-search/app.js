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
  const changelogFeedEl = document.getElementById('changelogFeed');

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

  // Shared, unit-tested CSV serialization (export-core.js): csvField's
  // CSV/formula-injection guard now has a real regression test instead of
  // only ever running live in a browser, same shared-core pattern
  // Sondrik/Alpha/Garage/CGT already use.
  const { csvField } = window.JobSearchExportCore;

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

  // Shared, unit-tested XSS guard (html-core.js): escapeHtml now has a real
  // regression test instead of only ever running live in a browser, same
  // shared-core pattern used for csvField above.
  const { escapeHtml } = window.JobSearchHtmlCore;

  function fmtDate(iso) {
    if (!iso) return null;
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // Click-to-sort Applications table, same aria-sort/tabindex pattern CGT's
  // card table and Garage's listings table already use, just never shipped
  // on this hub's own table. Defaults to "num" ascending, the order the
  // tracker already lists them in.
  let appSortKey = 'num';
  let appSortDir = 'asc';

  function applicationSortValue(a, key) {
    if (key === 'num') return a.num;
    if (key === 'applied') return a.appliedDate || '';
    return a[key];
  }

  function sortApplications(apps, key, dir) {
    const mult = dir === 'desc' ? -1 : 1;
    return apps.slice().sort((a, b) => {
      const av = applicationSortValue(a, key);
      const bv = applicationSortValue(b, key);
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mult;
      return String(av ?? '').localeCompare(String(bv ?? '')) * mult;
    });
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

  const APPLICATION_SORT_COLUMNS = [
    { key: 'num', label: '#' },
    { key: 'role', label: 'Role' },
    { key: 'company', label: 'Company' },
    { key: 'location', label: 'Location' },
    { key: 'pay', label: 'Pay' },
    { key: 'applied', label: 'Applied' }
  ];

  function renderApplications(data) {
    const apps = data.applications || [];
    if (!apps.length) {
      applicationsTableWrap.innerHTML = '<div class="empty-state">No applications logged yet.</div>';
      return;
    }

    const sorted = sortApplications(apps, appSortKey, appSortDir);
    const headHtml = APPLICATION_SORT_COLUMNS.map(col => {
      const ariaSort = col.key === appSortKey ? (appSortDir === 'asc' ? 'ascending' : 'descending') : 'none';
      return '<th class="sortable" data-sort="' + col.key + '" tabindex="0" aria-sort="' + ariaSort + '">' +
        escapeHtml(col.label) + '</th>';
    }).join('');

    applicationsTableWrap.innerHTML =
      '<div class="data-table-wrap"><table class="data-table"><thead><tr>' + headHtml + '</tr></thead><tbody>' +
      sorted.map(a =>
        '<tr id="app-row-' + escapeHtml(String(a.num)) + '">' +
        '<td class="num-col" data-label="#">' + escapeHtml(String(a.num)) + '</td>' +
        '<td data-label="Role">' + escapeHtml(a.role) + '</td>' +
        '<td data-label="Company">' + escapeHtml(a.company) + '</td>' +
        '<td data-label="Location">' + escapeHtml(a.location) + '</td>' +
        '<td class="pay-col" data-label="Pay">' + escapeHtml(a.pay) + '</td>' +
        '<td data-label="Applied">' + escapeHtml(fmtDate(a.appliedDate) || 'undated') + '</td>' +
        '</tr>'
      ).join('') +
      '</tbody></table></div>';

    applicationsTableWrap.querySelectorAll('th.sortable').forEach(th => {
      const activate = () => {
        const key = th.getAttribute('data-sort');
        if (appSortKey === key) {
          appSortDir = appSortDir === 'asc' ? 'desc' : 'asc';
        } else {
          appSortKey = key;
          appSortDir = 'asc';
        }
        renderApplications(data);
      };
      th.addEventListener('click', activate);
      th.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
      });
    });

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

  // Real risk this catches: applications.json's only existing uniqueness
  // check is on "num" (an auto-incrementing counter, so it can't naturally
  // collide except by mistake), so the same tracker entry hand-transcribed
  // twice under two different "num" values would otherwise go completely
  // undetected on this page, unlike CGT/CSM/Garage/Sondrik's own record
  // lists, which all already show this same panel. Grouping logic lives in
  // JobSearchValidateCore, shared with validate.js, same reasoning as every
  // other hub's own validate-core.js.
  let duplicateRowFlashTimer = null;
  function jumpToApplicationRow(num) {
    const row = document.getElementById('app-row-' + num);
    if (!row) return;
    row.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
    clearTimeout(duplicateRowFlashTimer);
    document.querySelectorAll('.row-flash').forEach(n => n.classList.remove('row-flash'));
    requestAnimationFrame(() => requestAnimationFrame(() => {
      row.classList.add('row-flash');
      duplicateRowFlashTimer = setTimeout(() => row.classList.remove('row-flash'), 1600);
    }));
  }

  function renderDuplicates(applications) {
    const section = document.getElementById('duplicatesSection');
    const list = document.getElementById('duplicatesList');
    if (!section || !list || typeof JobSearchValidateCore === 'undefined') return;
    const groups = JobSearchValidateCore.findDuplicateApplications(applications);
    if (!groups.length) {
      section.hidden = true;
      return;
    }
    section.hidden = false;
    list.innerHTML = groups.map(group => group.map(a =>
      '<button type="button" class="data-quality-row" data-num="' + escapeHtml(String(a.num)) + '">' +
      '<strong>' + escapeHtml(a.company) + '</strong>' +
      '<span style="color:var(--sub)">' + escapeHtml(a.role) + '</span>' +
      '<span class="dq-why">#' + escapeHtml(String(a.num)) + ', ' + group.length + ' ENTRIES MATCH ON COMPANY + ROLE</span>' +
      '</button>'
    ).join('')).join('');
    list.querySelectorAll('.data-quality-row').forEach(btn => {
      btn.addEventListener('click', () => jumpToApplicationRow(btn.dataset.num));
    });
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

  // new Date().toISOString().slice(0, 10) reads the UTC calendar date, which
  // rolls over to tomorrow while it is still today in any timezone behind
  // UTC. Same fix as Sondrik's/CGT's own todayIso.
  function todayIso() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
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

  // Shared client-side draft-autosave for the quick-log form below: it has
  // no backend to save a half-filled form to, so an accidental reload or
  // navigation away would otherwise throw away real typed data with no way
  // back. Same pattern CGT's/Garage's/Sondrik's own attachDraftGuard uses,
  // reading whatever real input/select/textarea fields the given form
  // actually has rather than a hand-maintained id list.
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
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') { clearTimeout(saveTimer); saveDraft(); }
    });
    window.addEventListener('pagehide', () => { clearTimeout(saveTimer); saveDraft(); });
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

  // Quick-log tool: turns the form into the exact JSON object to paste into
  // applications.json's applications array by hand, same "generate
  // paste-ready JSON, save nothing" pattern CSM's/CGT's/Garage's/Sondrik's
  // own quick-log tools already use. This is the one hub of the six that
  // never had one (see the "How this hub is kept up to date" note). Never
  // writes a file and never calls a server. Warnings mirror validate.js's
  // own checks (missing fields, a future date, a duplicate company+role,
  // an em dash) so a mistake surfaces before it's even pasted in.
  function initQuickLogTool(applicationsData) {
    const form = document.getElementById('quickApplicationForm');
    if (!form) return;
    const roleInput = document.getElementById('qaRole');
    const companyInput = document.getElementById('qaCompany');
    const locationInput = document.getElementById('qaLocation');
    const payInput = document.getElementById('qaPay');
    const dateInput = document.getElementById('qaAppliedDate');
    const warningsEl = document.getElementById('qaWarnings');
    const outputEl = document.getElementById('qaOutput');
    const copyBtn = document.getElementById('qaCopyBtn');
    const liveEl = document.getElementById('quickLogLive');
    const submitBtn = form.querySelector('button[type="submit"]');

    dateInput.value = todayIso();
    dateInput.max = todayIso();

    // Without real applications data there's nothing to compute the next
    // "num" or check for a duplicate company+role against, so the form stays
    // disabled rather than risk generating a row with a guessed/wrong num.
    if (!applicationsData) {
      submitBtn.disabled = true;
      warningsEl.textContent = 'Applications data failed to load, so a new entry number and duplicate check ' +
        'can\'t be computed right now. Reload the page and try again.';
      return;
    }

    const applications = applicationsData.applications || [];
    const draftGuard = attachDraftGuard(form, 'job-search-qa-draft-v1', {
      bannerId: 'qaDraftBanner', timeId: 'qaDraftBannerTime', discardId: 'qaDiscardDraftBtn',
      onDiscard: () => { outputEl.hidden = true; copyBtn.hidden = true; warningsEl.textContent = ''; dateInput.value = todayIso(); }
    });

    form.addEventListener('submit', e => {
      e.preventDefault();
      const role = roleInput.value.trim();
      const company = companyInput.value.trim();
      const location = locationInput.value.trim();
      const pay = payInput.value.trim();
      const appliedDate = dateInput.value;
      const blockers = [];

      if (!role) blockers.push('Role is required.');
      if (!company) blockers.push('Company is required.');
      if (!location) blockers.push('Location is required.');
      if (!pay) blockers.push('Pay is required, use the real quoted figure or a direct quote like "Paid," no figure if that is all the posting says.');
      if (!appliedDate) blockers.push('Applied date is required, this is when the application was actually submitted.');

      if (blockers.length) {
        warningsEl.textContent = blockers.join(' ');
        outputEl.hidden = true;
        copyBtn.hidden = true;
        return;
      }

      const advisory = [];
      if (JobSearchValidateCore.isFutureDate(appliedDate)) {
        advisory.push('Applied date (' + appliedDate + ') is in the future, check for a typo.');
      }
      const nextNum = applications.reduce((max, a) => (typeof a.num === 'number' && a.num > max ? a.num : max), 0) + 1;
      const obj = { num: nextNum, role, company, location, pay, appliedDate };
      const dupeGroup = JobSearchValidateCore.findDuplicateApplications(applications.concat([obj]))
        .find(group => group.includes(obj));
      if (dupeGroup) {
        const otherNums = dupeGroup.filter(a => a !== obj).map(a => '#' + a.num).join(', ');
        advisory.push('Company + role already appears on ' + otherNums + ', check this isn\'t a duplicate transcription.');
      }
      JobSearchValidateCore.emDashFields(obj, ['role', 'company', 'location', 'pay']).forEach(f =>
        advisory.push('"' + f + '" contains an em dash, this is a transcription field, check it against the source tracker.'));
      warningsEl.textContent = advisory.join(' ');

      outputEl.value = JSON.stringify(obj, null, 2) + ',';
      outputEl.hidden = false;
      copyBtn.hidden = false;
    });

    copyBtn.addEventListener('click', () => {
      copyText(outputEl.value).then(() => {
        const original = copyBtn.textContent;
        copyBtn.textContent = 'Copied!';
        liveEl.textContent = 'Application JSON copied to clipboard.';
        draftGuard.clearDraft();
        setTimeout(() => { copyBtn.textContent = original; }, 1800);
      }).catch(() => { liveEl.textContent = 'Could not copy to clipboard.'; });
    });
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
      renderDuplicates(applicationsData.applications || []);
    } else {
      applicationsTableWrap.innerHTML = '<div class="empty-state" role="alert">Failed to load applications data: ' +
        escapeHtml(applicationsResult.reason.message) + '</div>';
    }
    initQuickLogTool(applicationsData);

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

    // The four sections above already announce their own failures via
    // role="alert" on each empty-state div, but nothing ever announced a
    // real *success*, unlike Command Center's own Data Quality/Venture
    // Snapshot panels. A screen-reader user tabbing in during this fetch had
    // no way to tell "still loading" from "genuinely done", since every
    // section renders into a plain, non-live container on the success path.
    const loadedCount = [applicationsData, criteriaData, nextUpData, digestData].filter(Boolean).length;
    document.getElementById('loadStatusLive').textContent = loadedCount === 4
      ? 'Job search data loaded.'
      : `Job search data loaded, ${4 - loadedCount} of 4 section${4 - loadedCount === 1 ? '' : 's'} failed to load.`;
  });

  // Keyboard shortcuts overlay, same markup/behavior as the other hubs.
  let shortcutsOpen = false;
  let shortcutsLastFocusedEl = null;
  const SHORTCUTS = [
    { keys: ['n'], label: 'Log a new application' },
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
    if (shortcutsOpen || jumpNavOpen) return;
    const active = document.activeElement;
    const tag = active && active.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (active && active.isContentEditable)) return;
    if (e.key === '?') {
      e.preventDefault();
      openShortcuts();
    }
  });

  // "n" opens the quick-log tool, the single action most likely to actually
  // be reached for on this page, same disabled-button check the tool's own
  // init already applies (applications data failed to load) so this can
  // never open a form with no real entry number/duplicate check behind it.
  document.addEventListener('keydown', e => {
    if (e.key !== 'n' && e.key !== 'N') return;
    if (shortcutsOpen || jumpNavOpen) return;
    const active = document.activeElement;
    const tag = active && active.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (active && active.isContentEditable)) return;
    const submitBtn = document.querySelector('#quickApplicationForm button[type="submit"]');
    if (!submitBtn || submitBtn.disabled) return;
    e.preventDefault();
    const details = document.getElementById('quickLogTool');
    details.open = true;
    details.scrollIntoView({ behavior: 'smooth', block: 'center' });
    document.getElementById('qaRole').focus();
  });

  // Jump-to-section nav, same markup/behavior as Garage/Sondrik/CGT/CSM's:
  // this page runs 9 real sections including older digest runs and the
  // changelog, with no sticky header, so this is the one way back to a
  // specific section without scrolling blind. Built from the real on-page
  // section titles at load time, no separate list to keep in sync by hand
  // as sections get added.
  let jumpNavOpen = false;
  let jumpNavLastFocusedEl = null;

  function collectJumpSections() {
    const usedIds = new Set();
    return Array.from(document.querySelectorAll('main > section')).map((section) => {
      if (section.hidden) return null;
      const titleEl = section.querySelector('h2.section-title, summary.section-title');
      if (!titleEl) return null;
      // Strip the "Applications submitted" heading's own nested Data
      // Quality badge so the label stays a stable section name instead of
      // picking up that badge's ever-changing warning count.
      const clone = titleEl.cloneNode(true);
      clone.querySelectorAll('.section-title-meta').forEach(el => el.remove());
      const label = clone.textContent.replace(/\s+/g, ' ').trim();
      if (!label) return null;
      if (!section.id) {
        let slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'section';
        let candidate = 'jump-' + slug;
        let n = 2;
        while (usedIds.has(candidate) || document.getElementById(candidate)) {
          candidate = 'jump-' + slug + '-' + n;
          n++;
        }
        section.id = candidate;
      }
      usedIds.add(section.id);
      return { id: section.id, label };
    }).filter(Boolean);
  }

  function renderJumpNavList() {
    const sections = collectJumpSections();
    document.getElementById('jumpNavList').innerHTML = sections.map(s =>
      '<a class="jump-nav-link" href="#' + s.id + '" data-jump-target="' + s.id + '">' + escapeHtml(s.label) + '</a>'
    ).join('');
  }

  function getJumpNavFocusable() {
    return Array.from(document.getElementById('jumpNavModal').querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )).filter(el => !el.hasAttribute('disabled') && el.offsetParent !== null);
  }

  function openJumpNav() {
    if (jumpNavOpen) return;
    jumpNavOpen = true;
    jumpNavLastFocusedEl = document.activeElement;
    renderJumpNavList();
    document.getElementById('jumpNavOverlay').hidden = false;
    lockBodyScroll();
    document.getElementById('jumpNavClose').focus();
  }

  function closeJumpNav() {
    if (!jumpNavOpen) return;
    jumpNavOpen = false;
    document.getElementById('jumpNavOverlay').hidden = true;
    unlockBodyScroll();
    if (jumpNavLastFocusedEl && typeof jumpNavLastFocusedEl.focus === 'function') jumpNavLastFocusedEl.focus();
    jumpNavLastFocusedEl = null;
  }

  document.getElementById('jumpNavBtn').addEventListener('click', openJumpNav);
  document.getElementById('jumpNavClose').addEventListener('click', closeJumpNav);
  document.getElementById('jumpNavOverlay').addEventListener('click', e => {
    if (e.target.id === 'jumpNavOverlay') closeJumpNav();
  });
  document.getElementById('jumpNavList').addEventListener('click', e => {
    const link = e.target.closest('.jump-nav-link');
    if (!link) return;
    e.preventDefault();
    const target = document.getElementById(link.dataset.jumpTarget);
    closeJumpNav();
    if (target) {
      // The scroll-lock release above needs a frame to settle, starting the
      // smooth scroll before that clobbers it.
      requestAnimationFrame(() => target.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  });

  document.addEventListener('keydown', e => {
    if (!jumpNavOpen) return;
    if (e.key === 'Escape') { closeJumpNav(); return; }
    if (e.key === 'Tab') {
      const focusable = getJumpNavFocusable();
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

  // Surfaces this hub's own validate.js self-check (date sanity, em-dash
  // scan, source-URL check, duplicate-application detection) on the page
  // itself, via the same generic /api/<hub>/data-quality route every other
  // hub already reads. server.js has exposed /api/job-search/data-quality
  // since the route was added, but nothing on this page read it until now,
  // so a hand-transcription mistake in applications.json previously only
  // ever surfaced on the command line. "unavailable" (validate.js missing,
  // node unreachable) is an environment gap, not a real finding, so it
  // stays silent, same contract as every other hub's identical check.
  function renderDataQuality(data) {
    const meta = document.getElementById('dataQualityMeta');
    const callout = document.getElementById('dataQualityCallout');
    if (!meta || !callout) return;
    meta.classList.remove('warn');
    if (!data || data.unavailable) {
      meta.textContent = '';
      meta.title = '';
      callout.innerHTML = '';
      return;
    }
    const warnings = data.warnings || 0;
    const errors = data.errors || 0;
    if (!warnings && !errors) {
      meta.textContent = 'Self-check: clean';
      meta.title = 'This hub\'s own validate.js (date sanity, em-dash scan, source-URL check, duplicate-application detection) found nothing to flag.';
      callout.innerHTML = '';
      return;
    }
    meta.textContent = errors ? 'Self-check: ' + errors + ' error(s)' : 'Self-check: ' + warnings + ' warning(s)';
    meta.classList.add('warn');
    meta.title = 'Run node public/job-search/data/validate.js for the full detail.';
    const counts = [errors ? errors + ' error(s)' : '', warnings ? warnings + ' warning(s)' : ''].filter(Boolean).join(', ');
    callout.innerHTML = '<div class="callout callout-warning">' +
      '<strong>' + (errors ? 'This hub\'s data-quality check found real errors.' : 'This hub\'s data-quality check found warnings.') + '</strong> ' +
      escapeHtml(counts) + ' from public/job-search/data/validate.js (guards against a bad date, an untranscribed em dash, ' +
      'a broken source link, and a duplicate application entry). Run <code>node public/job-search/data/validate.js</code> for the full detail.' +
      '</div>';
  }

  // One-time on load, independent of the data-file fetches above: validate.js's
  // result only changes when someone hand-edits and redeploys a data file,
  // never on its own poll cadence (this page has none), so there's nothing to
  // gain from re-fetching it later.
  function loadDataQuality() {
    fetch('/api/job-search/data-quality').then(r => r.ok ? r.json() : null).then(renderDataQuality).catch(() => renderDataQuality(null));
  }
  loadDataQuality();

  // Renders changelog.json, a file no one hand-edits: it's regenerated from
  // this repo's real git history by public/job-search/data/changelog.js, so
  // every hash, author, and date here is independently checkable against the
  // repo instead of resting on a hand-typed claim. Missing the file entirely
  // (never generated yet, or a fresh clone) is an honest empty state, not an
  // error. driftStatus comes from /api/job-search/changelog-status, the same
  // live drift check already exposed for the other 5 hubs: it compares
  // changelog.json's recorded commit hashes for this hub's own data files
  // against this repo's real git log, so a real drift shows up here on the
  // live page instead of only when someone happens to run node
  // public/job-search/data/changelog.js from the command line. "unavailable"
  // (not a git checkout, shallow clone, etc) is an environment gap, not a
  // data error, so it stays silent rather than showing a warning no one can
  // act on. Same markup/classes as CSM's identical section.
  function renderChangelog(data, driftStatus) {
    if (!changelogFeedEl) return;
    const driftWarning = (driftStatus && driftStatus.drifted)
      ? '<div class="callout callout-warning"><strong>Changelog is out of sync.</strong> changelog.json records ' +
        driftStatus.recordedCount + ' commit' + (driftStatus.recordedCount === 1 ? '' : 's') +
        ' for this hub\'s data files, but this repo\'s real git history has ' + driftStatus.realCount +
        '. Run <code>node public/job-search/data/changelog.js</code> to regenerate it.</div>'
      : '';
    const entries = (data && data.entries) || [];
    if (entries.length === 0) {
      changelogFeedEl.innerHTML = driftWarning + '<p class="changelog-empty">No changelog generated yet. Run ' +
        '<code>node public/job-search/data/changelog.js</code> to build one from this repo&rsquo;s git history.</p>';
      return;
    }
    const rowsHtml = entries.map(e => {
      const files = (e.files || []).join(', ');
      return '<div class="changelog-row' + (e.historyReset ? ' changelog-row-reset' : '') + '">' +
        '<span class="changelog-date font-mono">' + escapeHtml(fmtDate(e.date)) + '</span>' +
        '<span class="changelog-hash" title="' + escapeHtml(e.fullHash || e.hash) + '">' + escapeHtml(e.hash) + '</span>' +
        '<span class="changelog-author">' + escapeHtml(e.author) + '</span>' +
        '<span class="changelog-subject' + (e.historyReset ? ' changelog-subject-reset' : '') + '">' +
        (e.historyReset ? '&#9888; ' : '') + escapeHtml(e.subject) + '</span>' +
        (files ? '<span class="changelog-files">touched: ' + escapeHtml(files) + '</span>' : '') +
        '</div>';
    }).join('');
    changelogFeedEl.innerHTML = driftWarning + rowsHtml;
    let noteEl = changelogFeedEl.nextElementSibling;
    if (!noteEl || !noteEl.classList.contains('changelog-generated-note')) {
      noteEl = document.createElement('p');
      noteEl.className = 'section-note changelog-generated-note';
      changelogFeedEl.after(noteEl);
    }
    noteEl.textContent = 'Generated ' + (fmtDate((data.generatedAt || '').slice(0, 10)) || 'at an unknown time') +
      ' from ' + (data.generatedFrom || 'git log') + '.';
  }

  // One-time on load, same reasoning as loadDataQuality above: changelog.json
  // only changes when someone commits a data-file edit and regenerates it,
  // never on its own poll cadence. The drift check is a separate,
  // best-effort fetch so an unavailable git checkout never blocks rendering
  // the changelog entries that did load.
  function loadChangelog() {
    Promise.allSettled([
      fetch('/job-search/data/changelog.json').then(r => {
        if (!r.ok) throw new Error('changelog.json returned ' + r.status);
        return r.json();
      }),
      fetch('/api/job-search/changelog-status').then(r => r.ok ? r.json() : null).catch(() => null)
    ]).then(([changelogResult, driftResult]) => {
      const driftStatus = driftResult.status === 'fulfilled' ? driftResult.value : null;
      renderChangelog(changelogResult.status === 'fulfilled' ? changelogResult.value : { entries: [] }, driftStatus);
    });
  }
  loadChangelog();
})();

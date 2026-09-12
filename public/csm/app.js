(function () {
  const boardEl = document.getElementById('board');
  const nudgeEl = document.getElementById('nudgeQueue');
  const statsEl = document.getElementById('statsBar');
  const searchInput = document.getElementById('searchInput');
  const channelFilterEl = document.getElementById('channelFilter');
  const categoryFilterEl = document.getElementById('categoryFilter');
  const modalOverlay = document.getElementById('modalOverlay');
  const modalName = document.getElementById('modalName');
  const modalCompany = document.getElementById('modalCompany');
  const modalBody = document.getElementById('modalBody');
  const modalClose = document.getElementById('modalClose');
  const printBtn = document.getElementById('printBtn');
  const csvBtn = document.getElementById('csvBtn');
  const copyLinkBtn = document.getElementById('copyLinkBtn');
  const dataQualitySection = document.getElementById('dataQualitySection');
  const dataQualityList = document.getElementById('dataQualityList');

  printBtn.addEventListener('click', () => window.print());

  function fmtDate(iso) {
    if (!iso) return null;
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function daysUntil(iso) {
    const target = new Date(iso + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((target - today) / 86400000);
  }

  function daysSince(iso) {
    return -daysUntil(iso);
  }

  function stallInfo(p, stageById) {
    const stageDef = stageById[p.stage];
    if (!stageDef || stageDef.staleAfterDays == null || !p.stageEnteredDate) return null;
    const days = daysSince(p.stageEnteredDate);
    return { days, staleAfterDays: stageDef.staleAfterDays, isStale: days > stageDef.staleAfterDays };
  }

  function channelBadge(channel) {
    if (!channel || !channel.type) {
      return '<span class="badge badge-unknown">CHANNEL NOT LOGGED</span>';
    }
    if (channel.type === 'named-decision-maker') {
      return '<span class="badge badge-dm">NAMED DECISION-MAKER</span>';
    }
    if (channel.type === 'generic-inbox') {
      return '<span class="badge badge-generic">GENERIC INBOX</span>';
    }
    return '<span class="badge badge-unknown">' + escapeHtml(channel.type).toUpperCase() + '</span>';
  }

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = String(s);
    return div.innerHTML;
  }

  function renderStageHistory(p, stages) {
    const history = p.stageHistory || [];
    if (history.length === 0) {
      return { html: 'No stage moves logged yet.', empty: true };
    }
    const stageDef = Object.fromEntries(stages.map(s => [s.id, s]));
    const sorted = history.slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const rowsHtml = sorted.map((entry, i) => {
      const def = stageDef[entry.stage];
      const label = def ? def.label : entry.stage;
      const color = def ? def.color : 'var(--dim)';
      const next = sorted[i + 1];
      const dwellStart = entry.date;
      const dwellEnd = next ? next.date : null;
      let dwellText;
      if (dwellStart && dwellEnd) {
        dwellText = (daysUntil(dwellEnd) - daysUntil(dwellStart)) + 'd in stage';
      } else if (dwellStart) {
        dwellText = daysSince(dwellStart) + 'd in stage so far';
      } else {
        dwellText = '';
      }
      return '<li class="timeline-row">' +
        '<span class="timeline-dot" style="background:' + color + '"></span>' +
        '<span class="timeline-body">' +
        '<span class="timeline-stage">' + escapeHtml(label) + '</span>' +
        '<span class="timeline-date font-mono">' + (entry.date ? escapeHtml(fmtDate(entry.date)) : 'NO DATE') +
        (dwellText ? ' &middot; ' + dwellText : '') + '</span>' +
        '</span></li>';
    }).join('');
    return { html: '<ul class="timeline-list">' + rowsHtml + '</ul>', empty: false };
  }

  function fieldRow(label, valueHtml, isEmpty) {
    return '<div class="field-row">' +
      '<div class="field-label">' + escapeHtml(label) + '</div>' +
      '<div class="field-value' + (isEmpty ? ' empty' : '') + '">' + valueHtml + '</div>' +
      '</div>';
  }

  function renderNudgeQueue(prospects) {
    const withDates = prospects
      .filter(p => p.nextNudgeDate)
      .map(p => ({ p, days: daysUntil(p.nextNudgeDate) }))
      .sort((a, b) => a.days - b.days);

    if (withDates.length === 0) {
      nudgeEl.innerHTML = '<p class="nudge-empty">No nudge dates logged yet. Once a real send date and nudge ' +
        'schedule are recorded for a prospect, the next one due shows up here.</p>';
      return;
    }

    nudgeEl.innerHTML = withDates.map(({ p, days }) => {
      let when, urgency;
      if (days < 0) { when = Math.abs(days) + 'd overdue'; urgency = 'overdue'; }
      else if (days === 0) { when = 'today'; urgency = 'today'; }
      else if (days <= 2) { when = 'in ' + days + 'd'; urgency = 'soon'; }
      else { when = 'in ' + days + 'd'; urgency = 'later'; }
      const notBefore = p.nudgeSchedule && p.nudgeSchedule.doNotNudgeBefore
        ? ' &middot; do not nudge before ' + fmtDate(p.nudgeSchedule.doNotNudgeBefore)
        : '';
      const actionLine = p.nextAction
        ? '<div class="nudge-action">' + escapeHtml(p.nextAction) + '</div>'
        : '<div class="nudge-action nudge-action-missing">NO NEXT ACTION LOGGED &middot; a due date alone tends to stall</div>';
      return '<div class="nudge-row nudge-' + urgency + '">' +
        '<div class="nudge-top">' +
        '<span class="nudge-urgency-dot"></span>' +
        '<strong>' + escapeHtml(p.name) + '</strong>' +
        '<span style="color:var(--sub)">' + escapeHtml(p.company || '') + '</span>' +
        '<span class="font-mono nudge-when">' +
        fmtDate(p.nextNudgeDate) + ' (' + when + ')' + notBefore +
        '</span></div>' +
        actionLine +
        '</div>';
    }).join('');
  }

  function byUrgency(a, b) {
    if (a.nextNudgeDate && b.nextNudgeDate) return a.nextNudgeDate < b.nextNudgeDate ? -1 : 1;
    if (a.nextNudgeDate) return -1;
    if (b.nextNudgeDate) return 1;
    return (a.name || '').localeCompare(b.name || '');
  }

  const stalledEl = document.getElementById('stalledList');
  const stalledSection = document.getElementById('stalledSection');

  function renderStalled(stages, prospects) {
    const stageById = Object.fromEntries(stages.map(s => [s.id, s]));
    const stalled = prospects
      .map(p => ({ p, info: stallInfo(p, stageById) }))
      .filter(x => x.info && x.info.isStale)
      .sort((a, b) => b.info.days - a.info.days);

    if (stalled.length === 0) {
      stalledSection.hidden = true;
      return;
    }

    stalledSection.hidden = false;
    const stageLabel = Object.fromEntries(stages.map(s => [s.id, s.label]));
    stalledEl.innerHTML = stalled.map(({ p, info }) =>
      '<div class="data-quality-row">' +
      '<strong>' + escapeHtml(p.name) + '</strong>' +
      '<span style="color:var(--sub)">' + escapeHtml(p.company || '') + '</span>' +
      '<span class="dq-why">' + escapeHtml(stageLabel[p.stage] || p.stage).toUpperCase() + ' &middot; ' +
      info.days + 'D (OVER ' + info.staleAfterDays + 'D)</span>' +
      '</div>'
    ).join('');
  }

  function renderDataQuality(stages, prospects) {
    const stageLabel = Object.fromEntries(stages.map(s => [s.id, s.label]));

    const flagged = prospects
      .filter(p => p.stage !== 'researched')
      .map(p => {
        const reasons = [];
        if (!(p.contactChannel && p.contactChannel.type)) reasons.push('NO CONTACT CHANNEL TYPE LOGGED');
        if (!p.verifiedHook) reasons.push('NO VERIFIED HOOK LOGGED');
        return { p, reasons };
      })
      .filter(x => x.reasons.length > 0);

    if (flagged.length === 0) {
      dataQualitySection.hidden = true;
      return;
    }

    dataQualitySection.hidden = false;
    dataQualityList.innerHTML = flagged.map(({ p, reasons }) =>
      '<div class="data-quality-row">' +
      '<strong>' + escapeHtml(p.name) + '</strong>' +
      '<span style="color:var(--sub)">' + escapeHtml(p.company || '') + '</span>' +
      '<span class="dq-why">' + escapeHtml(stageLabel[p.stage] || p.stage) +
      ', ' + reasons.join(' &middot; ') + '</span>' +
      '</div>'
    ).join('');
  }

  function renderBoard(stages, prospects, allProspects, query, filtering) {
    const stageById = Object.fromEntries(stages.map(s => [s.id, s]));
    boardEl.innerHTML = stages.map(stage => {
      const inStage = prospects.filter(p => p.stage === stage.id).sort(byUrgency);
      const totalInStage = allProspects.filter(p => p.stage === stage.id).length;
      let cards;
      if (inStage.length) {
        cards = inStage.map(p => renderCard(p, stageById)).join('');
      } else if (filtering && totalInStage > 0) {
        cards = '<div class="column-empty" role="status">No matches' +
          (query ? ' for "' + escapeHtml(query) + '"' : '') + ' in this stage.</div>';
      } else {
        cards = '<div class="column-empty">No prospects in this stage yet.</div>';
      }
      return '<div class="column">' +
        '<div class="column-head">' +
        '<span class="stage-dot" style="background:' + stage.color + '"></span>' +
        '<h2>' + escapeHtml(stage.label) + '</h2>' +
        '<span class="column-count font-mono">' + inStage.length + '</span>' +
        '</div>' +
        '<div class="column-desc">' + escapeHtml(stage.description) + '</div>' +
        cards +
        '</div>';
    }).join('');

    boardEl.querySelectorAll('[data-prospect-id]').forEach(el => {
      el.addEventListener('click', () => openModal(el.getAttribute('data-prospect-id')));
    });
  }

  function renderChannelFilterCounts(prospects) {
    channelFilterEl.querySelectorAll('.chip').forEach(chip => {
      const key = chip.getAttribute('data-channel');
      const count = prospects.filter(p => matchesChannel(p, key)).length;
      chip.textContent = chip.getAttribute('data-label') + ' (' + count + ')';
    });
  }

  function renderStats(stages, prospects) {
    const total = prospects.length;
    const parts = ['<span><strong>' + total + '</strong> total</span>'];
    stages.forEach(stage => {
      const count = prospects.filter(p => p.stage === stage.id).length;
      if (count > 0) {
        parts.push('<span><strong>' + count + '</strong> ' + escapeHtml(stage.shortLabel.toLowerCase()) + '</span>');
      }
    });
    statsEl.innerHTML = parts.join('');
  }

  function renderCard(p, stageById) {
    const info = stallInfo(p, stageById);
    const stallBadge = info
      ? '<span class="badge ' + (info.isStale ? 'badge-stale' : 'badge-age') + '">' +
        info.days + 'D IN STAGE' + (info.isStale ? ' &middot; STALLED' : '') + '</span>'
      : '';
    return '<button class="card' + (info && info.isStale ? ' card-stale' : '') + '" data-prospect-id="' + escapeHtml(p.id) + '">' +
      '<div class="card-name">' + escapeHtml(p.name) + '</div>' +
      '<div class="card-company">' + escapeHtml(p.company || 'Company not logged') + '</div>' +
      '<div class="card-meta">' + channelBadge(p.contactChannel) + stallBadge + '</div>' +
      '</button>';
  }

  let byId = {};
  let allStages = [];
  let allProspects = [];
  let channelFilter = 'all';
  let categoryFilter = 'all';
  let lastFiltered = [];

  // Filter/search state is mirrored into the URL so a specific slice of the
  // pipeline (e.g. "named decision-makers in the outreach-sent stage") can be
  // bookmarked or shared as a link, same convention as the CGT hub.
  const VALID_CHANNELS = ['named-decision-maker', 'generic-inbox', 'unlogged'];

  function restoreStateFromUrl() {
    const params = new URLSearchParams(location.search);
    const q = params.get('q');
    const channel = params.get('channel');
    const category = params.get('category');
    if (q) searchInput.value = q;
    if (channel && VALID_CHANNELS.includes(channel)) channelFilter = channel;
    if (category) categoryFilter = category;
  }

  function syncUrl() {
    const params = new URLSearchParams();
    const query = searchInput.value.trim();
    if (query) params.set('q', query);
    if (channelFilter !== 'all') params.set('channel', channelFilter);
    if (categoryFilter !== 'all') params.set('category', categoryFilter);
    const qs = params.toString();
    const url = location.pathname + (qs ? '?' + qs : '');
    history.replaceState(null, '', url);
  }

  function matchesChannel(p, key) {
    if (key === 'all') return true;
    const type = p.contactChannel && p.contactChannel.type;
    if (key === 'unlogged') return !type;
    return type === key;
  }

  function matchesCategory(p, key) {
    if (key === 'all') return true;
    return (p.category || null) === key;
  }

  function renderCategoryFilter(prospects) {
    const categories = Array.from(new Set(
      prospects.map(p => p.category).filter(Boolean)
    )).sort();

    if (categories.length === 0) {
      categoryFilterEl.hidden = true;
      return;
    }
    categoryFilterEl.hidden = false;

    if (categoryFilter !== 'all' && !categories.includes(categoryFilter)) {
      categoryFilter = 'all';
    }

    const keys = ['all', ...categories];
    const chipsHtml = keys.map(key => {
      const label = key === 'all' ? 'All' : key;
      const count = prospects.filter(p => matchesCategory(p, key)).length;
      return '<button type="button" class="chip" data-category="' + escapeHtml(key) +
        '" aria-pressed="' + (key === categoryFilter) + '">' + escapeHtml(label) + ' (' + count + ')</button>';
    }).join('');
    categoryFilterEl.innerHTML = '<span class="channel-filter-label font-mono">CATEGORY</span>' + chipsHtml;

    categoryFilterEl.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', () => {
        categoryFilter = chip.getAttribute('data-category');
        categoryFilterEl.querySelectorAll('.chip').forEach(c =>
          c.setAttribute('aria-pressed', String(c === chip)));
        applyFilter();
      });
    });
  }

  function applyFilter() {
    const query = searchInput.value.trim().toLowerCase();
    const filtered = allProspects.filter(p =>
      matchesChannel(p, channelFilter) &&
      matchesCategory(p, categoryFilter) &&
      (!query ||
        (p.name || '').toLowerCase().includes(query) ||
        (p.company || '').toLowerCase().includes(query) ||
        (p.category || '').toLowerCase().includes(query) ||
        (p.verifiedHook || '').toLowerCase().includes(query)));
    lastFiltered = filtered;
    renderBoard(allStages, filtered, allProspects, query,
      !!query || channelFilter !== 'all' || categoryFilter !== 'all');
    syncUrl();
  }

  function csvField(v) {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  const CSV_COLUMNS = [
    ['name', 'Name'], ['company', 'Company'], ['category', 'Category'],
    ['stage', 'Stage'], ['stageEnteredDate', 'Stage Entered'],
    ['verifiedHook', 'Verified Hook'],
    ['channelType', 'Contact Channel Type'], ['channelDetail', 'Contact Channel Detail'],
    ['sendDate', 'Send Date'], ['nextNudgeDate', 'Next Nudge Date'], ['nextAction', 'Next Action'],
    ['doNotNudgeBefore', 'Do Not Nudge Before'], ['nudgePoint', 'Nudge Point'],
    ['replyStatus', 'Reply Status'],
    ['socialPlatform', 'Social Platform'], ['socialFollowers', 'Social Followers'],
    ['socialEngagementRate', 'Social Engagement Rate'], ['socialAsOfDate', 'Social Snapshot As Of'],
    ['contentIdeas', 'Content Ideas'], ['notes', 'Notes']
  ];

  // Exports exactly what the board currently shows (search + channel + category
  // filters applied), not the full dataset, so the file matches what's on screen.
  csvBtn.addEventListener('click', () => {
    const rows = lastFiltered.map(p => ({
      name: p.name,
      company: p.company,
      category: p.category,
      stage: p.stage,
      stageEnteredDate: p.stageEnteredDate,
      verifiedHook: p.verifiedHook,
      channelType: p.contactChannel && p.contactChannel.type,
      channelDetail: p.contactChannel && p.contactChannel.detail,
      sendDate: p.sendDate,
      nextNudgeDate: p.nextNudgeDate,
      nextAction: p.nextAction,
      doNotNudgeBefore: p.nudgeSchedule && p.nudgeSchedule.doNotNudgeBefore,
      nudgePoint: p.nudgeSchedule && p.nudgeSchedule.nudgePoint,
      replyStatus: p.replyStatus,
      socialPlatform: p.socialSnapshot && p.socialSnapshot.platform,
      socialFollowers: p.socialSnapshot && p.socialSnapshot.followers,
      socialEngagementRate: p.socialSnapshot && p.socialSnapshot.engagementRate,
      socialAsOfDate: p.socialSnapshot && p.socialSnapshot.asOfDate,
      contentIdeas: (p.contentIdeas || [])
        .map(entry => (entry.date ? entry.date + ': ' : '') + entry.idea)
        .join('; '),
      notes: p.notes
    }));
    const header = CSV_COLUMNS.map(([, label]) => csvField(label)).join(',');
    const lines = rows.map(r => CSV_COLUMNS.map(([key]) => csvField(r[key])).join(','));
    const csv = [header, ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'csm-pipeline-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  searchInput.addEventListener('input', applyFilter);

  channelFilterEl.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      channelFilter = chip.getAttribute('data-channel');
      channelFilterEl.querySelectorAll('.chip').forEach(c =>
        c.setAttribute('aria-pressed', String(c === chip)));
      applyFilter();
    });
  });

  let lastFocusedEl = null;

  function openModal(id) {
    const p = byId[id];
    if (!p) return;
    lastFocusedEl = document.activeElement;
    modalName.textContent = p.name;
    modalCompany.textContent = p.company || 'Company not logged';

    const rows = [];
    rows.push(fieldRow('Category', p.category ? escapeHtml(p.category) : 'Not logged yet', !p.category));
    rows.push(fieldRow('Verified hook', p.verifiedHook ? escapeHtml(p.verifiedHook) : 'Not logged yet', !p.verifiedHook));
    rows.push(fieldRow('Contact channel', channelBadge(p.contactChannel) +
      (p.contactChannel && p.contactChannel.detail ? '<div style="margin-top:6px">' + escapeHtml(p.contactChannel.detail) + '</div>' : ''), false));
    rows.push(fieldRow('Reply status', p.replyStatus ? escapeHtml(p.replyStatus) : 'Not logged yet', !p.replyStatus));
    rows.push(fieldRow('Send date', p.sendDate ? fmtDate(p.sendDate) : 'Not logged yet', !p.sendDate));
    rows.push(fieldRow('Next nudge date', p.nextNudgeDate ? fmtDate(p.nextNudgeDate) : 'Not scheduled yet', !p.nextNudgeDate));
    rows.push(fieldRow('Next action', p.nextAction ? escapeHtml(p.nextAction) : 'Not logged yet', !p.nextAction));

    const stallEntry = stallInfo(p, Object.fromEntries(allStages.map(s => [s.id, s])));
    const stageText = p.stageEnteredDate
      ? 'Entered ' + fmtDate(p.stageEnteredDate) + ' &middot; ' + daysSince(p.stageEnteredDate) + ' days in this stage' +
        (stallEntry && stallEntry.isStale ? ' <span class="stalled-inline">(past the ' + stallEntry.staleAfterDays + '-day stall threshold)</span>' : '')
      : 'Not logged yet';
    rows.push(fieldRow('Time in stage', stageText, !p.stageEnteredDate));

    const ns = p.nudgeSchedule || {};
    const nudgeText = (ns.doNotNudgeBefore || ns.nudgePoint)
      ? [
          ns.doNotNudgeBefore ? 'Do not nudge before ' + fmtDate(ns.doNotNudgeBefore) : null,
          ns.nudgePoint ? 'Nudge point ' + fmtDate(ns.nudgePoint) : null
        ].filter(Boolean).join(' &middot; ')
      : 'Not scheduled yet';
    rows.push(fieldRow('Nudge schedule', nudgeText, !(ns.doNotNudgeBefore || ns.nudgePoint)));

    const snap = p.socialSnapshot || {};
    let snapHtml;
    if (snap.platform || snap.followers != null) {
      snapHtml = escapeHtml(snap.platform || 'Platform not logged') +
        (snap.followers != null ? ', ' + Number(snap.followers).toLocaleString() + ' followers' : '') +
        (snap.engagementRate != null ? ', ' + snap.engagementRate + '% engagement' : '') +
        '<span class="snapshot-tag">' + (snap.asOfDate ? 'AS OF ' + fmtDate(snap.asOfDate).toUpperCase() + ', ONE-TIME MANUAL SNAPSHOT, NOT LIVE' : 'NO SNAPSHOT DATE LOGGED') + '</span>';
    } else {
      snapHtml = 'Not logged yet';
    }
    rows.push(fieldRow('Social snapshot', snapHtml, !(snap.platform || snap.followers != null)));

    const historyHtml = renderStageHistory(p, allStages);
    rows.push(fieldRow('Stage history', historyHtml.html, historyHtml.empty));

    const ideas = (p.contentIdeas || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const ideasHtml = ideas.length
      ? '<ul class="ideas-list">' + ideas.map(entry =>
          '<li><span class="idea-date font-mono">' + (entry.date ? escapeHtml(fmtDate(entry.date)) : 'NO DATE') +
          '</span>' + escapeHtml(entry.idea) + '</li>').join('') + '</ul>'
      : 'No content ideas logged yet.';
    rows.push(fieldRow('Content ideas log', ideasHtml, ideas.length === 0));

    rows.push(fieldRow('Notes', p.notes ? escapeHtml(p.notes) : 'None', !p.notes));

    modalBody.innerHTML = rows.join('');
    modalOverlay.hidden = false;
    modalClose.focus();
  }

  function closeModal() {
    modalOverlay.hidden = true;
    if (lastFocusedEl && typeof lastFocusedEl.focus === 'function') {
      lastFocusedEl.focus();
    }
    lastFocusedEl = null;
  }

  function getFocusable() {
    return Array.from(document.getElementById('modal').querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )).filter(el => !el.hasAttribute('disabled'));
  }

  modalClose.addEventListener('click', closeModal);
  modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });
  document.addEventListener('keydown', e => {
    if (modalOverlay.hidden) return;
    if (e.key === 'Escape') { closeModal(); return; }
    if (e.key === 'Tab') {
      const focusable = getFocusable();
      if (focusable.length === 0) return;
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

  // Same "/" jumps to search shortcut as the main Command Center dashboard.
  document.addEventListener('keydown', e => {
    if (!modalOverlay.hidden || e.key !== '/' || document.activeElement.id === 'searchInput') return;
    e.preventDefault();
    searchInput.focus();
  });

  restoreStateFromUrl();
  channelFilterEl.querySelectorAll('.chip').forEach(chip => {
    chip.setAttribute('aria-pressed', String(chip.getAttribute('data-channel') === channelFilter));
  });

  if (navigator.clipboard && navigator.clipboard.writeText) {
    const COPY_LINK_LABEL = copyLinkBtn.textContent;
    copyLinkBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(location.href)
        .then(() => { copyLinkBtn.textContent = 'Link copied'; })
        .catch(() => { copyLinkBtn.textContent = "Couldn't copy, link is in the address bar"; })
        .finally(() => {
          setTimeout(() => { copyLinkBtn.textContent = COPY_LINK_LABEL; }, 1800);
        });
    });
  } else {
    copyLinkBtn.hidden = true;
  }

  Promise.all([
    fetch('/csm/data/stages.json').then(r => r.json()),
    fetch('/csm/data/prospects.json').then(r => r.json())
  ]).then(([stagesData, prospectsData]) => {
    allStages = stagesData.stages;
    allProspects = prospectsData.prospects;
    byId = Object.fromEntries(allProspects.map(p => [p.id, p]));
    renderNudgeQueue(allProspects);
    renderStats(allStages, allProspects);
    renderChannelFilterCounts(allProspects);
    renderCategoryFilter(allProspects);
    renderStalled(allStages, allProspects);
    renderDataQuality(allStages, allProspects);
    applyFilter();
  }).catch(err => {
    boardEl.innerHTML = '<div class="column-empty" role="alert">Failed to load pipeline data: ' + escapeHtml(err.message) + '</div>';
    nudgeEl.innerHTML = '<p class="nudge-empty">Failed to load.</p>';
  });
})();

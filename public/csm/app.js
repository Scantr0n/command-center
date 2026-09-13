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
  const activityFeedEl = document.getElementById('activityFeed');
  const ACTIVITY_PREVIEW_COUNT = 8;

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

  // Lets the "Stalled in stage" and "Needs backfill" rows jump straight to the
  // flagged prospect's own detail modal, same click-to-view behavior as a
  // board card, instead of only flagging the problem and leaving the user to
  // go find that card themselves.
  function wireRowsToModal(container) {
    container.querySelectorAll('[data-prospect-id]').forEach(el => {
      el.addEventListener('click', () => openModal(el.getAttribute('data-prospect-id')));
    });
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
      '<button type="button" class="data-quality-row" data-prospect-id="' + escapeHtml(p.id) + '">' +
      '<strong>' + escapeHtml(p.name) + '</strong>' +
      '<span style="color:var(--sub)">' + escapeHtml(p.company || '') + '</span>' +
      '<span class="dq-why">' + escapeHtml(stageLabel[p.stage] || p.stage).toUpperCase() + ' &middot; ' +
      info.days + 'D (OVER ' + info.staleAfterDays + 'D)</span>' +
      '</button>'
    ).join('');
    wireRowsToModal(stalledEl);
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
      '<button type="button" class="data-quality-row" data-prospect-id="' + escapeHtml(p.id) + '">' +
      '<strong>' + escapeHtml(p.name) + '</strong>' +
      '<span style="color:var(--sub)">' + escapeHtml(p.company || '') + '</span>' +
      '<span class="dq-why">' + escapeHtml(stageLabel[p.stage] || p.stage) +
      ', ' + reasons.join(' &middot; ') + '</span>' +
      '</button>'
    ).join('');
    wireRowsToModal(dataQualityList);
  }

  // Pulls stage moves and content-ideas entries out of every prospect's own
  // record and merges them into one pipeline-wide feed, newest first. Both
  // logs already exist per-prospect (in the modal), but there was no way to
  // see what happened across the whole pipeline without opening each card.
  function buildActivityEvents(prospects, stages) {
    const stageById = Object.fromEntries(stages.map(s => [s.id, s]));
    const events = [];
    prospects.forEach(p => {
      (p.stageHistory || []).forEach(entry => {
        if (!entry.date) return;
        const def = stageById[entry.stage];
        events.push({
          date: entry.date,
          type: 'stage',
          prospect: p,
          label: 'Moved to ' + (def ? def.label : entry.stage),
          color: def ? def.color : 'var(--dim)'
        });
      });
      (p.contentIdeas || []).forEach(entry => {
        if (!entry.date || !entry.idea) return;
        events.push({ date: entry.date, type: 'idea', prospect: p, label: entry.idea });
      });
    });
    events.sort((a, b) => b.date.localeCompare(a.date));
    return events;
  }

  function renderActivityFeed(prospects, stages) {
    const events = buildActivityEvents(prospects, stages);
    if (events.length === 0) {
      activityFeedEl.innerHTML = '<p class="activity-empty" role="status">No activity logged yet across the ' +
        'pipeline. Once a stage move or a content idea is logged with a real date on any prospect, it shows up ' +
        'here in one feed instead of only inside that prospect&rsquo;s own card.</p>';
      return;
    }
    const needsToggle = events.length > ACTIVITY_PREVIEW_COUNT;
    const rowsHtml = events.map(ev => {
      const tag = ev.type === 'stage'
        ? '<span class="activity-tag activity-tag-stage" style="color:' + ev.color + ';border-color:' + ev.color + '66">MOVED</span>'
        : '<span class="activity-tag activity-tag-idea">IDEA</span>';
      return '<div class="activity-row">' +
        '<span class="activity-date font-mono">' + escapeHtml(fmtDate(ev.date)) + '</span>' +
        tag +
        '<span class="activity-who"><strong>' + escapeHtml(ev.prospect.name) + '</strong>' +
        (ev.prospect.company ? ' <span style="color:var(--sub)">' + escapeHtml(ev.prospect.company) + '</span>' : '') +
        '</span>' +
        '<span class="activity-label">' + escapeHtml(ev.label) + '</span>' +
        '</div>';
    }).join('');
    activityFeedEl.innerHTML =
      '<div class="activity-list' + (needsToggle ? ' is-collapsed' : '') + '" id="activityList">' + rowsHtml + '</div>' +
      (needsToggle ? '<button type="button" class="activity-toggle font-mono" id="activityToggle">Show all ' +
        events.length + '</button>' : '');
    const toggleBtn = document.getElementById('activityToggle');
    const listEl = document.getElementById('activityList');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        const collapsed = listEl.classList.toggle('is-collapsed');
        toggleBtn.textContent = collapsed ? 'Show all ' + events.length : 'Show fewer';
      });
    }
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
    const categoryBadge = p.category
      ? '<span class="badge badge-category">' + escapeHtml(p.category).toUpperCase() + '</span>'
      : '';
    return '<button class="card' + (info && info.isStale ? ' card-stale' : '') + '" data-prospect-id="' + escapeHtml(p.id) + '">' +
      '<div class="card-name">' + escapeHtml(p.name) + '</div>' +
      '<div class="card-company">' + escapeHtml(p.company || 'Company not logged') + '</div>' +
      '<div class="card-meta">' + categoryBadge + channelBadge(p.contactChannel) + stallBadge + '</div>' +
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

  // Announces the live match count to screen-reader users, since the visual
  // feedback (cards disappearing from columns) isn't perceivable
  // non-visually, same live region the main Command Center dashboard already
  // uses for its own search/category filter.
  function announceFilterStatus(matchCount, query, filterActive) {
    const status = document.getElementById('filterStatus');
    status.textContent = filterActive
      ? matchCount + ' prospect' + (matchCount === 1 ? '' : 's') + ' match' + (matchCount === 1 ? 'es' : '') +
        (query ? ' for "' + query + '"' : '')
      : '';
  }

  function anyFilterActive() {
    return !!searchInput.value.trim() || channelFilter !== 'all' || categoryFilter !== 'all';
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
    const filterActive = anyFilterActive();
    renderBoard(allStages, filtered, allProspects, query, filterActive);
    announceFilterStatus(filtered.length, query, filterActive);
    document.getElementById('clearFiltersBtn').hidden = !filterActive;
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

  // Resets search plus both chip groups (channel and category) and the
  // address bar back to the bare /csm/ URL in one action, same "Clear
  // filters" pattern already established on CGT and the main dashboard.
  document.getElementById('clearFiltersBtn').addEventListener('click', () => {
    searchInput.value = '';
    channelFilter = 'all';
    categoryFilter = 'all';
    channelFilterEl.querySelectorAll('.chip').forEach(c =>
      c.setAttribute('aria-pressed', String(c.getAttribute('data-channel') === 'all')));
    categoryFilterEl.querySelectorAll('.chip').forEach(c =>
      c.setAttribute('aria-pressed', String(c.getAttribute('data-category') === 'all')));
    applyFilter();
    searchInput.focus();
  });

  let lastFocusedEl = null;

  // Locks background scroll behind the modal overlay. Reserves the width the
  // scrollbar was taking up as body padding first, so hiding it doesn't shift
  // the layout sideways by a few pixels while the modal is open.
  function lockBodyScroll() {
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    if (scrollbarWidth > 0) document.body.style.paddingRight = scrollbarWidth + 'px';
    document.body.style.overflow = 'hidden';
  }
  function unlockBodyScroll() {
    document.body.style.overflow = '';
    document.body.style.paddingRight = '';
  }

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
    rows.push(fieldRow('Stage history', historyHtml.html + stageMoveGeneratorHtml(), historyHtml.empty));

    const ideas = (p.contentIdeas || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const ideasHtml = ideas.length
      ? '<ul class="ideas-list">' + ideas.map(entry =>
          '<li><span class="idea-date font-mono">' + (entry.date ? escapeHtml(fmtDate(entry.date)) : 'NO DATE') +
          '</span>' + escapeHtml(entry.idea) + '</li>').join('') + '</ul>'
      : 'No content ideas logged yet.';
    rows.push(fieldRow('Content ideas log', ideasHtml + ideaGeneratorHtml(), ideas.length === 0));

    rows.push(fieldRow('Notes', p.notes ? escapeHtml(p.notes) : 'None', !p.notes));

    modalBody.innerHTML = rows.join('');
    modalOverlay.hidden = false;
    wireStageMoveGenerator(p);
    wireIdeaGenerator(p);
    lockBodyScroll();
    modalClose.focus();
  }

  // Small snippet generators embedded in the detail modal for the two
  // per-prospect logs that otherwise require hand-appending an object into
  // a nested array in prospects.json (stageHistory / contentIdeas), the same
  // class of friction the "Log new prospect" generator addresses for new
  // rows. Output is copy-paste JSON only, nothing is written automatically.
  function todayIso() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function stageMoveGeneratorHtml() {
    return '<div class="inline-gen">' +
      '<div class="inline-gen-row">' +
      '<select id="modalMoveStage" class="np-input inline-gen-select"></select>' +
      '<input type="date" id="modalMoveDate" class="np-input inline-gen-date">' +
      '<button type="button" id="modalMoveGenerate" class="print-btn font-mono">+ Log stage move</button>' +
      '</div>' +
      '<div id="modalMoveResult" class="inline-gen-result" hidden>' +
      '<div class="inline-gen-warn" id="modalMoveWarn" hidden></div>' +
      '<div class="np-output-head">' +
      '<span class="field-label" style="margin:0">Paste into <code>stageHistory</code></span>' +
      '<button type="button" id="modalMoveCopy" class="print-btn font-mono">Copy</button>' +
      '</div>' +
      '<pre class="np-output font-mono" id="modalMoveOutput"></pre>' +
      '</div></div>';
  }

  function ideaGeneratorHtml() {
    return '<div class="inline-gen">' +
      '<div class="inline-gen-row inline-gen-row-idea">' +
      '<input type="date" id="modalIdeaDate" class="np-input inline-gen-date">' +
      '<input type="text" id="modalIdeaText" class="np-input" placeholder="Content idea, logged today">' +
      '<button type="button" id="modalIdeaGenerate" class="print-btn font-mono">+ Log idea</button>' +
      '</div>' +
      '<div id="modalIdeaResult" class="inline-gen-result" hidden>' +
      '<div class="inline-gen-warn" id="modalIdeaWarn" hidden></div>' +
      '<div class="np-output-head">' +
      '<span class="field-label" style="margin:0">Paste into <code>contentIdeas</code></span>' +
      '<button type="button" id="modalIdeaCopy" class="print-btn font-mono">Copy</button>' +
      '</div>' +
      '<pre class="np-output font-mono" id="modalIdeaOutput"></pre>' +
      '</div></div>';
  }

  function wireCopyButton(btn, sourceEl) {
    const original = btn.textContent;
    btn.addEventListener('click', () => {
      copyText(sourceEl.textContent)
        .then(() => { btn.textContent = 'Copied'; })
        .catch(() => { btn.textContent = "Couldn't copy"; })
        .finally(() => { setTimeout(() => { btn.textContent = original; }, 1800); });
    });
  }

  function wireStageMoveGenerator(p) {
    const select = document.getElementById('modalMoveStage');
    select.innerHTML = allStages.map(s => '<option value="' + escapeHtml(s.id) + '"' +
      (s.id === p.stage ? ' selected' : '') + '>' + escapeHtml(s.label) + '</option>').join('');
    const dateInput = document.getElementById('modalMoveDate');
    dateInput.value = todayIso();
    const resultEl = document.getElementById('modalMoveResult');
    const warnEl = document.getElementById('modalMoveWarn');
    const outputEl = document.getElementById('modalMoveOutput');
    document.getElementById('modalMoveGenerate').addEventListener('click', () => {
      const stage = select.value;
      const date = dateInput.value;
      if (!date) {
        warnEl.hidden = false;
        warnEl.textContent = 'Pick the real date this move happened first.';
        outputEl.textContent = '';
        resultEl.hidden = false;
        return;
      }
      const history = p.stageHistory || [];
      const last = history[history.length - 1];
      let warn = '';
      if (last && last.date && date < last.date) {
        warn = 'This date is before the last logged move (' + last.date + '). stageHistory must stay sorted oldest first.';
      } else if (stage !== p.stage) {
        warn = 'This prospect’s own "stage" field is still "' + p.stage + '". If this move already really ' +
          'happened, also update this prospect’s "stage" and "stageEnteredDate" fields, not just stageHistory.';
      }
      warnEl.hidden = !warn;
      warnEl.textContent = warn;
      outputEl.textContent = JSON.stringify({ date, stage }, null, 2) + ',';
      resultEl.hidden = false;
    });
    wireCopyButton(document.getElementById('modalMoveCopy'), outputEl);
  }

  function wireIdeaGenerator(p) {
    const dateInput = document.getElementById('modalIdeaDate');
    dateInput.value = todayIso();
    const textInput = document.getElementById('modalIdeaText');
    const resultEl = document.getElementById('modalIdeaResult');
    const warnEl = document.getElementById('modalIdeaWarn');
    const outputEl = document.getElementById('modalIdeaOutput');
    document.getElementById('modalIdeaGenerate').addEventListener('click', () => {
      const date = dateInput.value;
      const idea = textInput.value.trim();
      if (!idea || !date) {
        warnEl.hidden = false;
        warnEl.textContent = !idea ? 'Enter the actual idea first.' : 'Pick the date this idea was actually logged.';
        outputEl.textContent = '';
        resultEl.hidden = false;
        return;
      }
      warnEl.hidden = true;
      outputEl.textContent = JSON.stringify({ date, idea }, null, 2) + ',';
      resultEl.hidden = false;
    });
    wireCopyButton(document.getElementById('modalIdeaCopy'), outputEl);
  }

  function closeModal() {
    modalOverlay.hidden = true;
    unlockBodyScroll();
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

  // Falls back to a hidden textarea + execCommand for browsers/contexts where
  // the async Clipboard API isn't available, same as CGT and Garage's own
  // copy-link buttons, instead of just hiding the button.
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
    } finally {
      document.body.removeChild(ta);
    }
    return Promise.resolve();
  }

  const COPY_LINK_LABEL = copyLinkBtn.textContent;
  copyLinkBtn.addEventListener('click', () => {
    copyText(location.href)
      .then(() => { copyLinkBtn.textContent = 'Link copied'; })
      .catch(() => { copyLinkBtn.textContent = "Couldn't copy, link is in the address bar"; })
      .finally(() => {
        setTimeout(() => { copyLinkBtn.textContent = COPY_LINK_LABEL; }, 1800);
      });
  });

  // "Log new prospect": a guided form that generates paste-ready JSON matching
  // the schema documented in the "How to log a real prospect" section, with
  // the same backfill/consistency warnings validate.js would raise. There is
  // no backend to write to, so this only ever produces text for hand-pasting
  // into prospects.json, never anything that saves or sends on its own.
  const npOverlay = document.getElementById('npOverlay');
  const npClose = document.getElementById('npClose');
  const npGenerateBtn = document.getElementById('npGenerateBtn');
  const npResult = document.getElementById('npResult');
  const npWarningsEl = document.getElementById('npWarnings');
  const npOutputEl = document.getElementById('npOutput');
  const npCopyBtn = document.getElementById('npCopyBtn');
  const npStageSelect = document.getElementById('npStage');
  const npCategoryList = document.getElementById('npCategoryList');
  const NP_FIELD_IDS = [
    'npName', 'npCompany', 'npCategory', 'npStageEnteredDate', 'npVerifiedHook',
    'npChannelType', 'npChannelDetail', 'npSendDate', 'npNextNudgeDate', 'npNextAction',
    'npDoNotNudgeBefore', 'npNudgePoint', 'npReplyStatus', 'npSocialPlatform',
    'npSocialFollowers', 'npSocialEngagementRate', 'npSocialAsOfDate', 'npNotes'
  ];
  let npLastFocusedEl = null;

  function npSlugify(name, company) {
    const base = [company, name].filter(Boolean).join('-');
    return base.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'new-prospect';
  }

  function npUniqueId(baseId) {
    if (!byId[baseId]) return baseId;
    let n = 2;
    while (byId[baseId + '-' + n]) n++;
    return baseId + '-' + n;
  }

  function npVal(id) {
    const v = document.getElementById(id).value.trim();
    return v === '' ? null : v;
  }

  // Mirrors the key rules in data/validate.js so a prospect generated here
  // is warned about the same things the validator would catch, before it
  // ever gets hand-pasted into prospects.json.
  function npBuildWarnings(p, isDuplicateId) {
    const warnings = [];
    if (isDuplicateId) {
      warnings.push('An id starting with "' + p.id.replace(/-\d+$/, '') + '" already exists, this one was ' +
        'suffixed to "' + p.id + '" to avoid a duplicate. Rename it to something more readable if you want.');
    }
    if (p.stage !== 'researched' && !(p.contactChannel && p.contactChannel.type)) {
      warnings.push('Stage is "' + p.stage + '" but contact channel type is not logged. This is the single ' +
        'biggest driver of real reply rate, fill it in as soon as it is known.');
    }
    if (p.stage !== 'researched' && !p.verifiedHook) {
      warnings.push('Stage is "' + p.stage + '" but verified hook is not logged. Backfill why this person/brand ' +
        'is a real fit once known.');
    }
    const ns = p.nudgeSchedule || {};
    if (ns.doNotNudgeBefore && ns.nudgePoint && ns.doNotNudgeBefore > ns.nudgePoint) {
      warnings.push('"Do not nudge before" is after "nudge point", swap them.');
    }
    if (ns.doNotNudgeBefore && p.nextNudgeDate && p.nextNudgeDate < ns.doNotNudgeBefore) {
      warnings.push('"Next nudge date" is before "do not nudge before", the nudge queue would surface this ' +
        'prospect too early.');
    }
    if (p.nextNudgeDate && !p.nextAction) {
      warnings.push('Next nudge date is set but next action is not. A due date with no concrete next step is a ' +
        'common way real deals quietly stall.');
    }
    const snap = p.socialSnapshot || {};
    if ((snap.followers != null || snap.engagementRate != null) && !snap.asOfDate) {
      warnings.push('Social numbers are logged without an as-of date. Every social number on this board must be ' +
        'labeled with when it was actually pulled, never shown as if live.');
    }
    if (p.category) {
      const norm = p.category.trim().toLowerCase();
      const existing = allProspects.map(x => x.category).filter(Boolean);
      const clash = existing.find(c => c.trim().toLowerCase() === norm && c !== p.category);
      if (clash) {
        warnings.push('Category "' + p.category + '" differs in casing/spacing from existing category "' + clash +
          '", they would render as separate filter chips. Pick one spelling.');
      }
    }
    return warnings;
  }

  function npBuildProspect() {
    const name = npVal('npName');
    const company = npVal('npCompany');
    const stage = npStageSelect.value;
    const stageEnteredDate = npVal('npStageEnteredDate');
    const baseId = npSlugify(name || 'new-prospect', company);
    const id = npUniqueId(baseId);
    const isDuplicateId = id !== baseId;

    const p = {
      id,
      name: name || 'UNNAMED, fill this in',
      company,
      category: npVal('npCategory'),
      stage,
      stageEnteredDate,
      verifiedHook: npVal('npVerifiedHook'),
      contactChannel: { type: npVal('npChannelType'), detail: npVal('npChannelDetail') },
      sendDate: npVal('npSendDate'),
      nextNudgeDate: npVal('npNextNudgeDate'),
      nextAction: npVal('npNextAction'),
      nudgeSchedule: { doNotNudgeBefore: npVal('npDoNotNudgeBefore'), nudgePoint: npVal('npNudgePoint') },
      replyStatus: npVal('npReplyStatus'),
      socialSnapshot: {
        platform: npVal('npSocialPlatform'),
        followers: npVal('npSocialFollowers') != null ? Number(npVal('npSocialFollowers')) : null,
        engagementRate: npVal('npSocialEngagementRate') != null ? Number(npVal('npSocialEngagementRate')) : null,
        asOfDate: npVal('npSocialAsOfDate')
      },
      contentIdeas: [],
      stageHistory: stageEnteredDate ? [{ date: stageEnteredDate, stage }] : [],
      notes: npVal('npNotes')
    };
    return { p, isDuplicateId };
  }

  function npPopulateStageOptions() {
    npStageSelect.innerHTML = allStages.map(s => '<option value="' + escapeHtml(s.id) + '">' +
      escapeHtml(s.label) + '</option>').join('');
  }

  function npPopulateCategoryList() {
    const categories = Array.from(new Set(allProspects.map(p => p.category).filter(Boolean))).sort();
    npCategoryList.innerHTML = categories.map(c => '<option value="' + escapeHtml(c) + '"></option>').join('');
  }

  function npResetForm() {
    NP_FIELD_IDS.forEach(id => { document.getElementById(id).value = ''; });
    npStageSelect.value = 'researched';
    npResult.hidden = true;
    npOutputEl.textContent = '';
    npWarningsEl.innerHTML = '';
  }

  function npOpen() {
    npLastFocusedEl = document.activeElement;
    npPopulateStageOptions();
    npPopulateCategoryList();
    npResetForm();
    npOverlay.hidden = false;
    lockBodyScroll();
    document.getElementById('npName').focus();
  }

  function npCloseModal() {
    npOverlay.hidden = true;
    unlockBodyScroll();
    if (npLastFocusedEl && typeof npLastFocusedEl.focus === 'function') npLastFocusedEl.focus();
    npLastFocusedEl = null;
  }

  document.getElementById('newProspectBtn').addEventListener('click', npOpen);
  npClose.addEventListener('click', npCloseModal);
  npOverlay.addEventListener('click', e => { if (e.target === npOverlay) npCloseModal(); });

  document.addEventListener('keydown', e => {
    if (npOverlay.hidden) return;
    if (e.key === 'Escape') { npCloseModal(); return; }
    if (e.key === 'Tab') {
      const focusable = Array.from(npModalEl().querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )).filter(el => !el.hasAttribute('disabled'));
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
  function npModalEl() { return document.getElementById('npModal'); }

  npGenerateBtn.addEventListener('click', () => {
    const { p, isDuplicateId } = npBuildProspect();
    const warnings = npBuildWarnings(p, isDuplicateId);
    npWarningsEl.innerHTML = warnings.map(w => '<li>' + escapeHtml(w) + '</li>').join('');
    npOutputEl.textContent = JSON.stringify(p, null, 2) + ',';
    npResult.hidden = false;
    npResult.scrollIntoView({ block: 'nearest' });
  });

  npCopyBtn.addEventListener('click', () => {
    const original = npCopyBtn.textContent;
    copyText(npOutputEl.textContent)
      .then(() => { npCopyBtn.textContent = 'Copied'; })
      .catch(() => { npCopyBtn.textContent = "Couldn't copy"; })
      .finally(() => { setTimeout(() => { npCopyBtn.textContent = original; }, 1800); });
  });

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
    renderActivityFeed(allProspects, allStages);
    applyFilter();
    document.getElementById('newProspectBtn').disabled = false;
  }).catch(err => {
    boardEl.innerHTML = '<div class="column-empty" role="alert">Failed to load pipeline data: ' + escapeHtml(err.message) + '</div>';
    nudgeEl.innerHTML = '<p class="nudge-empty">Failed to load.</p>';
    activityFeedEl.innerHTML = '<p class="activity-empty" role="alert">Failed to load.</p>';
  });
})();

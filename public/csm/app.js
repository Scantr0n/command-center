(function () {
  const boardEl = document.getElementById('board');
  const nudgeEl = document.getElementById('nudgeQueue');
  const statsEl = document.getElementById('statsBar');
  const searchInput = document.getElementById('searchInput');
  const modalOverlay = document.getElementById('modalOverlay');
  const modalName = document.getElementById('modalName');
  const modalCompany = document.getElementById('modalCompany');
  const modalBody = document.getElementById('modalBody');
  const modalClose = document.getElementById('modalClose');

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
      let when;
      if (days < 0) when = Math.abs(days) + 'd overdue';
      else if (days === 0) when = 'today';
      else when = 'in ' + days + 'd';
      const notBefore = p.nudgeSchedule && p.nudgeSchedule.doNotNudgeBefore
        ? ' &middot; do not nudge before ' + fmtDate(p.nudgeSchedule.doNotNudgeBefore)
        : '';
      return '<div class="nudge-row">' +
        '<strong>' + escapeHtml(p.name) + '</strong>' +
        '<span style="color:var(--sub)">' + escapeHtml(p.company || '') + '</span>' +
        '<span class="font-mono" style="margin-left:auto;color:var(--dim)">' +
        fmtDate(p.nextNudgeDate) + ' (' + when + ')' + notBefore +
        '</span></div>';
    }).join('');
  }

  function renderBoard(stages, prospects, allProspects, query) {
    const filtering = !!query;
    boardEl.innerHTML = stages.map(stage => {
      const inStage = prospects.filter(p => p.stage === stage.id);
      const totalInStage = allProspects.filter(p => p.stage === stage.id).length;
      let cards;
      if (inStage.length) {
        cards = inStage.map(p => renderCard(p)).join('');
      } else if (filtering && totalInStage > 0) {
        cards = '<div class="column-empty">No matches for "' + escapeHtml(query) + '" in this stage.</div>';
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

  function renderCard(p) {
    return '<button class="card" data-prospect-id="' + escapeHtml(p.id) + '">' +
      '<div class="card-name">' + escapeHtml(p.name) + '</div>' +
      '<div class="card-company">' + escapeHtml(p.company || 'Company not logged') + '</div>' +
      '<div class="card-meta">' + channelBadge(p.contactChannel) + '</div>' +
      '</button>';
  }

  let byId = {};
  let allStages = [];
  let allProspects = [];

  function applyFilter() {
    const query = searchInput.value.trim().toLowerCase();
    const filtered = query
      ? allProspects.filter(p =>
          (p.name || '').toLowerCase().includes(query) ||
          (p.company || '').toLowerCase().includes(query))
      : allProspects;
    renderBoard(allStages, filtered, allProspects, query);
  }

  searchInput.addEventListener('input', applyFilter);

  function openModal(id) {
    const p = byId[id];
    if (!p) return;
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

    const ideas = p.contentIdeas || [];
    const ideasHtml = ideas.length
      ? '<ul class="ideas-list">' + ideas.map(i => '<li>' + escapeHtml(i) + '</li>').join('') + '</ul>'
      : 'No content ideas logged yet.';
    rows.push(fieldRow('Content ideas log', ideasHtml, ideas.length === 0));

    rows.push(fieldRow('Notes', p.notes ? escapeHtml(p.notes) : 'None', !p.notes));

    modalBody.innerHTML = rows.join('');
    modalOverlay.hidden = false;
  }

  function closeModal() { modalOverlay.hidden = true; }
  modalClose.addEventListener('click', closeModal);
  modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  Promise.all([
    fetch('/csm/data/stages.json').then(r => r.json()),
    fetch('/csm/data/prospects.json').then(r => r.json())
  ]).then(([stagesData, prospectsData]) => {
    allStages = stagesData.stages;
    allProspects = prospectsData.prospects;
    byId = Object.fromEntries(allProspects.map(p => [p.id, p]));
    renderNudgeQueue(allProspects);
    renderStats(allStages, allProspects);
    renderBoard(allStages, allProspects, allProspects, '');
  }).catch(err => {
    boardEl.innerHTML = '<div class="column-empty">Failed to load pipeline data: ' + escapeHtml(err.message) + '</div>';
    nudgeEl.innerHTML = '<p class="nudge-empty">Failed to load.</p>';
  });
})();

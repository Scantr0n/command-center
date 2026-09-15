(function () {
  const boardEl = document.getElementById('board');
  const boardListWrapEl = document.getElementById('boardListWrap');
  const boardListEl = document.getElementById('boardList');
  const viewToggleEl = document.getElementById('viewToggle');
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
  const modalCopyLinkBtn = document.getElementById('modalCopyLinkBtn');
  const printBtn = document.getElementById('printBtn');
  const csvBtn = document.getElementById('csvBtn');
  const icsBtn = document.getElementById('icsBtn');
  const copyLinkBtn = document.getElementById('copyLinkBtn');
  const dataQualitySection = document.getElementById('dataQualitySection');
  const dataQualityList = document.getElementById('dataQualityList');
  const activityFeedEl = document.getElementById('activityFeed');
  const velocityListEl = document.getElementById('velocityList');
  const funnelListEl = document.getElementById('funnelList');
  const channelEffListEl = document.getElementById('channelEffList');
  const categoryEffListEl = document.getElementById('categoryEffList');
  const attentionBarEl = document.getElementById('attentionBar');
  const ACTIVITY_PREVIEW_COUNT = 8;

  printBtn.addEventListener('click', () => window.print());

  function fmtDate(iso) {
    if (!iso) return null;
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  // Same shape check data/validate.js already runs before this data reaches
  // the browser, kept here too since a hand-edit that skipped validate.js
  // (a non-zero-padded "2026-9-5", for example) reaches daysUntil() as a
  // string that parses to Invalid Date/NaN with no error, not a thrown one.
  function isValidDateStr(iso) {
    return typeof iso === 'string' && DATE_RE.test(iso) && !isNaN(new Date(iso + 'T00:00:00').getTime());
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

  // True when hand-typed dates in a log don't actually increase in the order
  // sorting them as strings produces. Catches two real hand-edit slips: a
  // genuine out-of-order date, and a non-zero-padded date like "2026-9-5"
  // (sorts after "2026-10-01" lexically despite coming first chronologically,
  // and fails to parse at all via daysUntil, which shows up here as NaN).
  // computeStageVelocity below already skips exactly this case per pair
  // rather than let it produce a negative dwell time; this is the same check
  // reused so the per-prospect timeline (renderStageHistory/renderOutreachLog)
  // can flag it too instead of just quietly showing "-12d in stage" or "NaNd".
  function hasOutOfOrderDates(entries) {
    const dated = (entries || []).filter(e => e && e.date).slice().sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 0; i < dated.length - 1; i++) {
      const diff = daysUntil(dated[i + 1].date) - daysUntil(dated[i].date);
      if (!(diff >= 0)) return true;
    }
    return false;
  }

  function stallInfo(p, stageById) {
    const stageDef = stageById[p.stage];
    if (!stageDef || stageDef.staleAfterDays == null || !p.stageEnteredDate) return null;
    const days = daysSince(p.stageEnteredDate);
    return { days, staleAfterDays: stageDef.staleAfterDays, isStale: days > stageDef.staleAfterDays };
  }

  // Follower/engagement numbers are a one-time manual pull, never live, so
  // the "as of" date is the only thing keeping them honest. 90 days (a
  // typical social-audit refresh cadence) is the point past which those
  // numbers are old enough that showing them without a loud flag would be
  // misleading, not just informative.
  const SOCIAL_SNAPSHOT_STALE_DAYS = 90;
  function socialSnapshotStaleInfo(p) {
    const snap = p.socialSnapshot || {};
    if (snap.followers == null && snap.engagementRate == null) return null;
    if (!snap.asOfDate) return null;
    const days = daysSince(snap.asOfDate);
    if (days <= SOCIAL_SNAPSHOT_STALE_DAYS) return null;
    return { days };
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
        const dwellDays = daysUntil(dwellEnd) - daysUntil(dwellStart);
        // A negative value here means the two dates are out of order (a
        // hand-typed formatting slip, see hasOutOfOrderDates), not a real
        // negative dwell time, so it's left blank rather than shown as-is.
        dwellText = dwellDays >= 0 ? dwellDays + 'd in stage' : '';
      } else if (dwellStart) {
        dwellText = daysSince(dwellStart) + 'd in stage so far';
      } else {
        dwellText = '';
      }
      return '<li class="timeline-row">' +
        '<span class="timeline-dot" style="background:' + escapeHtml(color) + '"></span>' +
        '<span class="timeline-body">' +
        '<span class="timeline-stage">' + escapeHtml(label) + '</span>' +
        '<span class="timeline-date font-mono">' + (entry.date ? escapeHtml(fmtDate(entry.date)) : 'NO DATE') +
        (dwellText ? ' &middot; ' + dwellText : '') + '</span>' +
        '</span></li>';
    }).join('');
    return { html: '<ul class="timeline-list">' + rowsHtml + '</ul>', empty: false };
  }

  const OUTREACH_TYPE_LABEL = { 'initial-send': 'Initial send', 'nudge': 'Nudge' };

  // A prospect can be nudged more than once before it moves stage, so a
  // single sendDate/nextNudgeDate pair has no memory of what already went
  // out. outreachLog is the actual touch-by-touch record: real replies come
  // from follow-ups, not the first message, so knowing how many real touches
  // have already happened (and when) is its own signal, separate from
  // stageHistory (pipeline stage) and contentIdeas (what to say).
  function renderOutreachLog(p) {
    const log = (p.outreachLog || []).filter(e => e && e.date);
    if (log.length === 0) {
      return { html: 'No outreach touches logged yet.', empty: true, count: 0 };
    }
    const sorted = log.slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const rowsHtml = sorted.map((entry, i) => {
      const label = OUTREACH_TYPE_LABEL[entry.type] || entry.type || 'Touch';
      const prev = sorted[i - 1];
      const gapDays = prev && prev.date && entry.date ? daysUntil(entry.date) - daysUntil(prev.date) : null;
      // Same out-of-order-date guard as renderStageHistory's dwellText above.
      const gapText = gapDays != null && gapDays >= 0 ? gapDays + 'd since last touch' : '';
      return '<li class="timeline-row">' +
        '<span class="timeline-dot" style="background:#5EC8D8"></span>' +
        '<span class="timeline-body">' +
        '<span class="timeline-stage">' + escapeHtml(label) + (entry.note ? ': ' + escapeHtml(entry.note) : '') + '</span>' +
        '<span class="timeline-date font-mono">' + escapeHtml(fmtDate(entry.date)) +
        (gapText ? ' &middot; ' + gapText : '') + '</span>' +
        '</span></li>';
    }).join('');
    const summary = '<div class="section-note" style="margin:0 0 8px">' + sorted.length + ' touch' +
      (sorted.length === 1 ? '' : 'es') + ' logged &middot; last ' + escapeHtml(fmtDate(sorted[sorted.length - 1].date)) + '</div>';
    return { html: summary + '<ul class="timeline-list">' + rowsHtml + '</ul>', empty: false, count: sorted.length };
  }

  function fieldRow(label, valueHtml, isEmpty) {
    return '<div class="field-row">' +
      '<div class="field-label">' + escapeHtml(label) + '</div>' +
      '<div class="field-value' + (isEmpty ? ' empty' : '') + '">' + valueHtml + '</div>' +
      '</div>';
  }

  // Real gap this closes: nudgeSchedule.nudgePoint is the actual planned "nudge by
  // this date" record (edited via the same guided forms as everything else on this
  // board), but the queue keys off the separate nextNudgeDate field. A real
  // nudgePoint can be logged, pass, and never appear anywhere on the board if
  // nextNudgeDate was never also set to match it, silently falling off the radar
  // with nothing here saying so. Surface those the same way an overdue nudge is.
  function computeNudgeRows(prospects) {
    const withDates = prospects
      .filter(p => p.nextNudgeDate && isValidDateStr(p.nextNudgeDate))
      .map(p => ({ p, days: daysUntil(p.nextNudgeDate), unqueued: false, badDate: false }));

    // A nextNudgeDate that fails the same format check validate.js runs
    // (typically a non-zero-padded hand-edit like "2026-9-5") still needs
    // a real row here, not silence: it stays "on the queue" per the data,
    // it just can't be given a real due date, so say so instead of letting
    // it fall through to daysUntil's NaN and print "in NaNd".
    const badDates = prospects
      .filter(p => p.nextNudgeDate && !isValidDateStr(p.nextNudgeDate))
      .map(p => ({ p, days: Infinity, unqueued: false, badDate: true }));

    const unqueued = prospects
      .filter(p => {
        const point = p.nudgeSchedule && p.nudgeSchedule.nudgePoint;
        return point && !p.nextNudgeDate && isValidDateStr(point) && daysUntil(point) <= 0;
      })
      .map(p => ({ p, days: daysUntil(p.nudgeSchedule.nudgePoint), unqueued: true, badDate: false }));

    return withDates.concat(unqueued).concat(badDates).sort((a, b) => a.days - b.days);
  }

  function renderNudgeQueue(prospects) {
    const rows = computeNudgeRows(prospects);
    icsBtn.disabled = rows.filter(r => !r.unqueued && !r.badDate).length === 0;

    if (rows.length === 0) {
      nudgeEl.innerHTML = '<p class="nudge-empty">No nudge dates logged yet. Once a real send date and nudge ' +
        'schedule are recorded for a prospect, the next one due shows up here.</p>';
      return;
    }

    nudgeEl.innerHTML = rows.map(({ p, days, unqueued, badDate }) => {
      let when, urgency;
      if (badDate) { when = 'bad date'; urgency = 'overdue'; }
      else if (unqueued) { when = Math.abs(days) + 'd past planned nudge point'; urgency = 'overdue'; }
      else if (days < 0) { when = Math.abs(days) + 'd overdue'; urgency = 'overdue'; }
      else if (days === 0) { when = 'today'; urgency = 'today'; }
      else if (days <= 2) { when = 'in ' + days + 'd'; urgency = 'soon'; }
      else { when = 'in ' + days + 'd'; urgency = 'later'; }
      const notBefore = p.nudgeSchedule && p.nudgeSchedule.doNotNudgeBefore
        ? ' &middot; do not nudge before ' + fmtDate(p.nudgeSchedule.doNotNudgeBefore)
        : '';
      const dateShown = badDate ? escapeHtml(p.nextNudgeDate) : (unqueued ? fmtDate(p.nudgeSchedule.nudgePoint) : fmtDate(p.nextNudgeDate));
      const unqueuedNote = badDate
        ? '<div class="nudge-action nudge-action-missing">BAD DATE LOGGED &middot; nextNudgeDate "' +
          escapeHtml(p.nextNudgeDate) + '" is not a valid YYYY-MM-DD date, fix it in the edit form</div>'
        : (unqueued
          ? '<div class="nudge-action nudge-action-missing">NOT ON THE QUEUE &middot; nudgeSchedule.nudgePoint ' +
            'passed but nextNudgeDate was never set, log a real nextNudgeDate or this keeps going unseen</div>'
          : '');
      const actionLine = p.nextAction
        ? '<div class="nudge-action">' + escapeHtml(p.nextAction) + '</div>'
        : (unqueued ? '' : '<div class="nudge-action nudge-action-missing">NO NEXT ACTION LOGGED &middot; a due date alone tends to stall</div>');
      const touchCount = (p.outreachLog || []).filter(e => e && e.date).length;
      const touchLine = touchCount > 0
        ? '<span class="nudge-touch-count font-mono">' + touchCount + ' touch' + (touchCount === 1 ? '' : 'es') +
          ' logged so far</span>'
        : '';
      return '<div class="nudge-row nudge-' + urgency + (unqueued || badDate ? ' nudge-row-unqueued' : '') + '">' +
        '<div class="nudge-top">' +
        '<span class="nudge-urgency-dot"></span>' +
        '<strong>' + escapeHtml(p.name) + '</strong>' +
        '<span style="color:var(--sub)">' + escapeHtml(p.company || '') + '</span>' +
        '<span class="font-mono nudge-when">' +
        dateShown + ' (' + when + ')' + notBefore +
        '</span></div>' +
        unqueuedNote +
        actionLine +
        touchLine +
        '</div>';
    }).join('');
  }

  // One-glance digest above everything else on the page: pulls counts the
  // sections below already compute (nudge queue, stalled, data quality,
  // duplicates) into a single row of jump links, so a real overdue nudge or
  // a stalled deal doesn't require scrolling past several sections to
  // notice. Never computes anything new, just points at where each count
  // already lives, so it can never drift out of sync with those sections.
  function renderAttentionBar(stages, prospects) {
    const nudgeRows = computeNudgeRows(prospects);
    const overdueCount = nudgeRows.filter(r => r.days <= 0).length;
    const stalledCount = computeStalled(stages, prospects).length;
    const coldSignalCount = computeColdSignal(prospects).length;
    const backfillCount = computeDataQualityFlags(stages, prospects).length;
    const duplicateCount = findDuplicateProspects(prospects).length;

    const items = [];
    if (overdueCount) {
      items.push({
        n: overdueCount, tone: 'urgent', target: 'nudgeQueue',
        label: overdueCount === 1 ? 'nudge due or overdue' : 'nudges due or overdue'
      });
    }
    if (stalledCount) {
      items.push({
        n: stalledCount, tone: 'warn', target: 'stalledList',
        label: stalledCount === 1 ? 'prospect stalled in stage' : 'prospects stalled in stage'
      });
    }
    if (coldSignalCount) {
      items.push({
        n: coldSignalCount, tone: 'warn', target: 'coldSignalList',
        label: coldSignalCount === 1 ? 'prospect may need a new approach' : 'prospects may need a new approach'
      });
    }
    if (backfillCount) {
      items.push({
        n: backfillCount, tone: 'warn', target: 'dataQualityList',
        label: backfillCount === 1 ? 'prospect needs backfill' : 'prospects need backfill'
      });
    }
    if (duplicateCount) {
      items.push({
        n: duplicateCount, tone: 'warn', target: 'duplicatesList',
        label: duplicateCount === 1 ? 'possible duplicate' : 'possible duplicates'
      });
    }

    if (items.length === 0) {
      attentionBarEl.hidden = true;
      attentionBarEl.innerHTML = '';
      return;
    }

    attentionBarEl.hidden = false;
    attentionBarEl.innerHTML = items.map(item =>
      '<button type="button" class="attention-pill attention-' + item.tone + '" data-target="' +
      escapeHtml(item.target) + '"><strong>' + item.n + '</strong> ' + escapeHtml(item.label) + '</button>'
    ).join('');

    attentionBarEl.querySelectorAll('[data-target]').forEach(btn => {
      btn.addEventListener('click', () => {
        const el = document.getElementById(btn.getAttribute('data-target'));
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  function byUrgency(a, b) {
    if (a.nextNudgeDate && b.nextNudgeDate) return a.nextNudgeDate < b.nextNudgeDate ? -1 : 1;
    if (a.nextNudgeDate) return -1;
    if (b.nextNudgeDate) return 1;
    return (a.name || '').localeCompare(b.name || '');
  }

  const stalledEl = document.getElementById('stalledList');
  const stalledSection = document.getElementById('stalledSection');

  function computeStalled(stages, prospects) {
    const stageById = Object.fromEntries(stages.map(s => [s.id, s]));
    return prospects
      .map(p => ({ p, info: stallInfo(p, stageById) }))
      .filter(x => x.info && x.info.isStale)
      .sort((a, b) => b.info.days - a.info.days);
  }

  function renderStalled(stages, prospects) {
    const stalled = computeStalled(stages, prospects);

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

  const duplicatesEl = document.getElementById('duplicatesList');
  const duplicatesSection = document.getElementById('duplicatesSection');

  // Same duplicate-detection convention already used elsewhere in this
  // project (e.g. CGT's findDuplicateGroups): group by a normalized key of
  // the fields that actually identify who a prospect is, name + company,
  // case/whitespace-insensitive, and flag any group with more than one
  // member. The real risk this catches: the "Log new prospect" generator
  // only guards against an exact id collision (npUniqueId), so hand-typing
  // the same person into a second entry under a slightly different id would
  // otherwise go unnoticed. Mirrored in validate.js so the two never drift.
  function findDuplicateProspects(prospects) {
    const byKey = new Map();
    (prospects || []).forEach(p => {
      if (!p.name) return;
      const key = p.name.trim().toLowerCase() + '|' + (p.company || '').trim().toLowerCase();
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(p);
    });
    return [...byKey.values()].filter(group => group.length > 1);
  }

  function renderDuplicates(prospects) {
    const groups = findDuplicateProspects(prospects);
    if (groups.length === 0) {
      duplicatesSection.hidden = true;
      return;
    }
    duplicatesSection.hidden = false;
    duplicatesEl.innerHTML = groups.map(group => group.map(p =>
      '<button type="button" class="data-quality-row" data-prospect-id="' + escapeHtml(p.id) + '">' +
      '<strong>' + escapeHtml(p.name) + '</strong>' +
      '<span style="color:var(--sub)">' + escapeHtml(p.company || '') + '</span>' +
      '<span class="dq-why">' + group.length + ' ENTRIES MATCH ON NAME + COMPANY</span>' +
      '</button>'
    ).join('')).join('');
    wireRowsToModal(duplicatesEl);
  }

  const coldSignalEl = document.getElementById('coldSignalList');
  const coldSignalSection = document.getElementById('coldSignalSection');

  // Real signal from cold-outreach practice, not something invented for this
  // board: a contact who has received several real touches (initial send +
  // nudges, from the same outreachLog already used above) while still sitting
  // in outreach-sent (no reply, no stage move) is a sign the hook or channel
  // isn't landing, not just that another identical nudge is due. Distinct
  // from "stalled" (which only looks at time sitting in a stage regardless of
  // how many touches happened) and from "needs backfill" (missing fields):
  // this looks at real touch count vs. real stage movement.
  const COLD_TOUCH_THRESHOLD = 3;

  function computeColdSignal(prospects) {
    return prospects
      .filter(p => p.stage === 'outreach-sent')
      .map(p => ({ p, touches: (p.outreachLog || []).filter(e => e && e.date).length }))
      .filter(x => x.touches >= COLD_TOUCH_THRESHOLD)
      .sort((a, b) => b.touches - a.touches);
  }

  function renderColdSignal(stages, prospects) {
    const flagged = computeColdSignal(prospects);
    if (flagged.length === 0) {
      coldSignalSection.hidden = true;
      return;
    }
    coldSignalSection.hidden = false;
    coldSignalEl.innerHTML = flagged.map(({ p, touches }) =>
      '<button type="button" class="data-quality-row" data-prospect-id="' + escapeHtml(p.id) + '">' +
      '<strong>' + escapeHtml(p.name) + '</strong>' +
      '<span style="color:var(--sub)">' + escapeHtml(p.company || '') + '</span>' +
      '<span class="dq-why">' + touches + ' REAL TOUCHES LOGGED, STILL WAITING ON A REPLY</span>' +
      '</button>'
    ).join('');
    wireRowsToModal(coldSignalEl);
  }

  function computeDataQualityFlags(stages, prospects) {
    return prospects
      .map(p => {
        const reasons = [];
        if (p.stage !== 'researched') {
          if (!(p.contactChannel && p.contactChannel.type)) reasons.push('NO CONTACT CHANNEL TYPE LOGGED');
          if (!p.verifiedHook) reasons.push('NO VERIFIED HOOK LOGGED');
        }
        const snapStale = socialSnapshotStaleInfo(p);
        if (snapStale) reasons.push(snapStale.days + 'D OLD SOCIAL SNAPSHOT, DUE FOR REFRESH');
        if (hasOutOfOrderDates(p.stageHistory)) reasons.push('STAGE HISTORY DATES OUT OF ORDER, CHECK FORMATTING');
        if (hasOutOfOrderDates(p.outreachLog)) reasons.push('OUTREACH LOG DATES OUT OF ORDER, CHECK FORMATTING');
        if (p.nextNudgeDate && !isValidDateStr(p.nextNudgeDate)) reasons.push('NEXT NUDGE DATE IS NOT A VALID DATE, CHECK FORMATTING');
        return { p, reasons };
      })
      .filter(x => x.reasons.length > 0);
  }

  function renderDataQuality(stages, prospects) {
    const stageLabel = Object.fromEntries(stages.map(s => [s.id, s.label]));
    const flagged = computeDataQualityFlags(stages, prospects);

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
      (p.outreachLog || []).forEach(entry => {
        if (!entry.date) return;
        const label = (OUTREACH_TYPE_LABEL[entry.type] || entry.type || 'Touch') + (entry.note ? ': ' + entry.note : '');
        events.push({ date: entry.date, type: 'touch', prospect: p, label });
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
        ? '<span class="activity-tag activity-tag-stage" style="color:' + escapeHtml(ev.color) + ';border-color:' + escapeHtml(ev.color) + '66">MOVED</span>'
        : ev.type === 'touch'
        ? '<span class="activity-tag activity-tag-touch">TOUCH</span>'
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
      (needsToggle ? '<button type="button" class="activity-toggle font-mono" id="activityToggle" aria-expanded="false" aria-controls="activityList">Show all ' +
        events.length + '</button>' : '');
    const toggleBtn = document.getElementById('activityToggle');
    const listEl = document.getElementById('activityList');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        const collapsed = listEl.classList.toggle('is-collapsed');
        toggleBtn.textContent = collapsed ? 'Show all ' + events.length : 'Show fewer';
        toggleBtn.setAttribute('aria-expanded', String(!collapsed));
      });
    }
  }

  // How many prospects have ever reached each stage, inferred from current
  // stage alone: since the pipeline is a straight line (researched ->
  // outreach-sent -> silent-replied -> in-exploration -> client), a prospect
  // sitting at stage index i has necessarily already passed every stage
  // before it, whether or not that move was ever logged in stageHistory.
  // Unlike computeStageVelocity, this works from data every prospect already
  // has (the required "stage" field), not only from optional history logs.
  function computeFunnel(stages, prospects) {
    const indexOfStage = Object.fromEntries(stages.map((s, i) => [s.id, i]));
    const reached = stages.map(() => 0);
    prospects.forEach(p => {
      const idx = indexOfStage[p.stage];
      if (idx == null) return;
      for (let i = 0; i <= idx; i++) reached[i]++;
    });
    return stages.map((stage, i) => ({
      stage,
      reached: reached[i],
      conversionFromPrev: i > 0 && reached[i - 1] > 0 ? Math.round((reached[i] / reached[i - 1]) * 100) : null
    }));
  }

  function renderFunnel(stages, prospects) {
    const results = computeFunnel(stages, prospects);
    const total = results.length ? results[0].reached : 0;
    if (total === 0) {
      funnelListEl.innerHTML = '<p class="funnel-empty">No prospects logged yet.</p>';
      return;
    }
    funnelListEl.innerHTML = results.map(r => {
      const widthPct = total > 0 ? Math.max(2, Math.round((r.reached / total) * 100)) : 0;
      const conversionHtml = r.conversionFromPrev == null ? '' :
        '<span class="funnel-conversion font-mono">' + r.conversionFromPrev + '% reached this stage from the ' +
        'previous one</span>';
      return '<div class="funnel-row">' +
        '<div class="funnel-row-head">' +
        '<span class="stage-dot" style="background:' + escapeHtml(r.stage.color) + '"></span>' +
        '<span class="funnel-label">' + escapeHtml(r.stage.label) + '</span>' +
        '<span class="funnel-count font-mono">' + r.reached + ' of ' + total + '</span>' +
        '</div>' +
        '<div class="funnel-track"><div class="funnel-fill" style="width:' + widthPct + '%;background:' +
        escapeHtml(r.stage.color) + '"></div></div>' +
        conversionHtml +
        '</div>';
    }).join('');
  }

  // Average time actually spent in each stage, computed only from completed
  // moves in a prospect's own stageHistory (entering a stage, then later
  // logging a move out of it). Deliberately separate from stallInfo(), which
  // only looks at prospects still sitting in a stage right now, this is a
  // pipeline-wide velocity signal from moves that already finished.
  function computeStageVelocity(stages, prospects) {
    const sums = {};
    const counts = {};
    stages.forEach(s => { sums[s.id] = 0; counts[s.id] = 0; });
    prospects.forEach(p => {
      const history = (p.stageHistory || [])
        .filter(e => e && e.date && e.stage)
        .slice()
        .sort((a, b) => a.date.localeCompare(b.date));
      for (let i = 0; i < history.length - 1; i++) {
        const cur = history[i];
        const next = history[i + 1];
        if (!(cur.stage in sums)) continue;
        const dwellDays = daysUntil(next.date) - daysUntil(cur.date);
        if (dwellDays < 0) continue;
        sums[cur.stage] += dwellDays;
        counts[cur.stage] += 1;
      }
    });
    return stages.map(s => ({
      stage: s,
      n: counts[s.id],
      avgDays: counts[s.id] > 0 ? Math.round(sums[s.id] / counts[s.id]) : null
    }));
  }

  function renderStageVelocity(stages, prospects) {
    const results = computeStageVelocity(stages, prospects);
    const totalMoves = results.reduce((sum, r) => sum + r.n, 0);
    if (totalMoves === 0) {
      velocityListEl.innerHTML = '<p class="velocity-empty">No completed stage moves logged yet across the ' +
        'pipeline. This fills in once a prospect&rsquo;s stageHistory shows a move out of a stage, not just ' +
        'into one.</p>';
      return;
    }
    velocityListEl.innerHTML = results.map(r => {
      const valueHtml = r.n > 0
        ? '<span class="velocity-value font-mono">' + r.avgDays + 'd avg &middot; ' + r.n +
          ' completed move' + (r.n === 1 ? '' : 's') + '</span>'
        : '<span class="velocity-value velocity-value-empty font-mono">No completed moves logged yet</span>';
      return '<div class="velocity-row">' +
        '<span class="velocity-dot" style="background:' + escapeHtml(r.stage.color) + '"></span>' +
        '<span class="velocity-label">' + escapeHtml(r.stage.label) + '</span>' +
        valueHtml +
        '</div>';
    }).join('');
  }

  // Counts, not rates, per contactChannel.type: how many prospects who have
  // actually been contacted (stage past "researched") went on to reach real
  // active exploration. "silent-replied" is deliberately excluded from the
  // positive count, that stage covers both no-response and an unadvanced
  // reply, so it cannot honestly be read as a signal either way. A minimum
  // sample size gates showing a percentage at all, so a 1-of-1 record never
  // renders as a misleading "100%".
  const CHANNEL_EFF_MIN_N_FOR_RATE = 5;
  function computeChannelEffectiveness(prospects) {
    const order = ['named-decision-maker', 'generic-inbox', 'unlogged'];
    const labels = {
      'named-decision-maker': 'Named decision-maker',
      'generic-inbox': 'Generic inbox',
      'unlogged': 'Channel not logged'
    };
    const buckets = {};
    order.forEach(key => { buckets[key] = { key, label: labels[key], contacted: 0, advanced: 0 }; });
    prospects.forEach(p => {
      if (p.stage === 'researched') return;
      const rawType = p.contactChannel && p.contactChannel.type;
      const key = buckets[rawType] ? rawType : 'unlogged';
      buckets[key].contacted += 1;
      const reachedExploration = p.stage === 'in-exploration' || p.stage === 'client' ||
        (p.stageHistory || []).some(e => e && (e.stage === 'in-exploration' || e.stage === 'client'));
      if (reachedExploration) buckets[key].advanced += 1;
    });
    return order.map(key => buckets[key]);
  }

  // Same shape as channel effectiveness above, but grouped by category
  // instead of contact channel: of prospects who have actually been
  // contacted, how many reached real active exploration, per category.
  // Category is the other real field this project tracks per prospect
  // (alongside contact channel), so which verticals are actually worth the
  // outreach effort is its own real signal, not folded into the channel
  // breakdown above. Same "silent-replied" exclusion and minimum-sample
  // gating as computeChannelEffectiveness, for the same reasons.
  function computeCategoryEffectiveness(prospects) {
    const buckets = {};
    const order = [];
    function bucketFor(category) {
      const key = category || 'uncategorized';
      if (!buckets[key]) {
        buckets[key] = { key, label: category || 'No category logged', contacted: 0, advanced: 0 };
        order.push(key);
      }
      return buckets[key];
    }
    prospects.forEach(p => {
      if (p.stage === 'researched') return;
      const bucket = bucketFor(p.category);
      bucket.contacted += 1;
      const reachedExploration = p.stage === 'in-exploration' || p.stage === 'client' ||
        (p.stageHistory || []).some(e => e && (e.stage === 'in-exploration' || e.stage === 'client'));
      if (reachedExploration) bucket.advanced += 1;
    });
    return order
      .map(key => buckets[key])
      .sort((a, b) => b.contacted - a.contacted || a.label.localeCompare(b.label));
  }

  function renderCategoryEffectiveness(prospects) {
    const results = computeCategoryEffectiveness(prospects);
    const totalContacted = results.reduce((sum, r) => sum + r.contacted, 0);
    if (totalContacted === 0) {
      categoryEffListEl.innerHTML = '<p class="channel-eff-empty">No prospects have moved past "researched" yet, ' +
        'this fills in once outreach has actually gone out.</p>';
      return;
    }
    categoryEffListEl.innerHTML = results.map(r => {
      // Below the minimum sample size, the bar has to stay as empty as the
      // text next to it, same reasoning as the CHANNEL_EFF_MIN_N_FOR_RATE
      // comment above: a filled-looking bar next to "sample too small for a
      // rate" would still visually claim the rate it says it can't show.
      const widthPct = r.contacted < CHANNEL_EFF_MIN_N_FOR_RATE ? 0
        : r.advanced > 0 ? Math.max(2, Math.round((r.advanced / r.contacted) * 100)) : 0;
      const rateHtml = r.contacted >= CHANNEL_EFF_MIN_N_FOR_RATE
        ? '<span class="channel-eff-rate font-mono">' + widthPct + '% reached active exploration</span>'
        : '<span class="channel-eff-rate font-mono">Sample too small for a rate (n=' + r.contacted + ')</span>';
      return '<div class="channel-eff-row">' +
        '<div class="channel-eff-row-head">' +
        '<span class="channel-eff-label">' + escapeHtml(r.label) + '</span>' +
        '<span class="channel-eff-count font-mono">' + r.advanced + ' of ' + r.contacted + ' reached exploration</span>' +
        '</div>' +
        '<div class="channel-eff-track"><div class="channel-eff-fill" style="width:' + widthPct + '%"></div></div>' +
        rateHtml +
        '</div>';
    }).join('');
  }

  function renderChannelEffectiveness(prospects) {
    const results = computeChannelEffectiveness(prospects);
    const totalContacted = results.reduce((sum, r) => sum + r.contacted, 0);
    if (totalContacted === 0) {
      channelEffListEl.innerHTML = '<p class="channel-eff-empty">No prospects have moved past "researched" yet, ' +
        'this fills in once outreach has actually gone out.</p>';
      return;
    }
    channelEffListEl.innerHTML = results.map(r => {
      if (r.contacted === 0) {
        return '<div class="channel-eff-row">' +
          '<div class="channel-eff-row-head">' +
          '<span class="channel-eff-label">' + escapeHtml(r.label) + '</span>' +
          '<span class="channel-eff-count-empty">No contacted prospects on this channel yet</span>' +
          '</div></div>';
      }
      // Same empty-bar-below-threshold rule as computeCategoryEffectiveness's
      // render function above, plus the same zero-advanced guard: without it,
      // Math.max(2, ...) floors a genuine 0-of-N rate up to a fabricated 2%.
      const widthPct = r.contacted < CHANNEL_EFF_MIN_N_FOR_RATE ? 0
        : r.advanced > 0 ? Math.max(2, Math.round((r.advanced / r.contacted) * 100)) : 0;
      const rateHtml = r.contacted >= CHANNEL_EFF_MIN_N_FOR_RATE
        ? '<span class="channel-eff-rate font-mono">' + widthPct + '% reached active exploration</span>'
        : '<span class="channel-eff-rate font-mono">Sample too small for a rate (n=' + r.contacted + ')</span>';
      return '<div class="channel-eff-row">' +
        '<div class="channel-eff-row-head">' +
        '<span class="channel-eff-label">' + escapeHtml(r.label) + '</span>' +
        '<span class="channel-eff-count font-mono">' + r.advanced + ' of ' + r.contacted + ' reached exploration</span>' +
        '</div>' +
        '<div class="channel-eff-track"><div class="channel-eff-fill" style="width:' + widthPct + '%"></div></div>' +
        rateHtml +
        '</div>';
    }).join('');
  }

  function renderBoard(stages, prospects, allProspects, displayQuery, filtering) {
    const stageById = Object.fromEntries(stages.map(s => [s.id, s]));
    boardEl.innerHTML = stages.map(stage => {
      const inStage = prospects.filter(p => p.stage === stage.id).sort(byUrgency);
      const totalInStage = allProspects.filter(p => p.stage === stage.id).length;
      let cards;
      if (inStage.length) {
        cards = inStage.map(p => renderCard(p, stageById)).join('');
      } else if (filtering && totalInStage > 0) {
        cards = '<div class="column-empty" role="status">No matches' +
          (displayQuery ? ' for "' + escapeHtml(displayQuery) + '"' : '') + ' in this stage.</div>';
      } else {
        cards = '<div class="column-empty">No prospects in this stage yet.</div>';
      }
      return '<div class="column" data-stage-id="' + escapeHtml(stage.id) + '">' +
        '<div class="column-head">' +
        '<span class="stage-dot" style="background:' + escapeHtml(stage.color) + '"></span>' +
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
    wireCardDragAndDrop();
  }

  // Kanban drag-to-restage, a standard pipeline-board interaction. Dragging a
  // card to a different column never touches prospects.json or the rendered
  // stage counts itself, that would show a stage move that was not actually
  // logged anywhere. Instead a drop opens that prospect's own detail modal
  // with the existing stage-move generator pre-set to the target stage and
  // already generated, so the only thing dragging saves is the clicks to get
  // there, never the honesty check on whether the move is real.
  function wireCardDragAndDrop() {
    boardEl.querySelectorAll('.card[data-prospect-id]').forEach(card => {
      card.addEventListener('dragstart', e => {
        e.dataTransfer.setData('text/plain', card.getAttribute('data-prospect-id'));
        e.dataTransfer.effectAllowed = 'move';
        card.classList.add('card-dragging');
      });
      card.addEventListener('dragend', () => card.classList.remove('card-dragging'));
    });

    boardEl.querySelectorAll('.column[data-stage-id]').forEach(column => {
      column.addEventListener('dragover', e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        column.classList.add('column-dragover');
      });
      column.addEventListener('dragleave', e => {
        if (!column.contains(e.relatedTarget)) column.classList.remove('column-dragover');
      });
      column.addEventListener('drop', e => {
        e.preventDefault();
        column.classList.remove('column-dragover');
        const id = e.dataTransfer.getData('text/plain');
        const targetStageId = column.getAttribute('data-stage-id');
        const p = byId[id];
        if (!p || p.stage === targetStageId) return;
        openModalForStageMove(id, targetStageId);
      });
    });
  }

  function openModalForStageMove(id, targetStageId) {
    openModal(id);
    const select = document.getElementById('modalMoveStage');
    const dateInput = document.getElementById('modalMoveDate');
    const generateBtn = document.getElementById('modalMoveGenerate');
    if (!select || !dateInput || !generateBtn) return;
    select.value = targetStageId;
    dateInput.value = todayIso();
    generateBtn.click();
    const resultEl = document.getElementById('modalMoveResult');
    if (resultEl) resultEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  // Table alternative to the kanban board: same filtered prospects, but shown
  // as one sortable list across every stage instead of grouped into columns.
  // Kanban is best for at-a-glance triage of where deals sit; a flat sortable
  // table is better for detail-driven work like "who is most overdue for a
  // nudge across the whole pipeline", which a column-grouped board can't
  // answer without scanning every column. Real, well-documented CRM UX
  // pattern (e.g. Pipeline CRM, HubSpot), not invented for this project.
  function channelSortRank(channel) {
    const type = channel && channel.type;
    if (type === 'named-decision-maker') return 0;
    if (type === 'generic-inbox') return 1;
    return 2;
  }

  function listComparator(key, dir, stageById, stageOrderIndex) {
    const mul = dir === 'desc' ? -1 : 1;
    return (a, b) => {
      let av, bv;
      switch (key) {
        case 'stage':
          av = stageOrderIndex[a.stage]; bv = stageOrderIndex[b.stage];
          av = av == null ? 999 : av; bv = bv == null ? 999 : bv;
          break;
        case 'category':
          av = (a.category || '').toLowerCase(); bv = (b.category || '').toLowerCase();
          break;
        case 'channel':
          av = channelSortRank(a.contactChannel); bv = channelSortRank(b.contactChannel);
          break;
        case 'nextNudge':
          av = a.nextNudgeDate || '9999-99-99'; bv = b.nextNudgeDate || '9999-99-99';
          break;
        case 'stalled': {
          const ai = stallInfo(a, stageById), bi = stallInfo(b, stageById);
          av = ai ? ai.days : -1; bv = bi ? bi.days : -1;
          break;
        }
        case 'lastTouch': {
          const at = daysSinceLastTouch(a), bt = daysSinceLastTouch(b);
          av = at == null ? -1 : at; bv = bt == null ? -1 : bt;
          break;
        }
        case 'name':
        default:
          av = (a.name || '').toLowerCase(); bv = (b.name || '').toLowerCase();
      }
      if (av < bv) return -1 * mul;
      if (av > bv) return 1 * mul;
      return (a.name || '').localeCompare(b.name || '');
    };
  }

  let listSortKey = 'nextNudge';
  let listSortDir = 'asc';

  function renderBoardList(stages, prospects, allProspects, displayQuery, filtering) {
    if (!prospects.length) {
      boardListEl.innerHTML = '<p class="board-list-empty" role="status">' +
        (filtering
          ? 'No matches' + (displayQuery ? ' for "' + escapeHtml(displayQuery) + '"' : '') + '.'
          : 'No prospects logged yet.') +
        '</p>';
      return;
    }

    const stageById = Object.fromEntries(stages.map(s => [s.id, s]));
    const stageOrderIndex = Object.fromEntries(stages.map((s, i) => [s.id, i]));
    const sorted = prospects.slice().sort(listComparator(listSortKey, listSortDir, stageById, stageOrderIndex));

    const headers = [
      { key: 'name', label: 'Prospect' },
      { key: 'stage', label: 'Stage' },
      { key: 'category', label: 'Category' },
      { key: 'channel', label: 'Channel' },
      { key: 'nextNudge', label: 'Next nudge' },
      { key: 'stalled', label: 'Time in stage' },
      { key: 'lastTouch', label: 'Last touch' }
    ];
    const headHtml = headers.map(h => {
      const active = h.key === listSortKey;
      const ariaSort = active ? (listSortDir === 'asc' ? 'ascending' : 'descending') : 'none';
      const arrow = active ? (listSortDir === 'asc' ? ' ↑' : ' ↓') : '';
      return '<th data-sort-key="' + h.key + '" aria-sort="' + ariaSort + '" tabindex="0" role="button">' +
        escapeHtml(h.label) + arrow + '</th>';
    }).join('');

    const rowsHtml = sorted.map(p => {
      const stage = stageById[p.stage];
      const info = stallInfo(p, stageById);
      const lastTouchDays = daysSinceLastTouch(p);
      return '<tr class="board-list-row' + (info && info.isStale ? ' board-list-row-stale' : '') +
        '" data-prospect-id="' + escapeHtml(p.id) + '" tabindex="0">' +
        '<td><div class="board-list-name">' + escapeHtml(p.name) + '</div><div class="board-list-company">' +
        escapeHtml(p.company || 'Company not logged') + '</div></td>' +
        '<td>' + (stage
          ? '<span class="stage-dot" style="background:' + escapeHtml(stage.color) + '"></span> ' + escapeHtml(stage.label)
          : '<span class="board-list-unlogged">Unknown stage</span>') + '</td>' +
        '<td>' + (p.category ? escapeHtml(p.category) : '<span class="board-list-unlogged">Not logged</span>') + '</td>' +
        '<td>' + channelBadge(p.contactChannel) + '</td>' +
        '<td>' + (p.nextNudgeDate ? escapeHtml(fmtDate(p.nextNudgeDate)) : '<span class="board-list-unlogged">Not queued</span>') + '</td>' +
        '<td>' + (info ? info.days + 'd' + (info.isStale ? ' (stalled)' : '') : '<span class="board-list-unlogged">Unlogged</span>') + '</td>' +
        '<td>' + (lastTouchDays != null ? lastTouchDays + 'd ago' : '<span class="board-list-unlogged">No touches logged</span>') + '</td>' +
        '</tr>';
    }).join('');

    boardListEl.innerHTML = '<table class="board-list-table"><thead><tr>' + headHtml + '</tr></thead><tbody>' +
      rowsHtml + '</tbody></table>';

    boardListEl.querySelectorAll('th[data-sort-key]').forEach(th => {
      const key = th.getAttribute('data-sort-key');
      const activate = () => {
        if (listSortKey === key) {
          listSortDir = listSortDir === 'asc' ? 'desc' : 'asc';
        } else {
          listSortKey = key;
          listSortDir = (key === 'stalled' || key === 'lastTouch') ? 'desc' : 'asc';
        }
        renderBoardList(stages, prospects, allProspects, displayQuery, filtering);
      };
      th.addEventListener('click', activate);
      th.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
      });
    });

    boardListEl.querySelectorAll('tr[data-prospect-id]').forEach(row => {
      const open = () => openModal(row.getAttribute('data-prospect-id'));
      row.addEventListener('click', open);
      row.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
      });
    });
  }

  function renderChannelFilterCounts(prospects, query) {
    channelFilterEl.querySelectorAll('.chip').forEach(chip => {
      const key = chip.getAttribute('data-channel');
      const count = channelFacetCount(prospects, query || '', key);
      chip.textContent = chip.getAttribute('data-label') + ' (' + count + ')';
    });
  }

  // Reads the real "Last-Modified" header express.static already sends for
  // each hand-edited JSON file, so the footer can honestly show when the
  // data was actually last touched without a separate timestamp field that
  // could itself go stale or get forgotten on an edit. Same pattern as the
  // Garage hub's footer.
  function renderDataFreshness(lastModifiedDates) {
    const el = document.getElementById('dataFreshness');
    if (!el) return;
    const known = lastModifiedDates.filter(d => d && !Number.isNaN(d.getTime()));
    if (!known.length) {
      el.textContent = '';
      return;
    }
    const latest = new Date(Math.max(...known.map(d => d.getTime())));
    const daysAgo = Math.floor((Date.now() - latest.getTime()) / 86400000);
    const when = daysAgo <= 0 ? 'today' : daysAgo === 1 ? '1 day ago' : daysAgo + ' days ago';
    el.textContent = ' Last hand-edited ' + when + ' (' + latest.toISOString().slice(0, 10) + ').';
    el.classList.toggle('data-freshness-stale', daysAgo > 14);
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

  // Days since the most recent real outreach touch (initial send or nudge),
  // separate from stallInfo's "days in stage": a prospect can sit in the
  // same stage for a while yet have been touched recently (fresh), or be
  // fresh into a stage yet have gone quiet on actual contact (neglected).
  // Surfacing this on the card itself, not only inside the detail modal's
  // outreach log, makes that distinction visible at a glance on the board.
  function daysSinceLastTouch(p) {
    const log = (p.outreachLog || []).filter(e => e && e.date);
    if (log.length === 0) return null;
    const lastDate = log.reduce((max, e) => (e.date > max ? e.date : max), log[0].date);
    return daysSince(lastDate);
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
    const lastTouchDays = daysSinceLastTouch(p);
    const touchBadge = lastTouchDays != null
      ? '<span class="badge badge-touch">' + lastTouchDays + 'D SINCE LAST TOUCH</span>'
      : '';
    return '<button class="card' + (info && info.isStale ? ' card-stale' : '') + '" draggable="true" data-prospect-id="' + escapeHtml(p.id) + '">' +
      '<div class="card-name">' + escapeHtml(p.name) + '</div>' +
      '<div class="card-company">' + escapeHtml(p.company || 'Company not logged') + '</div>' +
      '<div class="card-meta">' + categoryBadge + channelBadge(p.contactChannel) + stallBadge + touchBadge + '</div>' +
      '</button>';
  }

  let byId = {};
  let allStages = [];
  let allProspects = [];
  let channelFilter = 'all';
  let categoryFilter = 'all';
  let lastFiltered = [];
  let viewMode = 'board';
  let lastFilterArgs = null;
  let openProspectId = null;
  let initialProspectId = null;

  function setViewMode(mode, skipUrlSync) {
    viewMode = mode === 'list' ? 'list' : 'board';
    viewToggleEl.querySelectorAll('.chip').forEach(btn => {
      btn.setAttribute('aria-pressed', String(btn.getAttribute('data-view') === viewMode));
    });
    boardEl.hidden = viewMode !== 'board';
    boardListWrapEl.hidden = viewMode !== 'list';
    if (lastFilterArgs) {
      if (viewMode === 'list') {
        renderBoardList(allStages, lastFilterArgs.filtered, allProspects, lastFilterArgs.rawQuery, lastFilterArgs.filterActive);
      } else {
        renderBoard(allStages, lastFilterArgs.filtered, allProspects, lastFilterArgs.rawQuery, lastFilterArgs.filterActive);
      }
    }
    if (!skipUrlSync) syncUrl();
  }

  viewToggleEl.querySelectorAll('.chip').forEach(btn => {
    btn.addEventListener('click', () => setViewMode(btn.getAttribute('data-view')));
  });

  // Filter/search state is mirrored into the URL so a specific slice of the
  // pipeline (e.g. "named decision-makers in the outreach-sent stage") can be
  // bookmarked or shared as a link, same convention as the CGT hub.
  const VALID_CHANNELS = ['named-decision-maker', 'generic-inbox', 'unlogged'];

  function restoreStateFromUrl() {
    const params = new URLSearchParams(location.search);
    const q = params.get('q');
    const channel = params.get('channel');
    const category = params.get('category');
    const view = params.get('view');
    const prospect = params.get('prospect');
    if (q) searchInput.value = q;
    if (channel && VALID_CHANNELS.includes(channel)) channelFilter = channel;
    if (category) categoryFilter = category;
    if (view === 'list') viewMode = 'list';
    if (prospect) initialProspectId = prospect;
  }

  function syncUrl() {
    const params = new URLSearchParams();
    const query = searchInput.value.trim();
    if (query) params.set('q', query);
    if (channelFilter !== 'all') params.set('channel', channelFilter);
    if (categoryFilter !== 'all') params.set('category', categoryFilter);
    if (viewMode === 'list') params.set('view', 'list');
    if (openProspectId) params.set('prospect', openProspectId);
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

  function matchesSearchTerm(p, query) {
    if (!query) return true;
    return (p.name || '').toLowerCase().includes(query) ||
      (p.company || '').toLowerCase().includes(query) ||
      (p.category || '').toLowerCase().includes(query) ||
      (p.verifiedHook || '').toLowerCase().includes(query) ||
      (p.notes || '').toLowerCase().includes(query) ||
      (p.contactChannel && (p.contactChannel.detail || '').toLowerCase().includes(query));
  }

  // Counts how many prospects would match if this one chip group (channel or
  // category) were set to `key`, holding search and the *other* chip group as
  // they currently are. Same faceted-search convention CGT's facetCount
  // already uses, so switching category doesn't leave the channel counts
  // silently describing a slice of prospects that isn't the one on screen.
  function channelFacetCount(prospects, query, key) {
    return prospects.filter(p =>
      matchesCategory(p, categoryFilter) && matchesSearchTerm(p, query) && matchesChannel(p, key)
    ).length;
  }

  function categoryFacetCount(prospects, query, key) {
    return prospects.filter(p =>
      matchesChannel(p, channelFilter) && matchesSearchTerm(p, query) && matchesCategory(p, key)
    ).length;
  }

  // Builds the category chip row once, from every category logged across the
  // full dataset, so a category doesn't disappear from the row just because
  // the current search/channel filter happens to leave it at zero. Counts
  // themselves are kept live by updateCategoryFilterCounts below, called on
  // every applyFilter, not just here.
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
      return '<button type="button" class="chip" data-category="' + escapeHtml(key) +
        '" aria-pressed="' + (key === categoryFilter) + '">' + escapeHtml(label) + '</button>';
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
    updateCategoryFilterCounts(prospects, '');
  }

  function updateCategoryFilterCounts(prospects, query) {
    categoryFilterEl.querySelectorAll('.chip').forEach(chip => {
      const key = chip.getAttribute('data-category');
      const label = key === 'all' ? 'All' : key;
      const count = categoryFacetCount(prospects, query || '', key);
      chip.textContent = label + ' (' + count + ')';
    });
  }

  // Announces the live match count to screen-reader users, since the visual
  // feedback (cards disappearing from columns) isn't perceivable
  // non-visually, same live region the main Command Center dashboard already
  // uses for its own search/category filter.
  function announceFilterStatus(matchCount, displayQuery, filterActive) {
    const status = document.getElementById('filterStatus');
    status.textContent = filterActive
      ? matchCount + ' prospect' + (matchCount === 1 ? '' : 's') + ' match' + (matchCount === 1 ? 'es' : '') +
        (displayQuery ? ' for "' + displayQuery + '"' : '')
      : '';
  }

  function anyFilterActive() {
    return !!searchInput.value.trim() || channelFilter !== 'all' || categoryFilter !== 'all';
  }

  function applyFilter() {
    const rawQuery = searchInput.value.trim();
    const query = rawQuery.toLowerCase();
    const filtered = allProspects.filter(p =>
      matchesChannel(p, channelFilter) &&
      matchesCategory(p, categoryFilter) &&
      matchesSearchTerm(p, query));
    lastFiltered = filtered;
    const filterActive = anyFilterActive();
    lastFilterArgs = { filtered, rawQuery, filterActive };
    if (viewMode === 'list') {
      renderBoardList(allStages, filtered, allProspects, rawQuery, filterActive);
    } else {
      renderBoard(allStages, filtered, allProspects, rawQuery, filterActive);
    }
    renderChannelFilterCounts(allProspects, query);
    updateCategoryFilterCounts(allProspects, query);
    announceFilterStatus(filtered.length, rawQuery, filterActive);
    document.getElementById('clearFiltersBtn').hidden = !filterActive;
    syncUrl();
  }

  // Shared by CSV and ICS export: builds a Blob, triggers a download, and
  // cleans up the object URL. Neither export contacts anyone or writes back
  // to prospects.json, both only ever produce a local file.
  function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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
    ['outreachLog', 'Outreach Touches'], ['contentIdeas', 'Content Ideas'], ['notes', 'Notes']
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
      outreachLog: (p.outreachLog || [])
        .map(entry => (entry.date ? entry.date + ': ' : '') + (OUTREACH_TYPE_LABEL[entry.type] || entry.type) +
          (entry.note ? ' (' + entry.note + ')' : ''))
        .join('; '),
      contentIdeas: (p.contentIdeas || [])
        .map(entry => (entry.date ? entry.date + ': ' : '') + entry.idea)
        .join('; '),
      notes: p.notes
    }));
    const header = CSV_COLUMNS.map(([, label]) => csvField(label)).join(',');
    const lines = rows.map(r => CSV_COLUMNS.map(([key]) => csvField(r[key])).join(','));
    const csv = [header, ...lines].join('\n');
    downloadFile(csv, 'csm-pipeline-' + todayIso() + '.csv', 'text/csv;charset=utf-8;');
  });

  // RFC 5545 (iCalendar) text escaping: backslash, comma, semicolon, and
  // newline all need a backslash escape inside a property value.
  function icsEscapeText(s) {
    return String(s == null ? '' : s)
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\n/g, '\\n');
  }

  // Folds a single logical property line at 75 octets with a CRLF + single
  // space continuation, per RFC 5545 section 3.1. Long SUMMARY/DESCRIPTION
  // lines are common here (name + company, or a full next-action sentence),
  // and unfolded lines are technically invalid even though most calendar
  // apps tolerate them.
  // RFC 5545 folds at 75 octets, not 75 characters, and a multi-byte UTF-8
  // character must never be split across the fold. This pipeline logs real
  // prospect names/notes for Chinese social platforms, so counting JS string
  // length here (UTF-16 code units) instead of UTF-8 bytes would cut a
  // non-ASCII character in half the moment a name or note pushed a line past
  // 75 of those units, producing a line some calendar apps reject on import.
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

  // One all-day VEVENT per prospect with a real nextNudgeDate, meant to be
  // imported into a real calendar app so the "don't nudge before X, nudge by
  // Y" schedule becomes an actual reminder instead of only living on this
  // page. Exports only real, already-logged dates, never a guessed one, and
  // never anything that contacts the prospect itself.
  function buildNudgeIcs(prospects) {
    const dtstamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const events = prospects.map(p => {
      const descLines = [];
      descLines.push(p.nextAction ? 'Next action: ' + p.nextAction : 'No next action logged yet.');
      const ns = p.nudgeSchedule || {};
      if (ns.doNotNudgeBefore) descLines.push('Do not nudge before ' + fmtDate(ns.doNotNudgeBefore) + '.');
      const touchCount = (p.outreachLog || []).filter(e => e && e.date).length;
      if (touchCount > 0) descLines.push(touchCount + ' outreach touch' + (touchCount === 1 ? '' : 'es') + ' logged so far.');
      descLines.push('CSM pipeline: ' + location.origin + '/csm/');
      const lines = [
        'BEGIN:VEVENT',
        // UID is TEXT-valued too, same as SUMMARY/DESCRIPTION below, so a
        // hand-edited prospect id containing a raw newline, comma, or
        // semicolon can't inject an extra structural line into the export.
        'UID:' + icsEscapeText(p.id) + '-' + p.nextNudgeDate + '@csm.command-center',
        'DTSTAMP:' + dtstamp,
        'DTSTART;VALUE=DATE:' + p.nextNudgeDate.replace(/-/g, ''),
        'SUMMARY:' + icsEscapeText('Nudge: ' + p.name + (p.company ? ' (' + p.company + ')' : '')),
        'DESCRIPTION:' + icsEscapeText(descLines.join('\n')),
        'END:VEVENT'
      ];
      return lines.map(icsFoldLine).join('\r\n');
    });
    return [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Command Center//CSM Pipeline//EN',
      'CALSCALE:GREGORIAN',
      events.join('\r\n'),
      'END:VCALENDAR'
    ].join('\r\n') + '\r\n';
  }

  // Exports every real nudge date currently logged, not just the visible
  // board's filtered slice, since a calendar reminder is still real and
  // still needed even for a prospect the current search/filter hides.
  icsBtn.addEventListener('click', () => {
    // isValidDateStr, not a bare truthy check: a malformed nextNudgeDate
    // (e.g. a non-zero-padded "2026-9-5") would otherwise reach
    // DTSTART;VALUE=DATE: below as garbled digits, an invalid VEVENT no
    // calendar app can import.
    const withDates = allProspects.filter(p => isValidDateStr(p.nextNudgeDate));
    if (withDates.length === 0) return;
    downloadFile(buildNudgeIcs(withDates), 'csm-nudges-' + todayIso() + '.ics', 'text/calendar;charset=utf-8;');
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

  // Builds one <input>/<textarea> plus its <label>, unwrapped (no outer
  // .form-row), for use inside a .form-row-split/.form-row-split3 grid pair,
  // matching the convention already established by the "Log new prospect"
  // form markup in index.html.
  function peInputInner(id, label, value, type) {
    type = type || 'text';
    const v = value == null ? '' : escapeHtml(String(value));
    if (type === 'textarea') {
      return '<div><label for="' + id + '">' + escapeHtml(label) + '</label>' +
        '<textarea id="' + id + '" class="np-input" rows="2">' + v + '</textarea></div>';
    }
    return '<div><label for="' + id + '">' + escapeHtml(label) + '</label>' +
      '<input type="' + type + '" id="' + id + '" class="np-input" value="' + v + '"' +
      (type === 'number' ? ' min="0"' : '') + '></div>';
  }

  function peFieldRow(id, label, value, type) {
    return '<div class="form-row">' + peInputInner(id, label, value, type) + '</div>';
  }

  // Editing an existing prospect's own scalar/object fields (category,
  // verified hook, contact channel, nudge schedule, social snapshot, notes...)
  // previously had no guided path at all: "Log new prospect" only builds a
  // brand-new record, and the stage-move/idea/touch generators below only
  // ever append to a log array, never correct a field that's already there.
  // That left every one of those fields, once logged, editable only by hand-
  // editing raw JSON with none of the warnings the rest of this page gives.
  // This reuses the exact same guided-form -> JSON -> copy/paste convention,
  // pre-filled with the current values, and outputs the prospect's *entire*
  // record (id, stage, stageHistory, outreachLog, contentIdeas carried over
  // untouched) so the result is a straight find-and-replace of one array
  // entry in prospects.json, not a fragment that has to be merged by hand.
  // "stage" itself is deliberately left out of this form: a real stage move
  // needs a dated stageHistory entry, which only the "Log stage move"
  // generator below produces, so changing stage here would silently skip
  // the one audit trail this pipeline actually relies on.
  function prospectEditFormHtml(p) {
    const snap = p.socialSnapshot || {};
    const ns = p.nudgeSchedule || {};
    const cc = p.contactChannel || {};
    return '<details class="schema-help">' +
      '<summary>Edit this prospect&rsquo;s details</summary>' +
      '<div class="schema-help-body">' +
      '<p>Generates this prospect&rsquo;s full updated record with whatever fields below you change. ' +
      '<code>id</code>, <code>stage</code>, <code>stageHistory</code>, <code>outreachLog</code>, and ' +
      '<code>contentIdeas</code> carry over unchanged, use the generators further down to touch those. To move ' +
      'this prospect to a different stage for real, use &ldquo;Log stage move&rdquo; below instead, not this ' +
      'form, that is the only place a stage change gets a dated record.</p>' +
      '<div class="np-form">' +
      peFieldRow('peName', 'Name', p.name) +
      peFieldRow('peCompany', 'Company', p.company) +
      peFieldRow('peCategory', 'Category', p.category) +
      peFieldRow('peStageEnteredDate', 'Stage entered date (corrects the date only, does not move stage)', p.stageEnteredDate, 'date') +
      peFieldRow('peVerifiedHook', 'Verified hook', p.verifiedHook, 'textarea') +
      '<div class="form-row form-row-split">' +
      '<div><label for="peChannelType">Contact channel type</label>' +
      '<select id="peChannelType" class="np-input">' +
      '<option value=""' + (!cc.type ? ' selected' : '') + '>Not logged yet</option>' +
      '<option value="named-decision-maker"' + (cc.type === 'named-decision-maker' ? ' selected' : '') + '>Named decision-maker</option>' +
      '<option value="generic-inbox"' + (cc.type === 'generic-inbox' ? ' selected' : '') + '>Generic inbox</option>' +
      '</select></div>' +
      peInputInner('peChannelDetail', 'Contact channel detail', cc.detail) +
      '</div>' +
      '<div class="form-row form-row-split">' +
      peInputInner('peSendDate', 'Send date', p.sendDate, 'date') +
      peInputInner('peNextNudgeDate', 'Next nudge date', p.nextNudgeDate, 'date') +
      '</div>' +
      peFieldRow('peNextAction', 'Next action', p.nextAction) +
      '<div class="form-row form-row-split">' +
      peInputInner('peDoNotNudgeBefore', 'Do not nudge before', ns.doNotNudgeBefore, 'date') +
      peInputInner('peNudgePoint', 'Nudge point', ns.nudgePoint, 'date') +
      '</div>' +
      peFieldRow('peReplyStatus', 'Reply status', p.replyStatus, 'textarea') +
      '<div class="form-row form-row-split3">' +
      peInputInner('peSocialPlatform', 'Social platform', snap.platform) +
      peInputInner('peSocialFollowers', 'Followers', snap.followers, 'number') +
      peInputInner('peSocialEngagementRate', 'Engagement %', snap.engagementRate, 'number') +
      '</div>' +
      peFieldRow('peSocialAsOfDate', 'Social snapshot as-of date (when the numbers above were actually pulled)', snap.asOfDate, 'date') +
      peFieldRow('peNotes', 'Notes', p.notes, 'textarea') +
      '</div>' +
      '<button type="button" id="peGenerateBtn" class="print-btn font-mono np-generate-btn">Generate updated JSON</button>' +
      '<div id="peResult" class="np-result" hidden>' +
      '<ul id="peWarnings" class="np-warnings"></ul>' +
      '<div class="np-output-head">' +
      '<span class="field-label" style="margin:0">Replace this prospect&rsquo;s whole entry with</span>' +
      '<button type="button" id="peCopyBtn" class="print-btn font-mono" aria-live="polite">Copy JSON</button>' +
      '</div>' +
      '<pre class="np-output font-mono" id="peOutput"></pre>' +
      '</div>' +
      '</div></details>';
  }

  function peVal(id) {
    const v = document.getElementById(id).value.trim();
    return v === '' ? null : v;
  }

  // Same class of warnings npBuildWarnings raises for a brand-new prospect,
  // re-run here against the edited values so correcting an existing record
  // gets the same backfill/consistency checks a new one does.
  function peBuildWarnings(p, edited) {
    const warnings = [];
    if (p.stage !== 'researched' && !(edited.contactChannel && edited.contactChannel.type)) {
      warnings.push('Stage is "' + p.stage + '" but contact channel type is not logged. This is the single ' +
        'biggest driver of real reply rate, fill it in as soon as it is known.');
    }
    if (p.stage !== 'researched' && !edited.verifiedHook) {
      warnings.push('Stage is "' + p.stage + '" but verified hook is not logged. Backfill why this person/brand ' +
        'is a real fit once known.');
    }
    const ns = edited.nudgeSchedule || {};
    if (ns.doNotNudgeBefore && ns.nudgePoint && ns.doNotNudgeBefore > ns.nudgePoint) {
      warnings.push('"Do not nudge before" is after "nudge point", swap them.');
    }
    if (ns.doNotNudgeBefore && edited.nextNudgeDate && edited.nextNudgeDate < ns.doNotNudgeBefore) {
      warnings.push('"Next nudge date" is before "do not nudge before", the nudge queue would surface this ' +
        'prospect too early.');
    }
    if (edited.nextNudgeDate && !edited.nextAction) {
      warnings.push('Next nudge date is set but next action is not. A due date with no concrete next step is a ' +
        'common way real deals quietly stall.');
    }
    const snap = edited.socialSnapshot || {};
    if ((snap.followers != null || snap.engagementRate != null) && !snap.asOfDate) {
      warnings.push('Social numbers are logged without an as-of date. Every social number on this board must be ' +
        'labeled with when it was actually pulled, never shown as if live.');
    }
    if (edited.category) {
      const norm = edited.category.trim().toLowerCase();
      const existing = allProspects.filter(x => x.id !== p.id).map(x => x.category).filter(Boolean);
      const clash = existing.find(c => c.trim().toLowerCase() === norm && c !== edited.category);
      if (clash) {
        warnings.push('Category "' + edited.category + '" differs in casing/spacing from existing category "' +
          clash + '", they would render as separate filter chips. Pick one spelling.');
      }
    }
    return warnings;
  }

  function wireProspectEditForm(p) {
    const generateBtn = document.getElementById('peGenerateBtn');
    const resultEl = document.getElementById('peResult');
    const warningsEl = document.getElementById('peWarnings');
    const outputEl = document.getElementById('peOutput');
    generateBtn.addEventListener('click', () => {
      const edited = Object.assign({}, p, {
        name: peVal('peName') || p.name,
        company: peVal('peCompany'),
        category: peVal('peCategory'),
        stageEnteredDate: peVal('peStageEnteredDate'),
        verifiedHook: peVal('peVerifiedHook'),
        contactChannel: { type: peVal('peChannelType'), detail: peVal('peChannelDetail') },
        sendDate: peVal('peSendDate'),
        nextNudgeDate: peVal('peNextNudgeDate'),
        nextAction: peVal('peNextAction'),
        nudgeSchedule: { doNotNudgeBefore: peVal('peDoNotNudgeBefore'), nudgePoint: peVal('peNudgePoint') },
        replyStatus: peVal('peReplyStatus'),
        socialSnapshot: {
          platform: peVal('peSocialPlatform'),
          followers: peVal('peSocialFollowers') != null ? Number(peVal('peSocialFollowers')) : null,
          engagementRate: peVal('peSocialEngagementRate') != null ? Number(peVal('peSocialEngagementRate')) : null,
          asOfDate: peVal('peSocialAsOfDate')
        },
        notes: peVal('peNotes')
      });
      const warnings = peBuildWarnings(p, edited);
      warningsEl.innerHTML = warnings.map(w => '<li>' + escapeHtml(w) + '</li>').join('');
      outputEl.textContent = JSON.stringify(edited, null, 2) + ',';
      resultEl.hidden = false;
      resultEl.scrollIntoView({ block: 'nearest' });
    });
    wireCopyButton(document.getElementById('peCopyBtn'), outputEl);
  }

  function openModal(id) {
    const p = byId[id];
    if (!p) return;
    lastFocusedEl = document.activeElement;
    modalName.textContent = p.name;
    modalCompany.textContent = p.company || 'Company not logged';

    const rows = [];
    rows.push(prospectEditFormHtml(p));
    rows.push(fieldRow('Category', p.category ? escapeHtml(p.category) : 'Not logged yet', !p.category));
    rows.push(fieldRow('Verified hook', p.verifiedHook ? escapeHtml(p.verifiedHook) : 'Not logged yet', !p.verifiedHook));
    rows.push(fieldRow('Contact channel', channelBadge(p.contactChannel) +
      (p.contactChannel && p.contactChannel.detail ? '<div style="margin-top:6px">' + escapeHtml(p.contactChannel.detail) + '</div>' : ''), false));
    rows.push(fieldRow('Reply status', p.replyStatus ? escapeHtml(p.replyStatus) : 'Not logged yet', !p.replyStatus));
    rows.push(fieldRow('Send date', p.sendDate ? fmtDate(p.sendDate) : 'Not logged yet', !p.sendDate));
    const outreachLogHtml = renderOutreachLog(p);
    rows.push(fieldRow('Outreach touch log', outreachLogHtml.html + outreachLogGeneratorHtml(), outreachLogHtml.empty));
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
    const snapStale = socialSnapshotStaleInfo(p);
    let snapHtml;
    if (snap.platform || snap.followers != null) {
      snapHtml = escapeHtml(snap.platform || 'Platform not logged') +
        (snap.followers != null ? ', ' + Number(snap.followers).toLocaleString() + ' followers' : '') +
        (snap.engagementRate != null ? ', ' + snap.engagementRate + '% engagement' : '') +
        '<span class="snapshot-tag' + (snapStale ? ' snapshot-tag-stale' : '') + '">' +
        (snap.asOfDate ? 'AS OF ' + fmtDate(snap.asOfDate).toUpperCase() + ', ONE-TIME MANUAL SNAPSHOT, NOT LIVE' : 'NO SNAPSHOT DATE LOGGED') +
        (snapStale ? ' &middot; ' + snapStale.days + 'D OLD, DUE FOR REFRESH' : '') +
        '</span>';
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
    wireProspectEditForm(p);
    wireStageMoveGenerator(p);
    wireIdeaGenerator(p);
    wireOutreachLogGenerator(p);
    lockBodyScroll();
    modalClose.focus();
    openProspectId = p.id;
    syncUrl();
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

  // The two fields this project has found most predictive of a real reply
  // (see the contact-channel callout in index.html). Warn right where
  // outreach is actually about to be logged as sent, not only after the
  // fact in the passive "Needs backfill" list further down the page.
  function outreachReadinessWarnings(p) {
    const warnings = [];
    if (!p.verifiedHook) {
      warnings.push('No verifiedHook logged yet for this prospect, the real reason this person/brand fits.');
    }
    if (!p.contactChannel || !p.contactChannel.type) {
      warnings.push('contactChannel.type is not logged yet (named decision-maker vs. generic inbox), the single field most predictive of a real reply.');
    }
    return warnings;
  }

  function stageMoveGeneratorHtml() {
    return '<div class="inline-gen">' +
      '<div class="inline-gen-row">' +
      '<label class="sr-only" for="modalMoveStage">Target stage</label>' +
      '<select id="modalMoveStage" class="np-input inline-gen-select"></select>' +
      '<label class="sr-only" for="modalMoveDate">Date of stage move</label>' +
      '<input type="date" id="modalMoveDate" class="np-input inline-gen-date">' +
      '<button type="button" id="modalMoveGenerate" class="print-btn font-mono">+ Log stage move</button>' +
      '</div>' +
      '<div id="modalMoveResult" class="inline-gen-result" hidden>' +
      '<div class="inline-gen-warn" id="modalMoveWarn" hidden></div>' +
      '<div class="np-output-head">' +
      '<span class="field-label" style="margin:0">Paste into <code>stageHistory</code></span>' +
      '<button type="button" id="modalMoveCopy" class="print-btn font-mono" aria-live="polite">Copy</button>' +
      '</div>' +
      '<pre class="np-output font-mono" id="modalMoveOutput"></pre>' +
      '</div></div>';
  }

  function ideaGeneratorHtml() {
    return '<div class="inline-gen">' +
      '<div class="inline-gen-row inline-gen-row-idea">' +
      '<label class="sr-only" for="modalIdeaDate">Date idea logged</label>' +
      '<input type="date" id="modalIdeaDate" class="np-input inline-gen-date">' +
      '<label class="sr-only" for="modalIdeaText">Content idea</label>' +
      '<input type="text" id="modalIdeaText" class="np-input" placeholder="Content idea, logged today">' +
      '<button type="button" id="modalIdeaGenerate" class="print-btn font-mono">+ Log idea</button>' +
      '</div>' +
      '<div id="modalIdeaResult" class="inline-gen-result" hidden>' +
      '<div class="inline-gen-warn" id="modalIdeaWarn" hidden></div>' +
      '<div class="np-output-head">' +
      '<span class="field-label" style="margin:0">Paste into <code>contentIdeas</code></span>' +
      '<button type="button" id="modalIdeaCopy" class="print-btn font-mono" aria-live="polite">Copy</button>' +
      '</div>' +
      '<pre class="np-output font-mono" id="modalIdeaOutput"></pre>' +
      '</div></div>';
  }

  function outreachLogGeneratorHtml() {
    return '<div class="inline-gen">' +
      '<div class="inline-gen-row">' +
      '<label class="sr-only" for="modalTouchType">Touch type</label>' +
      '<select id="modalTouchType" class="np-input inline-gen-select">' +
      '<option value="initial-send">Initial send</option>' +
      '<option value="nudge">Nudge</option>' +
      '</select>' +
      '<label class="sr-only" for="modalTouchDate">Date of touch</label>' +
      '<input type="date" id="modalTouchDate" class="np-input inline-gen-date">' +
      '<button type="button" id="modalTouchGenerate" class="print-btn font-mono">+ Log touch</button>' +
      '</div>' +
      '<div class="inline-gen-row inline-gen-row-idea">' +
      '<label class="sr-only" for="modalTouchNote">Note, optional</label>' +
      '<input type="text" id="modalTouchNote" class="np-input" placeholder="Note, optional (e.g. which channel, what was said)">' +
      '</div>' +
      '<div id="modalTouchResult" class="inline-gen-result" hidden>' +
      '<div class="inline-gen-warn" id="modalTouchWarn" hidden></div>' +
      '<div class="np-output-head">' +
      '<span class="field-label" style="margin:0">Paste into <code>outreachLog</code></span>' +
      '<button type="button" id="modalTouchCopy" class="print-btn font-mono" aria-live="polite">Copy</button>' +
      '</div>' +
      '<pre class="np-output font-mono" id="modalTouchOutput"></pre>' +
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
      const warnParts = [];
      if (last && last.date && date < last.date) {
        warnParts.push('This date is before the last logged move (' + last.date + '). stageHistory must stay sorted oldest first.');
      } else if (stage !== p.stage) {
        warnParts.push('This prospect’s own "stage" field is still "' + p.stage + '". If this move already really ' +
          'happened, also update this prospect’s "stage" and "stageEnteredDate" fields, not just stageHistory.');
      }
      if (stage === 'outreach-sent') {
        warnParts.push(...outreachReadinessWarnings(p));
      }
      const warn = warnParts.join(' ');
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

  function wireOutreachLogGenerator(p) {
    const typeSelect = document.getElementById('modalTouchType');
    const dateInput = document.getElementById('modalTouchDate');
    dateInput.value = todayIso();
    const noteInput = document.getElementById('modalTouchNote');
    const resultEl = document.getElementById('modalTouchResult');
    const warnEl = document.getElementById('modalTouchWarn');
    const outputEl = document.getElementById('modalTouchOutput');
    document.getElementById('modalTouchGenerate').addEventListener('click', () => {
      const type = typeSelect.value;
      const date = dateInput.value;
      const note = noteInput.value.trim();
      if (!date) {
        warnEl.hidden = false;
        warnEl.textContent = 'Pick the real date this touch actually happened first.';
        outputEl.textContent = '';
        resultEl.hidden = false;
        return;
      }
      const log = p.outreachLog || [];
      const alreadySent = log.some(e => e.type === 'initial-send');
      const warnParts = [];
      if (type === 'initial-send' && alreadySent) {
        warnParts.push('An "initial-send" touch is already logged for this prospect. If this is a follow-up, use "Nudge" instead.');
      }
      if (type === 'initial-send' && !alreadySent) {
        warnParts.push(...outreachReadinessWarnings(p));
      }
      const warn = warnParts.join(' ');
      warnEl.hidden = !warn;
      warnEl.textContent = warn;
      const entry = { date, type };
      if (note) entry.note = note;
      outputEl.textContent = JSON.stringify(entry, null, 2) + ',';
      resultEl.hidden = false;
    });
    wireCopyButton(document.getElementById('modalTouchCopy'), outputEl);
  }

  function closeModal() {
    modalOverlay.hidden = true;
    unlockBodyScroll();
    if (lastFocusedEl && typeof lastFocusedEl.focus === 'function') {
      lastFocusedEl.focus();
    }
    lastFocusedEl = null;
    openProspectId = null;
    syncUrl();
  }

  function getFocusable() {
    // offsetParent is null for anything inside a hidden ancestor, e.g. the
    // stage-move/idea/outreach generators' result blocks (hidden until a
    // Copy button appears in them), same check CGT and the main dashboard
    // already use so Tab-wraparound can't land focus on an invisible button.
    return Array.from(document.getElementById('modal').querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )).filter(el => !el.hasAttribute('disabled') && el.offsetParent !== null);
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
  setViewMode(viewMode, true);

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

  // Deep link straight to one prospect's detail modal (?prospect=<id>, kept
  // in sync with openProspectId by openModal/closeModal), so a specific
  // prospect can be bookmarked or shared instead of only the whole board.
  const MODAL_COPY_LINK_LABEL = modalCopyLinkBtn.textContent;
  modalCopyLinkBtn.addEventListener('click', () => {
    copyText(location.href)
      .then(() => { modalCopyLinkBtn.textContent = 'Link copied'; })
      .catch(() => { modalCopyLinkBtn.textContent = "Couldn't copy, link is in the address bar"; })
      .finally(() => {
        setTimeout(() => { modalCopyLinkBtn.textContent = MODAL_COPY_LINK_LABEL; }, 1800);
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
  const npModeToggle = document.getElementById('npModeToggle');
  const npFullFormWrap = document.getElementById('npFullFormWrap');
  const npQuickAddWrap = document.getElementById('npQuickAddWrap');
  const NP_FIELD_IDS = [
    'npName', 'npCompany', 'npCategory', 'npStageEnteredDate', 'npVerifiedHook',
    'npChannelType', 'npChannelDetail', 'npSendDate', 'npNextNudgeDate', 'npNextAction',
    'npDoNotNudgeBefore', 'npNudgePoint', 'npReplyStatus', 'npSocialPlatform',
    'npSocialFollowers', 'npSocialEngagementRate', 'npSocialAsOfDate', 'npNotes'
  ];
  let npLastFocusedEl = null;

  // The new-prospect form has 18 real fields (verified hook, reply status,
  // notes...) and no backend to save to, so an accidental Escape, overlay
  // click, or tab reload otherwise throws all of it away with no way back.
  // Autosaving to localStorage (this browser only, never sent anywhere) is
  // real client-side reliability, not a live backend and not a guessed value,
  // so it does not conflict with this page's no-fake-data rule.
  const NP_DRAFT_KEY = 'csm-np-draft-v1';
  const npDraftBanner = document.getElementById('npDraftBanner');
  const npDraftBannerTime = document.getElementById('npDraftBannerTime');
  const npDiscardDraftBtn = document.getElementById('npDiscardDraftBtn');
  let npDraftSaveTimer = null;

  function npReadFormValues() {
    const values = { npStage: npStageSelect.value };
    NP_FIELD_IDS.forEach(id => { values[id] = document.getElementById(id).value; });
    return values;
  }

  function npWriteFormValues(values) {
    if (values.npStage) npStageSelect.value = values.npStage;
    NP_FIELD_IDS.forEach(id => {
      if (id in values) document.getElementById(id).value = values[id];
    });
  }

  function npHasAnyValue(values) {
    return NP_FIELD_IDS.some(id => (values[id] || '').trim() !== '');
  }

  function npSaveDraft() {
    try {
      const values = npReadFormValues();
      if (!npHasAnyValue(values)) { npClearDraft(); return; }
      localStorage.setItem(NP_DRAFT_KEY, JSON.stringify({ savedAt: Date.now(), values }));
    } catch (e) { /* localStorage unavailable (private window, blocked storage): draft protection just no-ops */ }
  }

  function npLoadDraft() {
    try {
      const raw = localStorage.getItem(NP_DRAFT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function npClearDraft() {
    try { localStorage.removeItem(NP_DRAFT_KEY); } catch (e) { /* see npSaveDraft */ }
    npDraftBanner.hidden = true;
  }

  document.querySelector('.np-form').addEventListener('input', () => {
    clearTimeout(npDraftSaveTimer);
    npDraftSaveTimer = setTimeout(npSaveDraft, 400);
  });

  npDiscardDraftBtn.addEventListener('click', () => {
    npClearDraft();
    npResetForm();
    document.getElementById('npName').focus();
  });

  // Full-form vs. quick-add are two entry points into the same "generate
  // paste-ready JSON, save nothing" flow, not two separate features: the
  // full form covers every field for one prospect at a time, quick add
  // trades that depth for speed across several rows at once (see
  // npQuickAddWrap below). Switching modes never clears the other mode's
  // draft, both keep autosaving independently.
  function setNpMode(mode) {
    const isQuick = mode === 'quick';
    npFullFormWrap.hidden = isQuick;
    npQuickAddWrap.hidden = !isQuick;
    npModeToggle.querySelectorAll('.chip').forEach(btn => {
      btn.setAttribute('aria-pressed', String(btn.getAttribute('data-np-mode') === mode));
    });
  }
  npModeToggle.querySelectorAll('.chip').forEach(btn => {
    btn.addEventListener('click', () => setNpMode(btn.getAttribute('data-np-mode')));
  });

  // Quick add: several freshly-researched candidates in one pass (name,
  // company, category, verified hook only), all logged at the "researched"
  // stage. This is the real bottleneck the full 18-field form creates for a
  // plain research pass, a known CRM pattern (a stripped-down "quick add"
  // entry point alongside the full record form, e.g. LeadSquared's Quick Add
  // Lead) rather than something invented for this board. Every other field
  // stays null/[] until that prospect's own full-form edit fills it in for
  // real, same "leave it null, never guess" rule as everywhere else here.
  const npQuickRowsEl = document.getElementById('npQuickRows');
  const npQuickAddRowBtn = document.getElementById('npQuickAddRowBtn');
  const npQuickDateInput = document.getElementById('npQuickDate');
  const npQuickGenerateBtn = document.getElementById('npQuickGenerateBtn');
  const npQuickResult = document.getElementById('npQuickResult');
  const npQuickWarningsEl = document.getElementById('npQuickWarnings');
  const npQuickOutputEl = document.getElementById('npQuickOutput');
  const npQuickCopyBtn = document.getElementById('npQuickCopyBtn');
  const npQuickDraftBanner = document.getElementById('npQuickDraftBanner');
  const npQuickDraftBannerTime = document.getElementById('npQuickDraftBannerTime');
  const npQuickDiscardDraftBtn = document.getElementById('npQuickDiscardDraftBtn');
  const NP_QUICK_ROW_FIELDS = ['name', 'company', 'category', 'verifiedHook'];
  const NP_QUICK_DRAFT_KEY = 'csm-np-quick-draft-v1';
  let npQuickRowSeq = 0;
  let npQuickDraftSaveTimer = null;

  function npQuickRowHtml(rowId, values) {
    values = values || {};
    // escapeHtml alone leaves a literal " in place (safe in text content, not
    // inside an attribute), so a restored draft value containing a quote
    // (e.g. a nicknamed name) could otherwise break out of value="..." here.
    const v = f => escapeHtml(values[f] || '').replace(/"/g, '&quot;');
    return '<div class="np-quick-row" data-quick-row data-row-id="' + rowId + '">' +
      '<label class="sr-only" for="' + rowId + '-name">Name</label>' +
      '<input type="text" id="' + rowId + '-name" class="np-input" data-field="name" placeholder="Name *" value="' + v('name') + '">' +
      '<label class="sr-only" for="' + rowId + '-company">Company</label>' +
      '<input type="text" id="' + rowId + '-company" class="np-input" data-field="company" placeholder="Company" value="' + v('company') + '">' +
      '<label class="sr-only" for="' + rowId + '-category">Category</label>' +
      '<input type="text" id="' + rowId + '-category" class="np-input" data-field="category" placeholder="Category" list="npCategoryList" value="' + v('category') + '">' +
      '<label class="sr-only" for="' + rowId + '-hook">Verified hook</label>' +
      '<input type="text" id="' + rowId + '-hook" class="np-input" data-field="verifiedHook" placeholder="Verified hook (why they fit)" value="' + v('verifiedHook') + '">' +
      '<button type="button" class="np-quick-row-remove" aria-label="Remove this row">&times;</button>' +
      '</div>';
  }

  function npQuickAddRow(values) {
    npQuickRowSeq += 1;
    const rowId = 'npq' + npQuickRowSeq;
    npQuickRowsEl.insertAdjacentHTML('beforeend', npQuickRowHtml(rowId, values));
    const rowEl = npQuickRowsEl.querySelector('[data-row-id="' + rowId + '"]');
    rowEl.querySelector('.np-quick-row-remove').addEventListener('click', () => {
      // Removing the only row would leave no way to add a first candidate
      // without hunting for the "+ Add another row" button again, so the
      // last row clears in place instead of disappearing.
      if (npQuickRowsEl.children.length > 1) {
        rowEl.remove();
      } else {
        rowEl.querySelectorAll('input').forEach(inp => { inp.value = ''; });
      }
      npQuickSaveDraft();
    });
    return rowEl;
  }

  npQuickAddRowBtn.addEventListener('click', () => {
    npQuickAddRow();
    npQuickRowsEl.lastElementChild.querySelector('input[data-field="name"]').focus();
  });

  function npQuickResetRows(rowsValues) {
    npQuickRowsEl.innerHTML = '';
    npQuickRowSeq = 0;
    const seed = rowsValues && rowsValues.length ? rowsValues : [{}];
    seed.forEach(values => npQuickAddRow(values));
  }

  function npQuickReadRows() {
    return Array.from(npQuickRowsEl.querySelectorAll('[data-quick-row]')).map(rowEl => {
      const values = {};
      NP_QUICK_ROW_FIELDS.forEach(f => {
        values[f] = rowEl.querySelector('[data-field="' + f + '"]').value.trim();
      });
      return values;
    });
  }

  function npQuickHasAnyValue(rowsValues) {
    return rowsValues.some(values => NP_QUICK_ROW_FIELDS.some(f => values[f]));
  }

  function npQuickSaveDraft() {
    try {
      const rowsValues = npQuickReadRows();
      const date = npQuickDateInput.value;
      if (!npQuickHasAnyValue(rowsValues) && !date) { npQuickClearDraft(); return; }
      localStorage.setItem(NP_QUICK_DRAFT_KEY, JSON.stringify({ savedAt: Date.now(), date, rowsValues }));
    } catch (e) { /* localStorage unavailable: same no-op as npSaveDraft above */ }
  }

  function npQuickLoadDraft() {
    try {
      const raw = localStorage.getItem(NP_QUICK_DRAFT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function npQuickClearDraft() {
    try { localStorage.removeItem(NP_QUICK_DRAFT_KEY); } catch (e) { /* see npQuickSaveDraft */ }
    npQuickDraftBanner.hidden = true;
  }

  npQuickRowsEl.addEventListener('input', () => {
    clearTimeout(npQuickDraftSaveTimer);
    npQuickDraftSaveTimer = setTimeout(npQuickSaveDraft, 400);
  });
  npQuickDateInput.addEventListener('input', npQuickSaveDraft);

  npQuickDiscardDraftBtn.addEventListener('click', () => {
    npQuickClearDraft();
    npQuickResetRows();
    npQuickDateInput.value = todayIso();
    npQuickResult.hidden = true;
    npQuickRowsEl.querySelector('input[data-field="name"]').focus();
  });

  // Same duplicate-id and duplicate-name-and-company checks npBuildWarnings
  // runs for the full form, plus one quick add doesn't need to worry about
  // otherwise: two rows in the same batch describing the same person (a
  // copy/paste slip while moving fast through a list), checked against each
  // other, not just against prospects already on the board.
  function npQuickBuildProspects(rowsValues, researchedDate) {
    const results = [];
    const seenIdsThisBatch = new Set(Object.keys(byId));
    const seenKeysThisBatch = new Map();
    rowsValues.forEach(values => {
      const name = values.name;
      if (!name) return;
      const company = values.company || null;
      const category = values.category || null;
      const verifiedHook = values.verifiedHook || null;
      const baseId = npSlugify(name, company);
      let id = baseId;
      let n = 2;
      while (seenIdsThisBatch.has(id)) { id = baseId + '-' + n; n++; }
      const isDuplicateId = id !== baseId;
      seenIdsThisBatch.add(id);

      const warnings = [];
      if (isDuplicateId) {
        warnings.push('An id starting with "' + baseId + '" already exists, this one was suffixed to "' + id +
          '" to avoid a duplicate. Rename it to something more readable if you want.');
      }
      const nameKey = name.trim().toLowerCase() + '|' + (company || '').trim().toLowerCase();
      const existingMatch = allProspects.find(x => x.name &&
        x.name.trim().toLowerCase() + '|' + (x.company || '').trim().toLowerCase() === nameKey);
      if (existingMatch) {
        warnings.push('An existing entry already has this same name and company ("' + existingMatch.name +
          (existingMatch.company ? ', ' + existingMatch.company : '') + '", id "' + existingMatch.id +
          '"). If this is really the same person, edit that entry instead of adding a second one.');
      } else if (seenKeysThisBatch.has(nameKey)) {
        warnings.push('Another row in this same batch already has this name and company ("' + name +
          (company ? ', ' + company : '') + '"). If this is really the same person, remove the duplicate row.');
      }
      seenKeysThisBatch.set(nameKey, id);
      if (category) {
        const norm = category.trim().toLowerCase();
        const existingCats = allProspects.map(x => x.category).filter(Boolean);
        const clash = existingCats.find(c => c.trim().toLowerCase() === norm && c !== category);
        if (clash) {
          warnings.push('Category "' + category + '" differs in casing/spacing from existing category "' + clash +
            '", they would render as separate filter chips. Pick one spelling.');
        }
      }

      const p = {
        id,
        name,
        company,
        category,
        stage: 'researched',
        stageEnteredDate: researchedDate || null,
        verifiedHook,
        contactChannel: { type: null, detail: null },
        sendDate: null,
        nextNudgeDate: null,
        nextAction: null,
        nudgeSchedule: { doNotNudgeBefore: null, nudgePoint: null },
        replyStatus: null,
        socialSnapshot: { platform: null, followers: null, engagementRate: null, asOfDate: null },
        contentIdeas: [],
        stageHistory: researchedDate ? [{ date: researchedDate, stage: 'researched' }] : [],
        outreachLog: [],
        notes: null
      };
      results.push({ p, warnings });
    });
    return results;
  }

  npQuickGenerateBtn.addEventListener('click', () => {
    const rowsValues = npQuickReadRows();
    const researchedDate = npQuickDateInput.value || null;
    const built = npQuickBuildProspects(rowsValues, researchedDate);
    if (built.length === 0) {
      npQuickWarningsEl.innerHTML = '<li>Enter a name in at least one row first.</li>';
      npQuickOutputEl.textContent = '';
      npQuickResult.hidden = false;
      return;
    }
    const allWarnings = built.flatMap(({ p, warnings }) => warnings.map(w => p.name + ': ' + w));
    npQuickWarningsEl.innerHTML = allWarnings.map(w => '<li>' + escapeHtml(w) + '</li>').join('');
    npQuickOutputEl.textContent = built.map(({ p }) => JSON.stringify(p, null, 2) + ',').join('\n');
    npQuickResult.hidden = false;
    npQuickResult.scrollIntoView({ block: 'nearest' });
  });

  npQuickCopyBtn.addEventListener('click', () => {
    const original = npQuickCopyBtn.textContent;
    copyText(npQuickOutputEl.textContent)
      .then(() => { npQuickCopyBtn.textContent = 'Copied'; npQuickClearDraft(); })
      .catch(() => { npQuickCopyBtn.textContent = "Couldn't copy"; })
      .finally(() => { setTimeout(() => { npQuickCopyBtn.textContent = original; }, 1800); });
  });

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
    if (p.name) {
      const nameKey = p.name.trim().toLowerCase() + '|' + (p.company || '').trim().toLowerCase();
      const match = allProspects.find(x => x.name &&
        x.name.trim().toLowerCase() + '|' + (x.company || '').trim().toLowerCase() === nameKey);
      if (match) {
        warnings.push('An existing entry already has this same name and company ("' + match.name +
          (match.company ? ', ' + match.company : '') + '", id "' + match.id + '"). If this is really the same ' +
          'person, edit that entry instead of adding a second one.');
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
      outreachLog: npVal('npSendDate') ? [{ date: npVal('npSendDate'), type: 'initial-send' }] : [],
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
    setNpMode('full');
    const draft = npLoadDraft();
    if (draft && npHasAnyValue(draft.values || {})) {
      npWriteFormValues(draft.values);
      npDraftBannerTime.textContent = new Date(draft.savedAt).toLocaleString();
      npDraftBanner.hidden = false;
    } else {
      npDraftBanner.hidden = true;
    }

    const quickDraft = npQuickLoadDraft();
    if (quickDraft && (npQuickHasAnyValue(quickDraft.rowsValues || []) || quickDraft.date)) {
      npQuickResetRows(quickDraft.rowsValues);
      npQuickDateInput.value = quickDraft.date || todayIso();
      npQuickDraftBannerTime.textContent = new Date(quickDraft.savedAt).toLocaleString();
      npQuickDraftBanner.hidden = false;
    } else {
      npQuickResetRows();
      npQuickDateInput.value = todayIso();
      npQuickDraftBanner.hidden = true;
    }
    npQuickResult.hidden = true;
    npQuickOutputEl.textContent = '';
    npQuickWarningsEl.innerHTML = '';

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
      // Same offsetParent check as getFocusable() above: npResult starts
      // hidden until the new-prospect JSON is generated.
      const focusable = Array.from(npModalEl().querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )).filter(el => !el.hasAttribute('disabled') && el.offsetParent !== null);
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
      .then(() => { npCopyBtn.textContent = 'Copied'; npClearDraft(); })
      .catch(() => { npCopyBtn.textContent = "Couldn't copy"; })
      .finally(() => { setTimeout(() => { npCopyBtn.textContent = original; }, 1800); });
  });

  // stages.json and prospects.json are both hand-edited (prospects.json most
  // of all, every time a new one is logged via the guided JSON generator
  // above), so a single Promise.all would fail the entire board over one typo
  // in either file. Promise.allSettled degrades to the real half of the data
  // instead, the same fix already applied to Sondrik's and Garage's loaders
  // for the same reason.
  Promise.allSettled([
    fetch('/csm/data/stages.json').then(r => {
      if (!r.ok) throw new Error('stages.json returned ' + r.status);
      const lastModifiedHeader = r.headers.get('last-modified');
      return r.json().then(data => ({ data, lastModified: lastModifiedHeader ? new Date(lastModifiedHeader) : null }));
    }),
    fetch('/csm/data/prospects.json').then(r => {
      if (!r.ok) throw new Error('prospects.json returned ' + r.status);
      const lastModifiedHeader = r.headers.get('last-modified');
      return r.json().then(data => ({ data, lastModified: lastModifiedHeader ? new Date(lastModifiedHeader) : null }));
    })
  ]).then(([stagesResult, prospectsResult]) => {
    const stagesData = stagesResult.status === 'fulfilled' ? stagesResult.value.data : null;
    const prospectsData = prospectsResult.status === 'fulfilled' ? prospectsResult.value.data : null;
    allStages = (stagesData && stagesData.stages) || [];
    allProspects = (prospectsData && prospectsData.prospects) || [];
    byId = Object.fromEntries(allProspects.map(p => [p.id, p]));

    renderDataFreshness([stagesResult, prospectsResult]
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value.lastModified));

    const failures = [];
    if (stagesResult.status === 'rejected') failures.push('stages.json: ' + stagesResult.reason.message);
    if (prospectsResult.status === 'rejected') failures.push('prospects.json: ' + prospectsResult.reason.message);

    if (stagesData || prospectsData) {
      renderAttentionBar(allStages, allProspects);
      renderNudgeQueue(allProspects);
      renderStats(allStages, allProspects);
      renderChannelFilterCounts(allProspects);
      renderCategoryFilter(allProspects);
      renderStalled(allStages, allProspects);
      renderColdSignal(allStages, allProspects);
      renderDuplicates(allProspects);
      renderDataQuality(allStages, allProspects);
      renderActivityFeed(allProspects, allStages);
      renderFunnel(allStages, allProspects);
      renderStageVelocity(allStages, allProspects);
      renderChannelEffectiveness(allProspects);
      renderCategoryEffectiveness(allProspects);
      applyFilter();
      if (initialProspectId && byId[initialProspectId]) openModal(initialProspectId);
      if (failures.length) {
        boardEl.insertAdjacentHTML('afterbegin',
          '<div class="column-empty" role="alert">Showing partial data, failed to load: ' + failures.map(escapeHtml).join('; ') + '</div>');
      }
      // The generator's stage dropdown is built from allStages (npPopulateStageOptions),
      // so it needs stages.json specifically, not just any data, to be usable.
      document.getElementById('newProspectBtn').disabled = !stagesData;
    } else {
      boardEl.innerHTML = '<div class="column-empty" role="alert">Failed to load pipeline data: ' + failures.map(escapeHtml).join('; ') + '</div>';
      boardListEl.innerHTML = '<p class="board-list-empty" role="alert">Failed to load pipeline data: ' + failures.map(escapeHtml).join('; ') + '</p>';
      nudgeEl.innerHTML = '<p class="nudge-empty">Failed to load.</p>';
      activityFeedEl.innerHTML = '<p class="activity-empty" role="alert">Failed to load.</p>';
      funnelListEl.innerHTML = '<p class="funnel-empty" role="alert">Failed to load.</p>';
      velocityListEl.innerHTML = '<p class="velocity-empty" role="alert">Failed to load.</p>';
      channelEffListEl.innerHTML = '<p class="channel-eff-empty" role="alert">Failed to load.</p>';
      categoryEffListEl.innerHTML = '<p class="channel-eff-empty" role="alert">Failed to load.</p>';
    }
  });
})();

(function () {
  // Pure date/urgency math (public/csm/data/csm-core.js), shared with that
  // file's own regression test suite so nudge-due and stale-stage math
  // actually has coverage instead of only ever running live in a browser.
  // Destructured first, before anything below that calls these at load time
  // (the nudgeTodayNote line just after the DOM lookups, in particular).
  const {
    isValidDateStr, daysUntil, daysSince, hasOutOfOrderDates, stallInfo,
    socialSnapshotStaleInfo, socialSnapshotsStaleInfo,
    nudgeUrgencyLevel, computeNudgeRows, byUrgency, touchCount, daysSinceLastTouch,
    todayIso, addDaysIso, suggestedNudgeOffsetDays, rollToWeekdayIso, beijingTimeInfo,
    reachedActiveExploration, computeStageVelocity, computeColdSignal, COLD_TOUCH_THRESHOLD,
    computeFunnel, computeSocialReach, computeChannelEffectiveness, computeCategoryEffectiveness,
    CHANNEL_EFF_MIN_N_FOR_RATE, computeStalled,
    csvField, icsEscapeText, icsFoldLine, outreachReadinessWarnings,
    channelSortRank, listComparator, computeDataQualityFlags,
    slugifyProspectId, nextAvailableId, findCategoryCasingClash, findProspectByNameCompany,
    missingContactChannelType, missingVerifiedHook, channelTypeLoggedWithNoDetail, missingFollowUpPlan
  } = CSMCore;

  const boardEl = document.getElementById('board');
  const boardListWrapEl = document.getElementById('boardListWrap');
  const boardListEl = document.getElementById('boardList');
  const viewToggleEl = document.getElementById('viewToggle');
  const nudgeEl = document.getElementById('nudgeQueue');
  const statsEl = document.getElementById('statsBar');
  const snapshotStripEl = document.getElementById('snapshotStrip');
  const searchInput = document.getElementById('searchInput');
  const channelFilterEl = document.getElementById('channelFilter');
  const categoryFilterEl = document.getElementById('categoryFilter');
  const modalOverlay = document.getElementById('modalOverlay');
  const modalName = document.getElementById('modalName');
  const modalCompany = document.getElementById('modalCompany');
  const modalBody = document.getElementById('modalBody');
  const modalClose = document.getElementById('modalClose');
  const modalCopyLinkBtn = document.getElementById('modalCopyLinkBtn');
  const modalBriefBtn = document.getElementById('modalBriefBtn');
  const printBtn = document.getElementById('printBtn');
  const csvBtn = document.getElementById('csvBtn');
  const backupBtn = document.getElementById('backupBtn');
  const icsBtn = document.getElementById('icsBtn');
  const copyLinkBtn = document.getElementById('copyLinkBtn');
  const snapshotBtn = document.getElementById('snapshotBtn');
  const dataQualitySection = document.getElementById('dataQualitySection');
  const dataQualityList = document.getElementById('dataQualityList');
  const activityFeedEl = document.getElementById('activityFeed');
  const velocityListEl = document.getElementById('velocityList');
  const funnelListEl = document.getElementById('funnelList');
  const channelEffListEl = document.getElementById('channelEffList');
  const categoryEffListEl = document.getElementById('categoryEffList');
  const socialReachListEl = document.getElementById('socialReachList');
  const attentionBarEl = document.getElementById('attentionBar');
  const changelogFeedEl = document.getElementById('changelogFeed');
  const ACTIVITY_PREVIEW_COUNT = 8;

  // Standard tab-title badge pattern ("(2) Page Title", same convention as
  // Gmail's unread count): lets a nudge that's actually due surface in a
  // background/pinned tab without having to switch to it first, which the
  // on-page nudge queue can't do by itself. Only counts nudges due today or
  // overdue, same definition renderSnapshot already uses for its own count,
  // so the two never disagree.
  const BASE_TITLE = document.title;
  function updateDocumentTitle(overdueCount) {
    document.title = overdueCount > 0 ? '(' + overdueCount + ') ' + BASE_TITLE : BASE_TITLE;
  }

  // A pinned tab shows only the favicon, no title text at all, so the count
  // above can't reach it. Same red-dot-on-the-icon convention as Slack/Gmail:
  // draw the existing favicon onto a canvas and stamp a dot in the corner
  // only while a nudge is actually due, then hand the result back to the
  // <link rel="icon"> as a generated data URL. Never edits favicon.svg
  // itself, which every other hub's page also links to.
  const faviconLinkEl = document.querySelector('link[rel="icon"]');
  const FAVICON_SRC = faviconLinkEl ? faviconLinkEl.getAttribute('href') : null;
  let faviconHasDot = null;
  function updateFavicon(overdueCount) {
    if (!faviconLinkEl || !FAVICON_SRC) return;
    const wantDot = overdueCount > 0;
    if (wantDot === faviconHasDot) return;
    if (!wantDot) {
      faviconLinkEl.setAttribute('href', FAVICON_SRC);
      faviconLinkEl.setAttribute('type', 'image/svg+xml');
      faviconHasDot = false;
      return;
    }
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, 64, 64);
      ctx.beginPath();
      ctx.arc(50, 14, 11, 0, Math.PI * 2);
      ctx.fillStyle = '#E5484D';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#08090A';
      ctx.stroke();
      faviconLinkEl.setAttribute('href', canvas.toDataURL('image/png'));
      faviconLinkEl.setAttribute('type', 'image/png');
      faviconHasDot = true;
    };
    img.src = FAVICON_SRC;
  }

  printBtn.addEventListener('click', () => window.print());

  // Every "overdue" / "in Xd" label in the nudge queue below is computed
  // against this device's local clock at page load, not a server clock, so
  // a wrong device date or a screenshot viewed later can make those numbers
  // read as wrong when they were actually correct at the time. Stating the
  // reference date plainly lets that be checked at a glance instead of
  // taken on faith, same honesty standard as the "as of" social snapshot
  // dates and the footer's "last hand-edited" note.
  const nudgeTodayNoteEl = document.getElementById('nudgeTodayNote');
  if (nudgeTodayNoteEl) {
    nudgeTodayNoteEl.textContent = 'Due dates below are computed against today, ' + fmtDate(todayIso()) + ', this device’s local date.';
  }

  // China runs a single national timezone (China Standard Time, UTC+8, no
  // daylight saving), so a nudge that looks "due today" on this device can
  // still land in the middle of the recipient's night. Cold-outreach
  // benchmarks are consistent that weekday mornings in the recipient's own
  // timezone get the best reply rates, the same category of signal
  // rollToWeekdayIso already applies to which day a nudge rolls onto; this
  // surfaces the hour, computed once at page load like every other
  // "computed against this clock" note on this page, not a live tick.
  const beijingTimeNoteEl = document.getElementById('beijingTimeNote');
  if (beijingTimeNoteEl) {
    const b = beijingTimeInfo();
    const clock = String(b.hour).padStart(2, '0') + ':' + String(b.minute).padStart(2, '0');
    let verdict;
    if (b.isPrimeReplyWindow) verdict = 'inside the Tue-Thu morning window general cold-outreach benchmarks report as strongest for replies.';
    else if (b.isBusinessHours) verdict = 'inside typical business hours, outside that Tue-Thu-morning window.';
    else if (b.isWeekday) verdict = 'outside typical business hours; a message sent now likely sits unread until morning there.';
    else verdict = 'a weekend in China; a message sent now likely sits unread until Monday there.';
    beijingTimeNoteEl.textContent = 'Beijing time right now: ' + clock + ', ' + b.weekdayName + '. ' + verdict;
  }

  // Reference/analytics widgets below the attention bar (platform reference,
  // funnel, velocity, channel/category effectiveness, social reach) are
  // collapsed by default so the actionable nudge queue and board are closer
  // to the top of the page. Once a real visitor opens one to check it,
  // re-collapsing it on every reload would just make them reopen it again
  // next time, so the open/closed state persists per section, same
  // this-browser-only localStorage convention as the sidebar's own
  // expanded/collapsed state.
  const SECTION_OPEN_KEY_PREFIX = 'csm-section-open-';
  document.querySelectorAll('.section-details[id]').forEach(details => {
    const key = SECTION_OPEN_KEY_PREFIX + details.id;
    try {
      if (localStorage.getItem(key) === '1') details.open = true;
    } catch (e) { /* localStorage unavailable (private window, blocked storage): stays collapsed */ }
    details.addEventListener('toggle', () => {
      try { localStorage.setItem(key, details.open ? '1' : '0'); } catch (e) { /* see above */ }
    });
  });

  // A closed <details>'s content sits behind an internal browser slot that
  // a plain CSS "display: block !important" on the slotted children can't
  // override (verified: computed style reports "block" but nothing paints),
  // so printing whatever was left collapsed has to force each one open in
  // JS instead, for both the in-page "Print / export PDF" button and a
  // browser/OS print triggered directly. Restored after printing so the
  // on-screen state (and its localStorage record above) isn't disturbed by
  // having printed.
  let printReopenedDetails = null;
  // Collapsed empty board columns need the same treatment: expand them for
  // the printed page (an empty stage is still real pipeline structure worth
  // showing on paper), then restore the on-screen collapsed state after.
  let forceExpandColumnsForPrint = false;
  window.addEventListener('beforeprint', () => {
    printReopenedDetails = [];
    document.querySelectorAll('.section-details').forEach(d => {
      printReopenedDetails.push([d, d.open]);
      d.open = true;
    });
    forceExpandColumnsForPrint = true;
    applyFilter();
    // Print CSS always shows .board and hides .board-list-wrap (there is no
    // printed List layout), but applyFilter() above only renders #board when
    // viewMode is already 'board'. In List view (including one restored
    // straight from a shared "?view=list" link, which never touches #board
    // at all) that left the printed page's kanban section completely empty.
    // Render it explicitly here so printing from List view shows the same
    // real pipeline data as printing from Board view.
    if (viewMode === 'list' && lastFilterArgs) {
      renderBoard(allStages, lastFilterArgs.filtered, allProspects, lastFilterArgs.rawQuery, lastFilterArgs.filterActive);
    }
  });
  window.addEventListener('afterprint', () => {
    if (printReopenedDetails) {
      printReopenedDetails.forEach(([d, wasOpen]) => { d.open = wasOpen; });
      printReopenedDetails = null;
    }
    forceExpandColumnsForPrint = false;
    applyFilter();
  });

  // Right now 4 of the 5 board columns are genuinely empty (only one real
  // prospect exists), which is honest but means most of the board's width
  // and, on a phone, most of its scroll is "No prospects in this stage
  // yet." repeated four times. A stage with zero prospects can collapse to
  // just its header, same disclosure convention as SECTION_OPEN_KEY_PREFIX
  // above; a stage that actually has prospects is never collapsible, so a
  // stale "collapsed" preference from when a stage used to be empty can
  // never hide a real one once it gains prospects (checked fresh on every
  // render against the real, unfiltered count, not remembered).
  const COLUMN_COLLAPSE_KEY_PREFIX = 'csm-column-collapsed-';
  function isColumnCollapsed(stageId) {
    try {
      const v = localStorage.getItem(COLUMN_COLLAPSE_KEY_PREFIX + stageId);
      return v === null ? true : v === '1';
    } catch (e) { return true; /* localStorage unavailable: default to collapsed */ }
  }
  function setColumnCollapsed(stageId, collapsed) {
    try { localStorage.setItem(COLUMN_COLLAPSE_KEY_PREFIX + stageId, collapsed ? '1' : '0'); } catch (e) { /* see above */ }
  }

  function fmtDate(iso) {
    if (!iso) return null;
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // Same Number.isFinite guard computeSocialReach already applies before
  // summing followers into a platform total, so a hand-edited non-numeric
  // value (a "12,000" or "12K" string, validate.js rejects it but only when
  // someone remembers to run it before the data is live) doesn't reach
  // Number(...).toLocaleString() and print "NaN followers" in the activity
  // feed, the copyable outreach brief, or the prospect detail modal, the
  // three other places this same field gets displayed.
  function formatFollowers(snap) {
    if (!snap || snap.followers == null) return null;
    const followers = Number(snap.followers);
    if (!Number.isFinite(followers)) return null;
    return followers.toLocaleString() + ' followers';
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

  // div.textContent/innerHTML round-trip only escapes &amp;/&lt;/&gt; in text
  // content, not quotes, so a hand-typed value with a " or ' in it (a stage
  // color, a category name, an id) could break out of an attribute like
  // style="..." or data-foo="...". Same regex-based escape CGT and Garage
  // already use for exactly that reason.
  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
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
      } else if (dwellStart && isValidDateStr(dwellStart)) {
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
  // Same urgency tiering renderNudgeQueue already used inline, pulled out so
  // renderCard below can flag an overdue/due-today nudge on the board itself
  // without duplicating the bad-date/unqueued/days branching. Both
  // nudgeUrgencyLevel and computeNudgeRows now live in csm-core.js
  // (destructured above), so this math has real regression coverage.
  function renderNudgeQueue(prospects) {
    const rows = computeNudgeRows(prospects);
    icsBtn.disabled = rows.filter(r => !r.unqueued && !r.badDate).length === 0;

    if (rows.length === 0) {
      nudgeEl.innerHTML = '<p class="nudge-empty">No nudge dates logged yet. Once a real send date and nudge ' +
        'schedule are recorded for a prospect, the next one due shows up here.</p>';
      return;
    }

    nudgeEl.innerHTML = rows.map(({ p, days, unqueued, badDate }) => {
      const urgency = nudgeUrgencyLevel(days, unqueued, badDate);
      let when;
      if (badDate) when = 'bad date';
      else if (unqueued) when = Math.abs(days) + 'd past planned nudge point';
      else if (days < 0) when = Math.abs(days) + 'd overdue';
      else if (days === 0) when = 'today';
      else when = 'in ' + days + 'd';
      const notBefore = p.nudgeSchedule && p.nudgeSchedule.doNotNudgeBefore
        ? ' &middot; do not nudge before ' + fmtDate(p.nudgeSchedule.doNotNudgeBefore)
        : '';
      const dateShown = badDate ? escapeHtml(p.nextNudgeDate) : (unqueued ? fmtDate(p.nudgeSchedule.nudgePoint) : fmtDate(p.nextNudgeDate));
      const unqueuedNote = badDate
        ? '<span class="nudge-action nudge-action-missing">BAD DATE LOGGED &middot; nextNudgeDate "' +
          escapeHtml(p.nextNudgeDate) + '" is not a valid YYYY-MM-DD date, fix it in the edit form</span>'
        : (unqueued
          ? '<span class="nudge-action nudge-action-missing">NOT ON THE QUEUE &middot; nudgeSchedule.nudgePoint ' +
            'passed but nextNudgeDate was never set, log a real nextNudgeDate or this keeps going unseen</span>'
          : '');
      const actionLine = p.nextAction
        ? '<span class="nudge-action">' + escapeHtml(p.nextAction) + '</span>'
        : (unqueued ? '' : '<span class="nudge-action nudge-action-missing">NO NEXT ACTION LOGGED &middot; a due date alone tends to stall</span>');
      const touches = touchCount(p);
      const touchLine = touches > 0
        ? '<span class="nudge-touch-count font-mono">' + touches + ' touch' + (touches === 1 ? '' : 'es') +
          ' logged so far</span>'
        : '';
      return '<button type="button" class="nudge-row nudge-' + urgency + (unqueued || badDate ? ' nudge-row-unqueued' : '') +
        '" data-prospect-id="' + escapeHtml(p.id) + '">' +
        '<span class="nudge-top">' +
        '<span class="nudge-urgency-dot"></span>' +
        '<strong>' + escapeHtml(p.name) + '</strong>' +
        '<span style="color:var(--sub)">' + escapeHtml(p.company || '') + '</span>' +
        '<span class="font-mono nudge-when">' +
        dateShown + ' (' + when + ')' + notBefore +
        '</span></span>' +
        unqueuedNote +
        actionLine +
        touchLine +
        '</button>';
    }).join('');
    wireRowsToModal(nudgeEl);
  }

  // One-glance digest above everything else on the page: pulls counts the
  // sections below already compute (nudge queue, stalled, data quality,
  // duplicates) into a single row of jump links, so a real overdue nudge or
  // a stalled deal doesn't require scrolling past several sections to
  // notice. Never computes anything new, just points at where each count
  // already lives, so it can never drift out of sync with those sections.
  function renderAttentionBar(stages, prospects, driftStatus) {
    const nudgeRows = computeNudgeRows(prospects);
    const overdueCount = nudgeRows.filter(r => r.days <= 0).length;
    const stalledCount = computeStalled(stages, prospects).length;
    const coldSignalCount = computeColdSignal(prospects).active.length;
    const backfillCount = computeDataQualityFlags(stages, prospects).length;
    const duplicateCount = CSMValidateCore.findDuplicateProspects(prospects).length;
    // Casing drift has its own section (casingDriftSection) with the same
    // "silently fragments filtering/grouping" real-world impact as a
    // duplicate prospect, but was never counted up here, so it could sit
    // fully populated at the bottom of the page with nothing above the fold
    // ever pointing at it. Same CSMValidateCore.findCasingDrift call
    // renderCasingDrift itself already makes for each of the two fields it
    // checks (category, social platform).
    const casingDriftCount = CSMValidateCore.findCasingDrift(prospects, p => [p.category]).length +
      CSMValidateCore.findCasingDrift(prospects, p => (p.socialSnapshots || []).map(s => s && s.platform)).length;

    const items = [];
    // Same reasoning as Sondrik's own Next Steps widget: a drifted changelog
    // is actively showing a real commit history that no longer matches this
    // repo's git log, an urgent tone rather than the routine "needs
    // backfill" warn tone below, since it's misinformation already on the
    // page, not just an unlogged field.
    if (driftStatus && driftStatus.drifted) {
      items.push({
        n: 1, tone: 'urgent', target: 'changelogFeed',
        label: 'data changelog out of sync with real git history'
      });
    }
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
    if (casingDriftCount) {
      items.push({
        n: casingDriftCount, tone: 'warn', target: 'casingDriftList',
        label: casingDriftCount === 1 ? 'spelling inconsistency across prospects' : 'spelling inconsistencies across prospects'
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

  const stalledEl = document.getElementById('stalledList');
  const stalledSection = document.getElementById('stalledSection');

  // Pure stalled-prospect rollup math now lives in csm-core.js
  // (computeStalled), same shared-core-with-tests pattern as the other
  // pure math above.
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

  // Real risk this catches: the "Log new prospect" generator only guards
  // against an exact id collision (nextAvailableId, in csm-core.js), so
  // hand-typing the same person into a second entry under a slightly
  // different id would otherwise go unnoticed. Shared with validate.js via
  // CSMValidateCore (same reasoning as CGT's own validate-core.js) so the
  // two can never drift.
  function renderDuplicates(prospects) {
    const groups = CSMValidateCore.findDuplicateProspects(prospects);
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

  const casingDriftEl = document.getElementById('casingDriftList');
  const casingDriftSection = document.getElementById('casingDriftSection');

  // Same normalize-and-group-by-lowercase check validate.js already runs on
  // the command line for both category and socialSnapshots[].platform, just
  // rendered as a clickable panel instead of a CLI warning nobody sees until
  // they remember to run it. A category or platform spelled two ways doesn't
  // fail validation (both spellings are individually valid strings), but it
  // silently fragments the category filter chips and the platform search
  // match into two, so it needs its own panel rather than folding into
  // per-prospect computeDataQualityFlags below, which only ever looks at one
  // prospect at a time and can't see drift across the whole dataset. Grouping
  // logic itself lives in CSMValidateCore, shared with validate.js.
  function renderCasingDrift(prospects) {
    const categoryDrift = CSMValidateCore.findCasingDrift(prospects, p => [p.category]).map(entry => ({ ...entry, field: 'CATEGORY' }));
    const platformDrift = CSMValidateCore.findCasingDrift(prospects, p => (p.socialSnapshots || []).map(s => s && s.platform))
      .map(entry => ({ ...entry, field: 'SOCIAL PLATFORM' }));
    const groups = [...categoryDrift, ...platformDrift];

    if (groups.length === 0) {
      casingDriftSection.hidden = true;
      return;
    }
    casingDriftSection.hidden = false;
    casingDriftEl.innerHTML = groups.map(({ variants, prospects: matched, field }) => {
      const spellings = Array.from(variants.keys()).map(v => JSON.stringify(v)).join(' vs. ');
      return matched.map(p =>
        '<button type="button" class="data-quality-row" data-prospect-id="' + escapeHtml(p.id) + '">' +
        '<strong>' + escapeHtml(p.name) + '</strong>' +
        '<span style="color:var(--sub)">' + escapeHtml(p.company || '') + '</span>' +
        '<span class="dq-why">' + field + ' SPELLED ' + escapeHtml(spellings) + '</span>' +
        '</button>'
      ).join('');
    }).join('');
    wireRowsToModal(casingDriftEl);
  }

  const coldSignalEl = document.getElementById('coldSignalList');
  const coldSignalSection = document.getElementById('coldSignalSection');
  const coldSignalParkedWrap = document.getElementById('coldSignalParkedWrap');
  const coldSignalParkedEl = document.getElementById('coldSignalParkedList');

  // Pure cold-outreach threshold/parking math now lives in csm-core.js
  // (computeColdSignal), same shared-core-with-tests pattern as the other
  // nudge/stall math above, so it has real regression coverage instead of
  // only ever running live in a browser.
  function renderColdSignal(stages, prospects) {
    const { active, parked } = computeColdSignal(prospects);
    if (active.length === 0 && parked.length === 0) {
      coldSignalSection.hidden = true;
      return;
    }
    coldSignalSection.hidden = false;

    if (active.length === 0) {
      coldSignalEl.innerHTML = '<p class="nudge-empty">Nothing needs a decision right now, everything past the ' +
        'touch threshold is already parked for a scheduled re-engagement below.</p>';
    } else {
      coldSignalEl.innerHTML = active.map(({ p, touches }) =>
        '<button type="button" class="data-quality-row" data-prospect-id="' + escapeHtml(p.id) + '">' +
        '<strong>' + escapeHtml(p.name) + '</strong>' +
        '<span style="color:var(--sub)">' + escapeHtml(p.company || '') + '</span>' +
        '<span class="dq-why">' + touches + ' REAL TOUCHES LOGGED, STILL WAITING ON A REPLY</span>' +
        (p.contactChannel && p.contactChannel.type === 'generic-inbox'
          ? '<span class="dq-escalate">STILL ON A GENERIC INBOX, TRY A NAMED DECISION-MAKER NEXT</span>'
          : '') +
        '</button>'
      ).join('');
      wireRowsToModal(coldSignalEl);
    }

    coldSignalParkedWrap.hidden = parked.length === 0;
    if (parked.length > 0) {
      coldSignalParkedEl.innerHTML = parked.map(({ p, touches }) =>
        '<button type="button" class="data-quality-row" data-prospect-id="' + escapeHtml(p.id) + '">' +
        '<strong>' + escapeHtml(p.name) + '</strong>' +
        '<span style="color:var(--sub)">' + escapeHtml(p.company || '') + '</span>' +
        '<span class="dq-why">' + touches + ' TOUCHES SO FAR &middot; RE-ENGAGE ' +
        fmtDate(p.nudgeSchedule.doNotNudgeBefore).toUpperCase() + '</span>' +
        (p.contactChannel && p.contactChannel.type === 'generic-inbox'
          ? '<span class="dq-escalate">STILL ON A GENERIC INBOX, TRY A NAMED DECISION-MAKER NEXT</span>'
          : '') +
        '</button>'
      ).join('');
      wireRowsToModal(coldSignalParkedEl);
    }
  }

  // hasNudgePlan, and the missingContactChannelType/missingVerifiedHook/
  // channelTypeLoggedWithNoDetail/missingFollowUpPlan predicates this badge
  // shares with the "Log new prospect" warnings below, now live in
  // csm-core.js, same shared-core-with-tests pattern as the other pure
  // math above.
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
      ', ' + reasons.map(escapeHtml).join(' &middot; ') + '</span>' +
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
      // A logged social snapshot is just as real a research event as a
      // stage move, a touch, or a content idea, it just used to only ever
      // show up inside that prospect's own detail view (Social snapshots
      // field), never in this cross-prospect feed. asOfDate is when the
      // numbers were actually pulled, the same real date every other event
      // type here is keyed on.
      (p.socialSnapshots || []).forEach(snap => {
        if (!snap.asOfDate) return;
        const followersLabel = formatFollowers(snap);
        const label = 'Logged ' + (snap.platform || 'platform not logged') + ' snapshot' +
          (followersLabel ? ': ' + followersLabel : '') +
          (snap.engagementRate != null ? ', ' + snap.engagementRate + '% engagement' : '');
        events.push({ date: snap.asOfDate, type: 'snapshot', prospect: p, label });
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
        ? '<span class="activity-tag activity-tag-stage" style="color:' + escapeHtml(ev.color) + ';border-color:' + escapeHtml(ev.color) + '66;background:' + escapeHtml(ev.color) + '14">MOVED</span>'
        : ev.type === 'touch'
        ? '<span class="activity-tag activity-tag-touch">TOUCH</span>'
        : ev.type === 'snapshot'
        ? '<span class="activity-tag activity-tag-snapshot">SNAPSHOT</span>'
        : '<span class="activity-tag activity-tag-idea">IDEA</span>';
      return '<button type="button" class="activity-row" data-prospect-id="' + escapeHtml(ev.prospect.id) + '">' +
        '<span class="activity-date font-mono">' + escapeHtml(fmtDate(ev.date)) + '</span>' +
        tag +
        '<span class="activity-who"><strong>' + escapeHtml(ev.prospect.name) + '</strong>' +
        (ev.prospect.company ? ' <span style="color:var(--sub)">' + escapeHtml(ev.prospect.company) + '</span>' : '') +
        '</span>' +
        '<span class="activity-label">' + escapeHtml(ev.label) + '</span>' +
        '</button>';
    }).join('');
    activityFeedEl.innerHTML =
      '<div class="activity-list' + (needsToggle ? ' is-collapsed' : '') + '" id="activityList">' + rowsHtml + '</div>' +
      (needsToggle ? '<button type="button" class="activity-toggle font-mono" id="activityToggle" aria-expanded="false" aria-controls="activityList">Show all ' +
        events.length + '</button>' : '');
    wireRowsToModal(activityFeedEl);
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

  // Renders changelog.json, a file no one hand-edits: it's regenerated from
  // this repo's real git history by public/csm/data/changelog.js, so every
  // hash, author, and date here is independently checkable against the
  // repo instead of resting on a hand-typed claim. Missing the file
  // entirely (never generated yet, or a fresh clone) is an honest empty
  // state, not an error, same as an empty prospects list.
  // driftStatus comes from /api/csm/changelog-status, the same live drift
  // check already exposed for Sondrik and Alpha: it compares changelog.json's
  // recorded commit hashes for prospects.json/stages.json against this
  // repo's real git log, so a real drift shows up here on the live page
  // instead of only when someone happens to run node public/csm/data/
  // changelog.js from the command line. "unavailable" (not a git checkout,
  // shallow clone, etc) is an environment gap, not a data error, so it stays
  // silent rather than showing a warning no one can act on.
  function renderChangelog(data, driftStatus) {
    const driftWarning = (driftStatus && driftStatus.drifted)
      ? '<div class="callout callout-warn"><strong>Changelog is out of sync.</strong> changelog.json records ' +
        driftStatus.recordedCount + ' commit' + (driftStatus.recordedCount === 1 ? '' : 's') +
        ' for prospects.json/stages.json, but this repo’s real git history has ' + driftStatus.realCount +
        '. Run <code>node public/csm/data/changelog.js</code> to regenerate it.</div>'
      : '';
    const entries = (data && data.entries) || [];
    if (entries.length === 0) {
      changelogFeedEl.innerHTML = driftWarning + '<p class="changelog-empty">No changelog generated yet. Run ' +
        '<code>node public/csm/data/changelog.js</code> to build one from this repo&rsquo;s git history.</p>';
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

  // Pure funnel reach/conversion math now lives in csm-core.js
  // (computeFunnel), same shared-core-with-tests pattern as the other pure
  // math above.
  function renderFunnel(stages, prospects) {
    const results = computeFunnel(stages, prospects);
    const total = results.length ? results[0].reached : 0;
    if (total === 0) {
      funnelListEl.innerHTML = '<p class="funnel-empty">No prospects logged yet.</p>';
      return;
    }
    funnelListEl.innerHTML = results.map(r => {
      const widthPct = r.reached > 0 ? Math.max(2, Math.round((r.reached / total) * 100)) : 0;
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

  // Pure channel/category effectiveness math now lives in csm-core.js
  // (computeChannelEffectiveness, computeCategoryEffectiveness,
  // CHANNEL_EFF_MIN_N_FOR_RATE), same shared-core-with-tests pattern as the
  // other pure math above.
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
      // ratePct (the real, unfloored rounded rate) is kept separate from
      // widthPct (the same rate floored to 2% so a genuinely nonzero result
      // still renders as a visible sliver of bar), same split renderFunnel
      // already keeps between its own widthPct and conversionFromPrev: the
      // floor is a bar-visibility fix, not something that belongs in the
      // printed number, or a true 1% would display as a fabricated 2%.
      const ratePct = Math.round((r.advanced / r.contacted) * 100);
      const widthPct = r.contacted < CHANNEL_EFF_MIN_N_FOR_RATE ? 0
        : r.advanced > 0 ? Math.max(2, ratePct) : 0;
      const rateHtml = r.contacted >= CHANNEL_EFF_MIN_N_FOR_RATE
        ? '<span class="channel-eff-rate font-mono">' + ratePct + '% reached active exploration</span>'
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
      // ratePct/widthPct split for the same reason as renderCategoryEffectiveness
      // above: the bar-visibility floor must never leak into the printed number.
      const ratePct = Math.round((r.advanced / r.contacted) * 100);
      const widthPct = r.contacted < CHANNEL_EFF_MIN_N_FOR_RATE ? 0
        : r.advanced > 0 ? Math.max(2, ratePct) : 0;
      const rateHtml = r.contacted >= CHANNEL_EFF_MIN_N_FOR_RATE
        ? '<span class="channel-eff-rate font-mono">' + ratePct + '% reached active exploration</span>'
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

  // Pure per-platform social reach rollup math now lives in csm-core.js
  // (computeSocialReach), same shared-core-with-tests pattern as the other
  // pure math above. Locks in regression coverage for the NaN-followers bug
  // this function was previously patched for (see changelog).
  function renderSocialReach(prospects) {
    const results = computeSocialReach(prospects);
    if (results.length === 0) {
      socialReachListEl.innerHTML = '<p class="channel-eff-empty">No social snapshots logged for any prospect ' +
        'yet. Once a real socialSnapshots entry is logged, reach aggregates here by platform, one-time research ' +
        'pulls only, never a live number.</p>';
      return;
    }
    socialReachListEl.innerHTML = results.map(r => {
      const followersText = r.hasFollowers ? r.totalFollowers.toLocaleString() + ' followers' : 'no follower counts logged';
      const engagementText = r.engagementCount ? (r.engagementSum / r.engagementCount).toFixed(1) + '% avg engagement' : null;
      const asOfText = r.mostRecentAsOf ? 'most recent pull ' + fmtDate(r.mostRecentAsOf) : 'no as-of date logged';
      const staleText = r.staleCount
        ? '<span class="snapshot-tag-stale"> &middot; ' + r.staleCount + ' of ' + r.prospectCount + ' due for refresh</span>'
        : '';
      return '<div class="channel-eff-row">' +
        '<div class="channel-eff-row-head">' +
        '<span class="channel-eff-label">' + escapeHtml(r.platform) + '</span>' +
        '<span class="channel-eff-count font-mono">' + r.prospectCount + ' prospect' + (r.prospectCount === 1 ? '' : 's') + ' tracked</span>' +
        '</div>' +
        '<span class="channel-eff-rate font-mono">' + escapeHtml(followersText) +
        (engagementText ? ' &middot; ' + escapeHtml(engagementText) : '') +
        ' &middot; ' + escapeHtml(asOfText) + staleText + '</span>' +
        '</div>';
    }).join('');
  }

  function renderBoard(stages, prospects, allProspects, displayQuery, filtering) {
    const stageById = Object.fromEntries(stages.map(s => [s.id, s]));
    // Built once per render from the same computeNudgeRows the Nudge Queue
    // section already uses, so a card's badge can never disagree with that
    // section's own overdue/today reasoning.
    const nudgeUrgencyById = Object.fromEntries(
      computeNudgeRows(allProspects).map(r => [r.p.id, nudgeUrgencyLevel(r.days, r.unqueued, r.badDate)])
    );
    boardEl.innerHTML = stages.map(stage => {
      const inStage = prospects.filter(p => p.stage === stage.id).sort(byUrgency);
      const totalInStage = allProspects.filter(p => p.stage === stage.id).length;
      // Collapsible only when truly empty across the whole pipeline (not
      // just filtered to zero matches), so collapsing can never hide a real
      // prospect behind a stale preference or an active search.
      const isEmptyStage = totalInStage === 0;
      const collapsed = isEmptyStage && !forceExpandColumnsForPrint && isColumnCollapsed(stage.id);
      let cards;
      if (inStage.length) {
        cards = inStage.map(p => renderCard(p, stageById, nudgeUrgencyById)).join('');
      } else if (filtering && totalInStage > 0) {
        cards = '<div class="column-empty" role="status">No matches' +
          (displayQuery ? ' for "' + escapeHtml(displayQuery) + '"' : '') + ' in this stage.</div>';
      } else {
        cards = '<div class="column-empty">No prospects in this stage yet.</div>';
      }
      const toggleLabel = (collapsed ? 'Expand' : 'Collapse') + ' ' + escapeHtml(stage.label) + ', an empty stage';
      const toggleBtn = isEmptyStage
        ? '<button type="button" class="column-toggle font-mono" data-stage-id="' + escapeHtml(stage.id) + '" ' +
          'aria-expanded="' + (!collapsed) + '" aria-label="' + toggleLabel + '" title="' + toggleLabel + '">' +
          (collapsed ? '+' : '-') + '</button>'
        : '';
      return '<div class="column' + (collapsed ? ' column-collapsed' : '') + '" data-stage-id="' + escapeHtml(stage.id) + '">' +
        '<div class="column-head">' +
        '<span class="stage-dot" style="background:' + escapeHtml(stage.color) + '"></span>' +
        '<h2>' + escapeHtml(stage.label) + '</h2>' +
        toggleBtn +
        '<span class="column-count font-mono">' + inStage.length + '</span>' +
        '</div>' +
        (collapsed ? '' : '<div class="column-desc">' + escapeHtml(stage.description) + '</div>' + cards) +
        '</div>';
    }).join('');

    boardEl.querySelectorAll('[data-prospect-id]').forEach(el => {
      el.addEventListener('click', () => openModal(el.getAttribute('data-prospect-id')));
    });
    boardEl.querySelectorAll('.card-move[data-move-prospect-id]').forEach(sel => {
      sel.addEventListener('click', e => e.stopPropagation());
      sel.addEventListener('change', () => {
        const id = sel.getAttribute('data-move-prospect-id');
        const targetStageId = sel.value;
        sel.value = '';
        if (!targetStageId) return;
        openModalForStageMove(id, targetStageId);
      });
    });
    boardEl.querySelectorAll('.column-toggle').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const stageId = btn.getAttribute('data-stage-id');
        setColumnCollapsed(stageId, btn.getAttribute('aria-expanded') === 'true');
        applyFilter();
      });
    });
    wireCardDragAndDrop();
  }

  // Kanban drag-to-restage, a standard pipeline-board interaction. Dragging a
  // card to a different column never touches prospects.json or the rendered
  // stage counts itself, that would show a stage move that was not actually
  // logged anywhere. Instead a drop opens that prospect's own detail modal
  // with the existing stage-move generator pre-set to the target stage and
  // already generated, so the only thing dragging saves is the clicks to get
  // there, never the honesty check on whether the move is real. Each card's
  // own "Move to stage..." select (wired in renderBoard) reaches the exact
  // same openModalForStageMove call, so a keyboard or screen-reader user
  // gets that same shortcut without needing to drag anything.
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
  // channelSortRank/listComparator now live in csm-core.js, the same reason
  // touchCount/stallInfo etc. were split out: a plain Node test can exercise
  // the real multi-key sort (and its deliberate missing-value placeholders)
  // directly.

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
    // Same overdue/today tiering the board's card badge uses, so the two
    // views never disagree on what counts as due now.
    const nudgeUrgencyById = Object.fromEntries(
      computeNudgeRows(allProspects).map(r => [r.p.id, nudgeUrgencyLevel(r.days, r.unqueued, r.badDate)])
    );

    const headers = [
      { key: 'name', label: 'Prospect' },
      { key: 'stage', label: 'Stage' },
      { key: 'category', label: 'Category' },
      { key: 'channel', label: 'Channel' },
      { key: 'nextNudge', label: 'Next nudge' },
      { key: 'stalled', label: 'Time in stage' },
      { key: 'touches', label: 'Touches' },
      { key: 'lastTouch', label: 'Last touch' }
    ];
    const headHtml = headers.map(h => {
      const active = h.key === listSortKey;
      const ariaSort = active ? (listSortDir === 'asc' ? 'ascending' : 'descending') : 'none';
      const arrow = active ? (listSortDir === 'asc' ? ' ↑' : ' ↓') : '';
      return '<th data-sort-key="' + h.key + '" aria-sort="' + ariaSort + '" tabindex="0">' +
        escapeHtml(h.label) + arrow + '</th>';
    }).join('');

    const rowsHtml = sorted.map(p => {
      const stage = stageById[p.stage];
      const info = stallInfo(p, stageById);
      const lastTouchDays = daysSinceLastTouch(p);
      return '<tr class="board-list-row' + (info && info.isStale ? ' board-list-row-stale' : '') +
        '" data-prospect-id="' + escapeHtml(p.id) + '" tabindex="0" role="button" aria-label="View details for ' + escapeHtml(p.name) + '">' +
        '<td><div class="board-list-name">' + escapeHtml(p.name) + '</div><div class="board-list-company">' +
        escapeHtml(p.company || 'Company not logged') + '</div></td>' +
        '<td>' + (stage
          ? '<span class="stage-dot" style="background:' + escapeHtml(stage.color) + '"></span> ' + escapeHtml(stage.label)
          : '<span class="board-list-unlogged">Unknown stage</span>') + '</td>' +
        '<td>' + (p.category ? escapeHtml(p.category) : '<span class="board-list-unlogged">Not logged</span>') + '</td>' +
        '<td>' + channelBadge(p.contactChannel) + '</td>' +
        '<td>' + (p.nextNudgeDate
          ? '<span class="' + (nudgeUrgencyById[p.id] === 'overdue' || nudgeUrgencyById[p.id] === 'today' ? 'board-list-nudge-due' : '') +
            '">' + escapeHtml(fmtDate(p.nextNudgeDate)) + '</span>'
          : '<span class="board-list-unlogged">Not queued</span>') + '</td>' +
        '<td>' + (info ? info.days + 'd' + (info.isStale ? ' (stalled)' : '') : '<span class="board-list-unlogged">Unlogged</span>') + '</td>' +
        '<td>' + (touchCount(p) > 0 ? touchCount(p) : '<span class="board-list-unlogged">0</span>') + '</td>' +
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
          listSortDir = (key === 'stalled' || key === 'lastTouch' || key === 'touches') ? 'desc' : 'asc';
        }
        syncUrl();
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
    // Local calendar date, not latest.toISOString()'s UTC one: the same fix
    // applied to the Garage hub's identical footer, which read a day off
    // depending on timezone and time of day.
    const latestDateStr = latest.getFullYear() + '-' + String(latest.getMonth() + 1).padStart(2, '0') + '-' + String(latest.getDate()).padStart(2, '0');
    el.textContent = ' Last hand-edited ' + when + ' (' + latestDateStr + ').';
    el.classList.toggle('data-freshness-stale', daysAgo > 14);
  }

  // Real glyphs, one per snapshot card, same "hub within a hub" pattern
  // shipped on Sondrik and Job Search tonight: each card is a real link
  // into the section it summarizes (jumpToSection below), not a dead
  // number. CSM had no glanceable top-of-page summary at all before this,
  // just a plain unstyled stats string buried near the Pipeline board.
  // Centered on (0,0) at roughly an 18x18 box.
  const SNAPSHOT_ICON = {
    prospects: '<circle cx="-3" cy="-4" r="3.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M-8,7 C-8,2 -5.8,-0.2 -3,-0.2 C-0.2,-0.2 2,2 2,7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="5" cy="-2" r="2.6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M1,7 C1,3.2 2.6,1.3 5,1.3 C7.4,1.3 9,3.2 9,7" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
    nudges: '<path d="M0,-8 C3,-8 5,-5.5 5,-2 L5,2 L7,5.5 L-7,5.5 L-5,2 L-5,-2 C-5,-5.5 -3,-8 0,-8 Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M-2.3,5.5 C-2.3,7 -1.2,8 0,8 C1.2,8 2.3,7 2.3,5.5" fill="none" stroke="currentColor" stroke-width="1.5"/>',
    attention: '<path d="M0,-8.5 L8.5,7 L-8.5,7 Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><line x1="0" y1="-3" x2="0" y2="2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="0" cy="4.6" r="1" fill="currentColor"/>'
  };
  const SNAPSHOT_TARGET = { prospects: 'board', nudges: 'nudgeQueue', attention: 'attentionBar' };

  // Real "clicked through" confirmation, same pattern as Sondrik/Job
  // Search: a brief highlight on the section a card actually jumps to.
  let sectionFlashTimer = null;
  function jumpToSection(targetId) {
    const el = document.getElementById(targetId);
    if (!el) return;
    const container = el.closest('section') || el;
    el.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    clearTimeout(sectionFlashTimer);
    document.querySelectorAll('.section-flash').forEach(n => n.classList.remove('section-flash'));
    requestAnimationFrame(() => requestAnimationFrame(() => {
      container.classList.add('section-flash');
      sectionFlashTimer = setTimeout(() => container.classList.remove('section-flash'), 1600);
    }));
  }

  // Reuses the exact same compute functions renderAttentionBar already
  // calls (computeNudgeRows, computeStalled, computeColdSignal,
  // computeDataQualityFlags, CSMValidateCore.findDuplicateProspects), so
  // this card's numbers can never drift from what the attention bar itself
  // shows for the same real data.
  function renderSnapshot(stages, prospects) {
    const nudgeRows = computeNudgeRows(prospects);
    const overdueCount = nudgeRows.filter(r => r.days <= 0).length;
    const attentionCount = overdueCount + computeStalled(stages, prospects).length +
      computeColdSignal(prospects).active.length + computeDataQualityFlags(stages, prospects).length +
      CSMValidateCore.findDuplicateProspects(prospects).length;

    updateDocumentTitle(overdueCount);
    updateFavicon(overdueCount);

    const chips = [
      {
        kind: 'prospects',
        number: prospects.length,
        label: prospects.length === 1 ? 'prospect in the pipeline' : 'prospects in the pipeline',
        meta: null
      },
      {
        kind: 'nudges',
        number: overdueCount,
        label: overdueCount === 1 ? 'nudge due or overdue' : 'nudges due or overdue',
        meta: nudgeRows.length ? nudgeRows.length + ' total on the queue' : 'no nudge dates logged yet'
      },
      {
        kind: 'attention',
        number: attentionCount,
        label: attentionCount === 1 ? 'item needs attention' : 'items need attention',
        meta: attentionCount ? 'stalled, cold, backfill, or duplicate flags' : 'nothing flagged right now'
      }
    ];

    snapshotStripEl.innerHTML = chips.map(c =>
      '<a href="#' + SNAPSHOT_TARGET[c.kind] + '" class="snapshot-chip snapshot-chip-' + c.kind + '" data-target="' + SNAPSHOT_TARGET[c.kind] + '">' +
      '<div class="snapshot-chip-icon"><svg viewBox="-10 -10 20 20" width="18" height="18" aria-hidden="true">' + SNAPSHOT_ICON[c.kind] + '</svg></div>' +
      '<div class="snapshot-chip-number font-display">' + escapeHtml(String(c.number)) + '</div>' +
      '<div class="snapshot-chip-label">' + escapeHtml(c.label) + '</div>' +
      (c.meta ? '<div class="snapshot-chip-meta">' + escapeHtml(c.meta) + '</div>' : '') +
      '</a>'
    ).join('');

    snapshotStripEl.querySelectorAll('.snapshot-chip').forEach(el => {
      el.addEventListener('click', (event) => {
        event.preventDefault();
        jumpToSection(el.dataset.target);
      });
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

  // Only the two tiers a person would actually act on today ('overdue' and
  // 'today') get a card badge, 'soon'/'later' stay in the Nudge Queue section
  // only, same reasoning as the research this session's improvement was
  // based on: a scanned board should surface the one thing to act on now,
  // not repeat every date the dedicated queue below already shows.
  function nudgeCardBadge(p, nudgeUrgencyById) {
    const urgency = nudgeUrgencyById[p.id];
    if (urgency === 'overdue') return '<span class="badge badge-nudge-overdue">NUDGE OVERDUE</span>';
    if (urgency === 'today') return '<span class="badge badge-nudge-today">NUDGE DUE TODAY</span>';
    return '';
  }

  function renderCard(p, stageById, nudgeUrgencyById) {
    const info = stallInfo(p, stageById);
    const stallBadge = info
      ? '<span class="badge ' + (info.isStale ? 'badge-stale' : 'badge-age') + '">' +
        info.days + 'D IN STAGE' + (info.isStale ? ' &middot; STALLED' : '') + '</span>'
      : '';
    const categoryBadge = p.category
      ? '<span class="badge badge-category">' + escapeHtml(p.category).toUpperCase() + '</span>'
      : '';
    const lastTouchDays = daysSinceLastTouch(p);
    const nTouches = touchCount(p);
    const touchBadge = lastTouchDays != null
      ? '<span class="badge badge-touch">' + nTouches + (nTouches === 1 ? ' TOUCH' : ' TOUCHES') +
        ' &middot; ' + lastTouchDays + 'D SINCE LAST</span>'
      : '';
    // Surfaced directly on the card face, not just in the modal/nudge queue:
    // a due nudge date with no visible concrete next step is exactly the
    // silent-stall pattern validate.js and the nudge queue already warn
    // about, so at-a-glance board triage should show it without a click.
    const nextActionLine = p.nextAction
      ? '<div class="card-next-action">' + escapeHtml(p.nextAction) + '</div>'
      : '';
    // Dragging a card (wireCardDragAndDrop) has no keyboard equivalent of its
    // own: a keyboard/screen-reader user could open the card's own detail
    // modal and hunt inside it for the stage-move generator, but nothing on
    // the card face offered the same one-step "prep this move" shortcut a
    // mouse drag does. This select is that keyboard-operable equivalent,
    // wired to the exact same openModalForStageMove a drop already calls.
    const moveOptions = allStages.filter(s => s.id !== p.stage)
      .map(s => '<option value="' + escapeHtml(s.id) + '">' + escapeHtml(s.label) + '</option>')
      .join('');
    return '<div class="card-wrap">' +
      '<button class="card' + (info && info.isStale ? ' card-stale' : '') + '" draggable="true" data-prospect-id="' + escapeHtml(p.id) + '">' +
      '<div class="card-name">' + escapeHtml(p.name) + '</div>' +
      '<div class="card-company">' + escapeHtml(p.company || 'Company not logged') + '</div>' +
      '<div class="card-meta">' + nudgeCardBadge(p, nudgeUrgencyById) + categoryBadge + channelBadge(p.contactChannel) + stallBadge + touchBadge + '</div>' +
      nextActionLine +
      '</button>' +
      '<div class="card-move-row">' +
      '<label class="sr-only" for="cardMove-' + escapeHtml(p.id) + '">Move ' + escapeHtml(p.name) + ' to a different stage (keyboard alternative to dragging)</label>' +
      '<select class="card-move" id="cardMove-' + escapeHtml(p.id) + '" data-move-prospect-id="' + escapeHtml(p.id) + '">' +
      '<option value="" selected>Move to stage&hellip;</option>' +
      moveOptions +
      '</select>' +
      '</div>' +
      '</div>';
  }

  let byId = {};
  let allStages = [];
  let allProspects = [];
  let rawStagesData = null;
  let rawProspectsData = null;
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
  // Must match the header `key`s in renderBoardList's `headers` array.
  const VALID_SORT_KEYS = ['name', 'stage', 'category', 'channel', 'nextNudge', 'stalled', 'lastTouch'];

  function restoreStateFromUrl() {
    const params = new URLSearchParams(location.search);
    const q = params.get('q');
    const channel = params.get('channel');
    const category = params.get('category');
    const view = params.get('view');
    const prospect = params.get('prospect');
    const sort = params.get('sort');
    const dir = params.get('dir');
    if (q) searchInput.value = q;
    if (channel && VALID_CHANNELS.includes(channel)) channelFilter = channel;
    if (category) categoryFilter = category;
    if (view === 'list') viewMode = 'list';
    if (prospect) initialProspectId = prospect;
    // List view's column sort was previously local-only state: switching to
    // List, sorting by a column, then using "Copy link to this view" (which
    // every other filter/view choice here already survives) silently lost
    // the sort the moment someone else opened that link.
    if (sort && VALID_SORT_KEYS.includes(sort)) listSortKey = sort;
    if (dir === 'asc' || dir === 'desc') listSortDir = dir;
  }

  function syncUrl() {
    const params = new URLSearchParams();
    const query = searchInput.value.trim();
    if (query) params.set('q', query);
    if (channelFilter !== 'all') params.set('channel', channelFilter);
    if (categoryFilter !== 'all') params.set('category', categoryFilter);
    if (viewMode === 'list') params.set('view', 'list');
    if (openProspectId) params.set('prospect', openProspectId);
    if (viewMode === 'list' && (listSortKey !== 'nextNudge' || listSortDir !== 'asc')) {
      params.set('sort', listSortKey);
      params.set('dir', listSortDir);
    }
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
      (p.replyStatus || '').toLowerCase().includes(query) ||
      (p.nextAction || '').toLowerCase().includes(query) ||
      (p.contactChannel && (p.contactChannel.detail || '').toLowerCase().includes(query)) ||
      (p.socialSnapshots || []).some(snap => (snap.platform || '').toLowerCase().includes(query)) ||
      (p.contentIdeas || []).some(entry => (entry.idea || '').toLowerCase().includes(query)) ||
      (p.outreachLog || []).some(entry => (entry.note || '').toLowerCase().includes(query));
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

  // csvField now lives in csm-core.js, same shared-core-with-tests pattern
  // as the other pure math above (locks in its formula-injection guard).
  const CSV_COLUMNS = [
    ['name', 'Name'], ['company', 'Company'], ['category', 'Category'],
    ['stage', 'Stage'], ['stageEnteredDate', 'Stage Entered'],
    ['verifiedHook', 'Verified Hook'],
    ['channelType', 'Contact Channel Type'], ['channelDetail', 'Contact Channel Detail'],
    ['sendDate', 'Send Date'], ['nextNudgeDate', 'Next Nudge Date'], ['nextAction', 'Next Action'],
    ['doNotNudgeBefore', 'Do Not Nudge Before'], ['nudgePoint', 'Nudge Point'],
    ['replyStatus', 'Reply Status'],
    ['socialSnapshots', 'Social Snapshots'],
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
      socialSnapshots: (p.socialSnapshots || [])
        .map(snap => (snap.platform || 'Platform not logged') +
          (snap.followers != null ? ': ' + snap.followers + ' followers' : '') +
          (snap.engagementRate != null ? ', ' + snap.engagementRate + '% engagement' : '') +
          (snap.asOfDate ? ' (as of ' + snap.asOfDate + ')' : ' (no as-of date)'))
        .join('; '),
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

  // Same real, documented per-platform contact mechanics as the "Platform
  // outreach reference" table in index.html (Xingtu, Pugongying, Weirenwu,
  // Huahuo, WeChat's lack of one, Magnetic Juxing), condensed to the one line
  // that matters for an outreach brief: where a real contact actually is, not
  // just the platform's own marketplace. Keyed lowercase/trimmed so "Douyin"
  // and "douyin " both match, same normalization findCasingDrift already uses.
  const PLATFORM_TIPS = {
    douyin: 'Xingtu is a generic marketplace inbox that gets flooded. A named decision-maker, reached directly or via a listed business email, is still the higher-reply-rate path.',
    xiaohongshu: 'Pugongying only confirms the account already does paid work, it is not itself a contact. Look for a listed business email or named contact in the bio first.',
    weibo: 'Weirenwu is geared toward macro-influencer/celebrity deals. For a smaller or niche account, a personal contact or email in the bio is more realistic.',
    bilibili: 'Huahuo is mandatory for disclosure compliance, not itself a contact. The real contact is whoever runs the account or their listed agent.',
    wechat: 'No centralized marketplace exists. Outreach is direct: a personal WeChat ID or a listed business-cooperation email on an Official Account profile. Named vs. generic matters most here.',
    kuaishou: 'Magnetic Juxing is a generic marketplace inbox, same pattern as Xingtu on Douyin. A named decision-maker, reached directly or via a listed business email, is still the higher-reply-rate path.'
  };
  function platformTip(platform) {
    if (!platform) return null;
    return PLATFORM_TIPS[platform.trim().toLowerCase()] || null;
  }

  // Pulls everything needed to actually draft a real message to one prospect
  // into a single copyable block: the hook, the channel (and its matching
  // platform-specific contact guidance above), every logged social snapshot
  // with its honest as-of/staleness label, and the current next action, so
  // none of it has to be re-found by re-opening this modal mid-draft. Reuses
  // only what the modal already renders from real logged fields, never
  // invents a subject line or message body, that would cross from a planning
  // tool into a send tool.
  function buildProspectBriefText(p, stages) {
    const stageById = Object.fromEntries(stages.map(s => [s.id, s]));
    const lines = [];
    lines.push('OUTREACH BRIEF - ' + p.name + (p.company ? ' (' + p.company + ')' : '') + ' - generated ' + fmtDate(todayIso()));
    lines.push('');

    const stageDef = stageById[p.stage];
    const stall = stallInfo(p, stageById);
    lines.push('STAGE: ' + (stageDef ? stageDef.label : p.stage) +
      (p.stageEnteredDate
        ? (isValidDateStr(p.stageEnteredDate)
          ? ' (entered ' + fmtDate(p.stageEnteredDate) + ', ' + daysSince(p.stageEnteredDate) + 'd in stage' +
            (stall && stall.isStale ? ', STALLED past ' + stall.staleAfterDays + 'd threshold' : '') + ')'
          : ' (stage entered date "' + p.stageEnteredDate + '" does not parse, fix the format)')
        : ' (stage entered date not logged)'));
    lines.push('CATEGORY: ' + (p.category || 'Not logged yet'));
    lines.push('VERIFIED HOOK: ' + (p.verifiedHook || 'Not logged yet, do not send until this is a real, checked reason.'));
    lines.push('');

    const channel = p.contactChannel || {};
    const channelLabel = channel.type === 'named-decision-maker' ? 'NAMED DECISION-MAKER'
      : channel.type === 'generic-inbox' ? 'GENERIC INBOX' : 'NOT LOGGED';
    lines.push('CONTACT CHANNEL: ' + channelLabel + (channel.detail ? ' - ' + channel.detail : ''));
    if (channel.type === 'generic-inbox') {
      lines.push('  Generic inbox has historically been this project\'s lowest real reply rate, a named decision-maker is worth another look before sending.');
    }
    const tips = new Set();
    (p.socialSnapshots || []).forEach(snap => {
      const tip = platformTip(snap.platform);
      if (tip) tips.add((snap.platform.trim()) + ': ' + tip);
    });
    tips.forEach(t => lines.push('  ' + t));
    lines.push('');

    lines.push('SOCIAL SNAPSHOTS (one-time manual research, never live):');
    const snaps = (p.socialSnapshots || []).slice().sort((a, b) => (b.asOfDate || '').localeCompare(a.asOfDate || ''));
    if (snaps.length) {
      snaps.forEach(snap => {
        const staleInfo = socialSnapshotStaleInfo(snap);
        const parts = [snap.platform || 'Platform not logged'];
        const followersLabel = formatFollowers(snap);
        if (followersLabel) parts.push(followersLabel);
        if (snap.engagementRate != null) parts.push(snap.engagementRate + '% engagement');
        const asOf = snap.asOfDate
          ? 'as of ' + fmtDate(snap.asOfDate) + (staleInfo ? ', ' + staleInfo.days + 'd old, DUE FOR REFRESH' : '')
          : 'no as-of date logged';
        lines.push('  - ' + parts.join(', ') + ' (' + asOf + ')');
      });
    } else {
      lines.push('  None logged yet.');
    }
    lines.push('');

    lines.push('REPLY STATUS: ' + (p.replyStatus || 'Not logged yet'));
    lines.push('NEXT ACTION: ' + (p.nextAction || 'Not logged yet') +
      (p.nextNudgeDate ? ' (next nudge ' + fmtDate(p.nextNudgeDate) + ')' : ''));
    const ns = p.nudgeSchedule || {};
    if (ns.doNotNudgeBefore || ns.nudgePoint) {
      lines.push('NUDGE SCHEDULE: ' +
        [
          ns.doNotNudgeBefore ? 'do not nudge before ' + fmtDate(ns.doNotNudgeBefore) : null,
          ns.nudgePoint ? 'nudge point ' + fmtDate(ns.nudgePoint) : null
        ].filter(Boolean).join(', '));
    }
    lines.push('');

    lines.push('RECENT CONTENT IDEAS:');
    const ideas = (p.contentIdeas || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 5);
    if (ideas.length) {
      ideas.forEach(entry => lines.push('  - ' + (entry.date ? fmtDate(entry.date) + ': ' : '') + entry.idea));
    } else {
      lines.push('  None logged yet.');
    }
    lines.push('');

    lines.push('Prep reference only, copied locally, nothing here has been sent. Re-check the hook, channel, and ' +
      'reply status above are still accurate before writing or sending any real message.');
    return lines.join('\n');
  }

  // Plain-text digest for pasting into a notes app, journal, or a message to
  // yourself, not the tool itself: there is no backend to check the pipeline
  // from anywhere but this page, so this is the fastest way to carry today's
  // real state (stage counts, what needs attention, what's actually due)
  // somewhere else for a moment. Builds only from data already computed for
  // the sections above, never a separate read of the raw JSON, so it can't
  // drift out of sync with what the page itself shows.
  function buildSnapshotText(stages, prospects) {
    const stageById = Object.fromEntries(stages.map(s => [s.id, s]));
    const lines = [];
    lines.push('CSM PIPELINE SNAPSHOT - ' + todayIso());
    lines.push(prospects.length + ' prospect' + (prospects.length === 1 ? '' : 's') + ' total');
    lines.push('');
    lines.push('STAGE COUNTS');
    stages.forEach(s => {
      const count = prospects.filter(p => p.stage === s.id).length;
      lines.push('  ' + s.label + ': ' + count);
    });

    const nudgeRows = computeNudgeRows(prospects);
    const overdue = nudgeRows.filter(r => !r.badDate && r.days <= 0);
    const stalled = computeStalled(stages, prospects);
    const coldSignal = computeColdSignal(prospects);
    const backfill = computeDataQualityFlags(stages, prospects);
    const duplicates = CSMValidateCore.findDuplicateProspects(prospects);

    lines.push('');
    lines.push('NEEDS ATTENTION');
    const attentionLines = [];
    if (overdue.length) attentionLines.push('  ' + overdue.length + ' nudge' + (overdue.length === 1 ? '' : 's') + ' due or overdue');
    if (stalled.length) attentionLines.push('  ' + stalled.length + ' prospect' + (stalled.length === 1 ? '' : 's') + ' stalled in stage');
    if (coldSignal.active.length) attentionLines.push('  ' + coldSignal.active.length + ' prospect' + (coldSignal.active.length === 1 ? '' : 's') + ' may need a new approach');
    if (backfill.length) attentionLines.push('  ' + backfill.length + ' prospect' + (backfill.length === 1 ? '' : 's') + ' needs backfill');
    if (duplicates.length) attentionLines.push('  ' + duplicates.length + ' possible duplicate group' + (duplicates.length === 1 ? '' : 's'));
    lines.push(...(attentionLines.length ? attentionLines : ['  Nothing needs attention right now.']));
    if (coldSignal.parked.length) {
      lines.push('  (' + coldSignal.parked.length + ' more parked for a scheduled re-engagement, not urgent)');
    }

    lines.push('');
    lines.push('NUDGE QUEUE');
    if (nudgeRows.length) {
      nudgeRows.forEach(({ p, days, unqueued, badDate }) => {
        let when;
        if (badDate) when = 'bad date logged';
        else if (unqueued) when = Math.abs(days) + 'd past planned nudge point, not queued';
        else if (days < 0) when = Math.abs(days) + 'd overdue';
        else if (days === 0) when = 'today';
        else when = 'in ' + days + 'd';
        const action = p.nextAction ? ' - ' + p.nextAction : '';
        lines.push('  ' + p.name + (p.company ? ' (' + p.company + ')' : '') + ': ' + when + action);
      });
    } else {
      lines.push('  Nothing on the nudge queue.');
    }

    lines.push('');
    lines.push('IN EXPLORATION / CLIENT');
    const active = prospects.filter(p => p.stage === 'in-exploration' || p.stage === 'client');
    if (active.length) {
      active.forEach(p => {
        lines.push('  ' + p.name + (p.company ? ' (' + p.company + ')' : '') + ' - ' +
          ((stageById[p.stage] && stageById[p.stage].label) || p.stage));
      });
    } else {
      lines.push('  None yet.');
    }

    lines.push('');
    lines.push('SOCIAL REACH BY PLATFORM');
    const reach = computeSocialReach(prospects);
    if (reach.length) {
      reach.forEach(r => {
        const followers = r.hasFollowers ? r.totalFollowers.toLocaleString() + ' followers' : 'no follower counts logged';
        lines.push('  ' + r.platform + ': ' + r.prospectCount + ' prospect' + (r.prospectCount === 1 ? '' : 's') +
          ' tracked, ' + followers);
      });
    } else {
      lines.push('  No social snapshots logged yet.');
    }

    lines.push('');
    lines.push('Exported from Command Center CSM pipeline (/csm), local copy only, nothing sent anywhere.');
    return lines.join('\n');
  }

  snapshotBtn.addEventListener('click', () => {
    const original = snapshotBtn.textContent;
    copyText(buildSnapshotText(allStages, allProspects))
      .then(() => { snapshotBtn.textContent = 'Snapshot copied'; })
      .catch(() => { snapshotBtn.textContent = "Couldn't copy"; })
      .finally(() => { setTimeout(() => { snapshotBtn.textContent = original; }, 1800); });
  });

  // Full-fidelity backup: unlike the CSV export above, which flattens each
  // prospect to one row and drops stageHistory entirely, this keeps
  // prospects.json and stages.json exactly as loaded (including their
  // schemaVersion/note wrappers) so a bad hand-edit can be diffed against or
  // restored from a known-good copy. Local download only, nothing is sent
  // anywhere.
  backupBtn.addEventListener('click', () => {
    if (!rawProspectsData && !rawStagesData) return;
    const backup = {
      exportedAt: new Date().toISOString(),
      source: 'Command Center CSM pipeline (/csm), local download only',
      prospectsJson: rawProspectsData,
      stagesJson: rawStagesData
    };
    downloadFile(JSON.stringify(backup, null, 2), 'csm-backup-' + todayIso() + '.json', 'application/json;charset=utf-8;');
  });

  // icsEscapeText and icsFoldLine now live in csm-core.js, same
  // shared-core-with-tests pattern as the other pure math above (locks in
  // icsFoldLine's UTF-8-byte-not-UTF-16-unit fold-point math).
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
      const touches = touchCount(p);
      if (touches > 0) descLines.push(touches + ' outreach touch' + (touches === 1 ? '' : 'es') + ' logged so far.');
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
    const ns = p.nudgeSchedule || {};
    const cc = p.contactChannel || {};
    return '<details class="schema-help">' +
      '<summary>Edit this prospect&rsquo;s details</summary>' +
      '<div class="schema-help-body">' +
      '<p>Generates this prospect&rsquo;s full updated record with whatever fields below you change. ' +
      '<code>id</code>, <code>stage</code>, <code>stageHistory</code>, <code>outreachLog</code>, ' +
      '<code>contentIdeas</code>, and <code>socialSnapshots</code> carry over unchanged, use the generators ' +
      'further down to touch those. To move ' +
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
  // Stage itself isn't editable from this form (that's the separate "stage
  // move" generator), so it always comes from the real, unedited p rather
  // than edited, merged in just for the shared missingContactChannelType/
  // missingVerifiedHook predicates below (same ones npBuildWarnings and
  // computeDataQualityFlags share) to read.
  function peBuildWarnings(p, edited) {
    const warnings = [];
    if (missingContactChannelType({ stage: p.stage, contactChannel: edited.contactChannel })) {
      warnings.push('Stage is "' + p.stage + '" but contact channel type is not logged. This is the single ' +
        'biggest driver of real reply rate, fill it in as soon as it is known.');
    }
    if (channelTypeLoggedWithNoDetail({ contactChannel: edited.contactChannel })) {
      warnings.push('Contact channel type is logged but contact channel detail (the actual email/handle/contact) ' +
        'is not. Knowing it is a named decision-maker is not useful without the real way to reach them.');
    }
    if (missingVerifiedHook({ stage: p.stage, verifiedHook: edited.verifiedHook })) {
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
    const categoryClash = findCategoryCasingClash(edited.category, allProspects.filter(x => x.id !== p.id));
    if (categoryClash) {
      warnings.push('Category "' + edited.category + '" differs in casing/spacing from existing category "' +
        categoryClash + '", they would render as separate filter chips. Pick one spelling.');
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
    const stageText = !p.stageEnteredDate
      ? 'Not logged yet'
      : !isValidDateStr(p.stageEnteredDate)
        ? 'Date logged as "' + escapeHtml(p.stageEnteredDate) + '" does not parse, fix the format (expected YYYY-MM-DD)'
        : 'Entered ' + fmtDate(p.stageEnteredDate) + ' &middot; ' + daysSince(p.stageEnteredDate) + ' days in this stage' +
          (stallEntry && stallEntry.isStale ? ' <span class="stalled-inline">(past the ' + stallEntry.staleAfterDays + '-day stall threshold)</span>' : '');
    rows.push(fieldRow('Time in stage', stageText, !p.stageEnteredDate));

    const ns = p.nudgeSchedule || {};
    const nudgeText = (ns.doNotNudgeBefore || ns.nudgePoint)
      ? [
          ns.doNotNudgeBefore ? 'Do not nudge before ' + fmtDate(ns.doNotNudgeBefore) : null,
          ns.nudgePoint ? 'Nudge point ' + fmtDate(ns.nudgePoint) : null
        ].filter(Boolean).join(' &middot; ')
      : 'Not scheduled yet';
    rows.push(fieldRow('Nudge schedule', nudgeText, !(ns.doNotNudgeBefore || ns.nudgePoint)));

    const snaps = (p.socialSnapshots || []).slice().sort((a, b) => (b.asOfDate || '').localeCompare(a.asOfDate || ''));
    const snapsHtml = snaps.length
      ? '<ul class="ideas-list">' + snaps.map(snap => {
          const snapStale = socialSnapshotStaleInfo(snap);
          const followersLabel = formatFollowers(snap);
          return '<li>' + escapeHtml(snap.platform || 'Platform not logged') +
            (followersLabel ? ', ' + followersLabel : '') +
            (snap.engagementRate != null ? ', ' + snap.engagementRate + '% engagement' : '') +
            '<span class="snapshot-tag' + (snapStale ? ' snapshot-tag-stale' : '') + '">' +
            (snap.asOfDate ? 'AS OF ' + fmtDate(snap.asOfDate).toUpperCase() + ', ONE-TIME MANUAL SNAPSHOT, NOT LIVE' : 'NO SNAPSHOT DATE LOGGED') +
            (snapStale ? ' &middot; ' + snapStale.days + 'D OLD, DUE FOR REFRESH' : '') +
            '</span></li>';
        }).join('') + '</ul>'
      : 'Not logged yet';
    rows.push(fieldRow('Social snapshots', snapsHtml + socialSnapshotGeneratorHtml(), snaps.length === 0));

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
    wireSocialSnapshotGenerator(p);
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
  // todayIso/addDaysIso/suggestedNudgeOffsetDays/rollToWeekdayIso (cold-
  // outreach cadence and weekend-rolling math) now live in csm-core.js
  // (destructured above), with regression coverage there.

  // The two fields this project has found most predictive of a real reply
  // (see the contact-channel callout in index.html). Warn right where
  // outreach is actually about to be logged as sent, not only after the
  // fact in the passive "Needs backfill" list further down the page.
  // outreachReadinessWarnings now lives in csm-core.js, same
  // shared-core-with-tests pattern as the other pure math above.
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
      '<div id="modalTouchSuggest" class="inline-gen-suggest" hidden>' +
      '<span class="field-label" style="margin:0">Suggested next nudge (a cadence guess, edit before using)</span>' +
      '<div class="inline-gen-row inline-gen-row-idea">' +
      '<label class="sr-only" for="modalTouchSuggestDate">Suggested next nudge date</label>' +
      '<input type="date" id="modalTouchSuggestDate" class="np-input inline-gen-date">' +
      '<label class="sr-only" for="modalTouchSuggestAction">Suggested next action</label>' +
      '<input type="text" id="modalTouchSuggestAction" class="np-input" placeholder="Next action">' +
      '</div>' +
      '<div class="np-output-head">' +
      '<span class="field-label" style="margin:0">Paste into this prospect\'s top-level fields</span>' +
      '<button type="button" id="modalTouchSuggestCopy" class="print-btn font-mono" aria-live="polite">Copy</button>' +
      '</div>' +
      '<pre class="np-output font-mono" id="modalTouchSuggestOutput"></pre>' +
      '</div>' +
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
      }
      if (stage !== p.stage) {
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
    const suggestEl = document.getElementById('modalTouchSuggest');
    const suggestDateInput = document.getElementById('modalTouchSuggestDate');
    const suggestActionInput = document.getElementById('modalTouchSuggestAction');
    const suggestOutputEl = document.getElementById('modalTouchSuggestOutput');
    function refreshSuggestOutput() {
      suggestOutputEl.textContent = JSON.stringify({
        nextNudgeDate: suggestDateInput.value || null,
        nextAction: suggestActionInput.value.trim() || null
      }, null, 2);
    }
    document.getElementById('modalTouchGenerate').addEventListener('click', () => {
      const type = typeSelect.value;
      const date = dateInput.value;
      const note = noteInput.value.trim();
      if (!date) {
        warnEl.hidden = false;
        warnEl.textContent = 'Pick the real date this touch actually happened first.';
        outputEl.textContent = '';
        resultEl.hidden = false;
        suggestEl.hidden = true;
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

      // Cadence suggestion for the touch AFTER this one, based on real
      // cold-outreach practice (widening follow-up gaps). This is a starting
      // guess only, both fields stay editable before copying, nothing here
      // is pasted automatically.
      const realTouchCount = log.filter(e => e && e.date).length;
      const thisTouchNumber = realTouchCount + 1;
      const nextTouchNumber = thisTouchNumber + 1;
      let suggestedDate = addDaysIso(date, suggestedNudgeOffsetDays(nextTouchNumber));
      const doNotNudgeBefore = p.nudgeSchedule && p.nudgeSchedule.doNotNudgeBefore;
      if (doNotNudgeBefore && isValidDateStr(doNotNudgeBefore) && doNotNudgeBefore > suggestedDate) {
        suggestedDate = doNotNudgeBefore;
      }
      suggestedDate = rollToWeekdayIso(suggestedDate);
      suggestDateInput.value = suggestedDate;
      suggestActionInput.value = nextTouchNumber > COLD_TOUCH_THRESHOLD
        ? 'Reconsider hook/channel before touch #' + nextTouchNumber + ', ' + thisTouchNumber + ' touches with no reply so far'
        : 'Send follow-up nudge (touch #' + nextTouchNumber + ')';
      refreshSuggestOutput();
      suggestEl.hidden = false;
    });
    wireCopyButton(document.getElementById('modalTouchCopy'), outputEl);
    suggestDateInput.addEventListener('change', refreshSuggestOutput);
    suggestActionInput.addEventListener('input', refreshSuggestOutput);
    wireCopyButton(document.getElementById('modalTouchSuggestCopy'), suggestOutputEl);
  }

  function socialSnapshotGeneratorHtml() {
    return '<div class="inline-gen">' +
      '<div class="inline-gen-row inline-gen-row-idea">' +
      '<label class="sr-only" for="modalSnapPlatform">Platform</label>' +
      '<input type="text" id="modalSnapPlatform" class="np-input" placeholder="Platform, e.g. Douyin">' +
      '<label class="sr-only" for="modalSnapFollowers">Followers</label>' +
      '<input type="number" min="0" id="modalSnapFollowers" class="np-input inline-gen-date" placeholder="Followers">' +
      '<label class="sr-only" for="modalSnapEngagement">Engagement %</label>' +
      '<input type="number" min="0" step="0.1" id="modalSnapEngagement" class="np-input inline-gen-date" placeholder="Engagement %">' +
      '</div>' +
      '<div class="inline-gen-row inline-gen-row-idea">' +
      '<label class="sr-only" for="modalSnapDate">As-of date (when actually pulled)</label>' +
      '<input type="date" id="modalSnapDate" class="np-input inline-gen-date">' +
      '<button type="button" id="modalSnapGenerate" class="print-btn font-mono">+ Log social snapshot</button>' +
      '</div>' +
      '<div id="modalSnapResult" class="inline-gen-result" hidden>' +
      '<div class="inline-gen-warn" id="modalSnapWarn" hidden></div>' +
      '<div class="np-output-head">' +
      '<span class="field-label" style="margin:0">Paste into <code>socialSnapshots</code></span>' +
      '<button type="button" id="modalSnapCopy" class="print-btn font-mono" aria-live="polite">Copy</button>' +
      '</div>' +
      '<pre class="np-output font-mono" id="modalSnapOutput"></pre>' +
      '</div></div>';
  }

  function wireSocialSnapshotGenerator(p) {
    const platformInput = document.getElementById('modalSnapPlatform');
    const followersInput = document.getElementById('modalSnapFollowers');
    const engagementInput = document.getElementById('modalSnapEngagement');
    const dateInput = document.getElementById('modalSnapDate');
    dateInput.value = todayIso();
    const resultEl = document.getElementById('modalSnapResult');
    const warnEl = document.getElementById('modalSnapWarn');
    const outputEl = document.getElementById('modalSnapOutput');
    document.getElementById('modalSnapGenerate').addEventListener('click', () => {
      const platform = platformInput.value.trim();
      const followers = followersInput.value.trim();
      const engagementRate = engagementInput.value.trim();
      const asOfDate = dateInput.value;
      if (!platform) {
        warnEl.hidden = false;
        warnEl.textContent = 'Name the real platform this snapshot is from (e.g. Douyin, Xiaohongshu, Weibo).';
        outputEl.textContent = '';
        resultEl.hidden = false;
        return;
      }
      if ((followers || engagementRate) && !asOfDate) {
        warnEl.hidden = false;
        warnEl.textContent = 'Pick the real date these numbers were actually pulled, never shown as if live.';
        outputEl.textContent = '';
        resultEl.hidden = false;
        return;
      }
      const existing = (p.socialSnapshots || []).find(s =>
        (s.platform || '').trim().toLowerCase() === platform.toLowerCase());
      const warn = existing
        ? 'A snapshot for "' + existing.platform + '" is already logged for this prospect. This adds a second ' +
          'entry for the same platform rather than replacing it, remove the stale one by hand if this is meant ' +
          'to be a refresh, not a second platform.'
        : '';
      warnEl.hidden = !warn;
      warnEl.textContent = warn;
      const entry = {
        platform,
        followers: followers ? Number(followers) : null,
        engagementRate: engagementRate ? Number(engagementRate) : null,
        asOfDate: asOfDate || null
      };
      outputEl.textContent = JSON.stringify(entry, null, 2) + ',';
      resultEl.hidden = false;
    });
    wireCopyButton(document.getElementById('modalSnapCopy'), outputEl);
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
    if (!modalOverlay.hidden || shortcutsOpen || e.key !== '/' || document.activeElement.id === 'searchInput') return;
    e.preventDefault();
    searchInput.focus();
  });

  let shortcutsOpen = false;
  let shortcutsLastFocusedEl = null;

  // Only the shortcuts this page actually wires up, never an invented or
  // aspirational one -- same "?" convention as GitHub/Gmail/Linear, and the
  // same overlay the main Command Center dashboard, CGT, and Garage hubs
  // already added.
  const SHORTCUTS = [
    { keys: ['/'], label: 'Focus search' },
    { keys: ['Enter', 'Space'], label: 'Open the focused prospect card, or activate a focused list column header to sort' },
    { keys: ['Tab'], label: 'Cycle focus inside an open dialog' },
    { keys: ['Esc'], label: 'Close the open dialog' },
    { keys: ['?'], label: 'Show this help' }
  ];

  function renderShortcutsList() {
    document.getElementById('shortcutsList').innerHTML = SHORTCUTS.map(s => `
      <div class="shortcut-row">
        <span class="shortcut-label">${escapeHtml(s.label)}</span>
        <span class="shortcut-keys">${s.keys.map(k => `<kbd class="shortcut-key">${escapeHtml(k)}</kbd>`).join('<span class="shortcut-label">or</span>')}</span>
      </div>
    `).join('');
  }

  function getShortcutsFocusable() {
    return Array.from(document.getElementById('shortcutsModal').querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )).filter(el => !el.hasAttribute('disabled') && el.offsetParent !== null);
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

  // "?" opens the shortcuts overlay, but never while the user is actually
  // typing a "?" character into a real field (search box, the new-prospect
  // form, or a prospect's edit form all take free text).
  document.addEventListener('keydown', e => {
    if (e.key !== '?') return;
    if (!modalOverlay.hidden || !npOverlay.hidden || shortcutsOpen) return;
    const active = document.activeElement;
    const tag = active && active.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (active && active.isContentEditable)) return;
    e.preventDefault();
    openShortcuts();
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

  // Same open prospect, compiled into a draft-ready brief instead of just a
  // link back to this modal. openProspectId is kept in sync by openModal, so
  // this always reads whichever prospect is currently open.
  const MODAL_BRIEF_LABEL = modalBriefBtn.textContent;
  modalBriefBtn.addEventListener('click', () => {
    const p = byId[openProspectId];
    if (!p) return;
    copyText(buildProspectBriefText(p, allStages))
      .then(() => { modalBriefBtn.textContent = 'Brief copied'; })
      .catch(() => { modalBriefBtn.textContent = "Couldn't copy"; })
      .finally(() => {
        setTimeout(() => { modalBriefBtn.textContent = MODAL_BRIEF_LABEL; }, 1800);
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
  // The 400ms debounce above means a value typed right before a reload or
  // tab close can be lost before it ever reaches localStorage, defeating
  // the whole point of this guard. visibilitychange (hidden) is the last
  // reliably-fired lifecycle event on both desktop and mobile, pagehide
  // covers same-tab navigation; unload/beforeunload are deprecated and
  // increasingly unreliable, so neither is used here.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { clearTimeout(npDraftSaveTimer); npSaveDraft(); }
  });
  window.addEventListener('pagehide', () => { clearTimeout(npDraftSaveTimer); npSaveDraft(); });

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
    const v = f => escapeHtml(values[f] || '');
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
        // The remove button itself has focus when clicked, and rowEl.remove()
        // below detaches it along with the whole row, dropping keyboard/
        // screen-reader focus to <body> with no indication of where the row
        // went. Move focus to the equivalent field on whichever row takes
        // this one's place (the next row, or the previous row if this was
        // last) before removing it, same "never let focus fall off the edge"
        // rule the modal's own open/close already follows.
        const nextRow = rowEl.nextElementSibling || rowEl.previousElementSibling;
        const focusTarget = nextRow ? nextRow.querySelector('input[data-field="name"]') : npQuickAddRowBtn;
        rowEl.remove();
        if (focusTarget) focusTarget.focus();
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

  // Real usage is pasting straight out of a research spreadsheet, not typing
  // one candidate at a time. Tab-separated columns and newline-separated
  // rows are the format every spreadsheet app (Sheets, Excel, Numbers) puts
  // on the clipboard, so a paste containing either is spread across
  // rows/columns starting at the focused cell, same convention as pasting
  // into a spreadsheet or any grid-based bulk-add screen, instead of the
  // whole blob landing in one field. A plain single-value paste (no tab, no
  // newline) is left to the browser's default paste behavior.
  function npQuickHandlePaste(e) {
    const target = e.target;
    if (!target || !target.matches('[data-field]')) return;
    const text = (e.clipboardData || window.clipboardData).getData('text');
    if (!text || (!text.includes('\n') && !text.includes('\t'))) return;
    e.preventDefault();
    const lines = text.split(/\r\n|\r|\n/);
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    if (!lines.length) return;
    const startFieldIndex = NP_QUICK_ROW_FIELDS.indexOf(target.getAttribute('data-field'));
    const rows = Array.from(npQuickRowsEl.querySelectorAll('[data-quick-row]'));
    const startRowIndex = rows.indexOf(target.closest('[data-quick-row]'));
    let lastInput = target;
    lines.forEach((line, i) => {
      let rowEl = rows[startRowIndex + i];
      if (!rowEl) {
        rowEl = npQuickAddRow();
        rows.push(rowEl);
      }
      line.split('\t').forEach((col, j) => {
        const field = NP_QUICK_ROW_FIELDS[startFieldIndex + j];
        if (!field) return;
        const input = rowEl.querySelector('[data-field="' + field + '"]');
        if (input) { input.value = col.trim(); lastInput = input; }
      });
    });
    lastInput.scrollIntoView({ block: 'nearest' });
    lastInput.focus();
    npQuickSaveDraft();
  }
  npQuickRowsEl.addEventListener('paste', npQuickHandlePaste);

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
  // Same debounce-loses-the-last-keystroke fix as the full new-prospect
  // form above: visibilitychange (hidden) is the last reliably-fired
  // lifecycle event on both desktop and mobile, pagehide covers same-tab
  // navigation.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { clearTimeout(npQuickDraftSaveTimer); npQuickSaveDraft(); }
  });
  window.addEventListener('pagehide', () => { clearTimeout(npQuickDraftSaveTimer); npQuickSaveDraft(); });

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
      const slugResult = slugifyProspectId(name, company);
      const baseId = slugResult.id;
      const { id, isDuplicateId } = nextAvailableId(baseId, seenIdsThisBatch);
      seenIdsThisBatch.add(id);

      const warnings = [];
      if (isDuplicateId) {
        warnings.push('An id starting with "' + baseId + '" already exists, this one was suffixed to "' + id +
          '" to avoid a duplicate. Rename it to something more readable if you want.');
      }
      if (slugResult.collapsedFromRealInput) {
        warnings.push('Name/company had no [a-z0-9] characters to build a real id from (e.g. a Chinese-only ' +
          'name), so this defaulted to the generic id "' + id + '". Hand-edit the "id" field below to something ' +
          'more readable (a romanized version of the name works well) before pasting this in.');
      }
      const nameKey = name.trim().toLowerCase() + '|' + (company || '').trim().toLowerCase();
      const existingMatch = findProspectByNameCompany(name, company, allProspects);
      if (existingMatch) {
        warnings.push('An existing entry already has this same name and company ("' + existingMatch.name +
          (existingMatch.company ? ', ' + existingMatch.company : '') + '", id "' + existingMatch.id +
          '"). If this is really the same person, edit that entry instead of adding a second one.');
      } else if (seenKeysThisBatch.has(nameKey)) {
        warnings.push('Another row in this same batch already has this name and company ("' + name +
          (company ? ', ' + company : '') + '"). If this is really the same person, remove the duplicate row.');
      }
      seenKeysThisBatch.set(nameKey, id);
      const categoryClash = findCategoryCasingClash(category, allProspects);
      if (categoryClash) {
        warnings.push('Category "' + category + '" differs in casing/spacing from existing category "' + categoryClash +
          '", they would render as separate filter chips. Pick one spelling.');
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
        socialSnapshots: [],
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

  // slugifyProspectId/nextAvailableId (id generation and collision handling
  // for both this single-add form and the paste-a-batch quick-add above)
  // now live in csm-core.js, shared and tested the same way as the rest of
  // this file's extracted pure math.

  function npVal(id) {
    const v = document.getElementById(id).value.trim();
    return v === '' ? null : v;
  }

  // Mirrors the key rules in data/validate.js so a prospect generated here
  // is warned about the same things the validator would catch, before it
  // ever gets hand-pasted into prospects.json.
  function npBuildWarnings(p, isDuplicateId, collapsedFromRealInput) {
    const warnings = [];
    if (isDuplicateId) {
      warnings.push('An id starting with "' + p.id.replace(/-\d+$/, '') + '" already exists, this one was ' +
        'suffixed to "' + p.id + '" to avoid a duplicate. Rename it to something more readable if you want.');
    }
    if (collapsedFromRealInput) {
      warnings.push('Name/company had no [a-z0-9] characters to build a real id from (e.g. a Chinese-only ' +
        'name), so this defaulted to the generic id "' + p.id + '". Hand-edit the "id" field below to something ' +
        'more readable (a romanized version of the name works well) before pasting this in.');
    }
    if (missingContactChannelType(p)) {
      warnings.push('Stage is "' + p.stage + '" but contact channel type is not logged. This is the single ' +
        'biggest driver of real reply rate, fill it in as soon as it is known.');
    }
    if (channelTypeLoggedWithNoDetail(p)) {
      warnings.push('Contact channel type is logged but contact channel detail (the actual email/handle/contact) ' +
        'is not. Knowing it is a named decision-maker is not useful without the real way to reach them.');
    }
    if (missingVerifiedHook(p)) {
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
    if (missingFollowUpPlan(p)) {
      warnings.push('Stage is "' + p.stage + '" but nothing is scheduled, no next nudge date, nudge point, or ' +
        'do-not-nudge-before. Without one of those this prospect will not show up anywhere the board flags a ' +
        'follow-up as due, log a real plan even if it is just a rough one.');
    }
    (p.socialSnapshots || []).forEach(snap => {
      if ((snap.followers != null || snap.engagementRate != null) && !snap.asOfDate) {
        warnings.push('Social numbers for "' + (snap.platform || 'a platform') + '" are logged without an ' +
          'as-of date. Every social number on this board must be labeled with when it was actually pulled, ' +
          'never shown as if live.');
      }
      if (!snap.platform && (snap.followers != null || snap.engagementRate != null || snap.asOfDate)) {
        warnings.push('Social numbers or an as-of date are logged but the platform is not. Go back and fill in ' +
          'which platform this snapshot is for, these numbers cannot be attributed to anything without it.');
      }
    });
    const categoryClash = findCategoryCasingClash(p.category, allProspects);
    if (categoryClash) {
      warnings.push('Category "' + p.category + '" differs in casing/spacing from existing category "' + categoryClash +
        '", they would render as separate filter chips. Pick one spelling.');
    }
    const nameMatch = findProspectByNameCompany(p.name, p.company, allProspects);
    if (nameMatch) {
      warnings.push('An existing entry already has this same name and company ("' + nameMatch.name +
        (nameMatch.company ? ', ' + nameMatch.company : '') + '", id "' + nameMatch.id + '"). If this is really the same ' +
        'person, edit that entry instead of adding a second one.');
    }
    return warnings;
  }

  function npBuildProspect() {
    const name = npVal('npName');
    const company = npVal('npCompany');
    const stage = npStageSelect.value;
    const stageEnteredDate = npVal('npStageEnteredDate');
    const slugResult = slugifyProspectId(name || 'new-prospect', company);
    const baseId = slugResult.id;
    const { id, isDuplicateId } = nextAvailableId(baseId, Object.keys(byId));

    const socialPlatform = npVal('npSocialPlatform');
    const socialFollowers = npVal('npSocialFollowers');
    const socialEngagementRate = npVal('npSocialEngagementRate');
    const socialAsOfDate = npVal('npSocialAsOfDate');
    // Build the snapshot whenever ANY of the four fields has a real value, not
    // only when platform does: platform is the only one of the four marked
    // optional in its label, so leaving it blank is easy, and previously this
    // silently dropped real followers/engagement/as-of-date data with no
    // warning. validate.js's socialSnapshots checks never require platform
    // (only snap.platform || 'a platform' / 'platform not logged' fallbacks),
    // so a null platform is a legitimate shape here too.
    const hasSocialSnapshot = socialPlatform || socialFollowers != null ||
      socialEngagementRate != null || socialAsOfDate;

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
      socialSnapshots: hasSocialSnapshot ? [{
        platform: socialPlatform,
        followers: socialFollowers != null ? Number(socialFollowers) : null,
        engagementRate: socialEngagementRate != null ? Number(socialEngagementRate) : null,
        asOfDate: socialAsOfDate
      }] : [],
      contentIdeas: [],
      stageHistory: stageEnteredDate ? [{ date: stageEnteredDate, stage }] : [],
      outreachLog: npVal('npSendDate') ? [{ date: npVal('npSendDate'), type: 'initial-send' }] : [],
      notes: npVal('npNotes')
    };
    return { p, isDuplicateId, collapsedFromRealInput: slugResult.collapsedFromRealInput };
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
    const { p, isDuplicateId, collapsedFromRealInput } = npBuildProspect();
    const warnings = npBuildWarnings(p, isDuplicateId, collapsedFromRealInput);
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
  // changelog.json is generated (see public/csm/data/changelog.js), not
  // hand-edited, and a fresh clone before anyone has run that script is a
  // real, expected state, not a load failure, so it gets its own settled
  // slot rather than joining the stages/prospects error handling below,
  // same as Sondrik's own changelog fetch.
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
    }),
    fetch('/csm/data/changelog.json').then(r => {
      if (!r.ok) throw new Error('changelog.json returned ' + r.status);
      return r.json();
    }),
    // Best-effort and independent of the changelog fetch itself (it can be
    // unavailable, e.g. no git checkout, while the changelog still loads
    // fine), so a failure here never blocks rendering the changelog entries.
    fetch('/api/csm/changelog-status').then(r => r.ok ? r.json() : null).catch(() => null)
  ]).then(([stagesResult, prospectsResult, changelogResult, driftResult]) => {
    const driftStatus = driftResult.status === 'fulfilled' ? driftResult.value : null;
    renderChangelog(changelogResult.status === 'fulfilled' ? changelogResult.value : { entries: [] }, driftStatus);
    const stagesData = stagesResult.status === 'fulfilled' ? stagesResult.value.data : null;
    const prospectsData = prospectsResult.status === 'fulfilled' ? prospectsResult.value.data : null;
    allStages = (stagesData && stagesData.stages) || [];
    allProspects = (prospectsData && prospectsData.prospects) || [];
    byId = Object.fromEntries(allProspects.map(p => [p.id, p]));
    rawStagesData = stagesData;
    rawProspectsData = prospectsData;
    backupBtn.disabled = !stagesData && !prospectsData;
    backupBtn.title = backupBtn.disabled ? "Can't back up, pipeline data failed to load (see below)" : '';
    snapshotBtn.disabled = !stagesData && !prospectsData;
    snapshotBtn.title = snapshotBtn.disabled ? "Can't build a snapshot, pipeline data failed to load (see below)" : '';
    // Both read from data that is empty until this load settles (lastFiltered
    // for csvBtn, the rendered board itself for printBtn), so a click before
    // this point would silently export/print a blank pipeline instead of
    // erroring, same failure shape the backupBtn/snapshotBtn disabled state
    // above already guards against.
    csvBtn.disabled = !stagesData && !prospectsData;
    csvBtn.title = csvBtn.disabled ? "Can't export, pipeline data failed to load (see below)" : '';
    printBtn.disabled = !stagesData && !prospectsData;
    printBtn.title = printBtn.disabled ? "Can't print, pipeline data failed to load (see below)" : '';

    renderDataFreshness([stagesResult, prospectsResult]
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value.lastModified));

    const failures = [];
    if (stagesResult.status === 'rejected') failures.push('stages.json: ' + stagesResult.reason.message);
    if (prospectsResult.status === 'rejected') failures.push('prospects.json: ' + prospectsResult.reason.message);

    if (stagesData || prospectsData) {
      renderSnapshot(allStages, allProspects);
      renderAttentionBar(allStages, allProspects, driftStatus);
      renderNudgeQueue(allProspects);
      renderStats(allStages, allProspects);
      renderChannelFilterCounts(allProspects);
      renderCategoryFilter(allProspects);
      renderStalled(allStages, allProspects);
      renderColdSignal(allStages, allProspects);
      renderDuplicates(allProspects);
      renderCasingDrift(allProspects);
      renderDataQuality(allStages, allProspects);
      renderActivityFeed(allProspects, allStages);
      renderFunnel(allStages, allProspects);
      renderStageVelocity(allStages, allProspects);
      renderChannelEffectiveness(allProspects);
      renderCategoryEffectiveness(allProspects);
      renderSocialReach(allProspects);
      applyFilter();
      if (initialProspectId && byId[initialProspectId]) openModal(initialProspectId);
      if (failures.length) {
        boardEl.insertAdjacentHTML('afterbegin',
          '<div class="column-empty" role="alert">Showing partial data, failed to load: ' + failures.map(escapeHtml).join('; ') + '</div>');
      }
      // The generator's stage dropdown is built from allStages (npPopulateStageOptions),
      // so it needs stages.json specifically, not just any data, to be usable.
      const newProspectBtn = document.getElementById('newProspectBtn');
      newProspectBtn.disabled = !stagesData;
      newProspectBtn.title = stagesData ? '' : "Can't log a new prospect, stages.json failed to load (see the error above)";
    } else {
      document.getElementById('newProspectBtn').title = "Can't log a new prospect, pipeline data failed to load (see below)";
      boardEl.innerHTML = '<div class="column-empty" role="alert">Failed to load pipeline data: ' + failures.map(escapeHtml).join('; ') + '</div>';
      boardListEl.innerHTML = '<p class="board-list-empty" role="alert">Failed to load pipeline data: ' + failures.map(escapeHtml).join('; ') + '</p>';
      nudgeEl.innerHTML = '<p class="nudge-empty">Failed to load.</p>';
      activityFeedEl.innerHTML = '<p class="activity-empty" role="alert">Failed to load.</p>';
      funnelListEl.innerHTML = '<p class="funnel-empty" role="alert">Failed to load.</p>';
      velocityListEl.innerHTML = '<p class="velocity-empty" role="alert">Failed to load.</p>';
      channelEffListEl.innerHTML = '<p class="channel-eff-empty" role="alert">Failed to load.</p>';
      categoryEffListEl.innerHTML = '<p class="channel-eff-empty" role="alert">Failed to load.</p>';
      socialReachListEl.innerHTML = '<p class="channel-eff-empty" role="alert">Failed to load.</p>';
    }
  });

  // This device's own network path (navigator.onLine plus the real
  // online/offline events), a different question from whether the last fetch
  // succeeded: the service worker can serve a cached /data/*.json response
  // successfully while genuinely offline, so "the fetch resolved" is not
  // proof this page is current. Same banner Alpha already shows for the
  // same reason.
  function updateOfflineBanner() {
    const banner = document.getElementById('offlineBanner');
    if (banner) banner.hidden = navigator.onLine;
  }
  window.addEventListener('offline', updateOfflineBanner);
  window.addEventListener('online', updateOfflineBanner);
  updateOfflineBanner();
})();

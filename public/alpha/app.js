function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function timeAgo(iso) {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const diffMs = Date.now() - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours + 'h ago';
  const days = Math.floor(hours / 24);
  return days + 'd ago';
}

// Data-freshness convention: green under a minute, amber under 15 minutes,
// past that a live reading is old enough to call out rather than trust.
function freshnessClass(iso) {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'down';
  const mins = (Date.now() - then) / 60000;
  if (mins < 1) return 'live';
  if (mins < 15) return 'stale';
  return 'down';
}

// Glance indicators: this is a page Jack checks without switching to its tab,
// so the tab itself (favicon dot + title) should carry the same connection
// state as the on-page dot, using the same colors, rather than only being
// visible after clicking in.
const GLANCE_COLORS = { live: '#3DDC84', stale: '#E0A030', down: '#7B8188', error: '#E05050' };
const GLANCE_TEXT = {
  live: 'connected', stale: 'connected, stale', down: 'awaiting connection', error: 'error'
};

function updateGlanceIndicators(cls) {
  const favicon = document.getElementById('pageFavicon');
  if (favicon) {
    const color = GLANCE_COLORS[cls] || GLANCE_COLORS.down;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">` +
      `<circle cx="16" cy="16" r="13" fill="${color}"/></svg>`;
    favicon.href = 'data:image/svg+xml,' + encodeURIComponent(svg);
  }
  document.title = `Alpha (${GLANCE_TEXT[cls] || cls}) / Command Center`;
}

// The one glance-first signal at the very top of the page, above every
// detailed section. Derived entirely from fields the page already has
// (connection state, reading freshness, kill-switch state), never from
// anything invented. Kill switch engaged always wins: it is the one state
// Jack would want to see even from across the room.
function computeHeadline(data) {
  const live = data.live || {};
  const asOf = live.asOf;
  const killEngaged = live.killSwitch && live.killSwitch.engaged;

  if (killEngaged === true) {
    return { level: 'critical', text: 'KILL SWITCH ENGAGED' };
  }
  if (!data.connection.connected || !asOf) {
    return { level: 'awaiting', text: 'Awaiting live connection' };
  }
  const cls = freshnessClass(asOf);
  if (cls === 'down') return { level: 'awaiting', text: 'Connected, reading stale' };
  if (cls === 'stale') return { level: 'caution', text: 'Connected, reading aging' };
  return { level: 'good', text: 'Connected' };
}

function renderHeadline(level, text) {
  const el = document.getElementById('headlineStatus');
  el.className = 'headline-status ' + level;
  document.getElementById('headlineText').textContent = text;
}

function renderConnection(data) {
  const dot = document.getElementById('connDot');
  const label = document.getElementById('connLabel');
  const sub = document.getElementById('connSub');
  const asOf = data.live && data.live.asOf;

  if (!data.connection.connected || !asOf) {
    dot.className = 'conn-dot down';
    label.textContent = 'Not connected';
    sub.textContent = data.connection.note || 'No live feed configured yet.';
    updateGlanceIndicators('down');
    return;
  }

  const cls = freshnessClass(asOf);
  dot.className = 'conn-dot ' + cls;
  const age = timeAgo(asOf);
  label.textContent = cls === 'down'
    ? 'Connected, but last reading is old'
    : 'Connected';
  sub.textContent = 'Last reading: ' + (age || asOf);
  updateGlanceIndicators(cls);
}

function statTile(value, label, sub, awaiting) {
  return `
    <div class="stat-tile">
      <div class="stat-tile-value${awaiting ? ' awaiting' : ''}">${value}</div>
      <div class="stat-tile-label">${escapeHtml(label)}</div>
      ${sub ? `<div class="stat-tile-sub">${escapeHtml(sub)}</div>` : ''}
    </div>
  `;
}

function renderStats(data) {
  const sys = data.system;
  const live = data.live;
  const awaiting = '<span class="font-mono">awaiting connection</span>';

  const tiles = [];

  tiles.push(statTile(escapeHtml(String(sys.agentCount)), sys.agentKind, null, false));

  const killEngaged = live.killSwitch && live.killSwitch.engaged;
  tiles.push(statTile(
    killEngaged == null ? awaiting : (killEngaged ? 'ENGAGED' : 'Clear'),
    'Kill switch',
    killEngaged == null ? null : (live.killSwitch.lastTriggeredAt ? 'Last triggered ' + escapeHtml(live.killSwitch.lastTriggeredAt) : 'Never triggered'),
    killEngaged == null
  ));

  tiles.push(statTile(
    live.regime ? escapeHtml(live.regime) : awaiting,
    'Detected regime',
    null,
    !live.regime
  ));

  const debateActive = live.debatePanel && live.debatePanel.active;
  tiles.push(statTile(
    debateActive ? 'Active' : 'Pending',
    'Debate panel',
    debateActive ? null : 'Blocked on: ' + (live.debatePanel.blockedOn || 'unknown'),
    !debateActive
  ));

  document.getElementById('statRow').innerHTML = tiles.join('');
}

// Position sizing gets its own section rather than a stat tile because a
// drawdown reading is a magnitude on a fixed 0-100 scale, exactly what a
// meter communicates and a bare number doesn't: how much of the range is
// used up, at a glance. No color-coded thresholds here since this sandbox
// doesn't know Alpha's real risk thresholds, only the percentage itself.
function renderPositionSizing(data) {
  const ps = data.live.positionSizing || {};
  const panel = document.getElementById('positionSizingPanel');
  const mode = ps.activeMode;
  const pct = ps.currentDrawdownPct;
  const validPct = typeof pct === 'number' && Number.isFinite(pct) && pct >= 0 && pct <= 100;

  const modeHtml = `
    <div class="ps-mode">
      <div class="ps-field-label font-mono">ACTIVE MODE</div>
      <div class="ps-mode-value${mode ? '' : ' awaiting'}">${mode ? escapeHtml(mode) : 'awaiting connection'}</div>
      <div class="ps-mode-sub">Drawdown-based + robustness-based</div>
    </div>
  `;

  const meterHtml = validPct ? `
    <div class="ps-meter">
      <div class="ps-field-label font-mono">CURRENT DRAWDOWN</div>
      <div class="meter-track" role="meter" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"
        aria-label="Current drawdown, percent of range used">
        <div class="meter-fill" style="width:${pct}%"></div>
      </div>
      <div class="meter-value font-mono">${escapeHtml(String(pct))}%</div>
    </div>
  ` : `
    <div class="ps-meter">
      <div class="ps-field-label font-mono">CURRENT DRAWDOWN</div>
      <div class="meter-track meter-track-empty" role="meter" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100"
        aria-valuetext="awaiting connection" aria-label="Current drawdown, percent of range used"></div>
      <div class="meter-value awaiting font-mono">awaiting connection</div>
    </div>
  `;

  panel.innerHTML = modeHtml + meterHtml;
}

function renderArchitecture(data) {
  const grid = document.getElementById('archGrid');
  grid.innerHTML = data.system.features.map(f => `
    <div class="arch-card">
      <div class="arch-card-title">
        ${escapeHtml(f.label)}
        ${f.note ? '<span class="badge badge-pending">pending</span>' : '<span class="badge badge-active">built</span>'}
      </div>
      ${f.note ? `<div class="arch-card-note">${escapeHtml(f.note)}</div>` : ''}
    </div>
  `).join('');
}

function renderGenealogy(data) {
  const g = data.live.genealogy;
  const panel = document.getElementById('genealogyPanel');
  const hasAny = g && (g.generation != null || g.activeLineages != null || g.lastBreedingEventAt != null);
  if (!hasAny) return; // keep the built-in "awaiting live connection" empty state

  panel.classList.remove('empty-panel');
  panel.innerHTML = `
    <div class="stat-row">
      ${statTile(g.generation != null ? escapeHtml(String(g.generation)) : 'awaiting connection', 'Generation', null, g.generation == null)}
      ${statTile(g.activeLineages != null ? escapeHtml(String(g.activeLineages)) : 'awaiting connection', 'Active lineages', null, g.activeLineages == null)}
      ${statTile(g.lastBreedingEventAt ? escapeHtml(g.lastBreedingEventAt) : 'awaiting connection', 'Last breeding event', g.lastBreedingEventNote || null, !g.lastBreedingEventAt)}
    </div>
  `;
}

// A status-only page loses the "what changed and when" that makes a status
// page trustworthy over time, not just at the instant you look at it. This
// renders an honest activity log: kill-switch triggers, regime changes,
// connection state changes, whatever a future live feed appends to
// data.events. Empty today since this sandbox has no real history yet, not
// because the feature is unfinished.
function eventItem(evt) {
  const tone = ['good', 'alert'].includes(evt.tone) ? evt.tone : 'neutral';
  const age = timeAgo(evt.at);
  return `
    <li class="event-item">
      <span class="event-tag event-tag-${tone} font-mono">${escapeHtml(evt.type || 'event')}</span>
      <div class="event-body">
        <div class="event-label">${escapeHtml(evt.label)}</div>
        ${evt.detail ? `<div class="event-detail">${escapeHtml(evt.detail)}</div>` : ''}
      </div>
      <time class="event-time font-mono" datetime="${escapeHtml(evt.at)}">${escapeHtml(age || evt.at)}</time>
    </li>
  `;
}

function renderEventLog(data) {
  const log = document.getElementById('eventLog');
  const events = Array.isArray(data.events) ? data.events : [];

  if (!events.length) {
    log.classList.add('event-log-empty');
    log.innerHTML = `
      <li class="empty-panel">
        <div class="empty-panel-title font-mono">NO EVENTS RECORDED YET</div>
        <div class="empty-panel-sub">
          Once wired in, this logs kill-switch triggers, regime changes, and connection state changes as they
          happen, oldest at the bottom. Nothing to show from this sandbox yet.
        </div>
      </li>
    `;
    return;
  }

  log.classList.remove('event-log-empty');
  const sorted = [...events].sort((a, b) => new Date(b.at) - new Date(a.at));
  log.innerHTML = sorted.map(eventItem).join('');
}

// loadStatus() fires from three places with no natural ordering (page load,
// the 30s interval, and a manual refresh click), so a slower in-flight
// request can resolve after a newer one and silently repaint the page with
// stale data. A monotonic request id lets each call check it's still the
// most recent before rendering, and drop its result otherwise.
let latestStatusRequestId = 0;

async function loadStatus() {
  const requestId = ++latestStatusRequestId;
  try {
    // Cache-bust: this file is meant to change out from under the page
    // (a future session or export job rewrites it), a cached 304 would
    // make the glance view lie about how fresh the data is.
    const res = await fetch('/alpha/data/status.json?t=' + Date.now());
    if (!res.ok) throw new Error('Server returned ' + res.status);
    const data = await res.json();
    if (requestId !== latestStatusRequestId) return;
    const headline = computeHeadline(data);
    renderHeadline(headline.level, headline.text);
    renderConnection(data);
    renderStats(data);
    renderPositionSizing(data);
    renderArchitecture(data);
    renderGenealogy(data);
    renderEventLog(data);
  } catch (e) {
    if (requestId !== latestStatusRequestId) return;
    // Distinct from "down" (Alpha has no live feed yet, an expected,
    // unremarkable state): this is the page itself failing to read its own
    // status.json, a real problem worth standing out from the everyday
    // "awaiting connection" gray, not blending into it.
    renderHeadline('critical', "Page error, couldn't load status.json");
    document.getElementById('connDot').className = 'conn-dot error';
    document.getElementById('connLabel').textContent = "Couldn't load status.json";
    document.getElementById('connSub').textContent = e.message;
    updateGlanceIndicators('error');
  }
}

document.getElementById('refreshBtn').addEventListener('click', loadStatus);

// This is a glance-at-status page Jack checks without leaving Command
// Center, so it re-reads status.json on its own rather than requiring a
// manual reload. Purely a re-fetch of the same read-only file, paused
// while the tab is hidden so it never runs pointlessly in the background.
const REFRESH_INTERVAL_MS = 30000;
setInterval(() => {
  if (document.visibilityState === 'visible') loadStatus();
}, REFRESH_INTERVAL_MS);

loadStatus();

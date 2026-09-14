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

// Relative time ("3m ago") is fine for a glance but hides the one thing a
// reader needs the moment they actually stop to check it: whether this is
// 3 minutes from now or 3 minutes from an hour they already know is stale.
// Status-page UX guidance is consistent on this: a stale reading should
// carry an exact stamp, not only a relative one. Used as a hover title on
// the relative-time text rather than printed inline, so the page stays
// scannable while the exact moment is one hover away. Local time, since
// it's Jack looking at his own screen.
function formatAbsolute(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit'
  });
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
    return { level: 'critical', text: 'KILL SWITCH ENGAGED', asOf };
  }
  if (!data.connection.connected || !asOf) {
    return { level: 'awaiting', text: 'Awaiting live connection', asOf };
  }
  const cls = freshnessClass(asOf);
  if (cls === 'down') return { level: 'awaiting', text: 'Connected, reading stale', asOf };
  if (cls === 'stale') return { level: 'caution', text: 'Connected, reading aging', asOf };
  return { level: 'good', text: 'Connected', asOf };
}

function renderHeadline(level, text, asOf) {
  const el = document.getElementById('headlineStatus');
  el.className = 'headline-status ' + level;
  document.getElementById('headlineText').textContent = text;
  el.title = asOf ? 'Reading taken at ' + formatAbsolute(asOf) : '';
}

// Scans connection.history for the most recent entry that was actually
// connected, newest first. Real status pages surface "last seen" for a
// monitor that is currently down precisely because "not connected" alone
// doesn't say whether it just dropped or has never once come up; built only
// from real recorded checks, never estimated.
function mostRecentConnectedAt(history) {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i] && history[i].connected) return history[i].at;
  }
  return null;
}

// Statuspage/UptimeRobot-style incident duration: not just "last check was
// up/down" but how long the current state has held, e.g. "Down for 3h 12m".
// Derived by walking connection.history backward from the newest entry
// while its connected value keeps matching the current one, and taking the
// oldest such entry's timestamp as when the current streak began. Built
// only from real recorded checks; returns null (nothing shown) when there
// isn't enough history to derive it from, same honest-empty-state rule as
// everything else on this page.
function currentStateStartedAt(history, currentConnected) {
  if (!Array.isArray(history) || !history.length) return null;
  let startedAt = null;
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i];
    if (!entry || entry.connected !== currentConnected) break;
    startedAt = entry.at;
  }
  return startedAt;
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return null;
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'under 1m';
  if (mins < 60) return mins + 'm';
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours < 24) return hours + 'h' + (remMins ? ' ' + remMins + 'm' : '');
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return days + 'd' + (remHours ? ' ' + remHours + 'h' : '');
}

function renderConnection(data) {
  const dot = document.getElementById('connDot');
  const label = document.getElementById('connLabel');
  const sub = document.getElementById('connSub');
  const asOf = data.live && data.live.asOf;
  // connection.checkedAt is a distinct real field from live.asOf: it is when
  // connectivity itself was last probed, which can exist even with no live
  // reading yet. The schema-help table below documents it but nothing on the
  // page actually surfaced it, so "not connected" gave no sense of whether a
  // check had ever run versus one never being attempted.
  const checkedAt = data.connection && data.connection.checkedAt;
  const history = (data.connection && Array.isArray(data.connection.history)) ? data.connection.history : [];

  if (!data.connection.connected || !asOf) {
    dot.className = 'conn-dot down';
    label.textContent = 'Not connected';
    const lastConnectedAt = mostRecentConnectedAt(history);
    const downSince = currentStateStartedAt(history, false);
    const downDuration = downSince ? formatDuration(Date.now() - new Date(downSince).getTime()) : null;
    sub.textContent = data.connection.note || 'No live feed configured yet.';
    if (downDuration) {
      sub.textContent += ' · Down for ' + downDuration;
    }
    if (lastConnectedAt) {
      sub.textContent += ' · Last connected ' + (timeAgo(lastConnectedAt) || formatAbsolute(lastConnectedAt));
    }
    sub.title = (checkedAt
      ? 'Connectivity last checked ' + (timeAgo(checkedAt) || '') + ' (' + formatAbsolute(checkedAt) + ')'
      : 'Connectivity has never been checked yet.') +
      (downSince ? ' • Continuously not connected since ' + formatAbsolute(downSince) : '') +
      (lastConnectedAt ? ' • Last seen connected at ' + formatAbsolute(lastConnectedAt) : '');
    updateGlanceIndicators('down');
    return;
  }

  const cls = freshnessClass(asOf);
  dot.className = 'conn-dot ' + cls;
  const age = timeAgo(asOf);
  label.textContent = cls === 'down'
    ? 'Connected, but last reading is old'
    : 'Connected';
  const upSince = currentStateStartedAt(history, true);
  const upDuration = upSince ? formatDuration(Date.now() - new Date(upSince).getTime()) : null;
  sub.textContent = 'Last reading: ' + (age || asOf) + (upDuration ? ' · Connected for ' + upDuration : '');
  sub.title = 'Reading taken at ' + formatAbsolute(asOf) +
    (checkedAt ? ' • Connectivity last checked ' + formatAbsolute(checkedAt) : '') +
    (upSince ? ' • Continuously connected since ' + formatAbsolute(upSince) : '');
  updateGlanceIndicators(cls);
}

// Uptime-strip pattern (Statuspage, UptimeRobot, etc): a compact row of
// per-check ticks, oldest to newest, so a real history of connectivity
// checks is visible at a glance next to the current state, not just the
// latest reading. Built only from real connection.history entries; shows
// the honest "no checks recorded yet" placeholder otherwise, same as every
// other empty state on this page. Capped to the most recent 60 so the strip
// stays a glance, not a scroll.
const HISTORY_TICK_LIMIT = 60;

function renderConnectionHistory(data) {
  const strip = document.getElementById('connHistoryStrip');
  const summary = document.getElementById('connUptimeSummary');
  const history = (data.connection && Array.isArray(data.connection.history)) ? data.connection.history : [];

  if (!history.length) {
    strip.innerHTML = `<span class="conn-history-empty">No connectivity checks recorded yet.</span>`;
    summary.textContent = '';
    return;
  }

  const recent = history.slice(-HISTORY_TICK_LIMIT);
  strip.innerHTML = recent.map(entry => {
    const cls = entry.connected ? 'up' : 'down';
    const label = entry.connected ? 'Connected' : 'Not connected';
    const title = label + ' at ' + formatAbsolute(entry.at);
    return `<span class="history-tick ${cls}" title="${escapeHtml(title)}"></span>`;
  }).join('');

  // A per-check tick strip shows the shape of recent history but not its
  // overall rate, exactly what a single "X% uptime" summary communicates at
  // a glance, the same number every Statuspage/UptimeRobot-style page leads
  // with next to its history strip. Computed only from the same real,
  // already-recorded checks the ticks above are built from, over the same
  // window, never a separate or estimated figure.
  const upCount = recent.filter(e => e.connected).length;
  const pct = (upCount / recent.length) * 100;
  const pctText = Number.isInteger(pct) ? String(pct) : pct.toFixed(1);
  summary.textContent = `· ${pctText}% up (last ${recent.length} check${recent.length === 1 ? '' : 's'})`;
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
    killEngaged == null ? null : (live.killSwitch.lastTriggeredAt ? 'Last triggered ' + (timeAgo(live.killSwitch.lastTriggeredAt) || formatAbsolute(live.killSwitch.lastTriggeredAt)) : 'Never triggered'),
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
    // live.debatePanel itself, not just .active, is read again here (not
    // reused from debateActive above), since every other live.* sub-object
    // (killSwitch, positionSizing, genealogy) is allowed to be null/missing
    // per validate.js's own guards, and debatePanel was the one exception
    // that assumed it would always be present, which would throw the moment
    // it wasn't.
    debateActive ? null : 'Blocked on: ' + ((live.debatePanel && live.debatePanel.blockedOn) || 'unknown'),
    !debateActive
  ));

  document.getElementById('statRow').innerHTML = tiles.join('');
}

// Position sizing gets its own section rather than a stat tile because a
// drawdown reading is a magnitude on a fixed 0-100 scale, exactly what a
// meter communicates and a bare number doesn't: how much of the range is
// used up, at a glance. No color-coded thresholds here since this sandbox
// doesn't know Alpha's real risk thresholds, only the percentage itself.
// A single drawdown meter only ever shows the drop right now, which is the
// wrong number to trust a risk reading by: it can read low simply because
// equity just bounced off a much deeper trough. Real trading risk dashboards
// pair "current" with "max" (peak-to-trough) precisely so a shallow-looking
// current reading doesn't get mistaken for a shallow episode. Same 0-100
// meter treatment as current drawdown, same honest empty state, and its own
// schema field (positionSizing.maxDrawdownPct) rather than derived here,
// since only a real feed from Alpha knows the true historical peak.
function drawdownMeter(label, pct) {
  const validPct = typeof pct === 'number' && Number.isFinite(pct) && pct >= 0 && pct <= 100;
  if (!validPct) {
    return `
      <div class="ps-meter">
        <div class="ps-field-label font-mono">${escapeHtml(label)}</div>
        <div class="meter-track meter-track-empty" role="meter" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100"
          aria-valuetext="awaiting connection" aria-label="${escapeHtml(label)}, percent of range used"></div>
        <div class="meter-value awaiting font-mono">awaiting connection</div>
      </div>
    `;
  }
  return `
    <div class="ps-meter">
      <div class="ps-field-label font-mono">${escapeHtml(label)}</div>
      <div class="meter-track" role="meter" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"
        aria-label="${escapeHtml(label)}, percent of range used">
        <div class="meter-fill" style="width:${pct}%"></div>
      </div>
      <div class="meter-value font-mono">${escapeHtml(String(pct))}%</div>
    </div>
  `;
}

function renderPositionSizing(data) {
  const ps = data.live.positionSizing || {};
  const panel = document.getElementById('positionSizingPanel');
  const mode = ps.activeMode;

  const modeHtml = `
    <div class="ps-mode">
      <div class="ps-field-label font-mono">ACTIVE MODE</div>
      <div class="ps-mode-value${mode ? '' : ' awaiting'}">${mode ? escapeHtml(mode) : 'awaiting connection'}</div>
      <div class="ps-mode-sub">Drawdown-based + robustness-based</div>
    </div>
  `;

  panel.innerHTML = modeHtml +
    drawdownMeter('CURRENT DRAWDOWN', ps.currentDrawdownPct) +
    drawdownMeter('MAX DRAWDOWN (PEAK TO TROUGH)', ps.maxDrawdownPct);
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
      <time class="event-time font-mono" datetime="${escapeHtml(evt.at)}" title="${escapeHtml(formatAbsolute(evt.at))}">${escapeHtml(age || evt.at)}</time>
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

// A passive color change on the headline pill is easy to miss if this tab
// sits open in the background while the 30s auto-refresh keeps polling.
// Real trading-bot monitoring UIs surface a transient alert on state
// transitions (disconnects, threshold breaches) rather than relying only on
// a static indicator. This mirrors that with an in-page toast, purely
// informational, on the same real fields the headline pill already uses.
// Suppressed on the very first load so opening the page doesn't itself look
// like a state change.
let previousHeadlineLevel = null;

function showToast(level, text) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = 'toast toast-' + level;
  toast.setAttribute('role', level === 'critical' ? 'alert' : 'status');
  toast.innerHTML = `<span class="toast-text">${escapeHtml(text)}</span>` +
    `<button type="button" class="toast-close" aria-label="Dismiss">&times;</button>`;
  toast.querySelector('.toast-close').addEventListener('click', () => toast.remove());
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 8000);
}

function noteHeadlineForToast(level, text) {
  if (previousHeadlineLevel !== null && level !== previousHeadlineLevel) {
    showToast(level, 'Status changed: ' + text);
  }
  previousHeadlineLevel = level;
}

// Offline banner: navigator.onLine plus the real 'online'/'offline' window
// events are the browser's own signal for whether this device has a network
// path at all, a different question from whether Alpha is connected. This
// matters specifically because the service worker can resolve the
// status.json fetch below successfully from its cache while genuinely
// offline, so "the fetch succeeded" is not proof the page is current.
// lastLoadedAt tracks the last time loadStatus() actually completed (from
// cache or network alike) purely to give the banner an honest "as of" time,
// never a guess.
let lastLoadedAt = null;

function updateOfflineBanner() {
  const banner = document.getElementById('offlineBanner');
  if (!banner) return;
  const offline = !navigator.onLine;
  banner.hidden = !offline;
  if (offline) {
    const detail = document.getElementById('offlineBannerDetail');
    detail.textContent = lastLoadedAt
      ? `Showing the snapshot last loaded ${timeAgo(lastLoadedAt) || 'earlier'}; that may not reflect Alpha's current state.`
      : "Showing the last snapshot this device saw; that may not reflect Alpha's current state.";
  }
}

window.addEventListener('offline', updateOfflineBanner);
window.addEventListener('online', () => {
  updateOfflineBanner();
  showToast('good', 'Back online, refreshing status');
  loadStatus();
});

// loadStatus() fires from three places with no natural ordering (page load,
// the 30s interval, and a manual refresh click), so a slower in-flight
// request can resolve after a newer one and silently repaint the page with
// stale data. A monotonic request id lets each call check it's still the
// most recent before rendering, and drop its result otherwise.
let latestStatusRequestId = 0;

// Kept purely so the "Copy status" button below can build its plain-text
// summary from the same real data already on screen, never a second fetch
// or a separately maintained copy of it.
let lastStatusData = null;

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
    lastStatusData = data;
    document.getElementById('copyStatusBtn').disabled = false;
    lastLoadedAt = new Date().toISOString();
    updateOfflineBanner();
    const headline = computeHeadline(data);
    noteHeadlineForToast(headline.level, headline.text);
    renderHeadline(headline.level, headline.text, headline.asOf);
    renderConnection(data);
    renderConnectionHistory(data);
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
    noteHeadlineForToast('critical', "Page error, couldn't load status.json");
    renderHeadline('critical', "Page error, couldn't load status.json");
    document.getElementById('connDot').className = 'conn-dot error';
    document.getElementById('connLabel').textContent = "Couldn't load status.json";
    document.getElementById('connSub').textContent = e.message;
    updateGlanceIndicators('error');
  }
}

// Status-page UX guidance is consistent that a manual refresh action should
// show its own loading state, distinct from the data-freshness indicators
// elsewhere on the page: without it, a click on a same-origin fetch that
// resolves in a few milliseconds gives no feedback at all that anything
// happened, and a slower one (or a real future network hop once a live feed
// exists) looks like the click did nothing.
const refreshBtn = document.getElementById('refreshBtn');
const REFRESH_BTN_DEFAULT_TEXT = refreshBtn.textContent;
refreshBtn.addEventListener('click', async () => {
  refreshBtn.disabled = true;
  refreshBtn.textContent = 'Refreshing…';
  try {
    await loadStatus();
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.textContent = REFRESH_BTN_DEFAULT_TEXT;
  }
});

// "Copy status" gives Jack a one-click plain-text snapshot to paste
// elsewhere (a text, a Slack message) without a screenshot, a common
// pattern on status pages for sharing current state. Built only from the
// same fields already rendered on the page, in the same "awaiting
// connection" wording used everywhere else here, never a fresh guess.
function buildStatusSummary(data) {
  const headline = computeHeadline(data);
  const live = data.live || {};
  const ps = live.positionSizing || {};
  const awaiting = 'awaiting connection';
  const lines = [
    'Alpha status, ' + formatAbsolute(new Date().toISOString()),
    '- ' + headline.text + (headline.asOf ? ' (reading taken ' + formatAbsolute(headline.asOf) + ')' : ''),
    '- Kill switch: ' + (live.killSwitch && live.killSwitch.engaged != null ? (live.killSwitch.engaged ? 'ENGAGED' : 'Clear') : awaiting),
    '- Regime: ' + (live.regime || awaiting),
    '- Position sizing mode: ' + (ps.activeMode || awaiting),
    '- Current drawdown: ' + (typeof ps.currentDrawdownPct === 'number' ? ps.currentDrawdownPct + '%' : awaiting),
    '- Max drawdown (peak to trough): ' + (typeof ps.maxDrawdownPct === 'number' ? ps.maxDrawdownPct + '%' : awaiting),
    '- Debate panel: ' + ((live.debatePanel && live.debatePanel.active) ? 'Active' : 'Pending' + (live.debatePanel && live.debatePanel.blockedOn ? ' (' + live.debatePanel.blockedOn + ')' : '')),
  ];
  return lines.join('\n');
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // Fallback for a non-secure-context/older-browser view of this page,
  // where the Clipboard API is unavailable.
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

const copyStatusBtn = document.getElementById('copyStatusBtn');
const COPY_STATUS_BTN_DEFAULT_TEXT = copyStatusBtn.textContent;
copyStatusBtn.addEventListener('click', async () => {
  if (!lastStatusData) return;
  try {
    await copyTextToClipboard(buildStatusSummary(lastStatusData));
    copyStatusBtn.textContent = 'Copied';
    showToast('good', 'Status summary copied to clipboard');
  } catch (e) {
    copyStatusBtn.textContent = 'Copy failed';
    showToast('critical', "Couldn't copy status summary: " + e.message);
  } finally {
    setTimeout(() => { copyStatusBtn.textContent = COPY_STATUS_BTN_DEFAULT_TEXT; }, 2000);
  }
});

// This is a glance-at-status page Jack checks without leaving Command
// Center, so it re-reads status.json on its own rather than requiring a
// manual reload. Purely a re-fetch of the same read-only file, paused
// while the tab is hidden so it never runs pointlessly in the background.
const REFRESH_INTERVAL_MS = 30000;
setInterval(() => {
  if (document.visibilityState === 'visible') loadStatus();
}, REFRESH_INTERVAL_MS);

// The interval above only fires while the tab is visible, so a tab left
// hidden for a while (Jack tabs away, comes back) can show a reading up to
// a full interval stale at the moment he actually looks. Refetching the
// instant the tab regains visibility is what makes a glance-at-status page
// trustworthy the moment it is glanced at, rather than up to 30s behind.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') loadStatus();
});

// Covers the case where the page itself loads while already offline (the
// service worker can still serve the cached app shell), so the banner
// doesn't wait for a later 'offline' event that will never fire.
updateOfflineBanner();
loadStatus();

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

function renderConnection(data) {
  const dot = document.getElementById('connDot');
  const label = document.getElementById('connLabel');
  const sub = document.getElementById('connSub');
  const asOf = data.live && data.live.asOf;

  if (!data.connection.connected || !asOf) {
    dot.className = 'conn-dot down';
    label.textContent = 'Not connected';
    sub.textContent = data.connection.note || 'No live feed configured yet.';
    return;
  }

  const cls = freshnessClass(asOf);
  dot.className = 'conn-dot ' + cls;
  const age = timeAgo(asOf);
  label.textContent = cls === 'down'
    ? 'Connected, but last reading is old'
    : 'Connected';
  sub.textContent = 'Last reading: ' + (age || asOf);
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

  const mode = live.positionSizing && live.positionSizing.activeMode;
  tiles.push(statTile(
    mode ? escapeHtml(mode) : awaiting,
    'Position sizing mode',
    'Drawdown-based + robustness-based',
    !mode
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

async function loadStatus() {
  try {
    // Cache-bust: this file is meant to change out from under the page
    // (a future session or export job rewrites it), a cached 304 would
    // make the glance view lie about how fresh the data is.
    const res = await fetch('/alpha/data/status.json?t=' + Date.now());
    if (!res.ok) throw new Error('Server returned ' + res.status);
    const data = await res.json();
    renderConnection(data);
    renderStats(data);
    renderArchitecture(data);
    renderGenealogy(data);
  } catch (e) {
    document.getElementById('connLabel').textContent = "Couldn't load status.json";
    document.getElementById('connSub').textContent = e.message;
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

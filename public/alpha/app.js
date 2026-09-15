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
// Alpha runs on Jack's Mac; this page can be glanced at from any device, in
// any timezone, including a phone far from that Mac. An absolute timestamp
// with no timezone attached is genuinely ambiguous the moment the viewing
// device's timezone isn't the assumed one, and on a real-money system that
// ambiguity is exactly the kind of thing that erodes trust in a freshness
// reading (status-page UX guidance is consistent that stale-looking data is
// worse than downtime itself). timeZoneName: 'short' appends the browser's
// own zone abbreviation (e.g. "CDT"), so "reading taken at 2:14:03 PM" never
// has to be mentally reconciled against "which timezone is that".
function formatAbsolute(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short'
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
// visible after clicking in. 'critical' (kill switch engaged) takes the same
// priority here it takes everywhere else on this page (see computeHeadline):
// a background tab showing a calm green dot while the kill switch is engaged
// would defeat the entire point of a glance indicator.
const GLANCE_COLORS = { live: '#3DDC84', stale: '#E0A030', down: '#7B8188', error: '#E05050', critical: '#E05050' };
const GLANCE_TEXT = {
  live: 'connected', stale: 'connected, stale', down: 'awaiting connection', error: 'error', critical: 'kill switch engaged'
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
// Jack would want to see even from across the room, current or last known.
// isLastKnown marks that `data.live` has been substituted with a cached
// last-known-connected reading (see loadLastKnown below); the headline must
// say so explicitly rather than let a stale reading pass as current.
function computeHeadline(data, isLastKnown) {
  const live = data.live || {};
  const asOf = live.asOf;
  const killEngaged = live.killSwitch && live.killSwitch.engaged;

  if (killEngaged === true) {
    return {
      level: 'critical',
      text: isLastKnown ? 'KILL SWITCH ENGAGED (last known, now disconnected)' : 'KILL SWITCH ENGAGED',
      asOf
    };
  }
  if (isLastKnown) {
    return { level: 'lastknown', text: 'Disconnected - showing last known state from ' + (timeAgo(asOf) || 'earlier'), asOf };
  }
  if (!data.connection.connected || !asOf) {
    return { level: 'awaiting', text: 'Awaiting live connection', asOf };
  }
  const cls = freshnessClass(asOf);
  if (cls === 'down') return { level: 'awaiting', text: 'Connected, reading stale', asOf };
  if (cls === 'stale') return { level: 'caution', text: 'Connected, reading aging', asOf };
  return { level: 'good', text: 'Connected', asOf };
}

// A momentary disconnect from Alpha's real daemon shouldn't blank the page
// back to "awaiting connection" the instant it happens: that throws away a
// real reading Jack just had a moment ago for no reason other than a blip.
// Real status-dashboard UX (Statuspage-style freshness indicators, and the
// general "value plus the time it was observed" pattern) keeps showing the
// last real value with an explicit, honest age on it rather than reverting
// to unknown. This cache is deliberately narrow: only the slow-changing,
// non-monetary fields (kill switch, regime, drawdown %, debate panel,
// genealogy). Account and open positions are excluded on purpose, even
// though they live right next to these fields in the same live payload:
// those are real-money figures that can be wrong within seconds of going
// stale, and showing a frozen dollar amount as if it might still be current
// is exactly the "stale data wearing the clothes of live data" failure mode
// this page exists to avoid. Those two sections keep reverting straight to
// "awaiting connection" the instant the daemon drops, same as always.
const LAST_KNOWN_KEY = 'alpha:lastKnownState';

function saveLastKnown(data) {
  const live = data.live;
  if (!live || !live.asOf) return;
  try {
    localStorage.setItem(LAST_KNOWN_KEY, JSON.stringify({
      asOf: live.asOf,
      regime: live.regime,
      killSwitch: live.killSwitch,
      positionSizing: live.positionSizing,
      debatePanel: live.debatePanel,
      genealogy: live.genealogy
    }));
  } catch (e) {
    // Private browsing / storage blocked: just skip caching, page still
    // works exactly as it does today.
  }
}

function loadLastKnown() {
  try {
    const raw = localStorage.getItem(LAST_KNOWN_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function renderLastKnownBanner(lastKnown) {
  const banner = document.getElementById('lastKnownBanner');
  if (!banner) return;
  banner.hidden = !lastKnown;
  if (!lastKnown) return;
  const age = timeAgo(lastKnown.asOf) || 'earlier';
  document.getElementById('lastKnownBannerDetail').textContent =
    'Kill switch, regime, drawdown, debate panel, and genealogy below are the last real reading Alpha gave, from ' +
    age + ' (' + formatAbsolute(lastKnown.asOf) + '), not current. Account and positions are left at ' +
    '"awaiting connection" instead, since those can change every second and a frozen dollar figure would be ' +
    'misleading rather than merely old.';
}

function setLastKnownTag(id, lastKnown) {
  const el = document.getElementById(id);
  if (!el) return;
  el.hidden = !lastKnown;
  if (!lastKnown) return;
  el.textContent = 'LAST KNOWN · ' + (timeAgo(lastKnown.asOf) || 'EARLIER').toUpperCase();
  el.title = 'Disconnected. This reading was taken at ' + formatAbsolute(lastKnown.asOf) + ', not current.';
}

function updateLastKnownTags(lastKnown) {
  setLastKnownTag('summaryLastKnownTag', lastKnown);
  setLastKnownTag('psLastKnownTag', lastKnown);
  setLastKnownTag('genealogyLastKnownTag', lastKnown);
}

function renderHeadline(level, text, asOf) {
  const el = document.getElementById('headlineStatus');
  el.className = 'headline-status ' + level;
  document.getElementById('headlineText').textContent = text;
  el.title = asOf ? 'Reading taken at ' + formatAbsolute(asOf) : '';

  // See the .sticky-critical-bar comment in style.css: the header pill alone
  // scrolls off-screen on a page this long, so the one state worth seeing
  // from across the room gets its own bar pinned to the viewport instead.
  const bar = document.getElementById('stickyCriticalBar');
  const isCritical = level === 'critical';
  bar.hidden = !isCritical;
  bar.textContent = isCritical ? text : '';
  document.body.classList.toggle('has-sticky-critical', isCritical);
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

// server.js's live branch never actually persists connection.history (its
// /api/alpha/live route hardcodes history: [] on every connected response,
// see that route's own comment), and the static fallback file starts empty
// and has no mechanism to grow, so the uptime-strip feature below would
// otherwise show "no checks recorded yet" forever, on a real Mac with a real
// daemon, indefinitely. This page already performs a genuine connectivity
// check on every load, 30s interval tick, and tab-visibility change, so it
// keeps its own honest record of those real results in this browser's
// localStorage and uses that whenever the server hasn't sent a populated
// history yet. If a future session wires in real server-side persistence,
// that becomes authoritative again the moment it has any entries, since this
// only fills the gap while the server-side array is empty.
const CLIENT_CONN_HISTORY_KEY = 'alpha:clientConnHistory';
const CLIENT_CONN_HISTORY_CAP = 500;

function loadClientConnHistory() {
  try {
    const raw = localStorage.getItem(CLIENT_CONN_HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function recordClientConnCheck(connected) {
  const history = loadClientConnHistory();
  history.push({ at: new Date().toISOString(), connected: !!connected });
  const trimmed = history.slice(-CLIENT_CONN_HISTORY_CAP);
  try {
    localStorage.setItem(CLIENT_CONN_HISTORY_KEY, JSON.stringify(trimmed));
  } catch (e) {
    // Private browsing / storage blocked: same graceful degradation as the
    // last-known-state cache above, the strip just stays empty.
  }
  return trimmed;
}

function effectiveConnHistory(data, clientHistory) {
  const serverHistory = (data.connection && Array.isArray(data.connection.history)) ? data.connection.history : [];
  return serverHistory.length ? serverHistory : clientHistory;
}

// Returns the connection-freshness class ('down'/'live'/'stale') so the
// caller can decide the tab's glance indicator alongside the separate,
// higher-priority kill-switch check (see the GLANCE_COLORS comment above);
// this function no longer sets that indicator itself.
function renderConnection(data, clientHistory) {
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
  const history = effectiveConnHistory(data, clientHistory);

  const notWired = document.getElementById('notWiredCallout');
  const liveWired = document.getElementById('liveWiredCallout');
  if (notWired && liveWired) {
    notWired.hidden = !!data.connection.connected;
    liveWired.hidden = !data.connection.connected;
  }

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
    return 'down';
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
  return cls;
}

// Uptime-strip pattern (Statuspage, UptimeRobot, etc): a compact row of
// per-check ticks, oldest to newest, so a real history of connectivity
// checks is visible at a glance next to the current state, not just the
// latest reading. Built only from real connection.history entries; shows
// the honest "no checks recorded yet" placeholder otherwise, same as every
// other empty state on this page. Capped to the most recent 60 so the strip
// stays a glance, not a scroll.
const HISTORY_TICK_LIMIT = 60;

function renderConnectionHistory(data, clientHistory) {
  const strip = document.getElementById('connHistoryStrip');
  const summary = document.getElementById('connUptimeSummary');
  const range = document.getElementById('connHistoryRange');
  const source = document.getElementById('connHistorySource');
  const serverHistory = (data.connection && Array.isArray(data.connection.history)) ? data.connection.history : [];
  const history = serverHistory.length ? serverHistory : clientHistory;

  if (source) {
    source.textContent = (!serverHistory.length && history.length) ? '(recorded by this browser only)' : '';
  }

  if (!history.length) {
    strip.innerHTML = `<span class="conn-history-empty">No connectivity checks recorded yet.</span>`;
    summary.textContent = '';
    range.textContent = '';
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

  // The percentage above is scoped to whatever the tick strip is actually
  // showing (capped at HISTORY_TICK_LIMIT), which real status pages always
  // pair with the covered date range, since "92% up" reads very differently
  // over a week than over the last five checks. Built from the same real
  // entries the strip and percentage already use, never a separate figure.
  const oldest = recent[0].at;
  const newest = recent[recent.length - 1].at;
  range.textContent = recent.length > 1
    ? `Covers ${formatAbsolute(oldest)} → ${formatAbsolute(newest)}`
    : `Single check, at ${formatAbsolute(oldest)}`;
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

function fmtDollar(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const sign = n < 0 ? '-' : '';
  return sign + '$' + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}

// Same "never show a fabricated/misleading number" guard as fmtDollar/fmtPct
// above, applied to share quantity: mapPositions in server.js always sends a
// real number, but a missing/malformed qty from a future feed shape should
// fall back to '-' like every other cell in this row, not Math.abs(undefined)'s
// literal "NaN" text next to real dollar figures.
function fmtQty(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return String(Math.abs(n));
}

function renderAccount(data) {
  const row = document.getElementById('accountRow');
  const acct = data.live && data.live.account;
  if (!acct) {
    row.innerHTML = statTile('awaiting connection', 'Equity', null, true);
    return;
  }
  // dayChangeDollar is explicitly null (server.js) whenever the feed hasn't
  // resolved both equity readings yet, same nullable shape fmtDollar already
  // guards against. `null >= 0` is true in JS, so comparing the raw value
  // before checking it's a real number colored an unresolved "-" green,
  // falsely reading as "up today". Only color it once there's a real number.
  const dayChangeIsNumber = typeof acct.dayChangeDollar === 'number' && Number.isFinite(acct.dayChangeDollar);
  const dayGoodClass = dayChangeIsNumber ? (acct.dayChangeDollar >= 0 ? 'pl-good' : 'pl-bad') : 'pl-neutral';
  row.innerHTML = [
    statTile(escapeHtml(fmtDollar(acct.equity) || '-'), 'Equity', null, false),
    statTile(
      `<span class="${dayGoodClass}">${escapeHtml((fmtDollar(acct.dayChangeDollar) || '-'))}</span>`,
      'Day change',
      fmtPct(acct.dayChangePct) || null,
      false
    ),
    statTile(escapeHtml(fmtDollar(acct.buyingPower) || '-'), 'Buying power', null, false),
    statTile(escapeHtml(fmtDollar(acct.cash) || '-'), 'Cash', acct.cash < 0 ? 'Negative: margin in use' : null, false)
  ].join('');
}

// Position table follows the same convention every real trading-dashboard
// UX writeup agrees on: percentage gain next to the dollar figure (relative
// performance is what matters at a glance, not just the raw number), and
// green/red color coding so a scan across many rows reads winners and
// losers instantly rather than requiring reading each sign. Sorted by
// market value (server-side) so the biggest real exposure leads.
function renderPositions(data) {
  const panel = document.getElementById('positionsPanel');
  const positions = (data.live && Array.isArray(data.live.positions)) ? data.live.positions : [];

  if (!positions.length) {
    panel.innerHTML = `
      <div class="empty-panel">
        <div class="empty-panel-title font-mono">${data.connection.connected ? 'NO OPEN POSITIONS' : 'AWAITING LIVE CONNECTION'}</div>
        <div class="empty-panel-sub">${data.connection.connected
          ? 'Alpha is connected but not currently holding any positions.'
          : 'Once connected, real open positions (symbol, quantity, entry, current price, unrealized P&amp;L) render here.'}</div>
      </div>
    `;
    return;
  }

  const rows = positions.map(p => {
    // Same nullable-number guard as renderAccount's dayChangeIsNumber above:
    // qty/pl come through Number() in server.js, which turns a missing or
    // malformed field into NaN, and `NaN >= 0` is false, so an unresolved
    // value's dash would have been colored red, falsely reading as "losing".
    const plIsNumber = typeof p.unrealizedPl === 'number' && Number.isFinite(p.unrealizedPl);
    const goodClass = plIsNumber ? (p.unrealizedPl >= 0 ? 'pl-good' : 'pl-bad') : 'pl-neutral';
    return `
      <tr>
        <td class="pos-symbol font-mono">${escapeHtml(p.symbol)}</td>
        <td class="font-mono pos-side-${escapeHtml(p.side)}">${escapeHtml(p.side)}</td>
        <td class="font-mono pos-num">${escapeHtml(fmtQty(p.qty) || '-')}</td>
        <td class="font-mono pos-num">${escapeHtml(fmtDollar(p.avgEntryPrice) || '-')}</td>
        <td class="font-mono pos-num">${escapeHtml(fmtDollar(p.currentPrice) || '-')}</td>
        <td class="font-mono pos-num">${escapeHtml(fmtDollar(p.marketValue) || '-')}</td>
        <td class="font-mono pos-num ${goodClass}">${escapeHtml(fmtDollar(p.unrealizedPl) || '-')}
          <span class="pos-plpct">${escapeHtml(fmtPct(p.unrealizedPlPct) || '')}</span>
        </td>
      </tr>
    `;
  }).join('');

  panel.innerHTML = `
    <div class="pos-table-wrap">
      <table class="pos-table">
        <thead>
          <tr>
            <th>Symbol</th><th>Side</th><th>Qty</th><th>Avg entry</th><th>Current</th><th>Mkt value</th><th>Unrealized P&amp;L</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
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
      ${statTile(g.lastBreedingEventAt ? escapeHtml(timeAgo(g.lastBreedingEventAt) || g.lastBreedingEventAt) : 'awaiting connection', 'Last breeding event', g.lastBreedingEventNote || null, !g.lastBreedingEventAt)}
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
// or a separately maintained copy of it. lastStatusIsLastKnown travels with
// it so the summary's headline line agrees with what renderHeadline already
// put on screen, rather than recomputing computeHeadline() without knowing
// this is a cached reading and calling it "awaiting connection" again.
let lastStatusData = null;
let lastStatusIsLastKnown = false;

async function loadStatus() {
  const requestId = ++latestStatusRequestId;
  try {
    // Server decides whether Alpha's real daemon is reachable and returns
    // either a live-mapped reading or the same honest static placeholder,
    // same merge-with-fallback pattern as /api/clusters. Cache-bust: the
    // underlying data is meant to change out from under the page, a cached
    // 304 would make the glance view lie about how fresh it is.
    const res = await fetch('/api/alpha/live?t=' + Date.now());
    if (!res.ok) throw new Error('Server returned ' + res.status);
    const data = await res.json();
    if (requestId !== latestStatusRequestId) return;
    document.getElementById('copyStatusBtn').disabled = false;
    lastLoadedAt = new Date().toISOString();
    updateOfflineBanner();

    if (data.connection && data.connection.connected) saveLastKnown(data);
    const lastKnown = (!data.connection || !data.connection.connected) ? loadLastKnown() : null;
    // Records this real check (a request to /api/alpha/live really did just
    // resolve, with a real connected true/false in the response) regardless
    // of outcome, so the uptime strip has genuine data to show even while
    // Alpha's own daemon is unreachable, see effectiveConnHistory above.
    const clientConnHistory = recordClientConnCheck(data.connection && data.connection.connected);
    // Only the three sections built from the cached fields (stats,
    // position sizing, genealogy) read effectiveData; connection, account
    // and positions always read the real `data` so those never show a
    // frozen reading as current. See the LAST_KNOWN_KEY comment above.
    const effectiveData = lastKnown ? {
      ...data,
      live: { ...data.live, ...lastKnown }
    } : data;
    // "Copy status" builds its plain-text summary from whatever was last
    // rendered, so it should say the same last-known kill-switch/regime
    // values the page itself is showing, not silently disagree with them.
    lastStatusData = effectiveData;
    lastStatusIsLastKnown = !!lastKnown;

    const headline = computeHeadline(effectiveData, !!lastKnown);
    noteHeadlineForToast(headline.level, headline.text);
    renderHeadline(headline.level, headline.text, headline.asOf);
    renderLastKnownBanner(lastKnown);
    updateLastKnownTags(lastKnown);
    const connCls = renderConnection(data, clientConnHistory);
    renderConnectionHistory(data, clientConnHistory);
    // Kill switch engaged outranks plain connection freshness for the one
    // glance a background tab gives Jack, same priority it gets everywhere
    // else on this page.
    updateGlanceIndicators(headline.level === 'critical' ? 'critical' : connCls);
    renderStats(effectiveData);
    renderAccount(data);
    renderPositions(data);
    renderPositionSizing(effectiveData);
    renderArchitecture(data);
    renderGenealogy(effectiveData);
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
  const headline = computeHeadline(data, lastStatusIsLastKnown);
  const live = data.live || {};
  const ps = live.positionSizing || {};
  const acct = live.account;
  const positions = Array.isArray(live.positions) ? live.positions : [];
  const awaiting = 'awaiting connection';
  const lines = [
    'Alpha status, ' + formatAbsolute(new Date().toISOString()),
    '- ' + headline.text + (headline.asOf ? ' (reading taken ' + formatAbsolute(headline.asOf) + ')' : ''),
    '- Kill switch: ' + (live.killSwitch && live.killSwitch.engaged != null ? (live.killSwitch.engaged ? 'ENGAGED' : 'Clear') : awaiting),
    '- Regime: ' + (live.regime || awaiting),
    '- Equity: ' + (acct ? fmtDollar(acct.equity) + ' (' + fmtPct(acct.dayChangePct) + ' today)' : awaiting),
    '- Open positions: ' + (acct ? positions.length : awaiting),
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

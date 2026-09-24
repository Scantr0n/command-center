function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// Market-calendar and uptime/incident date math lives in dates-core.js,
// regime-segment/distribution math lives in regime-core.js, sparkline
// geometry and rolling-average math lives in sparkline-core.js, all three
// loaded before this file (see index.html), so they can be unit-tested
// outside the browser instead of only ever running live on whatever day, or
// whatever regime transitions or latency readings, someone's browser
// happens to have seen. See each file's own comments for the real NYSE
// calendar source and the reasoning behind its functions.
//
// All four of those scripts (this trio plus account-core.js) are loaded via
// plain <script> tags before this one; if any one fails to load (a network
// blip on a first, not-yet-cached visit, an ad blocker, a bad deploy that
// drops one file), the destructure below throws and used to abort this
// entire script with no visible sign of it, leaving the page stuck forever
// on its static "Loading..." placeholders, indistinguishable from a page
// that is merely slow. This page's whole job is to be trusted at a glance,
// so a load failure gets the same honest, visible treatment every other
// failure mode here already gets, instead of silently reading as "still
// loading".
const CORE_SCRIPTS = [
  ['AlphaDatesCore', 'dates-core.js'],
  ['AlphaAccountCore', 'account-core.js'],
  ['AlphaRegimeCore', 'regime-core.js'],
  ['AlphaSparklineCore', 'sparkline-core.js']
];
const missingCoreScript = CORE_SCRIPTS.find(([globalName]) => typeof window[globalName] === 'undefined');
if (missingCoreScript) {
  const missing = missingCoreScript[1];
  const bar = document.getElementById('stickyCriticalBar');
  if (bar) {
    bar.hidden = false;
    bar.textContent = 'Page failed to load fully (' + missing + ' did not load). Reload the page.';
  }
  const headlineEl = document.getElementById('headlineStatus');
  const headlineText = document.getElementById('headlineText');
  if (headlineEl) headlineEl.className = 'headline-status critical';
  if (headlineText) headlineText.textContent = 'Page failed to load, reload';
  const marketText = document.getElementById('marketText');
  if (marketText) marketText.textContent = 'Unavailable';
  throw new Error('Alpha app.js: ' + missing + ' did not load, aborting init');
}

const {
  computeMarketStatus,
  timeAgo,
  freshnessClass,
  computeHeadline,
  formatDuration,
  mostRecentConnectedAt,
  currentStateStartedAt,
  computeIncidents,
  dayKeyLocal,
  computeDailyUptimeBuckets,
  dailyUptimeClass
} = AlphaDatesCore;
const {
  regimeColor,
  computeRegimeSegments,
  regimeSegmentEndMs,
  computeRegimeDistribution
} = AlphaRegimeCore;
const {
  SPARK_W,
  SPARK_H,
  computeSparklinePoints,
  averageLatency
} = AlphaSparklineCore;
const MARKET_CALENDAR_SOURCE_CHECKED_AT = '2026-09-17';

function renderMarketStatus() {
  const pill = document.getElementById('marketPill');
  if (!pill) return;
  const status = computeMarketStatus();
  pill.classList.toggle('open', status.isOpen);
  pill.classList.toggle('closed', !status.isOpen && !status.isUnknown);
  pill.classList.toggle('stale', !!status.isUnknown);
  document.getElementById('marketText').textContent = status.label;
  pill.title = status.detail;
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

// changelog.json's entries carry date-only strings (git log --date=short,
// "2026-09-18"), never a full timestamp, so this formats those specifically
// rather than reusing formatAbsolute above, which assumes a real datetime
// and would otherwise render a date-only string at midnight UTC, silently
// shifting it a day in a timezone behind UTC.
function fmtDate(dateOnly) {
  if (!dateOnly) return null;
  const d = new Date(dateOnly + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return String(dateOnly);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
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

// A momentary disconnect from Alpha's real daemon shouldn't blank the page
// back to "awaiting connection" the instant it happens: that throws away a
// real reading Jack just had a moment ago for no reason other than a blip.
// Real status-dashboard UX (Statuspage-style freshness indicators, and the
// general "value plus the time it was observed" pattern) keeps showing the
// last real value with an explicit, honest age on it rather than reverting
// to unknown. This cache is deliberately narrow: only the slow-changing,
// non-monetary fields (kill switch, regime, drawdown %, debate panel,
// genealogy, stuck-agent count). Account and open positions are excluded on purpose, even
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
      genealogy: live.genealogy,
      anomalies: live.anomalies
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
    'Kill switch, regime, drawdown, debate panel, genealogy, and anomaly count below are the last real reading ' +
    'Alpha gave, from ' + age + ' (' + formatAbsolute(lastKnown.asOf) + '), not current. Account and positions ' +
    'are left at "awaiting connection" instead, since those can change every second and a frozen dollar figure ' +
    'would be misleading rather than merely old.';
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

// mostRecentConnectedAt, currentStateStartedAt, and formatDuration (the
// Statuspage/UptimeRobot-style "last seen" / "down for 3h 12m" math) live in
// dates-core.js now, see the destructure near the top of this file.

// server.js's /api/alpha/live route now persists connection.history itself
// (one real entry per request, to a local file next to status.json, see its
// own connection-history comment), so on a real Mac running server.js that
// history fills in on its own over time and this client-side record becomes
// redundant the moment the server has any entries (renderConnectionHistory
// below always prefers a non-empty server history). This client-side record
// still matters for two real gaps the server can't cover: a brand-new
// deployment before the server file has accumulated any entries yet, and
// this page being served some other way entirely (a static host, a stale
// cached copy) with no server behind /api/alpha/live at all. This page
// already performs a genuine connectivity check on every load, 30s interval
// tick, and tab-visibility change, so it keeps its own honest record of
// those real results in this browser's localStorage for exactly those two
// cases.
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

// This page can be open in more than one tab at once, each polling on its
// own independent 30s timer. Without a guard, two tabs checking within a
// few seconds of each other would each append their own entry for what a
// human would call the same real check, quietly halving (or worse, with
// more tabs) how much real wall-clock time CLIENT_CONN_HISTORY_CAP actually
// covers. A state that genuinely changed is still always recorded, since a
// flap is meaningful regardless of how close together it's observed; only
// a repeat of the same state within this window is treated as the same
// observation rather than a second one.
const MIN_CONN_RECORD_GAP_MS = 10000;

function recordClientConnCheck(connected) {
  const history = loadClientConnHistory();
  const connectedBool = !!connected;
  const last = history[history.length - 1];
  if (last && last.connected === connectedBool && (Date.now() - new Date(last.at).getTime()) < MIN_CONN_RECORD_GAP_MS) {
    return history;
  }
  history.push({ at: new Date().toISOString(), connected: connectedBool });
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

// Real-dashboard monitoring guidance for a live trading system consistently
// names API/connection response time as its own signal alongside up/down
// state (a connection can be "up" yet degraded). This is genuinely
// measurable from right here: the time this browser's own fetch of
// /api/alpha/live takes to resolve, timed with performance.now() around the
// real request in loadStatus() below, never estimated. It reports how long
// this page's request to Command Center took, not Alpha's own internal
// latency (Command Center may itself be reading a local fallback file), so
// it is labeled "fetch" rather than implying it reflects Alpha's daemon
// speed. Recorded per browser only, same reasoning and same cap pattern as
// the connectivity and regime history above.
const CLIENT_LATENCY_HISTORY_KEY = 'alpha:clientLatencyHistory';
const CLIENT_LATENCY_HISTORY_CAP = 200;
const LATENCY_AVG_WINDOW = 20;

function loadClientLatencyHistory() {
  try {
    const raw = localStorage.getItem(CLIENT_LATENCY_HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function recordClientLatency(ms) {
  const history = loadClientLatencyHistory();
  history.push({ at: new Date().toISOString(), ms });
  const trimmed = history.slice(-CLIENT_LATENCY_HISTORY_CAP);
  try {
    localStorage.setItem(CLIENT_LATENCY_HISTORY_KEY, JSON.stringify(trimmed));
  } catch (e) {
    // Private browsing / storage blocked: same graceful degradation as the
    // other client-side histories above, the reading just stops persisting.
  }
  return trimmed;
}

// averageLatency and computeSparklinePoints now live in sparkline-core.js
// (see AlphaSparklineCore above), so this geometry and rolling-average math
// can be unit-tested outside the browser.

// The "Fetch Xms (avg Yms)" text next to the connection strip gives the
// latest and average reading but not the shape between them, exactly what a
// sparkline is for (a compact trend line paired with a KPI, no axes or
// labels, real-status-dashboard convention: UptimeRobot/Statuspage-style
// response-time widgets all pair the current number with one of these).
// Built only from the same real, already-recorded CLIENT_LATENCY_HISTORY_KEY
// samples the text reading already uses, same LATENCY_AVG_WINDOW so the
// line and the "avg" figure describe the same window; never a separate or
// estimated series. Returns '' (nothing rendered) with fewer than 2 points,
// since a single point has no trend to show, same honest-empty-state rule as
// every other section on this page.

function renderLatencySparkline(history) {
  const recent = (history || []).slice(-LATENCY_AVG_WINDOW).filter(e => typeof e.ms === 'number' && Number.isFinite(e.ms));
  if (recent.length < 2) return '';
  const values = recent.map(e => e.ms);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const points = computeSparklinePoints(values);
  const path = points.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  const last = points[points.length - 1];
  const title = 'Last ' + recent.length + ' fetches: ' + min + 'ms to ' + max + 'ms';
  return `
    <svg class="latency-spark" width="${SPARK_W}" height="${SPARK_H}" viewBox="0 0 ${SPARK_W} ${SPARK_H}" role="img" aria-label="${escapeHtml(title)}">
      <title>${escapeHtml(title)}</title>
      <polyline points="${path}" class="latency-spark-line" fill="none" />
      <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="1.6" class="latency-spark-dot" />
    </svg>
  `;
}

// live.regime is sent as a single current value, never a history (see the
// schema-help row for live.regime), so this page has no way to show how
// Alpha's regime detection has actually behaved over time, only its reading
// right now, even though regime detection is one of Alpha's real, named
// architecture features. Same gap connection history had before
// CLIENT_CONN_HISTORY_KEY above, and the same fix: this browser keeps its
// own honest, append-only log of real transitions it has actually observed
// (a value that differs from the last one recorded), timestamped for real,
// in localStorage, never backfilled or guessed. Only records while genuinely
// connected, since a null/awaiting reading is not an observed regime.
const CLIENT_REGIME_HISTORY_KEY = 'alpha:clientRegimeHistory';
const CLIENT_REGIME_HISTORY_CAP = 200;

function loadClientRegimeHistory() {
  try {
    const raw = localStorage.getItem(CLIENT_REGIME_HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function recordClientRegimeObservation(connected, regime) {
  const history = loadClientRegimeHistory();
  if (!connected || !regime) return history;
  const last = history[history.length - 1];
  if (last && last.regime === regime) return history;
  const next = [...history, { at: new Date().toISOString(), regime }].slice(-CLIENT_REGIME_HISTORY_CAP);
  try {
    localStorage.setItem(CLIENT_REGIME_HISTORY_KEY, JSON.stringify(next));
  } catch (e) {
    // Private browsing / storage blocked: same graceful degradation as the
    // other client-side histories above, the section just stays empty.
  }
  return next;
}

// live.positionSizing.currentDrawdownPct and .robustnessScore have the same
// gap connection latency had before CLIENT_LATENCY_HISTORY_KEY above: Alpha's
// live feed sends only the current reading, never a history, so a shallow
// current drawdown gives no sense of whether it just got there or has sat
// there a while (the max-drawdown meter next to it already covers "how deep
// has it ever gone", a different question from "what has it been doing
// lately"). Same fix as latency/regime: this browser keeps its own honest,
// append-only log of real readings it has actually polled, capped, in
// localStorage, never backfilled or estimated, feeding a small trend
// sparkline next to each meter (see renderMeterSparkline below).
const CLIENT_DRAWDOWN_HISTORY_KEY = 'alpha:clientDrawdownHistory';
const CLIENT_ROBUSTNESS_HISTORY_KEY = 'alpha:clientRobustnessHistory';
const CLIENT_METER_HISTORY_CAP = 200;
const METER_SPARK_WINDOW = 20;

function loadClientMeterHistory(key) {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

// Only records while genuinely connected with a real numeric reading, same
// guard as recordClientRegimeObservation above: a last-known/frozen or
// awaiting-connection value is not a new observation, and recording it would
// flatten the trend line with repeats of a stale number rather than leaving
// an honest gap.
function recordClientMeterReading(key, connected, pct) {
  const history = loadClientMeterHistory(key);
  if (!connected || typeof pct !== 'number' || !Number.isFinite(pct)) return history;
  const next = [...history, { at: new Date().toISOString(), pct }].slice(-CLIENT_METER_HISTORY_CAP);
  try {
    localStorage.setItem(key, JSON.stringify(next));
  } catch (e) {
    // Private browsing / storage blocked: same graceful degradation as the
    // other client-side histories above, the sparkline just stays empty.
  }
  return next;
}

// Same compact trend-line treatment as renderLatencySparkline, generalized
// to any 0-100 meter reading rather than a millisecond one. Returns ''
// (nothing rendered) with fewer than 2 points in the window, same
// honest-empty-state rule as every other section on this page.
function renderMeterSparkline(history, title) {
  const recent = (history || []).slice(-METER_SPARK_WINDOW).filter(e => typeof e.pct === 'number' && Number.isFinite(e.pct));
  if (recent.length < 2) return '';
  const values = recent.map(e => e.pct);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const points = computeSparklinePoints(values);
  const path = points.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  const last = points[points.length - 1];
  const fullTitle = title + ': last ' + recent.length + ' readings, ' + min + '% to ' + max + '%';
  return `
    <svg class="meter-spark" width="${SPARK_W}" height="${SPARK_H}" viewBox="0 0 ${SPARK_W} ${SPARK_H}" role="img" aria-label="${escapeHtml(fullTitle)}">
      <title>${escapeHtml(fullTitle)}</title>
      <polyline points="${path}" class="latency-spark-line" fill="none" />
      <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="1.6" class="latency-spark-dot" />
    </svg>
  `;
}

// computeRegimeSegments and regimeSegmentEndMs now live in regime-core.js
// (see AlphaRegimeCore above), so this segmenting math can be unit-tested
// outside the browser instead of only ever running live against whatever
// transitions this browser happens to have recorded.

const REGIME_HISTORY_LIMIT = 10;

function regimeSegmentItem(seg) {
  const startAbs = formatAbsolute(seg.start);
  const endMs = regimeSegmentEndMs(seg);
  const durationText = formatDuration(endMs - new Date(seg.start).getTime()) || 'under 1m';
  const rangeText = seg.current
    ? (seg.frozenAsOf ? 'Since ' + startAbs + ', last confirmed ' + formatAbsolute(seg.frozenAsOf) : 'Since ' + startAbs)
    : startAbs + ' to ' + formatAbsolute(seg.end);
  const label = seg.current ? (seg.frozenAsOf ? 'Last confirmed · ' : 'Current · ') : '';
  return `
    <li class="regime-history-item${seg.current && !seg.frozenAsOf ? ' regime-history-current' : ''}">
      <span class="regime-history-label-value font-mono">${escapeHtml(seg.regime)}</span>
      <span class="regime-history-duration font-mono">${label}${escapeHtml(durationText)}</span>
      <span class="regime-history-range">${escapeHtml(rangeText)}</span>
    </li>
  `;
}

function renderRegimeHistory(clientRegimeHistory, frozenAsOf) {
  const list = document.getElementById('regimeHistoryList');
  if (!list) return;
  const segments = computeRegimeSegments(clientRegimeHistory, frozenAsOf);
  renderRegimeDistribution(segments);
  if (!segments.length) {
    list.innerHTML = `<li class="regime-history-empty font-mono">No regime changes observed by this browser yet.</li>`;
    return;
  }
  const recent = [...segments].reverse().slice(0, REGIME_HISTORY_LIMIT);
  list.innerHTML = recent.map(regimeSegmentItem).join('');
}

// regimeColor (and the hashStringToIndex it's built on) and
// computeRegimeDistribution now live in regime-core.js (see AlphaRegimeCore
// above), so the color-assignment and distribution-aggregation math can be
// unit-tested outside the browser too.

function renderRegimeDistribution(segments) {
  const wrap = document.getElementById('regimeDistWrap');
  const bar = document.getElementById('regimeDistBar');
  const legend = document.getElementById('regimeDistLegend');
  if (!wrap || !bar || !legend) return;
  const { totalMs, rows } = computeRegimeDistribution(segments);
  // Needs at least two distinct regimes to say anything a single stat tile
  // doesn't already cover (one regime for the whole observed window is just
  // "detected regime" again, under a different label); same
  // more-than-one-point-needed threshold this page's other sparklines use
  // before rendering a trend rather than nothing.
  if (rows.length < 2 || totalMs <= 0) {
    wrap.hidden = true;
    bar.innerHTML = '';
    legend.innerHTML = '';
    return;
  }
  wrap.hidden = false;
  bar.innerHTML = rows.map(r => {
    const pctText = r.pct >= 10 ? Math.round(r.pct) + '%' : (r.pct >= 1 ? r.pct.toFixed(1) + '%' : '<1%');
    const durationText = formatDuration(r.ms) || 'under 1m';
    const title = `${r.regime}: ${durationText} (${pctText})`;
    return `<button type="button" class="regime-dist-segment" style="width:${r.pct}%;background:${regimeColor(r.regime)}"
      title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}" data-tick-detail="${escapeHtml(title)}"></button>`;
  }).join('');
  wireTickTooltips(bar);
  legend.innerHTML = rows.map(r => {
    const pctText = r.pct >= 10 ? Math.round(r.pct) + '%' : (r.pct >= 1 ? r.pct.toFixed(1) + '%' : '<1%');
    return `
      <li class="regime-dist-legend-item">
        <span class="regime-dist-swatch" style="background:${regimeColor(r.regime)}" aria-hidden="true"></span>
        <span class="regime-dist-legend-label font-mono">${escapeHtml(r.regime)}</span>
        <span class="regime-dist-legend-value">${escapeHtml(formatDuration(r.ms) || 'under 1m')} &middot; ${pctText}</span>
      </li>
    `;
  }).join('');
}

// Returns the connection-freshness class ('down'/'live'/'stale') so the
// caller can decide the tab's glance indicator alongside the separate,
// higher-priority kill-switch check (see the GLANCE_COLORS comment above);
// this function no longer sets that indicator itself.
function renderConnection(data, clientHistory, latencyHistory) {
  const dot = document.getElementById('connDot');
  const label = document.getElementById('connLabel');
  const sub = document.getElementById('connSub');
  const latencyEl = document.getElementById('connLatency');
  if (latencyEl) {
    const latest = latencyHistory && latencyHistory.length ? latencyHistory[latencyHistory.length - 1].ms : null;
    const avg = averageLatency(latencyHistory || []);
    latencyEl.textContent = (typeof latest === 'number')
      ? 'Fetch ' + latest + 'ms' + (avg != null ? ' (avg ' + avg + 'ms)' : '')
      : '';
  }
  const latencySparkEl = document.getElementById('connLatencySpark');
  if (latencySparkEl) latencySparkEl.innerHTML = renderLatencySparkline(latencyHistory || []);
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

// Tap/keyboard fallback for the per-check and per-day tick buttons below
// (see #tickTooltip in style.css for why: a native title tooltip has no
// touch equivalent and most browsers don't surface it on keyboard focus
// either). Same dismissible/hoverable/persistent pattern as the main
// dashboard's #graphTooltip.
function showTickTooltip(text, x, y) {
  const el = document.getElementById('tickTooltip');
  if (!el) return;
  el.textContent = text;
  el.hidden = false;
  const rect = el.getBoundingClientRect();
  const left = Math.min(x + 10, window.innerWidth - rect.width - 12);
  const top = Math.min(y + 14, window.innerHeight - rect.height - 12);
  el.style.left = Math.max(12, left) + 'px';
  el.style.top = Math.max(12, top) + 'px';
  el.dataset.openFor = text;
}
function hideTickTooltip() {
  const el = document.getElementById('tickTooltip');
  if (!el) return;
  el.hidden = true;
  delete el.dataset.openFor;
}
// Wires click and keyboard-focus activation onto every tick/bar button in a
// freshly re-rendered strip. Click handles touch (a tap fires both focus and
// click; toggling on click alone avoids showing then instantly hiding it),
// Enter/Space handles pure keyboard use where focus alone shouldn't pop a
// tooltip a sighted mouse user didn't ask for.
function wireTickTooltips(container) {
  container.querySelectorAll('[data-tick-detail]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const text = btn.getAttribute('data-tick-detail');
      const el = document.getElementById('tickTooltip');
      const rect = btn.getBoundingClientRect();
      if (el && !el.hidden && el.dataset.openFor === text) hideTickTooltip();
      else showTickTooltip(text, rect.left, rect.bottom);
    });
  });
}

// The connectivity-check and daily-uptime strips each render up to 60/90
// individually-focusable buttons (HISTORY_TICK_LIMIT / the daily-bucket
// count), every one with the default implicit tabindex=0 a plain <button>
// gets. A keyboard user tabbing through the page had to pass through every
// single one just to get past these two strips, a real practical barrier,
// not just a formal WCAG gap. Roving tabindex (APG toolbar pattern) fixes
// it: only one tick is ever a real tab stop, arrow keys move within the
// strip, so entering or leaving it costs exactly one Tab either way. Called
// fresh on every re-render (the buttons are rebuilt each time, so there's
// no stale state to preserve); the container's own keydown listener is
// wired once (dataset guard) since the container element itself persists
// across re-renders even though its children don't.
function wireRovingTabindex(container) {
  const items = () => Array.from(container.querySelectorAll('[data-tick-detail]'));
  items().forEach((el, i) => el.setAttribute('tabindex', i === 0 ? '0' : '-1'));
  if (container.dataset.rovingWired) return;
  container.dataset.rovingWired = '1';
  container.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
    const els = items();
    const currentIndex = els.indexOf(document.activeElement);
    if (currentIndex === -1) return;
    let nextIndex = currentIndex;
    if (e.key === 'ArrowLeft') nextIndex = Math.max(0, currentIndex - 1);
    else if (e.key === 'ArrowRight') nextIndex = Math.min(els.length - 1, currentIndex + 1);
    else if (e.key === 'Home') nextIndex = 0;
    else if (e.key === 'End') nextIndex = els.length - 1;
    if (nextIndex === currentIndex) return;
    e.preventDefault();
    els[currentIndex].setAttribute('tabindex', '-1');
    els[nextIndex].setAttribute('tabindex', '0');
    els[nextIndex].focus();
  });
}
document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-tick-detail]')) hideTickTooltip();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideTickTooltip();
});

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
    return `<button type="button" class="history-tick ${cls}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}" data-tick-detail="${escapeHtml(title)}"></button>`;
  }).join('');
  wireTickTooltips(strip);
  wireRovingTabindex(strip);

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

// Statuspage-style "past incidents" list: the tick strip above shows the
// shape of recent checks but not a readable answer to "when was it actually
// down, and for how long", which real status-page UX research consistently
// flags as what builds trust in a status page over time (alongside the
// uptime percentage the strip already computes). Built by walking the same
// real connection.history entries the strip already renders and grouping
// consecutive "not connected" runs into incidents; nothing here is a
// separate or estimated reading. history is assumed oldest-first, same
// assumption mostRecentConnectedAt/currentStateStartedAt already make.
// computeIncidents itself now lives in dates-core.js, see the destructure
// near the top of this file.

const INCIDENT_LIST_LIMIT = 8;

function incidentItem(incident) {
  const startAbs = formatAbsolute(incident.start);
  const endMs = incident.ongoing ? Date.now() : new Date(incident.end).getTime();
  const durationText = formatDuration(endMs - new Date(incident.start).getTime()) || 'under 1m';
  const rangeText = incident.ongoing
    ? 'Started ' + startAbs + ', still down'
    : startAbs + ' to ' + formatAbsolute(incident.end);
  return `
    <li class="incident-item${incident.ongoing ? ' incident-ongoing' : ''}">
      <span class="incident-duration font-mono">${incident.ongoing ? 'Ongoing' : 'Down for ' + escapeHtml(durationText)}</span>
      <span class="incident-range">${escapeHtml(rangeText)}</span>
    </li>
  `;
}

function renderIncidents(data, clientHistory) {
  const list = document.getElementById('incidentList');
  if (!list) return;
  const history = effectiveConnHistory(data, clientHistory);
  if (!history.length) {
    list.innerHTML = `<li class="incident-empty font-mono">No connectivity checks recorded yet.</li>`;
    return;
  }
  const incidents = computeIncidents(history);
  if (!incidents.length) {
    list.innerHTML = `<li class="incident-empty font-mono">No downtime recorded in the covered history.</li>`;
    return;
  }
  // Newest first, same convention as the activity log below it, capped to a
  // glance-sized list rather than every incident this browser has ever seen.
  const recent = [...incidents].reverse().slice(0, INCIDENT_LIST_LIMIT);
  list.innerHTML = recent.map(incidentItem).join('');
}

// Statuspage/UptimeRobot-style daily uptime bars: the tick strip above
// answers "what happened in the last HISTORY_TICK_LIMIT checks" (a window of
// minutes at this page's 30s poll cadence), a different question from "how
// has this actually held up over the long run", which real status pages
// answer with one bar per calendar day, colored by that day's real uptime
// percentage (confirmed by reviewing Statuspage's own 90-day uptime
// showcase and UptimeRobot's public status pages, both of which pair a
// per-day bar row with a windowed percentage and date range the same way
// this does). Built only from the same real connection.history entries the
// tick strip and incident list already use, bucketed by this browser's
// local calendar day since that's the day Jack himself experienced it; a
// day with zero recorded checks is simply absent rather than shown as 0%,
// since "no check ever ran" is a different, unknown state from "a check ran
// and failed".
//
// dayKeyLocal, computeDailyUptimeBuckets (default 90-day window), and
// dailyUptimeClass ('full'/'degraded'/'down', the same three-tier read real
// status pages give a day) now live in dates-core.js, see the destructure
// near the top of this file.

function dailyUptimeBarItem(bucket) {
  const label = new Date(bucket.dateKey + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const pctText = Number.isInteger(bucket.pct) ? String(bucket.pct) : bucket.pct.toFixed(1);
  const title = `${label}: ${pctText}% up (${bucket.up}/${bucket.total} check${bucket.total === 1 ? '' : 's'})`;
  return `<button type="button" class="daily-uptime-bar ${dailyUptimeClass(bucket.pct)}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}" data-tick-detail="${escapeHtml(title)}"></button>`;
}

function renderDailyUptime(data, clientHistory) {
  const strip = document.getElementById('dailyUptimeStrip');
  if (!strip) return;
  const summary = document.getElementById('dailyUptimeSummary');
  const range = document.getElementById('dailyUptimeRange');
  const source = document.getElementById('dailyUptimeSource');
  const serverHistory = (data.connection && Array.isArray(data.connection.history)) ? data.connection.history : [];
  const history = effectiveConnHistory(data, clientHistory);
  if (source) source.textContent = (!serverHistory.length && history.length) ? '(recorded by this browser only)' : '';

  const buckets = computeDailyUptimeBuckets(history);
  if (!buckets.length) {
    strip.innerHTML = `<span class="conn-history-empty">No connectivity checks recorded yet.</span>`;
    if (summary) summary.textContent = '';
    if (range) range.textContent = '';
    return;
  }

  strip.innerHTML = buckets.map(dailyUptimeBarItem).join('');
  wireTickTooltips(strip);
  wireRovingTabindex(strip);

  // Overall percentage across the covered days: real per-day up/total counts
  // summed first and divided once, never averaged day-to-day, same
  // all-or-nothing-on-real-numbers rule computeExposure/renderPositions'
  // totals row already follow, so a day with far fewer checks doesn't carry
  // the same weight as one with far more.
  const totalUp = buckets.reduce((s, b) => s + b.up, 0);
  const totalChecks = buckets.reduce((s, b) => s + b.total, 0);
  const overallPct = (totalUp / totalChecks) * 100;
  const overallText = Number.isInteger(overallPct) ? String(overallPct) : overallPct.toFixed(1);
  if (summary) summary.textContent = `· ${overallText}% up (last ${buckets.length} day${buckets.length === 1 ? '' : 's'} with data)`;
  if (range) {
    const fmtDay = k => new Date(k + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    range.textContent = buckets.length > 1
      ? `Covers ${fmtDay(buckets[0].dateKey)} to ${fmtDay(buckets[buckets.length - 1].dateKey)}`
      : `Single day of data, ${fmtDay(buckets[0].dateKey)}`;
  }
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

  // Distinct from the everyday "awaiting connection" gray: a real stuckCount
  // of 0 is a genuine clean reading, not an unknown one, so it renders as
  // "None" rather than the awaiting-connection treatment every other still-
  // unset field on this row gets. See mapAnomalies' own comment for why a
  // failed /anomalies subrequest reports null here rather than a guessed 0.
  const stuckCount = live.anomalies && live.anomalies.stuckCount;
  const anomaliesKnown = stuckCount != null;
  tiles.push(statTile(
    anomaliesKnown ? (stuckCount === 0 ? 'None' : escapeHtml(String(stuckCount))) : awaiting,
    'Active anomalies',
    anomaliesKnown ? (stuckCount > 0 ? 'Stuck agent(s) detected' : 'No stuck agents at last check') : null,
    !anomaliesKnown
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
function rangeMeter(label, pct, ariaSuffix, sparklineHtml) {
  const validPct = typeof pct === 'number' && Number.isFinite(pct) && pct >= 0 && pct <= 100;
  if (!validPct) {
    return `
      <div class="ps-meter">
        <div class="ps-field-label font-mono">${escapeHtml(label)}</div>
        <div class="meter-track meter-track-empty" role="meter" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100"
          aria-valuetext="awaiting connection" aria-label="${escapeHtml(label)}, ${escapeHtml(ariaSuffix)}"></div>
        <div class="meter-value awaiting font-mono">awaiting connection</div>
      </div>
    `;
  }
  return `
    <div class="ps-meter">
      <div class="ps-field-label font-mono">${escapeHtml(label)}</div>
      <div class="meter-track" role="meter" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"
        aria-label="${escapeHtml(label)}, ${escapeHtml(ariaSuffix)}">
        <div class="meter-fill" style="width:${pct}%"></div>
      </div>
      <div class="meter-value-row">
        <div class="meter-value font-mono">${escapeHtml(String(pct))}%</div>
        ${sparklineHtml || ''}
      </div>
    </div>
  `;
}

function drawdownMeter(label, pct, sparklineHtml) {
  return rangeMeter(label, pct, 'percent of range used', sparklineHtml);
}

// Robustness-based sizing is named as its own real architecture feature
// (system.features, id "robustness-sizing"), alongside drawdown-based
// sizing, but until now nothing under Position sizing actually represented
// it, only the two drawdown meters below. Same 0-100 meter treatment and
// honest empty state as those, its own schema field
// (positionSizing.robustnessScore) rather than derived, since only a real
// feed from Alpha knows the true reading.
function robustnessMeter(pct, sparklineHtml) {
  return rangeMeter('ROBUSTNESS SCORE', pct, 'score out of 100', sparklineHtml);
}

function renderPositionSizing(data, clientDrawdownHistory, clientRobustnessHistory) {
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

  // Max drawdown gets no sparkline: it is a running peak-to-trough maximum,
  // monotonically non-decreasing across the current episode by definition,
  // so a trend line of it would only ever show a flat or rising line, never
  // the up-and-down movement a sparkline is actually useful for. Current
  // drawdown and robustness score both genuinely move poll to poll.
  const drawdownSpark = renderMeterSparkline(clientDrawdownHistory, 'Current drawdown trend, recorded by this browser only');
  const robustnessSpark = renderMeterSparkline(clientRobustnessHistory, 'Robustness score trend, recorded by this browser only');

  panel.innerHTML = modeHtml +
    drawdownMeter('CURRENT DRAWDOWN', ps.currentDrawdownPct, drawdownSpark) +
    drawdownMeter('MAX DRAWDOWN (PEAK TO TROUGH)', ps.maxDrawdownPct) +
    robustnessMeter(ps.robustnessScore, robustnessSpark);
}

// Account/position money math (fmtDollar, fmtPct, fmtQty, computeExposure,
// computePositionsTotals) lives in account-core.js, loaded before this file
// (see index.html), so it can be unit-tested outside the browser
// (account-core.test.js) instead of only ever running live once a real
// position feed exists. See that file's own header comment for the real bug
// this already caused with no test coverage.
const { fmtDollar, fmtPct, fmtQty, computeExposure, computePositionsTotals } = AlphaAccountCore;

// server.js's /equity-history proxy (see mapEquityCurve's own comment there)
// forwards the raw real equity readings its drawdown calculation already
// consumes, previously discarded after producing just the two percentages
// under Position sizing. This renders that real series as an actual trend,
// same live-proxy-only rule as the rest of the Account section: never
// populated from the static fallback. No axis labels, same minimal-chrome
// convention as this page's other sparklines (renderLatencySparkline,
// renderMeterSparkline), just wider and taller since here the chart is the
// section's own content rather than a companion to a single number. The x
// axis is reading order, not elapsed time: the daemon's real payload has no
// verified timestamp field per point (only .v, see mapEquityCurve), so
// labeling this as time-spaced would be a claim this page can't back up.
const EQUITY_CHART_W = 600;
const EQUITY_CHART_H = 90;
const EQUITY_CHART_PAD = 4;

function renderEquityCurve(equityCurve) {
  const wrap = document.getElementById('equityCurveWrap');
  const chart = document.getElementById('equityCurveChart');
  if (!wrap || !chart) return;
  const values = (Array.isArray(equityCurve) ? equityCurve : []).filter(v => typeof v === 'number' && Number.isFinite(v));
  if (values.length < 2) {
    wrap.hidden = true;
    chart.innerHTML = '';
    return;
  }
  wrap.hidden = false;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  const innerW = EQUITY_CHART_W - EQUITY_CHART_PAD * 2;
  const innerH = EQUITY_CHART_H - EQUITY_CHART_PAD * 2;
  const floorY = EQUITY_CHART_H - EQUITY_CHART_PAD;
  const points = values.map((v, i) => {
    const x = EQUITY_CHART_PAD + (i / (values.length - 1)) * innerW;
    const y = EQUITY_CHART_PAD + (range === 0 ? innerH / 2 : innerH - ((v - min) / range) * innerH);
    return [x, y];
  });
  const linePath = points.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  const areaPath = points[0][0].toFixed(1) + ',' + floorY.toFixed(1) + ' ' + linePath + ' ' +
    points[points.length - 1][0].toFixed(1) + ',' + floorY.toFixed(1);
  // Same status-color reuse as pl-good/pl-bad on the Positions table below:
  // green if the series ended at or above where it started, red otherwise.
  const rising = values[values.length - 1] >= values[0];
  const toneClass = rising ? 'equity-curve-up' : 'equity-curve-down';
  const title = 'Equity, last ' + values.length + ' real readings: ' + (fmtDollar(min) || min) + ' to ' + (fmtDollar(max) || max);
  chart.innerHTML = `
    <svg class="equity-curve-svg ${toneClass}" viewBox="0 0 ${EQUITY_CHART_W} ${EQUITY_CHART_H}" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(title)}">
      <title>${escapeHtml(title)}</title>
      <polygon points="${areaPath}" class="equity-curve-fill" />
      <polyline points="${linePath}" class="equity-curve-line" fill="none" vector-effect="non-scaling-stroke" />
    </svg>
    <div class="equity-curve-range font-mono">
      <span>${escapeHtml(fmtDollar(min) || '-')}</span>
      <span>${values.length} readings</span>
      <span>${escapeHtml(fmtDollar(max) || '-')}</span>
    </div>
  `;
}

function renderAccount(data) {
  const row = document.getElementById('accountRow');
  const acct = data.live && data.live.account;
  if (!acct) {
    row.innerHTML = statTile('awaiting connection', 'Equity', null, true);
    renderEquityCurve(null);
    return;
  }
  // dayChangeDollar is explicitly null (server.js) whenever the feed hasn't
  // resolved both equity readings yet, same nullable shape fmtDollar already
  // guards against. `null >= 0` is true in JS, so comparing the raw value
  // before checking it's a real number colored an unresolved "-" green,
  // falsely reading as "up today". Only color it once there's a real number.
  const dayChangeIsNumber = typeof acct.dayChangeDollar === 'number' && Number.isFinite(acct.dayChangeDollar);
  const dayGoodClass = dayChangeIsNumber ? (acct.dayChangeDollar >= 0 ? 'pl-good' : 'pl-bad') : 'pl-neutral';
  const positions = (data.live && Array.isArray(data.live.positions)) ? data.live.positions : [];
  const { totalInvested, pctDeployed } = computeExposure(acct, positions);
  row.innerHTML = [
    statTile(escapeHtml(fmtDollar(acct.equity) || '-'), 'Equity', null, false),
    statTile(
      `<span class="${dayGoodClass}">${escapeHtml((fmtDollar(acct.dayChangeDollar) || '-'))}</span>`,
      'Day change',
      fmtPct(acct.dayChangePct) || null,
      false
    ),
    statTile(escapeHtml(fmtDollar(acct.buyingPower) || '-'), 'Buying power', null, false),
    statTile(escapeHtml(fmtDollar(acct.cash) || '-'), 'Cash', acct.cash < 0 ? 'Negative: margin in use' : null, false),
    statTile(
      totalInvested != null ? escapeHtml(fmtDollar(totalInvested)) : 'awaiting connection',
      'Invested',
      pctDeployed != null ? pctDeployed.toFixed(1) + '% of equity' : null,
      totalInvested == null
    )
  ].join('');
  renderEquityCurve(acct.equityCurve);
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
  lastPositionsSnapshot = positions;

  const csvBtn = document.getElementById('positionsCsvBtn');
  if (csvBtn) {
    csvBtn.disabled = !positions.length;
    csvBtn.title = positions.length ? '' : 'No live positions to export yet.';
  }

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

  // Totals row: a standard trading-table footer, the portfolio-level number
  // a per-row scan doesn't give at a glance. Math itself (all-or-nothing
  // summation, cost-basis-weighted P&L%) lives in computePositionsTotals in
  // account-core.js now, see the destructure near the top of this file.
  const { totalsKnown, totalMv, totalPl, totalPlPct } = computePositionsTotals(positions);
  let totalsRow = '';
  if (totalsKnown) {
    const totalGoodClass = totalPl >= 0 ? 'pl-good' : 'pl-bad';
    totalsRow = `
      <tr class="pos-totals-row">
        <td class="font-mono" colspan="5">Total (${positions.length} position${positions.length === 1 ? '' : 's'})</td>
        <td class="font-mono pos-num">${escapeHtml(fmtDollar(totalMv) || '-')}</td>
        <td class="font-mono pos-num ${totalGoodClass}">${escapeHtml(fmtDollar(totalPl) || '-')}
          <span class="pos-plpct">${escapeHtml(fmtPct(totalPlPct) || '')}</span>
        </td>
      </tr>
    `;
  }

  panel.innerHTML = `
    <div class="pos-table-wrap">
      <table class="pos-table">
        <thead>
          <tr>
            <th>Symbol</th><th>Side</th><th>Qty</th><th>Avg entry</th><th>Current</th><th>Mkt value</th><th>Unrealized P&amp;L</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        ${totalsRow ? `<tfoot>${totalsRow}</tfoot>` : ''}
      </table>
    </div>
  `;
}

// system.* has no daemon behind it to report its own freshness the way
// live.asOf does for everything under `live`, so a reader has no way to
// tell whether "33 agents" is confirmed current or a description that
// quietly drifted out of date months ago. lastVerifiedAt is that missing
// trust signal: when this description was last actually checked against
// Alpha's real code, shown the same way every other timestamp on this
// page is (relative text, exact time on hover).
// A trust signal that never calls itself out as aging defeats its own
// purpose: the whole reason lastVerifiedAt exists is so a reader isn't
// silently trusting a description that quietly drifted out of date months
// ago (see the comment above). 90 days is a quarter, a reasonable cadence
// for rechecking hand-maintained facts about code that isn't otherwise
// changing every day; past that, the same "Live/Stale" freshness-indicator
// convention this page already uses everywhere else (see freshnessClass
// above) applies here too, just on a much longer timescale.
const ARCH_VERIFIED_STALE_DAYS = 90;

function renderArchitectureVerifiedMeta(data) {
  const meta = document.getElementById('archVerifiedMeta');
  if (!meta) return;
  const verifiedAt = data.system && data.system.lastVerifiedAt;
  meta.classList.remove('warn');
  if (!verifiedAt) {
    meta.textContent = '';
    meta.title = '';
    return;
  }
  const days = (Date.now() - new Date(verifiedAt).getTime()) / 86400000;
  const isStale = Number.isFinite(days) && days > ARCH_VERIFIED_STALE_DAYS;
  meta.textContent = 'Verified ' + (timeAgo(verifiedAt) || 'earlier') + (isStale ? ', due for a recheck' : '');
  if (isStale) meta.classList.add('warn');
  meta.title = 'Description last confirmed against Alpha\'s real code at ' + formatAbsolute(verifiedAt) +
    (isStale ? `. That's over ${ARCH_VERIFIED_STALE_DAYS} days ago, past due for rechecking against Alpha's actual code.` : '');
}

// The built/pending badge reads f.pending, never f.note: note is free-text
// description (genealogy-wall's just explains what the feature is) and used
// to say that on its own mislabeled any noted feature "pending", which wrongly
// called the real, built genealogy wall unbuilt.
function renderArchitecture(data) {
  renderArchitectureVerifiedMeta(data);
  const grid = document.getElementById('archGrid');
  grid.innerHTML = data.system.features.map(f => `
    <div class="arch-card">
      <div class="arch-card-title">
        ${escapeHtml(f.label)}
        ${f.pending ? '<span class="badge badge-pending">pending</span>' : '<span class="badge badge-active">built</span>'}
      </div>
      ${f.note ? `<div class="arch-card-note">${escapeHtml(f.note)}</div>` : ''}
    </div>
  `).join('');
}

// One card per lineage, the literal "wall" the architecture note promises,
// once a real feed knows per-lineage detail rather than only the three
// aggregate counts renderGenealogy already showed. Genealogy/lineage
// visualization research (evolutionary-algorithm lineage trees, genealogical
// graphs) converges on a grouped card/grid layout over a literal branching
// tree the moment per-node attribute count grows past a couple of fields,
// exactly this shape: one card per lineage, generation and status at a
// glance, detail on the card itself rather than requiring a hover or click.
function lineageCard(l) {
  const status = l.status === 'retired' ? 'retired' : (l.status === 'active' ? 'active' : null);
  const badgeClass = status === 'retired' ? 'badge-retired' : (status === 'active' ? 'badge-active' : 'badge-pending');
  const badgeText = status || 'unknown';
  const agentText = (typeof l.agentCount === 'number' && Number.isFinite(l.agentCount))
    ? l.agentCount + ' agent' + (l.agentCount === 1 ? '' : 's')
    : 'awaiting connection';
  const genText = (typeof l.generation === 'number' && Number.isFinite(l.generation)) ? 'GEN ' + l.generation : 'GEN -';
  const eventText = l.lastEventAt
    ? (l.lastEventNote ? escapeHtml(l.lastEventNote) : 'Last event ' + escapeHtml(timeAgo(l.lastEventAt) || formatAbsolute(l.lastEventAt)))
    : null;
  return `
    <div class="lineage-card">
      <div class="lineage-card-head">
        <span class="lineage-gen font-mono">${escapeHtml(genText)}</span>
        <span class="badge ${badgeClass}">${escapeHtml(badgeText)}</span>
      </div>
      <div class="lineage-label">${escapeHtml(l.label || l.id || 'Unnamed lineage')}</div>
      <div class="lineage-meta font-mono">${escapeHtml(agentText)}</div>
      ${eventText ? `<div class="lineage-event">${eventText}</div>` : ''}
    </div>
  `;
}

function renderGenealogy(data) {
  const g = data.live.genealogy;
  const panel = document.getElementById('genealogyPanel');
  const lineages = (g && Array.isArray(g.lineages)) ? g.lineages : [];
  const hasAggregate = g && (g.generation != null || g.lastBreedingEventAt != null);
  if (!hasAggregate && !lineages.length) return; // keep the built-in "awaiting live connection" empty state

  panel.classList.remove('empty-panel');

  // No "Active lineages" tile: the daemon's real data has no
  // parentage/lineage-grouping field, only per-agent strategy metadata, so
  // that figure could only ever restate the total agent count already shown
  // elsewhere on this page under a different label, not a genuinely
  // distinct lineage count.
  const summaryHtml = hasAggregate ? `
    <div class="stat-row">
      ${statTile(g.generation != null ? escapeHtml(String(g.generation)) : 'awaiting connection', 'Generation', null, g.generation == null)}
      ${statTile(g.lastBreedingEventAt ? escapeHtml(timeAgo(g.lastBreedingEventAt) || g.lastBreedingEventAt) : 'awaiting connection', 'Last breeding event', g.lastBreedingEventNote || null, !g.lastBreedingEventAt)}
    </div>
  ` : '';

  // The wall itself only appears once a feed sends real per-lineage entries;
  // an empty lineages[] with aggregate counts set (today's real server.js
  // mapping, see its own genealogy comment) just keeps the summary row above,
  // same as before this feature existed, rather than showing an empty grid.
  const wallHtml = lineages.length ? `
    <div class="lineage-wall-label font-mono">LINEAGES</div>
    <div class="lineage-wall">${lineages.map(lineageCard).join('')}</div>
  ` : '';

  panel.innerHTML = summaryHtml + wallHtml;
}

// A status-only page loses the "what changed and when" that makes a status
// page trustworthy over time, not just at the instant you look at it. This
// renders an honest activity log: kill-switch triggers, regime changes,
// connection state changes, whatever a future live feed appends to
// data.events. Empty today since this sandbox has no real history yet, not
// because the feature is unfinished.
// server.js's real anomaly events (see evolutionEvents/the anomalies map in
// server.js) carry `detail: JSON.stringify(a)`, Alpha's own real anomaly
// object serialized as-is, never reformatted for this page. Rendered
// verbatim, that's a compact single-line JSON blob (e.g.
// `{"agentId":"AGENT_7","reason":"no signal 3 cycles"}`), harder to read at
// a glance than the plain-language detail every other event type on this
// page already gets. This is purely a display transform: it never changes
// what's stored in `evt.detail` itself (the CSV export below still writes
// the real raw string, useful for re-parsing), and only reformats a flat
// JSON object into "key: value" pairs; anything that isn't a flat object
// (already-plain text, an array, malformed JSON) renders exactly as before.
function prettifyEventDetail(detail) {
  if (typeof detail !== 'string') return detail;
  const trimmed = detail.trim();
  if (!trimmed.startsWith('{')) return detail;
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (e) {
    return detail;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return detail;
  const pairs = Object.entries(parsed).map(([k, v]) => `${k}: ${typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}`);
  return pairs.length ? pairs.join(' · ') : detail;
}

function eventItem(evt) {
  const tone = ['good', 'alert'].includes(evt.tone) ? evt.tone : 'neutral';
  const age = timeAgo(evt.at);
  return `
    <li class="event-item">
      <span class="event-tag event-tag-${tone} font-mono">${escapeHtml(evt.type || 'event')}</span>
      <div class="event-body">
        <div class="event-label">${escapeHtml(evt.label)}</div>
        ${evt.detail ? `<div class="event-detail">${escapeHtml(prettifyEventDetail(evt.detail))}</div>` : ''}
      </div>
      <time class="event-time font-mono" datetime="${escapeHtml(evt.at)}" title="${escapeHtml(formatAbsolute(evt.at))}">${escapeHtml(age || evt.at)}</time>
    </li>
  `;
}

// Kept purely so the Activity log's "Export CSV" button can build its file
// from the same real, already-sorted rows just rendered, never a second
// fetch or a re-sort that could disagree with what's on screen.
let lastEventLogSnapshot = [];

// Connection already tells Jack "Down for Xh" right in its own header, so a
// dead feed reads as dead at a glance instead of requiring him to scroll the
// tick strip. The Activity log had no equivalent: a busy log and a log whose
// newest entry is three days old render identically until you actually read
// every row's own timestamp. This mirrors renderArchitectureVerifiedMeta's
// same section-title-meta convention (real timestamp in the title tooltip,
// nothing invented) so "how current is this list" is answerable without
// reading it.
function renderEventLogMeta(sorted) {
  const meta = document.getElementById('eventLogMeta');
  if (!meta) return;
  if (!sorted.length) {
    meta.textContent = '';
    meta.title = '';
    return;
  }
  const mostRecent = sorted[0].at;
  meta.textContent = 'Most recent ' + (timeAgo(mostRecent) || 'earlier');
  meta.title = 'Newest of ' + sorted.length + ' logged event(s), at ' + formatAbsolute(mostRecent);
}

function renderEventLog(data) {
  const log = document.getElementById('eventLog');
  const events = Array.isArray(data.events) ? data.events : [];
  const csvBtn = document.getElementById('eventLogCsvBtn');

  if (!events.length) {
    lastEventLogSnapshot = [];
    renderEventLogMeta([]);
    if (csvBtn) {
      csvBtn.disabled = true;
      csvBtn.title = 'No events recorded yet.';
    }
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
  lastEventLogSnapshot = sorted;
  renderEventLogMeta(sorted);
  if (csvBtn) {
    csvBtn.disabled = false;
    csvBtn.title = '';
  }
  log.innerHTML = sorted.map(eventItem).join('');
}

// Renders changelog.json, a file no one hand-edits: it's regenerated from
// this repo's real git history of status.json by
// public/alpha/data/changelog.js, same pattern already proven at
// public/sondrik/data/changelog.js and public/csm/data/changelog.js, so
// every hash, author, and date here is independently checkable against the
// repo instead of resting on a hand-typed claim. Missing entirely (never
// generated yet, or a fresh clone before anyone ran it) is an honest empty
// state, not an error.
function renderChangelog(data, driftStatus) {
  const section = document.getElementById('changelogSection');
  if (!section) return;
  // Same drift check validate.js already runs from the command line
  // (comparing changelog.json's recorded commit hashes for status.json
  // against this repo's real git log), surfaced here so a real drift shows
  // up on the live page itself instead of only when someone happens to run
  // the CLI validator. "unavailable" (not a git checkout, shallow clone,
  // etc) is an environment gap, not a data error, so it stays silent.
  const driftWarning = (driftStatus && driftStatus.drifted)
    ? `<div class="callout callout-warn">
        <strong>Changelog is out of sync.</strong> changelog.json records ${driftStatus.recordedCount}
        commit${driftStatus.recordedCount === 1 ? '' : 's'} for status.json, but this repo's real git history has
        ${driftStatus.realCount}. Run <code>node public/alpha/data/changelog.js</code> to regenerate it.
      </div>`
    : '';
  const entries = (data && Array.isArray(data.entries)) ? data.entries : [];
  if (!entries.length) {
    section.innerHTML = driftWarning + `
      <div class="empty-panel">
        <div class="empty-panel-title font-mono">NO CHANGELOG GENERATED YET</div>
        <div class="empty-panel-sub">
          Run <code>node public/alpha/data/changelog.js</code> to build one from this repo's git history of
          status.json.
        </div>
      </div>
    `;
    return;
  }
  const items = entries.map(e => `
    <li class="changelog-item${e.historyReset ? ' changelog-item-reset' : ''}">
      <div class="changelog-meta">
        <span class="changelog-hash font-mono" title="${escapeHtml(e.fullHash || e.hash)}">${escapeHtml(e.hash)}</span>
        <span class="changelog-date font-mono">${escapeHtml(fmtDate(e.date) || 'unknown date')}</span>
        <span class="changelog-author font-mono">${escapeHtml(e.author || 'unknown author')}</span>
      </div>
      <div class="changelog-title${e.historyReset ? ' changelog-title-reset' : ''}">${e.historyReset ? '&#9888; ' : ''}${escapeHtml(e.subject || '(no commit message)')}</div>
    </li>
  `).join('');
  const generatedNote = data.generatedAt
    ? 'Generated ' + escapeHtml(fmtDate((data.generatedAt || '').slice(0, 10)) || 'at an unknown time') + '.'
    : '';
  section.innerHTML = driftWarning + `
    <ol class="changelog-list" aria-label="Real git commit history of status.json, most recent first">${items}</ol>
    <p class="changelog-generated-note font-mono">${generatedNote}</p>
  `;
}

// status.json's own validate.js runs the two real safety checks this hub's
// "never a guessed number" promise actually depends on: no key that looks
// like real P&L/balance/win-rate/trade-count data (this sandbox has never
// had access to Alpha's real performance numbers, so a hit here means
// someone guessed instead of wiring in a real feed), and no "live" value
// filled in without its own asOf timestamp. That script already runs in
// `npm run validate` and in /api/alpha/data-quality (the same generic route
// every other hub's validate.js is wired to, unused by any hub's own page
// until now), but nothing on this page itself has ever shown whether the
// last real run was clean, so a hand-edit that tripped it would only ever
// surface on the command line. This renders those same real counts here.
// "unavailable" (validate.js missing, node unreachable) is an environment
// gap, not a real finding, so it stays silent like the changelog drift
// check above.
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
    meta.title = 'This hub\'s own validate.js (forbidden-key scan for guessed performance data, timestamp checks) found nothing to flag.';
    callout.innerHTML = '';
    return;
  }
  meta.textContent = errors ? `Self-check: ${errors} error(s)` : `Self-check: ${warnings} warning(s)`;
  meta.classList.add('warn');
  meta.title = 'Run node public/alpha/data/validate.js for the full detail.';
  const counts = [errors ? `${errors} error(s)` : '', warnings ? `${warnings} warning(s)` : ''].filter(Boolean).join(', ');
  callout.innerHTML = `
    <div class="callout callout-warn">
      <strong>${errors ? 'This hub\'s data-quality check found real errors.' : 'This hub\'s data-quality check found warnings.'}</strong>
      ${escapeHtml(counts)} from status.json's own validate.js (guards against guessed P&amp;L/balance/trade-count
      data and missing timestamps). Run <code>node public/alpha/data/validate.js</code> for the full detail.
    </div>
  `;
}

async function loadDataQuality() {
  try {
    const res = await fetch('/api/alpha/data-quality');
    renderDataQuality(res.ok ? await res.json() : null);
  } catch (e) {
    renderDataQuality(null);
  }
}

async function loadChangelog() {
  // The drift check is best-effort and independent of the changelog fetch
  // itself (it can be unavailable, e.g. no git checkout, while the
  // changelog still loads fine), so a failure here never blocks rendering
  // the changelog entries.
  const driftPromise = fetch('/api/alpha/changelog-status')
    .then(r => r.ok ? r.json() : null)
    .catch(() => null);
  try {
    const res = await fetch('/alpha/data/changelog.json?t=' + Date.now());
    const driftStatus = await driftPromise;
    if (!res.ok) {
      // A fresh clone before anyone has ever run changelog.js means the
      // file just doesn't exist yet, an honest empty state, not a page
      // error worth surfacing as one.
      renderChangelog({ entries: [] }, driftStatus);
      return;
    }
    renderChangelog(await res.json(), driftStatus);
  } catch (e) {
    renderChangelog({ entries: [] }, await driftPromise);
  }
}

// This page depends on a few browser features to work fully (localStorage
// for the connectivity/regime/last-known caches, the Notification API for
// critical alerts, a service worker for offline caching), and any one of
// them can be silently unavailable (private browsing, a locked-down
// profile, a revoked permission) without the page itself erroring, which
// just as silently mutes whatever depended on it. A real, live check of
// this browser, right now, so that silence never gets mistaken for
// "everything is fine". Never touches Alpha or any network path to it,
// purely introspection of this tab's own environment.
function checkLocalStorageAvailable() {
  try {
    const key = 'alpha:storageCheck';
    localStorage.setItem(key, '1');
    localStorage.removeItem(key);
    return true;
  } catch (e) {
    return false;
  }
}

// Service worker registration resolves asynchronously, and on a first-ever
// visit it was still unregistered at the instant this script ran (the page's
// own navigator.serviceWorker.register('/sw.js') call does not even fire
// until the window's load event, after this runs), so a single check here
// permanently cached "Not yet registered" even once registration actually
// completed a moment later. Re-queried on every renderBrowserDiagnostics
// call instead (each loadStatus() poll, same 30s cadence everything else on
// this panel already refreshes on) and cached in this module-level variable
// only so rendering itself can stay synchronous between checks.
let serviceWorkerDiagnostic = ('serviceWorker' in navigator) ? 'Checking...' : 'Not supported in this browser';
function refreshServiceWorkerDiagnostic() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.getRegistration().then(reg => {
    serviceWorkerDiagnostic = reg ? (reg.active ? 'Registered' : 'Registering') : 'Not yet registered';
  }).catch(() => {
    serviceWorkerDiagnostic = 'Registration check failed';
  });
}
refreshServiceWorkerDiagnostic();

// status: 'ok' (green), 'blocked' (amber, same treatment arch-card's
// .badge-pending already gives an unfinished-but-not-broken feature), or
// 'info' (neutral gray, same as a retired lineage's badge) for a state
// that is simply informational rather than good or bad on its own.
function diagnosticRow(label, status, badgeText, detail) {
  const badgeClass = status === 'ok' ? 'badge-active' : status === 'blocked' ? 'badge-pending' : 'badge-retired';
  return `<tr><th>${escapeHtml(label)}</th><td><span class="badge ${badgeClass}">${escapeHtml(badgeText)}</span> ${escapeHtml(detail)}</td></tr>`;
}

function renderBrowserDiagnostics(connCheckCount, regimeObservationCount, latencySampleCount, drawdownSampleCount, robustnessSampleCount) {
  const body = document.getElementById('browserDiagnosticsBody');
  if (!body) return;

  // Fire-and-forget: updates serviceWorkerDiagnostic in time for the next
  // call (30s away), same lag the rest of this panel already tolerates.
  refreshServiceWorkerDiagnostic();

  const storageOk = checkLocalStorageAvailable();
  const notifyStatus = !notifySupported ? 'info' : (Notification.permission === 'granted' ? 'ok' : Notification.permission === 'denied' ? 'blocked' : 'info');
  const notifyBadge = !notifySupported ? 'N/A' : (Notification.permission === 'granted' ? 'GRANTED' : Notification.permission === 'denied' ? 'DENIED' : 'NOT SET');
  const swStatus = serviceWorkerDiagnostic === 'Registered' ? 'ok' : (serviceWorkerDiagnostic === 'Registration check failed' ? 'blocked' : 'info');

  const rows = [
    diagnosticRow('Local storage', storageOk ? 'ok' : 'blocked', storageOk ? 'AVAILABLE' : 'BLOCKED',
      storageOk
        ? 'Connectivity checks, regime history, drawdown/robustness trend samples, and the last-known-state cache all persist here.'
        : 'Private browsing or a locked profile. Connectivity/regime/trend history and the last-known-state cache will not persist across reloads.'),
    diagnosticRow('Notifications', notifyStatus, notifyBadge,
      !notifySupported ? 'Not supported in this browser.' : (Notification.permission === 'granted' ? 'Critical alerts can fire natively when this tab is backgrounded.' : Notification.permission === 'denied' ? 'Critical alerts are muted; re-enable from this browser’s own site settings.' : 'Permission not yet requested (use "Enable critical alerts" above).')),
    diagnosticRow('Service worker', swStatus, serviceWorkerDiagnostic.toUpperCase(),
      swStatus === 'ok' ? 'Offline app-shell caching is active.' : 'Offline app-shell caching may be unavailable.'),
    diagnosticRow('Connectivity checks recorded', storageOk ? 'ok' : 'blocked', String(connCheckCount),
      'Real connectivity results recorded by this browser (see Connection above).'),
    diagnosticRow('Regime observations recorded', storageOk ? 'ok' : 'blocked', String(regimeObservationCount),
      'Real regime transitions this browser has actually observed (see Regime history above).'),
    diagnosticRow('Fetch latency samples recorded', storageOk ? 'ok' : 'blocked', String(latencySampleCount),
      'Real round-trip timings of this browser\'s own requests to Command Center (see the Connection strip above).'),
    diagnosticRow('Drawdown/robustness trend samples recorded', storageOk ? 'ok' : 'blocked', String((drawdownSampleCount || 0) + (robustnessSampleCount || 0)),
      'Real position-sizing meter readings this browser has actually polled (see the sparklines under Position sizing above).')
  ];
  body.innerHTML = rows.join('');
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

// Native OS-level notification, opt-in, for the one state on this page
// genuinely worth interrupting Jack outside the tab for: the kill switch
// engaging, or this page's own fetch failing (see the 'critical' level in
// computeHeadline / the catch branch of loadStatus). This is purely the
// browser's own Notification API showing a local notification built from
// data already rendered on screen; nothing is sent anywhere, and there is
// still no path from here back to Alpha. Kept separate from the in-page
// toast (noteHeadlineForToast) since a toast only helps while the tab is
// actually visible, which is exactly when a native notification is least
// needed and most likely to feel redundant.
const NOTIFY_PREF_KEY = 'alpha:notifyEnabled';

function loadNotifyPref() {
  try {
    return localStorage.getItem(NOTIFY_PREF_KEY) === 'true';
  } catch (e) {
    return false;
  }
}

function saveNotifyPref(enabled) {
  try {
    localStorage.setItem(NOTIFY_PREF_KEY, enabled ? 'true' : 'false');
  } catch (e) {
    // Private browsing / storage blocked: the toggle still works for this
    // page load, it just won't be remembered next visit.
  }
}

const notifySupported = typeof window !== 'undefined' && 'Notification' in window;
const notifyBtn = document.getElementById('notifyBtn');
const testAlertBtn = document.getElementById('testAlertBtn');

function renderNotifyBtn() {
  if (!notifyBtn || !notifySupported) return;
  const permission = Notification.permission;
  if (permission === 'denied') {
    notifyBtn.hidden = false;
    notifyBtn.disabled = true;
    notifyBtn.classList.remove('notify-on');
    notifyBtn.textContent = 'Alerts blocked';
    notifyBtn.title = 'Notifications are blocked for this page in your browser settings.';
    notifyBtn.removeAttribute('aria-pressed');
    if (testAlertBtn) testAlertBtn.hidden = true;
    return;
  }
  const enabled = permission === 'granted' && loadNotifyPref();
  notifyBtn.hidden = false;
  notifyBtn.disabled = false;
  notifyBtn.classList.toggle('notify-on', enabled);
  // Real toggle-button semantics (this button's own state persists across
  // clicks, it isn't a one-shot action like Refresh), so screen readers get
  // the same on/off state the border color already gives sighted users.
  notifyBtn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
  notifyBtn.textContent = enabled ? 'Critical alerts on' : 'Enable critical alerts';
  notifyBtn.title = enabled
    ? 'A native notification fires if the kill switch engages or this page errors while this tab is unfocused. Click to turn off.'
    : 'Get a native notification if the kill switch engages or this page errors while this tab is unfocused.';
  // A granted browser permission doesn't guarantee the OS actually surfaces
  // the notification (Do Not Disturb, a muted notification center entry for
  // this browser, etc), so once armed, offer a way to check that end-to-end
  // rather than leaving Jack to find out for certain only during a real kill
  // switch event. Same real pairing every alerting tool with a "notify me"
  // toggle ships (Slack, PagerDuty, UptimeRobot all offer a test alert next
  // to the toggle that arms it).
  if (testAlertBtn) testAlertBtn.hidden = !enabled;
}

if (testAlertBtn) {
  testAlertBtn.addEventListener('click', () => {
    if (!notifySupported || Notification.permission !== 'granted') return;
    try {
      new Notification('Alpha (test)', {
        body: 'Test alert, no real state change. A real kill-switch or page-error alert looks just like this.',
        icon: '/icon-192.png',
        tag: 'alpha-test'
      });
      showToast('good', 'Test alert sent, check your notifications');
    } catch (e) {
      showToast('critical', "Couldn't send test alert: " + e.message);
    }
  });
}

if (notifyBtn && notifySupported) {
  notifyBtn.addEventListener('click', async () => {
    if (Notification.permission === 'denied') return;
    if (Notification.permission === 'default') {
      const result = await Notification.requestPermission();
      if (result === 'granted') {
        saveNotifyPref(true);
        showToast('good', 'Critical alerts enabled');
      }
      renderNotifyBtn();
      return;
    }
    // Already granted: this button just toggles Jack's own preference,
    // never re-prompts, since the browser permission itself already covers
    // that question.
    const nextEnabled = !loadNotifyPref();
    saveNotifyPref(nextEnabled);
    showToast('good', nextEnabled ? 'Critical alerts enabled' : 'Critical alerts turned off');
    renderNotifyBtn();
  });
  renderNotifyBtn();
}

// Fires only on the transition into 'critical' (never on every poll while it
// stays critical, same one-shot-per-transition shape as noteHeadlineForToast
// above), and only while this tab isn't the one Jack is actually looking at,
// since a native notification on top of the toast and the sticky red bar
// would just be noise while the tab already has his attention.
let previousNotifyLevel = null;

function maybeFireCriticalNotification(level, text) {
  if (!notifySupported) return;
  const enteringCritical = level === 'critical' && previousNotifyLevel !== null && previousNotifyLevel !== 'critical';
  previousNotifyLevel = level;
  if (!enteringCritical) return;
  if (Notification.permission !== 'granted' || !loadNotifyPref()) return;
  if (document.visibilityState === 'visible' && document.hasFocus()) return;
  try {
    const notification = new Notification('Alpha', { body: text, icon: '/icon-192.png', tag: 'alpha-critical' });
    notification.onclick = () => { window.focus(); notification.close(); };
  } catch (e) {
    // Some browsers/OS notification permissions can still throw even once
    // granted (e.g. a since-revoked OS-level permission); fail silently,
    // the toast and sticky bar already carry this state on-page.
  }
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

// Kept separately from lastStatusData (which merges in the last-known cache)
// so the cross-tab storage handler below can re-render the connection
// sections, which always read the real un-merged response, without a second
// fetch when a sibling tab is the one that changed the shared history.
let lastRawData = null;

// Kept purely so the "Export CSV" button under Positions can build its file
// from the same real rows already on screen, never a second fetch. Always
// the real, unmodified `data.live.positions` (never the last-known cache
// account/positions never use), so an export can't silently carry a frozen
// reading forward.
let lastPositionsSnapshot = [];

async function loadStatus() {
  const requestId = ++latestStatusRequestId;
  try {
    // Server decides whether Alpha's real daemon is reachable and returns
    // either a live-mapped reading or the same honest static placeholder,
    // same merge-with-fallback pattern as /api/clusters. Cache-bust: the
    // underlying data is meant to change out from under the page, a cached
    // 304 would make the glance view lie about how fresh it is.
    const fetchStartedAt = performance.now();
    const res = await fetch('/api/alpha/live?t=' + Date.now());
    if (!res.ok) throw new Error('Server returned ' + res.status);
    const data = await res.json();
    if (requestId !== latestStatusRequestId) return;
    lastRawData = data;
    // Real, measured round trip for this browser's own request, timed around
    // the actual fetch above; see the CLIENT_LATENCY_HISTORY_KEY comment for
    // why this is a page-to-Command-Center reading, not Alpha's own latency.
    const clientLatencyHistory = recordClientLatency(Math.round(performance.now() - fetchStartedAt));
    document.getElementById('copyStatusBtn').disabled = false;
    const backupBtnEl = document.getElementById('backupBtn');
    backupBtnEl.disabled = false;
    backupBtnEl.title = '';
    lastLoadedAt = new Date().toISOString();
    updateOfflineBanner();

    if (data.connection && data.connection.connected) saveLastKnown(data);
    const lastKnown = (!data.connection || !data.connection.connected) ? loadLastKnown() : null;
    // Records this real check (a request to /api/alpha/live really did just
    // resolve, with a real connected true/false in the response) regardless
    // of outcome, so the uptime strip has genuine data to show even while
    // Alpha's own daemon is unreachable, see effectiveConnHistory above.
    const clientConnHistory = recordClientConnCheck(data.connection && data.connection.connected);
    const connectedNow = !!(data.connection && data.connection.connected);
    const clientRegimeHistory = recordClientRegimeObservation(connectedNow, data.live && data.live.regime);
    const livePs = data.live && data.live.positionSizing;
    const clientDrawdownHistory = recordClientMeterReading(CLIENT_DRAWDOWN_HISTORY_KEY, connectedNow, livePs && livePs.currentDrawdownPct);
    const clientRobustnessHistory = recordClientMeterReading(CLIENT_ROBUSTNESS_HISTORY_KEY, connectedNow, livePs && livePs.robustnessScore);
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
    maybeFireCriticalNotification(headline.level, headline.text);
    renderHeadline(headline.level, headline.text, headline.asOf);
    renderLastKnownBanner(lastKnown);
    updateLastKnownTags(lastKnown);
    const connCls = renderConnection(data, clientConnHistory, clientLatencyHistory);
    renderConnectionHistory(data, clientConnHistory);
    renderDailyUptime(data, clientConnHistory);
    renderIncidents(data, clientConnHistory);
    renderRegimeHistory(clientRegimeHistory, lastKnown && lastKnown.asOf);
    // Kill switch engaged outranks plain connection freshness for the one
    // glance a background tab gives Jack, same priority it gets everywhere
    // else on this page.
    updateGlanceIndicators(headline.level === 'critical' ? 'critical' : connCls);
    renderStats(effectiveData);
    renderAccount(data);
    renderPositions(data);
    renderPositionSizing(effectiveData, clientDrawdownHistory, clientRobustnessHistory);
    renderArchitecture(data);
    renderGenealogy(effectiveData);
    renderEventLog(data);
    renderBrowserDiagnostics(clientConnHistory.length, clientRegimeHistory.length, clientLatencyHistory.length, clientDrawdownHistory.length, clientRobustnessHistory.length);
  } catch (e) {
    if (requestId !== latestStatusRequestId) return;
    // Distinct from "down" (Alpha has no live feed yet, an expected,
    // unremarkable state): this is the page itself failing to read its own
    // status.json, a real problem worth standing out from the everyday
    // "awaiting connection" gray, not blending into it.
    noteHeadlineForToast('critical', "Page error, couldn't load status.json");
    maybeFireCriticalNotification('critical', "Alpha status page error, couldn't load status.json");
    renderHeadline('critical', "Page error, couldn't load status.json");
    document.getElementById('connDot').className = 'conn-dot error';
    document.getElementById('connLabel').textContent = "Couldn't load status.json";
    document.getElementById('connSub').textContent = e.message;
    updateGlanceIndicators('error');
  }
}

// This page's connectivity/latency/regime histories are captioned "recorded
// by this browser only", but without this listener that claim is only true
// per tab: two tabs of this page each read and write the same localStorage
// keys on their own independent poll timers, so each would only see its
// sibling's checks at its own next 30s tick, and briefly disagree about
// uptime, incidents, and sample counts in the meantime. The storage event
// fires on every tab except the one that made the write, so listening for it
// here re-renders the affected sections from the freshly written data right
// away, keeping every open tab of this page in agreement without a second
// network fetch. Ignores writes this same tab made (the browser never fires
// this event for those) and anything outside this page's own known keys.
window.addEventListener('storage', (e) => {
  if (!lastRawData || !e.key) return;
  if (![
    CLIENT_CONN_HISTORY_KEY, CLIENT_LATENCY_HISTORY_KEY, CLIENT_REGIME_HISTORY_KEY,
    CLIENT_DRAWDOWN_HISTORY_KEY, CLIENT_ROBUSTNESS_HISTORY_KEY
  ].includes(e.key)) return;
  const connHistory = loadClientConnHistory();
  const latencyHistory = loadClientLatencyHistory();
  const regimeHistory = loadClientRegimeHistory();
  const drawdownHistory = loadClientMeterHistory(CLIENT_DRAWDOWN_HISTORY_KEY);
  const robustnessHistory = loadClientMeterHistory(CLIENT_ROBUSTNESS_HISTORY_KEY);
  renderConnection(lastRawData, connHistory, latencyHistory);
  renderConnectionHistory(lastRawData, connHistory);
  renderDailyUptime(lastRawData, connHistory);
  renderIncidents(lastRawData, connHistory);
  // Same last-known/frozen distinction loadStatus applies via `lastKnown`:
  // lastStatusIsLastKnown and lastStatusData are the same two values this
  // tab's own last loadStatus() call already computed, so a sibling tab's
  // history write doesn't make a disconnected tab's regime history look
  // live again just because new data landed in localStorage.
  const regimeFrozenAsOf = lastStatusIsLastKnown && lastStatusData && lastStatusData.live ? lastStatusData.live.asOf : null;
  renderRegimeHistory(regimeHistory, regimeFrozenAsOf);
  // Keeps the drawdown/robustness sparklines in agreement across open tabs
  // too, same reasoning as the sections above; re-renders from lastStatusData
  // (the same effectiveData the page itself last rendered from) rather than
  // lastRawData, so a last-known-state view doesn't flip back to "awaiting
  // connection" just because a sibling tab wrote a history entry.
  if (lastStatusData) {
    renderPositionSizing(lastStatusData, drawdownHistory, robustnessHistory);
  }
  renderBrowserDiagnostics(connHistory.length, regimeHistory.length, latencyHistory.length, drawdownHistory.length, robustnessHistory.length);
});

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
    '- Equity: ' + (acct ? (fmtDollar(acct.equity) || awaiting) + ' (' + (fmtPct(acct.dayChangePct) || awaiting) + ' today)' : awaiting),
    '- Open positions: ' + (acct ? positions.length : awaiting),
    '- Invested: ' + (() => {
      const { totalInvested, pctDeployed } = computeExposure(acct, positions);
      if (totalInvested == null) return awaiting;
      return (fmtDollar(totalInvested) || awaiting) + (pctDeployed != null ? ' (' + pctDeployed.toFixed(1) + '% of equity)' : '');
    })(),
    '- Position sizing mode: ' + (ps.activeMode || awaiting),
    '- Current drawdown: ' + (typeof ps.currentDrawdownPct === 'number' ? ps.currentDrawdownPct + '%' : awaiting),
    '- Max drawdown (peak to trough): ' + (typeof ps.maxDrawdownPct === 'number' ? ps.maxDrawdownPct + '%' : awaiting),
    '- Robustness score: ' + (typeof ps.robustnessScore === 'number' ? ps.robustnessScore + '/100' : awaiting),
    '- Debate panel: ' + ((live.debatePanel && live.debatePanel.active) ? 'Active' : 'Pending' + (live.debatePanel && live.debatePanel.blockedOn ? ' (' + live.debatePanel.blockedOn + ')' : '')),
    '- Active anomalies: ' + ((live.anomalies && live.anomalies.stuckCount != null) ? String(live.anomalies.stuckCount) : awaiting),
    '- Genealogy: ' + (() => {
      const g = live.genealogy || {};
      if (g.generation == null && g.lastBreedingEventAt == null) return awaiting;
      const gen = g.generation != null ? 'gen ' + g.generation : awaiting;
      const lastEvent = g.lastBreedingEventAt
        ? 'last breeding event ' + (timeAgo(g.lastBreedingEventAt) || formatAbsolute(g.lastBreedingEventAt))
        : 'no breeding event recorded';
      return gen + ', ' + lastEvent;
    })(),
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

// Every other hub (CGT/CSM/Garage/Sondrik) has a "Download backup (.json)"
// button; Alpha had none, even though this browser's own connectivity,
// fetch-latency, regime-observation, and drawdown/robustness-trend logs
// (CLIENT_CONN_HISTORY_KEY, CLIENT_LATENCY_HISTORY_KEY,
// CLIENT_REGIME_HISTORY_KEY, CLIENT_DRAWDOWN_HISTORY_KEY,
// CLIENT_ROBUSTNESS_HISTORY_KEY above) live only in
// localStorage, with no export path if site data is ever cleared. Local
// download only, nothing is sent anywhere, and read-only like everything
// else on this page: it only ever reads state already recorded, never
// touches Alpha's real daemon.
const backupBtn = document.getElementById('backupBtn');
backupBtn.addEventListener('click', () => {
  if (!lastStatusData) return;
  const backup = {
    exportedAt: new Date().toISOString(),
    source: 'Command Center Alpha overview (/alpha), local download only',
    isLastKnownSnapshot: lastStatusIsLastKnown,
    status: lastStatusData,
    clientConnHistory: loadClientConnHistory(),
    clientLatencyHistory: loadClientLatencyHistory(),
    clientRegimeHistory: loadClientRegimeHistory(),
    clientDrawdownHistory: loadClientMeterHistory(CLIENT_DRAWDOWN_HISTORY_KEY),
    clientRobustnessHistory: loadClientMeterHistory(CLIENT_ROBUSTNESS_HISTORY_KEY)
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'alpha-backup-' + new Date().toISOString().slice(0, 10) + '.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

function csvField(v) {
  let s = v == null ? '' : String(v);
  // CSV/formula injection (OWASP): a value starting with =, +, -, @, tab, or
  // a carriage return is read as a live formula by Excel/Sheets when this
  // export is opened there, not as plain text. Same leading-quote mitigation
  // as the other hubs' own CSV exports, even though every field here comes
  // from Alpha's own real feed rather than free-text entry, since a symbol
  // or side string is still attacker-shaped input from this page's own
  // point of view.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

const POSITIONS_CSV_COLUMNS = [
  ['symbol', 'Symbol'], ['side', 'Side'], ['qty', 'Qty'], ['avgEntryPrice', 'Avg entry'],
  ['currentPrice', 'Current'], ['marketValue', 'Mkt value'], ['unrealizedPl', 'Unrealized P&L'],
  ['unrealizedPlPct', 'Unrealized P&L %']
];

// Exports exactly the real open positions currently on screen, read straight
// from lastPositionsSnapshot (the same array renderPositions just rendered),
// never a second fetch or a reconstructed copy. Read-only like every other
// button on this page: it only ever downloads a file to this browser, never
// writes anything back to Alpha.
document.getElementById('positionsCsvBtn').addEventListener('click', () => {
  if (!lastPositionsSnapshot.length) return;
  const header = POSITIONS_CSV_COLUMNS.map(([, label]) => csvField(label)).join(',');
  const lines = lastPositionsSnapshot.map(p => POSITIONS_CSV_COLUMNS.map(([key]) => csvField(p[key])).join(','));
  const csv = [header, ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'alpha-positions-' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

const EVENT_LOG_CSV_COLUMNS = [
  ['at', 'When'], ['type', 'Type'], ['tone', 'Tone'], ['label', 'Label'], ['detail', 'Detail']
];

// Same real-rows-on-screen export as the Positions CSV button above, for the
// Activity log's own real events (kill-switch triggers, regime changes,
// evolution runs, anomalies) instead of positions.
document.getElementById('eventLogCsvBtn').addEventListener('click', () => {
  if (!lastEventLogSnapshot.length) return;
  const header = EVENT_LOG_CSV_COLUMNS.map(([, label]) => csvField(label)).join(',');
  const lines = lastEventLogSnapshot.map(evt => EVENT_LOG_CSV_COLUMNS.map(([key]) => csvField(evt[key])).join(','));
  const csv = [header, ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'alpha-events-' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

// Every other hub (CGT/CSM/Garage/Sondrik) has a "Print / export PDF"
// button backed by its own @media print stylesheet; Alpha had neither, so
// the browser's default print output ran a fixed-position sticky bar and
// every action button straight onto the page. window.print() itself is
// exactly as read-only as the Refresh button above: it only ever renders
// what is already on screen, never touches Alpha's real daemon.
document.getElementById('printBtn').addEventListener('click', () => window.print());

function lockBodyScroll() {
  const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
  if (scrollbarWidth > 0) document.body.style.paddingRight = scrollbarWidth + 'px';
  document.body.style.overflow = 'hidden';
}
function unlockBodyScroll() {
  document.body.style.overflow = '';
  document.body.style.paddingRight = '';
}

let shortcutsOpen = false;
let shortcutsLastFocusedEl = null;

// Only the shortcuts this page actually wires up, never an invented or
// aspirational one, same "?" convention as GitHub/Gmail/Linear, and the
// same overlay the main Command Center dashboard, CGT, CSM, Sondrik, and
// Garage hubs already added. This page has no search box or focusable table
// rows to bind to (unlike those hubs), only the real actions below.
const SHORTCUTS = [
  { keys: ['R'], label: 'Refresh status' },
  { keys: ['C'], label: 'Copy status summary' },
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
document.getElementById('shortcutsOverlay').addEventListener('click', (e) => {
  if (e.target.id === 'shortcutsOverlay') closeShortcuts();
});

document.addEventListener('keydown', (e) => {
  if (!shortcutsOpen) return;
  if (e.key === 'Escape') {
    closeShortcuts();
    return;
  }
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

// A single keydown listener for every real single-key shortcut this page
// wires up, guarded the same way as the other hubs: never while the overlay
// is already open (Tab/Esc above own that case), and never while focus sits
// in a real text field or an open <details> summary's own text-editable
// content, even though this page has no free-text input today, so a future
// one doesn't silently start eating keystrokes.
document.addEventListener('keydown', (e) => {
  if (shortcutsOpen) return;
  const active = document.activeElement;
  const tag = active && active.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (active && active.isContentEditable)) return;

  if (e.key === '?') {
    e.preventDefault();
    openShortcuts();
    return;
  }
  if (e.key === 'r' || e.key === 'R') {
    if (refreshBtn.disabled) return;
    e.preventDefault();
    refreshBtn.click();
    return;
  }
  if (e.key === 'c' || e.key === 'C') {
    if (copyStatusBtn.disabled) return;
    e.preventDefault();
    copyStatusBtn.click();
  }
});

// This is a glance-at-status page Jack checks without leaving Command
// Center, so it re-reads status.json on its own rather than requiring a
// manual reload. Purely a re-fetch of the same read-only file, paused
// while the tab is hidden so it never runs pointlessly in the background.
const REFRESH_INTERVAL_MS = 30000;
let nextAutoRefreshAt = Date.now() + REFRESH_INTERVAL_MS;
setInterval(() => {
  if (document.visibilityState === 'visible') {
    loadStatus();
    // Market open/closed never comes from the /api/alpha/live fetch above
    // (see computeMarketStatus's own comment), so it needs its own tick on
    // the same cadence rather than piggybacking on loadStatus succeeding.
    renderMarketStatus();
  }
  nextAutoRefreshAt = Date.now() + REFRESH_INTERVAL_MS;
}, REFRESH_INTERVAL_MS);

// Visible companion to the auto-refresh above: without it, the 30s poll is
// invisible until a value happens to change, and there's no way to tell "the
// page is quietly staying current" from "the page stopped updating". Plain
// countdown text next to Refresh, real status-page convention. Reflects this
// interval's real schedule (not reset by a manual click, since the interval
// above isn't either) and goes blank whenever it wouldn't be true: tab
// hidden (the tick above is skipped then, per the comment on it) or a manual
// refresh already in flight.
const nextRefreshEl = document.getElementById('connNextRefresh');
function renderNextRefreshCountdown() {
  if (!nextRefreshEl) return;
  if (document.visibilityState !== 'visible' || refreshBtn.disabled) {
    nextRefreshEl.textContent = '';
    return;
  }
  const secs = Math.max(0, Math.ceil((nextAutoRefreshAt - Date.now()) / 1000));
  nextRefreshEl.textContent = 'Next check in ' + secs + 's';
}
setInterval(renderNextRefreshCountdown, 1000);
renderNextRefreshCountdown();

// The interval above only fires while the tab is visible, so a tab left
// hidden for a while (Jack tabs away, comes back) can show a reading up to
// a full interval stale at the moment he actually looks. Refetching the
// instant the tab regains visibility is what makes a glance-at-status page
// trustworthy the moment it is glanced at, rather than up to 30s behind.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    loadStatus();
    renderMarketStatus();
  }
});

// Covers the case where the page itself loads while already offline (the
// service worker can still serve the cached app shell), so the banner
// doesn't wait for a later 'offline' event that will never fire.
updateOfflineBanner();
// Renders once immediately, independent of the /api/alpha/live fetch below,
// so this table is accurate even if that fetch itself fails; loadStatus()
// re-renders it with fresh counts on every successful tick after this.
renderBrowserDiagnostics(loadClientConnHistory().length, loadClientRegimeHistory().length, loadClientLatencyHistory().length, loadClientMeterHistory(CLIENT_DRAWDOWN_HISTORY_KEY).length, loadClientMeterHistory(CLIENT_ROBUSTNESS_HISTORY_KEY).length);
// Same "render immediately, independent of the network fetch" reasoning as
// the diagnostics call above: market open/closed has no dependency on
// /api/alpha/live succeeding at all, so it shouldn't wait on it.
renderMarketStatus();
// changelog.json only changes when someone manually reruns changelog.js and
// redeploys, never on Alpha's own 30s poll cadence, so it's fetched once
// here rather than joining the loadStatus() interval below.
loadChangelog();
// Same one-time-on-load reasoning as loadChangelog() above: status.json's
// own validate.js result only changes when someone hand-edits and redeploys
// that file, never on the 30s live-poll cadence.
loadDataQuality();
loadStatus();

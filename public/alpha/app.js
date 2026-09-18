function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// Whether US equities are in their regular NYSE session right now: real,
// useful context for reading everything else on this page (an empty
// Positions table or a "no reading since Friday" connection gap reads very
// differently at 10am on a Tuesday than at 8pm on a Saturday), but not
// something Alpha's own daemon exposes or needs to, so this is computed
// entirely client-side from a fixed calendar rather than fetched. NYSE
// publishes its full-year holiday and early-close calendar about a year
// ahead and it does not change once published, so there is no live feed to
// poll here, only an annual re-check the same way system.lastVerifiedAt
// tracks a hand-confirmed fact above. Source: NYSE's own 2026 trading
// calendar (nyse.com/publicdocs/nyse/ICE_NYSE_2026_Yearly_Trading_Calendar.pdf),
// corroborated against independent market-hours aggregators. Update this
// list (and MARKET_CALENDAR_SOURCE_CHECKED_AT) once NYSE publishes 2027's.
const MARKET_HOLIDAYS_2026 = new Set([
  '2026-01-01', // New Year's Day
  '2026-01-19', // Martin Luther King Jr. Day
  '2026-02-16', // Washington's Birthday (Presidents Day)
  '2026-04-03', // Good Friday
  '2026-05-25', // Memorial Day
  '2026-06-19', // Juneteenth National Independence Day
  '2026-07-03', // Independence Day (observed; July 4 falls on a Saturday)
  '2026-09-07', // Labor Day
  '2026-11-26', // Thanksgiving Day
  '2026-12-25'  // Christmas Day
]);
// The two recurring annual 1:00pm ET early closes: day after Thanksgiving
// and Christmas Eve. NYSE does not treat quarterly options-expiration
// ("triple witching") days as early closes, despite that claim appearing on
// some secondary market-hours sites; only these two are real.
const MARKET_EARLY_CLOSES_2026 = new Set([
  '2026-11-27',
  '2026-12-24'
]);
const MARKET_CALENDAR_SOURCE_CHECKED_AT = '2026-09-17';

function nowInET() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour12: false, weekday: 'short',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  }).formatToParts(new Date());
  const map = {};
  parts.forEach(p => { map[p.type] = p.value; });
  return map;
}

function isTradingDayKey(dateKey, weekday) {
  return weekday !== 'Sat' && weekday !== 'Sun' && !MARKET_HOLIDAYS_2026.has(dateKey);
}

// Walks forward a plain UTC calendar date (used only as a date, never as a
// real instant) to find the next real trading day, skipping weekends and
// the fixed 2026 holiday list above. 14-day cap is just a safety bound; the
// longest real gap on the calendar (the Christmas/New Year stretch) is a
// handful of days.
function nextTradingDayFrom(dateKey, includeSame) {
  let d = new Date(dateKey + 'T00:00:00Z');
  if (!includeSame) d = new Date(d.getTime() + 86400000);
  for (let i = 0; i < 14; i++) {
    const key = d.toISOString().slice(0, 10);
    const weekday = d.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short' });
    if (isTradingDayKey(key, weekday)) return { key, weekday };
    d = new Date(d.getTime() + 86400000);
  }
  return null;
}

// Regular NYSE session only (9:30am-4:00pm ET, 9:30am-1:00pm ET on the two
// early-close days above); deliberately doesn't model pre-market/after-hours
// extended sessions, since "regular hours open/closed" is the one distinction
// that actually explains what the rest of this page is showing.
function computeMarketStatus() {
  const p = nowInET();
  const dateKey = `${p.year}-${p.month}-${p.day}`;
  const weekday = p.weekday;
  const minutesNow = Number(p.hour) * 60 + Number(p.minute);
  const isHoliday = MARKET_HOLIDAYS_2026.has(dateKey);
  const isWeekend = weekday === 'Sat' || weekday === 'Sun';
  const isEarlyClose = MARKET_EARLY_CLOSES_2026.has(dateKey);
  const tradingDay = isTradingDayKey(dateKey, weekday);
  const openMin = 9 * 60 + 30;
  const closeMin = isEarlyClose ? 13 * 60 : 16 * 60;
  const isOpen = tradingDay && minutesNow >= openMin && minutesNow < closeMin;

  if (isOpen) {
    return {
      isOpen: true,
      label: 'Market open',
      detail: 'Closes ' + (isEarlyClose ? '1:00 PM ET (early close)' : '4:00 PM ET') + ' · regular NYSE session'
    };
  }

  const next = (tradingDay && minutesNow < openMin) ? { key: dateKey, weekday } : nextTradingDayFrom(dateKey, false);
  const reason = isHoliday ? 'holiday' : isWeekend ? 'weekend' : null;
  let detail = 'Regular NYSE session, next open unknown';
  if (next) {
    const dateLabel = next.key === dateKey
      ? 'today'
      : new Date(next.key + 'T00:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
    detail = 'Opens ' + dateLabel + ' 9:30 AM ET · regular NYSE session';
  }
  return { isOpen: false, label: 'Market closed' + (reason ? ' (' + reason + ')' : ''), detail };
}

function renderMarketStatus() {
  const pill = document.getElementById('marketPill');
  if (!pill) return;
  const status = computeMarketStatus();
  pill.classList.toggle('open', status.isOpen);
  pill.classList.toggle('closed', !status.isOpen);
  document.getElementById('marketText').textContent = status.label;
  pill.title = status.detail;
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

// Averaged over a small recent window rather than the full cap, since a
// single-request spike (or a real, sustained slowdown) is more useful read
// against "the last handful of checks" than against everything this browser
// has ever recorded.
function averageLatency(history) {
  if (!history.length) return null;
  const recent = history.slice(-LATENCY_AVG_WINDOW);
  const sum = recent.reduce((s, e) => s + (typeof e.ms === 'number' ? e.ms : 0), 0);
  return Math.round(sum / recent.length);
}

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
const SPARK_W = 56;
const SPARK_H = 18;
const SPARK_PAD = 2;

function renderLatencySparkline(history) {
  const recent = (history || []).slice(-LATENCY_AVG_WINDOW).filter(e => typeof e.ms === 'number' && Number.isFinite(e.ms));
  if (recent.length < 2) return '';
  const values = recent.map(e => e.ms);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  const innerW = SPARK_W - SPARK_PAD * 2;
  const innerH = SPARK_H - SPARK_PAD * 2;
  const points = values.map((v, i) => {
    const x = SPARK_PAD + (values.length === 1 ? 0 : (i / (values.length - 1)) * innerW);
    // range === 0 means every recent sample was identical: draw a flat line
    // through the middle rather than dividing by zero.
    const y = SPARK_PAD + (range === 0 ? innerH / 2 : innerH - ((v - min) / range) * innerH);
    return [x, y];
  });
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

// Turns the flat transition log above into readable segments: each entry
// marks when a regime started, so the segment it started runs until the
// next entry's timestamp (or now, for the most recent one, which is still
// current). history is oldest-first, same assumption the connection-history
// helpers above make.
function computeRegimeSegments(history) {
  if (!Array.isArray(history) || !history.length) return [];
  return history.map((entry, i) => ({
    regime: entry.regime,
    start: entry.at,
    end: i + 1 < history.length ? history[i + 1].at : null,
    current: i === history.length - 1
  }));
}

const REGIME_HISTORY_LIMIT = 10;

function regimeSegmentItem(seg) {
  const startAbs = formatAbsolute(seg.start);
  const endMs = seg.current ? Date.now() : new Date(seg.end).getTime();
  const durationText = formatDuration(endMs - new Date(seg.start).getTime()) || 'under 1m';
  const rangeText = seg.current
    ? 'Since ' + startAbs
    : startAbs + ' to ' + formatAbsolute(seg.end);
  return `
    <li class="regime-history-item${seg.current ? ' regime-history-current' : ''}">
      <span class="regime-history-label-value font-mono">${escapeHtml(seg.regime)}</span>
      <span class="regime-history-duration font-mono">${seg.current ? 'Current · ' : ''}${escapeHtml(durationText)}</span>
      <span class="regime-history-range">${escapeHtml(rangeText)}</span>
    </li>
  `;
}

function renderRegimeHistory(clientRegimeHistory) {
  const list = document.getElementById('regimeHistoryList');
  if (!list) return;
  const segments = computeRegimeSegments(clientRegimeHistory);
  if (!segments.length) {
    list.innerHTML = `<li class="regime-history-empty font-mono">No regime changes observed by this browser yet.</li>`;
    return;
  }
  const recent = [...segments].reverse().slice(0, REGIME_HISTORY_LIMIT);
  list.innerHTML = recent.map(regimeSegmentItem).join('');
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

// Statuspage-style "past incidents" list: the tick strip above shows the
// shape of recent checks but not a readable answer to "when was it actually
// down, and for how long", which real status-page UX research consistently
// flags as what builds trust in a status page over time (alongside the
// uptime percentage the strip already computes). Built by walking the same
// real connection.history entries the strip already renders and grouping
// consecutive "not connected" runs into incidents; nothing here is a
// separate or estimated reading. history is assumed oldest-first, same
// assumption mostRecentConnectedAt/currentStateStartedAt already make.
function computeIncidents(history) {
  if (!Array.isArray(history) || !history.length) return [];
  const incidents = [];
  let open = null;
  for (const entry of history) {
    if (!entry) continue;
    if (!entry.connected) {
      if (!open) open = { start: entry.at, end: null, ongoing: true };
    } else if (open) {
      open.end = entry.at;
      open.ongoing = false;
      incidents.push(open);
      open = null;
    }
  }
  // A run still open when the loop ends means the most recent check in this
  // history was still "not connected", i.e. a real outage still in progress
  // as of the last recorded check, not one this page is guessing has ended.
  if (open) incidents.push(open);
  return incidents;
}

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
function rangeMeter(label, pct, ariaSuffix) {
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
      <div class="meter-value font-mono">${escapeHtml(String(pct))}%</div>
    </div>
  `;
}

function drawdownMeter(label, pct) {
  return rangeMeter(label, pct, 'percent of range used');
}

// Robustness-based sizing is named as its own real architecture feature
// (system.features, id "robustness-sizing"), alongside drawdown-based
// sizing, but until now nothing under Position sizing actually represented
// it, only the two drawdown meters below. Same 0-100 meter treatment and
// honest empty state as those, its own schema field
// (positionSizing.robustnessScore) rather than derived, since only a real
// feed from Alpha knows the true reading.
function robustnessMeter(pct) {
  return rangeMeter('ROBUSTNESS SCORE', pct, 'score out of 100');
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
    drawdownMeter('MAX DRAWDOWN (PEAK TO TROUGH)', ps.maxDrawdownPct) +
    robustnessMeter(ps.robustnessScore);
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

// Total invested and % of equity deployed are never fetched as their own
// field: they're derived client-side from live.account.equity and the real
// live.positions[].marketValue figures server.js already sends, the same
// "only ever computed from fields the daemon actually returned" rule
// computeDrawdowns follows server-side. account is only ever populated once
// the live proxy is connected (see the schema-help table), so positions.length
// being 0 at that point is a real "fully in cash" reading, not an unknown,
// and totalInvested is safe to report as exactly $0 rather than "-".
function computeExposure(acct, positions) {
  if (!acct) return { totalInvested: null, pctDeployed: null };
  const marketValues = positions.map(p => p.marketValue);
  // Same all-or-nothing rule renderPositions' own totals row uses just below
  // (see its comment): filtering out the bad values and summing the rest
  // used to silently treat one position's missing marketValue as $0 instead
  // of admitting the total itself is unknown, so this panel and the
  // positions table right beneath it could report two different totals for
  // the same data.
  if (positions.length && !marketValues.every(v => typeof v === 'number' && Number.isFinite(v))) {
    return { totalInvested: null, pctDeployed: null };
  }
  const totalInvested = marketValues.reduce((sum, v) => sum + v, 0);
  const pctDeployed = (typeof acct.equity === 'number' && Number.isFinite(acct.equity) && acct.equity > 0)
    ? (totalInvested / acct.equity) * 100
    : null;
  return { totalInvested, pctDeployed };
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

  // Totals row: a standard trading-table footer, the portfolio-level number
  // a per-row scan doesn't give at a glance. Summed only from the same real
  // per-row marketValue/unrealizedPl fields already rendered above, and only
  // when every row has a real number to sum, never partially totaled against
  // a row silently treated as zero. The aggregate P&L% is computed against
  // total cost basis (mktValue - pl per row, the real amount actually paid),
  // not averaged from the per-row percentages, since averaging percentages
  // across differently-sized positions misrepresents overall performance.
  const mvValues = positions.map(p => p.marketValue);
  const plValues = positions.map(p => p.unrealizedPl);
  const allNumeric = arr => arr.every(v => typeof v === 'number' && Number.isFinite(v));
  const totalsKnown = allNumeric(mvValues) && allNumeric(plValues);
  let totalsRow = '';
  if (totalsKnown) {
    const totalMv = mvValues.reduce((sum, v) => sum + v, 0);
    const totalPl = plValues.reduce((sum, v) => sum + v, 0);
    const totalCostBasis = totalMv - totalPl;
    const totalPlPct = totalCostBasis > 0 ? (totalPl / totalCostBasis) * 100 : null;
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
function renderArchitectureVerifiedMeta(data) {
  const meta = document.getElementById('archVerifiedMeta');
  if (!meta) return;
  const verifiedAt = data.system && data.system.lastVerifiedAt;
  if (!verifiedAt) {
    meta.textContent = '';
    meta.title = '';
    return;
  }
  meta.textContent = 'Verified ' + (timeAgo(verifiedAt) || 'earlier');
  meta.title = 'Description last confirmed against Alpha\'s real code at ' + formatAbsolute(verifiedAt);
}

function renderArchitecture(data) {
  renderArchitectureVerifiedMeta(data);
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
  const hasAggregate = g && (g.generation != null || g.activeLineages != null || g.lastBreedingEventAt != null);
  if (!hasAggregate && !lineages.length) return; // keep the built-in "awaiting live connection" empty state

  panel.classList.remove('empty-panel');

  const summaryHtml = hasAggregate ? `
    <div class="stat-row">
      ${statTile(g.generation != null ? escapeHtml(String(g.generation)) : 'awaiting connection', 'Generation', null, g.generation == null)}
      ${statTile(g.activeLineages != null ? escapeHtml(String(g.activeLineages)) : 'awaiting connection', 'Active lineages', null, g.activeLineages == null)}
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

function renderBrowserDiagnostics(connCheckCount, regimeObservationCount, latencySampleCount) {
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
        ? 'Connectivity checks, regime history, and the last-known-state cache all persist here.'
        : 'Private browsing or a locked profile. Connectivity/regime history and the last-known-state cache will not persist across reloads.'),
    diagnosticRow('Notifications', notifyStatus, notifyBadge,
      !notifySupported ? 'Not supported in this browser.' : (Notification.permission === 'granted' ? 'Critical alerts can fire natively when this tab is backgrounded.' : Notification.permission === 'denied' ? 'Critical alerts are muted; re-enable from this browser’s own site settings.' : 'Permission not yet requested (use "Enable critical alerts" above).')),
    diagnosticRow('Service worker', swStatus, serviceWorkerDiagnostic.toUpperCase(),
      swStatus === 'ok' ? 'Offline app-shell caching is active.' : 'Offline app-shell caching may be unavailable.'),
    diagnosticRow('Connectivity checks recorded', storageOk ? 'ok' : 'blocked', String(connCheckCount),
      'Real connectivity results recorded by this browser (see Connection above).'),
    diagnosticRow('Regime observations recorded', storageOk ? 'ok' : 'blocked', String(regimeObservationCount),
      'Real regime transitions this browser has actually observed (see Regime history above).'),
    diagnosticRow('Fetch latency samples recorded', storageOk ? 'ok' : 'blocked', String(latencySampleCount),
      'Real round-trip timings of this browser\'s own requests to Command Center (see the Connection strip above).')
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
    renderIncidents(data, clientConnHistory);
    renderRegimeHistory(clientRegimeHistory);
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
    renderBrowserDiagnostics(clientConnHistory.length, clientRegimeHistory.length, clientLatencyHistory.length);
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
    '- Genealogy: ' + (() => {
      const g = live.genealogy || {};
      if (g.generation == null && g.activeLineages == null && g.lastBreedingEventAt == null) return awaiting;
      const gen = g.generation != null ? 'gen ' + g.generation : awaiting;
      const lineageCount = g.activeLineages != null
        ? g.activeLineages + ' active lineage' + (g.activeLineages === 1 ? '' : 's')
        : awaiting;
      const lastEvent = g.lastBreedingEventAt
        ? 'last breeding event ' + (timeAgo(g.lastBreedingEventAt) || formatAbsolute(g.lastBreedingEventAt))
        : 'no breeding event recorded';
      return gen + ', ' + lineageCount + ', ' + lastEvent;
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
// fetch-latency, and regime-observation logs (CLIENT_CONN_HISTORY_KEY,
// CLIENT_LATENCY_HISTORY_KEY, CLIENT_REGIME_HISTORY_KEY above) live only in
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
    clientRegimeHistory: loadClientRegimeHistory()
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
setInterval(() => {
  if (document.visibilityState === 'visible') {
    loadStatus();
    // Market open/closed never comes from the /api/alpha/live fetch above
    // (see computeMarketStatus's own comment), so it needs its own tick on
    // the same cadence rather than piggybacking on loadStatus succeeding.
    renderMarketStatus();
  }
}, REFRESH_INTERVAL_MS);

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
renderBrowserDiagnostics(loadClientConnHistory().length, loadClientRegimeHistory().length, loadClientLatencyHistory().length);
// Same "render immediately, independent of the network fetch" reasoning as
// the diagnostics call above: market open/closed has no dependency on
// /api/alpha/live succeeding at all, so it shouldn't wait on it.
renderMarketStatus();
loadStatus();

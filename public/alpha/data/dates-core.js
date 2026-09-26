/*
 * Pure date/time math shared between the Alpha hub's own page
 * (public/alpha/app.js) and this file's own test suite (dates-core.test.js).
 * No DOM, no Node-only APIs, same shared-core pattern already proven at
 * public/sondrik/data/goals-core.js, so the market-calendar, uptime, and
 * incident math that renders this page can actually be unit-tested instead
 * of only ever running live in a browser, once a day, at whatever time
 * someone happens to load the page.
 *
 * This matters more here than most: computeMarketStatus below encodes a
 * fixed NYSE holiday/early-close calendar by hand (see its own comment) and
 * has never been exercised on any of those actual dates by a real page
 * load, since none of them have occurred yet. A regression here would sit
 * silent until the first real holiday after it broke, on a page whose whole
 * job is to be trusted at a glance.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AlphaDatesCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  // Source: NYSE's own 2026 trading calendar
  // (nyse.com/publicdocs/nyse/ICE_NYSE_2026_Yearly_Trading_Calendar.pdf),
  // corroborated against independent market-hours aggregators.
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
  // ("triple witching") days as early closes, despite that claim appearing
  // on some secondary market-hours sites; only these two are real.
  const MARKET_EARLY_CLOSES_2026 = new Set([
    '2026-11-27',
    '2026-12-24'
  ]);

  // Source: NYSE Group's own press release covering 2026, 2027, and 2028
  // (ir.theice.com, "NYSE Group Announces 2026, 2027 and 2028 Holiday and
  // Early Closings Calendar"), corroborated against independent
  // market-hours aggregators. Added 2026-09-25, well before this file's own
  // year-gate below would have started reporting 2027 as unknown: the
  // gap between "today" and the next uncovered January 1st is exactly the
  // silent-failure window this file's header comment warns about, so this
  // was added while there was still time to actually verify it against a
  // real page load, not right as it started mattering.
  const MARKET_HOLIDAYS_2027 = new Set([
    '2027-01-01', // New Year's Day
    '2027-01-18', // Martin Luther King Jr. Day
    '2027-02-15', // Washington's Birthday (Presidents Day)
    '2027-03-26', // Good Friday
    '2027-05-31', // Memorial Day
    '2027-06-18', // Juneteenth National Independence Day (observed; June 19 falls on a Saturday)
    '2027-07-05', // Independence Day (observed; July 4 falls on a Sunday)
    '2027-09-06', // Labor Day
    '2027-11-25', // Thanksgiving Day
    '2027-12-24'  // Christmas Day (observed; December 25 falls on a Saturday)
  ]);
  // Only one recurring early close in 2027, not the usual two: Christmas Day
  // falling on a Saturday means its observed holiday (Dec 24 above) is
  // already a full closure, leaving no separate Christmas Eve early-close
  // day that year.
  const MARKET_EARLY_CLOSES_2027 = new Set([
    '2027-11-26'
  ]);

  const MARKET_CALENDAR_YEARS = [2026, 2027];
  // Union across every covered year, not just whichever one "today" happens
  // to fall in: nextTradingDayFrom can walk forward across a year boundary
  // (e.g. from late December into January), and needs next year's holidays
  // already in scope for that walk to skip them correctly, weeks before
  // that year actually starts as far as computeMarketStatus's own year gate
  // below is concerned.
  const ALL_KNOWN_HOLIDAYS = new Set([...MARKET_HOLIDAYS_2026, ...MARKET_HOLIDAYS_2027]);
  const ALL_KNOWN_EARLY_CLOSES = new Set([...MARKET_EARLY_CLOSES_2026, ...MARKET_EARLY_CLOSES_2027]);

  // `date` defaults to the real current instant; a test passes a fixed Date
  // so the same holiday/early-close/weekend/after-hours branches can be
  // exercised on demand instead of only on the one real calendar day they
  // happen to fall on.
  function nowInET(date) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', hour12: false, weekday: 'short',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    }).formatToParts(date || new Date());
    const map = {};
    parts.forEach(p => { map[p.type] = p.value; });
    return map;
  }

  function isTradingDayKey(dateKey, weekday) {
    return weekday !== 'Sat' && weekday !== 'Sun' && !ALL_KNOWN_HOLIDAYS.has(dateKey);
  }

  // Walks forward a plain UTC calendar date (used only as a date, never as a
  // real instant) to find the next real trading day, skipping weekends and
  // every known year's holiday list above. 14-day cap is just a safety
  // bound; the longest real gap on the calendar (the Christmas/New Year
  // stretch) is a handful of days.
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
  // extended sessions, since "regular hours open/closed" is the one
  // distinction that actually explains what the rest of this page is
  // showing. `date` defaults to now; see nowInET above.
  function computeMarketStatus(date) {
    const p = nowInET(date);
    const dateKey = `${p.year}-${p.month}-${p.day}`;
    const weekday = p.weekday;
    if (!MARKET_CALENDAR_YEARS.includes(Number(p.year))) {
      const latestYear = Math.max(...MARKET_CALENDAR_YEARS);
      return {
        isOpen: false,
        isUnknown: true,
        label: 'Market status unknown',
        detail: `Holiday calendar only covers ${MARKET_CALENDAR_YEARS.join('/')}, open/closed can't be trusted past it. Add a MARKET_HOLIDAYS_${p.year}/MARKET_EARLY_CLOSES_${p.year} set to alpha/data/dates-core.js once NYSE publishes ${p.year > latestYear ? p.year : 'that year\'s'} calendar.`
      };
    }
    const minutesNow = Number(p.hour) * 60 + Number(p.minute);
    const isHoliday = ALL_KNOWN_HOLIDAYS.has(dateKey);
    const isWeekend = weekday === 'Sat' || weekday === 'Sun';
    const isEarlyClose = ALL_KNOWN_EARLY_CLOSES.has(dateKey);
    const tradingDay = isTradingDayKey(dateKey, weekday);
    const openMin = 9 * 60 + 30;
    const closeMin = isEarlyClose ? 13 * 60 : 16 * 60;
    const isOpen = tradingDay && minutesNow >= openMin && minutesNow < closeMin;

    // The pill's own detail already spells out the exact close/open clock
    // time, but reading "closes 4:00 PM ET" still costs a reader their own
    // mental subtraction against whatever time it is right now. Both branches
    // below stay same-calendar-day arithmetic on minutesNow (already a
    // timezone-correct ET wall-clock minute from nowInET, not a manual UTC
    // offset), so this never has to reason about a DST transition landing
    // between now and the target: NYSE hours never span one. A countdown to
    // an open more than a day out is deliberately left alone, same "don't
    // model what isn't cheaply exact" restraint nextTradingDayFrom already
    // applies to weekday math, since simulating cross-day ET wall-clock
    // arithmetic here would risk exactly the kind of one-off DST bug this
    // file's own header comment warns a page like this can't afford.
    if (isOpen) {
      const closeCountdown = formatDuration((closeMin - minutesNow) * 60000);
      return {
        isOpen: true,
        label: 'Market open' + (closeCountdown ? ' · closes in ' + closeCountdown : ''),
        detail: 'Closes ' + (isEarlyClose ? '1:00 PM ET (early close)' : '4:00 PM ET') + ' · regular NYSE session'
      };
    }

    const next = (tradingDay && minutesNow < openMin) ? { key: dateKey, weekday } : nextTradingDayFrom(dateKey, false);
    const reason = isHoliday ? 'holiday' : isWeekend ? 'weekend' : null;
    let detail = 'Regular NYSE session, next open unknown';
    let openCountdown = null;
    if (next) {
      const opensToday = next.key === dateKey;
      const dateLabel = opensToday
        ? 'today'
        : new Date(next.key + 'T00:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
      detail = 'Opens ' + dateLabel + ' 9:30 AM ET · regular NYSE session';
      if (opensToday) openCountdown = formatDuration((openMin - minutesNow) * 60000);
    }
    return {
      isOpen: false,
      label: 'Market closed' + (reason ? ' (' + reason + ')' : '') + (openCountdown ? ' · opens in ' + openCountdown : ''),
      detail
    };
  }

  // `now` defaults to Date.now(); a test passes a fixed timestamp so the
  // minute/hour/day boundaries below are exercised deterministically.
  function timeAgo(iso, now) {
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return null;
    const diffMs = (now == null ? Date.now() : now) - then;
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
  function freshnessClass(iso, now) {
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return 'down';
    const mins = ((now == null ? Date.now() : now) - then) / 60000;
    if (mins < 1) return 'live';
    if (mins < 15) return 'stale';
    return 'down';
  }

  // The one glance-first signal at the very top of the page, above every
  // detailed section. Derived entirely from fields the page already has
  // (connection state, reading freshness, kill-switch state), never from
  // anything invented. Kill switch engaged always wins: it is the one state
  // Jack would want to see even from across the room, current or last known.
  // isLastKnown marks that `data.live` has been substituted with a cached
  // last-known-connected reading (see app.js's own loadLastKnown); the
  // headline must say so explicitly rather than let a stale reading pass as
  // current. `now` defaults to Date.now(), same testability convention as
  // timeAgo/freshnessClass above, since this branches on the exact same
  // freshness boundaries.
  function computeHeadline(data, isLastKnown, now) {
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
      return { level: 'lastknown', text: 'Disconnected - showing last known state from ' + (timeAgo(asOf, now) || 'earlier'), asOf };
    }
    if (!data.connection.connected || !asOf) {
      return { level: 'awaiting', text: 'Awaiting live connection', asOf };
    }
    const cls = freshnessClass(asOf, now);
    if (cls === 'down') return { level: 'awaiting', text: 'Connected, reading stale', asOf };
    // A real stuck-agent anomaly is worth surfacing here too, not only on the
    // Summary tile further down the page: this headline is the one glance a
    // background tab (or a phone screenshot) actually gives, same "match the
    // highest-impact signal, never understate it" rule real status pages
    // apply to their own top-line badge. A null stuckCount (the /anomalies
    // subrequest itself failed, see live.anomalies.* in the schema table) is
    // never treated as "0 stuck agents" here either, same honest-unknown
    // rule the Summary tile already follows: only a real positive count
    // moves this headline off "good".
    const stuckCount = live.anomalies && live.anomalies.stuckCount;
    const anomalyText = typeof stuckCount === 'number' && stuckCount > 0
      ? stuckCount + ' stuck agent' + (stuckCount === 1 ? '' : 's') + ' detected'
      : null;
    if (cls === 'stale') {
      return { level: 'caution', text: anomalyText ? 'Connected, reading aging, ' + anomalyText : 'Connected, reading aging', asOf };
    }
    if (anomalyText) return { level: 'caution', text: 'Connected, ' + anomalyText, asOf };
    return { level: 'good', text: 'Connected', asOf };
  }

  // Shared decision logic behind recordClientRegimeObservation and
  // recordClientSizingModeObservation in app.js: both keep an honest,
  // append-only, capped, client-side log of a real string value (regime,
  // sizing mode) that Alpha's live feed only ever sends as a single current
  // reading, never a history. Only records while genuinely connected with a
  // real, truthy value (a last-known/frozen or awaiting-connection reading
  // is not a new observation), and only when it actually differs from the
  // last recorded entry, so a value that hasn't changed since the last
  // check doesn't pad the log with identical repeats. Returns the exact same
  // array reference when nothing changed, so a caller can tell "was this a
  // real append" via `next !== history` without a separate flag. `field`
  // names the property the value is stored under (e.g. 'regime', 'mode'),
  // kept distinct rather than a single generic shape so each history's real
  // persisted entries (and any already sitting in a real browser's
  // localStorage from before this was extracted) keep the exact same shape.
  function appendDedupedStringObservation(history, connected, value, field, cap, now) {
    if (!connected || !value) return history;
    const last = history[history.length - 1];
    if (last && last[field] === value) return history;
    const at = new Date(now == null ? Date.now() : now).toISOString();
    return [...history, { at, [field]: value }].slice(-cap);
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

  function mostRecentConnectedAt(history) {
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i] && history[i].connected) return history[i].at;
    }
    return null;
  }

  // Statuspage/UptimeRobot-style incident duration: not just "last check was
  // up/down" but how long the current state has held, e.g. "Down for 3h
  // 12m". Derived by walking connection.history backward from the newest
  // entry while its connected value keeps matching the current one, and
  // taking the oldest such entry's timestamp as when the current streak
  // began. Built only from real recorded checks; returns null (nothing
  // shown) when there isn't enough history to derive it from, same
  // honest-empty-state rule as everything else on this page.
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
    // A run still open when the loop ends means the most recent check in
    // this history was still "not connected", i.e. a real outage still in
    // progress as of the last recorded check, not one this page is guessing
    // has ended.
    if (open) incidents.push(open);
    return incidents;
  }

  function dayKeyLocal(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function computeDailyUptimeBuckets(history, dayLimit) {
    if (!Array.isArray(history) || !history.length) return [];
    const byDay = new Map();
    for (const entry of history) {
      if (!entry || !entry.at) continue;
      const key = dayKeyLocal(entry.at);
      if (!key) continue;
      const bucket = byDay.get(key) || { dateKey: key, total: 0, up: 0 };
      bucket.total += 1;
      if (entry.connected) bucket.up += 1;
      byDay.set(key, bucket);
    }
    const days = [...byDay.values()].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
    const limit = dayLimit == null ? 90 : dayLimit;
    return days.slice(-limit).map(d => ({ ...d, pct: (d.up / d.total) * 100 }));
  }

  // 'full' (every check that day connected), 'degraded' (some but not all),
  // 'down' (every check that day failed): the same three-tier read real
  // status pages give a day, and the same "pattern as well as color" guard
  // the per-check tick strip already follows.
  function dailyUptimeClass(pct) {
    if (pct >= 99.9) return 'full';
    if (pct > 0) return 'degraded';
    return 'down';
  }

  return {
    MARKET_HOLIDAYS_2026,
    MARKET_EARLY_CLOSES_2026,
    MARKET_HOLIDAYS_2027,
    MARKET_EARLY_CLOSES_2027,
    MARKET_CALENDAR_YEARS,
    nowInET,
    isTradingDayKey,
    nextTradingDayFrom,
    computeMarketStatus,
    timeAgo,
    freshnessClass,
    computeHeadline,
    appendDedupedStringObservation,
    formatDuration,
    mostRecentConnectedAt,
    currentStateStartedAt,
    computeIncidents,
    dayKeyLocal,
    computeDailyUptimeBuckets,
    dailyUptimeClass
  };
});

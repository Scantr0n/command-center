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
  // corroborated against independent market-hours aggregators. Update this
  // list (and MARKET_CALENDAR_YEAR) once NYSE publishes 2027's.
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
  const MARKET_CALENDAR_YEAR = 2026;

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
    return weekday !== 'Sat' && weekday !== 'Sun' && !MARKET_HOLIDAYS_2026.has(dateKey);
  }

  // Walks forward a plain UTC calendar date (used only as a date, never as a
  // real instant) to find the next real trading day, skipping weekends and
  // the fixed 2026 holiday list above. 14-day cap is just a safety bound;
  // the longest real gap on the calendar (the Christmas/New Year stretch) is
  // a handful of days.
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
    if (Number(p.year) !== MARKET_CALENDAR_YEAR) {
      return {
        isOpen: false,
        isUnknown: true,
        label: 'Market status unknown',
        detail: `Holiday calendar only covers ${MARKET_CALENDAR_YEAR}, open/closed can't be trusted past it. Update MARKET_HOLIDAYS_2026 and MARKET_EARLY_CLOSES_2026 in alpha/data/dates-core.js for ${p.year}.`
      };
    }
    const minutesNow = Number(p.hour) * 60 + Number(p.minute);
    const isHoliday = MARKET_HOLIDAYS_2026.has(dateKey);
    const isWeekend = weekday === 'Sat' || weekday === 'Sun';
    const isEarlyClose = MARKET_EARLY_CLOSES_2026.has(dateKey);
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
    MARKET_CALENDAR_YEAR,
    nowInET,
    isTradingDayKey,
    nextTradingDayFrom,
    computeMarketStatus,
    timeAgo,
    freshnessClass,
    formatDuration,
    mostRecentConnectedAt,
    currentStateStartedAt,
    computeIncidents,
    dayKeyLocal,
    computeDailyUptimeBuckets,
    dailyUptimeClass
  };
});

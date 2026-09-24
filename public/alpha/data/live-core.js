/*
 * Pure money-math and history-derived event logic shared between server.js's
 * /api/alpha/live route (the only place this currently runs) and this
 * file's own regression test suite (live-core.test.js). No Node-only APIs
 * (fs, child_process, etc.), same shared-core pattern already proven at
 * this hub's own account-core.js, dates-core.js, and regime-core.js, and at
 * every other hub's own *-core.js.
 *
 * Unlike those other core files, this one previously lived inline inside
 * server.js itself with zero test coverage anywhere: real drawdown percent,
 * real account P&L, every dollar figure in the positions table, and the
 * connection/kill-switch state-transition detection that drives the
 * Activity log were all computed by code no regression test had ever
 * exercised, the exact gap account-core.js's own header comment already
 * flags for the client-side half of this same feed. killSwitchStateEvents
 * in particular already has a documented real near-miss (see its own
 * comment): the debounce it feeds used to key only on `connected`, which
 * would have silently dropped a real paused-flag transition landing in the
 * same window as an unrelated heartbeat. Real money math and real event
 * detection deserve the same coverage whether they run in the browser or
 * in the server process.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AlphaLiveCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  // Real peak-to-trough drawdown, computed from the daemon's actual equity
  // curve (never estimated): walks the real history tracking the running
  // peak, and returns how far the latest point sits below the running peak
  // at that moment (current) plus the deepest such gap ever seen (max).
  // Standard drawdown definition, nothing invented, mirrors what Alpha's own
  // sizing logic already reacts to internally.
  function computeDrawdowns(history) {
    if (!Array.isArray(history) || !history.length) return { currentDrawdownPct: null, maxDrawdownPct: null };
    let peak = history[0].v;
    let maxDrawdownPct = 0;
    for (const point of history) {
      if (point.v > peak) peak = point.v;
      const dd = peak > 0 ? ((peak - point.v) / peak) * 100 : 0;
      if (dd > maxDrawdownPct) maxDrawdownPct = dd;
    }
    const latest = history[history.length - 1].v;
    const currentDrawdownPct = peak > 0 ? ((peak - latest) / peak) * 100 : 0;
    return {
      currentDrawdownPct: Math.round(currentDrawdownPct * 100) / 100,
      maxDrawdownPct: Math.round(maxDrawdownPct * 100) / 100
    };
  }

  // Alpaca's real position/account payloads carry every internal margin and
  // ID field the broker tracks; only pulls the subset a glance-at-status page
  // actually needs; converts Alpaca's string numbers to real numbers once
  // here rather than in every render function.
  function mapPositions(rawPositions) {
    return Object.values(rawPositions || {}).map(p => ({
      symbol: p.symbol,
      side: p.side,
      qty: Number(p.qty),
      avgEntryPrice: Number(p.avg_entry_price),
      currentPrice: Number(p.current_price),
      marketValue: Number(p.market_value),
      unrealizedPl: Number(p.unrealized_pl),
      unrealizedPlPct: Number(p.unrealized_plpc) * 100
    })).sort((a, b) => b.marketValue - a.marketValue);
  }

  function mapAccount(rawAccount) {
    if (!rawAccount) return null;
    const equity = Number(rawAccount.equity);
    const lastEquity = Number(rawAccount.last_equity);
    return {
      equity,
      cash: Number(rawAccount.cash),
      buyingPower: Number(rawAccount.buying_power),
      portfolioValue: Number(rawAccount.portfolio_value),
      dayChangeDollar: Number.isFinite(equity) && Number.isFinite(lastEquity) ? equity - lastEquity : null,
      dayChangePct: Number.isFinite(equity) && Number.isFinite(lastEquity) && lastEquity !== 0
        ? ((equity - lastEquity) / lastEquity) * 100 : null
    };
  }

  // The daemon's /equity-history is already fetched for computeDrawdowns
  // above, which only ever reads point.v, then the rest of each point was
  // discarded. This maps the same already-trusted field into a plain number
  // series so the page can show a real equity trend instead of just today's
  // single derived drawdown percentage. Defensive and capped like every
  // other real-feed mapper here; no timestamp field is read, since only .v
  // is a field this codebase has ever actually verified against the
  // daemon's real response.
  const EQUITY_CURVE_POINT_CAP = 200;
  function mapEquityCurve(history) {
    if (!Array.isArray(history)) return [];
    return history
      .map(p => Number(p && p.v))
      .filter(v => Number.isFinite(v))
      .slice(-EQUITY_CURVE_POINT_CAP);
  }

  // Turns the daemon's real evolution-history entries into the honest
  // activity-log shape the Alpha page already renders. Only ever built from
  // fields the daemon actually returned, never invented.
  function evolutionEvents(history) {
    return history.map(entry => {
      const agents = entry.agents || {};
      const switches = Object.entries(agents).filter(([, a]) => a.switchedFrom);
      const detail = switches.length
        ? switches.map(([id, a]) => `${id}: ${a.switchedFrom} to ${a.strategy}`).join(', ')
        : `${Object.keys(agents).length} agents re-evolved, no strategy switches`;
      return {
        type: 'evolution',
        tone: 'neutral',
        label: `Weekly evolution run (${entry.interval || 'unknown interval'})`,
        detail,
        at: entry.timestamp
      };
    });
  }

  // The Activity log's own empty state already promises "connection state
  // changes" alongside kill-switch triggers and regime changes, but nothing
  // ever populated that, since connection.history above only started
  // persisting real checks just now. This turns that same real, just-persisted
  // history into real events the moment the state actually flips between
  // consecutive checks, oldest first; never a separate guess, just a diff over
  // data already being recorded for the connectivity strip.
  function connectionStateEvents(history) {
    const events = [];
    for (let i = 1; i < history.length; i++) {
      if (history[i].connected === history[i - 1].connected) continue;
      events.push({
        type: 'connection',
        tone: history[i].connected ? 'good' : 'alert',
        label: history[i].connected ? 'Connection restored' : 'Connection lost',
        at: history[i].at
      });
    }
    return events;
  }

  // Same real-transition-only rule as connectionStateEvents above, applied to
  // `paused` instead of `connected`. Only compares adjacent entries where both
  // sides have a known (non-null) paused reading, i.e. both checks actually
  // reached the daemon: a gap where the connection dropped and came back with
  // a different paused value is a real transition Alpha's own daemon made
  // while unobserved, not one this page watched happen, so it's deliberately
  // not reported as an event (same spirit as connectionStateEvents never
  // guessing what happened between two checks).
  function killSwitchStateEvents(history) {
    const events = [];
    for (let i = 1; i < history.length; i++) {
      const prev = history[i - 1].paused;
      const curr = history[i].paused;
      if (prev == null || curr == null || prev === curr) continue;
      events.push({
        type: 'kill-switch',
        tone: curr ? 'alert' : 'good',
        label: curr ? 'Kill switch engaged' : 'Kill switch released',
        at: history[i].at
      });
    }
    return events;
  }

  // live.killSwitch.lastTriggeredAt was always sent as a hardcoded `null`
  // before, even while `engaged` read true, which rendered as the actively
  // contradictory "ENGAGED / Never triggered" on a real-money status page:
  // a real reading claiming no trigger ever happened while showing one in
  // progress. This derives a real answer the same honest way as every other
  // "since this server started observing" figure on this page (connection
  // uptime, regime distribution): the timestamp of the most recent real
  // false-to-true transition this server has actually recorded. Returns null,
  // same as before, until a real transition has actually been observed, never
  // a guess at what happened before this history started.
  function lastKillSwitchTriggerAt(history) {
    const triggers = killSwitchStateEvents(history).filter(e => e.tone === 'alert');
    return triggers.length ? triggers[triggers.length - 1].at : null;
  }

  // The daemon's real /anomalies endpoint reports currently-stuck agents as
  // of that one check, a live snapshot no different in kind from
  // killSwitch.engaged, never a running tally. server.js falls back to
  // `{ stuck: null }` when that one subrequest fails while /health and
  // /state still succeed, so null in means null out here too: an honest
  // "unknown", never a guessed 0 that would misreport a failed check as a
  // clean one.
  function mapAnomalies(anomalies, fallbackCheckedAt) {
    if (!anomalies || !Array.isArray(anomalies.stuck)) return { stuckCount: null, checkedAt: null };
    return { stuckCount: anomalies.stuck.length, checkedAt: anomalies.checkedAt || fallbackCheckedAt || null };
  }

  return {
    computeDrawdowns, mapPositions, mapAccount, mapEquityCurve, EQUITY_CURVE_POINT_CAP,
    evolutionEvents, connectionStateEvents, killSwitchStateEvents, lastKillSwitchTriggerAt,
    mapAnomalies
  };
});

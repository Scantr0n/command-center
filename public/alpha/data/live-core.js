/*
 * Pure money-math shared between server.js's /api/alpha/live route (the only
 * place this currently runs) and this file's own regression test suite
 * (live-core.test.js). No Node-only APIs (fs, child_process, etc.), same
 * shared-core pattern already proven at this hub's own account-core.js,
 * dates-core.js, and regime-core.js, and at every other hub's own
 * *-core.js.
 *
 * Unlike those other core files, this one previously lived inline inside
 * server.js itself with zero test coverage anywhere: real drawdown percent,
 * real account P&L, and every dollar figure in the positions table were
 * computed by code no regression test had ever exercised, the exact gap
 * account-core.js's own header comment already flags for the client-side
 * half of this same feed. Real money math deserves the same coverage
 * whether it happens to run in the browser or in the server process.
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

  return { computeDrawdowns, mapPositions, mapAccount, mapEquityCurve, EQUITY_CURVE_POINT_CAP };
});

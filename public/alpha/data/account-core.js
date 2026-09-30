/*
 * Pure account/position money math shared between the Alpha hub's own page
 * (public/alpha/app.js) and this file's own test suite
 * (account-core.test.js). No DOM, no Node-only APIs, same shared-core
 * pattern already proven at public/sondrik/data/goals-core.js and this
 * hub's own dates-core.js.
 *
 * This is exactly the code the page's own comments already flag as having
 * produced a real bug with no regression test: computeExposure's own
 * comment describes an earlier version that "used to silently treat one
 * position's missing marketValue as $0 instead of admitting the total
 * itself is unknown", so this panel and the positions table beneath it
 * could report two different totals for the same data. No live position
 * feed has ever existed yet, so nothing has exercised any of this math on
 * a real page load; this is what would have caught that bug, and what
 * catches the next one before real money numbers are on screen.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AlphaAccountCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
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
  // above, applied to share quantity: a missing/malformed qty from a future
  // feed shape should fall back to '-' like every other cell in a row, not
  // Math.abs(undefined)'s literal "NaN" text next to real dollar figures.
  function fmtQty(n) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return null;
    return String(Math.abs(n));
  }

  // Total invested and % of equity deployed are never fetched as their own
  // field: they're derived client-side from live.account.equity and the real
  // live.positions[].marketValue figures server.js already sends. account is
  // only ever populated once the live proxy is connected, and positions.length
  // being 0 at that point is a real "fully in cash" reading, not an unknown,
  // so totalInvested is safe to report as exactly $0 rather than "-".
  function computeExposure(acct, positions) {
    if (!acct) return { totalInvested: null, pctDeployed: null };
    const marketValues = (positions || []).map(p => p.marketValue);
    // Filtering out the bad values and summing the rest would silently treat
    // one position's missing marketValue as $0 instead of admitting the
    // total itself is unknown, the real bug this guard exists to prevent
    // (see this file's own header comment); all-or-nothing instead.
    if (marketValues.length && !marketValues.every(v => typeof v === 'number' && Number.isFinite(v))) {
      return { totalInvested: null, pctDeployed: null };
    }
    const totalInvested = marketValues.reduce((sum, v) => sum + v, 0);
    const pctDeployed = (typeof acct.equity === 'number' && Number.isFinite(acct.equity) && acct.equity > 0)
      ? (totalInvested / acct.equity) * 100
      : null;
    return { totalInvested, pctDeployed };
  }

  // Positions-table totals row: a real portfolio-level number, summed only
  // from the same real per-row marketValue/unrealizedPl fields the table
  // already renders, and only when every row has a real number to sum,
  // never partially totaled against a row silently treated as zero (same
  // all-or-nothing rule as computeExposure above, and for the same reason).
  // The aggregate P&L% is computed against total cost basis (mktValue - pl
  // per row, the real amount actually paid), not averaged from the per-row
  // percentages, since averaging percentages across differently-sized
  // positions misrepresents overall performance.
  function computePositionsTotals(positions) {
    const list = positions || [];
    const mvValues = list.map(p => p.marketValue);
    const plValues = list.map(p => p.unrealizedPl);
    const allNumeric = arr => arr.length > 0 && arr.every(v => typeof v === 'number' && Number.isFinite(v));
    const totalsKnown = allNumeric(mvValues) && allNumeric(plValues);
    if (!totalsKnown) {
      return { totalsKnown: false, totalMv: null, totalPl: null, totalPlPct: null, totalDayChangeDollar: null, totalDayChangePct: null };
    }
    const totalMv = mvValues.reduce((sum, v) => sum + v, 0);
    const totalPl = plValues.reduce((sum, v) => sum + v, 0);
    const totalCostBasis = totalMv - totalPl;
    const totalPlPct = totalCostBasis > 0 ? (totalPl / totalCostBasis) * 100 : null;
    // Kept independent of totalsKnown above: dayChangeDollar (see
    // mapPositions in live-core.js) can be genuinely absent on an older
    // cached snapshot or a feed that hasn't reported intraday figures yet
    // even while marketValue/unrealizedPl are both known, so this must be
    // able to report its own honest-unknown rather than block, or falsely
    // report, the P&L totals above.
    const dayChangeValues = list.map(p => p.dayChangeDollar);
    const dayChangeKnown = allNumeric(dayChangeValues);
    const totalDayChangeDollar = dayChangeKnown ? dayChangeValues.reduce((sum, v) => sum + v, 0) : null;
    // Same "% against real yesterday's-close basis, not an averaged
    // per-row percentage" rule as totalPlPct above: yesterday's aggregate
    // value is today's totalMv minus today's aggregate move.
    const totalDayChangePct = dayChangeKnown && (totalMv - totalDayChangeDollar) > 0
      ? (totalDayChangeDollar / (totalMv - totalDayChangeDollar)) * 100
      : null;
    return { totalsKnown: true, totalMv, totalPl, totalPlPct, totalDayChangeDollar, totalDayChangePct };
  }

  // Real risk-dashboard convention (portfolio concentration risk): pairing a
  // position's dollar size with what share of the whole account it actually
  // represents catches an oversized single-name bet a raw market-value
  // column alone doesn't, e.g. a $50k position reads very differently in a
  // $2M account than in a $200k one. Same derived-client-side,
  // never-fetched-as-its-own-field pattern as computeExposure's pctDeployed
  // above: only equity and the row's own real marketValue, both fields this
  // page already has, nothing new asked of the feed. Returns null (never 0)
  // whenever either input isn't a real usable number, same "unknown, not
  // zero" rule pctDeployed already follows, so a bad reading never renders
  // as a falsely reassuring 0% concentration.
  function positionConcentrationPct(marketValue, equity) {
    if (typeof marketValue !== 'number' || !Number.isFinite(marketValue)) return null;
    if (typeof equity !== 'number' || !Number.isFinite(equity) || equity <= 0) return null;
    return (marketValue / equity) * 100;
  }

  // Standard trading-dashboard risk convention (gross vs net exposure): the
  // signed marketValue Alpaca already sends per position (positive for a
  // long, negative for a short) sums to a real net figure in
  // computePositionsTotals' totalMv above, but a net-only number hides a
  // book that's actually long AND short at the same time, e.g. a $10k long
  // plus a $10k short nets to $0 exposure even though there are two real
  // open positions with real, opposite risk. This is the gross split of
  // that same real signed field, grouped by the real `side` Alpaca reports,
  // never a second guess at direction from the sign alone (a short's
  // marketValue is expected to already read negative; this trusts the
  // daemon's own `side` label instead of inferring it, so a feed that ever
  // disagreed with itself surfaces as "unknown" rather than being silently
  // resolved one way). Same all-or-nothing honesty rule as
  // computePositionsTotals: one bad marketValue or an unrecognized side
  // voids the whole breakdown rather than reporting a partial one.
  function computeSideExposure(positions) {
    const empty = { known: false, longMv: null, shortMv: null, netMv: null, longCount: 0, shortCount: 0 };
    const list = positions || [];
    if (!list.length) return empty;
    const allNumeric = list.every(p => typeof p.marketValue === 'number' && Number.isFinite(p.marketValue));
    const allSided = list.every(p => p.side === 'long' || p.side === 'short');
    if (!allNumeric || !allSided) return empty;
    const longs = list.filter(p => p.side === 'long');
    const shorts = list.filter(p => p.side === 'short');
    const longMv = longs.reduce((sum, p) => sum + p.marketValue, 0);
    const shortMv = shorts.reduce((sum, p) => sum + p.marketValue, 0);
    return { known: true, longMv, shortMv, netMv: longMv + shortMv, longCount: longs.length, shortCount: shorts.length };
  }

  return {
    fmtDollar, fmtPct, fmtQty, computeExposure, computePositionsTotals, positionConcentrationPct,
    computeSideExposure
  };
});

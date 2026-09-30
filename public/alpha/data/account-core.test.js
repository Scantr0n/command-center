#!/usr/bin/env node
/*
 * Regression tests for account-core.js, the account/position money math
 * app.js renders live. No real position feed has ever existed for this
 * hub, so none of this has ever actually run against real data; see
 * account-core.js's own header comment for the real bug (silently
 * totaling a missing marketValue as $0) this already caused once with no
 * test to catch it.
 *
 * Usage: node --test public/alpha/data/account-core.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  fmtDollar, fmtPct, fmtQty, computeExposure, computePositionsTotals, positionConcentrationPct,
  computeSideExposure
} = require('./account-core.js');

test('fmtDollar formats positive/negative amounts with a fixed 2 decimals, null for non-numbers', () => {
  assert.equal(fmtDollar(1234.5), '$1,234.50');
  assert.equal(fmtDollar(-42), '-$42.00');
  assert.equal(fmtDollar(0), '$0.00');
  assert.equal(fmtDollar(NaN), null);
  assert.equal(fmtDollar(undefined), null);
  assert.equal(fmtDollar('12'), null, 'never coerces a string');
});

test('fmtPct signs positive values with a leading +, leaves negative alone', () => {
  assert.equal(fmtPct(3.456), '+3.46%');
  assert.equal(fmtPct(-1.2), '-1.20%');
  assert.equal(fmtPct(0), '+0.00%');
  assert.equal(fmtPct(NaN), null);
});

test('fmtQty always reports a non-negative magnitude, null for non-numbers', () => {
  assert.equal(fmtQty(10), '10');
  assert.equal(fmtQty(-10), '10', 'a short position still shows a positive share count');
  assert.equal(fmtQty(NaN), null);
  assert.equal(fmtQty(undefined), null);
});

test('computeExposure is honest-null with no account, even with real positions', () => {
  assert.deepEqual(computeExposure(null, [{ marketValue: 100 }]), { totalInvested: null, pctDeployed: null });
});

test('computeExposure reports exactly $0 invested for a real "fully in cash" account', () => {
  const result = computeExposure({ equity: 5000 }, []);
  assert.equal(result.totalInvested, 0);
  assert.equal(result.pctDeployed, 0);
});

test('computeExposure is all-or-nothing: one bad marketValue voids the whole total, never partially summed', () => {
  const positions = [{ marketValue: 100 }, { marketValue: null }, { marketValue: 50 }];
  const result = computeExposure({ equity: 1000 }, positions);
  assert.equal(result.totalInvested, null, 'must not silently report 150 (treating the null as $0)');
  assert.equal(result.pctDeployed, null);
});

test('computeExposure sums real market values and computes % of equity deployed', () => {
  const positions = [{ marketValue: 300 }, { marketValue: 200 }];
  const result = computeExposure({ equity: 1000 }, positions);
  assert.equal(result.totalInvested, 500);
  assert.equal(result.pctDeployed, 50);
});

test('computeExposure leaves pctDeployed null when equity is zero, negative, or missing', () => {
  assert.equal(computeExposure({ equity: 0 }, [{ marketValue: 100 }]).pctDeployed, null);
  assert.equal(computeExposure({ equity: -5 }, [{ marketValue: 100 }]).pctDeployed, null);
  assert.equal(computeExposure({}, [{ marketValue: 100 }]).pctDeployed, null);
});

test('computePositionsTotals is all-or-nothing across both marketValue and unrealizedPl, never a partial total', () => {
  const positions = [
    { marketValue: 100, unrealizedPl: 10 },
    { marketValue: 200, unrealizedPl: null }
  ];
  const result = computePositionsTotals(positions);
  assert.equal(result.totalsKnown, false, 'must not silently report a total that skips the bad row');
  assert.equal(result.totalMv, null);
  assert.equal(result.totalPl, null);
  assert.equal(result.totalPlPct, null);
});

test('computePositionsTotals sums real rows and computes P&L% against real cost basis, not averaged per-row percentages', () => {
  // Row A: bought at 100 cost basis, now worth 120 (+20 P&L).
  // Row B: bought at 300 cost basis, now worth 270 (-30 P&L).
  const positions = [
    { marketValue: 120, unrealizedPl: 20 },
    { marketValue: 270, unrealizedPl: -30 }
  ];
  const result = computePositionsTotals(positions);
  assert.equal(result.totalsKnown, true);
  assert.equal(result.totalMv, 390);
  assert.equal(result.totalPl, -10);
  // Total cost basis: 390 - (-10) = 400. P&L%: -10 / 400 * 100 = -2.5.
  // A naive average of the two rows' own percentages (+20% and -10%) would
  // wrongly read +5%, ignoring that Row B is 3x the position size.
  assert.equal(result.totalPlPct, -2.5);
});

test('computePositionsTotals is honest-unknown (not $0) for an empty position list', () => {
  const result = computePositionsTotals([]);
  assert.equal(result.totalsKnown, false);
});

test('computePositionsTotals leaves totalPlPct null when total cost basis is zero or negative', () => {
  // Fully closed out at cost: marketValue 0, unrealizedPl 0 => cost basis 0.
  const flat = computePositionsTotals([{ marketValue: 0, unrealizedPl: 0 }]);
  assert.equal(flat.totalsKnown, true);
  assert.equal(flat.totalPlPct, null);
});

test('computePositionsTotals sums real dayChangeDollar and computes day-change% against real yesterday-close basis', () => {
  // Row A: worth 120 today, up 20 today (was 100 at yesterday's close).
  // Row B: worth 270 today, down 30 today (was 300 at yesterday's close).
  const positions = [
    { marketValue: 120, unrealizedPl: 5, dayChangeDollar: 20 },
    { marketValue: 270, unrealizedPl: 5, dayChangeDollar: -30 }
  ];
  const result = computePositionsTotals(positions);
  assert.equal(result.totalDayChangeDollar, -10);
  // Yesterday's aggregate value: 390 - (-10) = 400. Day change%: -10/400*100 = -2.5.
  assert.equal(result.totalDayChangePct, -2.5);
});

test('computePositionsTotals reports totalDayChangeDollar/Pct as null (not partial) when any row is missing dayChangeDollar', () => {
  const positions = [
    { marketValue: 100, unrealizedPl: 10, dayChangeDollar: 5 },
    { marketValue: 200, unrealizedPl: 10, dayChangeDollar: null }
  ];
  const result = computePositionsTotals(positions);
  assert.equal(result.totalsKnown, true, 'a missing dayChangeDollar must not also block the known mv/pl totals');
  assert.equal(result.totalDayChangeDollar, null);
  assert.equal(result.totalDayChangePct, null);
});

test('positionConcentrationPct is a real position-size / real equity percentage', () => {
  assert.equal(positionConcentrationPct(500, 1000), 50);
  assert.equal(positionConcentrationPct(120, 1000), 12);
});

test('positionConcentrationPct is honest-null (never 0) for a bad marketValue', () => {
  assert.equal(positionConcentrationPct(null, 1000), null);
  assert.equal(positionConcentrationPct(NaN, 1000), null);
  assert.equal(positionConcentrationPct(undefined, 1000), null);
});

test('positionConcentrationPct is honest-null (never 0) for a missing, zero, or negative equity', () => {
  assert.equal(positionConcentrationPct(100, null), null);
  assert.equal(positionConcentrationPct(100, 0), null);
  assert.equal(positionConcentrationPct(100, -50), null);
});

test('computeSideExposure is honest-unknown (not $0) for an empty position list', () => {
  const result = computeSideExposure([]);
  assert.equal(result.known, false);
  assert.equal(result.longMv, null);
});

test('computeSideExposure splits real signed market values by real side, all-long book', () => {
  const positions = [
    { side: 'long', marketValue: 300 },
    { side: 'long', marketValue: 200 }
  ];
  const result = computeSideExposure(positions);
  assert.equal(result.known, true);
  assert.equal(result.longMv, 500);
  assert.equal(result.shortMv, 0);
  assert.equal(result.netMv, 500);
  assert.equal(result.longCount, 2);
  assert.equal(result.shortCount, 0);
});

test('computeSideExposure nets a real long and a real short, matching Alpaca\'s negative-short convention', () => {
  const positions = [
    { side: 'long', marketValue: 10000 },
    { side: 'short', marketValue: -4000 }
  ];
  const result = computeSideExposure(positions);
  assert.equal(result.known, true);
  assert.equal(result.longMv, 10000);
  assert.equal(result.shortMv, -4000);
  assert.equal(result.netMv, 6000, 'a book that is both long and short must not net to the long side alone');
  assert.equal(result.longCount, 1);
  assert.equal(result.shortCount, 1);
});

test('computeSideExposure is all-or-nothing: one bad marketValue voids the whole breakdown', () => {
  const positions = [
    { side: 'long', marketValue: 100 },
    { side: 'short', marketValue: null }
  ];
  const result = computeSideExposure(positions);
  assert.equal(result.known, false, 'must not silently report the long side alone as the whole breakdown');
});

test('computeSideExposure is all-or-nothing: an unrecognized side voids the whole breakdown', () => {
  const positions = [
    { side: 'long', marketValue: 100 },
    { side: 'flat', marketValue: 50 }
  ];
  const result = computeSideExposure(positions);
  assert.equal(result.known, false, 'must not silently drop or misclassify a side this codebase has never seen the daemon send');
});

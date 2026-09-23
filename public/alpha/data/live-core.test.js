#!/usr/bin/env node
/*
 * Regression tests for live-core.js, the server-side money math behind
 * /api/alpha/live (real drawdown %, real account P&L, real position/equity
 * mapping). Previously lived inline in server.js with no test coverage at
 * all; see live-core.js's own header comment.
 *
 * Usage: node --test public/alpha/data/live-core.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { computeDrawdowns, mapPositions, mapAccount, mapEquityCurve, EQUITY_CURVE_POINT_CAP } = require('./live-core.js');

test('computeDrawdowns reports null/null for missing or empty history', () => {
  assert.deepEqual(computeDrawdowns(null), { currentDrawdownPct: null, maxDrawdownPct: null });
  assert.deepEqual(computeDrawdowns(undefined), { currentDrawdownPct: null, maxDrawdownPct: null });
  assert.deepEqual(computeDrawdowns([]), { currentDrawdownPct: null, maxDrawdownPct: null });
});

test('computeDrawdowns reports 0/0 for a monotonically rising equity curve', () => {
  const history = [{ v: 100 }, { v: 110 }, { v: 125 }];
  assert.deepEqual(computeDrawdowns(history), { currentDrawdownPct: 0, maxDrawdownPct: 0 });
});

test('computeDrawdowns computes current drawdown off the running peak, not the all-time high after a recovery', () => {
  // Peak 200 at index 1, drops to 150 (25% down), recovers to 180 (still 10% off the real peak).
  const history = [{ v: 100 }, { v: 200 }, { v: 150 }, { v: 180 }];
  const result = computeDrawdowns(history);
  assert.equal(result.currentDrawdownPct, 10, 'current reflects the latest point vs the running peak, not the trough');
  assert.equal(result.maxDrawdownPct, 25, 'max keeps the deepest gap ever seen, even after a partial recovery');
});

test('computeDrawdowns never divides by a zero or negative peak', () => {
  const history = [{ v: 0 }, { v: -5 }, { v: 10 }];
  const result = computeDrawdowns(history);
  assert.equal(Number.isFinite(result.currentDrawdownPct), true);
  assert.equal(Number.isFinite(result.maxDrawdownPct), true);
});

test('mapPositions converts Alpaca string fields to real numbers and sorts by market value descending', () => {
  const raw = {
    a: { symbol: 'AAA', side: 'long', qty: '1', avg_entry_price: '10', current_price: '12', market_value: '12', unrealized_pl: '2', unrealized_plpc: '0.2' },
    b: { symbol: 'BBB', side: 'long', qty: '5', avg_entry_price: '20', current_price: '22', market_value: '110', unrealized_pl: '10', unrealized_plpc: '0.1' }
  };
  const result = mapPositions(raw);
  assert.equal(result.length, 2);
  assert.equal(result[0].symbol, 'BBB', 'larger market value sorts first');
  assert.equal(result[0].marketValue, 110);
  assert.equal(result[1].unrealizedPlPct, 20, 'unrealized_plpc is a fraction, converted to a real percent');
});

test('mapPositions handles a missing/empty positions object as an empty book, not a crash', () => {
  assert.deepEqual(mapPositions(null), []);
  assert.deepEqual(mapPositions(undefined), []);
  assert.deepEqual(mapPositions({}), []);
});

test('mapAccount computes real day change dollar and percent from equity vs last_equity', () => {
  const result = mapAccount({ equity: '1100', last_equity: '1000', cash: '200', buying_power: '400', portfolio_value: '1100' });
  assert.equal(result.dayChangeDollar, 100);
  assert.equal(result.dayChangePct, 10);
  assert.equal(result.equity, 1100);
});

test('mapAccount returns null day change rather than a fabricated number when last_equity is missing', () => {
  const result = mapAccount({ equity: '1100', cash: '200', buying_power: '400', portfolio_value: '1100' });
  assert.equal(result.dayChangeDollar, null);
  assert.equal(result.dayChangePct, null);
});

test('mapAccount never divides by a zero last_equity', () => {
  const result = mapAccount({ equity: '100', last_equity: '0', cash: '0', buying_power: '0', portfolio_value: '100' });
  assert.equal(result.dayChangePct, null);
  assert.equal(result.dayChangeDollar, 100, 'the dollar change is still real even though the percent base is zero');
});

test('mapAccount returns null for a missing account rather than a fake all-zero shape', () => {
  assert.equal(mapAccount(null), null);
  assert.equal(mapAccount(undefined), null);
});

test('mapEquityCurve keeps only real finite numbers and caps to the most recent points', () => {
  assert.deepEqual(mapEquityCurve(null), []);
  assert.deepEqual(mapEquityCurve([{ v: 1 }, { v: 'bad' }, { v: 3 }]), [1, 3], 'a non-numeric point is dropped, not coerced to NaN/0');
  const long = Array.from({ length: EQUITY_CURVE_POINT_CAP + 20 }, (_, i) => ({ v: i }));
  const result = mapEquityCurve(long);
  assert.equal(result.length, EQUITY_CURVE_POINT_CAP);
  assert.equal(result[result.length - 1], long[long.length - 1].v, 'keeps the most recent points, not the oldest');
});

#!/usr/bin/env node
/*
 * Regression tests for live-core.js, the server-side money math and
 * history-derived event logic behind /api/alpha/live (real drawdown %, real
 * account P&L, real position/equity mapping, connection/kill-switch state
 * transitions). Previously lived inline in server.js with no test coverage
 * at all; see live-core.js's own header comment.
 *
 * Usage: node --test public/alpha/data/live-core.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  computeDrawdowns, mapPositions, mapAccount, mapEquityCurve, EQUITY_CURVE_POINT_CAP,
  evolutionEvents, connectionStateEvents, killSwitchStateEvents, lastKillSwitchTriggerAt,
  mapAnomalies
} = require('./live-core.js');

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

test('evolutionEvents describes real strategy switches, or a real no-switch count when none happened', () => {
  const history = [
    { interval: 'weekly', timestamp: '2026-01-01T00:00:00Z', agents: { a1: { switchedFrom: 'meanrev', strategy: 'momentum' } } },
    { interval: 'weekly', timestamp: '2026-01-08T00:00:00Z', agents: { a1: { strategy: 'momentum' }, a2: { strategy: 'meanrev' } } }
  ];
  const events = evolutionEvents(history);
  assert.equal(events.length, 2);
  assert.equal(events[0].detail, 'a1: meanrev to momentum');
  assert.equal(events[1].detail, '2 agents re-evolved, no strategy switches');
  assert.equal(events[0].type, 'evolution');
});

test('connectionStateEvents only reports real connected/disconnected transitions, oldest first', () => {
  const history = [
    { at: 't1', connected: true },
    { at: 't2', connected: true },
    { at: 't3', connected: false },
    { at: 't4', connected: false },
    { at: 't5', connected: true }
  ];
  const events = connectionStateEvents(history);
  assert.equal(events.length, 2);
  assert.deepEqual(events[0], { type: 'connection', tone: 'alert', label: 'Connection lost', at: 't3' });
  assert.deepEqual(events[1], { type: 'connection', tone: 'good', label: 'Connection restored', at: 't5' });
});

test('connectionStateEvents reports no events for a single entry or empty history', () => {
  assert.deepEqual(connectionStateEvents([]), []);
  assert.deepEqual(connectionStateEvents([{ at: 't1', connected: true }]), []);
});

test('killSwitchStateEvents only reports real paused-flag transitions where both sides were actually observed', () => {
  const history = [
    { at: 't1', connected: true, paused: false },
    { at: 't2', connected: true, paused: true },
    { at: 't3', connected: false, paused: null },
    { at: 't4', connected: true, paused: false }
  ];
  const events = killSwitchStateEvents(history);
  // t1 -> t2 is a real observed engage. t2 -> t3 is skipped (t3's paused is
  // unobserved, connection was down), and t3 -> t4 is skipped too for the
  // same reason even though a real release plausibly happened somewhere in
  // that unobserved gap: per the file's own comment, a transition across an
  // unobserved gap is never reported, so this is the one and only event.
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], { type: 'kill-switch', tone: 'alert', label: 'Kill switch engaged', at: 't2' });
});

test('killSwitchStateEvents never fires on a null-to-null or unchanged reading', () => {
  const history = [
    { at: 't1', connected: false, paused: null },
    { at: 't2', connected: false, paused: null },
    { at: 't3', connected: true, paused: true },
    { at: 't4', connected: true, paused: true }
  ];
  assert.deepEqual(killSwitchStateEvents(history), []);
});

test('lastKillSwitchTriggerAt returns the most recent real engage transition, null until one has happened', () => {
  assert.equal(lastKillSwitchTriggerAt([]), null);
  const neverTriggered = [{ at: 't1', connected: true, paused: false }, { at: 't2', connected: true, paused: false }];
  assert.equal(lastKillSwitchTriggerAt(neverTriggered), null);
  const triggeredTwice = [
    { at: 't1', connected: true, paused: false },
    { at: 't2', connected: true, paused: true },
    { at: 't3', connected: true, paused: false },
    { at: 't4', connected: true, paused: true }
  ];
  assert.equal(lastKillSwitchTriggerAt(triggeredTwice), 't4', 'the most recent engage, not the first');
});

test('mapAnomalies reports null/null when the subrequest itself failed, never a guessed 0', () => {
  assert.deepEqual(mapAnomalies(null), { stuckCount: null, checkedAt: null });
  assert.deepEqual(mapAnomalies(undefined), { stuckCount: null, checkedAt: null });
  assert.deepEqual(mapAnomalies({ stuck: null }), { stuckCount: null, checkedAt: null });
});

test('mapAnomalies reports a real 0 when the check succeeded and found nothing stuck', () => {
  assert.deepEqual(
    mapAnomalies({ stuck: [], checkedAt: 't1' }),
    { stuckCount: 0, checkedAt: 't1' }
  );
});

test('mapAnomalies counts real stuck-agent entries and passes through the real checkedAt', () => {
  const anomalies = { stuck: [{ agentId: 'AGENT_1' }, { agentId: 'AGENT_2' }], checkedAt: 't2' };
  assert.deepEqual(mapAnomalies(anomalies), { stuckCount: 2, checkedAt: 't2' });
});

test('mapAnomalies falls back to the passed-in checkedAt when the daemon omitted its own', () => {
  assert.deepEqual(mapAnomalies({ stuck: [] }, 'fallback-t'), { stuckCount: 0, checkedAt: 'fallback-t' });
});

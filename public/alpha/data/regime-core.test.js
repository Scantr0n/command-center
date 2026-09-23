#!/usr/bin/env node
/*
 * Regression tests for regime-core.js, the regime-segment and time-in-each-
 * regime math the Alpha hub's page (app.js) renders under "Regime history".
 * This browser-recorded transition log has no server-side equivalent to
 * cross-check against, so a silent regression here (a segment's end
 * capped wrong during an outage, a distribution total that doesn't match
 * the segments it was built from) would only ever be caught by eyeballing
 * the page mid-outage, exactly the kind of gap a page meant to be trusted
 * at a glance can't afford.
 *
 * Usage: node --test public/alpha/data/regime-core.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  REGIME_PALETTE,
  hashStringToIndex,
  regimeColor,
  computeRegimeSegments,
  regimeSegmentEndMs,
  computeRegimeDistribution
} = require('./regime-core.js');

test('hashStringToIndex: always within [0, mod)', () => {
  const labels = ['trending', 'volatile', 'choppy', 'risk-off', '', 'a', 'a very long regime label indeed'];
  for (const label of labels) {
    const idx = hashStringToIndex(label, 6);
    assert.ok(idx >= 0 && idx < 6, `index for "${label}" out of range: ${idx}`);
  }
});

test('hashStringToIndex: deterministic for the same string', () => {
  assert.equal(hashStringToIndex('trending', 6), hashStringToIndex('trending', 6));
});

test('regimeColor: same label always gets the same color', () => {
  assert.equal(regimeColor('trending'), regimeColor('trending'));
});

test('regimeColor: returns a real color from the fixed palette', () => {
  assert.ok(REGIME_PALETTE.includes(regimeColor('volatile')));
});

test('computeRegimeSegments: empty/missing history returns no segments', () => {
  assert.deepEqual(computeRegimeSegments([], null), []);
  assert.deepEqual(computeRegimeSegments(undefined, null), []);
  assert.deepEqual(computeRegimeSegments(null, null), []);
});

test('computeRegimeSegments: single entry is current with no end', () => {
  const history = [{ at: '2026-09-20T10:00:00Z', regime: 'trending' }];
  const segments = computeRegimeSegments(history, null);
  assert.equal(segments.length, 1);
  assert.deepEqual(segments[0], {
    regime: 'trending', start: '2026-09-20T10:00:00Z', end: null, current: true, frozenAsOf: null
  });
});

test('computeRegimeSegments: chains each segment end to the next start', () => {
  const history = [
    { at: '2026-09-20T10:00:00Z', regime: 'trending' },
    { at: '2026-09-20T12:00:00Z', regime: 'choppy' },
    { at: '2026-09-20T14:00:00Z', regime: 'volatile' }
  ];
  const segments = computeRegimeSegments(history, null);
  assert.equal(segments.length, 3);
  assert.equal(segments[0].end, '2026-09-20T12:00:00Z');
  assert.equal(segments[0].current, false);
  assert.equal(segments[1].end, '2026-09-20T14:00:00Z');
  assert.equal(segments[1].current, false);
  assert.equal(segments[2].end, null);
  assert.equal(segments[2].current, true);
});

test('computeRegimeSegments: frozenAsOf only applies to the last (current) segment', () => {
  const history = [
    { at: '2026-09-20T10:00:00Z', regime: 'trending' },
    { at: '2026-09-20T12:00:00Z', regime: 'choppy' }
  ];
  const segments = computeRegimeSegments(history, '2026-09-20T13:00:00Z');
  assert.equal(segments[0].frozenAsOf, null);
  assert.equal(segments[1].frozenAsOf, '2026-09-20T13:00:00Z');
});

test('regimeSegmentEndMs: a non-current segment uses its own recorded end', () => {
  const seg = { regime: 'trending', start: '2026-09-20T10:00:00Z', end: '2026-09-20T12:00:00Z', current: false, frozenAsOf: null };
  assert.equal(regimeSegmentEndMs(seg, Date.parse('2026-09-20T15:00:00Z')), Date.parse('2026-09-20T12:00:00Z'));
});

test('regimeSegmentEndMs: a current segment with no frozenAsOf uses now', () => {
  const seg = { regime: 'trending', start: '2026-09-20T10:00:00Z', end: null, current: true, frozenAsOf: null };
  const now = Date.parse('2026-09-20T15:00:00Z');
  assert.equal(regimeSegmentEndMs(seg, now), now);
});

test('regimeSegmentEndMs: a current segment with frozenAsOf ignores now, uses the frozen reading', () => {
  const seg = { regime: 'trending', start: '2026-09-20T10:00:00Z', end: null, current: true, frozenAsOf: '2026-09-20T13:00:00Z' };
  const now = Date.parse('2026-09-20T15:00:00Z');
  assert.equal(regimeSegmentEndMs(seg, now), Date.parse('2026-09-20T13:00:00Z'));
});

test('computeRegimeDistribution: no segments returns zero total and no rows', () => {
  assert.deepEqual(computeRegimeDistribution([], null), { totalMs: 0, rows: [] });
});

test('computeRegimeDistribution: aggregates real per-segment durations by label', () => {
  const history = [
    { at: '2026-09-20T10:00:00Z', regime: 'trending' },
    { at: '2026-09-20T11:00:00Z', regime: 'choppy' },
    { at: '2026-09-20T11:30:00Z', regime: 'trending' }
  ];
  const now = Date.parse('2026-09-20T12:30:00Z');
  const segments = computeRegimeSegments(history, null);
  const { totalMs, rows } = computeRegimeDistribution(segments, now);
  // trending: 10:00-11:00 (1h) + 11:30-12:30 (1h, still current) = 2h
  // choppy: 11:00-11:30 (30m)
  assert.equal(totalMs, 2.5 * 60 * 60 * 1000);
  const trending = rows.find(r => r.regime === 'trending');
  const choppy = rows.find(r => r.regime === 'choppy');
  assert.equal(trending.ms, 2 * 60 * 60 * 1000);
  assert.equal(choppy.ms, 0.5 * 60 * 60 * 1000);
  // Longest real duration first.
  assert.equal(rows[0].regime, 'trending');
});

test('computeRegimeDistribution: row percentages sum to 100', () => {
  const history = [
    { at: '2026-09-20T10:00:00Z', regime: 'trending' },
    { at: '2026-09-20T11:00:00Z', regime: 'choppy' }
  ];
  const now = Date.parse('2026-09-20T13:00:00Z');
  const segments = computeRegimeSegments(history, null);
  const { rows } = computeRegimeDistribution(segments, now);
  const totalPct = rows.reduce((sum, r) => sum + r.pct, 0);
  assert.ok(Math.abs(totalPct - 100) < 1e-9, `percentages summed to ${totalPct}, expected ~100`);
});

test('computeRegimeDistribution: a real outage stops the current segment growing past frozenAsOf', () => {
  const history = [{ at: '2026-09-20T10:00:00Z', regime: 'trending' }];
  const segments = computeRegimeSegments(history, '2026-09-20T10:30:00Z');
  const farFutureNow = Date.parse('2026-09-25T00:00:00Z');
  const { totalMs, rows } = computeRegimeDistribution(segments, farFutureNow);
  // Frozen at the last confirmed reading (30m in), not measured to `now`,
  // exactly the "never grow on a segment nothing has actually reconfirmed
  // since the connection dropped" rule this function's own comment states.
  assert.equal(totalMs, 30 * 60 * 1000);
  assert.equal(rows[0].ms, 30 * 60 * 1000);
});

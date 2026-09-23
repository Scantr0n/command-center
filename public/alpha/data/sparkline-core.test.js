#!/usr/bin/env node
/*
 * Regression tests for sparkline-core.js, the sparkline-point geometry and
 * rolling-latency-average math the Alpha hub's page (app.js) renders next
 * to the fetch-latency reading and the drawdown/robustness meters.
 *
 * Usage: node --test public/alpha/data/sparkline-core.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SPARK_W,
  SPARK_H,
  SPARK_PAD,
  computeSparklinePoints,
  averageLatency
} = require('./sparkline-core.js');

test('computeSparklinePoints: one point per input value, in the same order', () => {
  const points = computeSparklinePoints([10, 20, 15]);
  assert.equal(points.length, 3);
});

test('computeSparklinePoints: first and last x sit at the padded edges', () => {
  const points = computeSparklinePoints([5, 8, 3, 9]);
  assert.equal(points[0][0], SPARK_PAD);
  assert.equal(points[points.length - 1][0], SPARK_W - SPARK_PAD);
});

test('computeSparklinePoints: the minimum value sits at the bottom, the maximum at the top', () => {
  const points = computeSparklinePoints([3, 9, 5]);
  const innerBottom = SPARK_H - SPARK_PAD;
  const innerTop = SPARK_PAD;
  assert.equal(points[0][1], innerBottom); // value 3, the min
  assert.equal(points[1][1], innerTop);    // value 9, the max
});

test('computeSparklinePoints: identical values draw a flat line through the middle, not a divide-by-zero', () => {
  const points = computeSparklinePoints([7, 7, 7]);
  const midY = SPARK_PAD + (SPARK_H - SPARK_PAD * 2) / 2;
  for (const [, y] of points) {
    assert.equal(y, midY);
    assert.ok(Number.isFinite(y));
  }
});

test('computeSparklinePoints: a single value places its point at the left edge, mid-height', () => {
  const points = computeSparklinePoints([42]);
  assert.equal(points.length, 1);
  assert.equal(points[0][0], SPARK_PAD);
  assert.ok(Number.isFinite(points[0][1]));
});

test('averageLatency: empty or missing history returns null, never NaN', () => {
  assert.equal(averageLatency([]), null);
  assert.equal(averageLatency(null), null);
  assert.equal(averageLatency(undefined), null);
});

test('averageLatency: averages the real ms readings', () => {
  const history = [{ ms: 100 }, { ms: 200 }, { ms: 300 }];
  assert.equal(averageLatency(history), 200);
});

test('averageLatency: only considers the most recent `window` entries', () => {
  const history = [{ ms: 1000 }, { ms: 10 }, { ms: 20 }, { ms: 30 }];
  assert.equal(averageLatency(history, 3), 20); // (10+20+30)/3, the oldest 1000ms dropped
});

test('averageLatency: defaults the window to 20', () => {
  const history = Array.from({ length: 25 }, (_, i) => ({ ms: i < 5 ? 10000 : 100 }));
  // The first 5 entries (well outside the default 20-entry window) should
  // not drag the average up.
  assert.equal(averageLatency(history), 100);
});

test('averageLatency: a non-numeric ms on an entry counts as 0 rather than breaking the average', () => {
  const history = [{ ms: 100 }, { ms: null }, { ms: 200 }];
  assert.equal(averageLatency(history), 100); // (100+0+200)/3
});

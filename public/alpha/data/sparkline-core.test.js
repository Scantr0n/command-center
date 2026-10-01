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
  averageLatency,
  p95Latency
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

test('p95Latency: empty or missing history returns null, never NaN', () => {
  assert.equal(p95Latency([]), null);
  assert.equal(p95Latency(null), null);
  assert.equal(p95Latency(undefined), null);
});

test('p95Latency: fewer than 5 valid samples returns null rather than a misleadingly precise figure', () => {
  const history = [{ ms: 100 }, { ms: 200 }, { ms: 300 }, { ms: 400 }];
  assert.equal(p95Latency(history), null);
});

test('p95Latency: the 95th percentile of the real readings, nearest-rank method', () => {
  const history = Array.from({ length: 20 }, (_, i) => ({ ms: (i + 1) * 10 })); // 10..200
  // ceil(0.95 * 20) = 19th ranked value (1-indexed) = 190
  assert.equal(p95Latency(history), 190);
});

test('p95Latency: a real outlier within the top 5% of the window surfaces in the reading', () => {
  const fast = Array.from({ length: 9 }, () => ({ ms: 50 }));
  const history = [...fast, { ms: 5000 }]; // the outlier is exactly 1 of 10, the top 5%
  assert.equal(p95Latency(history), 5000);
});

test('p95Latency: only considers the most recent `window` entries, same as averageLatency', () => {
  const stale = Array.from({ length: 10 }, () => ({ ms: 9999 }));
  const recent = Array.from({ length: 5 }, () => ({ ms: 50 }));
  assert.equal(p95Latency([...stale, ...recent], 5), 50);
});

test('p95Latency: a non-numeric ms on an entry is dropped rather than coerced to 0', () => {
  const history = [{ ms: 100 }, { ms: null }, { ms: 110 }, { ms: 120 }, { ms: 130 }, { ms: 140 }];
  // With the null dropped, 5 valid readings remain (100,110,120,130,140); a
  // coerced 0 would have pulled this toward "fast" instead of being ignored.
  assert.equal(p95Latency(history), 140);
});

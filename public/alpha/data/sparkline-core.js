/*
 * Pure sparkline geometry and rolling-average math shared between the
 * Alpha hub's own page (public/alpha/app.js) and this file's own test suite
 * (sparkline-core.test.js). No DOM, no Node-only APIs, same shared-core
 * pattern already proven at dates-core.js, account-core.js, and
 * regime-core.js in this same directory.
 *
 * Three real readings on this page have no history of their own from
 * Alpha's live feed (see the schema-help rows for the fetch-latency figure,
 * and live.positionSizing.currentDrawdownPct / .robustnessScore): this
 * browser keeps its own honest, capped log of readings it has actually
 * polled and draws it as a compact trend line using the geometry below,
 * same "recorded by this browser only" caveat each of those sections
 * carries on the page itself.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AlphaSparklineCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const SPARK_W = 56;
  const SPARK_H = 18;
  const SPARK_PAD = 2;

  // Shared geometry for every sparkline on this page (fetch latency, the
  // drawdown/robustness meters): maps a list of real numbers onto the same
  // fixed SPARK_W x SPARK_H box. A flat line through the middle when every
  // sample in the window is identical is a deliberate choice, not a bug, it
  // avoids a divide-by-zero and correctly shows "no movement" rather than a
  // fabricated slope. Returns an array of [x, y] pairs, one per input value,
  // in the same order.
  function computeSparklinePoints(values) {
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min;
    const innerW = SPARK_W - SPARK_PAD * 2;
    const innerH = SPARK_H - SPARK_PAD * 2;
    return values.map((v, i) => {
      const x = SPARK_PAD + (values.length === 1 ? 0 : (i / (values.length - 1)) * innerW);
      const y = SPARK_PAD + (range === 0 ? innerH / 2 : innerH - ((v - min) / range) * innerH);
      return [x, y];
    });
  }

  // Averaged over a small recent window rather than the full history, since
  // a single-request spike (or a real, sustained slowdown) is more useful
  // read against "the last handful of checks" than against everything this
  // browser has ever recorded. `window` defaults to 20, the same figure the
  // page's own fetch-latency sparkline uses so the "avg" text and the line
  // beside it describe the same real window. A non-numeric `ms` on an entry
  // (shouldn't happen, but this reads real browser-recorded data, never a
  // guaranteed-clean feed) counts as 0 rather than breaking the average.
  function averageLatency(history, window) {
    if (!history || !history.length) return null;
    const recent = history.slice(-(window == null ? 20 : window));
    const sum = recent.reduce((s, e) => s + (typeof e.ms === 'number' ? e.ms : 0), 0);
    return Math.round(sum / recent.length);
  }

  // The average above hides exactly the thing a round-trip reading exists to
  // catch: a daemon that answers fast almost every time but occasionally
  // stalls reads as a low, reassuring average right up until the stall is
  // long enough to matter. Real monitoring dashboards (Grafana, Datadog,
  // CloudWatch) pair a mean latency with a tail percentile for this reason;
  // p95 is the one this page adds, same real-reading-only rule as
  // averageLatency (invalid `ms` entries are dropped, never coerced to 0,
  // since folding a bad reading in as a 0 would pull the tail figure toward
  // "fast" instead of leaving it honestly unknown). Nearest-rank method,
  // same `window` default as averageLatency so the two figures describe the
  // same real window. Returns null with fewer than 5 valid samples: a
  // percentile computed from a handful of points is not a tail reading, it's
  // just the max relabeled, so this withholds it rather than showing a
  // number that implies more data than it has.
  function p95Latency(history, window) {
    if (!history || !history.length) return null;
    const valid = history.filter(e => typeof e.ms === 'number' && Number.isFinite(e.ms));
    const recent = valid.slice(-(window == null ? 20 : window));
    if (recent.length < 5) return null;
    const sorted = recent.map(e => e.ms).sort((a, b) => a - b);
    const rank = Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1);
    return sorted[rank];
  }

  return {
    SPARK_W,
    SPARK_H,
    SPARK_PAD,
    computeSparklinePoints,
    averageLatency,
    p95Latency
  };
});

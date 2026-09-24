/*
 * Pure layout/collision math shared between the hub's own graph view
 * (public/index.html, inline script's renderGraph) and this file's own
 * test suite (graph-core.test.js). No DOM, no Node-only APIs, same
 * shared-core pattern as dashboard-core.js in this same directory.
 *
 * curveMinClearance and computeRelationBulge in particular are exactly the
 * kind of "real math with real edge cases" every other risky routine in
 * this repo (money math, date math, staleness/sort math) already got
 * extracted into a tested core module for. This one wasn't: it's the fix
 * for a real, previously-shipped bug (a relation curve's bulge shrinking to
 * near-zero for two nodes placed close together by the force simulation,
 * so the line visibly cut through an unrelated node's circle), and a
 * regression here would silently reintroduce that same bug with nothing to
 * catch it before a real page load did.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GraphCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const CATEGORY_ORDER = ['Ventures & Business', 'Trading', 'Content', 'Reselling', 'School & Career', 'Health & Personal', 'Travel & Logistics', 'Personal & Infra', 'Uncategorized'];

  // Groups clusters by category, ordering known categories per CATEGORY_ORDER
  // (so the graph's sector wedges always appear in the same fixed order
  // regardless of clusters.json's own item order) and appending any
  // unrecognized category at the end rather than dropping it, so a category
  // typo or a genuinely new one still gets its own sector instead of
  // silently vanishing from the graph.
  function groupByCategory(list) {
    const map = {};
    list.forEach(c => {
      const cat = c.category || 'Uncategorized';
      (map[cat] = map[cat] || []).push(c);
    });
    const keys = [
      ...CATEGORY_ORDER.filter(k => map[k]),
      ...Object.keys(map).filter(k => !CATEGORY_ORDER.includes(k))
    ];
    return keys.map(k => ({ category: k, items: map[k] }));
  }

  function priorityOrbit(priority) {
    return priority === 'top' ? 235 : priority === 'low' ? 345 : 295;
  }

  function nodeRadius(priority) {
    return priority === 'top' ? 34 : priority === 'low' ? 22 : 28;
  }

  // Real collision check for a relation curve, not a guessed constant:
  // samples the actual quadratic bezier and measures clearance against
  // every OTHER node's real circle (never the curve's own two endpoints,
  // which the curve legitimately starts/ends inside of, that's fine, each
  // node's own opaque fill covers that on its own). Used by
  // computeRelationBulge below to grow the bulge only as far as a given
  // curve actually needs, instead of one fixed number that would either
  // cut it close for a crowded pair or over-bulge an isolated one.
  function curveMinClearance(p0, p1, p2, otherNodes) {
    let min = Infinity;
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      const x = (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * p1.x + t * t * p2.x;
      const y = (1 - t) * (1 - t) * p0.y + 2 * (1 - t) * t * p1.y + t * t * p2.y;
      otherNodes.forEach(n => {
        const clearance = Math.hypot(x - n.x, y - n.y) - n.radius;
        if (clearance < min) min = clearance;
      });
    }
    return min;
  }

  // Computes a relation curve's control point given both endpoints, the
  // hub center (curves always bow away from it, toward open canvas, never
  // back toward the dense middle), and every other node/the hub circle
  // itself to check clearance against. Starts at a minimum bulge and grows
  // in real steps, checking the actual curve against every real circle
  // each time, until it clears by a comfortable margin or a sane cap is
  // hit (a relation between two nodes boxed in on all sides has to stop
  // growing somewhere rather than loop forever).
  function computeRelationBulge(nx, ny, ox, oy, cx, cy, others) {
    const dist = Math.hypot(ox - nx, oy - ny);
    const perpX = (ny - oy) / (dist || 1);
    const perpY = (ox - nx) / (dist || 1);
    const midRawX = (nx + ox) / 2, midRawY = (ny + oy) / 2;
    const outwardSign = ((midRawX - cx) * perpX + (midRawY - cy) * perpY) >= 0 ? 1 : -1;
    const p0 = { x: nx, y: ny }, p2 = { x: ox, y: oy };
    let bulge = Math.max(dist * 0.16, 34);
    const MARGIN = 10, MAX_BULGE = 260, STEP = 20;
    while (bulge <= MAX_BULGE) {
      const p1 = { x: midRawX + perpX * bulge * outwardSign, y: midRawY + perpY * bulge * outwardSign };
      if (curveMinClearance(p0, p1, p2, others) >= MARGIN) break;
      bulge += STEP;
    }
    return {
      midX: midRawX + perpX * bulge * outwardSign,
      midY: midRawY + perpY * bulge * outwardSign,
      bulge
    };
  }

  return {
    CATEGORY_ORDER,
    groupByCategory,
    priorityOrbit,
    nodeRadius,
    curveMinClearance,
    computeRelationBulge
  };
});

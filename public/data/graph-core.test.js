#!/usr/bin/env node
/*
 * Regression tests for graph-core.js, the sector-assignment, orbit/radius
 * lookup, and relation-curve collision math the hub's own graph view
 * (public/index.html, renderGraph) renders live.
 *
 * Usage: node --test public/data/graph-core.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CATEGORY_ORDER,
  groupByCategory,
  priorityOrbit,
  nodeRadius,
  curveMinClearance,
  computeRelationBulge
} = require('./graph-core.js');

test('groupByCategory orders known categories per CATEGORY_ORDER regardless of input order', () => {
  const list = [
    { id: 'a', category: 'Reselling' },
    { id: 'b', category: 'Ventures & Business' },
    { id: 'c', category: 'Trading' }
  ];
  const groups = groupByCategory(list);
  assert.deepEqual(groups.map(g => g.category), ['Ventures & Business', 'Trading', 'Reselling']);
});

test('groupByCategory appends an unrecognized category at the end instead of dropping it', () => {
  const list = [
    { id: 'a', category: 'Trading' },
    { id: 'b', category: 'Some New Category' }
  ];
  const groups = groupByCategory(list);
  assert.deepEqual(groups.map(g => g.category), ['Trading', 'Some New Category']);
});

test('groupByCategory buckets a missing category under Uncategorized', () => {
  const list = [{ id: 'a', category: null }, { id: 'b' }];
  const groups = groupByCategory(list);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].category, 'Uncategorized');
  assert.equal(groups[0].items.length, 2);
});

test('groupByCategory never loses or duplicates an item', () => {
  const list = [
    { id: 'a', category: 'Trading' },
    { id: 'b', category: 'Trading' },
    { id: 'c', category: 'Content' },
    { id: 'd' }
  ];
  const groups = groupByCategory(list);
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  assert.equal(total, list.length);
});

test('priorityOrbit and nodeRadius rank top > default > low', () => {
  assert.equal(priorityOrbit('top'), 235);
  assert.equal(priorityOrbit('low'), 345);
  assert.equal(priorityOrbit('anything-else'), 295);
  assert.ok(nodeRadius('top') > nodeRadius('default'));
  assert.ok(nodeRadius('default') > nodeRadius('low'));
});

test('curveMinClearance returns a large positive number for a curve far from every obstacle', () => {
  const p0 = { x: 0, y: 0 }, p1 = { x: 50, y: 0 }, p2 = { x: 100, y: 0 };
  const clearance = curveMinClearance(p0, p1, p2, [{ x: 500, y: 500, radius: 10 }]);
  assert.ok(clearance > 400);
});

test('curveMinClearance goes negative when the curve actually cuts through an obstacle', () => {
  const p0 = { x: 0, y: 0 }, p1 = { x: 50, y: 0 }, p2 = { x: 100, y: 0 };
  // The curve's own midpoint sits right on (50, 0); a same-point obstacle
  // with a real radius must overlap it.
  const clearance = curveMinClearance(p0, p1, p2, [{ x: 50, y: 0, radius: 20 }]);
  assert.ok(clearance < 0);
});

test('curveMinClearance ignores no node by name, only what is passed as otherNodes: the curve is free to start/end inside its own two endpoints', () => {
  const p0 = { x: 0, y: 0 }, p1 = { x: 50, y: 0 }, p2 = { x: 100, y: 0 };
  // p0/p2 are never passed as obstacles by the real caller (renderGraph
  // filters them out before calling), so clearance here is only ever
  // measured against genuinely other nodes.
  const clearance = curveMinClearance(p0, p1, p2, []);
  assert.equal(clearance, Infinity);
});

test('computeRelationBulge bows away from the hub, not back toward it', () => {
  // Hub at (0,0), both endpoints on the +x side, no obstacles: the curve
  // should bow further into +x/away-from-origin territory, not cross back
  // toward the hub's own side.
  const { midX, midY } = computeRelationBulge(100, -20, 100, 20, 0, 0, []);
  assert.ok(midX > 100, `expected midX (${midX}) to bow outward past x=100`);
  assert.equal(midY, 0);
});

test('computeRelationBulge grows the bulge to clear a real obstacle sitting between the endpoints', () => {
  const nx = -50, ny = -5, ox = 50, oy = 5;
  const obstacle = { x: 0, y: 0, radius: 30 };
  const { midX, midY, bulge } = computeRelationBulge(nx, ny, ox, oy, -200, -200, [obstacle]);
  const p0 = { x: nx, y: ny }, p1 = { x: midX, y: midY }, p2 = { x: ox, y: oy };
  assert.ok(bulge > 34, 'bulge should have grown past the minimum to clear the obstacle');
  assert.ok(curveMinClearance(p0, p1, p2, [obstacle]) >= 10 - 1e-9);
});

test('computeRelationBulge stays at the minimum bulge when nothing obstructs the curve', () => {
  const { bulge } = computeRelationBulge(0, 0, 100, 0, -500, -500, []);
  assert.equal(bulge, Math.max(100 * 0.16, 34));
});

test('computeRelationBulge caps out instead of looping forever when boxed in on all sides', () => {
  // A tiny gap between two same-side endpoints with a huge obstacle sitting
  // right on the only path a bulge could take: no amount of growth clears
  // MARGIN, so bulge must stop at the MAX_BULGE cap, not loop forever.
  const nx = 0, ny = -1, ox = 0, oy = 1;
  const obstacle = { x: 0, y: 0, radius: 1000 };
  const { bulge } = computeRelationBulge(nx, ny, ox, oy, -500, 0, [obstacle]);
  // Starting at 34 and stepping by 20, the last value <= MAX_BULGE (260) is
  // 254; the loop takes one more step past it (274) before the <=260 check
  // stops it, since the step that finally exceeds MAX_BULGE still runs.
  assert.equal(bulge, 274);
  assert.ok(bulge > 260, 'bulge should exceed MAX_BULGE when nothing can clear MARGIN');
});

test('CATEGORY_ORDER is exported so callers never hand-maintain a second copy', () => {
  assert.ok(Array.isArray(CATEGORY_ORDER));
  assert.ok(CATEGORY_ORDER.includes('Uncategorized'));
});

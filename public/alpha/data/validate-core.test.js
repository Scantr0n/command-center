#!/usr/bin/env node
/*
 * Regression tests for validate-core.js, the pure logic behind
 * public/alpha/data/validate.js. findForbiddenKeys in particular is the one
 * check standing between this page and a fabricated dollar figure showing up
 * on a real, live-money trading system, so its detection needs real coverage
 * of its own, not just a hand run of the CLI against whatever status.json
 * currently happens to contain.
 *
 * Usage: node --test public/alpha/data/validate-core.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isIsoDatetimeOrNull,
  isFutureDatetime,
  emDashFields,
  findForbiddenKeys
} = require('./validate-core.js');

test('findForbiddenKeys: flags real performance-data key names', () => {
  assert.deepEqual(findForbiddenKeys({ pnl: 100 }, ''), ['pnl']);
  assert.deepEqual(findForbiddenKeys({ profit: 1 }, ''), ['profit']);
  assert.deepEqual(findForbiddenKeys({ balance: 1 }, ''), ['balance']);
  assert.deepEqual(findForbiddenKeys({ equity: 1 }, ''), ['equity']);
  assert.deepEqual(findForbiddenKeys({ winRate: 1 }, ''), ['winRate']);
  assert.deepEqual(findForbiddenKeys({ win_rate: 1 }, ''), ['win_rate']);
  assert.deepEqual(findForbiddenKeys({ tradeCount: 1 }, ''), ['tradeCount']);
  assert.deepEqual(findForbiddenKeys({ trade_count: 1 }, ''), ['trade_count']);
  assert.deepEqual(findForbiddenKeys({ dollarAmount: 1 }, ''), ['dollarAmount']);
  assert.deepEqual(findForbiddenKeys({ returnPct: 1 }, ''), ['returnPct']);
  assert.deepEqual(findForbiddenKeys({ roi: 1 }, ''), ['roi']);
});

test('findForbiddenKeys: case-insensitive on the key name', () => {
  assert.deepEqual(findForbiddenKeys({ PNL: 1 }, ''), ['PNL']);
  assert.deepEqual(findForbiddenKeys({ Balance: 1 }, ''), ['Balance']);
  assert.deepEqual(findForbiddenKeys({ WINRATE: 1 }, ''), ['WINRATE']);
});

test('findForbiddenKeys: walks nested objects and reports the full dotted path', () => {
  const hits = findForbiddenKeys({ live: { account: { balance: 500 } } }, '');
  assert.deepEqual(hits, ['live.account.balance']);
});

test('findForbiddenKeys: reports every hit in a tree with more than one', () => {
  const hits = findForbiddenKeys({ a: { pnl: 1 }, b: { roi: 2 } }, '');
  assert.deepEqual(hits.sort(), ['a.pnl', 'b.roi']);
});

test('findForbiddenKeys: respects a starting path prefix', () => {
  assert.deepEqual(findForbiddenKeys({ pnl: 1 }, 'status'), ['status.pnl']);
});

test('findForbiddenKeys: does not flag legitimate Alpha status fields', () => {
  const status = {
    system: { name: 'Alpha', agentCount: 33 },
    live: {
      asOf: '2026-09-23T12:00:00Z',
      regime: 'trending',
      killSwitch: { engaged: false },
      positionSizing: { activeMode: 'drawdown-based', currentDrawdownPct: 4, maxDrawdownPct: 9, robustnessScore: 72 },
      debatePanel: { active: false, blockedOn: 'API key' },
      genealogy: { generation: 12, lineages: [{ id: 'l1', agentCount: 5, status: 'active' }] }
    },
    events: [{ at: '2026-09-23T12:00:00Z', type: 'regime', label: 'Regime changed' }]
  };
  assert.deepEqual(findForbiddenKeys(status, ''), []);
});

test('findForbiddenKeys: non-object input returns no hits', () => {
  assert.deepEqual(findForbiddenKeys(null, ''), []);
  assert.deepEqual(findForbiddenKeys('roi', ''), []);
  assert.deepEqual(findForbiddenKeys(42, ''), []);
});

test('isIsoDatetimeOrNull: accepts null, undefined, and a real ISO datetime', () => {
  assert.equal(isIsoDatetimeOrNull(null), true);
  assert.equal(isIsoDatetimeOrNull(undefined), true);
  assert.equal(isIsoDatetimeOrNull('2026-09-23T12:00:00Z'), true);
});

test('isIsoDatetimeOrNull: rejects a malformed or non-string value', () => {
  assert.equal(isIsoDatetimeOrNull('not a date'), false);
  assert.equal(isIsoDatetimeOrNull('09/23/2026'), false);
  assert.equal(isIsoDatetimeOrNull(12345), false);
});

test('isFutureDatetime: false for a real past timestamp', () => {
  assert.equal(isFutureDatetime('2020-01-01T00:00:00Z'), false);
});

test('isFutureDatetime: true for a timestamp well beyond the clock-skew tolerance', () => {
  const farFuture = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  assert.equal(isFutureDatetime(farFuture), true);
});

test('isFutureDatetime: false within the clock-skew tolerance window', () => {
  const soon = new Date(Date.now() + 60 * 1000).toISOString();
  assert.equal(isFutureDatetime(soon), false);
});

test('isFutureDatetime: false for null, empty, or a non-ISO string', () => {
  assert.equal(isFutureDatetime(null), false);
  assert.equal(isFutureDatetime(''), false);
  assert.equal(isFutureDatetime('not a date'), false);
});

test('emDashFields: flags only the fields that actually contain an em dash', () => {
  const obj = { label: 'Trending' + String.fromCharCode(8212) + 'up', note: 'clean text' };
  assert.deepEqual(emDashFields(obj, ['label', 'note']), ['label']);
});

test('emDashFields: no hits when nothing contains an em dash', () => {
  const obj = { label: 'Trending, up', note: 'clean text' };
  assert.deepEqual(emDashFields(obj, ['label', 'note']), []);
});

test('emDashFields: a missing object returns no hits rather than throwing', () => {
  assert.deepEqual(emDashFields(null, ['label']), []);
  assert.deepEqual(emDashFields(undefined, ['label']), []);
});

test('emDashFields: a non-string field value is skipped, not flagged', () => {
  assert.deepEqual(emDashFields({ count: 5 }, ['count']), []);
});

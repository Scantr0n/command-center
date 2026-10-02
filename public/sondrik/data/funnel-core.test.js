#!/usr/bin/env node
/*
 * Regression tests for funnel-core.js, the shared math behind the Funnel
 * section connecting the Traction card's latest download check to leads.json
 * and each lead's outreach.draftStatus/outreach.sent.
 *
 * Usage: node --test public/sondrik/data/funnel-core.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { FUNNEL_STAGES, latestDownloadCount, computeFunnel } = require('./funnel-core.js');

test('FUNNEL_STAGES is the real fixed four-stage sequence the rest of this file assumes', () => {
  assert.deepEqual(FUNNEL_STAGES.map(s => s.id), ['downloads', 'leads', 'drafted', 'sent']);
});

test('latestDownloadCount returns the most recently dated check, regardless of array order', () => {
  const downloadsData = { metric: { checks: [
    { date: '2026-09-20', count: 15 },
    { date: '2026-09-04', count: 0 },
    { date: '2026-09-07', count: 8 }
  ] } };
  assert.equal(latestDownloadCount(downloadsData), 15);
});

test('latestDownloadCount returns 0, not null, when no checks are logged yet', () => {
  assert.equal(latestDownloadCount({ metric: { checks: [] } }), 0);
  assert.equal(latestDownloadCount({ metric: {} }), 0);
  assert.equal(latestDownloadCount(null), 0);
});

test('computeFunnel counts real stage reach from downloads/leads/outreach, the real Sondrik shape', () => {
  const downloadsData = { metric: { checks: [{ date: '2026-09-07', count: 8 }, { date: '2026-09-20', count: 15 }] } };
  const leadsData = { leads: [
    { id: 'a', outreach: { draftStatus: 'drafted', sent: false } }
  ] };
  const results = computeFunnel(downloadsData, leadsData);
  assert.deepEqual(results.map(r => r.reached), [15, 1, 1, 0]);
});

test('computeFunnel only counts a lead toward "drafted" when draftStatus is actually "drafted"', () => {
  const downloadsData = { metric: { checks: [{ date: '2026-09-07', count: 8 }] } };
  const leadsData = { leads: [
    { id: 'a', outreach: { draftStatus: 'drafted', sent: false } },
    { id: 'b', outreach: { draftStatus: null, sent: false } },
    { id: 'c', outreach: {} },
    { id: 'd' }
  ] };
  const results = computeFunnel(downloadsData, leadsData);
  assert.equal(results[2].reached, 1, 'only the one lead with draftStatus "drafted" counts');
});

test('computeFunnel only counts a lead toward "sent" when outreach.sent is exactly true', () => {
  const downloadsData = { metric: { checks: [{ date: '2026-09-07', count: 8 }] } };
  const leadsData = { leads: [
    { id: 'a', outreach: { sent: true } },
    { id: 'b', outreach: { sent: 'true' } },
    { id: 'c', outreach: { sent: false } },
    { id: 'd', outreach: {} }
  ] };
  const results = computeFunnel(downloadsData, leadsData);
  assert.equal(results[3].reached, 1, 'a truthy non-boolean "sent" must not count as sent');
});

test('computeFunnel handles a totally empty leads.json without throwing', () => {
  const downloadsData = { metric: { checks: [{ date: '2026-09-07', count: 8 }] } };
  const results = computeFunnel(downloadsData, { leads: [] });
  assert.deepEqual(results.map(r => r.reached), [8, 0, 0, 0]);
  assert.equal(results[1].conversionFromPrev, 0, '0 reached out of a real nonzero 8, a true 0% conversion');
});

test('computeFunnel never fabricates a conversion rate when the previous stage reached nobody', () => {
  const downloadsData = { metric: { checks: [] } };
  const results = computeFunnel(downloadsData, { leads: [] });
  assert.deepEqual(results.map(r => r.reached), [0, 0, 0, 0]);
  results.forEach((r, i) => {
    if (i === 0) return;
    assert.equal(r.conversionFromPrev, null, 'stage ' + r.stage.id + ' must not show a 0-of-0 rate as 0%');
  });
});

test('computeFunnel rounds conversionFromPrev to the nearest whole percent, same as csm-core.js computeFunnel', () => {
  const downloadsData = { metric: { checks: [{ date: '2026-09-20', count: 15 }] } };
  const leadsData = { leads: [{ id: 'a', outreach: { draftStatus: 'drafted', sent: false } }] };
  const results = computeFunnel(downloadsData, leadsData);
  assert.equal(results[1].conversionFromPrev, 7, '1/15 rounds to 7%, not fabricated precision');
});

test('computeFunnel tolerates a missing downloadsData/leadsData entirely', () => {
  const results = computeFunnel(null, null);
  assert.deepEqual(results.map(r => r.reached), [0, 0, 0, 0]);
});

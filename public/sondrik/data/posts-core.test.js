#!/usr/bin/env node
/*
 * Regression tests for posts-core.js, the copy-generation logic behind
 * the header's "Copy status update"/"Copy build-in-public post" buttons and
 * each Channels card's own "Copy draft post" button. None of this had a
 * regression test before it was extracted out of app.js, even though some
 * of it is real text Jack may paste into an actual public post.
 *
 * Usage: node --test public/sondrik/data/posts-core.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildStatusUpdate, buildPublicPost, realFactsLine,
  CHANNEL_POST_BUILDERS, buildChannelDraftPost
} = require('./posts-core.js');

const identity = iso => iso;
const noMetricValue = () => null;

function opts(extra) {
  return Object.assign({ fmtDate: identity, currentMetricValue: noMetricValue, todayIsoStr: '2026-09-30' }, extra);
}

const releasesData = { releases: [{ version: '0.3.7', date: '2026-09-07', summary: 'Fixed default CRM seed data shipping in every fresh install.' }] };
const downloadsData = {
  metric: {
    label: 'v0.3.7 DMG downloads',
    source: 'GitHub releases API (gh api), confirmed count, not an estimate',
    checks: [
      { date: '2026-09-07', count: 8 },
      { date: '2026-09-20', count: 15 }
    ]
  }
};
const leadsData = { leads: [{ channelId: 'reddit', source: 'Reddit', sourceDetail: 'Commenter on r/IMadeThis', type: 'beta-tester-offer', summary: 'Offered to test the product in exchange for lifetime access.', outreach: { approvalStatus: 'awaiting-approval', sent: false } }] };
const goalsData = { goals: [{ id: 'g1', label: '150 downloads by EOY', metric: 'downloads', target: 150, targetDate: '2026-12-31' }] };
const channelsData = { channels: [{ id: 'product-hunt', name: 'Product Hunt', status: 'not-tracked' }] };

test('buildStatusUpdate includes the latest release, the latest download check with its delta, and the source', () => {
  const text = buildStatusUpdate(releasesData, downloadsData, {}, {}, {}, opts());
  assert.match(text, /Sondrik status snapshot, generated 2026-09-30/);
  assert.match(text, /Latest release: v0\.3\.7/);
  assert.match(text, /15 v0\.3\.7 DMG downloads as of 2026-09-20 \(\+7 vs 2026-09-07 check\)/);
  assert.match(text, /Source: GitHub releases API/);
});

test('buildStatusUpdate lists every real lead with its outreach status, never a fabricated "sent"', () => {
  const text = buildStatusUpdate({}, {}, leadsData, {}, {}, opts());
  assert.match(text, /Lead: Commenter on r\/IMadeThis, Offered to test the product in exchange for lifetime access\. \[drafted, awaiting approval\]/);
});

test('buildStatusUpdate shows a goal against currentMetricValue, not against the raw latest check', () => {
  const text = buildStatusUpdate({}, downloadsData, {}, goalsData, {}, opts({ currentMetricValue: () => ({ count: 15 }) }));
  assert.match(text, /Goal: 150 downloads by EOY, 15 \/ 150 by 2026-12-31/);
});

test('buildStatusUpdate calls out not-tracked channels but never repeats a tracked one\'s number', () => {
  const text = buildStatusUpdate({}, {}, {}, {}, channelsData, opts());
  assert.match(text, /Not tracked yet: Product Hunt\./);
});

test('buildStatusUpdate on entirely empty data still returns just the header line, never throws', () => {
  const text = buildStatusUpdate({}, {}, {}, {}, {}, opts());
  assert.equal(text, 'Sondrik status snapshot, generated 2026-09-30');
});

test('buildPublicPost states the real download delta between the first and latest check', () => {
  const text = buildPublicPost(releasesData, downloadsData, leadsData, opts());
  assert.match(text, /Sondrik v0\.3\.7 shipped 2026-09-07 \(Fixed default CRM seed data shipping in every fresh install\)\./);
  assert.match(text, /15 v0\.3\.7 DMG downloads as of 2026-09-20, up from 8 on 2026-09-07\./);
  assert.match(text, /One real reader offered to test it in exchange for lifetime access\./);
});

test('buildPublicPost pluralizes multiple tester offers instead of always saying "One"', () => {
  const twoLeads = { leads: [leadsData.leads[0], leadsData.leads[0]] };
  const text = buildPublicPost({}, {}, twoLeads, opts());
  assert.match(text, /^2 real reader/);
});

test('buildPublicPost returns an empty string, not a broken sentence, when nothing real is logged yet', () => {
  assert.equal(buildPublicPost({}, {}, {}, opts()), '');
});

test('realFactsLine strips a trailing period off the release summary before appending its own', () => {
  const text = realFactsLine(releasesData, downloadsData, opts());
  assert.match(text, /^v0\.3\.7 shipped 2026-09-07: Fixed default CRM seed data shipping in every fresh install\./);
  assert.match(text, /15 v0\.3\.7 DMG downloads as of 2026-09-20 \(GitHub releases API \(gh api\), confirmed count, not an estimate\)\.$/);
});

test('every CHANNEL_POST_BUILDERS entry returns null rather than a half-empty template when there is no real data yet', () => {
  Object.keys(CHANNEL_POST_BUILDERS).forEach(channelId => {
    assert.equal(buildChannelDraftPost(channelId, {}, {}, {}, opts()), null, channelId + ' should be null with no data');
  });
});

test('buildChannelDraftPost returns null for an unknown channel id instead of throwing', () => {
  assert.equal(buildChannelDraftPost('not-a-real-channel', releasesData, downloadsData, leadsData, opts()), null);
});

test('hacker-news draft leads with "Show HN:" per HN\'s own posting guideline and never fabricates a pitch', () => {
  const text = buildChannelDraftPost('hacker-news', releasesData, downloadsData, {}, opts());
  assert.match(text, /^Show HN: Sondrik - \[one-line pitch, fill in before posting\]/);
  assert.match(text, /\[Add why you built it/);
});

test('indie-hackers-milestones draft titles with the real current download count, not a goal or estimate', () => {
  const text = buildChannelDraftPost('indie-hackers-milestones', releasesData, downloadsData, {}, opts());
  assert.match(text, /^15 v0\.3\.7 DMG downloads for Sondrik/);
});

test('indie-hackers-milestones returns null when there is no download check at all yet', () => {
  assert.equal(buildChannelDraftPost('indie-hackers-milestones', releasesData, {}, {}, opts()), null);
});

test('x-twitter channel draft reuses buildPublicPost exactly, with no separate title line', () => {
  const direct = buildPublicPost(releasesData, downloadsData, leadsData, opts());
  const viaChannel = buildChannelDraftPost('x-twitter', releasesData, downloadsData, leadsData, opts());
  assert.equal(viaChannel, direct);
});

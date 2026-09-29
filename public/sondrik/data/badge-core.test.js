#!/usr/bin/env node
/*
 * Regression tests for badge-core.js, the shields.io-style flat-badge SVG
 * builder behind the Traction card's "Download README badge (SVG)" button.
 * Covers the text-width layout math (the one piece of this page's real,
 * on-page-visible logic that had never been run through a regression test)
 * and the XSS guard on both text nodes and the aria-label/title, since the
 * label/value strings this builds from (a download count and a formatted
 * date) still flow through the same escapeHtml every other hand-edited
 * field on this page does before landing in markup.
 *
 * Usage: node --test public/sondrik/data/badge-core.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { BADGE_CHAR_WIDTH, badgeTextWidth, renderFlatBadgeSvg, buildDownloadsBadgeSvg } = require('./badge-core.js');
const { escapeHtml } = require('./html-core.js');

const identity = iso => iso;

test('BADGE_CHAR_WIDTH is the real approximate glyph width badgeTextWidth is built on', () => {
  assert.equal(BADGE_CHAR_WIDTH, 6.2);
});

test('badgeTextWidth scales with string length plus fixed padding', () => {
  assert.equal(badgeTextWidth(''), 10);
  assert.equal(badgeTextWidth('a'), Math.round(6.2) + 10);
  assert.equal(badgeTextWidth('sondrik downloads'), Math.round('sondrik downloads'.length * 6.2) + 10);
});

test('badgeTextWidth treats null/undefined as an empty string rather than throwing', () => {
  assert.equal(badgeTextWidth(null), 10);
  assert.equal(badgeTextWidth(undefined), 10);
});

test('renderFlatBadgeSvg sizes the label/value rects to sum to the declared SVG width', () => {
  const svg = renderFlatBadgeSvg('sondrik downloads', '15 (as of Sep 20, 2026)', '#3B82C4', escapeHtml);
  const labelWidth = badgeTextWidth('sondrik downloads');
  const valueWidth = badgeTextWidth('15 (as of Sep 20, 2026)');
  const totalWidth = labelWidth + valueWidth;
  assert.match(svg, new RegExp('width="' + totalWidth + '" height="20"'));
  assert.match(svg, new RegExp('<rect width="' + labelWidth + '" height="20" fill="#555"/>'));
  assert.match(svg, new RegExp('<rect x="' + labelWidth + '" width="' + valueWidth + '" height="20" fill="#3B82C4"/>'));
});

test('renderFlatBadgeSvg escapes a value containing markup rather than letting it render as live SVG', () => {
  // Real XSS guard (OWASP): the value half of this badge is built from a
  // hand-edited downloads.json note in the caller, same trust boundary as
  // every other field this page renders straight into innerHTML.
  const svg = renderFlatBadgeSvg('label', '<script>alert(1)</script>', '#000', escapeHtml);
  assert.doesNotMatch(svg, /<script>alert\(1\)<\/script>/);
  assert.match(svg, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('renderFlatBadgeSvg falls back to an identity escaper when none is injected', () => {
  const svg = renderFlatBadgeSvg('label', 'value', '#000');
  assert.match(svg, /<text x="[\d.]+" y="14">label<\/text>/);
  assert.match(svg, /<text x="[\d.]+" y="14">value<\/text>/);
});

test('buildDownloadsBadgeSvg returns null when no download checks are logged yet', () => {
  assert.equal(buildDownloadsBadgeSvg({ metric: { checks: [] } }, identity, escapeHtml), null);
  assert.equal(buildDownloadsBadgeSvg({}, identity, escapeHtml), null);
  assert.equal(buildDownloadsBadgeSvg(null, identity, escapeHtml), null);
});

test('buildDownloadsBadgeSvg builds its value from the latest check by date, not array order', () => {
  const downloadsData = {
    metric: {
      checks: [
        { date: '2026-09-20', count: 15 },
        { date: '2026-09-04', count: 0 },
        { date: '2026-09-07', count: 8 }
      ]
    }
  };
  const svg = buildDownloadsBadgeSvg(downloadsData, identity, escapeHtml);
  assert.match(svg, /15 \(as of 2026-09-20\)/);
  assert.doesNotMatch(svg, /8 \(as of/);
});

test('buildDownloadsBadgeSvg runs the latest check date through the injected date formatter', () => {
  const downloadsData = { metric: { checks: [{ date: '2026-09-20', count: 15 }] } };
  const fakeFmt = iso => 'FORMATTED:' + iso;
  const svg = buildDownloadsBadgeSvg(downloadsData, fakeFmt, escapeHtml);
  assert.match(svg, /15 \(as of FORMATTED:2026-09-20\)/);
});

test('the real downloads.json on disk produces a real, non-null badge', () => {
  const downloadsData = require('./downloads.json');
  const svg = buildDownloadsBadgeSvg(downloadsData, identity, escapeHtml);
  assert.notEqual(svg, null);
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
});

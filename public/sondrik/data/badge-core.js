/*
 * Pure shields.io-style flat-badge SVG builder pulled out of app.js so it
 * can be required directly from a Node test (badge-core.test.js) without
 * loading the rest of the dashboard's DOM-touching code. Same reasoning as
 * goals-core.js/release-core.js/export-core.js/html-core.js/next-steps-core.js
 * in this same folder: every other real, on-page-visible pure function here
 * already has a companion regression test, this was the one exception, the
 * "Download README badge (SVG)" button's own text-width/layout math had
 * never been run through one despite being real, hand-embeddable output
 * (Sondrik's own README) rather than a throwaway on-page detail.
 *
 * escapeHtmlFn/fmtDateFn are injected rather than required, same reason
 * release-core.js's bugfixCheckinStatus takes fmtDateFn: keeps this module
 * free of any DOM/Intl dependency so a test can assert on exact output
 * without also loading html-core.js or depending on the runner's locale.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SondrikBadgeCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  // Approx Verdana/DejaVu Sans glyph widths, close enough to render legibly
  // without pulling in shields.io's own badge service (no live backend
  // exists on this page to call it from) or a real font-metrics library for
  // what is always exactly two short strings.
  const BADGE_CHAR_WIDTH = 6.2;

  function badgeTextWidth(text) {
    return Math.round(String(text ?? '').length * BADGE_CHAR_WIDTH) + 10;
  }

  function renderFlatBadgeSvg(label, value, color, escapeHtmlFn) {
    const escapeHtml = escapeHtmlFn || (s => String(s ?? ''));
    const labelWidth = badgeTextWidth(label);
    const valueWidth = badgeTextWidth(value);
    const totalWidth = labelWidth + valueWidth;
    const height = 20;
    const labelX = labelWidth / 2;
    const valueX = labelWidth + valueWidth / 2;
    const a11yLabel = escapeHtml(label + ': ' + value);
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + totalWidth + '" height="' + height +
      '" role="img" aria-label="' + a11yLabel + '">' +
      '<title>' + a11yLabel + '</title>' +
      '<linearGradient id="s" x2="0" y2="100%">' +
      '<stop offset="0" stop-color="#bbb" stop-opacity=".1"/>' +
      '<stop offset="1" stop-opacity=".1"/>' +
      '</linearGradient>' +
      '<clipPath id="r"><rect width="' + totalWidth + '" height="' + height + '" rx="3" fill="#fff"/></clipPath>' +
      '<g clip-path="url(#r)">' +
      '<rect width="' + labelWidth + '" height="' + height + '" fill="#555"/>' +
      '<rect x="' + labelWidth + '" width="' + valueWidth + '" height="' + height + '" fill="' + color + '"/>' +
      '<rect width="' + totalWidth + '" height="' + height + '" fill="url(#s)"/>' +
      '</g>' +
      '<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="11">' +
      '<text x="' + labelX + '" y="14">' + escapeHtml(label) + '</text>' +
      '<text x="' + valueX + '" y="14">' + escapeHtml(value) + '</text>' +
      '</g>' +
      '</svg>';
  }

  // A real download-count badge to embed in Sondrik's own README, the same
  // pattern any open-source project's shields.io downloads badge follows.
  // Built once from whatever's on disk right now, not a live badge: shields.io
  // has no way to read this repo's private data, and this page still has no
  // live backend wired up anywhere. The real "as of" date is baked into the
  // badge text itself so the badge tells anyone reading the README how
  // current the number is instead of implying a live feed that quietly goes
  // stale the moment a fresh check gets logged here.
  function buildDownloadsBadgeSvg(downloadsData, fmtDateFn, escapeHtmlFn) {
    const fmtDate = fmtDateFn || (iso => iso);
    const metric = (downloadsData && downloadsData.metric) || {};
    const checks = (metric.checks || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    if (checks.length === 0) return null;
    const latest = checks[checks.length - 1];
    const label = 'sondrik downloads';
    const value = latest.count + ' (as of ' + fmtDate(latest.date) + ')';
    return renderFlatBadgeSvg(label, value, '#3B82C4', escapeHtmlFn);
  }

  return { BADGE_CHAR_WIDTH, badgeTextWidth, renderFlatBadgeSvg, buildDownloadsBadgeSvg };
});

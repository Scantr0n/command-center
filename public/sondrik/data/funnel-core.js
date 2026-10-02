/*
 * Pure funnel math pulled out of app.js so it can be required directly from
 * a Node test (funnel-core.test.js) without loading the rest of the
 * dashboard's DOM-touching code. Same shared-core-with-tests pattern as
 * goals-core.js/release-core.js/milestones-core.js in this same folder.
 *
 * The four stages are every one already logged somewhere else on this page
 * (the Traction card's latest download check, leads.json's own entries, and
 * each lead's outreach.draftStatus/outreach.sent), just never connected into
 * a single funnel before. This adds no new fact and fabricates nothing: it
 * only counts what validate.js already requires to be real.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SondrikFunnelCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const FUNNEL_STAGES = [
    { id: 'downloads', label: 'Downloads' },
    { id: 'leads', label: 'Leads logged' },
    { id: 'drafted', label: 'Outreach drafted' },
    { id: 'sent', label: 'Outreach sent' }
  ];

  // Same judgment-call-not-statistical-threshold spirit as milestones-core.js's
  // MIN_TREND_CHECKS/trendCaveatText: a conversion rate computed from a
  // denominator this small (Sondrik's real one is 1, not 1000) still renders,
  // the real math is never hidden, it just carries an explicit caveat instead
  // of silently reading as a proven rate. Research on reporting percentages
  // from small-n samples (MeasuringU) is explicit that a lone case moving or
  // not moving to the next stage swings the printed percentage by 100 points,
  // which is exactly what a real "100% reached this stage" or "0% reached
  // this stage" line driven by n=1 would otherwise imply without comment.
  const MIN_SAMPLE_FOR_RATE = 10;

  function sampleCaveatText(prevReached) {
    if (prevReached >= MIN_SAMPLE_FOR_RATE) return null;
    return prevReached === 1
      ? 'based on 1 case, too small a sample for this percent to mean much'
      : 'based on only ' + prevReached + ' cases, too small a sample for this percent to mean much';
  }

  // Latest logged download count, same "sort by date, take the last one"
  // rule renderSnapshot/renderTraction already use, 0 if no check exists
  // yet rather than null, so the funnel's first stage is always a real
  // number, never a gap.
  function latestDownloadCount(downloadsData) {
    const checks = ((downloadsData && downloadsData.metric && downloadsData.metric.checks) || [])
      .slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    return checks.length > 0 ? checks[checks.length - 1].count : 0;
  }

  function computeFunnel(downloadsData, leadsData) {
    const leads = (leadsData && leadsData.leads) || [];
    const drafted = leads.filter(l => l.outreach && l.outreach.draftStatus === 'drafted').length;
    const sent = leads.filter(l => l.outreach && l.outreach.sent === true).length;

    const reached = [latestDownloadCount(downloadsData), leads.length, drafted, sent];

    return FUNNEL_STAGES.map((stage, i) => ({
      stage,
      reached: reached[i],
      // Matches CSM's own computeFunnel: null (no conversion line at all)
      // rather than a fabricated 0% when the previous stage reached nobody,
      // since "0 of 0" isn't a real conversion rate.
      conversionFromPrev: i > 0 && reached[i - 1] > 0 ? Math.round((reached[i] / reached[i - 1]) * 100) : null,
      // Only meaningful alongside a real conversionFromPrev, null whenever
      // that is (nothing to caveat on a line that isn't shown).
      conversionCaveat: i > 0 && reached[i - 1] > 0 ? sampleCaveatText(reached[i - 1]) : null
    }));
  }

  return { FUNNEL_STAGES, latestDownloadCount, computeFunnel, MIN_SAMPLE_FOR_RATE, sampleCaveatText };
});

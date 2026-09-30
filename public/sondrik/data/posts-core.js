/*
 * Pure copy-generation logic pulled out of app.js so it can be required
 * directly from a Node test (posts-core.test.js) without loading the rest
 * of the dashboard's DOM-touching code. Same reasoning as goals-core.js/
 * release-core.js/badge-core.js/milestones-core.js in this same folder:
 * this is real, human-facing text (the "Copy status update" and "Copy
 * build-in-public post" header buttons, and each Channels card's own
 * "Copy draft post" button), some of which Jack may actually paste into a
 * real public post, and until now none of it had a regression test.
 *
 * fmtDateFn/currentMetricValueFn are injected the same way release-core.js
 * injects fmtDateFn: this module has no script-load-order dependency on
 * goals-core.js or app.js's own date formatter, a test can pass its own
 * (or the identity default) and stay deterministic.
 *
 * Every sentence built here states only an already-logged real fact
 * (version, ship date, summary, download count, source, lead count); none
 * of the CHANNEL_POST_BUILDERS entries invents a pitch, story, or number,
 * per the same "leave a bracketed placeholder, don't guess" rule the
 * schema-help section applies to hand-edited JSON. Nothing built here is
 * ever sent anywhere from this module, callers only ever copy the returned
 * string to the clipboard or download it as a file.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SondrikPostsCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  function daysBetween(a, b) {
    const da = new Date(a + 'T00:00:00Z');
    const db = new Date(b + 'T00:00:00Z');
    return Math.round((db - da) / 86400000);
  }

  function latestSortedByDate(list, dateField) {
    return (list || []).slice().filter(x => x[dateField])
      .sort((a, b) => b[dateField].localeCompare(a[dateField]));
  }

  function sortedChecks(downloadsData) {
    const metric = (downloadsData && downloadsData.metric) || {};
    return (metric.checks || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  }

  function buildStatusUpdate(releasesData, downloadsData, leadsData, goalsData, channelsData, opts) {
    const fmtDate = (opts && opts.fmtDate) || (iso => iso);
    const currentMetricValue = (opts && opts.currentMetricValue) || (() => null);
    const todayIsoStr = (opts && opts.todayIsoStr) || null;

    const lines = ['Sondrik status snapshot, generated ' + fmtDate(todayIsoStr)];

    const releases = latestSortedByDate((releasesData && releasesData.releases) || [], 'date');
    if (releases.length > 0) {
      const r = releases[0];
      let rel = null;
      if (r.date && todayIsoStr) {
        const age = daysBetween(r.date, todayIsoStr);
        if (age >= 0) rel = age === 0 ? 'today' : age === 1 ? '1 day ago' : age + ' days ago';
      }
      lines.push('');
      lines.push('Latest release: v' + r.version + (r.date ? ' (' + fmtDate(r.date) + (rel ? ', ' + rel : '') + ')' : '') +
        (r.summary ? ', ' + r.summary : ''));
    }

    const checks = sortedChecks(downloadsData);
    const metric = (downloadsData && downloadsData.metric) || {};
    if (checks.length > 0) {
      const latest = checks[checks.length - 1];
      let line = latest.count + ' ' + (metric.label || 'downloads') + ' as of ' + fmtDate(latest.date);
      if (checks.length > 1) {
        const first = checks[0];
        const delta = latest.count - first.count;
        line += ' (' + (delta >= 0 ? '+' : '') + delta + ' vs ' + fmtDate(first.date) + ' check)';
      }
      if (metric.source) line += '. Source: ' + metric.source;
      lines.push('');
      lines.push(line);
    }

    const leads = (leadsData && leadsData.leads) || [];
    if (leads.length > 0) {
      lines.push('');
      leads.forEach(l => {
        const o = l.outreach || {};
        const status = o.sent ? 'sent'
          : (o.approvalStatus === 'awaiting-approval' ? 'drafted, awaiting approval' : (o.draftStatus || 'no draft yet'));
        lines.push('Lead: ' + (l.sourceDetail || l.source || 'Unknown source') +
          (l.summary ? ', ' + l.summary : '') + ' [' + status + ']');
      });
    }

    const goals = (goalsData && goalsData.goals) || [];
    if (goals.length > 0) {
      lines.push('');
      goals.forEach(g => {
        const current = currentMetricValue(g.metric, downloadsData, leadsData);
        const currentCount = current ? current.count : 0;
        lines.push('Goal: ' + g.label + ', ' + currentCount + ' / ' + g.target +
          (g.targetDate ? ' by ' + fmtDate(g.targetDate) : ''));
      });
    }

    const gaps = ((channelsData && channelsData.channels) || []).filter(c => c.status === 'not-tracked');
    if (gaps.length > 0) {
      lines.push('');
      lines.push('Not tracked yet: ' + gaps.map(c => c.name || 'Unnamed channel').join(', ') + '.');
    }

    return lines.join('\n');
  }

  function buildPublicPost(releasesData, downloadsData, leadsData, opts) {
    const fmtDate = (opts && opts.fmtDate) || (iso => iso);
    const parts = [];

    const releases = latestSortedByDate((releasesData && releasesData.releases) || [], 'date');
    if (releases.length > 0) {
      const r = releases[0];
      parts.push('Sondrik v' + r.version + ' shipped ' + fmtDate(r.date) +
        (r.summary ? ' (' + r.summary.replace(/\.$/, '') + ')' : '') + '.');
    }

    const checks = sortedChecks(downloadsData);
    const metric = (downloadsData && downloadsData.metric) || {};
    if (checks.length > 0) {
      const latest = checks[checks.length - 1];
      let line = latest.count + ' ' + (metric.label || 'downloads') + ' as of ' + fmtDate(latest.date);
      if (checks.length > 1) {
        const first = checks[0];
        line += ', up from ' + first.count + ' on ' + fmtDate(first.date);
      }
      parts.push(line + '.');
    }

    const leads = (leadsData && leadsData.leads) || [];
    const testerOffers = leads.filter(l => l.type === 'beta-tester-offer');
    if (testerOffers.length > 0) {
      parts.push((testerOffers.length === 1 ? 'One' : String(testerOffers.length)) +
        ' real reader offered to test it in exchange for lifetime access.');
    }

    if (parts.length === 0) return '';
    return parts.join(' ');
  }

  function realFactsLine(releasesData, downloadsData, opts) {
    const fmtDate = (opts && opts.fmtDate) || (iso => iso);
    const parts = [];
    const releases = latestSortedByDate((releasesData && releasesData.releases) || [], 'date');
    if (releases.length > 0) {
      const r = releases[0];
      parts.push('v' + r.version + ' shipped ' + fmtDate(r.date) + (r.summary ? ': ' + r.summary.replace(/\.$/, '') + '.' : '.'));
    }
    const checks = sortedChecks(downloadsData);
    const metric = (downloadsData && downloadsData.metric) || {};
    if (checks.length > 0) {
      const latest = checks[checks.length - 1];
      parts.push(latest.count + ' ' + (metric.label || 'downloads') + ' as of ' + fmtDate(latest.date) +
        (metric.source ? ' (' + metric.source + ')' : '') + '.');
    }
    return parts.join(' ');
  }

  const CHANNEL_POST_BUILDERS = {
    'hacker-news': (releasesData, downloadsData, leadsData, opts) => {
      const facts = realFactsLine(releasesData, downloadsData, opts);
      if (!facts) return null;
      return {
        title: 'Show HN: Sondrik - [one-line pitch, fill in before posting]',
        body: 'I built Sondrik, a CRM tool. ' + facts +
          '\n\n[Add why you built it, then post yourself once ready. HN\'s own guidelines ban generated/AI-edited replies in the comment thread, so any reply once this is live needs to actually be typed by you.]'
      };
    },
    'product-hunt': (releasesData, downloadsData, leadsData, opts) => {
      const facts = realFactsLine(releasesData, downloadsData, opts);
      if (!facts) return null;
      return {
        title: 'Tagline: Sondrik - [one-line pitch, fill in before posting]',
        body: facts + '\n\n[Add a real screenshot or short clip before submitting, then plan to answer comments yourself the day it launches.]'
      };
    },
    'r-sideproject': (releasesData, downloadsData, leadsData, opts) => {
      const facts = realFactsLine(releasesData, downloadsData, opts);
      if (!facts) return null;
      const releases = ((releasesData && releasesData.releases) || []);
      const latest = releases.length ? releases[releases.length - 1] : null;
      return {
        title: 'Sondrik' + (latest ? ' v' + latest.version : '') + ' - [one-line pitch, fill in before posting]',
        body: 'I\'ve been building Sondrik, a CRM tool. ' + facts +
          '\n\n[Add the real story: why you built it, what you learned. r/SideProject removes low-effort link drops with no real description.]'
      };
    },
    'indie-hackers-milestones': (releasesData, downloadsData, leadsData, opts) => {
      const metric = (downloadsData && downloadsData.metric) || {};
      const checks = sortedChecks(downloadsData);
      if (checks.length === 0) return null;
      const latest = checks[checks.length - 1];
      const facts = realFactsLine(releasesData, downloadsData, opts);
      return {
        title: latest.count + ' ' + (metric.label || 'downloads') + ' for Sondrik',
        body: facts + '\n\n[Add what you actually learned getting here. Milestone posts with a real story get far more engagement than a bare announcement, per Indie Hackers\' own posting guidance.]'
      };
    },
    // Reuses the exact same real-facts composition buildPublicPost already
    // builds for the header's own "Copy build-in-public post" button, rather
    // than a second, possibly-drifting copy of the same logic. No separate
    // title line, X has no title field.
    'x-twitter': (releasesData, downloadsData, leadsData, opts) => {
      const text = buildPublicPost(releasesData || {}, downloadsData || {}, leadsData || {}, opts);
      return text ? { title: null, body: text } : null;
    }
  };

  function buildChannelDraftPost(channelId, releasesData, downloadsData, leadsData, opts) {
    const builder = CHANNEL_POST_BUILDERS[channelId];
    if (!builder) return null;
    const draft = builder(releasesData, downloadsData, leadsData, opts);
    if (!draft) return null;
    return draft.title ? draft.title + '\n\n' + draft.body : draft.body;
  }

  return {
    buildStatusUpdate, buildPublicPost, realFactsLine,
    CHANNEL_POST_BUILDERS, buildChannelDraftPost
  };
});

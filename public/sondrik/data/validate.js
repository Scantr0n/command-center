#!/usr/bin/env node
/*
 * Validates releases.json, downloads.json, leads.json, channels.json, and
 * goals.json against the field rules used by public/sondrik/app.js. Run
 * after hand-editing any of them.
 *
 * Usage: node public/sondrik/data/validate.js
 * Exit code 0 = clean, 1 = errors found.
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = __dirname;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function loadJson(name) {
  const file = path.join(DATA_DIR, name);
  const raw = fs.readFileSync(file, 'utf8');
  return JSON.parse(raw);
}

function isDateOrNull(v) {
  return v === null || v === undefined || (typeof v === 'string' && DATE_RE.test(v));
}

function main() {
  const errors = [];
  const warnings = [];

  let releasesData, downloadsData, leadsData, channelsData;
  try {
    releasesData = loadJson('releases.json');
  } catch (e) {
    console.error('Failed to read/parse releases.json: ' + e.message);
    process.exit(1);
  }
  try {
    downloadsData = loadJson('downloads.json');
  } catch (e) {
    console.error('Failed to read/parse downloads.json: ' + e.message);
    process.exit(1);
  }
  try {
    leadsData = loadJson('leads.json');
  } catch (e) {
    console.error('Failed to read/parse leads.json: ' + e.message);
    process.exit(1);
  }
  try {
    channelsData = loadJson('channels.json');
  } catch (e) {
    console.error('Failed to read/parse channels.json: ' + e.message);
    process.exit(1);
  }
  let goalsData;
  try {
    goalsData = loadJson('goals.json');
  } catch (e) {
    console.error('Failed to read/parse goals.json: ' + e.message);
    process.exit(1);
  }

  // releases.json
  const seenVersions = new Set();
  (releasesData.releases || []).forEach((r, idx) => {
    const where = 'releases[' + idx + ']' + (r && r.version ? ' (' + r.version + ')' : '');
    if (!r.version) errors.push(where + ': missing "version"');
    else if (seenVersions.has(r.version)) errors.push(where + ': duplicate version "' + r.version + '"');
    else seenVersions.add(r.version);
    if (!isDateOrNull(r.date)) errors.push(where + ': "date" is not a YYYY-MM-DD date or null: ' + JSON.stringify(r.date));
    if (!r.date) warnings.push(where + ': no ship date logged yet');
    if (!r.summary) warnings.push(where + ': no summary logged yet');
  });

  // downloads.json
  const metric = downloadsData.metric || {};
  if (!metric.label) errors.push('metric.label is missing');
  if (!metric.source) warnings.push('metric.source is missing, a download count with no cited source reads as an estimate');
  const checks = metric.checks || [];
  const seenDates = new Set();
  let prevDate = null;
  checks.forEach((c, idx) => {
    const where = 'metric.checks[' + idx + ']';
    if (!isDateOrNull(c.date)) errors.push(where + ': "date" is not a YYYY-MM-DD date or null: ' + JSON.stringify(c.date));
    else if (c.date) {
      if (seenDates.has(c.date)) errors.push(where + ': duplicate check date "' + c.date + '"');
      seenDates.add(c.date);
      if (prevDate && c.date < prevDate) {
        warnings.push(where + ': checks are not in chronological order (this check predates the one before it)');
      }
      prevDate = c.date;
    }
    if (typeof c.count !== 'number' || c.count < 0) {
      errors.push(where + ': "count" must be a non-negative number, got ' + JSON.stringify(c.count));
    }
  });

  // channels.json (validated before leads.json so a lead's channelId can be
  // checked against the real set of channel ids)
  const VALID_STATUSES = new Set(['tracked', 'manual-log', 'not-tracked']);
  const VALID_LINKS = new Set([null, undefined, 'downloads', 'leads']);
  const seenChannelIds = new Set();
  (channelsData.channels || []).forEach((c, idx) => {
    const where = 'channels[' + idx + ']' + (c && c.id ? ' (' + c.id + ')' : '');
    if (!c.id) errors.push(where + ': missing "id"');
    else if (seenChannelIds.has(c.id)) errors.push(where + ': duplicate id "' + c.id + '"');
    else seenChannelIds.add(c.id);
    if (!c.name) errors.push(where + ': missing "name"');
    if (!VALID_STATUSES.has(c.status)) {
      errors.push(where + ': "status" must be one of tracked, manual-log, not-tracked, got ' + JSON.stringify(c.status));
    }
    if (!VALID_LINKS.has(c.linkedMetric)) {
      errors.push(where + ': "linkedMetric" must be null, "downloads", or "leads", got ' + JSON.stringify(c.linkedMetric));
    }
    if (c.status === 'tracked' && !c.linkedMetric) {
      warnings.push(where + ': status is "tracked" but no linkedMetric is set, nothing real to display for it');
    }
    if (c.status === 'not-tracked' && !c.note) {
      warnings.push(where + ': status is "not-tracked" with no note explaining why, reads as an unexplained gap');
    }
  });

  // leads.json
  const seenLeadIds = new Set();
  (leadsData.leads || []).forEach((l, idx) => {
    const where = 'leads[' + idx + ']' + (l && l.id ? ' (' + l.id + ')' : '');
    if (!l.id) errors.push(where + ': missing "id"');
    else if (seenLeadIds.has(l.id)) errors.push(where + ': duplicate id "' + l.id + '"');
    else seenLeadIds.add(l.id);
    if (!l.summary) errors.push(where + ': missing "summary"');
    if (!isDateOrNull(l.loggedDate)) errors.push(where + ': "loggedDate" is not a YYYY-MM-DD date or null: ' + JSON.stringify(l.loggedDate));
    // channelId attributes this lead to a channel card's count (see
    // renderChannels in app.js); a channelId that doesn't match any real
    // channel would silently attribute the lead to nothing, so it's an
    // error, not a warning, same weight as a bad relatedTo id elsewhere.
    if (l.channelId !== undefined && l.channelId !== null && !seenChannelIds.has(l.channelId)) {
      errors.push(where + ': "channelId" references unknown channel id "' + l.channelId + '"');
    }

    const o = l.outreach || {};
    if (o.sent === true && o.approvalStatus !== 'approved') {
      errors.push(where + ': outreach.sent is true but approvalStatus is not "approved". A send must never be ' +
        'recorded without an explicit approval on record.');
    }
    if (o.sent === undefined) {
      errors.push(where + ': outreach.sent must be explicitly true or false, never left unset.');
    }
  });

  // goals.json (validated after downloads.json, since the only supported
  // metric right now is "downloads"; a goal against an unsupported metric
  // has nothing real to show progress against, so that's an error, not a
  // warning)
  const VALID_GOAL_METRICS = new Set(['downloads']);
  const seenGoalIds = new Set();
  (goalsData.goals || []).forEach((g, idx) => {
    const where = 'goals[' + idx + ']' + (g && g.id ? ' (' + g.id + ')' : '');
    if (!g.id) errors.push(where + ': missing "id"');
    else if (seenGoalIds.has(g.id)) errors.push(where + ': duplicate id "' + g.id + '"');
    else seenGoalIds.add(g.id);
    if (!g.label) errors.push(where + ': missing "label"');
    if (!VALID_GOAL_METRICS.has(g.metric)) {
      errors.push(where + ': "metric" must be one of ' + [...VALID_GOAL_METRICS].join(', ') + ', got ' + JSON.stringify(g.metric));
    }
    if (typeof g.target !== 'number' || g.target <= 0) {
      errors.push(where + ': "target" must be a positive number, got ' + JSON.stringify(g.target));
    }
    if (!isDateOrNull(g.targetDate)) errors.push(where + ': "targetDate" is not a YYYY-MM-DD date or null: ' + JSON.stringify(g.targetDate));
    if (!isDateOrNull(g.setDate)) errors.push(where + ': "setDate" is not a YYYY-MM-DD date or null: ' + JSON.stringify(g.setDate));
    if (!g.setDate) warnings.push(where + ': no setDate logged, cannot tell when this target was actually set');
  });

  if (warnings.length) {
    console.warn(warnings.length + ' warning(s):');
    warnings.forEach(w => console.warn('  - ' + w));
  }

  if (errors.length) {
    console.error((warnings.length ? '\n' : '') + errors.length + ' error(s) in public/sondrik/data/*.json:');
    errors.forEach(e => console.error('  - ' + e));
    process.exit(1);
  }

  console.log('sondrik data files are valid (' + (releasesData.releases || []).length + ' release(s), ' +
    checks.length + ' download check(s), ' + (leadsData.leads || []).length + ' lead(s), ' +
    (channelsData.channels || []).length + ' channel(s), ' + (goalsData.goals || []).length + ' goal(s)).');
  process.exit(0);
}

main();

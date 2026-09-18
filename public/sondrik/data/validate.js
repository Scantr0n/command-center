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
const { execFileSync } = require('child_process');
const { findDuplicateLeads } = require('./validate-core.js');

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

// Every other real string on this page (release summaries, the traction
// scope note, lead/channel/goal notes, the assistant's own chat replies per
// server.js's system prompt) is written without em dashes, so a hand-typed
// field that has one reads as a paste-in from somewhere else rather than
// Jack's or this product's own voice. Warning-level only: an em dash never
// breaks anything the page renders, this is a style nudge, not a data error.
function emDashFields(obj, fields) {
  const hits = [];
  if (!obj) return hits;
  fields.forEach(f => {
    const v = obj[f];
    if (typeof v === 'string' && v.includes(String.fromCharCode(8212))) hits.push(f);
  });
  return hits;
}

// Catches the most plausible hand-edit slip in a file with no other input
// validation: typing last year's habit into the year field (e.g. "2025-09-07"
// a week after New Year's) or transposing a digit. A 1-day allowance avoids
// flagging a same-day entry made in a timezone ahead of this machine's.
// Only checked against dates that record something that already happened
// (a ship date, a check date, a logged date); a goal's targetDate is
// supposed to be in the future, so it is never passed here.
function isFutureDate(v) {
  if (!v || !DATE_RE.test(v)) return false;
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  return new Date(v + 'T00:00:00') > tomorrow;
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
    else if (isFutureDate(r.date)) warnings.push(where + ': "date" (' + r.date + ') is in the future, a shipped release should have a real past ship date, check for a typo');
    if (!r.date) warnings.push(where + ': no ship date logged yet');
    if (!r.summary) warnings.push(where + ': no summary logged yet');
    emDashFields(r, ['summary', 'notes']).forEach(f =>
      warnings.push(where + ': "' + f + '" contains an em dash, this product never uses one, check for a paste-in'));
  });

  // downloads.json
  const metric = downloadsData.metric || {};
  if (!metric.label) errors.push('metric.label is missing');
  if (!metric.source) warnings.push('metric.source is missing, a download count with no cited source reads as an estimate');
  emDashFields(metric, ['label', 'source', 'scope']).forEach(f =>
    warnings.push('metric.' + f + ' contains an em dash, this product never uses one, check for a paste-in'));
  const checks = metric.checks || [];
  const seenDates = new Set();
  let prevDate = null;
  let prevCount = null;
  checks.forEach((c, idx) => {
    const where = 'metric.checks[' + idx + ']';
    if (!isDateOrNull(c.date)) errors.push(where + ': "date" is not a YYYY-MM-DD date or null: ' + JSON.stringify(c.date));
    else if (c.date) {
      if (seenDates.has(c.date)) errors.push(where + ': duplicate check date "' + c.date + '"');
      seenDates.add(c.date);
      if (isFutureDate(c.date)) warnings.push(where + ': "date" (' + c.date + ') is in the future, a real check should be dated when it was actually run, check for a typo');
      if (prevDate && c.date < prevDate) {
        warnings.push(where + ': checks are not in chronological order (this check predates the one before it)');
      }
      prevDate = c.date;
    }
    if (typeof c.count !== 'number' || c.count < 0) {
      errors.push(where + ': "count" must be a non-negative number, got ' + JSON.stringify(c.count));
    } else {
      // A GitHub release download count is cumulative and can only go up.
      // A later check reading lower than an earlier one almost always means
      // a transposed digit or the wrong check pasted in, not a real drop, so
      // this is worth flagging even though it can't tell which entry is wrong.
      if (prevCount !== null && c.count < prevCount) {
        warnings.push(where + ': count (' + c.count + ') is lower than the previous check (' + prevCount +
          '), a real cumulative download count should not go down, check for a typo');
      }
      prevCount = c.count;
    }
    emDashFields(c, ['note']).forEach(f =>
      warnings.push(where + ': "' + f + '" contains an em dash, this product never uses one, check for a paste-in'));
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
    emDashFields(c, ['name', 'note']).forEach(f =>
      warnings.push(where + ': "' + f + '" contains an em dash, this product never uses one, check for a paste-in'));
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
    else if (isFutureDate(l.loggedDate)) warnings.push(where + ': "loggedDate" (' + l.loggedDate + ') is in the future, a lead should be logged on the day it actually came in, check for a typo');
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
    // A 2026-09-17 incident (see git history) set sent:true and
    // approvalStatus:"approved" together, justified only by an unverifiable
    // "per project memory" note, when the send had not actually happened.
    // approvalStatus alone is trivial to flip alongside sent in the same
    // edit, so it caught nothing. Requiring a real, dated sentDate distinct
    // from loggedDate raises the bar: it forces whoever marks a lead sent to
    // write down the specific day it happened, not just echo the two status
    // fields back at each other. This still cannot prove the send was real,
    // so it is not sufficient on its own: outreach must only ever be marked
    // sent because Jack said, in his own words, that he sent it, never
    // inferred, assumed, or reconstructed from "memory".
    if (o.sent === true && typeof o.sentDate !== 'string') {
      errors.push(where + ': outreach.sent is true but "sentDate" is missing. Record the real date Jack said ' +
        'he sent it, never leave this implicit.');
    } else if (o.sent === true && !DATE_RE.test(o.sentDate)) {
      errors.push(where + ': outreach.sentDate (' + JSON.stringify(o.sentDate) + ') is not a YYYY-MM-DD date.');
    } else if (o.sent === true && isFutureDate(o.sentDate)) {
      errors.push(where + ': outreach.sentDate (' + o.sentDate + ') is in the future, check for a typo.');
    }
    if (o.sent !== true && o.sentDate) {
      errors.push(where + ': outreach.sentDate is set but sent is not true, remove it until the message is ' +
        'actually sent.');
    }
    if (o.sent === undefined) {
      errors.push(where + ': outreach.sent must be explicitly true or false, never left unset.');
    }
    emDashFields(l, ['summary', 'sourceDetail', 'source', 'type']).forEach(f =>
      warnings.push(where + ': "' + f + '" contains an em dash, this product never uses one, check for a paste-in'));
    emDashFields(o, ['note']).forEach(f =>
      warnings.push(where + ': outreach.' + f + ' contains an em dash, this product never uses one, check for a paste-in'));
  });

  // Mirrors the leads feed's own inline duplicate flag in app.js: the same
  // real contact can end up logged twice (e.g. the same commenter replied to
  // in two places and re-logged), and nothing above catches it since each id
  // is otherwise valid on its own. Grouping logic shared via validate-core.js
  // so the two can never drift.
  findDuplicateLeads(leadsData.leads || []).forEach(group => {
    const ids = group.map(l => l.id || '(missing id)');
    const descriptor = group[0].sourceDetail
      ? 'the same channel and source detail ("' + group[0].sourceDetail + '")'
      : 'the same channel, source, and summary';
    warnings.push('possible duplicate lead: ' + ids.length + ' leads (' + ids.join(', ') + ') share ' + descriptor +
      '. Confirm these are really separate contacts, not the same person logged twice.');
  });

  // goals.json (validated after downloads.json and leads.json, since those
  // are the only two metrics with real numbers behind them so far; a goal
  // against an unsupported metric has nothing real to show progress against,
  // so that's an error, not a warning)
  const VALID_GOAL_METRICS = new Set(['downloads', 'leads']);
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
    else if (isFutureDate(g.setDate)) warnings.push(where + ': "setDate" (' + g.setDate + ') is in the future, a goal should be set as of the day Jack actually set it, check for a typo');
    if (!g.setDate) warnings.push(where + ': no setDate logged, cannot tell when this target was actually set');
    emDashFields(g, ['label', 'note']).forEach(f =>
      warnings.push(where + ': "' + f + '" contains an em dash, this product never uses one, check for a paste-in'));
  });

  // changelog.json is generated, not hand-edited (see changelog.js), so it
  // can't have the typo-style errors above, only one real failure mode: it
  // silently falls behind after someone commits a real edit to one of the
  // hand-edited files above without re-running the generator. Comparing its
  // recorded latest commit against this repo's actual latest commit for
  // those same files is the only way to catch that drift; git itself is the
  // source of truth here, same as changelog.js.
  try {
    const latestRealHash = execFileSync('git', [
      'log', '-1', '--format=%H', '--',
      'releases.json', 'downloads.json', 'leads.json', 'channels.json', 'goals.json'
    ], { cwd: DATA_DIR, encoding: 'utf8' }).trim();
    let changelogData = null;
    try {
      changelogData = loadJson('changelog.json');
    } catch (e) {
      warnings.push('changelog.json is missing or unreadable (' + e.message + '), run node public/sondrik/data/changelog.js');
    }
    if (changelogData && latestRealHash) {
      const recordedHash = (changelogData.entries && changelogData.entries[0] && changelogData.entries[0].fullHash) || null;
      if (recordedHash !== latestRealHash) {
        warnings.push('changelog.json is stale (its latest recorded commit does not match this repo\'s actual latest commit ' +
          'touching these data files), run node public/sondrik/data/changelog.js to refresh it');
      }
    }
  } catch (e) {
    // Not a git checkout, or git isn't on PATH: can't check changelog
    // freshness, but that's an environment gap, not a data error, so this
    // stays silent rather than adding a warning no one can act on.
  }

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

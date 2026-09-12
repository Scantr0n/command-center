#!/usr/bin/env node
/*
 * Validates releases.json, downloads.json, and leads.json against the field
 * rules used by public/sondrik/app.js. Run after hand-editing any of them.
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

  let releasesData, downloadsData, leadsData;
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

  // leads.json
  const seenLeadIds = new Set();
  (leadsData.leads || []).forEach((l, idx) => {
    const where = 'leads[' + idx + ']' + (l && l.id ? ' (' + l.id + ')' : '');
    if (!l.id) errors.push(where + ': missing "id"');
    else if (seenLeadIds.has(l.id)) errors.push(where + ': duplicate id "' + l.id + '"');
    else seenLeadIds.add(l.id);
    if (!l.summary) errors.push(where + ': missing "summary"');
    if (!isDateOrNull(l.loggedDate)) errors.push(where + ': "loggedDate" is not a YYYY-MM-DD date or null: ' + JSON.stringify(l.loggedDate));

    const o = l.outreach || {};
    if (o.sent === true && o.approvalStatus !== 'approved') {
      errors.push(where + ': outreach.sent is true but approvalStatus is not "approved". A send must never be ' +
        'recorded without an explicit approval on record.');
    }
    if (o.sent === undefined) {
      errors.push(where + ': outreach.sent must be explicitly true or false, never left unset.');
    }
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
    checks.length + ' download check(s), ' + (leadsData.leads || []).length + ' lead(s)).');
  process.exit(0);
}

main();

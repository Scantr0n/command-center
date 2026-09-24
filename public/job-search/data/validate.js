#!/usr/bin/env node
/*
 * Validates applications.json, criteria.json, next-up.json, and
 * digest-latest.json against the field rules used by public/job-search/app.js.
 * Run after hand-editing any of them.
 *
 * Usage: node public/job-search/data/validate.js
 * Exit code 0 = clean, 1 = errors found.
 *
 * Modeled on public/sondrik/data/validate.js: required-field checks are
 * errors, honesty/no-fabrication checks are warnings. This hub has no
 * outreach-send guard (Sondrik's sharpest rule) because nothing here is ever
 * sent, it's a read-only reference transcribed from
 * Trackers/Job_Search_Tracker.md. The guard that matters most here instead is
 * the fullyVerifiedCount cross-check below: the one place a hand-edit could
 * silently drift from what the tracker actually says.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { isDateOrNull, isFutureDate, emDashFields, isValidSourceUrlOrNull, findDuplicateApplications } = require('./validate-core.js');

const DATA_DIR = __dirname;
const CHANGELOG_TRACKED_FILES = ['applications.json', 'criteria.json', 'next-up.json', 'digest-latest.json'];

function loadJson(name) {
  const file = path.join(DATA_DIR, name);
  const raw = fs.readFileSync(file, 'utf8');
  return JSON.parse(raw);
}

function main() {
  const errors = [];
  const warnings = [];

  let applicationsData, criteriaData, nextUpData, digestData;
  try {
    applicationsData = loadJson('applications.json');
  } catch (e) {
    console.error('Failed to read/parse applications.json: ' + e.message);
    process.exit(1);
  }
  try {
    criteriaData = loadJson('criteria.json');
  } catch (e) {
    console.error('Failed to read/parse criteria.json: ' + e.message);
    process.exit(1);
  }
  try {
    nextUpData = loadJson('next-up.json');
  } catch (e) {
    console.error('Failed to read/parse next-up.json: ' + e.message);
    process.exit(1);
  }
  try {
    digestData = loadJson('digest-latest.json');
  } catch (e) {
    console.error('Failed to read/parse digest-latest.json: ' + e.message);
    process.exit(1);
  }

  // applications.json
  const seenNums = new Set();
  (applicationsData.applications || []).forEach((a, idx) => {
    const where = 'applications[' + idx + ']' + (a && a.company ? ' (' + a.company + ')' : '');
    if (typeof a.num !== 'number') errors.push(where + ': missing numeric "num"');
    else if (seenNums.has(a.num)) errors.push(where + ': duplicate "num" ' + a.num);
    else seenNums.add(a.num);
    ['role', 'company', 'location', 'pay'].forEach(f => {
      if (!a[f]) errors.push(where + ': missing "' + f + '"');
    });
    if (!isDateOrNull(a.appliedDate)) errors.push(where + ': "appliedDate" is not a YYYY-MM-DD date or null: ' + JSON.stringify(a.appliedDate));
    else if (!a.appliedDate) warnings.push(where + ': no appliedDate logged, an application row with no real date reads as unconfirmed');
    else if (isFutureDate(a.appliedDate)) warnings.push(where + ': "appliedDate" (' + a.appliedDate + ') is in the future, check for a typo');
    emDashFields(a, ['role', 'company', 'location', 'pay']).forEach(f =>
      warnings.push(where + ': "' + f + '" contains an em dash, this is a transcription field, check it against the source tracker'));
  });
  (applicationsData.dropped || []).forEach((d, idx) => {
    const where = 'dropped[' + idx + ']';
    if (!d.company) errors.push(where + ': missing "company"');
    if (!d.reason) errors.push(where + ': missing "reason", a dropped application with no real reason logged reads as unexplained');
  });
  (applicationsData.skipped || []).forEach((s, idx) => {
    const where = 'skipped[' + idx + ']';
    if (!s.company) errors.push(where + ': missing "company"');
    if (!s.reason) errors.push(where + ': missing "reason", a skipped application with no real reason logged reads as unexplained');
  });
  // Catches the same real risk every other hub's own duplicate check already
  // guards against: applications.json's only uniqueness check above is on
  // "num" (auto-incrementing, so it can't naturally collide except by
  // mistake), so the same tracker entry hand-transcribed twice under two
  // different "num" values would otherwise go undetected.
  findDuplicateApplications(applicationsData.applications || []).forEach(group => {
    warnings.push('applications: ' + group.length + ' entries match on company + role (' +
      group.map(a => '#' + a.num).join(', ') + '), check for a duplicate transcription');
  });
  const savedCount = applicationsData.savedCount || {};
  if (typeof savedCount.count !== 'number' || savedCount.count < 0) {
    errors.push('savedCount.count must be a non-negative number, got ' + JSON.stringify(savedCount.count));
  }
  if (!isDateOrNull(savedCount.asOfDate)) {
    errors.push('savedCount.asOfDate is not a YYYY-MM-DD date or null: ' + JSON.stringify(savedCount.asOfDate));
  } else if (!savedCount.asOfDate) {
    errors.push('savedCount.asOfDate is missing, a saved-jobs count with no dated source reads as claimed-current rather than a fact pinned to a real date');
  }
  if (!savedCount.note) {
    warnings.push('savedCount.note is missing, without one this count risks reading as live/current rather than a specific last-known date');
  }

  // criteria.json
  if (!Array.isArray(criteriaData.standingCriteria) || criteriaData.standingCriteria.length === 0) {
    errors.push('standingCriteria must be a non-empty array of real criteria strings');
  } else {
    criteriaData.standingCriteria.forEach((c, idx) => {
      if (typeof c !== 'string' || !c.trim()) errors.push('standingCriteria[' + idx + ']: must be a non-empty string');
    });
  }
  const db = criteriaData.dealbreakers || {};
  if (!db.intro) warnings.push('dealbreakers.intro is missing');
  if (!Array.isArray(db.items) || db.items.length === 0) {
    errors.push('dealbreakers.items must be a non-empty array of real checklist items');
  } else {
    db.items.forEach((it, idx) => {
      if (typeof it !== 'string' || !it.trim()) errors.push('dealbreakers.items[' + idx + ']: must be a non-empty string');
    });
  }

  // next-up.json
  if (!isDateOrNull(nextUpData.asOfDate) || !nextUpData.asOfDate) {
    errors.push('next-up asOfDate is missing or not a real YYYY-MM-DD date, this section is only honest with a real "as of" date attached');
  } else if (isFutureDate(nextUpData.asOfDate)) {
    warnings.push('next-up asOfDate (' + nextUpData.asOfDate + ') is in the future, check for a typo');
  }
  if (!nextUpData.intro) warnings.push('next-up.intro is missing');
  (nextUpData.standouts || []).forEach((s, idx) => {
    const where = 'next-up.standouts[' + idx + ']' + (s && s.name ? ' (' + s.name + ')' : '');
    if (!s.name) errors.push(where + ': missing "name"');
    if (!isValidSourceUrlOrNull(s.sourceUrl)) {
      errors.push(where + ': "sourceUrl" must be a real http(s) or mailto link, or null, got ' + JSON.stringify(s.sourceUrl));
    }
    if (s.sourceUrl && !s.sourceLabel) {
      warnings.push(where + ': has a sourceUrl but no sourceLabel, link text would fall back to something generic');
    }
    emDashFields(s, ['name', 'detail', 'caveat', 'pay', 'hours', 'remote']).forEach(f =>
      warnings.push(where + ': "' + f + '" contains an em dash, this is a transcription field, check it against the source tracker'));
  });

  // digest-latest.json
  if (!isDateOrNull(digestData.runDate) || !digestData.runDate) {
    errors.push('digest-latest.runDate is missing or not a real YYYY-MM-DD date');
  } else if (isFutureDate(digestData.runDate)) {
    warnings.push('digest-latest.runDate (' + digestData.runDate + ') is in the future, check for a typo');
  }
  if (typeof digestData.fullyVerifiedCount !== 'number' || digestData.fullyVerifiedCount < 0) {
    errors.push('digest-latest.fullyVerifiedCount must be a non-negative number');
  }
  if (typeof digestData.totalItemsCount !== 'number' || digestData.totalItemsCount < 0) {
    errors.push('digest-latest.totalItemsCount must be a non-negative number');
  }
  const otherVerified = digestData.otherVerifiedByPay || [];
  const undisclosed = digestData.verifiedPayUndisclosed || [];
  [].concat(
    [digestData.bestOverallFit].filter(Boolean).map((l, i) => ['bestOverallFit', l]),
    otherVerified.map((l, i) => ['otherVerifiedByPay[' + i + ']', l]),
    undisclosed.map((l, i) => ['verifiedPayUndisclosed[' + i + ']', l])
  ).forEach(([where, l]) => {
    if (!l.name) errors.push('digest-latest.' + where + ': missing "name"');
    if (!isValidSourceUrlOrNull(l.sourceUrl)) {
      errors.push('digest-latest.' + where + ': "sourceUrl" must be a real http(s) or mailto link, or null, got ' + JSON.stringify(l.sourceUrl));
    }
    emDashFields(l, ['name', 'location', 'pay', 'detail']).forEach(f =>
      warnings.push('digest-latest.' + where + ': "' + f + '" contains an em dash, this is a transcription field, check it against the source tracker'));
  });
  // No-fabrication guard: the headline "Fully verified (N)" claim in the
  // tracker prose must actually match the number of itemized leads below it,
  // the same way Sondrik's changelog check catches a summary number that
  // drifted from the real records behind it. This is the field most likely
  // to go stale silently if someone edits the lead lists without also
  // updating the count, or vice versa.
  const itemizedCount = (digestData.bestOverallFit ? 1 : 0) + otherVerified.length + undisclosed.length;
  if (typeof digestData.fullyVerifiedCount === 'number' && digestData.fullyVerifiedCount !== itemizedCount) {
    errors.push('digest-latest.fullyVerifiedCount (' + digestData.fullyVerifiedCount + ') does not match the number of ' +
      'itemized leads actually listed (' + itemizedCount + ' across bestOverallFit + otherVerifiedByPay + ' +
      'verifiedPayUndisclosed). Either a lead is missing from the lists or the count was hand-typed wrong, check ' +
      'against the source tracker before trusting either number.');
  }

  checkChangelogFreshness(warnings);

  if (warnings.length) {
    console.warn(warnings.length + ' warning(s):');
    warnings.forEach(w => console.warn('  - ' + w));
  }

  if (errors.length) {
    console.error((warnings.length ? '\n' : '') + errors.length + ' error(s) in public/job-search/data/*.json:');
    errors.forEach(e => console.error('  - ' + e));
    process.exit(1);
  }

  console.log('job-search data files are valid (' + (applicationsData.applications || []).length + ' application(s), ' +
    (criteriaData.standingCriteria || []).length + ' standing criteria, ' + (db.items || []).length + ' dealbreaker item(s), ' +
    (nextUpData.standouts || []).length + ' next-up standout(s), ' + itemizedCount + ' latest-digest lead(s)).');
  process.exit(0);
}

// changelog.json is generated, not hand-edited (see changelog.js), so it
// can't have the typo-style errors above, only a drift failure mode: it
// silently falls behind the real commit history, or keeps entries from
// before a history rewrite that are no longer reachable from any branch.
// Comparing the full recorded commit list against this repo's actual commit
// list for these same files, not just the latest hash, is what catches a
// corrupted middle of the list, not only a stale head; git itself is the
// source of truth here, same as changelog.js. Same check already in place
// on CSM/Sondrik/Alpha/CGT/Garage's own validate.js for the same reason.
function checkChangelogFreshness(warnings) {
  try {
    // A shallow clone's `git log` for these files only ever sees the commits
    // fetched, which is not the same thing as "these files have no earlier
    // history": comparing that truncated list against a changelog.json
    // generated from a real full clone reports a "drift" that isn't real
    // (this bit CGT and Sondrik for real on 2026-09-19). Skipped the same as
    // "not a git checkout" below, an environment gap, not a data error.
    if (execFileSync('git', ['rev-parse', '--is-shallow-repository'], { cwd: DATA_DIR, encoding: 'utf8' }).trim() === 'true') return;
    const realHashesRaw = execFileSync('git', [
      'log', '--format=%H', '--',
      ...CHANGELOG_TRACKED_FILES
    ], { cwd: DATA_DIR, encoding: 'utf8' }).trim();
    const realHashes = realHashesRaw ? realHashesRaw.split('\n') : [];
    let changelogData = null;
    try {
      changelogData = loadJson('changelog.json');
    } catch (e) {
      warnings.push('changelog.json is missing or unreadable (' + e.message + '), run node public/job-search/data/changelog.js');
      return;
    }
    const recordedHashes = (changelogData.entries || []).map(e => e.fullHash);
    if (recordedHashes.join(',') !== realHashes.join(',')) {
      warnings.push('changelog.json does not match this repo\'s actual commit history for these data files ' +
        '(' + recordedHashes.length + ' entr' + (recordedHashes.length === 1 ? 'y' : 'ies') + ' recorded vs ' +
        realHashes.length + ' real commit' + (realHashes.length === 1 ? '' : 's') + '), run ' +
        'node public/job-search/data/changelog.js to refresh it');
    }
  } catch (e) {
    // Not a git checkout, or git isn't on PATH: can't check changelog
    // freshness, but that's an environment gap, not a data error, so this
    // stays silent rather than adding a warning no one can act on.
  }
}

main();

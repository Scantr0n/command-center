#!/usr/bin/env node
/*
 * Validates prospects.json against stages.json and the field rules documented
 * in public/csm/index.html. Run this after hand-editing prospects.json, since
 * the board silently drops any prospect whose "stage" does not exactly match
 * a stage id (a typo just makes a row disappear, with no error in the UI).
 *
 * The real field rules live in validateProspects (validate-core.js), shared
 * with the browser-side CSV importer (import.js) so a prospects.json built
 * from an imported batch is checked against the exact same rules as a hand-
 * edited one, not a second, maybe-drifted copy of them.
 *
 * Usage: node public/csm/data/validate.js
 * Exit code 0 = clean, 1 = errors found.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { validateProspects } = require('./validate-core.js');
const { emDashFields, hasLegacySocialSnapshotField } = require('./csm-core.js');

const DATA_DIR = __dirname;

function loadJson(name) {
  const file = path.join(DATA_DIR, name);
  const raw = fs.readFileSync(file, 'utf8');
  return JSON.parse(raw);
}

function main() {
  let stagesData, prospectsData;
  try {
    stagesData = loadJson('stages.json');
  } catch (e) {
    console.error('Failed to read/parse stages.json: ' + e.message);
    process.exit(1);
  }
  try {
    prospectsData = loadJson('prospects.json');
  } catch (e) {
    console.error('Failed to read/parse prospects.json: ' + e.message);
    process.exit(1);
  }

  const stages = stagesData.stages || [];
  const prospects = prospectsData.prospects || [];
  const { errors, warnings } = validateProspects(prospects, stages, { emDashFields, hasLegacySocialSnapshotField });

  checkChangelogFreshness(warnings);

  if (warnings.length) {
    console.warn(warnings.length + ' warning(s):');
    warnings.forEach(w => console.warn('  - ' + w));
  }

  if (errors.length) {
    console.error((warnings.length ? '\n' : '') + errors.length + ' error(s) in public/csm/data/prospects.json:');
    errors.forEach(e => console.error('  - ' + e));
    process.exit(1);
  }

  console.log('prospects.json is valid (' + prospects.length + ' prospect(s), ' + stages.length + ' stage(s)).');
  process.exit(0);
}

// changelog.json is generated, not hand-edited (see changelog.js), so it
// can't have the typo-style errors above, only a drift failure mode: it
// silently falls behind the real commit history, or keeps entries from
// before a history rewrite that are no longer reachable from any branch
// (the exact shape found in CGT's and Sondrik's data on 2026-09-19, and in
// this section's own changelog.json before this check was added). Comparing
// the full recorded commit list against this repo's actual commit list for
// these same files, not just the latest hash, is what catches a corrupted
// middle of the list, not only a stale head; git itself is the source of
// truth here, same as changelog.js.
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
      'prospects.json', 'stages.json'
    ], { cwd: DATA_DIR, encoding: 'utf8' }).trim();
    const realHashes = realHashesRaw ? realHashesRaw.split('\n') : [];
    let changelogData = null;
    try {
      changelogData = loadJson('changelog.json');
    } catch (e) {
      warnings.push('changelog.json is missing or unreadable (' + e.message + '), run node public/csm/data/changelog.js');
      return;
    }
    const recordedHashes = (changelogData.entries || []).map(e => e.fullHash);
    if (recordedHashes.join(',') !== realHashes.join(',')) {
      warnings.push('changelog.json does not match this repo\'s actual commit history for these data files ' +
        '(' + recordedHashes.length + ' entr' + (recordedHashes.length === 1 ? 'y' : 'ies') + ' recorded vs ' +
        realHashes.length + ' real commit' + (realHashes.length === 1 ? '' : 's') + '), run ' +
        'node public/csm/data/changelog.js to refresh it');
    }
  } catch (e) {
    // Not a git checkout, or git isn't on PATH: can't check changelog
    // freshness, but that's an environment gap, not a data error, so this
    // stays silent rather than adding a warning no one can act on.
  }
}

main();

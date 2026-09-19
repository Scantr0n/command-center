#!/usr/bin/env node
/*
 * Validates cards.json, submissions.json, and candidates.json against the
 * field rules documented in public/cgt/index.html. Run this after
 * hand-editing any of the three.
 *
 * The rule cards.json exists to enforce: every card with an estimatedValue
 * must say whether that number is a real recent sale or a comp-based
 * estimate (valuationBasis), and a comp-based estimate must carry a compNote
 * saying what it was based on. A price with no basis label is exactly the
 * silent guessing this tracker is built to avoid, so it is an error, not a
 * warning. submissions.json tracks cards sent off for grading that have not
 * come back yet, kept separate from cards.json since a submission has no
 * grade or cert number of its own. candidates.json tracks raw cards still
 * being weighed against the real cost of grading them, before a submission
 * exists at all, and enforces the same never-a-silent-guess rule on both its
 * raw-value and expected-graded-value estimates.
 *
 * The rules themselves live in validate-core.js, shared with the browser-side
 * CSV import tool (public/cgt/import.js) so both places enforce the same
 * checks instead of drifting apart. This file is just the Node CLI wrapper:
 * read the JSON files off disk, run the shared rules, print results.
 *
 * Usage: node public/cgt/data/validate.js
 * Exit code 0 = clean, 1 = errors found.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { validateCards, validateSubmissions, validateCandidates } = require('./validate-core.js');

const DATA_DIR = __dirname;

function loadJson(name) {
  const file = path.join(DATA_DIR, name);
  const raw = fs.readFileSync(file, 'utf8');
  return JSON.parse(raw);
}

// Runs one file's rules and prints its own warnings/errors under its own
// filename, since a filename-agnostic combined error list would make it
// unclear which file to actually go fix.
function checkFile(fileName, items, validator) {
  const { errors, warnings } = validator(items);
  if (warnings.length) {
    console.warn(warnings.length + ' warning(s) in ' + fileName + ':');
    warnings.forEach(w => console.warn('  - ' + w));
  }
  if (errors.length) {
    console.error((warnings.length ? '\n' : '') + errors.length + ' error(s) in public/cgt/data/' + fileName + ':');
    errors.forEach(e => console.error('  - ' + e));
  } else {
    console.log(fileName + ' is valid (' + items.length + ' item(s)).');
  }
  return errors.length === 0;
}

function main() {
  let cardsData;
  try {
    cardsData = loadJson('cards.json');
  } catch (e) {
    console.error('Failed to read/parse cards.json: ' + e.message);
    process.exit(1);
  }

  // submissions.json is optional: an older checkout without it should still
  // validate cards.json cleanly rather than failing outright.
  let submissionsData = { submissions: [] };
  if (fs.existsSync(path.join(DATA_DIR, 'submissions.json'))) {
    try {
      submissionsData = loadJson('submissions.json');
    } catch (e) {
      console.error('Failed to read/parse submissions.json: ' + e.message);
      process.exit(1);
    }
  }

  // candidates.json is optional for the same reason submissions.json is: an
  // older checkout without it should still validate cleanly.
  let candidatesData = { candidates: [] };
  if (fs.existsSync(path.join(DATA_DIR, 'candidates.json'))) {
    try {
      candidatesData = loadJson('candidates.json');
    } catch (e) {
      console.error('Failed to read/parse candidates.json: ' + e.message);
      process.exit(1);
    }
  }

  const cardsOk = checkFile('cards.json', cardsData.cards || [], validateCards);
  const submissionsOk = checkFile('submissions.json', submissionsData.submissions || [], validateSubmissions);
  const candidatesOk = checkFile('candidates.json', candidatesData.candidates || [], validateCandidates);

  checkChangelogFreshness();

  process.exit(cardsOk && submissionsOk && candidatesOk ? 0 : 1);
}

// changelog.json is generated, not hand-edited (see changelog.js), so it
// can't have the typo-style errors above, only a drift failure mode: it
// silently falls behind the real commit history, or (as found 2026-09-19)
// keeps entries from before a history rewrite that are no longer reachable
// from any branch. Comparing the full recorded commit list against this
// repo's actual commit list for these same files, not just the latest
// hash, is what catches a corrupted middle of the list, not only a stale
// head; git itself is the source of truth here, same as changelog.js.
function checkChangelogFreshness() {
  try {
    const realHashesRaw = execFileSync('git', [
      'log', '--format=%H', '--',
      'cards.json', 'submissions.json', 'candidates.json'
    ], { cwd: DATA_DIR, encoding: 'utf8' }).trim();
    const realHashes = realHashesRaw ? realHashesRaw.split('\n') : [];
    let changelogData = null;
    try {
      changelogData = loadJson('changelog.json');
    } catch (e) {
      console.warn('changelog.json is missing or unreadable (' + e.message + '), run node public/cgt/data/changelog.js');
      return;
    }
    const recordedHashes = (changelogData.entries || []).map(e => e.fullHash);
    if (recordedHashes.join(',') !== realHashes.join(',')) {
      console.warn('changelog.json does not match this repo\'s actual commit history for these data files ' +
        '(' + recordedHashes.length + ' entr' + (recordedHashes.length === 1 ? 'y' : 'ies') + ' recorded vs ' +
        realHashes.length + ' real commit' + (realHashes.length === 1 ? '' : 's') + '), run ' +
        'node public/cgt/data/changelog.js to refresh it');
    }
  } catch (e) {
    // Not a git checkout, or git isn't on PATH: can't check changelog
    // freshness, but that's an environment gap, not a data error, so this
    // stays silent rather than adding a warning no one can act on.
  }
}

main();

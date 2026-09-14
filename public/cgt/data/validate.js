#!/usr/bin/env node
/*
 * Validates cards.json and submissions.json against the field rules
 * documented in public/cgt/index.html. Run this after hand-editing either
 * file.
 *
 * The rule cards.json exists to enforce: every card with an estimatedValue
 * must say whether that number is a real recent sale or a comp-based
 * estimate (valuationBasis), and a comp-based estimate must carry a compNote
 * saying what it was based on. A price with no basis label is exactly the
 * silent guessing this tracker is built to avoid, so it is an error, not a
 * warning. submissions.json tracks cards sent off for grading that have not
 * come back yet, kept separate from cards.json since a submission has no
 * grade or cert number of its own.
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
const { validateCards, validateSubmissions } = require('./validate-core.js');

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

  const cardsOk = checkFile('cards.json', cardsData.cards || [], validateCards);
  const submissionsOk = checkFile('submissions.json', submissionsData.submissions || [], validateSubmissions);

  process.exit(cardsOk && submissionsOk ? 0 : 1);
}

main();

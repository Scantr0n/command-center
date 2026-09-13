#!/usr/bin/env node
/*
 * Validates cards.json against the field rules documented in
 * public/cgt/index.html. Run this after hand-editing cards.json.
 *
 * The rule this exists to enforce: every card with an estimatedValue must
 * say whether that number is a real recent sale or a comp-based estimate
 * (valuationBasis), and a comp-based estimate must carry a compNote saying
 * what it was based on. A price with no basis label is exactly the silent
 * guessing this tracker is built to avoid, so it is an error, not a warning.
 *
 * The rules themselves live in validate-core.js, shared with the browser-side
 * CSV import tool (public/cgt/import.js) so both places enforce the same
 * checks instead of drifting apart. This file is just the Node CLI wrapper:
 * read cards.json off disk, run the shared rules, print results.
 *
 * Usage: node public/cgt/data/validate.js
 * Exit code 0 = clean, 1 = errors found.
 */
const fs = require('fs');
const path = require('path');
const { validateCards } = require('./validate-core.js');

const DATA_DIR = __dirname;

function loadJson(name) {
  const file = path.join(DATA_DIR, name);
  const raw = fs.readFileSync(file, 'utf8');
  return JSON.parse(raw);
}

function main() {
  let cardsData;
  try {
    cardsData = loadJson('cards.json');
  } catch (e) {
    console.error('Failed to read/parse cards.json: ' + e.message);
    process.exit(1);
  }

  const cards = cardsData.cards || [];
  const { errors, warnings } = validateCards(cards);

  if (warnings.length) {
    console.warn(warnings.length + ' warning(s):');
    warnings.forEach(w => console.warn('  - ' + w));
  }

  if (errors.length) {
    console.error((warnings.length ? '\n' : '') + errors.length + ' error(s) in public/cgt/data/cards.json:');
    errors.forEach(e => console.error('  - ' + e));
    process.exit(1);
  }

  console.log('cards.json is valid (' + cards.length + ' card(s)).');
  process.exit(0);
}

main();

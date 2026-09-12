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
 * Usage: node public/cgt/data/validate.js
 * Exit code 0 = clean, 1 = errors found.
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = __dirname;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SPORTS = ['hockey', 'baseball', 'football'];
const GRADING_COMPANIES = ['PSA', 'BGS', 'SGC', 'CGC', 'HGA', 'KSA'];
const VALUATION_BASES = ['recent-sale', 'comp-estimate'];

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

  let cardsData;
  try {
    cardsData = loadJson('cards.json');
  } catch (e) {
    console.error('Failed to read/parse cards.json: ' + e.message);
    process.exit(1);
  }

  const cards = cardsData.cards || [];
  const seenIds = new Set();
  // Keyed by grading company since cert numbers are only guaranteed unique
  // within one company's own numbering, not across PSA/BGS/SGC/etc.
  const seenCerts = new Map();

  cards.forEach((c, idx) => {
    const where = 'cards[' + idx + ']' + (c && c.id ? ' (' + c.id + ')' : '');

    if (!c.id) errors.push(where + ': missing "id"');
    else if (seenIds.has(c.id)) errors.push(where + ': duplicate id "' + c.id + '"');
    else seenIds.add(c.id);

    if (c.certNumber && c.gradingCompany) {
      const certKey = c.gradingCompany + ':' + c.certNumber;
      if (seenCerts.has(certKey)) {
        errors.push(where + ': cert number "' + c.certNumber + '" for ' + c.gradingCompany +
          ' is already used by "' + seenCerts.get(certKey) + '". Same physical card logged twice, or a typo\'d cert.');
      } else {
        seenCerts.set(certKey, c.id);
      }
    }

    if (!c.cardName) errors.push(where + ': missing "cardName"');

    if (!c.sport) {
      errors.push(where + ': missing "sport"');
    } else if (!SPORTS.includes(c.sport)) {
      errors.push(where + ': sport "' + c.sport + '" is not one of ' + SPORTS.join(', '));
    }

    if (c.gradingCompany !== null && c.gradingCompany !== undefined && !GRADING_COMPANIES.includes(c.gradingCompany)) {
      warnings.push(where + ': gradingCompany "' + c.gradingCompany + '" is not one of the known companies (' +
        GRADING_COMPANIES.join(', ') + '). Not an error, just double-check it is not a typo.');
    }

    if (c.estimatedValue !== null && c.estimatedValue !== undefined) {
      if (typeof c.estimatedValue !== 'number' || c.estimatedValue < 0) {
        errors.push(where + ': "estimatedValue" must be a non-negative number or null');
      }
      if (!c.valuationBasis) {
        errors.push(where + ': has an estimatedValue but no "valuationBasis". Every price must be labeled ' +
          '"recent-sale" or "comp-estimate", never left ambiguous.');
      } else if (!VALUATION_BASES.includes(c.valuationBasis)) {
        errors.push(where + ': valuationBasis "' + c.valuationBasis + '" is not "recent-sale" or "comp-estimate"');
      } else if (c.valuationBasis === 'comp-estimate' && !c.compNote) {
        errors.push(where + ': valuationBasis is "comp-estimate" but "compNote" is empty. A comp-based estimate ' +
          'must say what it was based on, not just carry the label.');
      }
      if (!c.datePriced) {
        warnings.push(where + ': has an estimatedValue but no "datePriced". Backfill when known, a price with ' +
          'no date looks live when it may be stale.');
      }
    } else if (c.valuationBasis) {
      warnings.push(where + ': has a "valuationBasis" but no "estimatedValue". Probably a leftover field.');
    }

    if (!isDateOrNull(c.datePriced)) {
      errors.push(where + ': "datePriced" is not a YYYY-MM-DD date or null: ' + JSON.stringify(c.datePriced));
    }
  });

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

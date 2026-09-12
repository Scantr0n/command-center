#!/usr/bin/env node
/*
 * Validates status.json against the field rules documented in
 * public/alpha/index.html. Run this after any hand edit, and especially
 * after a future session wires in a real status feed from Alpha.
 *
 * Alpha is a live, real-money trading daemon. This hub is READ-ONLY status
 * display, never control. Two things this script exists to catch:
 *
 *   1. A "live" field filled in without an "asOf" timestamp. A live number
 *      with no timestamp looks current when it may be stale or fabricated,
 *      exactly the silent-guess failure mode this tracker is built to avoid.
 *
 *   2. Any key that looks like real trading performance data (P&L, balance,
 *      win rate, trade counts, etc). This sandbox has no access to Alpha's
 *      real numbers, so a key like that appearing here almost certainly
 *      means someone guessed instead of wiring in a real feed.
 *
 * Usage: node public/alpha/data/validate.js
 * Exit code 0 = clean, 1 = errors found.
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = __dirname;
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

// Keys that would only legitimately appear here if real performance data
// had been wired in, which it never has been from this sandbox.
const FORBIDDEN_KEY_PATTERN = /pnl|profit|balance|equity|winrate|win_rate|winRate|tradecount|trade_count|tradeCount|dollaramount|returnpct|roi/i;

function loadJson(name) {
  const file = path.join(DATA_DIR, name);
  const raw = fs.readFileSync(file, 'utf8');
  return JSON.parse(raw);
}

function isIsoDatetimeOrNull(v) {
  return v === null || v === undefined || (typeof v === 'string' && ISO_DATETIME_RE.test(v));
}

function scanForForbiddenKeys(obj, pathSoFar, errors) {
  if (obj === null || typeof obj !== 'object') return;
  for (const key of Object.keys(obj)) {
    const where = pathSoFar ? pathSoFar + '.' + key : key;
    if (FORBIDDEN_KEY_PATTERN.test(key)) {
      errors.push(where + ': key looks like real performance data (P&L / balance / win rate / trade count). ' +
        'This sandbox has no access to Alpha\'s real numbers, remove this field or confirm it is genuinely wired in.');
    }
    scanForForbiddenKeys(obj[key], where, errors);
  }
}

function main() {
  const errors = [];
  const warnings = [];

  let data;
  try {
    data = loadJson('status.json');
  } catch (e) {
    console.error('Failed to read/parse status.json: ' + e.message);
    process.exit(1);
  }

  scanForForbiddenKeys(data, '', errors);

  const live = data.live || {};
  const anyLiveValueSet =
    live.regime != null ||
    (live.killSwitch && live.killSwitch.engaged != null) ||
    (live.positionSizing && (live.positionSizing.activeMode != null || live.positionSizing.currentDrawdownPct != null)) ||
    (live.genealogy && (live.genealogy.generation != null || live.genealogy.activeLineages != null || live.genealogy.lastBreedingEventAt != null));

  if (anyLiveValueSet && !live.asOf) {
    errors.push('live: one or more live fields are set but "live.asOf" is missing. Every live reading must carry ' +
      'the timestamp it was actually observed at, never left implicit.');
  }
  if (!isIsoDatetimeOrNull(live.asOf)) {
    errors.push('live.asOf: not a valid ISO datetime or null: ' + JSON.stringify(live.asOf));
  }

  if (live.killSwitch && !isIsoDatetimeOrNull(live.killSwitch.lastTriggeredAt)) {
    errors.push('live.killSwitch.lastTriggeredAt: not a valid ISO datetime or null');
  }
  if (live.genealogy && !isIsoDatetimeOrNull(live.genealogy.lastBreedingEventAt)) {
    errors.push('live.genealogy.lastBreedingEventAt: not a valid ISO datetime or null');
  }

  const drawdownPct = live.positionSizing && live.positionSizing.currentDrawdownPct;
  if (drawdownPct != null && !(typeof drawdownPct === 'number' && Number.isFinite(drawdownPct) && drawdownPct >= 0 && drawdownPct <= 100)) {
    errors.push('live.positionSizing.currentDrawdownPct: must be null or a finite number from 0 to 100 ' +
      '(it drives a percentage meter on the page, an out-of-range value would render as a broken or misleading bar): ' +
      JSON.stringify(drawdownPct));
  }

  if (data.connection && data.connection.connected === true && !data.connection.checkedAt) {
    warnings.push('connection.connected is true but connection.checkedAt is empty. Backfill when known.');
  }

  if (!Array.isArray(data.system && data.system.features)) {
    errors.push('system.features: missing or not an array');
  }

  if (warnings.length) {
    console.warn(warnings.length + ' warning(s):');
    warnings.forEach(w => console.warn('  - ' + w));
  }

  if (errors.length) {
    console.error((warnings.length ? '\n' : '') + errors.length + ' error(s) in public/alpha/data/status.json:');
    errors.forEach(e => console.error('  - ' + e));
    process.exit(1);
  }

  console.log('status.json is valid.');
  process.exit(0);
}

main();

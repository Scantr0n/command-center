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
    (live.positionSizing && (live.positionSizing.activeMode != null || live.positionSizing.currentDrawdownPct != null || live.positionSizing.maxDrawdownPct != null || live.positionSizing.robustnessScore != null)) ||
    (live.genealogy && (live.genealogy.generation != null || live.genealogy.activeLineages != null || live.genealogy.lastBreedingEventAt != null ||
      (Array.isArray(live.genealogy.lineages) && live.genealogy.lineages.length > 0)));

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

  // The genealogy wall itself: one card per lineage once a real feed knows
  // per-lineage detail, rather than only the aggregate counts above. Same
  // "starts empty, honestly" rule as connection.history/events; each entry
  // needs a real id to key off of, everything else is nullable exactly like
  // the aggregate fields it sits alongside.
  const lineages = live.genealogy && live.genealogy.lineages;
  if (lineages != null) {
    if (!Array.isArray(lineages)) {
      errors.push('live.genealogy.lineages: must be an array if present (empty is fine, it starts that way honestly)');
    } else {
      lineages.forEach((l, i) => {
        const where = `live.genealogy.lineages[${i}]`;
        if (!l || typeof l !== 'object') { errors.push(where + ': must be an object'); return; }
        if (typeof l.id !== 'string' || !l.id) {
          errors.push(where + '.id: required, must be a non-empty string');
        }
        if (l.label != null && typeof l.label !== 'string') {
          errors.push(where + '.label: must be a string if set');
        }
        if (l.generation != null && !(typeof l.generation === 'number' && Number.isFinite(l.generation))) {
          errors.push(where + '.generation: must be null or a finite number');
        }
        if (l.agentCount != null && !(typeof l.agentCount === 'number' && Number.isFinite(l.agentCount) && l.agentCount >= 0)) {
          errors.push(where + '.agentCount: must be null or a non-negative finite number');
        }
        if (l.status != null && !['active', 'retired'].includes(l.status)) {
          errors.push(where + '.status: must be "active" or "retired" if set');
        }
        if (!isIsoDatetimeOrNull(l.lastEventAt)) {
          errors.push(where + '.lastEventAt: not a valid ISO datetime or null');
        }
        if (l.lastEventNote != null && typeof l.lastEventNote !== 'string') {
          errors.push(where + '.lastEventNote: must be a string if set');
        }
      });
    }
  }

  const drawdownPct = live.positionSizing && live.positionSizing.currentDrawdownPct;
  if (drawdownPct != null && !(typeof drawdownPct === 'number' && Number.isFinite(drawdownPct) && drawdownPct >= 0 && drawdownPct <= 100)) {
    errors.push('live.positionSizing.currentDrawdownPct: must be null or a finite number from 0 to 100 ' +
      '(it drives a percentage meter on the page, an out-of-range value would render as a broken or misleading bar): ' +
      JSON.stringify(drawdownPct));
  }

  const maxDrawdownPct = live.positionSizing && live.positionSizing.maxDrawdownPct;
  if (maxDrawdownPct != null && !(typeof maxDrawdownPct === 'number' && Number.isFinite(maxDrawdownPct) && maxDrawdownPct >= 0 && maxDrawdownPct <= 100)) {
    errors.push('live.positionSizing.maxDrawdownPct: must be null or a finite number from 0 to 100 ' +
      '(peak-to-trough drawdown observed, same 0-100 scale as currentDrawdownPct): ' +
      JSON.stringify(maxDrawdownPct));
  }
  if (drawdownPct != null && maxDrawdownPct != null && drawdownPct > maxDrawdownPct) {
    errors.push('live.positionSizing: currentDrawdownPct (' + drawdownPct + ') exceeds maxDrawdownPct (' + maxDrawdownPct +
      '), max is defined as the deepest drawdown observed so it can never be smaller than the current reading');
  }

  // Robustness-based sizing is named as its own real architecture feature
  // (system.features, id "robustness-sizing") alongside drawdown-based
  // sizing, but until now nothing in the live schema actually represented
  // it, only the drawdown axis. Same 0-100 range and honest-null rule as
  // the drawdown fields above.
  const robustnessScore = live.positionSizing && live.positionSizing.robustnessScore;
  if (robustnessScore != null && !(typeof robustnessScore === 'number' && Number.isFinite(robustnessScore) && robustnessScore >= 0 && robustnessScore <= 100)) {
    errors.push('live.positionSizing.robustnessScore: must be null or a finite number from 0 to 100 ' +
      '(it drives a percentage meter on the page, same as currentDrawdownPct/maxDrawdownPct): ' +
      JSON.stringify(robustnessScore));
  }

  if (data.connection && data.connection.connected === true && !data.connection.checkedAt) {
    warnings.push('connection.connected is true but connection.checkedAt is empty. Backfill when known.');
  }

  if (data.connection && 'history' in data.connection) {
    const history = data.connection.history;
    if (!Array.isArray(history)) {
      errors.push('connection.history: must be an array (empty is fine, it starts that way honestly)');
    } else {
      let previousAt = null;
      history.forEach((entry, i) => {
        const where = `connection.history[${i}]`;
        if (!entry || typeof entry !== 'object') {
          errors.push(where + ': must be an object');
          return;
        }
        if (!isIsoDatetimeOrNull(entry.at) || entry.at == null) {
          errors.push(where + '.at: required, must be a valid ISO datetime (every check needs a real timestamp)');
        } else {
          // The page reads this array oldest-first without re-sorting (the
          // tick strip renders it in place, and mostRecentConnectedAt() scans
          // backward from the end assuming the end is newest), so an
          // out-of-order append would silently misrender rather than error.
          const at = new Date(entry.at).getTime();
          if (previousAt != null && at < previousAt) {
            errors.push(where + '.at: out of order, connection.history must be append-only, oldest first ' +
              '(this entry is earlier than connection.history[' + (i - 1) + '].at)');
          }
          previousAt = at;
        }
        if (typeof entry.connected !== 'boolean') {
          errors.push(where + '.connected: required, must be true or false (a real connectivity result, never null/unknown)');
        }
      });
    }
  }

  if (!Array.isArray(data.system && data.system.features)) {
    errors.push('system.features: missing or not an array');
  }

  // system.* is hand-maintained architectural fact (agent count, feature
  // list), not a live reading, so it has no natural freshness signal of its
  // own the way every live.* field gets from live.asOf. lastVerifiedAt is
  // that signal: when this description was last actually confirmed to still
  // match Alpha's real architecture, so a reader can judge how much to trust
  // "33 agents" the same way they'd judge a live reading's age.
  if (data.system && !isIsoDatetimeOrNull(data.system.lastVerifiedAt)) {
    errors.push('system.lastVerifiedAt: not a valid ISO datetime or null: ' + JSON.stringify(data.system.lastVerifiedAt));
  }

  if ('events' in data) {
    if (!Array.isArray(data.events)) {
      errors.push('events: must be an array (empty is fine, it starts that way honestly)');
    } else {
      data.events.forEach((evt, i) => {
        const where = `events[${i}]`;
        if (!evt || typeof evt !== 'object') {
          errors.push(where + ': must be an object');
          return;
        }
        if (!isIsoDatetimeOrNull(evt.at) || evt.at == null) {
          errors.push(where + '.at: required, must be a valid ISO datetime (every event needs a real timestamp)');
        }
        if (typeof evt.type !== 'string' || !evt.type) {
          errors.push(where + '.type: required, must be a non-empty string');
        }
        if (typeof evt.label !== 'string' || !evt.label) {
          errors.push(where + '.label: required, must be a non-empty string');
        }
        if (evt.tone != null && !['neutral', 'good', 'alert'].includes(evt.tone)) {
          errors.push(where + '.tone: must be "neutral", "good", or "alert" if set');
        }
      });
    }
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

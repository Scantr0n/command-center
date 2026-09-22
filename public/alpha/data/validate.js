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
const { execFileSync } = require('child_process');

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

// Every real free-text field this page renders is written without em
// dashes, so a hand-typed or pasted-in field that has one reads as coming
// from somewhere else rather than this product's own voice. Same
// emDashFields helper public/sondrik/data/validate.js already uses for this
// reason. Warning-level only: an em dash never breaks anything rendered,
// this is a style nudge, not a data error.
function emDashFields(obj, fields) {
  const hits = [];
  if (!obj) return hits;
  fields.forEach(f => {
    const v = obj[f];
    if (typeof v === 'string' && v.includes(String.fromCharCode(8212))) hits.push(f);
  });
  return hits;
}

// live.asOf and system.lastVerifiedAt drive every staleness signal this page
// shows (freshnessClass's live/stale/down thresholds, the "last verified"
// architecture trust label), so a mistyped year would otherwise silently
// read as a fresh, trustworthy reading instead of the typo it actually is.
// Same isFutureDate idea public/sondrik/data/validate.js and
// data/clusters/validate.js already run on their own date fields, adapted
// here for full ISO datetimes: a few minutes of tolerance for real clock
// skew between whatever wrote this file and whatever validates it.
const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;
function isFutureDatetime(v) {
  if (!v || !ISO_DATETIME_RE.test(v)) return false;
  return new Date(v).getTime() > Date.now() + CLOCK_SKEW_TOLERANCE_MS;
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
    (live.genealogy && (live.genealogy.generation != null || live.genealogy.lastBreedingEventAt != null ||
      (Array.isArray(live.genealogy.lineages) && live.genealogy.lineages.length > 0)));

  if (anyLiveValueSet && !live.asOf) {
    errors.push('live: one or more live fields are set but "live.asOf" is missing. Every live reading must carry ' +
      'the timestamp it was actually observed at, never left implicit.');
  }
  if (!isIsoDatetimeOrNull(live.asOf)) {
    errors.push('live.asOf: not a valid ISO datetime or null: ' + JSON.stringify(live.asOf));
  } else if (isFutureDatetime(live.asOf)) {
    warnings.push('live.asOf (' + live.asOf + ') is in the future, a real reading should be timestamped when it ' +
      'was actually taken, check for a typo\'d year');
  }

  if (live.killSwitch && !isIsoDatetimeOrNull(live.killSwitch.lastTriggeredAt)) {
    errors.push('live.killSwitch.lastTriggeredAt: not a valid ISO datetime or null');
  } else if (live.killSwitch && isFutureDatetime(live.killSwitch.lastTriggeredAt)) {
    warnings.push('live.killSwitch.lastTriggeredAt (' + live.killSwitch.lastTriggeredAt + ') is in the future, check for a typo\'d year');
  }
  if (live.killSwitch && live.killSwitch.engaged != null && typeof live.killSwitch.engaged !== 'boolean') {
    errors.push('live.killSwitch.engaged: must be true, false, or null');
  }
  if (live.genealogy && !isIsoDatetimeOrNull(live.genealogy.lastBreedingEventAt)) {
    errors.push('live.genealogy.lastBreedingEventAt: not a valid ISO datetime or null');
  } else if (live.genealogy && isFutureDatetime(live.genealogy.lastBreedingEventAt)) {
    warnings.push('live.genealogy.lastBreedingEventAt (' + live.genealogy.lastBreedingEventAt + ') is in the future, check for a typo\'d year');
  }
  if (live.regime != null && (typeof live.regime !== 'string' || !live.regime)) {
    errors.push('live.regime: must be null or a non-empty string');
  }
  if (live.positionSizing && live.positionSizing.activeMode != null &&
    (typeof live.positionSizing.activeMode !== 'string' || !live.positionSizing.activeMode)) {
    errors.push('live.positionSizing.activeMode: must be null or a non-empty string');
  }

  // Every other object under live (killSwitch, positionSizing, genealogy) is
  // allowed to be entirely null/missing while a real feed hasn't reported it
  // yet. live.debatePanel is the one exception, see its schema-table row in
  // index.html: the debate panel's state (on vs. pending an API key) is
  // always genuinely known, even from this sandbox, so unlike everything
  // else here it is required, not just checked when present. app.js reads
  // it defensively anyway (see its own renderStats comment), but the schema
  // itself should still say what a well-formed feed must send.
  if (!live.debatePanel || typeof live.debatePanel !== 'object') {
    errors.push('live.debatePanel: required object (unlike other live.* sub-objects, this one is never null/missing, ' +
      'the debate panel\'s pending-vs-active state is always known)');
  } else {
    if (typeof live.debatePanel.active !== 'boolean') {
      errors.push('live.debatePanel.active: required, must be true or false');
    }
    if (live.debatePanel.blockedOn != null && typeof live.debatePanel.blockedOn !== 'string') {
      errors.push('live.debatePanel.blockedOn: must be a string or null');
    }
    if (live.debatePanel.active === true && live.debatePanel.blockedOn) {
      errors.push('live.debatePanel: active is true but blockedOn is still set, contradictory state');
    }
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
        } else if (isFutureDatetime(l.lastEventAt)) {
          warnings.push(where + '.lastEventAt (' + l.lastEventAt + ') is in the future, check for a typo\'d year');
        }
        if (l.lastEventNote != null && typeof l.lastEventNote !== 'string') {
          errors.push(where + '.lastEventNote: must be a string if set');
        }

        emDashFields(l, ['label', 'lastEventNote']).forEach(f =>
          warnings.push(where + '.' + f + ' contains an em dash, this page never uses one, check for a paste-in'));
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
          if (isFutureDatetime(entry.at)) {
            warnings.push(where + '.at (' + entry.at + ') is in the future, check for a typo\'d year');
          }
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
  } else {
    data.system.features.forEach((f, i) => {
      emDashFields(f, ['label', 'note']).forEach(field =>
        warnings.push('system.features[' + i + '].' + field + ' contains an em dash, this page never uses one, check for a paste-in'));
      // The Architecture grid's built/pending badge reads this field, never
      // whether note is set (note is free-text description, e.g. genealogy-
      // wall's just explains what the feature is, and used to get badged
      // "pending" for that alone, wrongly calling a real, built feature
      // unbuilt). Required and boolean so a hand-added feature can't silently
      // fall back to that same wrong reading.
      if (typeof f.pending !== 'boolean') {
        errors.push('system.features[' + i + '].pending: required, must be true or false ' +
          '(whether this feature is genuinely not yet built/active, never inferred from note)');
      }
      if (f.pending === true && !f.note) {
        warnings.push('system.features[' + i + '].pending is true but note is empty. A pending feature should say what it is blocked on.');
      }
    });
  }

  emDashFields(live, ['regime']).forEach(f =>
    warnings.push('live.' + f + ' contains an em dash, this page never uses one, check for a paste-in'));
  emDashFields(live.positionSizing, ['activeMode']).forEach(f =>
    warnings.push('live.positionSizing.' + f + ' contains an em dash, this page never uses one, check for a paste-in'));
  emDashFields(live.debatePanel, ['blockedOn']).forEach(f =>
    warnings.push('live.debatePanel.' + f + ' contains an em dash, this page never uses one, check for a paste-in'));

  // system.* is hand-maintained architectural fact (agent count, feature
  // list), not a live reading, so it has no natural freshness signal of its
  // own the way every live.* field gets from live.asOf. lastVerifiedAt is
  // that signal: when this description was last actually confirmed to still
  // match Alpha's real architecture, so a reader can judge how much to trust
  // "33 agents" the same way they'd judge a live reading's age.
  if (data.system && !isIsoDatetimeOrNull(data.system.lastVerifiedAt)) {
    errors.push('system.lastVerifiedAt: not a valid ISO datetime or null: ' + JSON.stringify(data.system.lastVerifiedAt));
  } else if (data.system && isFutureDatetime(data.system.lastVerifiedAt)) {
    warnings.push('system.lastVerifiedAt (' + data.system.lastVerifiedAt + ') is in the future, check for a typo\'d year');
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
        } else if (isFutureDatetime(evt.at)) {
          warnings.push(where + '.at (' + evt.at + ') is in the future, check for a typo\'d year');
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

        emDashFields(evt, ['label', 'detail']).forEach(f =>
          warnings.push(where + '.' + f + ' contains an em dash, this page never uses one, check for a paste-in'));
      });
    }
  }

  // changelog.json is generated, not hand-edited (see changelog.js), so it
  // can't have the typo-style errors above, only a drift failure mode: it
  // silently falls behind, or ends up with wrong/missing entries, after
  // someone runs the generator against an incomplete local clone. Same
  // pattern already proven at public/sondrik/data/validate.js and
  // public/csm/data/validate.js: comparing the full recorded commit list
  // against this repo's actual commit list for status.json, not just the
  // latest hash, catches a corrupted middle of the list too, not only a
  // stale head; git itself is the source of truth here, same as
  // changelog.js.
  try {
    // A shallow clone's `git log` for status.json only ever sees the commits
    // fetched, which is not the same thing as "status.json has no earlier
    // history": comparing that truncated list against a changelog.json
    // generated from a real full clone reports a "drift" that isn't real
    // (this bit CGT and Sondrik for real on 2026-09-19). Skipped the same as
    // "not a git checkout" below, an environment gap, not a data error.
    if (execFileSync('git', ['rev-parse', '--is-shallow-repository'], { cwd: DATA_DIR, encoding: 'utf8' }).trim() === 'true') throw new Error('shallow clone');
    const realHashesRaw = execFileSync('git', [
      'log', '--format=%H', '--', 'status.json'
    ], { cwd: DATA_DIR, encoding: 'utf8' }).trim();
    const realHashes = realHashesRaw ? realHashesRaw.split('\n') : [];
    let changelogData = null;
    try {
      changelogData = loadJson('changelog.json');
    } catch (e) {
      warnings.push('changelog.json is missing or unreadable (' + e.message + '), run node public/alpha/data/changelog.js');
    }
    if (changelogData) {
      const recordedHashes = (changelogData.entries || []).map(e => e.fullHash);
      if (recordedHashes.join(',') !== realHashes.join(',')) {
        warnings.push('changelog.json does not match this repo\'s actual commit history for status.json ' +
          '(' + recordedHashes.length + ' entr' + (recordedHashes.length === 1 ? 'y' : 'ies') + ' recorded vs ' +
          realHashes.length + ' real commit' + (realHashes.length === 1 ? '' : 's') + '), run ' +
          'node public/alpha/data/changelog.js to refresh it');
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
    console.error((warnings.length ? '\n' : '') + errors.length + ' error(s) in public/alpha/data/status.json:');
    errors.forEach(e => console.error('  - ' + e));
    process.exit(1);
  }

  console.log('status.json is valid.');
  process.exit(0);
}

main();

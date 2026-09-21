#!/usr/bin/env node
/*
 * Validates every data/clusters/*.json file against the field rules the
 * main dashboard (public/index.html) actually renders. Run after
 * hand-editing any cluster file.
 *
 * The rule this exists to enforce: a category, status, or priority the
 * dashboard doesn't recognize does not error, it silently falls back
 * (Uncategorized gray, unknown gray, normal orbit), so a typo here looks
 * like a real project state instead of a mistake. This catches that before
 * it renders.
 *
 * Usage: node data/clusters/validate.js
 * Exit code 0 = clean, 1 = errors found.
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = __dirname;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Kept in sync with CATEGORY_ORDER and statusColor() in public/index.html.
const CATEGORIES = [
  'Ventures & Business', 'Trading', 'Content', 'Reselling', 'School & Career',
  'Health & Personal', 'Travel & Logistics', 'Personal & Infra', 'Uncategorized'
];
const STATUSES = ['active', 'done', 'stalled', 'broken', 'unknown'];
const PRIORITIES = ['top', 'normal', 'low'];

// The shape regex alone accepts any two digits for month/day, including
// "2026-13-45" or a real-looking but impossible "2026-02-30", so this
// cross-checks the parsed date's own year/month/day against what was
// actually typed: an impossible date never matches back.
function isDateOrNull(v) {
  if (v === null || v === undefined) return true;
  if (typeof v !== 'string' || !DATE_RE.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const parsed = new Date(y, m - 1, d);
  return parsed.getFullYear() === y && parsed.getMonth() === m - 1 && parsed.getDate() === d;
}

// lastUpdate drives the dashboard-wide staleness signal (the graph's dashed
// ring, Grid's "stale" label), so a mistyped year (2027 instead of 2026)
// would silently read as freshly updated instead of the typo it actually
// is. Same isFutureDate check public/sondrik/data/validate.js already runs
// on its own dated fields, for the same reason.
// Every real string this dashboard renders (project names, summaries, link
// labels, and the chat assistant's own replies per server.js's system
// prompt) is written without em dashes, so a hand-typed field that has one
// reads as a paste-in from somewhere else rather than Jack's own voice.
// Same emDashFields helper public/sondrik/data/validate.js already uses for
// this same reason, just not previously applied to this file. Warning-level
// only: an em dash never breaks anything the dashboard renders, this is a
// style nudge, not a data error.
function emDashFields(obj, fields) {
  const hits = [];
  if (!obj) return hits;
  fields.forEach(f => {
    const v = obj[f];
    if (typeof v === 'string' && v.includes(String.fromCharCode(8212))) hits.push(f);
  });
  return hits;
}

function isFutureDate(v) {
  if (!v || !DATE_RE.test(v)) return false;
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  return new Date(v + 'T00:00:00') > tomorrow;
}

function main() {
  const errors = [];
  const warnings = [];

  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
  const clusters = [];

  files.forEach(f => {
    try {
      clusters.push({ file: f, data: JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8')) });
    } catch (e) {
      errors.push(f + ': failed to parse (' + e.message + ')');
    }
  });

  const seenIds = new Set();
  // Keyed only by toggleId, not by cluster id, because that's how
  // server.js's toggles.json store actually works: two clusters sharing a
  // toggleId would silently flip each other's automation switch.
  const seenToggleIds = new Set();
  clusters.forEach(({ file, data: c }) => {
    const where = file + (c.id ? ' (' + c.id + ')' : '');

    if (!c.id) errors.push(where + ': missing "id"');
    else if (seenIds.has(c.id)) errors.push(where + ': duplicate id "' + c.id + '"');
    else seenIds.add(c.id);

    if (!c.name) errors.push(where + ': missing "name"');
    if (!c.summary) warnings.push(where + ': missing "summary"');

    if (!c.status) {
      errors.push(where + ': missing "status"');
    } else if (!STATUSES.includes(c.status)) {
      errors.push(where + ': status "' + c.status + '" is not one of ' + STATUSES.join(', ') +
        ', will silently render as the unknown/gray status');
    }

    if (c.category && !CATEGORIES.includes(c.category)) {
      warnings.push(where + ': category "' + c.category + '" is not one of the known categories (' +
        CATEGORIES.join(', ') + '), will render as Uncategorized gray on the graph');
    }

    if (c.priority !== undefined && !PRIORITIES.includes(c.priority)) {
      warnings.push(where + ': priority "' + c.priority + '" is not one of ' + PRIORITIES.join(', ') +
        ', will silently fall back to the normal orbit');
    }

    if (!isDateOrNull(c.lastUpdate)) {
      errors.push(where + ': "lastUpdate" is not a YYYY-MM-DD date or null: ' + JSON.stringify(c.lastUpdate));
    } else if (isFutureDate(c.lastUpdate)) {
      warnings.push(where + ': "lastUpdate" (' + c.lastUpdate + ') is in the future, check for a typo\'d year');
    } else if (c.lastUpdate === null && (c.status === 'active' || c.status === 'stalled')) {
      // isStale() in public/index.html treats a null lastUpdate on an
      // active/stalled cluster as stale by definition (a project that has
      // never once logged a date is at least as neglected as one 31+ days
      // old), so this is the same real gap the dashboard now surfaces
      // visually, caught here too instead of only after someone happens to
      // notice the dashed ring or "stale" label on the live page.
      warnings.push(where + ': status is "' + c.status + '" but "lastUpdate" has never been set, log a real date once there is one to report');
    }

    if (c.link !== undefined && !c.linkLabel) {
      warnings.push(where + ': has a "link" but no "linkLabel", the modal will fall back to a plain "Open"');
    }

    if (c.toggleable && !c.toggleId) {
      errors.push(where + ': "toggleable" is true but "toggleId" is missing, the automation toggle has nothing to key on');
    } else if (c.toggleId) {
      if (seenToggleIds.has(c.toggleId)) {
        errors.push(where + ': duplicate toggleId "' + c.toggleId + '", flipping one of these two clusters\' automation switch would silently flip the other\'s too');
      } else {
        seenToggleIds.add(c.toggleId);
      }
    }

    if (c.relatedTo !== undefined && !Array.isArray(c.relatedTo)) {
      errors.push(where + ': "relatedTo" must be an array of cluster ids');
    }
    if (c.relationReasons !== undefined && (typeof c.relationReasons !== 'object' || c.relationReasons === null || Array.isArray(c.relationReasons))) {
      errors.push(where + ': "relationReasons" must be an object keyed by cluster id');
    }

    emDashFields(c, ['name', 'summary', 'linkLabel']).forEach(f =>
      warnings.push(where + ': "' + f + '" contains an em dash, this dashboard never uses one, check for a paste-in'));
  });

  // relatedTo ids are checked after every file has been read, since a
  // forward reference (id declared in a file later than the one pointing
  // to it) is normal and not itself an error.
  const knownIds = new Set(clusters.map(({ data: c }) => c.id).filter(Boolean));
  const byId = new Map(clusters.map(({ data: c }) => [c.id, c]));
  clusters.forEach(({ file, data: c }) => {
    (c.relatedTo || []).forEach(id => {
      if (!knownIds.has(id)) {
        warnings.push(file + (c.id ? ' (' + c.id + ')' : '') + ': relatedTo references unknown cluster id "' + id +
          '", that relationship line will never be drawn');
        return;
      }
      // A relation with no real reason on either side never renders (see
      // renderGraph's own comment in public/index.html) rather than draw a
      // dashed line whose meaning a viewer has to guess at. Warning, not an
      // error, since a relatedTo entry with the reason still being written
      // is a real, temporary in-progress state, not a broken one.
      const other = byId.get(id);
      const hasReason = (c.relationReasons && c.relationReasons[id]) || (other && other.relationReasons && other.relationReasons[c.id]);
      if (!hasReason) {
        warnings.push(file + (c.id ? ' (' + c.id + ')' : '') + ': relatedTo "' + id + '" has no relationReasons entry on either side, ' +
          'that relationship line will not be drawn until one explains what the connection actually is');
      }
    });
  });

  if (warnings.length) {
    console.warn(warnings.length + ' warning(s):');
    warnings.forEach(w => console.warn('  - ' + w));
  }

  if (errors.length) {
    console.error((warnings.length ? '\n' : '') + errors.length + ' error(s) in data/clusters/:');
    errors.forEach(e => console.error('  - ' + e));
    process.exit(1);
  }

  console.log((warnings.length ? '\n' : '') + 'All ' + clusters.length + ' cluster file(s) are valid.');
  process.exit(0);
}

main();

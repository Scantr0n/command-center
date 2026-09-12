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

function isDateOrNull(v) {
  return v === null || v === undefined || (typeof v === 'string' && DATE_RE.test(v));
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
  });

  // relatedTo ids are checked after every file has been read, since a
  // forward reference (id declared in a file later than the one pointing
  // to it) is normal and not itself an error.
  const knownIds = new Set(clusters.map(({ data: c }) => c.id).filter(Boolean));
  clusters.forEach(({ file, data: c }) => {
    (c.relatedTo || []).forEach(id => {
      if (!knownIds.has(id)) {
        warnings.push(file + (c.id ? ' (' + c.id + ')' : '') + ': relatedTo references unknown cluster id "' + id +
          '", that relationship line will never be drawn');
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

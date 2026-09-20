#!/usr/bin/env node
/*
 * Regenerates changelog.json from this repo's real git history of
 * listings.json, pipeline.json, activity.json, sales.json, expenses.json,
 * disputes.json, and supplies.json, one entry per commit that actually
 * touched one of them.
 *
 * This exists so the "Data changelog" section on the page shows real,
 * independently-verifiable provenance (an actual commit hash, author, and
 * date from git) for when the reselling data actually changed, not a
 * hand-typed claim. Same pattern already in use at public/csm/data/changelog.js,
 * public/sondrik/data/changelog.js, and public/cgt/data/changelog.js for the
 * same reason: a new sale or a pipeline count is a real claim about a real
 * business, and this lets it be checked against the repo instead of trusted
 * on its face.
 *
 * Usage: node public/garage/data/changelog.js
 * Run again any time after new commits touch any of the tracked files.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DATA_DIR = __dirname;
const OUT_FILE = path.join(DATA_DIR, 'changelog.json');
const TRACKED_FILES = ['listings.json', 'pipeline.json', 'activity.json', 'sales.json', 'expenses.json', 'disputes.json', 'supplies.json'];
const RECORD_SEP = '\x1e';

function repoRoot() {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: DATA_DIR, encoding: 'utf8' }).trim();
}

// A shallow clone's oldest fetched commit has no parent in `git log`,
// exactly what a real repo-root/history-rewrite commit looks like to the
// isHistoryReset check below. Without this guard, running this script from
// a shallow clone (the default checkout in an automated sandbox) silently
// misreports that boundary as a real history reset and throws away every
// real entry before it.
function assertNotShallow(root) {
  const isShallow = execFileSync('git', ['-C', root, 'rev-parse', '--is-shallow-repository'], { encoding: 'utf8' }).trim() === 'true';
  if (isShallow) {
    throw new Error('Refusing to regenerate changelog.json from a shallow git clone (the oldest visible commit would be misread as a real history rewrite). Run `git fetch --unshallow` first, then re-run this script.');
  }
}

function relPaths(root) {
  return TRACKED_FILES.map(f => path.relative(root, path.join(DATA_DIR, f)));
}

function run() {
  const root = repoRoot();
  assertNotShallow(root);
  const paths = relPaths(root);
  const log = execFileSync('git', [
    '-C', root,
    'log',
    '--date=short',
    '--name-only',
    '--pretty=format:' + RECORD_SEP + '%H|%P|%ad|%an|%s',
    '--',
    ...paths
  ], { encoding: 'utf8' });

  const basenames = new Set(TRACKED_FILES);
  const entries = log.split(RECORD_SEP).map(block => block.trim()).filter(Boolean).map(block => {
    const lines = block.split('\n');
    const [hash, parents, date, author, ...subjectParts] = lines[0].split('|');
    const subject = subjectParts.join('|');
    const files = lines.slice(1)
      .map(l => l.trim())
      .filter(Boolean)
      .map(l => path.basename(l))
      .filter(name => basenames.has(name));
    // A commit with no parent is a repo root, which this project's history
    // periodically gets collapsed down to (see the recurring "regenerate
    // ... drifted after upstream history rewrite" commits across every hub).
    // Its subject line is whatever the rewrite happened to carry over, which
    // has nothing to do with listings.json/sales.json/etc (seen in practice:
    // a root commit here with an unrelated, foreign subject). Showing that
    // subject as this file's real change history would be exactly the kind
    // of unverified claim this changelog exists to avoid, so it's replaced
    // with an honest note instead. Same fix already landed on the CSM,
    // Sondrik, and CGT hubs for the identical bug.
    const isHistoryReset = parents.trim() === '';
    return {
      hash: hash.slice(0, 7),
      fullHash: hash,
      date,
      author,
      subject: isHistoryReset
        ? 'Repository history was reset here (single-commit rewrite); the real commit message for this change was not preserved'
        : subject,
      historyReset: isHistoryReset,
      files
    };
  }).filter(e => e.files.length > 0);

  const out = {
    generatedAt: new Date().toISOString(),
    generatedFrom: 'git log over public/garage/data/{' + TRACKED_FILES.join(',') + '}, run node public/garage/data/changelog.js to refresh',
    entries
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + '\n');
  console.log('Wrote ' + entries.length + ' changelog entr' + (entries.length === 1 ? 'y' : 'ies') + ' to ' + path.relative(root, OUT_FILE));
}

run();

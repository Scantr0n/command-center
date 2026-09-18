#!/usr/bin/env node
/*
 * Regenerates changelog.json from this repo's real git history of
 * cards.json, submissions.json, and candidates.json, one entry per commit
 * that actually touched one of them.
 *
 * This exists so the "Data changelog" section on the page shows real,
 * independently-verifiable provenance (an actual commit hash, author, and
 * date from git) for when the card/grading data actually changed, not a
 * hand-typed claim. Same pattern already in use at
 * public/csm/data/changelog.js and public/sondrik/data/changelog.js for the
 * same reason: a new grading batch or a backfilled value is a real claim
 * about a real collection, and this lets it be checked against the repo
 * instead of trusted on its face.
 *
 * Usage: node public/cgt/data/changelog.js
 * Run again any time after new commits touch cards.json, submissions.json,
 * or candidates.json.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DATA_DIR = __dirname;
const OUT_FILE = path.join(DATA_DIR, 'changelog.json');
const TRACKED_FILES = ['cards.json', 'submissions.json', 'candidates.json'];
const RECORD_SEP = '\x1e';

function repoRoot() {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: DATA_DIR, encoding: 'utf8' }).trim();
}

function relPaths(root) {
  return TRACKED_FILES.map(f => path.relative(root, path.join(DATA_DIR, f)));
}

function run() {
  const root = repoRoot();
  const paths = relPaths(root);
  const log = execFileSync('git', [
    '-C', root,
    'log',
    '--date=short',
    '--name-only',
    '--pretty=format:' + RECORD_SEP + '%H|%ad|%an|%s',
    '--',
    ...paths
  ], { encoding: 'utf8' });

  const basenames = new Set(TRACKED_FILES);
  const entries = log.split(RECORD_SEP).map(block => block.trim()).filter(Boolean).map(block => {
    const lines = block.split('\n');
    const [hash, date, author, ...subjectParts] = lines[0].split('|');
    const subject = subjectParts.join('|');
    const files = lines.slice(1)
      .map(l => l.trim())
      .filter(Boolean)
      .map(l => path.basename(l))
      .filter(name => basenames.has(name));
    return { hash: hash.slice(0, 7), fullHash: hash, date, author, subject, files };
  }).filter(e => e.files.length > 0);

  const out = {
    generatedAt: new Date().toISOString(),
    generatedFrom: 'git log over public/cgt/data/{' + TRACKED_FILES.join(',') + '}, run node public/cgt/data/changelog.js to refresh',
    entries
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + '\n');
  console.log('Wrote ' + entries.length + ' changelog entr' + (entries.length === 1 ? 'y' : 'ies') + ' to ' + path.relative(root, OUT_FILE));
}

run();

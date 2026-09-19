#!/usr/bin/env node
/*
 * Regenerates changelog.json from this repo's real git history of
 * releases.json, downloads.json, leads.json, channels.json, and
 * goals.json, one entry per commit that actually touched one of them.
 *
 * This exists so the "Data changelog" section on the page shows real,
 * independently-verifiable provenance (an actual commit hash, author, and
 * date from git, not a hand-typed claim) for when the underlying numbers
 * changed. A 2026-09-17 incident marked a real lead sent based on an
 * unverifiable "per project memory" claim when it had not been sent; this
 * gives Jack, or anyone reviewing this hub, a way to check what actually
 * changed and when without trusting a hand-written note.
 *
 * Usage: node public/sondrik/data/changelog.js
 * Run again any time after new commits touch the data files to refresh it.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DATA_DIR = __dirname;
const OUT_FILE = path.join(DATA_DIR, 'changelog.json');
const TRACKED_FILES = ['releases.json', 'downloads.json', 'leads.json', 'channels.json', 'goals.json'];
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
    // has nothing to do with Sondrik's data files (seen in practice: a root
    // commit here with a Garage or CGT subject). Showing that subject as
    // this file's real change history would be exactly the kind of
    // unverified claim this changelog exists to avoid, so it's replaced with
    // an honest note instead of the misleading original subject.
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
    generatedFrom: 'git log over public/sondrik/data/{' + TRACKED_FILES.join(',') + '}, run node public/sondrik/data/changelog.js to refresh',
    entries
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + '\n');
  console.log('Wrote ' + entries.length + ' changelog entr' + (entries.length === 1 ? 'y' : 'ies') + ' to ' + path.relative(root, OUT_FILE));
}

run();

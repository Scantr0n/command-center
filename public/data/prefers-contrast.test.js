#!/usr/bin/env node
/*
 * Regression guard for prefers-contrast: more support, the same real signal
 * public/alpha/style.css, public/cgt/style.css, and public/sondrik/style.css
 * already answer (see their own header comments: --dim/--sub carry real
 * information, not just decoration, so a reader who asked their system for
 * more contrast should get it here too). CSM, Garage, Job Search, and the
 * hub page itself (public/index.html, the page Jack actually leaves open)
 * went without this for a real stretch even though they lean on the exact
 * same --sub/--dim (or --faint on the hub page)/--hairline tokens just as
 * heavily, the same silent per-hub drift class as sw-shell.test.js already
 * guards against one layer over (a real fix landing on some hubs and never
 * reaching the others). This reads each page's real CSS source as text
 * rather than importing it, since it is plain CSS, not a JS module.
 *
 * Usage: node --test public/data/prefers-contrast.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC_DIR = path.join(__dirname, '..');

// Every page in this app that defines its own --hairline/--sub/dim-or-faint
// design tokens, and the real source file that holds its :root block.
const PAGES = [
  { name: 'hub (index.html)', file: path.join(PUBLIC_DIR, 'index.html'), dimToken: '--faint' },
  { name: 'alpha', file: path.join(PUBLIC_DIR, 'alpha', 'style.css'), dimToken: '--dim' },
  { name: 'cgt', file: path.join(PUBLIC_DIR, 'cgt', 'style.css'), dimToken: '--dim' },
  { name: 'csm', file: path.join(PUBLIC_DIR, 'csm', 'style.css'), dimToken: '--dim' },
  { name: 'garage', file: path.join(PUBLIC_DIR, 'garage', 'style.css'), dimToken: '--dim' },
  { name: 'job-search', file: path.join(PUBLIC_DIR, 'job-search', 'style.css'), dimToken: '--dim' },
  { name: 'sondrik', file: path.join(PUBLIC_DIR, 'sondrik', 'style.css'), dimToken: '--dim' }
];

function extractMediaBlock(source, query) {
  const marker = `@media (${query})`;
  const start = source.indexOf(marker);
  if (start === -1) return null;
  // Walk forward from the first "{" after the marker, tracking brace depth,
  // to pull out exactly this media block's own body (it nests its own
  // :root { ... } rule, a plain indexOf/slice to the next "}" would stop too
  // early).
  let depth = 0;
  let bodyStart = -1;
  for (let i = start; i < source.length; i++) {
    if (source[i] === '{') {
      depth++;
      if (bodyStart === -1) bodyStart = i + 1;
    } else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(bodyStart, i);
    }
  }
  return null;
}

PAGES.forEach(({ name, file, dimToken }) => {
  test(`${name} answers prefers-contrast: more for its real --hairline/--sub/${dimToken} tokens`, () => {
    const source = fs.readFileSync(file, 'utf8');
    const block = extractMediaBlock(source, 'prefers-contrast: more');
    assert.ok(block, `${name} (${path.relative(PUBLIC_DIR, file)}) has no "@media (prefers-contrast: more)" block, its real --sub/${dimToken} text and --hairline borders stay flat for a reader who asked for more contrast`);
    ['--hairline', '--hairlineHover', '--sub', dimToken].forEach(token => {
      assert.ok(
        block.includes(token + ':'),
        `${name}'s prefers-contrast: more block does not override ${token}`
      );
    });
  });
});

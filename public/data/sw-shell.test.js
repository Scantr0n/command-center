#!/usr/bin/env node
/*
 * Regression guard for public/sw.js's SHELL_URLS, the hand-maintained list
 * of every static file the app shell caches for full offline use. It is
 * not a pure-logic module like this directory's other *-core.js files (it
 * runs in the service worker global scope, not Node), so this test reads
 * the real public/sw.js source as text and cross-checks it against the
 * real filesystem and the real <script src="..."> tags each hub's own
 * index.html loads, instead of importing it.
 *
 * This exact bug class already shipped once: commit 6b730ea ("add
 * chat-format-core.js to the service worker's offline app shell") was a
 * separate follow-up fix after a new core module was wired into the hub
 * page but never added to SHELL_URLS, silently breaking offline mode for
 * just that feature. Nothing previously caught that before a real offline
 * page load did; this test exists so the next missed module fails `npm
 * test` instead.
 *
 * Usage: node --test public/data/sw-shell.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC_DIR = path.join(__dirname, '..');
const SW_SOURCE = fs.readFileSync(path.join(PUBLIC_DIR, 'sw.js'), 'utf8');

function parseShellUrls(source) {
  const match = source.match(/const SHELL_URLS = \[([\s\S]*?)\];/);
  assert.ok(match, 'public/sw.js must define a SHELL_URLS array');
  return [...match[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
}

// A SHELL_URLS entry maps to a real file on disk: a bare "/" or a
// directory-style "/alpha/" entry resolves to that directory's index.html,
// same as the request Express itself resolves them to.
function shellUrlToFile(url) {
  const relative = url.endsWith('/') ? url + 'index.html' : url;
  return path.join(PUBLIC_DIR, relative);
}

const HUBS = ['', 'alpha', 'cgt', 'csm', 'garage', 'sondrik', 'job-search'];

function hubScriptSrcs(hub) {
  const html = fs.readFileSync(path.join(PUBLIC_DIR, hub, 'index.html'), 'utf8');
  return [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)]
    .map(m => m[1])
    .filter(src => !src.startsWith('http')); // same-origin only, no CDN scripts
}

const SHELL_URLS = parseShellUrls(SW_SOURCE);

test('every SHELL_URLS entry resolves to a real file that still exists', () => {
  SHELL_URLS.forEach(url => {
    const file = shellUrlToFile(url);
    assert.ok(fs.existsSync(file), `SHELL_URLS has "${url}" but ${path.relative(PUBLIC_DIR, file)} does not exist`);
  });
});

test('every hub index.html\'s own local <script src> is cached in SHELL_URLS', () => {
  HUBS.forEach(hub => {
    hubScriptSrcs(hub).forEach(src => {
      assert.ok(
        SHELL_URLS.includes(src),
        `${hub || 'root'} index.html loads "${src}" but SHELL_URLS does not list it, offline mode for this hub would silently miss it`
      );
    });
  });
});

test('every hub\'s own index.html, app entry, and style.css are in SHELL_URLS', () => {
  HUBS.forEach(hub => {
    const prefix = hub ? `/${hub}/` : '/';
    const indexHtml = `${prefix}index.html`;
    assert.ok(SHELL_URLS.includes(prefix), `SHELL_URLS is missing the "${prefix}" directory entry for ${hub || 'root'}`);
    assert.ok(SHELL_URLS.includes(indexHtml), `SHELL_URLS is missing "${indexHtml}"`);
    if (hub) {
      assert.ok(SHELL_URLS.includes(`${prefix}style.css`), `SHELL_URLS is missing "${prefix}style.css"`);
    }
  });
});

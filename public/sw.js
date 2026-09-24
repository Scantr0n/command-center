// Bump this on any change to the cache lists or strategy below, it is the
// only thing that makes the browser fetch a new sw.js and run activate to
// drop the previous cache. The dashboard is otherwise "installable" (see the
// manifest) but was never actually usable offline: this is what closes that
// gap, without touching how any page talks to /api or its own /data files.
const CACHE_VERSION = 'v42';
const SHELL_CACHE = 'cc-shell-' + CACHE_VERSION;
const RUNTIME_CACHE = 'cc-runtime-' + CACHE_VERSION;

// The app shell: every hub's own page plus the assets it needs to render
// fully offline on a repeat visit. Hand-listed rather than crawled, since
// there is no build step here to generate a manifest from.
const SHELL_URLS = [
  '/', '/index.html', '/style.css', '/manifest.webmanifest',
  '/favicon.svg', '/apple-touch-icon.png', '/icon-192.png', '/icon-512.png',
  '/vendor/d3-force-selection-zoom.min.js', '/sidebar.js', '/data/dashboard-core.js', '/data/graph-core.js',
  '/alpha/', '/alpha/index.html', '/alpha/app.js', '/alpha/style.css',
  '/alpha/data/account-core.js', '/alpha/data/dates-core.js', '/alpha/data/regime-core.js',
  '/alpha/data/sparkline-core.js', '/alpha/data/export-core.js', '/alpha/data/html-core.js',
  '/cgt/', '/cgt/index.html', '/cgt/app.js', '/cgt/style.css',
  '/cgt/import.html', '/cgt/import.js', '/cgt/data/validate-core.js', '/cgt/data/grading-core.js',
  '/cgt/data/turnaround-core.js', '/cgt/data/import-core.js', '/cgt/data/export-core.js',
  '/csm/', '/csm/index.html', '/csm/app.js', '/csm/style.css', '/csm/data/validate-core.js',
  '/csm/data/csm-core.js',
  '/garage/', '/garage/index.html', '/garage/app.js', '/garage/style.css', '/garage/data/validate-core.js',
  '/garage/data/garage-core.js', '/garage/data/export-core.js',
  '/sondrik/', '/sondrik/index.html', '/sondrik/app.js', '/sondrik/style.css', '/sondrik/data/validate-core.js',
  '/sondrik/data/goals-core.js', '/sondrik/data/release-core.js', '/sondrik/data/export-core.js',
  '/sondrik/data/next-steps-core.js',
  '/job-search/', '/job-search/index.html', '/job-search/app.js', '/job-search/style.css',
  '/job-search/data/validate-core.js', '/job-search/data/export-core.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== SHELL_CACHE && k !== RUNTIME_CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Real project data (the /api/clusters feed and every hub's hand-edited
// /data/*.json) must show the live file whenever the network is up, an old
// cached snapshot silently served over a working connection would be worse
// than no offline support at all. Cache is only the offline fallback.
function isDataRequest(url) {
  return url.pathname.startsWith('/api/') || /\/data\/.*\.json$/.test(url.pathname);
}

// Cached under the bare path, not the full request: Alpha's status.json
// fetch appends a cache-busting "?t=<timestamp>" query so every 30s poll is
// a distinct URL, and caching by full URL would grow the runtime cache by
// one entry per poll forever instead of keeping one live snapshot per file.
async function networkFirst(request) {
  const url = new URL(request.url);
  const cacheKey = url.origin + url.pathname;
  try {
    const fresh = await fetch(request);
    if (fresh.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(cacheKey, fresh.clone());
    }
    return fresh;
  } catch (err) {
    const cache = await caches.open(RUNTIME_CACHE);
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
    throw err;
  }
}

// Static assets (the app shell, plus vendor/icons/fonts fetched at runtime)
// rarely change and are only ever replaced by a new CACHE_VERSION, so serve
// the cached copy instantly and refresh it in the background rather than
// waiting on the network every time.
//
// Cached under the bare path, same reasoning as networkFirst's cacheKey
// above: the dashboard now supports "?project=<id>" deep links into a
// project's modal (shareable via the modal's own Copy link button), so a
// plain path match against the request would miss the cached "/" shell for
// every such link and, worse, store each distinct link as its own cache
// entry forever instead of recognizing it as the same page.
async function staleWhileRevalidate(request) {
  const url = new URL(request.url);
  const cacheKey = url.origin + url.pathname;
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(cacheKey);
  const networkFetch = fetch(request).then(fresh => {
    if (fresh.ok) cache.put(cacheKey, fresh.clone());
    return fresh;
  }).catch(() => null);
  const fresh = cached || (await networkFetch);
  if (fresh) return fresh;
  // A page navigation (not a sub-resource like a font or script) that misses
  // the cache with the network down previously fell straight to
  // Response.error(), which the browser turns into its own generic "no
  // internet" interstitial instead of anything this app shows. Falling back
  // to the real cached dashboard shell here gives Jack something he can
  // actually navigate from instead of a dead end, same real-cached-content
  // rule as every other fallback in this file (never a fabricated page).
  if (request.mode === 'navigate') {
    const shellFallback = await cache.match(url.origin + '/');
    if (shellFallback) return shellFallback;
  }
  return Response.error();
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return; // toggles/chat POSTs always go straight to network
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isDataRequest(url)) {
    event.respondWith(networkFirst(request));
  } else {
    event.respondWith(staleWhileRevalidate(request));
  }
});

require('dotenv').config({ quiet: true });
const express = require('express');
const compression = require('compression');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const app = express();
// This binds to all interfaces (no host passed to app.listen below), so it's
// reachable from any device on Jack's LAN, not just this Mac, meaning these
// headers matter beyond a purely local threat model. `X-Powered-By: Express`
// gave away the framework to anything on the network for free; the other
// three are the standard low-risk OWASP baseline (nosniff blocks a browser
// from re-interpreting a response's declared content-type, DENY blocks this
// dashboard from being framed by another site for clickjacking, and the
// referrer policy keeps full URLs, which can carry a cluster id or query
// string, from leaking to an external site's server logs on outbound links).
// No Content-Security-Policy here: every hub inlines scripts and pulls
// Google Fonts plus the D3 CDN, so a real CSP needs to be worked out against
// every page's actual sources rather than guessed at and risking a silent
// breakage across all 7 hubs.
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});
// Every hub's app.js/style.css is hand-written, uncompressed text (up to
// ~175KB for the largest ones) and /api/clusters is JSON, both of which gzip
// down hard. Applied before express.static/json so it covers the static
// files and every API response the same way.
app.use(compression());
// Default express.json() cap (100kb) is fine for every route except the
// Garage photo-to-listing drafter, which posts a handful of base64-encoded
// item photos in one request; raised once globally rather than per-route
// since no other endpoint here accepts a body anywhere near this size.
app.use(express.json({ limit: '30mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CLUSTERS_DIR = path.join(__dirname, 'data', 'clusters');
const TOGGLES_FILE = path.join(__dirname, 'data', 'toggles.json');
const { readSnapshot, listSnapshots } = require('./credentials/drive.js');

// Skips and logs any cluster file that fails to parse instead of letting one
// hand-edit typo take down every project on the dashboard, since these files
// are meant to be edited by hand per each hub's own schema-help instructions.
function readLocalClusters() {
  const files = fs.readdirSync(CLUSTERS_DIR).filter(f => f.endsWith('.json'));
  const clusters = [];
  const brokenFiles = [];
  for (const f of files) {
    try {
      clusters.push(JSON.parse(fs.readFileSync(path.join(CLUSTERS_DIR, f), 'utf8')));
    } catch (err) {
      console.error(`Skipping malformed cluster file ${f}: ${err.message}`);
      brokenFiles.push({ file: f, error: err.message });
    }
  }
  return { clusters, brokenFiles };
}

// Real measured cost of the old version: every single /api/clusters call
// (including the client's own 30s poll, so up to twice a minute for as long
// as a dashboard tab stays open) re-ran listSnapshots() plus a
// files.list+files.get pair per matching cluster, every one a real Google
// API round-trip. Profiled this page's own real network timing tonight:
// /api/clusters took ~110ms against ~6-7ms for every static asset, by far
// the single biggest contributor to load time. Worse, with Drive currently
// failing auth (confirmed in this server's own logs: "invalid_grant" on
// every request), that was a real failed round-trip being retried on every
// single request, forever, not just an unnecessary success case. Caching
// the Drive-derived data with a short TTL throttles that to at most once
// per window regardless of how often the client polls, while still keeping
// cross-machine sync reasonably fresh; a real auth failure gets retried at
// the same throttled cadence instead of hammering it every request.
let driveCache = null; // { driveNames: Set<string>, snapshots: Map<string, object> }, only set on a real success
let driveCacheError = null; // the most recent failure, if the last attempt failed
let driveLastAttemptAt = 0; // tracked separately from success/failure so BOTH get throttled the same way
const DRIVE_CACHE_TTL_MS = 60 * 1000;

async function getDriveCache() {
  const now = Date.now();
  if (now - driveLastAttemptAt < DRIVE_CACHE_TTL_MS) {
    // Re-throwing a cached failure (rather than only caching successes) is
    // the real fix: an auth error like invalid_grant fails before any real
    // data is fetched, so caching success alone would still retry the
    // doomed call on every single request, exactly the behavior this exists
    // to throttle.
    if (driveCacheError) throw driveCacheError;
    if (driveCache) return driveCache;
  }
  driveLastAttemptAt = now;
  try {
    const driveFiles = await listSnapshots();
    const driveNames = new Set(driveFiles.map(f => f.name.replace(/\.json$/, '')));
    const snapshots = new Map();
    await Promise.all([...driveNames].map(async id => {
      try {
        const snap = await readSnapshot(id);
        if (snap) snapshots.set(id, snap);
      } catch {
        // One cluster's snapshot failing to read shouldn't drop every other
        // real Drive-synced cluster back to local-only for this whole cycle.
      }
    }));
    driveCache = { driveNames, snapshots };
    driveCacheError = null;
    return driveCache;
  } catch (err) {
    driveCache = null;
    driveCacheError = err;
    throw err;
  }
}

// Merges in live Drive snapshots where they exist, falls back to local-only
// silently if Drive is unreachable (auth not set up yet, network down, etc.)
async function readClusters() {
  const { clusters: localClusters, brokenFiles } = readLocalClusters();
  try {
    const { driveNames, snapshots } = await getDriveCache();
    const merged = localClusters.map(c => {
      if (!driveNames.has(c.id)) return c;
      const snapshot = snapshots.get(c.id);
      return snapshot ? { ...c, ...snapshot, fromDrive: true } : c;
    });
    return { clusters: merged, brokenFiles };
  } catch (err) {
    console.log('Drive unavailable, using local snapshots only:', err.message);
    return { clusters: localClusters, brokenFiles };
  }
}

// Same skip-and-fall-back guard as readLocalClusters above: toggles.json sits
// right alongside the hand-edited cluster files, so a bad write (a killed
// process mid-save, a stray hand-edit) should degrade to "no toggle state"
// rather than throwing out of /api/clusters and 500ing the whole dashboard
// over one project's on/off switch.
function readToggles() {
  if (!fs.existsSync(TOGGLES_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(TOGGLES_FILE, 'utf8'));
  } catch (err) {
    console.error(`Ignoring malformed toggles.json: ${err.message}`);
    return {};
  }
}

// Plain writeFileSync isn't atomic: a process killed mid-write (or a full
// disk) can leave toggles.json truncated, which readToggles above then
// treats as "corrupted" and silently discards, losing every toggle Jack had
// actually set. Writing to a temp file in the same directory and renaming
// over the real path avoids that window: the rename is atomic on the same
// filesystem, so readers only ever see the old complete file or the new
// complete file, never a partial one.
function writeToggles(toggles) {
  const tmpFile = `${TOGGLES_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(toggles, null, 2));
  fs.renameSync(tmpFile, TOGGLES_FILE);
}

app.get('/api/clusters', async (req, res) => {
  try {
    const { clusters, brokenFiles } = await readClusters();
    const toggles = readToggles();
    const withToggleState = clusters.map(c => {
      if (c.toggleable) {
        return { ...c, enabled: toggles[c.toggleId] !== false };
      }
      return c;
    });
    res.json({ clusters: withToggleState, brokenFiles });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/toggles/:toggleId', async (req, res) => {
  try {
    const { toggleId } = req.params;
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be a boolean' });
    }
    // Without this check, a stray or malformed request (a stale client, a
    // typo'd id typed by hand) would silently create and persist a brand
    // new key in toggles.json forever, with nothing on the dashboard ever
    // reading it back. Checked against the same real cluster data
    // /api/clusters itself serves, so a toggle only ever exists for a
    // cluster that actually declares toggleable/toggleId.
    const { clusters } = await readClusters();
    const knownToggleIds = new Set(clusters.filter(c => c.toggleable && c.toggleId).map(c => c.toggleId));
    if (!knownToggleIds.has(toggleId)) {
      return res.status(404).json({ error: `Unknown toggleId: ${toggleId}` });
    }
    const toggles = readToggles();
    toggles[toggleId] = enabled;
    writeToggles(toggles);
    res.json({ toggleId, enabled: toggles[toggleId] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Real chat history from the modal is always a short back-and-forth of
// plain strings, so anything else (missing/malformed body, an unbounded
// message count, one absurdly long message) is either a broken client or a
// stuck retry loop, not a real conversation. Rejected here, before ever
// reaching the Anthropic API, so a bad request fails fast and free instead
// of spending a real API call to get the same rejection back from Anthropic.
const MAX_CHAT_MESSAGES = 40;
const MAX_CHAT_MESSAGE_LENGTH = 4000;

function validateChatMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return 'messages must be a non-empty array';
  }
  if (messages.length > MAX_CHAT_MESSAGES) {
    return `messages must not exceed ${MAX_CHAT_MESSAGES} entries`;
  }
  for (const m of messages) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string' || !m.content.trim()) {
      return 'each message needs a role of "user" or "assistant" and non-empty string content';
    }
    if (m.content.length > MAX_CHAT_MESSAGE_LENGTH) {
      return `message content must not exceed ${MAX_CHAT_MESSAGE_LENGTH} characters`;
    }
  }
  return null;
}

// Every message in the array above still passes through to a real, billed
// api.anthropic.com call, so the array-shape checks alone don't bound how
// often this endpoint itself can be hit. The chat modal already disables its
// own send button while a request is in flight and caps a single
// conversation at MAX_CHAT_MESSAGES, but neither guard helps against a stuck
// retry loop, a bug that re-fires sendChat, or a request bypassing the UI
// entirely. A plain in-memory sliding window is enough here (single-process,
// no separate rate-limit dependency needed for a personal dashboard): each
// caller gets `limit` requests per `windowMs`, tracked by IP. A factory
// rather than one hand-rolled Map per route, since the Garage photo-drafter
// below needs the identical guard for its own real, billed call.
//
// A key's entry only ever gets filtered down, never deleted, on the request
// path below, so an IP that calls once and never again (a different network,
// IPv6 rotation, a one-off visitor) sits in requestLog forever: a real,
// slow memory leak over the server's actual multi-month uptime. The sweep
// below runs independently of any request, dropping any key whose entire
// timestamp list has aged out of the window, so the map's real size tracks
// active callers instead of every IP ever seen.
function createRateLimiter(limit, windowMs) {
  const requestLog = new Map();
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, timestamps] of requestLog) {
      if (!timestamps.some(t => now - t < windowMs)) requestLog.delete(key);
    }
  }, windowMs);
  sweep.unref();
  return function isRateLimited(key) {
    const now = Date.now();
    const timestamps = (requestLog.get(key) || []).filter(t => now - t < windowMs);
    if (timestamps.length >= limit) {
      requestLog.set(key, timestamps);
      return true;
    }
    timestamps.push(now);
    requestLog.set(key, timestamps);
    return false;
  };
}

const CHAT_RATE_LIMIT = 20;
const CHAT_RATE_WINDOW_MS = 10 * 60 * 1000;
const isChatRateLimited = createRateLimiter(CHAT_RATE_LIMIT, CHAT_RATE_WINDOW_MS);

// The photo drafter is a materially more expensive call than a chat message
// (a multi-image vision read plus up to 5 live web searches per draft, a
// 120s timeout vs chat's 25s), so it gets its own, tighter limit rather than
// sharing the chat one, while still leaving real room for a genuine batch
// photo session (drafting several real items back to back).
const DRAFT_RATE_LIMIT = 8;
const DRAFT_RATE_WINDOW_MS = 10 * 60 * 1000;
const isDraftRateLimited = createRateLimiter(DRAFT_RATE_LIMIT, DRAFT_RATE_WINDOW_MS);

app.post('/api/clusters/:id/chat', async (req, res) => {
  try {
    if (isChatRateLimited(req.ip)) {
      return res.status(429).json({ error: `Too many chat requests, try again in a few minutes (limit is ${CHAT_RATE_LIMIT} per ${CHAT_RATE_WINDOW_MS / 60000} minutes).` });
    }
    const { id } = req.params;
    const { messages } = req.body;
    const validationError = validateChatMessages(messages);
    if (validationError) return res.status(400).json({ error: validationError });
    const { clusters } = await readClusters();
    const cluster = clusters.find(c => c.id === id);
    if (!cluster) return res.status(404).json({ error: 'Unknown cluster' });

    const systemPrompt = `Never use em dashes (—) anywhere in your response, under any circumstances. Use periods, commas, or semicolons instead. This rule overrides normal writing style.\n\nYou are the assistant embedded in Jack's Command Center hub, scoped to his "${cluster.name}" project. Answer based on the real status given below, be concise.\n\nCurrent status:\n${cluster.summary}\nStatus: ${cluster.status}\nLast updated: ${cluster.lastUpdate || 'unknown'}`;

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 500,
        system: systemPrompt,
        messages
      }),
      // Same timeout guard as the Alpha proxy below, for the same reason: an
      // API call with none at all leaves the request (and the modal's typing
      // indicator, which only clears in sendChat's own finally block once
      // this settles) hanging forever instead of failing into the chat's
      // existing "Error reaching the assistant" state. 25s, not Alpha's 2s,
      // since a real completion legitimately takes longer than a status ping.
      signal: AbortSignal.timeout(25000)
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data });
    res.json({ text: data.content[0].text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Real box/weight combos Jack actually uses (see the Shipping cost reference
// section of the Garage page for the platform-level box-type guidance this
// sits alongside), fed into the drafter's shipping-dimensions prompt below so
// a garment-type guess grounds itself in what he really has on hand rather
// than inventing a box size from nothing. Deliberately narrow: only the
// combos actually confirmed, everything else the model estimates and must
// flag low-confidence per the prompt's own instructions.
const KNOWN_PACKAGING = [
  'CD: 7x9x1in, ~6oz, plain envelope/mailer',
  'DVD: 7x9x1in, ~8oz (thick/double-disc case needs extra depth, check it fits before assuming the standard depth)',
  'Beanie Baby: 5x5x5in box, ~8-12oz'
];

// Garage's whole data model runs on one convention, documented right on the
// page: every tool here (the Quick Log form, the price calculators) drafts
// JSON or numbers for Jack to review and hand-paste into listings.json, none
// of them write a file or publish anything themselves. This endpoint is the
// AI version of that same pattern: it looks at real item photos and drafts a
// listing, but the human-review step is load-bearing, not optional, so it
// returns a draft object with a confidence + reasoning per field rather than
// a finished listing. Condition notes, exact model/variant, and shipping
// dimensions are named explicitly as the fields most likely to be wrong from
// photos alone, since those are the ones that actually cost real money or a
// return if a guess ships as fact.
const DRAFT_LISTING_SCHEMA_HINT = `Respond with ONLY a single JSON object, no markdown fences, no commentary before or after. Shape:
{
  "itemSummary": {"value": string, "confidence": "high"|"medium"|"low", "reasoning": string},
  "brand": {"value": string|null, "confidence": "high"|"medium"|"low", "reasoning": string},
  "exactModelOrVariant": {"value": string|null, "confidence": "high"|"medium"|"low", "reasoning": string},
  "size": {"value": string|null, "confidence": "high"|"medium"|"low", "reasoning": string},
  "color": {"value": string|null, "confidence": "high"|"medium"|"low", "reasoning": string},
  "title": {"value": string, "confidence": "high"|"medium"|"low", "reasoning": string},
  "category": {"value": string, "confidence": "high"|"medium"|"low", "reasoning": string},
  "conditionNotes": {"value": string, "confidence": "high"|"medium"|"low", "reasoning": string},
  "description": {"value": string, "confidence": "high"|"medium"|"low", "reasoning": string},
  "suggestedPrice": {"value": number|null, "confidence": "high"|"medium"|"low", "reasoning": string, "comps": [{"title": string, "price": number, "platform": string, "condition": string, "url": string|null}]},
  "shippingDimensions": {"value": string|null, "confidence": "high"|"medium"|"low", "reasoning": string},
  "flagsForReview": [string]
}
Every "value" must come only from what is actually visible in the photos or found via real web search, never invented. If something can't be determined, use null (or an honest low-confidence guess with reasoning explaining the uncertainty) rather than a confident-sounding fabrication. "comps" must be real listings found via web search, each with a real price and platform, empty array if search found nothing usable. flagsForReview lists anything a human must double-check before this goes live, always include an entry for exactModelOrVariant, conditionNotes, and shippingDimensions if their confidence is not "high".`;

app.post('/api/garage/draft-listing', async (req, res) => {
  try {
    if (isDraftRateLimited(req.ip)) {
      return res.status(429).json({ error: `Too many draft requests, try again in a few minutes (limit is ${DRAFT_RATE_LIMIT} per ${DRAFT_RATE_WINDOW_MS / 60000} minutes).` });
    }
    const { images, notes } = req.body;
    if (!Array.isArray(images) || !images.length) {
      return res.status(400).json({ error: 'At least one image is required' });
    }
    if (images.length > 8) {
      return res.status(400).json({ error: 'Max 8 images per draft' });
    }
    const ALLOWED_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
    for (const img of images) {
      if (!img || !ALLOWED_MEDIA_TYPES.has(img.mediaType) || typeof img.dataBase64 !== 'string' || !img.dataBase64) {
        return res.status(400).json({ error: 'Each image needs a supported mediaType and dataBase64' });
      }
    }

    const systemPrompt = `Never use em dashes (—) anywhere in your response, under any circumstances. Use periods, commas, or semicolons instead.\n\nYou are drafting a resale listing for Jack from real photos of a real item, for his Command Center Garage hub (multi-platform: eBay, Vinted, Poshmark, Depop). This is a draft for human review, not a publish, so be honest about uncertainty rather than confident.\n\nReal packaging Jack already has on hand, use these when the item actually matches one, otherwise estimate a reasonable box/mailer size and weight for the item type and mark it lower confidence:\n${KNOWN_PACKAGING.map(p => '- ' + p).join('\n')}\n\nUse the web_search tool to find 2-3 real comparable sold or actively listed items (same brand, same or very similar model, similar condition) to ground suggestedPrice in real market data, not a guess. Cite the real title, price, platform, and condition of each comp you actually used.\n\n${DRAFT_LISTING_SCHEMA_HINT}`;

    const userContent = images.map(img => ({
      type: 'image',
      source: { type: 'base64', media_type: img.mediaType, data: img.dataBase64 }
    }));
    userContent.push({
      type: 'text',
      text: notes && notes.trim()
        ? `Real notes from Jack about this item: ${notes.trim()}\n\nDraft the listing per your instructions.`
        : 'Draft the listing per your instructions.'
    });

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 4000,
        system: systemPrompt,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
        messages: [{ role: 'user', content: userContent }]
      }),
      // Comp research via live web search plus a multi-image vision read
      // legitimately runs longer than the plain per-cluster chat above (25s),
      // give it real room before the request just hangs in the UI.
      signal: AbortSignal.timeout(120000)
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data });

    // With web_search enabled, content is a mix of server_tool_use /
    // web_search_tool_result / text blocks; the actual drafted JSON is in the
    // last text block, never content[0] (same extraction issue the Alpha
    // proxy above doesn't have to deal with, this is the first endpoint here
    // that turns on a server tool).
    const textBlocks = (data.content || []).filter(b => b.type === 'text');
    const lastText = textBlocks.length ? textBlocks[textBlocks.length - 1].text : '';
    let draft;
    try {
      const jsonMatch = lastText.match(/\{[\s\S]*\}/);
      draft = JSON.parse(jsonMatch ? jsonMatch[0] : lastText);
    } catch (parseErr) {
      return res.status(502).json({ error: 'Model did not return parseable JSON', raw: lastText });
    }
    res.json({ draft });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Alpha's real trading daemon runs on this same Mac at 127.0.0.1:3847. This
// is the ONLY place that base URL and this exact whitelist of paths are
// allowed to appear: every call here is GET-only against a fixed path, never
// a passthrough of a client-supplied path or method. Alpha is a live,
// real-money system and its /cmd endpoint can pause trading, close
// positions, and cancel orders; that endpoint must never be reachable from
// here or from anything Command Center exposes to the browser. This proxy
// exists to READ Alpha's real status, never to influence it.
const ALPHA_DAEMON_BASE = 'http://127.0.0.1:3847';
const ALPHA_STATUS_FILE = path.join(__dirname, 'public', 'alpha', 'data', 'status.json');

async function fetchAlpha(pathname) {
  const r = await fetch(ALPHA_DAEMON_BASE + pathname, { signal: AbortSignal.timeout(2000) });
  if (!r.ok) throw new Error(`Alpha daemon ${pathname} returned ${r.status}`);
  return r.json();
}

// Real peak-to-trough drawdown, computed from the daemon's actual equity
// curve (never estimated): walks the real history tracking the running
// peak, and returns how far the latest point sits below the running peak at
// that moment (current) plus the deepest such gap ever seen (max). Standard
// drawdown definition, nothing invented, mirrors what Alpha's own sizing
// logic already reacts to internally.
function computeDrawdowns(history) {
  if (!Array.isArray(history) || !history.length) return { currentDrawdownPct: null, maxDrawdownPct: null };
  let peak = history[0].v;
  let maxDrawdownPct = 0;
  for (const point of history) {
    if (point.v > peak) peak = point.v;
    const dd = peak > 0 ? ((peak - point.v) / peak) * 100 : 0;
    if (dd > maxDrawdownPct) maxDrawdownPct = dd;
  }
  const latest = history[history.length - 1].v;
  const currentDrawdownPct = peak > 0 ? ((peak - latest) / peak) * 100 : 0;
  return {
    currentDrawdownPct: Math.round(currentDrawdownPct * 100) / 100,
    maxDrawdownPct: Math.round(maxDrawdownPct * 100) / 100
  };
}

// Alpaca's real position/account payloads carry every internal margin and
// ID field the broker tracks; only pulls the subset a glance-at-status page
// actually needs; converts Alpaca's string numbers to real numbers once
// here rather than in every render function.
function mapPositions(rawPositions) {
  return Object.values(rawPositions || {}).map(p => ({
    symbol: p.symbol,
    side: p.side,
    qty: Number(p.qty),
    avgEntryPrice: Number(p.avg_entry_price),
    currentPrice: Number(p.current_price),
    marketValue: Number(p.market_value),
    unrealizedPl: Number(p.unrealized_pl),
    unrealizedPlPct: Number(p.unrealized_plpc) * 100
  })).sort((a, b) => b.marketValue - a.marketValue);
}

function mapAccount(rawAccount) {
  if (!rawAccount) return null;
  const equity = Number(rawAccount.equity);
  const lastEquity = Number(rawAccount.last_equity);
  return {
    equity,
    cash: Number(rawAccount.cash),
    buyingPower: Number(rawAccount.buying_power),
    portfolioValue: Number(rawAccount.portfolio_value),
    dayChangeDollar: Number.isFinite(equity) && Number.isFinite(lastEquity) ? equity - lastEquity : null,
    dayChangePct: Number.isFinite(equity) && Number.isFinite(lastEquity) && lastEquity !== 0
      ? ((equity - lastEquity) / lastEquity) * 100 : null
  };
}

// The daemon's /equity-history is already fetched for computeDrawdowns above,
// which only ever reads point.v, then the rest of each point was discarded.
// This maps the same already-trusted field into a plain number series so the
// page can show a real equity trend instead of just today's single derived
// drawdown percentage. Defensive and capped like every other real-feed mapper
// here; no timestamp field is read, since only .v is a field this codebase
// has ever actually verified against the daemon's real response.
const EQUITY_CURVE_POINT_CAP = 200;
function mapEquityCurve(history) {
  if (!Array.isArray(history)) return [];
  return history
    .map(p => Number(p && p.v))
    .filter(v => Number.isFinite(v))
    .slice(-EQUITY_CURVE_POINT_CAP);
}

// Turns the daemon's real evolution-history entries into the honest
// activity-log shape the Alpha page already renders. Only ever built from
// fields the daemon actually returned, never invented.
function evolutionEvents(history) {
  return history.map(entry => {
    const agents = entry.agents || {};
    const switches = Object.entries(agents).filter(([, a]) => a.switchedFrom);
    const detail = switches.length
      ? switches.map(([id, a]) => `${id}: ${a.switchedFrom} to ${a.strategy}`).join(', ')
      : `${Object.keys(agents).length} agents re-evolved, no strategy switches`;
    return {
      type: 'evolution',
      tone: 'neutral',
      label: `Weekly evolution run (${entry.interval || 'unknown interval'})`,
      detail,
      at: entry.timestamp
    };
  });
}

app.get('/api/alpha/live', async (req, res) => {
  // Same skip-and-log guard as readLocalClusters/readToggles above: this read
  // sat outside the try block below, so a missing or malformed status.json
  // (a killed process mid-save, a stray hand-edit) threw an unhandled error
  // out of the route instead of the honest degraded response every other
  // file read on this server already falls back to.
  let fallback;
  try {
    fallback = JSON.parse(fs.readFileSync(ALPHA_STATUS_FILE, 'utf8'));
  } catch (err) {
    console.error(`Alpha fallback status file unreadable: ${err.message}`);
    return res.status(500).json({ error: `Alpha fallback status file unreadable: ${err.message}` });
  }
  try {
    const health = await fetchAlpha('/health');
    const [state, evoHistory, anomalies, debates, equity] = await Promise.all([
      fetchAlpha('/state'),
      fetchAlpha('/evolution-history').catch(() => ({ history: [] })),
      fetchAlpha('/anomalies').catch(() => ({ stuck: [] })),
      fetchAlpha('/debates').catch(() => ({ enabled: false })),
      fetchAlpha('/equity-history').catch(() => ({ history: [] }))
    ]);

    const history = Array.isArray(evoHistory.history) ? evoHistory.history : [];
    const latestEvo = history[history.length - 1] || null;
    const drawdowns = computeDrawdowns(equity.history);
    const now = new Date().toISOString();

    // Same live-proxy-only rule as the rest of mapAccount's output (see its
    // own comment): only ever attached once a real account object exists,
    // never hand-edited into the static fallback.
    const account = mapAccount(state.account);
    if (account) account.equityCurve = mapEquityCurve(equity.history);

    res.json({
      system: fallback.system,
      connection: {
        connected: true,
        checkedAt: now,
        note: 'Live feed connected: reading directly from Alpha\'s real daemon on this Mac (127.0.0.1:3847).',
        history: []
      },
      live: {
        asOf: now,
        regime: state.regime && state.regime.regime ? state.regime.regime : null,
        killSwitch: {
          engaged: !!health.paused,
          lastTriggeredAt: null
        },
        positionSizing: {
          activeMode: null,
          currentDrawdownPct: drawdowns.currentDrawdownPct,
          maxDrawdownPct: drawdowns.maxDrawdownPct
        },
        debatePanel: {
          active: !!debates.enabled,
          blockedOn: debates.enabled ? null : 'API key'
        },
        account,
        positions: mapPositions(state.positions),
        genealogy: {
          generation: null,
          // activeLineages was removed: the daemon's real /evolution-history
          // response has no parentage/lineage-grouping field at all (checked
          // directly), only per-agent strategy metadata, so this could only
          // ever equal Object.keys(agents).length, i.e. the total agent
          // count already shown elsewhere on this page under a different
          // label, not a genuinely distinct lineage figure.
          lastBreedingEventAt: latestEvo ? latestEvo.timestamp : null,
          lastBreedingEventNote: latestEvo
            ? Object.entries(latestEvo.agents || {}).filter(([, a]) => a.switchedFrom).length + ' agent(s) switched strategy in the latest run'
            : null
        }
      },
      events: [
        ...evolutionEvents(history),
        ...(Array.isArray(anomalies.stuck) ? anomalies.stuck.map(a => ({
          type: 'anomaly', tone: 'alert', label: 'Stuck agent detected', detail: JSON.stringify(a), at: anomalies.checkedAt
        })) : [])
      ]
    });
  } catch (err) {
    // Daemon not reachable (not running, different machine, etc). Fall back
    // to the same honest static placeholder the page has always shown.
    res.json(fallback);
  }
});

// validate.js's own changelog-drift check (comparing changelog.json's
// recorded commit hashes against this repo's real git log for the same
// files) only ever runs from the command line, so a real drift went
// unnoticed on the live page multiple times tonight until someone happened
// to run the CLI validator. git log is the one part of this check that
// genuinely can't run in the browser, so it's exposed here as a small,
// read-only, best-effort API instead: a real drift becomes a real Next
// Steps item on the page itself, not something only the CLI ever surfaces.
app.get('/api/sondrik/changelog-status', (req, res) => {
  const dataDir = path.join(__dirname, 'public', 'sondrik', 'data');
  try {
    // A shallow clone's `git log` for these files only ever sees the commits
    // fetched, not the real full history, which would report drift that
    // isn't real (the same bug fixed in changelog.js and validate.js after
    // it collapsed real changelog entries on 2026-09-19). Treated as
    // "unavailable" below, same as no git checkout at all.
    if (execFileSync('git', ['-C', dataDir, 'rev-parse', '--is-shallow-repository'], { encoding: 'utf8' }).trim() === 'true') {
      throw new Error('shallow clone');
    }
    const realHashesRaw = execFileSync('git', [
      'log', '--format=%H', '--',
      'releases.json', 'downloads.json', 'leads.json', 'channels.json', 'goals.json'
    ], { cwd: dataDir, encoding: 'utf8' }).trim();
    const realHashes = realHashesRaw ? realHashesRaw.split('\n') : [];
    const changelogData = JSON.parse(fs.readFileSync(path.join(dataDir, 'changelog.json'), 'utf8'));
    const recordedHashes = (changelogData.entries || []).map(e => e.fullHash);
    res.json({
      drifted: recordedHashes.join(',') !== realHashes.join(','),
      recordedCount: recordedHashes.length,
      realCount: realHashes.length
    });
  } catch (err) {
    // Not a git checkout, git isn't on PATH, or changelog.json is missing:
    // an environment gap, not a real drift, so this stays a quiet false
    // rather than a page warning no one can act on.
    res.json({ drifted: false, unavailable: true });
  }
});

// Same pattern as /api/sondrik/changelog-status just above: validate.js's own
// changelog-drift check for status.json only ever ran from the command line,
// so a real drift here would go unnoticed on the live page the same way it
// did for Sondrik until someone happened to run the CLI validator. Exposed
// read-only so the Data changelog section on the Alpha page itself can flag
// a real drift instead of silently showing a changelog that's fallen behind.
app.get('/api/alpha/changelog-status', (req, res) => {
  const dataDir = path.join(__dirname, 'public', 'alpha', 'data');
  try {
    // Same shallow-clone guard as the Sondrik route: a shallow clone's
    // `git log` for status.json only sees the commits actually fetched, not
    // the real full history, which would report drift that isn't real.
    if (execFileSync('git', ['-C', dataDir, 'rev-parse', '--is-shallow-repository'], { encoding: 'utf8' }).trim() === 'true') {
      throw new Error('shallow clone');
    }
    const realHashesRaw = execFileSync('git', [
      'log', '--format=%H', '--', 'status.json'
    ], { cwd: dataDir, encoding: 'utf8' }).trim();
    const realHashes = realHashesRaw ? realHashesRaw.split('\n') : [];
    const changelogData = JSON.parse(fs.readFileSync(path.join(dataDir, 'changelog.json'), 'utf8'));
    const recordedHashes = (changelogData.entries || []).map(e => e.fullHash);
    res.json({
      drifted: recordedHashes.join(',') !== realHashes.join(','),
      recordedCount: recordedHashes.length,
      realCount: realHashes.length
    });
  } catch (err) {
    // Not a git checkout, git isn't on PATH, or changelog.json is missing:
    // an environment gap, not a real drift, so this stays a quiet false
    // rather than a page warning no one can act on.
    res.json({ drifted: false, unavailable: true });
  }
});

const PORT = process.env.PORT || 4488;
app.listen(PORT, () => {
  console.log(`Command Center running at http://localhost:${PORT}`);
});

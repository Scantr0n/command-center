require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());
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

// Merges in live Drive snapshots where they exist, falls back to local-only
// silently if Drive is unreachable (auth not set up yet, network down, etc.)
async function readClusters() {
  const { clusters: localClusters, brokenFiles } = readLocalClusters();
  try {
    const driveFiles = await listSnapshots();
    const driveNames = new Set(driveFiles.map(f => f.name.replace(/\.json$/, '')));
    const merged = await Promise.all(localClusters.map(async c => {
      if (!driveNames.has(c.id)) return c;
      try {
        const snapshot = await readSnapshot(c.id);
        return snapshot ? { ...c, ...snapshot, fromDrive: true } : c;
      } catch {
        return c;
      }
    }));
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

function writeToggles(toggles) {
  fs.writeFileSync(TOGGLES_FILE, JSON.stringify(toggles, null, 2));
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

app.post('/api/toggles/:toggleId', (req, res) => {
  try {
    const { toggleId } = req.params;
    const { enabled } = req.body;
    const toggles = readToggles();
    toggles[toggleId] = !!enabled;
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

app.post('/api/clusters/:id/chat', async (req, res) => {
  try {
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
  const fallback = JSON.parse(fs.readFileSync(ALPHA_STATUS_FILE, 'utf8'));
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
        account: mapAccount(state.account),
        positions: mapPositions(state.positions),
        genealogy: {
          generation: null,
          activeLineages: latestEvo ? Object.keys(latestEvo.agents || {}).length : null,
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

const PORT = process.env.PORT || 4488;
app.listen(PORT, () => {
  console.log(`Command Center running at http://localhost:${PORT}`);
});

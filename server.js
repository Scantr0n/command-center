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

function readLocalClusters() {
  const files = fs.readdirSync(CLUSTERS_DIR).filter(f => f.endsWith('.json'));
  return files.map(f => JSON.parse(fs.readFileSync(path.join(CLUSTERS_DIR, f), 'utf8')));
}

// Merges in live Drive snapshots where they exist, falls back to local-only
// silently if Drive is unreachable (auth not set up yet, network down, etc.)
async function readClusters() {
  const localClusters = readLocalClusters();
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
    return merged;
  } catch (err) {
    console.log('Drive unavailable, using local snapshots only:', err.message);
    return localClusters;
  }
}

function readToggles() {
  if (!fs.existsSync(TOGGLES_FILE)) return {};
  return JSON.parse(fs.readFileSync(TOGGLES_FILE, 'utf8'));
}

function writeToggles(toggles) {
  fs.writeFileSync(TOGGLES_FILE, JSON.stringify(toggles, null, 2));
}

app.get('/api/clusters', async (req, res) => {
  try {
    const clusters = await readClusters();
    const toggles = readToggles();
    const withToggleState = clusters.map(c => {
      if (c.toggleable) {
        return { ...c, enabled: toggles[c.toggleId] !== false };
      }
      return c;
    });
    res.json({ clusters: withToggleState });
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

app.post('/api/clusters/:id/chat', async (req, res) => {
  try {
    const { id } = req.params;
    const { messages } = req.body;
    const clusters = await readClusters();
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
        model: 'claude-sonnet-4-5',
        max_tokens: 500,
        system: systemPrompt,
        messages
      })
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data });
    res.json({ text: data.content[0].text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 4488;
app.listen(PORT, () => {
  console.log(`Command Center running at http://localhost:${PORT}`);
});

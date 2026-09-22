# Command Center

Jack's unified dashboard — one hub, one cluster per project, radial node-graph + grid views, per-cluster AI chat.

## Stack
- Node/Express (`server.js`), port set in `.env`
- Tailwind CSS (`src/input.css` → `public/style.css`, built via `npm run build:css`)
- D3.js for the radial hub-and-spoke graph view
- Google Drive sync (`credentials/drive.js`) merges local cluster JSON with live snapshots, falls back to local-only silently if Drive is unreachable

## Commands
- `npm start` — run the server
- `npm run build:css` — rebuild Tailwind output after editing `src/input.css`, or after adding/removing any Tailwind class anywhere in `public/**/*.html`/`.js` (run this after any style change, output isn't watched — a class that never gets compiled in silently no-ops with zero console/visual signal, a real bug found three times this way)
- `npm run verify:css` — rebuilds Tailwind to a scratch file and diffs it against the committed `public/style.css`, exits nonzero if they differ; run this before trusting a diff that touched any HTML/JS class, catches the exact `build:css` drift above without eyeballing the compiled output
- `npm run validate` — check every hub's real data files (`data/clusters/*.json` plus each hub's own `data/*.json`) against that hub's own field rules; run after hand-editing any of them, before trusting what the dashboard shows
- `npm run test:sondrik` — Sondrik's own regression tests for its shared date-math (`goals-core.js`, `validate-core.js`); run after touching either file
- `npm run test:cgt` — CGT's regression tests for its grading-ROI math (`grading-core.js`) and cards/submissions/candidates validation rules (`validate-core.js`); run after touching either file
- `npm run test:alpha` — Alpha's regression tests for its account/position money math (`account-core.js`) and market-calendar/uptime date math (`dates-core.js`); run after touching either file
- `npm run test:garage` — The Garage's regression tests for its platform fee/payout math and dispute/relist date math (`garage-core.js`); run after touching that file
- `npm run test:csm` — CSM's regression tests for its duplicate-prospect and casing-drift rules (`validate-core.js`); run after touching that file

## Structure
- `data/clusters/*.json` — one file per project, the source of truth for cluster status/summary
- `data/toggles.json` — per-cluster on/off toggles
- `public/index.html` + `public/style.css` — frontend, both views (graph + grid) live here
- `credentials/` — Drive OAuth + secrets, all gitignored except `drive.js`/`write_snapshot.js`/`oauth_setup.py` (the code, not the keys)

## Conventions
- Never commit `.env`, `credentials/drive_token.json`, or `credentials/drive_client_secret.json` — check `.gitignore` covers them before any commit touching `credentials/`
- Each machine (Mac, PC) needs its own OAuth client under `credentials/drive_client_secret.json` — do not reuse one client's credentials across machines, it invalidates the other's token (see the 9/10-9/11 outage this caused)
- Grid view's click-to-summarize flow is something Jack explicitly likes — don't regress it when changing the graph view
- No `agents: [...]` field exists per-cluster in the data model yet — don't fabricate agent-level sub-nodes in the graph until that's added for real

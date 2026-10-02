# Command Center

Jack's unified dashboard — one hub, one cluster per project, radial node-graph + grid views, per-cluster AI chat.

## Stack
- Node/Express (`server.js`), port set in `.env`
- Tailwind CSS (`src/input.css` → `public/style.css`, built via `npm run build:css`)
- D3.js for the radial hub-and-spoke graph view
- Google Drive sync (`credentials/drive.js`) merges local cluster JSON with live snapshots, falls back to local-only silently if Drive is unreachable

## Commands
- `npm test`: runs `validate`, `verify:css`, and every hub's `test:*` suite below in sequence, stops at the first failure; run this before trusting any change is done, it is every other command in this section chained into one
- `npm start` — run the server
- `npm run build:css` — rebuild Tailwind output after editing `src/input.css`, or after adding/removing any Tailwind class anywhere in `public/**/*.html`/`.js` (run this after any style change, output isn't watched — a class that never gets compiled in silently no-ops with zero console/visual signal, a real bug found three times this way)
- `npm run verify:css` — rebuilds Tailwind to a scratch file and diffs it against the committed `public/style.css`, exits nonzero if they differ; run this before trusting a diff that touched any HTML/JS class, catches the exact `build:css` drift above without eyeballing the compiled output
- `npm run validate` — check every hub's real data files (`data/clusters/*.json` plus each hub's own `data/*.json`) against that hub's own field rules; run after hand-editing any of them, before trusting what the dashboard shows
- `npm run test:sondrik` — Sondrik's own regression tests for its shared date-math (`goals-core.js`, `release-core.js`, `validate-core.js`), CSV/ICS export helpers (`export-core.js`), Next Steps checklist logic (`next-steps-core.js`), the Compare with backup field-by-field diff (`compare-core.js`), the shared HTML-escaping XSS guard (`html-core.js`), the README badge SVG builder (`badge-core.js`), download-milestone/trend-confidence math (`milestones-core.js`), the status-update/build-in-public/per-channel draft-post copy generation (`posts-core.js`), and the Funnel section's downloads-to-leads-to-outreach stage math (`funnel-core.js`); run after touching any of them
- `npm run test:cgt`: CGT's regression tests for its grading-ROI/collectibles-tax/card-value math (`grading-core.js`), grading-turnaround/return-date math (`turnaround-core.js`), cards/submissions/candidates validation rules (`validate-core.js`), the Compare with backup field-by-field diff (`compare-core.js`), CSV/ICS export escaping (`export-core.js`), the shared HTML-escaping XSS guard (`html-core.js`), and CSV-import parsing/row-building (`import-core.js`); run after touching any of them
- `npm run test:alpha` — Alpha's regression tests for its account/position money math (`account-core.js`), market-calendar/uptime date math (`dates-core.js`), regime-history segmenting/distribution math (`regime-core.js`), sparkline-point geometry and rolling-latency-average math (`sparkline-core.js`), status.json validation-support rules (`validate-core.js`), CSV export escaping (`export-core.js`), the shared HTML-escaping XSS guard (`html-core.js`), the Compare with backup field-by-field diff scoped to system.* (`compare-core.js`), and the server-side `/api/alpha/live` money math (`live-core.js`: drawdown %, account P&L, position/equity mapping); run after touching any of them
- `npm run test:garage`: The Garage's regression tests for its platform fee/payout math and dispute/relist date math (`garage-core.js`), listings validation rules (`validate-core.js`), photo-audit crop-preview math (`crop-core.js`), CSV export escaping (`export-core.js`), the shared HTML-escaping XSS guard (`html-core.js`), and the Compare with backup field-by-field diff across all ten hand-edited data files (`compare-core.js`); run after touching any of them
- `npm run test:csm` — CSM's regression tests for its duplicate-prospect and casing-drift rules (`validate-core.js`), and its nudge/stall/social-snapshot-staleness date math, Beijing-time reply-window math, CSV/ICS export helpers, and Compare with backup field-by-field diff (`csm-core.js`); run after touching either file
- `npm run test:job-search` — Job Search's regression tests for its date/em-dash/URL and duplicate-application rules (`validate-core.js`), CSV export escaping (`export-core.js`), the shared HTML-escaping XSS guard (`html-core.js`), the Compare with backup field-by-field diff scoped to applications.json (`compare-core.js`), and the awaiting-response day-count/tier math behind the Applications table's Status column (`followup-core.js`); run after touching any of them
- `npm run test:dashboard` — the hub page's own regression tests for its staleness/grid-sort math (`dashboard-core.js`), graph layout/relation-curve collision math (`graph-core.js`), the Compare with backup field-by-field diff across all clusters (`compare-core.js`), and a drift guard cross-checking the service worker's offline app-shell list against every hub's real `<script src>`/local stylesheet `<link>` tags and real files (`sw-shell.test.js`); run after touching any of them
- `npm run test:server` — `server.js`'s own regression tests (`data/server-core.js`: chat-request validation, Anthropic error-shaping, and `parseValidateCounts`, the regex parser every hub's Data Quality badge depends on; `data/search-sources-core.js`: the real `/api/search` source list, shared with `public/data/search-core.test.js`'s own drift guard so the two can never fall out of sync); run after touching `server.js`'s request-validation/error-handling logic or the search source list
- `npm run test:sidebar`: regression tests for `sidebar-core.js`'s `escapeHtml`, the one script shared and injected on every page (index + all six hubs); run after touching that file

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

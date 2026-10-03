// Turns a CSV export from a real research spreadsheet into prospects.json,
// matching the schema documented in index.html's "How to log a real
// prospect" help. There is no backend to write to (Command Center's
// dashboards are static files), so this never saves anything on its own: it
// parses, maps, previews, validates against the exact same rules as
// validate.js (shared via CSMValidateCore.validateProspects so the two can
// never drift apart), and then hands back a file to download and save over
// public/csm/data/prospects.json by hand.
//
// Scoped to one dataset (prospects), unlike CGT's three-dataset importer:
// CSM only has one hand-edited file that benefits from a bulk CSV path.

// CSV parsing, cell coercion, and column-guessing are pure logic shared with
// a Node test; see data/import-core.js for the implementations.
const { csvField, parseCsv, guessMapping, buildRowFromMapping } = window.CSMImportCore;
const { slugifyProspectId } = window.CSMCore;
const { validateProspects } = window.CSMValidateCore;
const { emDashFields, hasLegacySocialSnapshotField } = window.CSMCore;

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function idGenerator(name, company) {
  return slugifyProspectId(name, company).id;
}

// One entry per real scalar prospect field (see index.html's "How to log a
// real prospect" table). `aliases` are normalized (lowercased, non-
// alphanumeric stripped) header names this tool will auto-map to that field
// without the user having to pick it by hand; a header that matches nothing
// gets left as "Ignore this column" instead of guessing. The five
// snap-prefixed fields build at most one socialSnapshots entry per row (see
// import-core.js's buildRowFromMapping); there is no column for
// stageHistory/outreachLog/contentIdeas, those are dated activity logs that
// only start once a prospect is actually in the pipeline.
const FIELD_DEFS = [
  { key: 'id', label: 'ID (optional, auto-generated from name + company if blank)', aliases: ['id', 'slug', 'uid'] },
  { key: 'name', label: 'Name', aliases: ['name', 'contactname', 'personname'] },
  { key: 'company', label: 'Company / brand', aliases: ['company', 'brand', 'account'] },
  { key: 'category', label: 'Category', aliases: ['category', 'niche', 'vertical'] },
  { key: 'stage', label: 'Stage (blank defaults to "researched")', aliases: ['stage'], type: 'stage' },
  { key: 'stageEnteredDate', label: 'Stage entered date', aliases: ['stageentereddate', 'dateentered'] },
  { key: 'verifiedHook', label: 'Verified hook (real reason this fits)', aliases: ['verifiedhook', 'hook'] },
  { key: 'channelType', label: 'Contact channel type (named decision-maker / generic inbox)', aliases: ['contactchanneltype', 'channeltype', 'contacttype'], type: 'channelType' },
  { key: 'channelDetail', label: 'Contact channel detail (the real email/handle)', aliases: ['contactchanneldetail', 'channeldetail', 'contactdetail', 'email'] },
  { key: 'sendDate', label: 'Send date', aliases: ['senddate', 'datesent'] },
  { key: 'nextNudgeDate', label: 'Next nudge date', aliases: ['nextnudgedate', 'nudgedate'] },
  { key: 'nextAction', label: 'Next action', aliases: ['nextaction'] },
  { key: 'doNotNudgeBefore', label: 'Do not nudge before', aliases: ['donotnudgebefore'] },
  { key: 'nudgePoint', label: 'Nudge point (planned, not yet committed)', aliases: ['nudgepoint'] },
  { key: 'replyStatus', label: 'Reply status', aliases: ['replystatus', 'status'] },
  { key: 'snapPlatform', label: 'Social snapshot: platform', aliases: ['platform', 'socialplatform'] },
  { key: 'snapFollowers', label: 'Social snapshot: followers', aliases: ['followers', 'followercount'], type: 'number' },
  { key: 'snapEngagementRate', label: 'Social snapshot: engagement rate (percent, e.g. 4.2)', aliases: ['engagementrate', 'engagement'], type: 'number' },
  { key: 'snapAsOfDate', label: 'Social snapshot: as-of date (when pulled)', aliases: ['asofdate', 'snapshotdate'] },
  { key: 'snapProfileUrl', label: 'Social snapshot: profile URL', aliases: ['profileurl', 'profilelink'] },
  { key: 'notes', label: 'Notes', aliases: ['notes', 'note'] }
];

const TEMPLATE_EXAMPLE = {
  name: 'Jane Doe', company: 'Example Co', category: 'Fitness influencer', stage: 'researched',
  verifiedHook: 'Runs a Douyin fitness account with real engagement in our niche.',
  snapPlatform: 'Douyin', snapFollowers: '85000', snapAsOfDate: '2026-09-12'
};

const PROSPECTS_FILE = '/csm/data/prospects.json';
const STAGES_FILE = '/csm/data/stages.json';
const EXAMPLE_ID = null; // prospects.json has no example-placeholder row convention; nothing to drop on import

let parsedHeaders = [];
let parsedDataRows = [];
let existingRealProspects = [];
let existingChecked = false;
let stages = [];
let existingSchemaVersion = 2;
let existingNote = 'Real pipeline data only. Fields left null are genuinely unlogged, not unknown-on-purpose placeholders.';

function loadExisting() {
  const statusEl = document.getElementById('existingStatus');
  statusEl.textContent = 'Checking ' + PROSPECTS_FILE + ' and ' + STAGES_FILE + '…';
  existingChecked = false;
  existingRealProspects = [];
  return Promise.all([
    fetch(PROSPECTS_FILE).then(res => { if (!res.ok) throw new Error('server returned ' + res.status); return res.json(); }),
    fetch(STAGES_FILE).then(res => { if (!res.ok) throw new Error('server returned ' + res.status); return res.json(); })
  ]).then(([prospectsData, stagesData]) => {
    existingRealProspects = (prospectsData.prospects || []).filter(p => p.id !== EXAMPLE_ID);
    stages = stagesData.stages || [];
    if (prospectsData.schemaVersion != null) existingSchemaVersion = prospectsData.schemaVersion;
    if (prospectsData.note) existingNote = prospectsData.note;
    existingChecked = true;
    statusEl.textContent = existingRealProspects.length
      ? existingRealProspects.length + ' existing real prospect(s) found in prospects.json. They will be ' +
        'combined with whatever you import below.'
      : 'No real prospects logged in prospects.json yet. Your import will become the whole file.';
  }).catch(e => {
    existingChecked = false;
    statusEl.textContent = "Couldn't load the current prospects.json/stages.json (" + e.message + '). You can ' +
      'still import, but the download below will contain only what you import here (and validation against ' +
      'real stage ids will be skipped), nothing merged in from the existing file.';
  });
}

document.getElementById('downloadTemplateBtn').addEventListener('click', () => {
  const header = FIELD_DEFS.map(f => f.key).join(',');
  const example = FIELD_DEFS.map(f => csvField(TEMPLATE_EXAMPLE[f.key] || '')).join(',');
  const csv = header + '\n' + example + '\n';
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'csm-prospect-import-template.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

document.getElementById('csvFile').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => { document.getElementById('csvPaste').value = String(reader.result || ''); };
  reader.readAsText(file);
});

function showParseError(msg) {
  const el = document.getElementById('parseError');
  if (!msg) { el.hidden = true; el.textContent = ''; return; }
  el.hidden = false;
  el.textContent = msg;
}

document.getElementById('parseBtn').addEventListener('click', () => {
  const text = document.getElementById('csvPaste').value;
  showParseError(null);
  if (!text.trim()) { showParseError('Paste some CSV text or choose a file first.'); return; }

  const rows = parseCsv(text);
  if (rows.length < 1) { showParseError('Could not find any rows in that CSV.'); return; }
  parsedHeaders = rows[0].map(h => h.trim());
  parsedDataRows = rows.slice(1);
  if (!parsedDataRows.length) { showParseError('Found a header row but no data rows under it.'); return; }

  renderMappingStep();
  document.getElementById('mappingStep').hidden = false;
  document.getElementById('previewStep').hidden = false;
  document.getElementById('validateStep').hidden = false;
  document.getElementById('downloadStep').hidden = false;
  runPipeline();
});

function renderMappingStep() {
  const guesses = guessMapping(parsedHeaders, FIELD_DEFS);
  const grid = document.getElementById('mappingGrid');
  const options = '<option value="">(ignore this column)</option>' +
    FIELD_DEFS.map(f => `<option value="${f.key}">${escapeHtml(f.label)}</option>`).join('');
  grid.innerHTML = parsedHeaders.map((h, idx) => `
    <div class="mapping-row">
      <span class="mapping-source font-mono">${escapeHtml(h || '(blank header)')}</span>
      <span class="mapping-arrow">&rarr;</span>
      <select class="mapping-select font-mono" data-col="${idx}">${options}</select>
    </div>
  `).join('');
  grid.querySelectorAll('.mapping-select').forEach((sel, idx) => {
    sel.value = guesses[idx] || '';
    sel.addEventListener('change', runPipeline);
  });
}

function currentMapping() {
  const map = {};
  document.querySelectorAll('.mapping-select').forEach(sel => {
    const field = sel.value;
    if (field) map[Number(sel.getAttribute('data-col'))] = field;
  });
  return map;
}

let lastMergedProspects = [];
let lastImportedCount = 0;

function runPipeline() {
  const mapping = currentMapping();
  const usedIds = new Set(existingRealProspects.map(p => p.id));
  const imported = parsedDataRows.map(row => buildRowFromMapping(row, mapping, usedIds, FIELD_DEFS, idGenerator));
  lastImportedCount = imported.length;
  lastMergedProspects = existingRealProspects.concat(imported);

  renderPreview(mapping, imported);
  renderValidation(lastMergedProspects);
}

// Preview shows the flat mapped columns plus a synthetic "social snapshot"
// column when any snap-prefixed field was mapped, since that group builds
// into one nested object a row-per-mapped-field preview would otherwise
// split across several confusingly-named columns.
function renderPreview(mapping, imported) {
  const mappedKeys = new Set(Object.values(mapping));
  const cols = FIELD_DEFS.filter(f => mappedKeys.has(f.key) && !f.key.startsWith('snap'));
  const hasSnapshot = FIELD_DEFS.some(f => f.key.startsWith('snap') && mappedKeys.has(f.key));
  const head = document.getElementById('previewHead');
  const body = document.getElementById('previewBody');
  const summary = document.getElementById('previewSummary');

  summary.textContent = imported.length + ' row(s) parsed' +
    (cols.length || hasSnapshot ? ', showing the mapped column(s) below' : ', map at least one column above to see a preview') +
    '. Full preview, not truncated, since a research-pass import is a few dozen to a few hundred rows, not thousands.';

  if (!cols.length && !hasSnapshot) { head.innerHTML = ''; body.innerHTML = ''; return; }

  head.innerHTML = cols.map(f => `<th scope="col">${escapeHtml(f.label)}</th>`).join('') +
    (hasSnapshot ? '<th scope="col">Social snapshot</th>' : '');
  body.innerHTML = imported.map(r => {
    const cells = cols.map(f => {
      const v = f.key === 'channelType' || f.key === 'channelDetail' ? r.contactChannel[f.key === 'channelType' ? 'type' : 'detail']
        : f.key === 'doNotNudgeBefore' || f.key === 'nudgePoint' ? r.nudgeSchedule[f.key]
        : r[f.key];
      return `<td>${v != null ? escapeHtml(String(v)) : '<span class="cell-value empty">null</span>'}</td>`;
    });
    if (hasSnapshot) {
      const snap = r.socialSnapshots[0];
      cells.push(`<td>${snap ? escapeHtml(snap.platform + (snap.followers != null ? ', ' + snap.followers + ' followers' : '') + (snap.asOfDate ? ' as of ' + snap.asOfDate : '')) : '<span class="cell-value empty">none</span>'}</td>`);
    }
    return `<tr>${cells.join('')}</tr>`;
  }).join('');
}

function renderValidation(mergedProspects) {
  const { errors, warnings } = validateProspects(mergedProspects, stages, { emDashFields, hasLegacySocialSnapshotField });
  const el = document.getElementById('validationResults');
  let html = '';
  if (!errors.length && !warnings.length) {
    html = '<p class="import-validation-ok">No errors or warnings. Every stage id is real, every date parses, ' +
      'no duplicate ids.</p>';
  } else {
    if (errors.length) {
      html += `<div class="import-validation-box import-validation-errors">
        <div class="import-validation-title">${errors.length} error(s), must fix before downloading</div>
        <ul>${errors.map(e => `<li>${escapeHtml(e)}</li>`).join('')}</ul>
      </div>`;
    }
    if (warnings.length) {
      html += `<div class="import-validation-box import-validation-warnings">
        <div class="import-validation-title">${warnings.length} warning(s), won't block the download</div>
        <ul>${warnings.map(w => `<li>${escapeHtml(w)}</li>`).join('')}</ul>
      </div>`;
    }
  }
  el.innerHTML = html;

  const downloadBtn = document.getElementById('downloadJsonBtn');
  const downloadSummary = document.getElementById('downloadSummary');
  const downloadHelp = document.getElementById('downloadHelp');
  downloadBtn.disabled = errors.length > 0;
  downloadHelp.innerHTML = 'Save the downloaded file over <code class="inline-code">public/csm/data/prospects.json</code>, ' +
    'then run <code class="inline-code">node public/csm/data/validate.js</code> one more time from a real checkout ' +
    'as a final check before committing it.';
  downloadSummary.textContent = errors.length
    ? 'Fix the error(s) above (by adjusting the column mapping, or editing the CSV and re-parsing) before downloading.'
    : (existingChecked ? existingRealProspects.length + ' existing + ' : '') + lastImportedCount +
      ' imported = ' + mergedProspects.length + ' real prospect(s) total in the downloaded file.';
}

document.getElementById('downloadJsonBtn').addEventListener('click', () => {
  if (document.getElementById('downloadJsonBtn').disabled) return;
  const json = JSON.stringify({ schemaVersion: existingSchemaVersion, note: existingNote, prospects: lastMergedProspects }, null, 2) + '\n';
  const blob = new Blob([json], { type: 'application/json;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'prospects.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

loadExisting();

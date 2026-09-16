// Turns a CSV export from the real (external) card tracker file into
// cards.json, submissions.json, or candidates.json, matching whichever
// schema is documented in index.html. There is no backend to write to
// (Command Center's dashboards are static files), so this never saves
// anything on its own: it parses, maps, previews, validates against the
// exact same rules as validate.js (shared via validate-core.js so the two
// never drift apart), and then hands back a file to download and save over
// the matching file under public/cgt/data/ by hand.
//
// All three datasets share one pipeline (parse -> map -> preview -> validate
// -> download); only the schema-specific bits (field list, id shape, which
// file to merge against, which validate-core function to call) vary, and
// those live in DATASETS below rather than three near-duplicate copies of
// this file.

function normalizeHeader(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeBasis(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (!v) return null;
  if (v === 'recent-sale' || v === 'recent sale' || v === 'sale' || v === 'sold') return 'recent-sale';
  if (v === 'comp-estimate' || v === 'comp estimate' || v === 'estimate' || v === 'comp') return 'comp-estimate';
  return v; // left as-is so an unrecognized value shows up as a validation error, not a silent guess
}

// Applied per-field on the way from a raw trimmed CSV cell to the value that
// goes into the downloaded JSON. Kept generic (rather than one bespoke
// builder function per dataset) since the same handful of coercions
// (number, whole number, uppercase, lowercase, valuation basis) cover every
// field across all three schemas.
function coerceField(value, type) {
  if (value == null) return null;
  switch (type) {
    case 'number': {
      const n = Number(String(value).replace(/[$,]/g, ''));
      return Number.isNaN(n) ? null : n;
    }
    case 'int': {
      const n = Number(String(value).replace(/[$,]/g, ''));
      return Number.isNaN(n) ? null : Math.round(n);
    }
    case 'upper': return String(value).toUpperCase();
    case 'lower': return String(value).toLowerCase();
    case 'basis': return normalizeBasis(value);
    default: return value;
  }
}

function slugify(s, fallback) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || (fallback || 'row');
}

function csvField(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// One entry per real schema field (see index.html's "How to log a real
// card"/"submission"/"candidate" tables). `aliases` are normalized
// (lowercased, non-alphanumeric stripped) header names this tool will
// auto-map to that field without the user having to pick it by hand; a
// header that matches nothing gets left as "Ignore this column" instead of
// guessing. `type` drives coerceField above; omitted means plain trimmed text.
const DATASETS = {
  cards: {
    noun: 'card',
    file: '/cgt/data/cards.json',
    listKey: 'cards',
    exampleId: 'example-row-not-real',
    idFields: ['cardName', 'year', 'gradingCompany', 'grade'],
    idFallback: 'card',
    validate: rows => window.CGTValidateCore.validateCards(rows),
    templateExample: { cardName: '2021 Topps Chrome Julio Rodriguez RC', year: '2021', sport: 'baseball', gradingCompany: 'PSA', grade: '10' },
    fieldDefs: [
      { key: 'id', label: 'ID (optional, auto-generated if blank)', aliases: ['id', 'slug', 'uid'] },
      { key: 'cardName', label: 'Card name', aliases: ['cardname', 'card', 'name', 'description', 'title'] },
      { key: 'year', label: 'Year', aliases: ['year', 'cardyear'], type: 'number' },
      { key: 'sport', label: 'Sport', aliases: ['sport', 'category'], type: 'lower' },
      { key: 'gradingCompany', label: 'Grading company', aliases: ['gradingcompany', 'grader', 'grading', 'company'], type: 'upper' },
      { key: 'grade', label: 'Grade', aliases: ['grade'] },
      { key: 'certNumber', label: 'Cert number', aliases: ['certnumber', 'cert', 'certno', 'serial', 'serialnumber'] },
      { key: 'storageLocation', label: 'Storage location', aliases: ['storagelocation', 'location', 'storage', 'box', 'binder', 'safe'] },
      { key: 'estimatedValue', label: 'Estimated value', aliases: ['estimatedvalue', 'value', 'price', 'estvalue', 'estimate'], type: 'number' },
      { key: 'valuationBasis', label: 'Valuation basis', aliases: ['valuationbasis', 'basis'], type: 'basis' },
      { key: 'compNote', label: 'Comp note', aliases: ['compnote'] },
      { key: 'sourceNote', label: 'Source', aliases: ['sourcenote', 'source'] },
      { key: 'costBasis', label: 'Cost basis (what was paid)', aliases: ['costbasis', 'paid', 'pricepaid', 'cost'], type: 'number' },
      { key: 'datePriced', label: 'Date priced', aliases: ['datepriced', 'date'] },
      { key: 'soldDate', label: 'Sold date (blank if still owned)', aliases: ['solddate', 'datesold'] },
      { key: 'soldPrice', label: 'Sold price', aliases: ['soldprice', 'saleprice'], type: 'number' },
      { key: 'backlogBatch', label: 'Backlog batch', aliases: ['backlogbatch', 'batch'] },
      { key: 'notes', label: 'Notes', aliases: ['notes', 'note'] }
    ]
  },
  submissions: {
    noun: 'submission',
    file: '/cgt/data/submissions.json',
    listKey: 'submissions',
    exampleId: 'example-submission-not-real',
    idFields: ['description', 'gradingCompany', 'submittedDate'],
    idFallback: 'submission',
    validate: rows => window.CGTValidateCore.validateSubmissions(rows),
    templateExample: { description: '12 cards, 2021 hockey rookies', gradingCompany: 'PSA', serviceLevel: 'Regular', cardCount: '12', submittedDate: '2026-08-08', status: 'submitted' },
    fieldDefs: [
      { key: 'id', label: 'ID (optional, auto-generated if blank)', aliases: ['id', 'slug', 'uid'] },
      { key: 'description', label: 'Description', aliases: ['description', 'desc', 'batch', 'batchdescription'] },
      { key: 'gradingCompany', label: 'Grading company', aliases: ['gradingcompany', 'grader', 'grading', 'company'], type: 'upper' },
      { key: 'serviceLevel', label: 'Service level', aliases: ['servicelevel', 'service', 'tier'] },
      { key: 'cardCount', label: 'Card count', aliases: ['cardcount', 'cards', 'count', 'numcards', 'numberofcards'], type: 'int' },
      { key: 'submittedDate', label: 'Submitted date', aliases: ['submitteddate', 'submitted', 'dateshipped', 'shippeddate', 'date'] },
      { key: 'trackingNumber', label: 'Tracking number', aliases: ['trackingnumber', 'tracking', 'trackingno'] },
      { key: 'status', label: 'Status', aliases: ['status'], type: 'lower' },
      { key: 'returnedDate', label: 'Returned date', aliases: ['returneddate', 'returned', 'datereturned'] },
      { key: 'cost', label: 'Cost (grading fee)', aliases: ['cost', 'fee', 'price', 'totalcost'], type: 'number' },
      { key: 'notes', label: 'Notes', aliases: ['notes', 'note'] }
    ]
  },
  candidates: {
    noun: 'candidate',
    file: '/cgt/data/candidates.json',
    listKey: 'candidates',
    exampleId: 'example-candidate-not-real',
    idFields: ['cardName', 'year', 'targetGradingCompany'],
    idFallback: 'candidate',
    idSuffix: '-raw', // matches the documented convention (e.g. "2022-upper-deck-rookie-raw"), only for an auto-generated id, never applied to an explicit id column
    validate: rows => window.CGTValidateCore.validateCandidates(rows),
    templateExample: { cardName: '2022 Upper Deck Rookie', year: '2022', sport: 'hockey', targetGradingCompany: 'PSA', targetServiceLevel: 'Regular' },
    fieldDefs: [
      { key: 'id', label: 'ID (optional, auto-generated if blank)', aliases: ['id', 'slug', 'uid'] },
      { key: 'cardName', label: 'Card name', aliases: ['cardname', 'card', 'name', 'description', 'title'] },
      { key: 'year', label: 'Year', aliases: ['year', 'cardyear'], type: 'number' },
      { key: 'sport', label: 'Sport', aliases: ['sport', 'category'], type: 'lower' },
      { key: 'rawValue', label: 'Raw value (ungraded, now)', aliases: ['rawvalue', 'raw', 'rawprice'], type: 'number' },
      { key: 'rawValueBasis', label: 'Raw value basis', aliases: ['rawvaluebasis', 'rawbasis'], type: 'basis' },
      { key: 'rawValueNote', label: 'Raw value note', aliases: ['rawvaluenote', 'rawnote'] },
      { key: 'targetGradingCompany', label: 'Target grading company', aliases: ['targetgradingcompany', 'grader', 'gradingcompany', 'company'], type: 'upper' },
      { key: 'targetServiceLevel', label: 'Target service level', aliases: ['targetservicelevel', 'servicelevel', 'service', 'tier'] },
      { key: 'estimatedGradingCost', label: 'Estimated grading cost', aliases: ['estimatedgradingcost', 'gradingcost', 'fee', 'servicecost'], type: 'number' },
      { key: 'shippingCost', label: 'Shipping cost', aliases: ['shippingcost', 'shipping'], type: 'number' },
      { key: 'expectedGrade', label: 'Expected grade', aliases: ['expectedgrade', 'expected'] },
      { key: 'expectedGradedValue', label: 'Expected graded value', aliases: ['expectedgradedvalue', 'gradedvalue', 'expectedvalue'], type: 'number' },
      { key: 'gradedValueBasis', label: 'Graded value basis', aliases: ['gradedvaluebasis', 'gradedbasis'], type: 'basis' },
      { key: 'gradedValueNote', label: 'Graded value note', aliases: ['gradedvaluenote', 'gradednote'] },
      { key: 'datePriced', label: 'Date priced', aliases: ['datepriced', 'date'] },
      { key: 'decision', label: 'Decision', aliases: ['decision'], type: 'lower' },
      { key: 'decisionNote', label: 'Decision note', aliases: ['decisionnote'] },
      { key: 'notes', label: 'Notes', aliases: ['notes', 'note'] }
    ]
  }
};

function currentDataset() {
  const key = document.querySelector('#datasetPicker .chip[aria-pressed="true"]').getAttribute('data-dataset');
  return DATASETS[key];
}

// Minimal RFC4180-ish CSV parser: handles quoted fields, doubled quotes
// inside a quoted field, commas/newlines inside quotes, and both \n and
// \r\n line endings. Good enough for a spreadsheet export; not a full CSV
// grammar (e.g. no support for a BOM beyond stripping one at the very start).
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const len = text.length;
  while (i < len) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ',') { row.push(field); field = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += ch; i++;
  }
  row.push(field);
  if (row.length > 1 || row[0] !== '') rows.push(row);
  return rows.filter(r => r.length > 1 || (r[0] || '').trim() !== '');
}

let parsedHeaders = [];
let parsedDataRows = [];
let existingRealRows = [];
let existingChecked = false;

function existingFileLabel(dataset) {
  return 'public/cgt/data/' + dataset.file.split('/').pop();
}

function loadExisting() {
  const dataset = currentDataset();
  const statusEl = document.getElementById('existingStatus');
  const fileLabel = existingFileLabel(dataset);
  statusEl.textContent = 'Checking ' + fileLabel + '…';
  existingChecked = false;
  existingRealRows = [];
  return fetch(dataset.file)
    .then(res => {
      if (!res.ok) throw new Error('server returned ' + res.status);
      return res.json();
    })
    .then(data => {
      // A dataset switch can race an in-flight fetch from the previously
      // selected one; only apply this result if it's still current.
      if (currentDataset() !== dataset) return;
      const all = data[dataset.listKey] || [];
      existingRealRows = all.filter(r => r.id !== dataset.exampleId);
      existingChecked = true;
      statusEl.textContent = existingRealRows.length
        ? existingRealRows.length + ' existing real ' + dataset.noun + '(s) found in ' + fileLabel + '. They ' +
          'will be combined with whatever you import below (the example placeholder row is dropped ' +
          'automatically either way).'
        : 'No real ' + dataset.noun + '(s) logged in ' + fileLabel + ' yet (only the example placeholder row, ' +
          'if that). Your import will become the whole file.';
    })
    .catch(e => {
      if (currentDataset() !== dataset) return;
      existingChecked = false;
      statusEl.textContent = "Couldn't load the current " + fileLabel + ' (' + e.message + '). You can still ' +
        'import, but the download below will contain only what you import here, nothing merged in from the ' +
        'existing file.';
    });
}

document.getElementById('downloadTemplateBtn').addEventListener('click', () => {
  const dataset = currentDataset();
  const header = dataset.fieldDefs.map(f => f.key).join(',');
  const example = dataset.fieldDefs.map(f => csvField(dataset.templateExample[f.key] || '')).join(',');
  const csv = header + '\n' + example + '\n';
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'cgt-' + dataset.noun + '-import-template.csv';
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

// One <select> per detected CSV column, defaulted to whichever schema field's
// alias list matches that header (normalized), each field usable at most
// once as an auto-guess so two similarly-named columns don't both silently
// land on the same field. The user can still point any column at any field,
// including a field another column was auto-mapped to, by hand.
function guessMapping(dataset) {
  const used = new Set();
  return parsedHeaders.map(h => {
    const norm = normalizeHeader(h);
    const match = dataset.fieldDefs.find(f => !used.has(f.key) && f.aliases.includes(norm));
    if (match) used.add(match.key);
    return match ? match.key : '';
  });
}

function renderMappingStep() {
  const dataset = currentDataset();
  const guesses = guessMapping(dataset);
  const grid = document.getElementById('mappingGrid');
  const options = '<option value="">(ignore this column)</option>' +
    dataset.fieldDefs.map(f => `<option value="${f.key}">${escapeHtml(f.label)}</option>`).join('');
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

// Turns one raw CSV row into a row object matching the current dataset's
// schema, using the current column mapping. Blank cells become null, not
// empty strings, so they read the same as a hand-edited "leave it null"
// entry rather than looking like a deliberately-empty value.
function buildRowFromMapping(row, mapping, usedIds, dataset) {
  const raw = {};
  Object.entries(mapping).forEach(([colIdx, field]) => {
    const v = (row[Number(colIdx)] ?? '').trim();
    raw[field] = v === '' ? null : v;
  });

  const built = {};
  dataset.fieldDefs.forEach(f => {
    if (f.key === 'id') return; // resolved below, after every other field is coerced
    built[f.key] = coerceField(raw[f.key], f.type);
  });

  let id = raw.id
    ? slugify(raw.id, dataset.idFallback)
    : slugify(dataset.idFields.map(k => built[k]).filter(Boolean).join('-'), dataset.idFallback) + (dataset.idSuffix || '');
  let uniqueId = id;
  let n = 2;
  while (usedIds.has(uniqueId)) { uniqueId = id + '-' + n; n++; }
  usedIds.add(uniqueId);

  return Object.assign({ id: uniqueId }, built);
}

let lastMergedRows = [];
let lastImportedCount = 0;

function runPipeline() {
  const dataset = currentDataset();
  const mapping = currentMapping();
  const usedIds = new Set(existingRealRows.map(r => r.id));
  const imported = parsedDataRows.map(row => buildRowFromMapping(row, mapping, usedIds, dataset));
  lastImportedCount = imported.length;
  lastMergedRows = existingRealRows.concat(imported);

  renderPreview(dataset, mapping, imported);
  renderValidation(dataset, lastMergedRows);
}

function renderPreview(dataset, mapping, imported) {
  const cols = dataset.fieldDefs.filter(f => Object.values(mapping).includes(f.key));
  const head = document.getElementById('previewHead');
  const body = document.getElementById('previewBody');
  const summary = document.getElementById('previewSummary');

  summary.textContent = imported.length + ' row(s) parsed' +
    (cols.length ? ', showing the ' + cols.length + ' mapped column(s) below' : ', map at least one column above to see a preview') +
    '. Full preview, not truncated, since a backlog pass is a few dozen to a few hundred rows, not thousands.';

  if (!cols.length) { head.innerHTML = ''; body.innerHTML = ''; return; }

  head.innerHTML = cols.map(f => `<th>${escapeHtml(f.label)}</th>`).join('');
  body.innerHTML = imported.map(r => `
    <tr>${cols.map(f => `<td class="cell-muted">${r[f.key] != null ? escapeHtml(String(r[f.key])) : '<span class="cell-value empty">null</span>'}</td>`).join('')}</tr>
  `).join('');
}

function renderValidation(dataset, mergedRows) {
  const { errors, warnings } = dataset.validate(mergedRows);
  const el = document.getElementById('validationResults');
  let html = '';
  if (!errors.length && !warnings.length) {
    html = '<p class="import-validation-ok">No errors or warnings. Every row that needs a labeled valuation ' +
      'basis has one, no duplicate ids.</p>';
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

  const fileName = dataset.file.split('/').pop();
  const downloadBtn = document.getElementById('downloadJsonBtn');
  const downloadSummary = document.getElementById('downloadSummary');
  const downloadHelp = document.getElementById('downloadHelp');
  downloadBtn.disabled = errors.length > 0;
  downloadBtn.textContent = 'Download ' + fileName;
  downloadHelp.innerHTML = 'Save the downloaded file over <code class="inline-code">public/cgt/data/' +
    fileName + '</code>, then run <code class="inline-code">node public/cgt/data/validate.js</code> one more ' +
    'time from a real checkout as a final check before committing it.';
  downloadSummary.textContent = errors.length
    ? 'Fix the error(s) above (by adjusting the column mapping, or editing the CSV and re-parsing) before downloading.'
    : (existingChecked ? existingRealRows.length + ' existing + ' : '') + lastImportedCount +
      ' imported = ' + mergedRows.length + ' real ' + dataset.noun + '(s) total in the downloaded file.';
}

document.getElementById('downloadJsonBtn').addEventListener('click', () => {
  if (document.getElementById('downloadJsonBtn').disabled) return;
  const dataset = currentDataset();
  const json = JSON.stringify({ [dataset.listKey]: lastMergedRows }, null, 2) + '\n';
  const blob = new Blob([json], { type: 'application/json;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = dataset.file.split('/').pop();
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

// Switching dataset mid-flow would otherwise leave a stale mapping/preview/
// validation/download built against the previous schema sitting on screen
// (or worse, let someone download e.g. a submissions.json shaped file with
// the cards download filename). Simplest correct behavior: hide every step
// past the picker and make them re-parse, same as loading the page fresh.
function resetPipelineForDatasetSwitch() {
  parsedHeaders = [];
  parsedDataRows = [];
  lastMergedRows = [];
  lastImportedCount = 0;
  showParseError(null);
  document.getElementById('mappingStep').hidden = true;
  document.getElementById('previewStep').hidden = true;
  document.getElementById('validateStep').hidden = true;
  document.getElementById('downloadStep').hidden = true;
  loadExisting();
}

document.querySelectorAll('#datasetPicker .chip').forEach(chip => {
  chip.addEventListener('click', () => {
    if (chip.getAttribute('aria-pressed') === 'true') return;
    document.querySelectorAll('#datasetPicker .chip').forEach(c => c.setAttribute('aria-pressed', 'false'));
    chip.setAttribute('aria-pressed', 'true');
    resetPipelineForDatasetSwitch();
  });
});

loadExisting();

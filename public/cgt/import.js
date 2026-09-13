// Turns a CSV export from the real (external) card tracker file into a
// cards.json matching the schema documented in index.html. There is no
// backend to write to (Command Center's dashboards are static files), so
// this never saves anything on its own: it parses, maps, previews, validates
// against the exact same rules as validate.js (shared via validate-core.js
// so the two never drift apart), and then hands back a file to download and
// save over public/cgt/data/cards.json by hand.

const { validateCards } = window.CGTValidateCore;

// One entry per real schema field (see index.html's "How to log a real
// card" table). `aliases` are normalized (lowercased, non-alphanumeric
// stripped) header names this tool will auto-map to that field without the
// user having to pick it by hand; a header that matches nothing gets left
// as "Ignore this column" instead of guessing.
const FIELD_DEFS = [
  { key: 'id', label: 'ID (optional, auto-generated if blank)', aliases: ['id', 'slug', 'uid'] },
  { key: 'cardName', label: 'Card name', aliases: ['cardname', 'card', 'name', 'description', 'title'] },
  { key: 'year', label: 'Year', aliases: ['year', 'cardyear'] },
  { key: 'sport', label: 'Sport', aliases: ['sport', 'category'] },
  { key: 'gradingCompany', label: 'Grading company', aliases: ['gradingcompany', 'grader', 'grading', 'company'] },
  { key: 'grade', label: 'Grade', aliases: ['grade'] },
  { key: 'certNumber', label: 'Cert number', aliases: ['certnumber', 'cert', 'certno', 'serial', 'serialnumber'] },
  { key: 'storageLocation', label: 'Storage location', aliases: ['storagelocation', 'location', 'storage', 'box', 'binder', 'safe'] },
  { key: 'estimatedValue', label: 'Estimated value', aliases: ['estimatedvalue', 'value', 'price', 'estvalue', 'estimate'] },
  { key: 'valuationBasis', label: 'Valuation basis', aliases: ['valuationbasis', 'basis'] },
  { key: 'compNote', label: 'Comp note', aliases: ['compnote'] },
  { key: 'sourceNote', label: 'Source', aliases: ['sourcenote', 'source'] },
  { key: 'costBasis', label: 'Cost basis (what was paid)', aliases: ['costbasis', 'paid', 'pricepaid', 'cost'] },
  { key: 'datePriced', label: 'Date priced', aliases: ['datepriced', 'date'] },
  { key: 'backlogBatch', label: 'Backlog batch', aliases: ['backlogbatch', 'batch'] },
  { key: 'notes', label: 'Notes', aliases: ['notes', 'note'] }
];

function normalizeHeader(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
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

function csvField(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'card';
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

let parsedHeaders = [];
let parsedDataRows = [];
let existingRealCards = [];
let existingChecked = false;

async function loadExisting() {
  const statusEl = document.getElementById('existingStatus');
  try {
    const res = await fetch('/cgt/data/cards.json');
    if (!res.ok) throw new Error('server returned ' + res.status);
    const data = await res.json();
    const all = data.cards || [];
    existingRealCards = all.filter(c => c.id !== 'example-row-not-real');
    existingChecked = true;
    statusEl.textContent = existingRealCards.length
      ? existingRealCards.length + ' existing real card(s) found in cards.json. They will be combined with ' +
        'whatever you import below (the example placeholder row is dropped automatically either way).'
      : 'No real cards logged in cards.json yet (only the example placeholder row, if that). Your import will ' +
        'become the whole file.';
  } catch (e) {
    existingChecked = false;
    statusEl.textContent = "Couldn't load the current cards.json (" + e.message + "). You can still import, but " +
      'the download below will contain only what you import here, nothing merged in from the existing file.';
  }
}

// Built by field key rather than a hand-typed positional list, so adding or
// reordering a field in FIELD_DEFS can't silently leave the example row one
// column short (or a value under the wrong header) the way a plain array of
// values lined up by hand would.
const TEMPLATE_EXAMPLE_ROW = {
  cardName: '2021 Topps Chrome Julio Rodriguez RC', year: '2021', sport: 'baseball', gradingCompany: 'PSA', grade: '10'
};

document.getElementById('downloadTemplateBtn').addEventListener('click', () => {
  const header = FIELD_DEFS.map(f => f.key).join(',');
  const example = FIELD_DEFS.map(f => csvField(TEMPLATE_EXAMPLE_ROW[f.key] || '')).join(',');
  const csv = header + '\n' + example + '\n';
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'cgt-import-template.csv';
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
function guessMapping() {
  const used = new Set();
  return parsedHeaders.map(h => {
    const norm = normalizeHeader(h);
    const match = FIELD_DEFS.find(f => !used.has(f.key) && f.aliases.includes(norm));
    if (match) used.add(match.key);
    return match ? match.key : '';
  });
}

function renderMappingStep() {
  const guesses = guessMapping();
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

function normalizeBasis(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (!v) return null;
  if (v === 'recent-sale' || v === 'recent sale' || v === 'sale' || v === 'sold') return 'recent-sale';
  if (v === 'comp-estimate' || v === 'comp estimate' || v === 'estimate' || v === 'comp') return 'comp-estimate';
  return v; // left as-is so an unrecognized value shows up as a validation error, not a silent guess
}

// Turns one raw CSV row into a card object using the current column
// mapping. Blank cells become null, not empty strings, so they read the
// same as a hand-edited "leave it null" entry rather than looking like a
// deliberately-empty value.
function buildCardFromRow(row, mapping, usedIds) {
  const raw = {};
  Object.entries(mapping).forEach(([colIdx, field]) => {
    const v = (row[Number(colIdx)] ?? '').trim();
    raw[field] = v === '' ? null : v;
  });

  const year = raw.year != null ? Number(raw.year) : null;
  const estimatedValue = raw.estimatedValue != null ? Number(String(raw.estimatedValue).replace(/[$,]/g, '')) : null;
  const costBasis = raw.costBasis != null ? Number(String(raw.costBasis).replace(/[$,]/g, '')) : null;
  const gradingCompany = raw.gradingCompany != null ? raw.gradingCompany.toUpperCase() : null;
  const sport = raw.sport != null ? raw.sport.toLowerCase() : null;
  const valuationBasis = normalizeBasis(raw.valuationBasis);

  let id = raw.id ? slugify(raw.id) : slugify([raw.cardName, year, gradingCompany, raw.grade].filter(Boolean).join('-'));
  let uniqueId = id;
  let n = 2;
  while (usedIds.has(uniqueId)) { uniqueId = id + '-' + n; n++; }
  usedIds.add(uniqueId);

  return {
    id: uniqueId,
    cardName: raw.cardName || null,
    year: (year != null && !Number.isNaN(year)) ? year : null,
    sport,
    gradingCompany,
    grade: raw.grade || null,
    certNumber: raw.certNumber || null,
    storageLocation: raw.storageLocation || null,
    estimatedValue: (estimatedValue != null && !Number.isNaN(estimatedValue)) ? estimatedValue : null,
    valuationBasis,
    compNote: raw.compNote || null,
    sourceNote: raw.sourceNote || null,
    costBasis: (costBasis != null && !Number.isNaN(costBasis)) ? costBasis : null,
    datePriced: raw.datePriced || null,
    backlogBatch: raw.backlogBatch || null,
    notes: raw.notes || null
  };
}

let lastMergedCards = [];
let lastImportedCount = 0;

function runPipeline() {
  const mapping = currentMapping();
  const usedIds = new Set(existingRealCards.map(c => c.id));
  const imported = parsedDataRows.map(row => buildCardFromRow(row, mapping, usedIds));
  lastImportedCount = imported.length;
  lastMergedCards = existingRealCards.concat(imported);

  renderPreview(mapping, imported);
  renderValidation(lastMergedCards);
}

function renderPreview(mapping, imported) {
  const cols = FIELD_DEFS.filter(f => Object.values(mapping).includes(f.key));
  const head = document.getElementById('previewHead');
  const body = document.getElementById('previewBody');
  const summary = document.getElementById('previewSummary');

  summary.textContent = imported.length + ' row(s) parsed' +
    (cols.length ? ', showing the ' + cols.length + ' mapped column(s) below' : ', map at least one column above to see a preview') +
    '. Full preview, not truncated, since a backlog pass is a few dozen to a few hundred cards, not thousands.';

  if (!cols.length) { head.innerHTML = ''; body.innerHTML = ''; return; }

  head.innerHTML = cols.map(f => `<th>${escapeHtml(f.label)}</th>`).join('');
  body.innerHTML = imported.map(c => `
    <tr>${cols.map(f => `<td class="cell-muted">${c[f.key] != null ? escapeHtml(String(c[f.key])) : '<span class="cell-value empty">null</span>'}</td>`).join('')}</tr>
  `).join('');
}

function renderValidation(mergedCards) {
  const { errors, warnings } = validateCards(mergedCards);
  const el = document.getElementById('validationResults');
  let html = '';
  if (!errors.length && !warnings.length) {
    html = '<p class="import-validation-ok">No errors or warnings. Every priced row has a labeled valuation basis, no duplicate ids or cert numbers.</p>';
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
  downloadBtn.disabled = errors.length > 0;
  downloadSummary.textContent = errors.length
    ? 'Fix the error(s) above (by adjusting the column mapping, or editing the CSV and re-parsing) before downloading.'
    : (existingChecked ? existingRealCards.length + ' existing + ' : '') + lastImportedCount +
      ' imported = ' + mergedCards.length + ' real card(s) total in the downloaded file.';
}

document.getElementById('downloadJsonBtn').addEventListener('click', () => {
  if (document.getElementById('downloadJsonBtn').disabled) return;
  const json = JSON.stringify({ cards: lastMergedCards }, null, 2) + '\n';
  const blob = new Blob([json], { type: 'application/json;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'cards.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

loadExisting();

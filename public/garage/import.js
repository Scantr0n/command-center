// Turns a CSV export (a cross-listing tool's inventory export, an eBay
// Seller Hub "Active listings" download, or a hand-kept spreadsheet of the
// Depop drafts backlog) into listings.json's "listings" array. There is no
// backend to write to (Command Center's dashboards are static files), so
// this never saves anything on its own: it parses, maps, previews,
// validates against the exact same rules as validate.js (shared via
// GarageValidateCore.validateListings so the two can never drift apart),
// and then hands back a file to download and save over
// public/garage/data/listings.json by hand.
//
// Scoped to one dataset (listings), same as CSM's and Job Search's own
// single-dataset importers. soldOn and listingUrls always come out empty/{},
// the same "hasn't sold or posted anywhere yet" rule the Quick Log tool on
// the main page already follows for a brand-new listing.

// CSV parsing, cell coercion, and column-guessing are pure logic shared with
// a Node test; see data/import-core.js for the implementations.
const { csvField, parseCsv, guessMapping, buildRowFromMapping } = window.GarageImportCore;
const { validateListings } = window.GarageValidateCore;

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// One entry per real scalar/flat listing field (see index.html's "How this
// hub is kept up to date" table for the full real schema). `aliases` are
// normalized (lowercased, non-alphanumeric stripped) header names this tool
// will auto-map to that field without the user having to pick it by hand; a
// header that matches nothing gets left as "Ignore this column" instead of
// guessing. "platforms" accepts more than one platform per cell (comma,
// semicolon, pipe, or slash separated, see parsePlatformList in
// import-core.js), the one real list field this schema has that none of the
// other three hubs' importers needed to handle.
const FIELD_DEFS = [
  { key: 'title', label: 'Title', aliases: ['title', 'itemname', 'name'] },
  { key: 'price', label: 'Asking price, USD', aliases: ['price', 'askingprice', 'currentprice'], type: 'number' },
  { key: 'costBasis', label: 'Cost basis, USD (what it was paid for)', aliases: ['costbasis', 'cost', 'cogs'], type: 'number' },
  { key: 'category', label: 'eBay category (shoes / electronics / blank for standard)', aliases: ['category'], type: 'category' },
  { key: 'platforms', label: 'Platforms (one cell, comma/semicolon/pipe/slash separated, e.g. "ebay, poshmark")', aliases: ['platforms', 'platform'], type: 'platformList' },
  { key: 'status', label: 'Status (blank defaults to "ready-to-post")', aliases: ['status'], type: 'status' },
  { key: 'datePublished', label: 'Date published (leave blank until actually live)', aliases: ['datepublished', 'publisheddate', 'datelisted'] },
  { key: 'location', label: 'Storage location, e.g. "Bin 3"', aliases: ['location', 'storagelocation', 'bin'] },
  { key: 'ebayReturnPolicy', label: 'eBay return policy (only if listed on eBay)', aliases: ['ebayreturnpolicy', 'returnpolicy'] },
  { key: 'handlingTimeDays', label: 'eBay handling time, business days 1-30 (only if listed on eBay)', aliases: ['handlingtimedays', 'handlingtime'], type: 'int' },
  { key: 'brand', label: 'Item specifics: brand', aliases: ['brand'] },
  { key: 'size', label: 'Item specifics: size (shoes only)', aliases: ['size'] },
  { key: 'color', label: 'Item specifics: color (shoes only)', aliases: ['color'] },
  { key: 'condition', label: 'Item specifics: condition', aliases: ['condition'] },
  { key: 'notes', label: 'Notes', aliases: ['notes'] }
];

const TEMPLATE_EXAMPLE = {
  title: 'Haggar Corduroy Pants', price: '28', category: '', platforms: 'depop',
  status: 'ready-to-post', brand: 'Haggar', condition: 'Pre-owned'
};

const LISTINGS_FILE = '/garage/data/listings.json';

let parsedHeaders = [];
let parsedDataRows = [];
let existingData = null;
let existingRealListings = [];
let existingChecked = false;

function loadExisting() {
  const statusEl = document.getElementById('existingStatus');
  statusEl.textContent = 'Checking ' + LISTINGS_FILE + '…';
  existingChecked = false;
  existingRealListings = [];
  return fetch(LISTINGS_FILE)
    .then(res => { if (!res.ok) throw new Error('server returned ' + res.status); return res.json(); })
    .then(data => {
      existingData = data;
      existingRealListings = data.listings || [];
      existingChecked = true;
      statusEl.textContent = existingRealListings.length
        ? existingRealListings.length + ' existing real listing(s) found in listings.json. They will be ' +
          'combined with whatever you import below.'
        : 'No real listings logged in listings.json yet. Your import will become the whole listings array.';
    })
    .catch(e => {
      existingChecked = false;
      existingData = null;
      statusEl.textContent = "Couldn't load the current listings.json (" + e.message + '). You can still ' +
        'import, but the download below will contain only what you import here.';
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
  a.download = 'garage-listings-import-template.csv';
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

let lastMergedListings = [];
let lastImportedCount = 0;

function runPipeline() {
  const mapping = currentMapping();
  const usedIds = new Set(existingRealListings.map(l => l.id).filter(Boolean));
  const imported = parsedDataRows.map(row => buildRowFromMapping(row, mapping, usedIds, FIELD_DEFS));
  lastImportedCount = imported.length;
  lastMergedListings = existingRealListings.concat(imported);

  renderPreview(mapping, imported);
  renderValidation(lastMergedListings);
}

function previewValue(row, key) {
  if (key === 'platforms') return row.platforms.length ? row.platforms.join(', ') : null;
  if (['brand', 'size', 'color', 'condition'].includes(key)) return row.itemSpecifics[key];
  return row[key];
}

function renderPreview(mapping, imported) {
  const cols = FIELD_DEFS.filter(f => Object.values(mapping).includes(f.key));
  const head = document.getElementById('previewHead');
  const body = document.getElementById('previewBody');
  const summary = document.getElementById('previewSummary');

  summary.textContent = imported.length + ' row(s) parsed' +
    (cols.length ? ', showing the ' + cols.length + ' mapped column(s) below' : ', map at least one column above to see a preview') +
    '. Full preview, not truncated, since a bulk import batch is a handful to a few dozen rows, not thousands.';

  if (!cols.length) { head.innerHTML = ''; body.innerHTML = ''; return; }

  head.innerHTML = '<th scope="col">id</th>' + cols.map(f => `<th scope="col">${escapeHtml(f.label)}</th>`).join('');
  body.innerHTML = imported.map(r => `
    <tr><td>${escapeHtml(r.id)}</td>${cols.map(f => {
      const v = previewValue(r, f.key);
      return `<td>${v != null ? escapeHtml(String(v)) : '<span class="cell-value empty">null</span>'}</td>`;
    }).join('')}</tr>
  `).join('');
}

function renderValidation(mergedListings) {
  const { errors, warnings } = validateListings(mergedListings);
  const el = document.getElementById('validationResults');
  let html = '';
  if (!errors.length && !warnings.length) {
    html = '<p class="import-validation-ok">No errors or warnings. Every row has a real title and a known, ' +
      'non-empty set of platforms, no duplicate ids, nothing left inherited from the auto-parts return policy ' +
      'bug.</p>';
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
  downloadHelp.innerHTML = 'Save the downloaded file over <code class="inline-code">public/garage/data/listings.json</code>, ' +
    'then run <code class="inline-code">node public/garage/data/validate.js</code> one more time from a real ' +
    'checkout as a final check before committing it.';
  downloadSummary.textContent = errors.length
    ? 'Fix the error(s) above (by adjusting the column mapping, or editing the CSV and re-parsing) before downloading.'
    : (existingChecked ? existingRealListings.length + ' existing + ' : '') + lastImportedCount +
      ' imported = ' + mergedListings.length + ' real listing(s) total in the downloaded file.';
}

document.getElementById('downloadJsonBtn').addEventListener('click', () => {
  if (document.getElementById('downloadJsonBtn').disabled) return;
  const base = existingData || {};
  const json = JSON.stringify(Object.assign({}, base, { listings: lastMergedListings }), null, 2) + '\n';
  const blob = new Blob([json], { type: 'application/json;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'listings.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

loadExisting();

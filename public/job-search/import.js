// Turns a CSV export (e.g. a saved-jobs list exported from a job board, or a
// hand-kept spreadsheet of postings applied to) into applications.json's
// "applications" array. There is no backend to write to (Command Center's
// dashboards are static files), so this never saves anything on its own: it
// parses, maps, previews, validates against the exact same rules as
// validate.js (shared via JobSearchValidateCore.validateApplications so the
// two can never drift apart), and then hands back a file to download and
// save over public/job-search/data/applications.json by hand.
//
// Scoped to one dataset (applications), same as CSM's own single-dataset
// importer: dropped/skipped/savedCount are real hand-maintained notes and a
// last-known count, not bulk-import material, so they're carried through
// from the existing file untouched rather than exposed as import columns.

// CSV parsing, cell coercion, and column-guessing are pure logic shared with
// a Node test; see data/import-core.js for the implementations.
const { csvField, parseCsv, guessMapping, buildRowFromMapping } = window.JobSearchImportCore;
const { validateApplications } = window.JobSearchValidateCore;

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// One entry per real scalar application field (see index.html's "How this
// hub is kept up to date" table). `aliases` are normalized (lowercased,
// non-alphanumeric stripped) header names this tool will auto-map to that
// field without the user having to pick it by hand; a header that matches
// nothing gets left as "Ignore this column" instead of guessing. There is
// no column for "num": see import-core.js's buildRowFromMapping for why it
// is always assigned, never read off the CSV.
const FIELD_DEFS = [
  { key: 'role', label: 'Role', aliases: ['role', 'title', 'position', 'jobtitle'] },
  { key: 'company', label: 'Company', aliases: ['company', 'employer', 'organization'] },
  { key: 'location', label: 'Location', aliases: ['location', 'loc', 'city'] },
  { key: 'pay', label: 'Pay (real quoted figure, or a direct quote if that\'s all the posting says)', aliases: ['pay', 'salary', 'compensation', 'wage', 'rate'] },
  { key: 'appliedDate', label: 'Applied date (when actually submitted)', aliases: ['applieddate', 'dateapplied', 'date', 'submitteddate'] },
  { key: 'status', label: 'Status (blank unless an employer has actually responded)', aliases: ['status'], type: 'status' }
];

const TEMPLATE_EXAMPLE = {
  role: 'Marketing Intern', company: 'Acme Co', location: 'NY (Remote)', pay: '$20/hr', appliedDate: '2026-09-15'
};

const APPLICATIONS_FILE = '/job-search/data/applications.json';

let parsedHeaders = [];
let parsedDataRows = [];
let existingData = null;
let existingRealApplications = [];
let existingChecked = false;

function loadExisting() {
  const statusEl = document.getElementById('existingStatus');
  statusEl.textContent = 'Checking ' + APPLICATIONS_FILE + '…';
  existingChecked = false;
  existingRealApplications = [];
  return fetch(APPLICATIONS_FILE)
    .then(res => { if (!res.ok) throw new Error('server returned ' + res.status); return res.json(); })
    .then(data => {
      existingData = data;
      existingRealApplications = data.applications || [];
      existingChecked = true;
      statusEl.textContent = existingRealApplications.length
        ? existingRealApplications.length + ' existing real application(s) found in applications.json. They ' +
          'will be combined with whatever you import below (dropped, skipped, and savedCount are carried ' +
          'through untouched).'
        : 'No real applications logged in applications.json yet. Your import will become the whole applications list.';
    })
    .catch(e => {
      existingChecked = false;
      existingData = null;
      statusEl.textContent = "Couldn't load the current applications.json (" + e.message + '). You can still ' +
        'import, but the download below will contain only what you import here, with no dropped/skipped/' +
        'savedCount carried through, and new "num"s will start at 1.';
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
  a.download = 'job-search-application-import-template.csv';
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

let lastMergedApplications = [];
let lastImportedCount = 0;

function runPipeline() {
  const mapping = currentMapping();
  const usedNums = new Set(existingRealApplications
    .map(a => a.num)
    .filter(n => typeof n === 'number'));
  const imported = parsedDataRows.map(row => buildRowFromMapping(row, mapping, FIELD_DEFS, usedNums));
  lastImportedCount = imported.length;
  lastMergedApplications = existingRealApplications.concat(imported);

  renderPreview(mapping, imported);
  renderValidation(lastMergedApplications);
}

function renderPreview(mapping, imported) {
  const cols = FIELD_DEFS.filter(f => Object.values(mapping).includes(f.key));
  const head = document.getElementById('previewHead');
  const body = document.getElementById('previewBody');
  const summary = document.getElementById('previewSummary');

  summary.textContent = imported.length + ' row(s) parsed' +
    (cols.length ? ', showing the ' + cols.length + ' mapped column(s) below' : ', map at least one column above to see a preview') +
    '. Full preview, not truncated, since a saved-jobs batch is a handful to a few dozen rows, not thousands.';

  if (!cols.length) { head.innerHTML = ''; body.innerHTML = ''; return; }

  head.innerHTML = '<th scope="col">#</th>' + cols.map(f => `<th scope="col">${escapeHtml(f.label)}</th>`).join('');
  body.innerHTML = imported.map(r => `
    <tr><td>${r.num}</td>${cols.map(f => `<td>${r[f.key] != null ? escapeHtml(String(r[f.key])) : '<span class="cell-value empty">null</span>'}</td>`).join('')}</tr>
  `).join('');
}

function renderValidation(mergedApplications) {
  const { errors, warnings } = validateApplications(mergedApplications, window.JobSearchFollowupCore.STATUS_LABELS);
  const el = document.getElementById('validationResults');
  let html = '';
  if (!errors.length && !warnings.length) {
    html = '<p class="import-validation-ok">No errors or warnings. Every row has a real role, company, ' +
      'location, and pay, no duplicate "num"s.</p>';
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
  downloadHelp.innerHTML = 'Save the downloaded file over <code class="inline-code">public/job-search/data/applications.json</code>, ' +
    'then run <code class="inline-code">node public/job-search/data/validate.js</code> one more time from a ' +
    'real checkout as a final check before committing it.';
  downloadSummary.textContent = errors.length
    ? 'Fix the error(s) above (by adjusting the column mapping, or editing the CSV and re-parsing) before downloading.'
    : (existingChecked ? existingRealApplications.length + ' existing + ' : '') + lastImportedCount +
      ' imported = ' + mergedApplications.length + ' real application(s) total in the downloaded file.';
}

document.getElementById('downloadJsonBtn').addEventListener('click', () => {
  if (document.getElementById('downloadJsonBtn').disabled) return;
  // dropped/skipped/savedCount are real hand-maintained notes this importer
  // never touches; carried through from whatever actually loaded so the
  // download is a drop-in replacement for the whole file, not just the
  // applications array. Falls back to an honest empty shape if the existing
  // file never loaded, same as CSM's own download button falling back to a
  // bare schemaVersion/note/prospects shape.
  const base = existingData || { dropped: [], skipped: [], savedCount: { count: 0, asOfDate: null, note: null } };
  const json = JSON.stringify(Object.assign({}, base, { applications: lastMergedApplications }), null, 2) + '\n';
  const blob = new Blob([json], { type: 'application/json;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'applications.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

loadExisting();

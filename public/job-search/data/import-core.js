/*
 * Pure CSV-parsing and row-building logic for the Job Search applications
 * importer, pulled out of import.js so it can be required directly from a
 * Node test (import-core.test.js) without loading the rest of the
 * importer's DOM-touching code. Same reasoning as CGT's and CSM's own
 * data/import-core.js, which this file's shape deliberately matches.
 *
 * applications.json's only flat schema (num, role, company, location, pay,
 * appliedDate, optional status) is the simplest of the six hubs', so unlike
 * CSM's nested contactChannel/nudgeSchedule/socialSnapshots or CGT's three
 * separate datasets, this is a single flat field list with no nested-object
 * building. The one real difference from both: the id here is "num", a
 * plain auto-incrementing integer (not a slugified string), so
 * buildRowFromMapping below assigns the next free integer past whatever
 * real rows (existing plus already-imported-this-batch) it's handed, the
 * exact same rule the "Quick log a new application" tool in app.js already
 * uses for a single row.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.JobSearchImportCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  function normalizeHeader(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function csvField(v) {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  // Minimal RFC4180-ish CSV parser: handles quoted fields, doubled quotes
  // inside a quoted field, commas/newlines inside quotes, and both \n and
  // \r\n line endings. Good enough for a spreadsheet export; not a full CSV
  // grammar. Same implementation as CGT's and CSM's own parseCsv, kept as a
  // separate copy rather than a shared file since no hub's import tool is
  // allowed to depend on another's files.
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

  // One mapping choice per detected CSV column, defaulted to whichever
  // schema field's alias list matches that header (normalized), each field
  // usable at most once as an auto-guess so two similarly-named columns
  // don't both silently land on the same field.
  function guessMapping(headers, fieldDefs) {
    const used = new Set();
    return headers.map(h => {
      const norm = normalizeHeader(h);
      const match = fieldDefs.find(f => !used.has(f.key) && f.aliases.includes(norm));
      if (match) used.add(match.key);
      return match ? match.key : '';
    });
  }

  function normalizeStatus(raw) {
    const v = String(raw || '').trim().toLowerCase();
    return v || null; // left as-is (not silently dropped) when unrecognized, so an unreal status shows up as a validation error, not a silent guess
  }

  // "num" is an auto-incrementing integer, not a slugified string, so it
  // can't reuse CGT's/CSM's own string-id generator. Mutates usedNums (a
  // Set, seeded by the caller with every real existing application's own
  // num) so a multi-row import assigns a run of distinct free numbers
  // instead of every row racing for the same "current max + 1", the same
  // real bug a naive per-row (max+1) without a running Set would produce.
  function nextAvailableNum(usedNums) {
    let max = 0;
    usedNums.forEach(n => { if (n > max) max = n; });
    const next = max + 1;
    usedNums.add(next);
    return next;
  }

  // Turns one raw CSV row into an application object matching
  // applications.json's real schema, using the current column mapping
  // ({ colIndex: fieldKey }). Blank cells become null, not empty strings,
  // including the four fields the real schema always writes as a string
  // (role/company/location/pay): a hand-exported job-board CSV routinely
  // leaves one of those blank for a posting with no stated pay or location,
  // and leaving it null here (rather than coercing to '') lets
  // validateApplications flag it as a real missing field, the same error a
  // hand-edit with a blank value would get, instead of a silently-accepted
  // empty string. "num" is resolved separately (nextAvailableNum above),
  // never read from a mapped column: a hand-exported CSV has no idea what
  // this tracker's own next free number is.
  function buildRowFromMapping(row, mapping, fieldDefs, usedNums) {
    const raw = {};
    Object.entries(mapping).forEach(([colIdx, field]) => {
      const v = (row[Number(colIdx)] ?? '').trim();
      raw[field] = v === '' ? null : v;
    });

    const built = { num: nextAvailableNum(usedNums) };
    fieldDefs.forEach(f => {
      const v = raw[f.key] ?? null;
      built[f.key] = f.type === 'status' ? normalizeStatus(v) : v;
    });
    return built;
  }

  return {
    normalizeHeader, normalizeStatus, nextAvailableNum, csvField, parseCsv, guessMapping, buildRowFromMapping
  };
});

/*
 * Pure CSV-parsing and row-building logic pulled out of import.js so it can
 * be required directly from a Node test (import-core.test.js) without
 * loading the rest of the importer's DOM-touching code. Same reasoning as
 * grading-core.js and validate-core.js in this same folder: one copy of the
 * real rule, usable from both the browser (import.js, via
 * window.CGTImportCore) and a plain Node test. This is the exact class of
 * risk the rest of the repo already extracts into a tested core module,
 * and it already caused one real, shipped bug (BGS subgrade columns
 * silently dropped on a CSV round-trip) before this file existed.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CGTImportCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
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

  // Applied per-field on the way from a raw trimmed CSV cell to the value
  // that goes into the downloaded JSON. Kept generic (rather than one
  // bespoke builder function per dataset) since the same handful of
  // coercions (number, whole number, uppercase, lowercase, valuation basis)
  // cover every field across all three schemas.
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

  // One mapping choice per detected CSV column, defaulted to whichever
  // schema field's alias list matches that header (normalized), each field
  // usable at most once as an auto-guess so two similarly-named columns
  // don't both silently land on the same field. `dataset` only needs a
  // `fieldDefs` array ({ key, aliases }); the caller can still point any
  // column at any field, including one another column was auto-mapped to,
  // by hand afterward.
  function guessMapping(headers, dataset) {
    const used = new Set();
    return headers.map(h => {
      const norm = normalizeHeader(h);
      const match = dataset.fieldDefs.find(f => !used.has(f.key) && f.aliases.includes(norm));
      if (match) used.add(match.key);
      return match ? match.key : '';
    });
  }

  // Turns one raw CSV row into a row object matching the current dataset's
  // schema, using the current column mapping ({ colIndex: fieldKey }).
  // Blank cells become null, not empty strings, so they read the same as a
  // hand-edited "leave it null" entry rather than looking like a
  // deliberately-empty value. Mutates `usedIds` to keep generated ids unique
  // across the whole imported batch (and against any pre-existing real rows
  // the caller seeded it with).
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

  return {
    normalizeHeader, normalizeBasis, coerceField, slugify, csvField,
    parseCsv, guessMapping, buildRowFromMapping
  };
});

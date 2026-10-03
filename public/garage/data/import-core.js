/*
 * Pure CSV-parsing and row-building logic for the Garage listings importer,
 * pulled out of import.js so it can be required directly from a Node test
 * (import-core.test.js) without loading the rest of the importer's DOM-
 * touching code. Same reasoning as CGT's, CSM's, and Job Search's own
 * data/import-core.js files, which this file's shape deliberately
 * matches: one copy of the real CSV parsing/mapping rule, usable from both
 * the browser (import.js, via window.GarageImportCore) and a plain Node
 * test.
 *
 * A Garage listing has one nested object (itemSpecifics.brand/size/color/
 * condition, the same shape CSM's contactChannel/nudgeSchedule already
 * established a pattern for) and one real list field (platforms), which
 * none of the other three hubs' importers needed to handle: unlike a job
 * application or a graded card, a listing is only real inventory once it's
 * actually live or ready to post on a known set of real marketplaces, so a
 * bulk import (e.g. the 48-item Depop drafts backlog) has to be able to set
 * more than one platform per row. platforms is read from a single
 * delimited cell (comma, semicolon, pipe, or slash separated, e.g. "ebay,
 * poshmark"), normalized the same way CSM's normalizeStage/normalizeChannelType
 * leave an unrecognized token as-is rather than silently dropping it, so a
 * typo'd platform name shows up as a real validateListings error instead of
 * disappearing. soldOn and listingUrls are never populated here, same as
 * the "Quick log a new listing" form on the main page: a freshly imported
 * row hasn't sold or been posted anywhere yet.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GarageImportCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  function normalizeHeader(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  // Mirrors app.js's own slugifyForListingId exactly (lowercase, non-
  // alphanumeric runs collapsed to one hyphen, leading/trailing hyphens
  // trimmed, 60-char cap, "item" fallback), so an id generated here for a
  // row with no id column reads exactly like one the Quick Log tool would
  // have generated for the same title.
  function slugifyForListingId(title) {
    return String(title || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'item';
  }

  // Left as-is (not silently dropped) when unrecognized, same reasoning as
  // every other normalize* function in this repo's import-core.js files: an
  // unreal platform name shows up as a validateListings error, never a
  // silent guess.
  function normalizePlatform(raw) {
    const v = String(raw || '').trim().toLowerCase();
    if (v === 'ebay') return 'ebay';
    if (v === 'vinted') return 'vinted';
    if (v === 'poshmark' || v === 'posh') return 'poshmark';
    if (v === 'depop') return 'depop';
    return v;
  }

  // One cell can list more than one platform (e.g. "ebay, poshmark" or
  // "ebay/vinted/depop"), the real shape a bulk-exported cross-listing
  // backlog needs: comma, semicolon, pipe, and slash are all real
  // delimiters a hand-kept spreadsheet is likely to actually use.
  function parsePlatformList(raw) {
    const v = String(raw || '').trim();
    if (!v) return [];
    return v.split(/[,;|/]+/).map(s => s.trim()).filter(Boolean).map(normalizePlatform);
  }

  function normalizeStatus(raw) {
    const v = String(raw || '').trim().toLowerCase().replace(/[_\s]+/g, '-');
    if (!v) return 'ready-to-post'; // a freshly bulk-imported row is, by definition, not live or sold yet
    if (v === 'draft') return 'draft';
    if (v === 'ready-to-post' || v === 'readytopost' || v === 'ready') return 'ready-to-post';
    if (v === 'live' || v === 'active' || v === 'published') return 'live';
    if (v === 'sold') return 'sold';
    return v;
  }

  function normalizeCategory(raw) {
    const v = String(raw || '').trim().toLowerCase();
    if (!v) return null;
    if (v === 'shoes' || v === 'shoe' || v === 'boots') return 'shoes';
    if (v === 'electronics' || v === 'electronic') return 'electronics';
    return v;
  }

  // Applied per-field on the way from a raw trimmed CSV cell to the value
  // that goes into the built listing. Blank stays null at the call site
  // (buildRowFromMapping), not here, same split CGT's/CSM's own coerceField
  // use.
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
      case 'status': return normalizeStatus(value);
      case 'category': return normalizeCategory(value);
      case 'platformList': return parsePlatformList(value);
      default: return value;
    }
  }

  function csvField(v) {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  // Minimal RFC4180-ish CSV parser: handles quoted fields, doubled quotes
  // inside a quoted field, commas/newlines inside quotes, and both \n and
  // \r\n line endings. Good enough for a spreadsheet export; not a full CSV
  // grammar. Same implementation as CGT's/CSM's/Job Search's own parseCsv,
  // kept as a separate copy rather than a shared file since no hub's import
  // tool is allowed to depend on another's files.
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

  // Turns one raw CSV row into a listing object matching listings.json's
  // real schema, using the current column mapping ({ colIndex: fieldKey }).
  // Blank cells become null, not empty strings, so they read the same as a
  // hand-edited "leave it null" entry rather than looking deliberately
  // empty. itemSpecifics.* fields are built from their own flat field keys;
  // soldOn and listingUrls always come out empty/{}, the same "hasn't sold
  // or posted anywhere yet" rule the Quick Log tool's own output follows.
  // id generation reuses slugifyForListingId above (the exact rule app.js's
  // own Quick Log tool uses for a single row), never a different generator.
  // Mutates usedIds to keep generated ids unique across the whole imported
  // batch (and against any pre-existing real rows the caller seeded it
  // with).
  function buildRowFromMapping(row, mapping, usedIds, fieldDefs) {
    const raw = {};
    Object.entries(mapping).forEach(([colIdx, field]) => {
      const v = (row[Number(colIdx)] ?? '').trim();
      raw[field] = v === '' ? null : v;
    });

    const flat = {};
    fieldDefs.forEach(f => {
      if (f.key === 'id') return; // resolved below, after every other field is coerced
      flat[f.key] = coerceField(raw[f.key], f.type);
    });

    let id = raw.id ? slugifyForListingId(raw.id) : slugifyForListingId(flat.title);
    let uniqueId = id;
    let n = 2;
    while (usedIds.has(uniqueId)) { uniqueId = id + '-' + n; n++; }
    usedIds.add(uniqueId);

    return {
      id: uniqueId,
      title: flat.title,
      price: flat.price != null ? flat.price : null,
      costBasis: flat.costBasis != null ? flat.costBasis : null,
      category: flat.category,
      platforms: flat.platforms || [],
      soldOn: [],
      listingUrls: {},
      status: flat.status || 'ready-to-post',
      datePublished: flat.datePublished,
      notes: flat.notes,
      location: flat.location,
      ebayReturnPolicy: flat.ebayReturnPolicy,
      handlingTimeDays: flat.handlingTimeDays != null ? flat.handlingTimeDays : null,
      itemSpecifics: {
        brand: flat.brand,
        size: flat.size,
        color: flat.color,
        condition: flat.condition
      }
    };
  }

  return {
    normalizeHeader, slugifyForListingId, normalizePlatform, parsePlatformList,
    normalizeStatus, normalizeCategory, coerceField, csvField, parseCsv,
    guessMapping, buildRowFromMapping
  };
});

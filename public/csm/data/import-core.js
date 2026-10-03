/*
 * Pure CSV-parsing and row-building logic for the CSM prospect importer,
 * pulled out of import.js so it can be required directly from a Node test
 * (import-core.test.js) without loading the rest of the importer's DOM-
 * touching code. Same reasoning as CGT's own public/cgt/data/import-core.js,
 * which this file's shape deliberately matches: one copy of the real CSV
 * parsing/mapping rule, usable from both the browser (import.js, via
 * window.CSMImportCore) and a plain Node test.
 *
 * Unlike CGT's cards/submissions/candidates (three flat schemas), a CSM
 * prospect has a handful of nested fields (contactChannel.type/detail,
 * nudgeSchedule.doNotNudgeBefore/nudgePoint) and several array fields
 * (socialSnapshots, contentIdeas, stageHistory, outreachLog) that only ever
 * get populated by real, dated activity after a prospect is already in the
 * pipeline, never guessed at import time. buildRowFromMapping below maps a
 * flat CSV row onto the nested scalar fields and leaves every array field as
 * [], except socialSnapshots: a research pass commonly already has one
 * platform's follower/engagement numbers in hand the moment a prospect is
 * first logged, so one optional snapshot column group is supported and
 * turned into a single real socialSnapshots entry when a platform is given.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CSMImportCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  function normalizeHeader(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  // Accepts a handful of real variants a hand-written research spreadsheet
  // is likely to actually use, left as-is (not silently dropped) when
  // unrecognized so it shows up as a validation error instead of a guess.
  function normalizeStage(raw) {
    const v = String(raw || '').trim().toLowerCase().replace(/[_\s]+/g, '-');
    if (!v) return 'researched'; // a freshly bulk-imported row is, by definition, researched-not-yet-contacted
    if (v === 'researched' || v === 'research' || v === 'new') return 'researched';
    if (v === 'outreach-sent' || v === 'outreachsent' || v === 'sent' || v === 'contacted') return 'outreach-sent';
    if (v === 'silent-replied' || v === 'silent' || v === 'replied' || v === 'silentreplied' || v === 'no-reply') return 'silent-replied';
    if (v === 'in-exploration' || v === 'exploring' || v === 'inexploration' || v === 'exploration') return 'in-exploration';
    if (v === 'client' || v === 'signed' || v === 'won') return 'client';
    return v;
  }

  function normalizeChannelType(raw) {
    const v = String(raw || '').trim().toLowerCase().replace(/[_\s]+/g, '-');
    if (!v) return null;
    if (v === 'named-decision-maker' || v === 'named' || v === 'decision-maker' || v === 'dm' || v === 'namedcontact') return 'named-decision-maker';
    if (v === 'generic-inbox' || v === 'generic' || v === 'inbox' || v === 'agency' || v === 'agency-inbox') return 'generic-inbox';
    return v;
  }

  // Applied per-field on the way from a raw trimmed CSV cell to the value
  // that goes into the downloaded JSON. Blank stays null at the call site
  // (buildRowFromMapping), not here, same split CGT's coerceField uses.
  function coerceField(value, type) {
    if (value == null) return null;
    switch (type) {
      case 'number': {
        const n = Number(String(value).replace(/[$,%]/g, ''));
        return Number.isNaN(n) ? null : n;
      }
      case 'stage': return normalizeStage(value);
      case 'channelType': return normalizeChannelType(value);
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
  // grammar. Same implementation as CGT's own parseCsv, kept as a separate
  // copy rather than a shared file since neither hub's import tool is
  // allowed to depend on the other's files.
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

  // Turns one raw CSV row into a prospect object matching prospects.json's
  // real schema, using the current column mapping ({ colIndex: fieldKey }).
  // Blank cells become null, not empty strings, so they read the same as a
  // hand-edited "leave it null" entry. Nested fields (contactChannel.*,
  // nudgeSchedule.*) are built from their own flat field keys below; every
  // array field is seeded empty except socialSnapshots, which gets exactly
  // one entry when a platform was actually given, never a guessed one.
  // Mutates usedIds to keep generated ids unique across the whole imported
  // batch (and against any pre-existing real rows the caller seeded it
  // with); id generation itself reuses CSMCore.slugifyProspectId/
  // nextAvailableId, the exact same generator the "Log new prospect" form
  // already uses, rather than a second, possibly-different slug rule.
  function buildRowFromMapping(row, mapping, usedIds, fieldDefs, idGenerator) {
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

    const base = idGenerator(flat.name, flat.company);
    let id = raw.id || base;
    let uniqueId = id;
    let n = 2;
    while (usedIds.has(uniqueId)) { uniqueId = id + '-' + n; n++; }
    usedIds.add(uniqueId);

    const socialSnapshots = [];
    if (flat.snapPlatform) {
      socialSnapshots.push({
        platform: flat.snapPlatform,
        followers: flat.snapFollowers != null ? flat.snapFollowers : null,
        engagementRate: flat.snapEngagementRate != null ? flat.snapEngagementRate : null,
        asOfDate: flat.snapAsOfDate || null,
        profileUrl: flat.snapProfileUrl || null
      });
    }

    return {
      id: uniqueId,
      name: flat.name,
      company: flat.company,
      category: flat.category,
      stage: flat.stage || 'researched',
      stageEnteredDate: flat.stageEnteredDate,
      verifiedHook: flat.verifiedHook,
      contactChannel: { type: flat.channelType, detail: flat.channelDetail },
      sendDate: flat.sendDate,
      nextNudgeDate: flat.nextNudgeDate,
      nextAction: flat.nextAction,
      nudgeSchedule: { doNotNudgeBefore: flat.doNotNudgeBefore, nudgePoint: flat.nudgePoint },
      replyStatus: flat.replyStatus,
      socialSnapshots,
      contentIdeas: [],
      stageHistory: [],
      outreachLog: [],
      notes: flat.notes
    };
  }

  return {
    normalizeHeader, normalizeStage, normalizeChannelType, coerceField, csvField,
    parseCsv, guessMapping, buildRowFromMapping
  };
});

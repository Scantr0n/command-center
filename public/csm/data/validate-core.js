/*
 * Pure validation-support rules for a CSM prospects array, with no Node-only
 * APIs (no fs/path), so the exact same rules run in two places: the CLI
 * validator (public/csm/data/validate.js, which reads prospects.json off disk
 * and calls this) and the dashboard's own "Possible duplicates" and "Casing
 * drift" panels (public/csm/app.js), which need the real prospect objects to
 * render clickable rows, not just a pre-formatted warning string. Keeping one
 * copy of the grouping logic means the two can never quietly drift apart, the
 * same reasoning CGT's own validate-core.js already documents.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CSMValidateCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  // Groups by name + company, case/whitespace-insensitive, to catch the same
  // person logged twice under two different ids (e.g. a copy-pasted "Log new
  // prospect" entry, whose only real uniqueness check is on id itself).
  // Returns every group with more than one member; a prospect with no name
  // is skipped rather than grouped under an empty key.
  function findDuplicateProspects(prospects) {
    const byKey = new Map();
    (prospects || []).forEach(p => {
      if (!p.name) return;
      const key = p.name.trim().toLowerCase() + '|' + (p.company || '').trim().toLowerCase();
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(p);
    });
    return [...byKey.values()].filter(group => group.length > 1);
  }

  // Generic normalize-and-group-by-lowercase check: the same free-text value
  // (a category, a social platform) spelled two different ways doesn't fail
  // validation on its own, both spellings are individually valid strings, but
  // it silently fragments whatever the dashboard groups or filters on that
  // field (category filter chips, platform search matching). getValues pulls
  // whichever raw string(s) off a prospect the caller cares about, so the
  // same function covers both category (one value per prospect) and
  // socialSnapshots[].platform (zero or more per prospect). Returns every
  // normalized bucket that actually contains more than one distinct spelling.
  function findCasingDrift(prospects, getValues) {
    const byNorm = new Map();
    (prospects || []).forEach(p => {
      // A multi-valued getValues (socialSnapshots[].platform: zero or more
      // per prospect) can hand back the same prospect's own two differently-
      // cased snapshots of the same real platform (a real re-pull relogged
      // under a slightly different spelling), which used to push that one
      // prospect into entry.prospects twice, once per raw value seen, not
      // once per prospect. The dashboard's own renderCasingDrift renders one
      // row per prospects[] entry with no dedup of its own, so that one
      // person rendered as two identical rows needing the same fix, an
      // inflated drift count for a single-valued field (category) could
      // never actually trigger, since each prospect only ever contributes at
      // most one raw value there.
      const addedForThisProspect = new Set();
      getValues(p).forEach(raw => {
        if (!raw) return;
        const norm = raw.trim().toLowerCase();
        if (!byNorm.has(norm)) byNorm.set(norm, { variants: new Map(), prospects: [] });
        const entry = byNorm.get(norm);
        entry.variants.set(raw, (entry.variants.get(raw) || 0) + 1);
        if (!addedForThisProspect.has(norm)) {
          addedForThisProspect.add(norm);
          entry.prospects.push(p);
        }
      });
    });
    return [...byNorm.values()].filter(entry => entry.variants.size > 1);
  }

  return { findDuplicateProspects, findCasingDrift };
});

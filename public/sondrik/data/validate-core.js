/*
 * Pure validation-support rules for the Sondrik leads array, with no
 * Node-only APIs (no fs/path), so the exact same rule runs in two places: the
 * CLI validator (public/sondrik/data/validate.js, which reads leads.json off
 * disk and calls this) and the dashboard's own leads feed (public/sondrik/
 * app.js), which needs the real lead objects to flag rows inline, not just a
 * pre-formatted warning string. Same shared-core pattern as CGT's, CSM's and
 * Garage's own validate-core.js, so the two can never quietly drift apart.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SondrikValidateCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  // Matches the duplicate check CGT/CSM/Garage each already run on their own
  // hand-maintained records, adapted to what actually identifies a real
  // contact here: the same channel plus the same source detail (free text
  // Jack writes, e.g. "Commenter on r/IMadeThis") is far more likely to be
  // one real person logged twice than a coincidence. Falls back to channel +
  // source + summary only when sourceDetail isn't set. Never groups on an
  // empty key, two unset fields matching each other isn't a real signal.
  function findDuplicateLeads(leads) {
    const byKey = new Map();
    (leads || []).forEach(l => {
      const channel = (l.channelId || '').trim().toLowerCase();
      const detail = (l.sourceDetail || '').trim().toLowerCase();
      const source = (l.source || '').trim().toLowerCase();
      const summary = (l.summary || '').trim().toLowerCase();
      const key = detail ? channel + '|' + detail : (source && summary ? channel + '|' + source + '|' + summary : null);
      if (!key) return;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(l);
    });
    return [...byKey.values()].filter(group => group.length > 1);
  }

  return { findDuplicateLeads };
});

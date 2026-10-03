/*
 * Pure diff between Alpha's real hand-maintained architecture facts
 * (status.json's system.* block: name, kind, host, agentCount, agentKind,
 * lastVerifiedAt, features[]) currently loaded in the browser and a
 * previously downloaded "Download backup (.json)" file (see app.js's
 * backupBtn handler for the exact shape that button writes:
 * { exportedAt, source, status, clientConnHistory, ... }).
 *
 * Scoped to system.* on purpose, not the whole backup: everything else under
 * status.live (regime, drawdown, positions, account, ...) is a live or
 * structurally-placeholder reading that changes on its own, every 30s,
 * with no hand-edit behind it, so diffing it against an old backup would
 * just report "changed" on nearly every field nearly every time, exactly
 * the noise the field-by-field pattern proven at CSM/Sondrik/CGT/Garage's
 * own Compare with backup exists to avoid. system.* is the one part of
 * this page's data that actually is hand-edited (see e.g. the real
 * 2026-09-19 commit that removed a stat here, or the 2026-09-16 one that
 * added robustnessScore), so it's the one part where "what did a hand-edit
 * actually change" is a real, answerable question.
 *
 * Same fieldValuesDiffer/diffByKey shape as Garage's compare-core.js
 * (public/garage/data/compare-core.js), reused directly rather than
 * reinvented; features[] is keyed by id the same way Garage keys its own
 * ten lists. No Node-only APIs, so the exact same function runs in the
 * browser (app.js's Compare with backup modal) and this file's own test
 * suite. Pure and read-only: this only ever reads the two objects it is
 * given, it never writes anything back to status.json.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.AlphaCompareCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  // undefined and null both mean "not set" across status.json's own
  // convention (see e.g. system.features[].note, which is null when a
  // feature has nothing extra to say), so they compare equal here rather
  // than flagging a field as changed just because one side's key was
  // omitted and the other's was explicitly null.
  // Plain JSON.stringify serializes object keys in insertion order, so an
  // object-valued field with the exact same keys/values in a different
  // order was reported as "changed" when nothing real changed, a real
  // false positive (verified against the hub page's own relationReasons
  // field, which shares this exact fieldValuesDiffer shape). stableStringify
  // sorts object keys (never array order/items, which stay meaningfully
  // ordered) before serializing so key order alone can never flip the diff
  // result.
  function stableStringify(value) {
    if (value === undefined) return 'undefined';
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
    const keys = Object.keys(value).filter(k => value[k] !== undefined).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
  }

  function fieldValuesDiffer(a, b) {
    const na = a === undefined ? null : a;
    const nb = b === undefined ? null : b;
    return stableStringify(na) !== stableStringify(nb);
  }

  function diffByKey(currentList, backupList, keyFn, fields) {
    const currentByKey = new Map();
    (currentList || []).forEach(item => {
      const key = item && keyFn(item);
      if (key) currentByKey.set(key, item);
    });
    const backupByKey = new Map();
    (backupList || []).forEach(item => {
      const key = item && keyFn(item);
      if (key) backupByKey.set(key, item);
    });
    const added = [];
    const removed = [];
    const changed = [];
    currentByKey.forEach((item, key) => {
      if (!backupByKey.has(key)) { added.push(item); return; }
      const prior = backupByKey.get(key);
      const changedFields = fields.filter(f => fieldValuesDiffer(item[f], prior[f]));
      if (changedFields.length) changed.push({ key, current: item, backup: prior, fields: changedFields });
    });
    backupByKey.forEach((item, key) => {
      if (!currentByKey.has(key)) removed.push(item);
    });
    return { added, removed, changed };
  }

  // A single record, not a list, so it gets its own scalar diff rather than
  // diffByKey (built for keyed lists, and system.* has no key to key by,
  // there is only ever one).
  const SYSTEM_SCALAR_FIELDS = ['name', 'kind', 'host', 'agentCount', 'agentKind', 'lastVerifiedAt'];
  function diffSystemScalars(current, backup) {
    return SYSTEM_SCALAR_FIELDS
      .filter(field => fieldValuesDiffer(current[field], backup[field]))
      .map(field => ({ field, current: current[field], backup: backup[field] }));
  }

  const FEATURE_FIELDS = ['label', 'note', 'pending'];

  // current is the same lastStatusData object app.js already keeps around
  // after its own loads (the real /api/alpha/live response); backupFile is
  // a backup file's parsed JSON. Throws a plain Error, meant to be shown to
  // the user as-is, if the file handed in was never produced by this page's
  // own backup button (a random JSON file has no real "before" state to
  // diff against).
  function compareWithBackup(current, backupFile) {
    if (!backupFile || typeof backupFile !== 'object' || !backupFile.status || !backupFile.status.system) {
      throw new Error('That file does not look like an Alpha backup (expected a status.system object). ' +
        'Use a file downloaded from this page’s "Download backup (.json)" button.');
    }
    const currentSystem = (current && current.system) || {};
    const backupSystem = backupFile.status.system || {};
    return {
      exportedAt: backupFile.exportedAt || null,
      systemFields: diffSystemScalars(currentSystem, backupSystem),
      features: diffByKey(currentSystem.features, backupSystem.features, f => f.id, FEATURE_FIELDS)
    };
  }

  return { fieldValuesDiffer, diffByKey, diffSystemScalars, compareWithBackup };
});

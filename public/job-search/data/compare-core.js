/*
 * Pure diff between Job Search's applications.json data currently loaded in
 * the browser and a previously downloaded "Download backup (.json)" file
 * (see app.js's backupBtn handler for the exact shape that button writes:
 * { exportedAt, source, applicationsJson, criteriaJson, nextUpJson,
 * digestLatestJson }). Scoped to applicationsJson on purpose, not the whole
 * backup: criteria.json/next-up.json/digest-latest.json are editorial
 * snapshots (running prose, standouts/highlights with no stable per-item
 * id) refreshed wholesale on each digest run rather than hand-edited field
 * by field, so a field-by-field diff of them would mostly just report
 * "changed" on nearly everything nearly every time, exactly the noise the
 * field-by-field pattern proven at CSM/Sondrik/CGT/Garage/Alpha's own
 * Compare with backup exists to avoid. applications.json is the one file
 * with real, individually hand-edited, stably-keyed records (applications
 * by num, dropped/skipped by company), the same kind of data every other
 * hub's Compare with backup already targets.
 *
 * Same fieldValuesDiffer/diffByKey shape as Garage's/Sondrik's/Alpha's/
 * CGT's compare-core.js, reused directly rather than reinvented. No
 * Node-only APIs, so the exact same function runs in the browser (app.js's
 * Compare with backup modal) and this file's own test suite. Pure and
 * read-only: this only ever reads the two objects it is given, it never
 * writes anything back to applications.json itself.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.JobSearchCompareCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  // undefined and null both mean "not set" across this schema (see e.g. a
  // dropped/skipped entry with no further reason), so they compare equal
  // here rather than flagging a field as changed just because one side's
  // key was omitted and the other's was explicitly null.
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

  const APPLICATION_FIELDS = ['role', 'company', 'location', 'pay', 'appliedDate', 'status'];
  const DROPPED_FIELDS = ['reason'];
  const SKIPPED_FIELDS = ['reason'];

  // savedCount has no key to key by, applications.json carries exactly one,
  // so it gets its own scalar diff rather than diffByKey.
  const SAVED_COUNT_FIELDS = ['count', 'asOfDate', 'note'];
  function diffSavedCount(current, backup) {
    return SAVED_COUNT_FIELDS
      .filter(field => fieldValuesDiffer(current[field], backup[field]))
      .map(field => ({ field, current: current[field], backup: backup[field] }));
  }

  // current is applications.json's own already-parsed shape (the real
  // rawApplicationsData app.js keeps around after its load); backupFile is
  // a backup file's parsed JSON. Throws a plain Error, meant to be shown to
  // the user as-is, if the file handed in was never produced by this page's
  // own backup button (a random JSON file has no real "before" state to
  // diff against).
  function compareWithBackup(current, backupFile) {
    if (!backupFile || typeof backupFile !== 'object' || !backupFile.applicationsJson) {
      throw new Error('That file does not look like a Job Search backup (expected an applicationsJson key). ' +
        'Use a file downloaded from this page’s "Download backup (.json)" button.');
    }
    const currentData = current || {};
    const backupData = backupFile.applicationsJson || {};
    return {
      exportedAt: backupFile.exportedAt || null,
      applications: diffByKey(currentData.applications, backupData.applications, a => a.num, APPLICATION_FIELDS),
      dropped: diffByKey(currentData.dropped, backupData.dropped, d => d.company, DROPPED_FIELDS),
      skipped: diffByKey(currentData.skipped, backupData.skipped, s => s.company, SKIPPED_FIELDS),
      savedCount: diffSavedCount(currentData.savedCount || {}, backupData.savedCount || {})
    };
  }

  return { fieldValuesDiffer, diffByKey, compareWithBackup };
});

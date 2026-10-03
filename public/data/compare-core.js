/*
 * Pure diff between the hub's own `clusters` array (what /api/clusters
 * currently serves, already merged with any live Drive snapshot) and a
 * previously downloaded "Backup" file (see index.html's backupBtn handler
 * for the exact shape that button writes: { exportedAt, source, clusters }).
 *
 * Every per-project hub (Alpha, CGT, CSM, Garage, Job Search, Sondrik) has
 * had a "Compare with backup" field-by-field diff for a while; the hub page
 * itself, the one Jack actually leaves open and the one Drive sync quietly
 * merges into, never had one; a bad hand-edit to data/clusters/*.json or an
 * unexpected Drive merge had no way to be caught except by eye. This closes
 * that gap, same fieldValuesDiffer/diffByKey shape as every other hub's own
 * compare-core.js, reused directly rather than reinvented.
 *
 * No Node-only APIs, so the exact same function runs in the browser (the
 * hub page's own Compare with backup modal) and this file's own test suite.
 * Pure and read-only: this only ever reads the two objects it is given, it
 * never writes anything back to any cluster file.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.DashboardCompareCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  // undefined and null both mean "not set" across this schema (e.g. a
  // cluster with no toggleId has no real `enabled` field at all), so they
  // compare equal here rather than flagging a field as changed just because
  // one side's key was omitted and the other's was explicitly null.
  // Plain JSON.stringify serializes object keys in insertion order, so an
  // object-valued field (relationReasons, keyed by related-cluster id) with
  // the exact same keys/values in a different order was reported as
  // "changed" when nothing real changed, a real false positive verified
  // against this file's own relationReasons shape. stableStringify sorts
  // object keys (never array order/items, which stay meaningfully ordered)
  // before serializing so key order alone can never flip the diff result.
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

  // Every real hand-edited or Drive-merged field a cluster carries today
  // (see data/clusters/*.json and server.js's /api/clusters enabled merge),
  // kept in sync by this file's own test guarding the full field list.
  const CLUSTER_FIELDS = [
    'name', 'category', 'priority', 'lastUpdate', 'summary', 'status',
    'sessionTitle', 'link', 'linkLabel', 'reliability', 'relatedTo',
    'relationReasons', 'toggleable', 'toggleId', 'enabled'
  ];

  // current is the hub's own already-loaded `clusters` array; backupFile is
  // a backup file's parsed JSON. Throws a plain Error, meant to be shown to
  // the user as-is, if the file handed in was never produced by this page's
  // own backup button (a random JSON file has no real "before" state to
  // diff against).
  function compareWithBackup(currentClusters, backupFile) {
    if (!backupFile || typeof backupFile !== 'object' || !Array.isArray(backupFile.clusters)) {
      throw new Error('That file does not look like a Command Center backup (expected a clusters array). ' +
        'Use a file downloaded from this page’s "Backup" button.');
    }
    return {
      exportedAt: backupFile.exportedAt || null,
      clusters: diffByKey(currentClusters, backupFile.clusters, c => c.id, CLUSTER_FIELDS)
    };
  }

  return { fieldValuesDiffer, diffByKey, CLUSTER_FIELDS, compareWithBackup };
});

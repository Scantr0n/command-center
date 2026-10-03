/*
 * Pure diff between the Sondrik data currently loaded in the browser and a
 * previously downloaded "Download backup (.json)" file (see app.js's
 * backupBtn handler for the exact shape that button writes:
 * { exportedAt, releasesJson, downloadsJson, leadsJson, channelsJson,
 * goalsJson, changelogJson }). Every field on this page is hand-edited
 * JSON, and until this there was no way to tell what a hand-edit actually
 * changed short of eyeballing two files side by side. Same shared-core
 * pattern, and the same field-by-field approach, as CSM's own
 * compareWithBackup (public/csm/data/csm-core.js), adapted to Sondrik's
 * five flat lists instead of CSM's prospects/stages pair. No Node-only
 * APIs, so the exact same function runs in the browser (app.js's Compare
 * with backup modal) and this file's own test suite. Pure and read-only:
 * this only ever reads the two objects it is given, it never writes
 * anything back to releases.json/downloads.json/leads.json/channels.json/
 * goals.json themselves.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SondrikCompareCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  // undefined and null both mean "not logged" across this schema (see e.g.
  // releases.json's own null "notes" convention), so they compare equal
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

  const RELEASE_FIELDS = ['date', 'type', 'summary', 'notes'];
  // downloads.json's checks array has no id field, one real check per date
  // (see downloads.json's own convention), so the date is the natural key.
  const DOWNLOAD_CHECK_FIELDS = ['count', 'note'];
  const LEAD_FIELDS = ['channelId', 'source', 'sourceDetail', 'type', 'summary', 'loggedDate', 'outreach'];
  const CHANNEL_FIELDS = ['name', 'linkedMetric', 'status', 'note'];
  const GOAL_FIELDS = ['label', 'metric', 'target', 'targetDate', 'setDate', 'note'];

  // current is the same { releasesData, downloadsData, leadsData,
  // channelsData, goalsData } shape app.js already keeps around after its
  // Promise.allSettled load; backupFile is a backup file's parsed JSON.
  // Throws a plain Error, meant to be shown to the user as-is, if the file
  // handed in was never produced by this page's own backup button (a
  // random JSON file has no real "before" state to diff against).
  function compareWithBackup(current, backupFile) {
    if (!backupFile || typeof backupFile !== 'object' ||
      !backupFile.releasesJson || !backupFile.downloadsJson || !backupFile.leadsJson ||
      !backupFile.channelsJson || !backupFile.goalsJson) {
      throw new Error('That file does not look like a Sondrik hub backup (expected releasesJson/downloadsJson/' +
        'leadsJson/channelsJson/goalsJson keys). Use a file downloaded from this page’s ' +
        '"Download backup (.json)" button.');
    }
    const currentReleases = (current.releasesData && current.releasesData.releases) || [];
    const backupReleases = (backupFile.releasesJson && backupFile.releasesJson.releases) || [];
    const currentChecks = (current.downloadsData && current.downloadsData.metric && current.downloadsData.metric.checks) || [];
    const backupChecks = (backupFile.downloadsJson && backupFile.downloadsJson.metric && backupFile.downloadsJson.metric.checks) || [];
    const currentLeads = (current.leadsData && current.leadsData.leads) || [];
    const backupLeads = (backupFile.leadsJson && backupFile.leadsJson.leads) || [];
    const currentChannels = (current.channelsData && current.channelsData.channels) || [];
    const backupChannels = (backupFile.channelsJson && backupFile.channelsJson.channels) || [];
    const currentGoals = (current.goalsData && current.goalsData.goals) || [];
    const backupGoals = (backupFile.goalsJson && backupFile.goalsJson.goals) || [];

    return {
      exportedAt: backupFile.exportedAt || null,
      releases: diffByKey(currentReleases, backupReleases, r => r.version, RELEASE_FIELDS),
      downloadChecks: diffByKey(currentChecks, backupChecks, c => c.date, DOWNLOAD_CHECK_FIELDS),
      leads: diffByKey(currentLeads, backupLeads, l => l.id, LEAD_FIELDS),
      channels: diffByKey(currentChannels, backupChannels, c => c.id, CHANNEL_FIELDS),
      goals: diffByKey(currentGoals, backupGoals, g => g.id, GOAL_FIELDS)
    };
  }

  return { fieldValuesDiffer, diffByKey, compareWithBackup };
});

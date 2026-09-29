/*
 * Pure diff between the Garage data currently loaded in the browser and a
 * previously downloaded "Download backup (.json)" file (see app.js's
 * backupBtn handler for the exact shape that button writes: { exportedAt,
 * source, listingsJson, pipelineJson, activityJson, salesJson, expensesJson,
 * disputesJson, suppliesJson, acquisitionsJson, compsJson, engagementJson }).
 * Every field here is hand-edited JSON, and until this there was no way to
 * tell what a hand-edit actually changed short of eyeballing two files side
 * by side. Same shared-core pattern, and the same field-by-field approach,
 * as CSM's own compareWithBackup (public/csm/data/csm-core.js) and
 * Sondrik's/CGT's (public/sondrik/data/compare-core.js,
 * public/cgt/data/compare-core.js), adapted to Garage's ten lists. Pipeline
 * stages are keyed by stage name (pipeline.json has no id field, one real
 * row per stage, see pipeline.json's own convention), every other list is
 * keyed by id. No Node-only APIs, so the exact same function runs in the
 * browser (app.js's Compare with backup modal) and this file's own test
 * suite. Pure and read-only: this only ever reads the two objects it is
 * given, it never writes anything back to listings.json/pipeline.json/
 * activity.json/sales.json/expenses.json/disputes.json/supplies.json/
 * acquisitions.json/comps.json/engagement.json themselves.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GarageCompareCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  // undefined and null both mean "not logged" across this schema (see e.g.
  // listings.json's own null certNumber-style convention), so they compare
  // equal here rather than flagging a field as changed just because one
  // side's key was omitted and the other's was explicitly null.
  function fieldValuesDiffer(a, b) {
    const na = a === undefined ? null : a;
    const nb = b === undefined ? null : b;
    return JSON.stringify(na) !== JSON.stringify(nb);
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

  const LISTING_FIELDS = [
    'title', 'price', 'costBasis', 'category', 'platforms', 'soldOn', 'listingUrls',
    'status', 'datePublished', 'notes', 'location', 'ebayReturnPolicy', 'itemSpecifics'
  ];
  const PIPELINE_STAGE_FIELDS = ['count', 'note'];
  const ACTIVITY_FIELDS = ['date', 'type', 'platform', 'title', 'detail', 'itemsReviewed', 'issuesFound'];
  const SALE_FIELDS = ['title', 'listingId', 'platform', 'salePrice', 'askingPrice', 'costBasis', 'shippingCost', 'saleDate', 'shipDate'];
  const EXPENSE_FIELDS = ['description', 'category', 'miles', 'amount', 'date'];
  const DISPUTE_FIELDS = ['title', 'listingId', 'platform', 'type', 'status', 'openedDate', 'resolvedDate', 'outcome', 'notes'];
  const SUPPLY_FIELDS = ['name', 'category', 'qtyOnHand', 'reorderThreshold', 'lastRestocked', 'notes'];
  const ACQUISITION_FIELDS = ['source', 'sourceName', 'date', 'pricePaid', 'itemCount', 'listingIds', 'notes'];
  const COMP_FIELDS = ['listingId', 'platform', 'title', 'soldPrice', 'soldDate', 'url', 'notes'];
  const ENGAGEMENT_FIELDS = ['listingId', 'platform', 'date', 'views', 'saves', 'notes'];

  // current is the same { rawListingsData, rawPipelineData, rawActivityData,
  // rawSalesData, rawExpensesData, rawDisputesData, rawSuppliesData,
  // rawAcquisitionsData, rawCompsData, rawEngagementData } shape app.js
  // already keeps around after its own loads; backupFile is a backup file's
  // parsed JSON. Throws a plain Error, meant to be shown to the user as-is,
  // if the file handed in was never produced by this page's own backup
  // button (a random JSON file has no real "before" state to diff against).
  function compareWithBackup(current, backupFile) {
    if (!backupFile || typeof backupFile !== 'object' ||
      !backupFile.listingsJson || !backupFile.pipelineJson || !backupFile.activityJson ||
      !backupFile.salesJson || !backupFile.expensesJson || !backupFile.disputesJson ||
      !backupFile.suppliesJson || !backupFile.acquisitionsJson || !backupFile.compsJson ||
      !backupFile.engagementJson) {
      throw new Error('That file does not look like a Garage backup (expected listingsJson/pipelineJson/' +
        'activityJson/salesJson/expensesJson/disputesJson/suppliesJson/acquisitionsJson/compsJson/' +
        'engagementJson keys). Use a file downloaded from this page’s "Download backup (.json)" button.');
    }
    const currentListings = (current.rawListingsData && current.rawListingsData.listings) || [];
    const backupListings = (backupFile.listingsJson && backupFile.listingsJson.listings) || [];
    const currentStages = (current.rawPipelineData && current.rawPipelineData.stages) || [];
    const backupStages = (backupFile.pipelineJson && backupFile.pipelineJson.stages) || [];
    const currentActivity = (current.rawActivityData && current.rawActivityData.events) || [];
    const backupActivity = (backupFile.activityJson && backupFile.activityJson.events) || [];
    const currentSales = (current.rawSalesData && current.rawSalesData.sales) || [];
    const backupSales = (backupFile.salesJson && backupFile.salesJson.sales) || [];
    const currentExpenses = (current.rawExpensesData && current.rawExpensesData.expenses) || [];
    const backupExpenses = (backupFile.expensesJson && backupFile.expensesJson.expenses) || [];
    const currentDisputes = (current.rawDisputesData && current.rawDisputesData.disputes) || [];
    const backupDisputes = (backupFile.disputesJson && backupFile.disputesJson.disputes) || [];
    const currentSupplies = (current.rawSuppliesData && current.rawSuppliesData.supplies) || [];
    const backupSupplies = (backupFile.suppliesJson && backupFile.suppliesJson.supplies) || [];
    const currentAcquisitions = (current.rawAcquisitionsData && current.rawAcquisitionsData.acquisitions) || [];
    const backupAcquisitions = (backupFile.acquisitionsJson && backupFile.acquisitionsJson.acquisitions) || [];
    const currentComps = (current.rawCompsData && current.rawCompsData.comps) || [];
    const backupComps = (backupFile.compsJson && backupFile.compsJson.comps) || [];
    const currentEngagement = (current.rawEngagementData && current.rawEngagementData.snapshots) || [];
    const backupEngagement = (backupFile.engagementJson && backupFile.engagementJson.snapshots) || [];

    return {
      exportedAt: backupFile.exportedAt || null,
      listings: diffByKey(currentListings, backupListings, l => l.id, LISTING_FIELDS),
      pipeline: diffByKey(currentStages, backupStages, s => s.stage, PIPELINE_STAGE_FIELDS),
      activity: diffByKey(currentActivity, backupActivity, e => e.id, ACTIVITY_FIELDS),
      sales: diffByKey(currentSales, backupSales, s => s.id, SALE_FIELDS),
      expenses: diffByKey(currentExpenses, backupExpenses, e => e.id, EXPENSE_FIELDS),
      disputes: diffByKey(currentDisputes, backupDisputes, d => d.id, DISPUTE_FIELDS),
      supplies: diffByKey(currentSupplies, backupSupplies, s => s.id, SUPPLY_FIELDS),
      acquisitions: diffByKey(currentAcquisitions, backupAcquisitions, a => a.id, ACQUISITION_FIELDS),
      comps: diffByKey(currentComps, backupComps, c => c.id, COMP_FIELDS),
      engagement: diffByKey(currentEngagement, backupEngagement, s => s.id, ENGAGEMENT_FIELDS)
    };
  }

  return { fieldValuesDiffer, diffByKey, compareWithBackup };
});

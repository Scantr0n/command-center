/*
 * Pure diff between the CGT data currently loaded in the browser and a
 * previously downloaded "Download backup (.json)" file (see app.js's
 * backupBtn handler for the exact shape that button writes: { exportedAt,
 * source, cardsJson, submissionsJson, candidatesJson }). Every field here is
 * hand-edited JSON (cards.json/submissions.json/candidates.json), and until
 * this there was no way to tell what a hand-edit actually changed short of
 * eyeballing two files side by side. Same shared-core pattern, and the same
 * field-by-field-by-id approach, as CSM's own compareWithBackup
 * (public/csm/data/csm-core.js) and Sondrik's (public/sondrik/data/
 * compare-core.js), adapted to CGT's three id-keyed lists. No Node-only
 * APIs, so the exact same function runs in the browser (app.js's Compare
 * with backup modal) and this file's own test suite. Pure and read-only:
 * this only ever reads the two objects it is given, it never writes
 * anything back to cards.json/submissions.json/candidates.json themselves.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CGTCompareCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  // undefined and null both mean "not logged" across this schema (see e.g.
  // cards.json's own null certNumber/storageLocation convention), so they
  // compare equal here rather than flagging a field as changed just because
  // one side's key was omitted and the other's was explicitly null.
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

  function diffById(currentList, backupList, fields) {
    const currentById = new Map((currentList || []).filter(x => x && x.id).map(x => [x.id, x]));
    const backupById = new Map((backupList || []).filter(x => x && x.id).map(x => [x.id, x]));
    const added = [];
    const removed = [];
    const changed = [];
    currentById.forEach((item, id) => {
      if (!backupById.has(id)) { added.push(item); return; }
      const prior = backupById.get(id);
      const changedFields = fields.filter(f => fieldValuesDiffer(item[f], prior[f]));
      if (changedFields.length) changed.push({ id, current: item, backup: prior, fields: changedFields });
    });
    backupById.forEach((item, id) => {
      if (!currentById.has(id)) removed.push(item);
    });
    return { added, removed, changed };
  }

  const CARD_FIELDS = [
    'cardName', 'year', 'sport', 'gradingCompany', 'grade',
    'subgradeCentering', 'subgradeCorners', 'subgradeEdges', 'subgradeSurface',
    'certNumber', 'setName', 'cardNumber', 'storageLocation', 'imageUrl',
    'submissionId', 'estimatedValue', 'valuationBasis', 'compNote', 'sourceNote',
    'acquisitionDate', 'costBasis', 'datePriced', 'soldDate', 'soldPrice', 'sellingFees',
    'listedDate', 'listedPrice', 'listingUrl', 'priceCheckAcknowledged', 'backlogBatch', 'priceHistory', 'notes'
  ];
  const SUBMISSION_FIELDS = [
    'gradingCompany', 'serviceLevel', 'description', 'cardCount', 'submittedDate',
    'trackingNumber', 'status', 'returnTrackingNumber', 'returnedDate', 'cost', 'notes'
  ];
  const CANDIDATE_FIELDS = [
    'cardName', 'year', 'sport', 'rawValue', 'rawValueBasis', 'rawValueNote',
    'targetGradingCompany', 'targetServiceLevel', 'estimatedGradingCost', 'shippingCost',
    'expectedGrade', 'expectedGradedValue', 'gradedValueBasis', 'gradedValueNote',
    'datePriced', 'decision', 'decisionNote', 'notes'
  ];

  // current is the same { rawCardsData, rawSubmissionsData, rawCandidatesData
  // } shape app.js already keeps around after its own loads; backupFile is a
  // backup file's parsed JSON. Throws a plain Error, meant to be shown to the
  // user as-is, if the file handed in was never produced by this page's own
  // backup button (a random JSON file has no real "before" state to diff
  // against).
  function compareWithBackup(current, backupFile) {
    if (!backupFile || typeof backupFile !== 'object' ||
      !backupFile.cardsJson || !backupFile.submissionsJson || !backupFile.candidatesJson) {
      throw new Error('That file does not look like a CGT backup (expected cardsJson/submissionsJson/' +
        'candidatesJson keys). Use a file downloaded from this page’s "Download backup (.json)" button.');
    }
    const currentCards = (current.rawCardsData && current.rawCardsData.cards) || [];
    const backupCards = (backupFile.cardsJson && backupFile.cardsJson.cards) || [];
    const currentSubmissions = (current.rawSubmissionsData && current.rawSubmissionsData.submissions) || [];
    const backupSubmissions = (backupFile.submissionsJson && backupFile.submissionsJson.submissions) || [];
    const currentCandidates = (current.rawCandidatesData && current.rawCandidatesData.candidates) || [];
    const backupCandidates = (backupFile.candidatesJson && backupFile.candidatesJson.candidates) || [];

    return {
      exportedAt: backupFile.exportedAt || null,
      cards: diffById(currentCards, backupCards, CARD_FIELDS),
      submissions: diffById(currentSubmissions, backupSubmissions, SUBMISSION_FIELDS),
      candidates: diffById(currentCandidates, backupCandidates, CANDIDATE_FIELDS)
    };
  }

  return { fieldValuesDiffer, diffById, compareWithBackup };
});

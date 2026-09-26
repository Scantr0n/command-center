/*
 * SEARCH_SOURCES, the real list of per-hub record types /api/search matches
 * against, shared between server.js (the actual route, which still owns the
 * real fs.readFileSync/matching loop) and public/data/search-core.test.js.
 *
 * This existed only inline in server.js until now. The client-side deep-
 * link mapping in public/data/search-core.js already learned the hard way
 * that a hand-maintained parallel list of "every type SEARCH_SOURCES emits"
 * silently drifts the moment a new type gets added here and nobody
 * remembers to update the copy (see search-core.js's own header comment:
 * Sondrik's lead/channel/release/goal types went unlinkable for a real
 * stretch this way). Its regression test closed that gap with its own
 * SERVER_SEARCH_SOURCE_TYPES snapshot, but that snapshot was itself a third
 * hand-maintained copy of this exact list, the identical drift risk one
 * level removed. Extracting the real list here, and having both server.js
 * and the test require this same file, removes the copy entirely: a new
 * source added here is real input to the test on its next run, not
 * something a second file also has to be told about by hand.
 *
 * No Node-only APIs inside the source objects themselves (label/detail/
 * fields/exclude are plain functions over a hub's already-parsed JSON
 * record, same shape whether they run in server.js's route or a plain
 * Node test); the actual file reads and matching loop still live in
 * server.js, which is the one place fs/path are genuinely needed.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SearchSourcesCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const SEARCH_SOURCES = [
    {
      hub: 'cgt', clusterId: 'card-grading', file: 'cards.json', key: 'cards', type: 'card',
      label: c => c.cardName, detail: c => [c.sport, c.gradingCompany, c.grade].filter(Boolean).join(' · '),
      // sport/gradingCompany added after checking this was too narrow: cardName
      // alone (a player name) is the main real search intent, but "which PSA
      // cards do I have" or "find my hockey cards" is a real, plausible search
      // too, and both are short structured fields already on every real card,
      // not free text that would return noisy partial matches.
      fields: c => [c.cardName, c.sport, c.gradingCompany],
      // Same seeded-placeholder row submissions.json's own entry below already
      // excludes (see isExample in app.js): without this, typing a common
      // placeholder term could surface "(example row, not real data)" as if it
      // were a real card.
      exclude: c => c.id === 'example-row-not-real'
    },
    {
      hub: 'csm', clusterId: 'csm', file: 'prospects.json', key: 'prospects', type: 'prospect',
      label: p => p.name, detail: p => p.company || '',
      fields: p => [p.name, p.company]
    },
    {
      hub: 'garage', clusterId: 'garage', file: 'listings.json', key: 'listings', type: 'listing',
      label: l => l.title, detail: l => l.status ? l.status.toUpperCase() : '',
      // category/itemSpecifics added the same way: title alone missed a real,
      // verified case (both real boot listings have itemSpecifics.color set to
      // "Black"/"White" right now, a real color a person would plausibly type
      // to find them, even though title alone already happens to say "boots").
      // brand is null on every real listing today, but it's exactly the field
      // Data Quality already flags as missing, so it's included now for when
      // it's genuinely backfilled rather than needing a second change later.
      fields: l => [l.title, l.category, l.itemSpecifics && l.itemSpecifics.brand, l.itemSpecifics && l.itemSpecifics.color]
    },
    {
      hub: 'sondrik', clusterId: 'sondrik', file: 'leads.json', key: 'leads', type: 'lead',
      label: l => l.sourceDetail || l.source || 'Lead', detail: l => l.summary || '',
      fields: l => [l.sourceDetail, l.source, l.summary]
    },
    {
      hub: 'job-search', clusterId: 'job-search', file: 'applications.json', key: 'applications', type: 'application',
      label: a => a.company, detail: a => a.role || '',
      // location added after checking it's real and distinct per real
      // application right now ("NY (Remote)", "Goa, India (Remote)", etc.), a
      // real plausible thing to search by ("what did I apply to in India").
      fields: a => [a.company, a.role, a.location]
    },
    // Below: the same real-record search extended to every other hand-tracked
    // entity, not just each hub's one "primary" record type above. A real gap
    // this closes: "find that dispute about the black boots" or "which goal is
    // set for downloads" had no answer at all, only the entity type that got
    // this search first when it was built. Same "small, deliberately chosen
    // real fields" rule as above; several of these files (Garage's sales/
    // expenses/disputes/supplies/acquisitions) have zero real rows logged yet,
    // same as when card-grading/csm/garage/sondrik/job-search above were first
    // added with data still thin, this just means no matches until real rows
    // exist, not a fabricated placeholder now.
    {
      hub: 'cgt', clusterId: 'card-grading', file: 'submissions.json', key: 'submissions', type: 'submission',
      label: s => s.description, detail: s => s.gradingCompany || '',
      fields: s => [s.description, s.gradingCompany],
      // The one seeded placeholder row still sitting in submissions.json
      // (see isExampleSubmission in app.js): without this, typing "PSA" would
      // surface "(example row, not real data)" as if it were a real submission.
      exclude: s => s.id === 'example-submission-not-real'
    },
    {
      hub: 'cgt', clusterId: 'card-grading', file: 'candidates.json', key: 'candidates', type: 'candidate',
      label: c => c.cardName, detail: c => c.sport || '',
      fields: c => [c.cardName, c.sport, c.targetGradingCompany],
      // Same seeded-placeholder row (see isExampleCandidate in app.js), same
      // reason as cards.json's own entry above.
      exclude: c => c.id === 'example-candidate-not-real'
    },
    {
      hub: 'garage', clusterId: 'garage', file: 'sales.json', key: 'sales', type: 'sale',
      label: s => s.title, detail: s => s.platform ? s.platform.toUpperCase() : '',
      fields: s => [s.title]
    },
    {
      hub: 'garage', clusterId: 'garage', file: 'expenses.json', key: 'expenses', type: 'expense',
      label: e => e.description, detail: e => e.category || '',
      fields: e => [e.description]
    },
    {
      hub: 'garage', clusterId: 'garage', file: 'disputes.json', key: 'disputes', type: 'dispute',
      label: d => d.title, detail: d => d.platform ? d.platform.toUpperCase() : '',
      fields: d => [d.title, d.outcome]
    },
    {
      hub: 'garage', clusterId: 'garage', file: 'supplies.json', key: 'supplies', type: 'supply',
      label: s => s.name, detail: s => s.category || '',
      fields: s => [s.name]
    },
    {
      hub: 'garage', clusterId: 'garage', file: 'acquisitions.json', key: 'acquisitions', type: 'acquisition',
      label: a => a.sourceName || a.source, detail: a => a.source || '',
      fields: a => [a.sourceName, a.source]
    },
    {
      hub: 'sondrik', clusterId: 'sondrik', file: 'channels.json', key: 'channels', type: 'channel',
      label: c => c.name, detail: c => c.status || '',
      fields: c => [c.name]
    },
    {
      hub: 'sondrik', clusterId: 'sondrik', file: 'releases.json', key: 'releases', type: 'release',
      label: r => r.version, detail: r => r.summary || '',
      fields: r => [r.version, r.summary, r.type]
    },
    {
      hub: 'sondrik', clusterId: 'sondrik', file: 'goals.json', key: 'goals', type: 'goal',
      label: g => g.label, detail: g => g.metric || '',
      fields: g => [g.label]
    }
  ];
  const SEARCH_RESULT_CAP = 20;
  // Applied per source, not against the shared total: SEARCH_SOURCES is
  // declared cgt-first, so a single popular term matching 20+ cards alone used
  // to fill the whole cap before csm/garage/sondrik/job-search ever got a
  // chance to contribute, on a term that had nothing to do with cards. Every
  // hub's data is thin today so this hasn't been visibly hit yet, but it's a
  // real starvation bug the moment any one source's real row count grows.
  const SEARCH_PER_SOURCE_CAP = 5;

  return { SEARCH_SOURCES, SEARCH_RESULT_CAP, SEARCH_PER_SOURCE_CAP };
});

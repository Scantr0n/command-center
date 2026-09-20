let cards = [];
let submissions = [];
let candidates = [];
let rawCardsData = null;
let rawSubmissionsData = null;
let rawCandidatesData = null;
let activeCard = null;
let lastFocusedEl = null;
let searchTerm = '';
let activeSport = 'all';
let activeBasis = 'all';
let activeGrader = 'all';
let activeBatch = 'all';
let activeOwnership = 'all';
let sortKey = null;
let sortDir = 'asc';
let candidateSearchTerm = '';
let activeCandidateSport = 'all';
let activeCandidateVerdict = 'all';
let activeCandidateStatus = 'all';

// Filters, search, and sort are mirrored into the URL query string so a
// specific view (e.g. "PSA hockey cards sorted by value") can be bookmarked
// or shared as a link, the way collectibles trackers like collecto.rs do.
// Restored once on load, then kept in sync via history.replaceState so
// typing in the search box doesn't spam the browser's back/forward history.
const VALID_BASES = ['recent-sale', 'comp-estimate', 'unpriced'];
const VALID_GRADERS = ['PSA', 'BGS', 'SGC', 'CGC', 'HGA', 'KSA'];
const VALID_SPORTS = ['hockey', 'baseball', 'football'];
const VALID_OWNERSHIP = ['owned', 'sold'];
const VALID_CANDIDATE_VERDICTS = ['worth-grading', 'marginal', 'not-worth', 'needs-data'];
const VALID_CANDIDATE_STATUSES = ['open', 'decided'];

function restoreStateFromUrl() {
  const params = new URLSearchParams(location.search);
  const q = params.get('q');
  const sport = params.get('sport');
  const basis = params.get('basis');
  const grader = params.get('grader');
  const batch = params.get('batch');
  const ownership = params.get('owned');
  const sort = params.get('sort');
  const dir = params.get('dir');
  // Own query params, distinct from the cards tab's q/sport above, since the
  // Candidates section (renderCandidates) has its own independent search box
  // and sport/verdict chip filters that need to be bookmarkable/shareable too.
  const candQ = params.get('candQ');
  const candSport = params.get('candSport');
  const candVerdict = params.get('candVerdict');
  const candStatus = params.get('candStatus');
  if (q) searchTerm = q;
  if (sport && VALID_SPORTS.includes(sport)) activeSport = sport;
  if (basis && VALID_BASES.includes(basis)) activeBasis = basis;
  // 'raw' is a real, clickable filter chip (matchesGraderValue below treats it
  // as its own case, not a grading company), but it isn't in VALID_GRADERS,
  // so a shared/bookmarked ?grader=raw URL silently fell back to "All" on
  // load, defeating the whole point of mirroring filters into the URL.
  if (grader && (grader === 'raw' || VALID_GRADERS.includes(grader))) activeGrader = grader;
  // Not validated against a fixed list like sport/basis/grader, since batch
  // labels are open-ended (one per real pricing session). An unknown batch
  // in the URL just matches nothing once applied, same as a stale bookmark.
  if (batch) activeBatch = batch;
  if (ownership && VALID_OWNERSHIP.includes(ownership)) activeOwnership = ownership;
  if (sort) sortKey = sort;
  if (dir === 'desc') sortDir = 'desc';
  if (candQ) candidateSearchTerm = candQ;
  if (candSport && VALID_SPORTS.includes(candSport)) activeCandidateSport = candSport;
  if (candVerdict && VALID_CANDIDATE_VERDICTS.includes(candVerdict)) activeCandidateVerdict = candVerdict;
  if (candStatus && VALID_CANDIDATE_STATUSES.includes(candStatus)) activeCandidateStatus = candStatus;
}

function setInitialChipState(containerId, dataAttr, value) {
  const container = document.getElementById(containerId);
  container.querySelectorAll('.chip').forEach(chip => {
    chip.setAttribute('aria-pressed', chip.getAttribute(dataAttr) === value ? 'true' : 'false');
  });
}

function syncUrl() {
  const params = new URLSearchParams();
  if (searchTerm.trim()) params.set('q', searchTerm.trim());
  if (activeSport !== 'all') params.set('sport', activeSport);
  if (activeBasis !== 'all') params.set('basis', activeBasis);
  if (activeGrader !== 'all') params.set('grader', activeGrader);
  if (activeBatch !== 'all') params.set('batch', activeBatch);
  if (activeOwnership !== 'all') params.set('owned', activeOwnership);
  if (sortKey) {
    params.set('sort', sortKey);
    if (sortDir === 'desc') params.set('dir', 'desc');
  }
  if (candidateSearchTerm.trim()) params.set('candQ', candidateSearchTerm.trim());
  if (activeCandidateSport !== 'all') params.set('candSport', activeCandidateSport);
  if (activeCandidateVerdict !== 'all') params.set('candVerdict', activeCandidateVerdict);
  if (activeCandidateStatus !== 'all') params.set('candStatus', activeCandidateStatus);
  const qs = params.toString();
  const url = location.pathname + (qs ? '?' + qs : '');
  history.replaceState(null, '', url);
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// An empty state that just says "add one to whatever.json" is a dead end,
// the matching quick-log tool already exists further up the page but stays
// collapsed and easy to miss. This turns each empty state into a real CTA:
// it opens that tool's own <details> (each of the three has its own here,
// unlike a single shared one), scrolls its form into view, and focuses the
// first field. Delegated on document since empty states are re-created on
// every render.
function openQuickLogForm(detailsId, formId) {
  const details = document.getElementById(detailsId);
  const form = document.getElementById(formId);
  if (!details || !form) return;
  details.open = true;
  form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const firstField = form.querySelector('input, select, textarea');
  if (firstField) firstField.focus();
}
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-open-quick-log]');
  if (!btn) return;
  const [detailsId, formId] = btn.getAttribute('data-open-quick-log').split(':');
  openQuickLogForm(detailsId, formId);
});
function emptyStateCta(detailsId, formId, label) {
  return '<button type="button" class="print-btn empty-state-cta" data-open-quick-log="' +
    escapeHtml(detailsId) + ':' + escapeHtml(formId) + '">' + escapeHtml(label) + '</button>';
}

// Same fix as garage/app.js's own formatUsd: '$' + (-1.95) reads as the
// confusing "$-1.95" instead of "-$1.95", and toLocaleString drops trailing
// zero cents on its own (45.50 -> "45.5"), which reads as a formatting bug
// next to a real "19.99" grading fee in the same table.
function formatUsd(n) {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const hasCents = Math.round(abs * 100) % 100 !== 0;
  return sign + '$' + abs.toLocaleString('en-US', { minimumFractionDigits: hasCents ? 2 : 0, maximumFractionDigits: 2 });
}

function formatSignedUsd(n) {
  return (n >= 0 ? '+' : '-') + formatUsd(Math.abs(n));
}

// Gain/loss only exists to compute where both a real purchase price
// (costBasis) and a real researched value (estimatedValue) are on record.
// Neither field requires the other: plenty of cards will have a price
// logged with no memory of what was paid, or vice versa, so this returns
// null rather than treating a missing side as zero.
function computeGainLoss(c) {
  if (c.costBasis == null || c.estimatedValue == null) return null;
  const abs = c.estimatedValue - c.costBasis;
  const pct = c.costBasis > 0 ? (abs / c.costBasis) * 100 : null;
  return { abs, pct };
}

function isExample(c) {
  return c.id === 'example-row-not-real';
}

// A card is sold once it has a real soldDate (validate-core.js requires
// soldPrice and soldDate together, so either field alone is enough to check
// here). Sold cards stay in cards.json as a permanent record of what was
// owned, but drop out of every "what do I currently hold" total (portfolio
// value, breakdowns, unrealized gain/loss, the insurance summary) the same
// way an unpriced card drops out of the priced total instead of counting as
// $0: no longer owning it isn't a $0 value, it's a different question.
function isSold(c) {
  return c.soldDate != null;
}

// Only counts when both a real purchase price and a real sale price are on
// record, same "never guess at a missing side" rule as computeGainLoss's
// unrealized version. A card sold with no logged costBasis has a real sale
// price but no real realized gain/loss to compute against.
function computeRealizedGainLoss(c) {
  if (!isSold(c) || c.costBasis == null) return null;
  const abs = c.soldPrice - c.costBasis;
  const pct = c.costBasis > 0 ? (abs / c.costBasis) * 100 : null;
  return { abs, pct };
}

// priceHistory holds prior researched prices for a card, oldest first, logged
// when a re-check changes the number instead of silently overwriting it. This
// reads the most recent prior entry (regardless of what order it was actually
// written in the JSON) so a hand-edited file that didn't bother sorting the
// array still compares against the right one.
function lastPriceHistoryEntry(c) {
  if (!c.priceHistory || !c.priceHistory.length) return null;
  return c.priceHistory.slice().sort((a, b) => (a.date || '').localeCompare(b.date || '')).pop();
}

// Same "only compute when both real numbers exist" rule as computeGainLoss:
// a card with no priceHistory yet (priced exactly once) has no trend to show,
// not a 0% change.
function computeValueTrend(c) {
  const prev = lastPriceHistoryEntry(c);
  if (!prev || c.estimatedValue == null) return null;
  const abs = c.estimatedValue - prev.value;
  const pct = prev.value > 0 ? (abs / prev.value) * 100 : null;
  return { abs, pct, prevValue: prev.value, prevDate: prev.date };
}

function isExampleSubmission(s) {
  return s.id === 'example-submission-not-real';
}

// Display label and badge class per submissions.json status. "returned"
// intentionally has no active-list styling need here since returned
// submissions are excluded from the active list entirely (see
// buildActiveSubmissions), it's only used if that ever changes.
const SUBMISSION_STATUS_META = {
  submitted: { label: 'Submitted', cls: 'badge-status-queue' },
  'in-queue': { label: 'In queue', cls: 'badge-status-queue' },
  grading: { label: 'Grading', cls: 'badge-status-grading' },
  'shipped-back': { label: 'Shipped back', cls: 'badge-status-shipped' },
  returned: { label: 'Returned', cls: 'badge-status-returned' }
};

// Only PSA has a confirmed public order-status page that works without
// logging in (psacard.com/orderstatus, checked directly). BGS, SGC, CGC, and
// KSA all gate their order-status/submission-tracking tools behind a login,
// same as the cert-lookup situation in CERT_LOOKUP above, so rather than
// guess at a link that might not actually show anything useful, those are
// left out here entirely instead of pointing at a dead end.
const ORDER_STATUS_LOOKUP = {
  PSA: { url: 'https://www.psacard.com/orderstatus', text: 'Check status on psacard.com' }
};

// Each grader's own published per-tier turnaround, business days, midpoint
// of the range shown in the "Grading service tiers reference" section
// (index.html), reviewed September 2026 -- see that section for sources and
// caveats (PSA's Value tiers paused, Beckett's Base/Standard closed, SGC's
// own published windows disagreeing across sources). This is only ever used
// as a fallback estimate in renderSubmissions below, for a grader/company
// with fewer than 2 real returned submissions logged to average from; once
// real history exists, buildTurnaroundByGrader's own real average always
// wins over this. "default" is used when serviceLevel doesn't match a known
// tier name (including no serviceLevel logged at all).
//
// PSA renamed Walk-Through to Premier and Regular to Priority, and added a
// new Standard tier, on 2026-09-14 (see the reference section). The old
// "walk-through"/"regular" keys are kept alongside the new ones so a real
// submission logged before that date under its then-current tier name still
// resolves to the turnaround that was actually published for it at the
// time, rather than getting silently reinterpreted under the new name.
// PSA's "default" (no serviceLevel logged) is the rough average across its
// currently open tiers (Premier/Super Express/Express/Priority/Standard),
// not one specific tier's own number.
const PUBLISHED_TURNAROUND_DAYS = {
  PSA: { default: 43, tiers: {
    'walk-through': 6, walkthrough: 6, premier: 9,
    'super express': 13, express: 25,
    regular: 35, priority: 75,
    standard: 95,
    'value max': 45, 'value plus': 70, 'value bulk': 150, value: 110
  } },
  BGS: { default: 45, tiers: { base: 75, standard: 45, express: 15, priority: 5 } },
  CGC: { default: 20, tiers: { bulk: 40, economy: 20, standard: 10, express: 5, walkthrough: 2, 'walk-through': 2 } },
  SGC: { default: 58, tiers: { entry: 58, standard: 58, expedited: 3 } }
};

// Business days -> calendar days, weekends only (no holiday calendar here),
// same rough conversion used nowhere else in this file since every other
// date math here already works in real calendar days from a real logged
// date. Good enough for a "published estimate, not a guarantee" figure, not
// meant to be exact to the day.
function businessDaysToCalendarDays(businessDays) {
  return Math.round(businessDays * 1.4);
}

function publishedTurnaroundDays(gradingCompany, serviceLevel) {
  const entry = gradingCompany && PUBLISHED_TURNAROUND_DAYS[gradingCompany];
  if (!entry) return null;
  if (serviceLevel) {
    const norm = serviceLevel.toLowerCase().trim();
    // Exact tier name first: PSA's "super express" and "value max"/"value
    // plus"/"value bulk" each contain a shorter real tier name ("express",
    // "value"), so a plain bidirectional substring match on those returns
    // the wrong tier's turnaround for the shorter, more common one. Only
    // fall back to substring matching for a serviceLevel that doesn't
    // exactly match any known tier (e.g. minor wording variations).
    if (Object.prototype.hasOwnProperty.call(entry.tiers, norm)) return entry.tiers[norm];
    for (const [tierName, days] of Object.entries(entry.tiers)) {
      if (norm.includes(tierName) || tierName.includes(norm)) return days;
    }
  }
  return entry.default;
}

// Card market prices drift over months, not days, so this is a much longer
// window than the 7-day staleness check used elsewhere in Command Center
// (e.g. the Sondrik download tracker). It just means "worth a re-check
// before relying on this number," not that the price is wrong.
const PRICE_STALE_AFTER_DAYS = 180;

// Local calendar date as YYYY-MM-DD, same convention as daysSince above
// (and CSM's/Sondrik's own todayIso): new Date().toISOString().slice(0, 10)
// reads the UTC calendar date, which rolls over to tomorrow while it is
// still today for anyone west of UTC, so a printed insurance document or a
// CSV filename stamped that way can read one day ahead for the rest of the
// evening, local time.
function todayIso() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Projects an ISO date forward by a whole number of days, local calendar
// semantics (no time-of-day component), same "local calendar date" rule as
// todayIso/daysSince below. Used to turn a grader's own average turnaround
// into a real projected date rather than leaving Jack to do the day-math on
// a "days in queue" figure himself.
function addDaysIso(isoDate, days) {
  const d = new Date(isoDate + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function daysSince(isoDate) {
  if (!isoDate) return null;
  // Local midnight, not UTC (no trailing Z), same convention as Sondrik's
  // daysBetween and the main dashboard's relativeTime: datePriced is logged
  // against Jack's own calendar day, so anchoring to UTC midnight instead
  // overstates the age by up to a day for anyone west of UTC.
  const then = new Date(isoDate + 'T00:00:00').getTime();
  if (Number.isNaN(then)) return null;
  const now = Date.now();
  return Math.floor((now - then) / 86400000);
}

// Real official verification tools, checked directly against each grader's
// site. Only PSA and Beckett (BGS) confirmed a URL pattern that deep-links
// straight to a specific cert; SGC, CGC, and KSA have a public lookup tool
// but it is a form you fill in by hand, no confirmed direct-link format, so
// those just open the tool rather than guessing a query param. HGA has no
// public cert lookup as of this writing, so it is left out entirely rather
// than link to something that doesn't exist.
const CERT_LOOKUP = {
  // The trailing "/psa" scopes the lookup to PSA-graded cards specifically:
  // cert numbers are shared with PSA/DNA's autograph-only database, so a
  // bare /cert/<number> can land on the wrong item type for a colliding id.
  PSA: { deepLink: cert => 'https://www.psacard.com/cert/' + encodeURIComponent(cert) + '/psa' },
  // Beckett's own site, not just this one lookup tool, has had real
  // multi-day outages in 2026 (see the Grading service tiers reference
  // section's Beckett notes) -- BECKETT_SITE_STATUS_NOTE below surfaces
  // that here too, since a dead cert/pop-report link with no explanation
  // reads as this tool being broken rather than the grader's own site.
  BGS: { deepLink: cert => 'https://www.beckett.com/grading/card-lookup?item_id=' + encodeURIComponent(cert) + '&item_type=BGS', note: true },
  SGC: { landing: 'https://www.gosgc.com/auth-code' },
  CGC: { landing: 'https://www.cgccards.com/verify' },
  KSA: { landing: 'https://www.ksagrading.com/pages/card-serial-number-verification' }
};

// Deliberately not dated (contrast the Grading service tiers reference
// section, which does date its Beckett outage note): that section gets
// reviewed and refreshed as part of the real research pass on grading
// tiers, but this link note has no such refresh cycle, so a hardcoded date
// would just go stale in place. "has had" stays true regardless of whether
// beckett.com happens to be up the moment this link is clicked.
const BECKETT_SITE_STATUS_NOTE = "Beckett's own site (beckett.com) has had real multi-day outages in 2026. If this link won't load, it's likely the site, not this card -- check the Grading service tiers reference section above for its current status.";

function certLookupLink(c) {
  const entry = c.gradingCompany && CERT_LOOKUP[c.gradingCompany];
  if (!entry) return null;
  if (entry.deepLink && c.certNumber) {
    return { url: entry.deepLink(c.certNumber), text: 'Verify cert on ' + c.gradingCompany + '.com', note: entry.note ? BECKETT_SITE_STATUS_NOTE : null };
  }
  if (entry.landing) {
    return { url: entry.landing, text: 'Open ' + c.gradingCompany + ' cert lookup (enter cert by hand)', note: entry.note ? BECKETT_SITE_STATUS_NOTE : null };
  }
  return null;
}

// Population report: a real, free-to-browse public tool each grading company
// publishes showing how many copies of a card it has graded at each grade,
// which is genuinely useful context for a grading decision (a low population
// at a grade means real rarity, not just a good-looking number). Separate
// concept from certLookupLink above, which verifies one specific slab rather
// than showing the whole grade distribution for a card. PSA, SGC, and CGC all
// publish a free public search; BGS's is real but sits behind a Beckett
// account login, so its link text says that rather than pretending it opens
// straight to results, same honesty rule as compSearchLink's eBay-login note
// below. HGA and KSA publish no public population report as of this writing
// (confirmed by search, same as HGA already having no cert lookup above), so
// neither gets an entry here and no link is shown for them.
const POP_REPORT_LOOKUP = {
  PSA: { url: 'https://www.psacard.com/pop/search', text: 'Search PSA population report' },
  BGS: { url: 'https://www.beckett.com/grading/pop-report', text: 'Open BGS population report (Beckett login required)', note: true },
  SGC: { url: 'https://www.gosgc.com/pop-report', text: 'Search SGC population report' },
  CGC: { url: 'https://www.cgccards.com/population-report/', text: 'Browse CGC population report' }
};

function popReportLinkForCompany(company) {
  const entry = company && POP_REPORT_LOOKUP[company];
  if (!entry) return null;
  return { url: entry.url, text: entry.text, note: entry.note ? BECKETT_SITE_STATUS_NOTE : null };
}

function popReportLink(c) {
  return popReportLinkForCompany(c.gradingCompany);
}

// A real, stable eBay search URL pattern (the _nkw keyword param has worked
// this way for over a decade), built from the card's own real fields so it
// never fabricates anything, just points at where the actual comps would be.
// LH_Sold + LH_Complete narrow it to completed sales, which is what pricing
// research actually needs, not active asking prices. As of a July 2026 eBay
// change these two params now redirect a signed-out visitor to eBay login
// before showing results, so the link text says that plainly rather than
// pretending it always works with no account.
function compSearchLink(c) {
  if (!c.cardName) return null;
  const parts = [c.year, c.cardName, c.gradingCompany, c.grade != null ? 'grade ' + c.grade : null].filter(Boolean);
  const url = 'https://www.ebay.com/sch/i.html?_nkw=' + encodeURIComponent(parts.join(' ')) + '&LH_Sold=1&LH_Complete=1';
  return { url, text: 'Search eBay sold comps for this card' };
}

// Same real, stable eBay search pattern as compSearchLink above, but for a
// raw/ungraded candidate rather than an already-graded card: appends "raw"
// and excludes the four graders' names so slab listings don't crowd out the
// actual raw comps that rawValue research needs.
function rawCompSearchLink(c) {
  if (!c.cardName) return null;
  const parts = [c.year, c.cardName, 'raw'].filter(Boolean);
  const url = 'https://www.ebay.com/sch/i.html?_nkw=' + encodeURIComponent(parts.join(' ') + ' -PSA -BGS -SGC -CGC') + '&LH_Sold=1&LH_Complete=1';
  return { url, text: 'Search eBay sold comps for the raw card' };
}

function isStale(c) {
  if (c.estimatedValue == null || !c.datePriced) return false;
  const age = daysSince(c.datePriced);
  return age != null && age > PRICE_STALE_AFTER_DAYS;
}

// submissions.json is fetched alongside cards.json rather than treated as
// optional, since the "Grading submissions" section always renders (even if
// only to show its own empty state) instead of silently staying blank when
// the file is missing or briefly unreachable.
async function loadSubmissions() {
  try {
    const res = await fetch('/cgt/data/submissions.json');
    if (!res.ok) throw new Error('Server returned ' + res.status);
    const data = await res.json();
    submissions = data.submissions || [];
    rawSubmissionsData = data;
  } catch (e) {
    submissions = [];
    rawSubmissionsData = null;
    console.error("Couldn't load submissions.json: " + e.message);
  }
}

// candidates.json is fetched the same way submissions.json is: always, not
// only when something already links to it, so the "Worth grading?" section
// always renders (even if only its own empty state) instead of silently
// staying blank when the file is briefly unreachable.
async function loadCandidates() {
  try {
    const res = await fetch('/cgt/data/candidates.json');
    if (!res.ok) throw new Error('Server returned ' + res.status);
    const data = await res.json();
    candidates = data.candidates || [];
    rawCandidatesData = data;
  } catch (e) {
    candidates = [];
    rawCandidatesData = null;
    console.error("Couldn't load candidates.json: " + e.message);
  }
}

// changelog.json is generated (see public/cgt/data/changelog.js), not
// hand-edited, from this repo's real git history over cards.json,
// submissions.json, and candidates.json. A fresh clone before anyone has
// run that script is a real, expected state (an honest empty state), not a
// load failure, so it never blocks or fails the rest of loadCards.
async function loadChangelog() {
  try {
    const res = await fetch('/cgt/data/changelog.json');
    if (!res.ok) throw new Error('Server returned ' + res.status);
    renderChangelog(await res.json());
  } catch (e) {
    renderChangelog({ entries: [] });
    console.error("Couldn't load changelog.json: " + e.message);
  }
}

function renderChangelog(data) {
  const el = document.getElementById('changelogFeed');
  const entries = (data && data.entries) || [];
  if (entries.length === 0) {
    el.innerHTML = '<p class="changelog-empty">No changelog generated yet. Run ' +
      '<code>node public/cgt/data/changelog.js</code> to build one from this repo&rsquo;s git history.</p>';
    return;
  }
  const rowsHtml = entries.map(e => {
    const files = (e.files || []).join(', ');
    return '<div class="changelog-row' + (e.historyReset ? ' changelog-row-reset' : '') + '">' +
      '<span class="changelog-date font-mono">' + escapeHtml(e.date) + '</span>' +
      '<span class="changelog-hash" title="' + escapeHtml(e.fullHash || e.hash) + '">' + escapeHtml(e.hash) + '</span>' +
      '<span class="changelog-author">' + escapeHtml(e.author) + '</span>' +
      '<span class="changelog-subject' + (e.historyReset ? ' changelog-subject-reset' : '') + '">' +
      (e.historyReset ? '&#9888; ' : '') + escapeHtml(e.subject) + '</span>' +
      (files ? '<span class="changelog-files">touched: ' + escapeHtml(files) + '</span>' : '') +
      '</div>';
  }).join('');
  el.innerHTML = rowsHtml;
  let noteEl = el.nextElementSibling;
  if (!noteEl || !noteEl.classList.contains('changelog-generated-note')) {
    noteEl = document.createElement('p');
    noteEl.className = 'section-note changelog-generated-note';
    el.after(noteEl);
  }
  noteEl.textContent = 'Generated ' + (data.generatedAt || 'at an unknown time').slice(0, 10) +
    ' from ' + (data.generatedFrom || 'git log') + '.';
}

async function loadCards() {
  const errBox = document.getElementById('tableEmpty');
  await loadSubmissions();
  await loadCandidates();
  loadChangelog();
  try {
    const res = await fetch('/cgt/data/cards.json');
    if (!res.ok) throw new Error('Server returned ' + res.status);
    const data = await res.json();
    cards = data.cards || [];
    rawCardsData = data;
    const backupBtn = document.getElementById('backupBtn');
    backupBtn.disabled = false;
    backupBtn.title = '';
    renderStats();
    renderCandidates();
    renderSubmissions();
    renderValueBreakdown();
    renderBiggestMovers();
    renderPortfolioValueTimeline();
    renderPricingActivity();
    renderUnpriced();
    renderDataQuality();
    renderStalePricing();
    renderDuplicates();
    renderGradeLadderFlags();
    renderAttentionBar();
    renderBatchFilter();
    renderInsuranceSummary();
    renderCoverageCheck();
    renderFooterStatus();
    applyFiltersAndRender();
    initTableScrollShadows();
  } catch (e) {
    cards = [];
    rawCardsData = null;
    document.getElementById('cardTableBody').innerHTML = '';
    errBox.hidden = false;
    errBox.setAttribute('role', 'alert');
    errBox.textContent = "Couldn't load cards.json: " + e.message;
    const backupBtn = document.getElementById('backupBtn');
    backupBtn.disabled = true;
    backupBtn.title = "Can't back up, cards.json failed to load (see below)";
  }
}

// Real per-file counts instead of a hand-typed claim about which files still
// only hold their placeholder example row: that claim goes stale the moment
// real rows are actually logged into one file but not the others (which is
// exactly what happened once candidates.json got its real 2026-07-17 raw-card
// sweep before submissions.json had any real submission logged), so it's
// computed the same way every other real-vs-placeholder distinction on this
// page is, from the loaded data itself.
function renderFooterStatus() {
  const el = document.getElementById('footerDataStatus');
  if (!el) return;
  const realCardsCount = cards.filter(c => !isExample(c)).length;
  const realSubsCount = submissions.filter(s => !isExampleSubmission(s)).length;
  const realCandsCount = candidates.filter(c => !isExampleCandidate(c)).length;
  const clause = (count, file, noun) => count
    ? count + ' real ' + noun + (count === 1 ? '' : 's') + ' logged in <code>' + file + '</code>'
    : '<code>' + file + '</code> still only holds its placeholder example row';
  el.innerHTML = clause(realCardsCount, 'cards.json', 'card') + '; ' +
    clause(realSubsCount, 'submissions.json', 'submission') + '; ' +
    clause(realCandsCount, 'candidates.json', 'candidate') +
    '. Log more by hand (or Import CSV) as real cards get priced, batches go out, and raw cards get weighed.';
}

function renderStats() {
  const real = cards.filter(c => !isExample(c));
  // A sold card stays in cards.json as a permanent record but no longer
  // belongs to any "what do I currently hold" total below (portfolio value,
  // basis/sport/cost-basis breakdowns, staleness): it's not part of the
  // collection anymore, so it should not count toward its value either.
  const owned = real.filter(c => !isSold(c));
  const sold = real.filter(isSold);
  const priced = owned.filter(c => c.estimatedValue != null);
  const totalValue = priced.reduce((s, c) => s + c.estimatedValue, 0);
  const saleCards = priced.filter(c => c.valuationBasis === 'recent-sale');
  const compCards = priced.filter(c => c.valuationBasis === 'comp-estimate');
  const saleValue = saleCards.reduce((s, c) => s + c.estimatedValue, 0);
  const compValue = compCards.reduce((s, c) => s + c.estimatedValue, 0);
  const stale = priced.filter(isStale).length;
  // Built from whatever sport values actually appear on currently-owned
  // cards, not a hardcoded hockey/baseball/football list, so a card logged
  // under any other sport still shows up here instead of being silently
  // uncounted.
  const bySportCounts = new Map();
  owned.forEach(c => { if (c.sport) bySportCounts.set(c.sport, (bySportCounts.get(c.sport) || 0) + 1); });
  const bySportBreakdown = [...bySportCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([sport, count]) => sport.charAt(0).toUpperCase() + sport.slice(1) + ' ' + count)
    .join(' / ');

  // Only counts cards where both a real purchase price and a real researched
  // value are on record, same rule as computeGainLoss. A card with only one
  // of the two contributes to neither side, rather than being treated as a
  // break-even or a total-loss by assuming the missing field is zero.
  const withCostBasis = owned.filter(c => c.costBasis != null && c.estimatedValue != null);
  const totalCostBasis = withCostBasis.reduce((s, c) => s + c.costBasis, 0);
  const totalCurrentValue = withCostBasis.reduce((s, c) => s + c.estimatedValue, 0);
  const netGainLoss = totalCurrentValue - totalCostBasis;
  const netGainLossPct = totalCostBasis > 0 ? (netGainLoss / totalCostBasis) * 100 : null;

  // Realized gain/loss is the sold-card counterpart to the unrealized tile
  // above: only counts a sale where a real costBasis is also on record, same
  // "never guess at a missing side" rule. A card sold with no logged
  // costBasis has a real sale price but nothing to compare it against yet.
  const soldWithGainLoss = sold.map(c => ({ c, gl: computeRealizedGainLoss(c) })).filter(x => x.gl);
  const totalRealizedGainLoss = soldWithGainLoss.reduce((s, x) => s + x.gl.abs, 0);
  const totalRealizedCostBasis = soldWithGainLoss.reduce((s, x) => s + x.c.costBasis, 0);
  const realizedGainLossPct = totalRealizedCostBasis > 0 ? (totalRealizedGainLoss / totalRealizedCostBasis) * 100 : null;
  const totalSoldProceeds = sold.reduce((s, c) => s + (c.soldPrice || 0), 0);

  // Only counts cardCount on active (non-returned, non-example) submissions,
  // same "real data only" rule as every other tile here: a submission with
  // no cardCount logged contributes 0 to the total but still counts toward
  // the submission count in the sub-label, rather than being dropped silently.
  const activeSubmissions = submissions.filter(s => s.status !== 'returned' && !isExampleSubmission(s));
  const activeExampleSubmission = submissions.some(s => s.status !== 'returned' && isExampleSubmission(s));
  const cardsOutForGrading = activeSubmissions.reduce((s, x) => s + (x.cardCount || 0), 0);

  // Grading fees are logged per batch (submissions.json), not per card, since
  // a single invoice covers the whole submission rather than any one card
  // coming back from it. Summed across every real submission regardless of
  // status (active or returned) since a fee was actually paid either way,
  // unlike cardsOutForGrading above which only makes sense for active ones.
  const realSubmissions = submissions.filter(s => !isExampleSubmission(s));
  const submissionsWithCost = realSubmissions.filter(s => s.cost != null);
  const totalGradingFees = submissionsWithCost.reduce((s, x) => s + x.cost, 0);

  // Only counts real (non-example) candidates that still have no logged
  // decision, since one already marked submit/hold/sell-raw/pass has already
  // been acted on and isn't "still being weighed" anymore.
  const realCandidates = candidates.filter(c => !isExampleCandidate(c));
  const openCandidates = realCandidates.filter(c => !c.decision);
  const worthGradingCount = openCandidates.filter(c => computeGradingMath(c)?.verdict === 'worth-grading').length;

  // Only counts cards that have actually been re-priced (a priceHistory entry
  // to compare the current number against), the same real-data-only rule as
  // every other tile: a card priced exactly once has no trend yet, it isn't
  // counted as "flat".
  const trended = owned.map(c => ({ c, trend: computeValueTrend(c) })).filter(x => x.trend);
  const trendingUp = trended.filter(x => x.trend.abs > 0).length;
  const trendingDown = trended.filter(x => x.trend.abs < 0).length;
  const trendingFlat = trended.length - trendingUp - trendingDown;

  // Real appraisal/insurance guidance (e.g. collectable.live's collectibles
  // inventory guide) calls out per-item storage location as part of what a
  // real claim needs, and the insurance print view already shows it per card
  // when logged. Only measured against priced cards, since an unpriced card
  // isn't part of the insurable total yet either.
  const withStorageLocation = priced.filter(c => c.storageLocation).length;

  const tiles = [
    {
      value: real.length,
      label: 'Cards logged',
      sub: [cards.length !== real.length ? '+ 1 example row' : null, sold.length ? sold.length + ' sold' : null]
        .filter(Boolean).join(' · ') || null
    },
    { value: priced.length ? formatUsd(totalValue) : '$0', label: 'Total estimated value', sub: priced.length ? priced.length + ' priced, currently held' : 'nothing priced yet' },
    {
      value: activeSubmissions.length ? cardsOutForGrading : 0,
      label: 'Cards out for grading',
      sub: activeSubmissions.length
        ? activeSubmissions.length + ' submission(s) in progress'
        : 'nothing real submitted yet' + (activeExampleSubmission ? ' (+ 1 example row)' : '')
    },
    {
      value: submissionsWithCost.length ? formatUsd(totalGradingFees) : '$0',
      label: 'Grading fees paid',
      sub: submissionsWithCost.length
        ? submissionsWithCost.length + ' of ' + realSubmissions.length + ' submission(s) with a fee logged'
        : (realSubmissions.length ? 'no fees logged yet' : 'nothing real submitted yet')
    },
    {
      value: openCandidates.length ? worthGradingCount : 0,
      label: 'Candidates worth grading',
      sub: openCandidates.length
        ? 'of ' + openCandidates.length + ' still being weighed'
        : (realCandidates.length ? 'all candidates already decided' : 'nothing real logged yet')
    },
    // Splitting the dollar total by basis, not just the card count, makes the
    // "how much of this is a real sale vs. an estimate" question answerable
    // at a glance, which is the whole point of never blending the two silently.
    { value: saleCards.length, label: 'Recent-sale priced', sub: saleCards.length ? formatUsd(saleValue) : null },
    { value: compCards.length, label: 'Comp-estimate priced', sub: compCards.length ? formatUsd(compValue) : null },
    {
      value: withCostBasis.length ? formatSignedUsd(netGainLoss) : 'n/a',
      label: 'Unrealized gain / loss',
      sub: withCostBasis.length
        ? withCostBasis.length + ' card(s) with cost basis logged' + (netGainLossPct != null ? ' · ' + (netGainLossPct >= 0 ? '+' : '') + netGainLossPct.toFixed(1) + '%' : '')
        : 'no purchase prices logged yet',
      cls: withCostBasis.length ? (netGainLoss >= 0 ? 'positive' : 'negative') : null
    },
    {
      value: sold.length ? formatUsd(totalSoldProceeds) : '$0',
      label: 'Cards sold',
      sub: sold.length ? sold.length + ' card(s), total sale proceeds' : 'nothing sold yet'
    },
    {
      value: soldWithGainLoss.length ? formatSignedUsd(totalRealizedGainLoss) : 'n/a',
      label: 'Realized gain / loss',
      sub: soldWithGainLoss.length
        ? soldWithGainLoss.length + ' sale(s) with cost basis logged' + (realizedGainLossPct != null ? ' · ' + (realizedGainLossPct >= 0 ? '+' : '') + realizedGainLossPct.toFixed(1) + '%' : '')
        : (sold.length ? 'no cost basis logged for sold cards yet' : 'nothing sold yet'),
      cls: soldWithGainLoss.length ? (totalRealizedGainLoss >= 0 ? 'positive' : 'negative') : null
    },
    { value: stale, label: 'Priced 180+ days ago', sub: stale ? 'worth a re-check' : null },
    {
      value: trended.length ? (trendingUp + ' up / ' + trendingDown + ' down') : 'n/a',
      label: 'Price trend since last check',
      sub: trended.length
        ? (trendingFlat ? trendingFlat + ' unchanged' : null)
        : 'no cards re-priced yet',
      cls: trended.length ? (trendingUp > trendingDown ? 'positive' : (trendingDown > trendingUp ? 'negative' : null)) : null
    },
    { value: bySportBreakdown || 'n/a', label: 'Cards by sport', sub: null },
    {
      value: priced.length ? withStorageLocation + ' / ' + priced.length : 'n/a',
      label: 'Storage location logged',
      sub: priced.length
        ? (withStorageLocation ? 'of priced cards, for the insurance summary' : 'none logged yet, worth backfilling for insurance')
        : 'nothing priced yet',
      cls: priced.length ? (withStorageLocation === priced.length ? 'positive' : (withStorageLocation === 0 ? 'negative' : null)) : null
    }
  ];

  document.getElementById('statRow').innerHTML = tiles.map(t => `
    <div class="stat-tile">
      <div class="stat-tile-value font-display${t.cls ? ' ' + t.cls : ''}">${escapeHtml(String(t.value))}</div>
      <div class="stat-tile-label">${escapeHtml(t.label)}</div>
      ${t.sub ? `<div class="stat-tile-sub">${escapeHtml(t.sub)}</div>` : ''}
    </div>
  `).join('');
}

// Groups real priced cards' estimatedValue by one field (sport or
// gradingCompany) and renders it as a horizontal bar list, widest first. This
// is the "portfolio value by category" breakdown that CollX/Card Ladder-style
// trackers lead with; it reads straight off each card's own real fields, so an
// empty or single-example dataset just renders the honest empty state below
// rather than a chart with nothing in it.
function buildValueGroups(field) {
  const priced = cards.filter(c => !isExample(c) && !isSold(c) && c.estimatedValue != null && c[field]);
  const totals = new Map();
  priced.forEach(c => totals.set(c[field], (totals.get(c[field]) || 0) + c.estimatedValue));
  return [...totals.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
}

// Same shape as buildValueGroups, but grouped by "<grader> <grade>" (e.g.
// "PSA 10") rather than a single field. This is the personal-portfolio
// equivalent of the population/pop reports PSA, SGC, and CGC publish
// (how many of my own cards sit at each grade, and how much of my money is
// riding on the top grade vs. the rest), which is exactly the breakdown
// GradedFolio and Card Ladder lead with once a grader's own pop report is
// merged with a real collection. Grade alone is skipped here since "10" from
// PSA and "10" from SGC track very different markets.
function buildValueGroupsByGrade() {
  const priced = cards.filter(c => !isExample(c) && !isSold(c) && c.estimatedValue != null && c.gradingCompany && c.grade != null);
  const totals = new Map();
  priced.forEach(c => {
    const label = c.gradingCompany + ' ' + c.grade;
    totals.set(label, (totals.get(label) || 0) + c.estimatedValue);
  });
  return [...totals.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
}

// Groups real priced cards' estimatedValue by card year. "By year" is one of
// the standard facets industry trackers (Sports Card Investor's Market
// Movers among them) break a collection's value down by alongside sport and
// grade, so it belongs next to the other breakdown cards here. Sorted newest
// year first rather than by value like the other breakdown cards, since a
// year list reads as a timeline and a value-sorted year list would not.
function buildValueGroupsByYear() {
  const priced = cards.filter(c => !isExample(c) && !isSold(c) && c.estimatedValue != null && c.year != null);
  const totals = new Map();
  priced.forEach(c => totals.set(c.year, (totals.get(c.year) || 0) + c.estimatedValue));
  return [...totals.entries()]
    .map(([year, value]) => ({ label: String(year), value }))
    .sort((a, b) => Number(b.label) - Number(a.label));
}

// Groups real priced cards' estimatedValue by backlogBatch, the label for
// which real pricing sweep a card was researched in (e.g. one binder page or
// one sport's backlog pass). Sorted newest batch first, same as "By year",
// since a batch is a point in time rather than a value to rank; this answers
// "how much did each real research session actually turn up", which is the
// natural next question once the 2026-08-08 full backlog sweep is broken
// into its component batches. Cards with no backlogBatch logged are skipped,
// same as buildValueGroups skips a falsy field on any other breakdown.
function buildValueGroupsByBatch() {
  const priced = cards.filter(c => !isExample(c) && !isSold(c) && c.estimatedValue != null && c.backlogBatch);
  const totals = new Map();
  priced.forEach(c => totals.set(c.backlogBatch, (totals.get(c.backlogBatch) || 0) + c.estimatedValue));
  return [...totals.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.label.localeCompare(a.label));
}

// Groups real priced cards' estimatedValue by storageLocation. Real
// collectibles-insurance guidance treats where an item is actually kept as
// part of its risk profile, a home safe, an off-site safe deposit box, and
// a public storage unit each carry different coverage conditions, so how
// much real logged value sits in one place is worth seeing on its own, not
// just the "how many cards have a location logged" count already in the
// stat row. Reuses buildValueGroups directly (storageLocation is a plain
// string field, same shape as sport/gradingCompany), a card with no
// storageLocation logged is skipped here the same way any other blank
// field is skipped in the other breakdowns.
function buildValueGroupsByStorageLocation() {
  return buildValueGroups('storageLocation');
}

// formatValue and emptyText are overridable since this same row/bar layout
// also drives the grading-turnaround card below, where the value is a day
// count with a returned-submission tally attached, not a plain dollar figure.
function renderBreakdownList(title, groups, opts) {
  opts = opts || {};
  const formatValue = opts.formatValue || (g => formatUsd(g.value));
  const emptyText = opts.emptyText || 'No priced real cards yet.';
  if (!groups.length) {
    return `
      <div class="breakdown-card">
        <h3 class="breakdown-title font-mono">${escapeHtml(title)}</h3>
        <p class="breakdown-empty">${escapeHtml(emptyText)}</p>
      </div>
    `;
  }
  const max = Math.max(...groups.map(g => g.value));
  // title carries the untruncated label: .breakdown-label clips long ones
  // with an ellipsis (batch labels especially, which are date-prefixed
  // slugs long enough that several can share the same visible prefix), and
  // without this a truncated row is otherwise indistinguishable from
  // another one, with no way to tell them apart except by hovering.
  const rows = groups.map(g => `
    <div class="breakdown-row">
      <span class="breakdown-label" title="${escapeHtml(g.label)}">${escapeHtml(g.label)}</span>
      <span class="breakdown-bar-track">
        <span class="breakdown-bar-fill" style="width:${max ? (g.value / max * 100) : 0}%"></span>
      </span>
      <span class="breakdown-value font-mono">${escapeHtml(formatValue(g))}</span>
    </div>
  `).join('');
  return `
    <div class="breakdown-card">
      <h3 class="breakdown-title font-mono">${escapeHtml(title)}</h3>
      <div class="breakdown-list">${rows}</div>
    </div>
  `;
}

// Calendar days between a submission actually shipping out and actually
// arriving back, only counted once both real dates are on record and the
// batch is marked returned, so a submission still in queue never
// contributes a partial number that would understate the real wait.
function computeTurnaroundDays(s) {
  if (s.status !== 'returned' || !s.submittedDate || !s.returnedDate) return null;
  const start = new Date(s.submittedDate + 'T00:00:00').getTime();
  const end = new Date(s.returnedDate + 'T00:00:00').getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.round((end - start) / 86400000);
}

// Averages real turnaround per grading company, which is the practical
// question this data answers over time: which grader has actually been
// fastest for cards Jack has sent, not a published/advertised turnaround
// time. min/max are carried alongside the average since one outlier batch
// (e.g. a holiday-season slowdown) can otherwise make an average look more
// consistent than the real spread was.
function buildTurnaroundByGrader() {
  const byGrader = new Map();
  submissions.forEach(s => {
    if (isExampleSubmission(s)) return;
    const days = computeTurnaroundDays(s);
    if (days == null) return;
    const key = s.gradingCompany || 'Unknown';
    if (!byGrader.has(key)) byGrader.set(key, []);
    byGrader.get(key).push(days);
  });
  return [...byGrader.entries()]
    .map(([grader, list]) => ({
      label: grader,
      value: Math.round(list.reduce((a, b) => a + b, 0) / list.length),
      count: list.length,
      min: Math.min(...list),
      max: Math.max(...list)
    }))
    .sort((a, b) => a.value - b.value);
}

function renderValueBreakdown() {
  const el = document.getElementById('breakdownGrid');
  el.innerHTML =
    renderBreakdownList('By sport', buildValueGroups('sport')) +
    renderBreakdownList('By grading company', buildValueGroups('gradingCompany')) +
    renderBreakdownList('By grade', buildValueGroupsByGrade()) +
    renderBreakdownList('By year', buildValueGroupsByYear()) +
    renderBreakdownList('By pricing batch', buildValueGroupsByBatch(), {
      emptyText: 'No priced real cards with a backlogBatch logged yet.'
    }) +
    renderBreakdownList('By storage location', buildValueGroupsByStorageLocation(), {
      emptyText: 'No priced real cards with a storageLocation logged yet.'
    }) +
    renderBreakdownList('Avg. grading turnaround', buildTurnaroundByGrader(), {
      formatValue: g => g.value + 'd avg (' + g.min + '-' + g.max + 'd, ' + g.count + ' returned)',
      emptyText: 'No returned submissions with both dates logged yet.'
    });
}

// "Biggest gainers/losers" leaderboard, the feature real collectible-portfolio
// trackers (Collectr, Card Codex) lead with: which specific cards actually
// moved the most, not just the up/down counts already in the stat row. Only
// ever reads computeValueTrend's real prior price, so a card priced exactly
// once (no priceHistory to compare against) never appears here.
const MOVERS_LIST_LIMIT = 5;

function buildBiggestMovers() {
  const trended = cards
    .filter(c => !isExample(c) && !isSold(c))
    .map(c => ({ c, trend: computeValueTrend(c) }))
    .filter(x => x.trend && x.trend.abs !== 0);
  const gainers = trended.filter(x => x.trend.abs > 0).sort((a, b) => b.trend.abs - a.trend.abs).slice(0, MOVERS_LIST_LIMIT);
  const losers = trended.filter(x => x.trend.abs < 0).sort((a, b) => a.trend.abs - b.trend.abs).slice(0, MOVERS_LIST_LIMIT);
  return { gainers, losers };
}

function renderMoversList(entries, emptyText) {
  if (!entries.length) return `<p class="movers-empty">${escapeHtml(emptyText)}</p>`;
  return entries.map(({ c, trend }) => `
    <button type="button" class="movers-row" data-id="${escapeHtml(c.id)}">
      <span class="movers-name">${escapeHtml(c.cardName || 'Untitled card')}</span>
      <span class="movers-meta">${escapeHtml([c.sport, c.gradingCompany, c.grade].filter(Boolean).join(' · '))}</span>
      <span class="movers-change font-mono ${trend.abs >= 0 ? 'positive' : 'negative'}">${escapeHtml(formatSignedUsd(trend.abs))}${trend.pct != null ? ' (' + (trend.pct >= 0 ? '+' : '') + trend.pct.toFixed(0) + '%)' : ''}</span>
    </button>
  `).join('');
}

function renderBiggestMovers() {
  const section = document.getElementById('moversSection');
  const { gainers, losers } = buildBiggestMovers();
  if (!gainers.length && !losers.length) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  document.getElementById('moversGainersList').innerHTML = renderMoversList(gainers, 'No re-priced cards have gone up yet.');
  document.getElementById('moversLosersList').innerHTML = renderMoversList(losers, 'No re-priced cards have gone down yet.');
  section.querySelectorAll('.movers-row').forEach(row => {
    row.addEventListener('click', () => openModal(row.dataset.id));
  });
}

// Reconstructs the real collection's total value at every distinct date any
// unsold, priced real card actually had a value on record (its current
// datePriced plus every dated entry in its own priceHistory), the "value over
// time" trend CollX and Card Ladder-style trackers lead with once a
// collection has real re-pricing history. At each snapshot date a card counts
// at the latest real value it had on or before that date (not counted at all
// before its first real price, dropped entirely once its own soldDate has
// passed, same scope as every other portfolio total on this page). Returns
// null when fewer than two distinct real dates exist across the whole
// collection, since one shared date (or none) is not a trend, it is
// everything having been priced once on the same day.
function buildPortfolioValueTimeline() {
  const perCard = cards
    .filter(c => !isExample(c) && c.estimatedValue != null && c.datePriced)
    .map(c => {
      const points = (c.priceHistory || [])
        .filter(p => p.date && p.value != null)
        .map(p => ({ date: p.date, value: p.value }));
      points.push({ date: c.datePriced, value: c.estimatedValue });
      points.sort((a, b) => a.date.localeCompare(b.date));
      return { card: c, points };
    });
  if (!perCard.length) return null;

  const allDates = new Set();
  perCard.forEach(({ points }) => points.forEach(p => allDates.add(p.date)));
  const sortedDates = [...allDates].sort();
  if (sortedDates.length < 2) return null;

  return sortedDates.map(date => {
    let total = 0;
    let countedCards = 0;
    perCard.forEach(({ card, points }) => {
      if (isSold(card) && card.soldDate && card.soldDate <= date) return;
      const known = points.filter(p => p.date <= date);
      if (!known.length) return;
      total += known[known.length - 1].value;
      countedCards++;
    });
    return { date, total, countedCards };
  });
}

// Each timeline dot's real per-point data (exact date, dollar total, card
// count) lives in a native SVG <title>, which is hover-only: confirmed no
// tap, no long-press, nothing renders on touch, and no keyboard focus path
// either. This is the tap/click + keyboard fallback (same pattern as the
// main dashboard's relation-line tooltip fix): a real tooltip element,
// created on demand since this page's HTML has no static spot for one,
// shown near the tap/click point and dismissed on outside click, Escape, or
// activating the same dot again. The <title> stays for free desktop hover.
function ensureTimelineTooltip() {
  let el = document.getElementById('timelineTooltip');
  if (!el) {
    el = document.createElement('div');
    el.id = 'timelineTooltip';
    el.className = 'timeline-tooltip';
    el.setAttribute('role', 'status');
    el.hidden = true;
    document.body.appendChild(el);
  }
  return el;
}
function showTimelineTooltip(text, x, y) {
  const el = ensureTimelineTooltip();
  el.textContent = text;
  el.hidden = false;
  // Clamp so it never renders off the right/bottom edge of the viewport.
  const rect = el.getBoundingClientRect();
  const left = Math.min(x + 10, window.innerWidth - rect.width - 12);
  const top = Math.min(y + 14, window.innerHeight - rect.height - 12);
  el.style.left = Math.max(12, left) + 'px';
  el.style.top = Math.max(12, top) + 'px';
  el.dataset.openFor = text;
}
function hideTimelineTooltip() {
  const el = document.getElementById('timelineTooltip');
  if (!el) return;
  el.hidden = true;
  delete el.dataset.openFor;
}
function toggleTimelineTooltip(dotEl, x, y) {
  const el = ensureTimelineTooltip();
  const text = dotEl.getAttribute('data-point');
  if (!el.hidden && el.dataset.openFor === text) {
    hideTimelineTooltip();
  } else {
    showTimelineTooltip(text, x, y);
  }
}
document.addEventListener('click', (e) => {
  if (!e.target.closest('.timeline-dot')) hideTimelineTooltip();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideTimelineTooltip();
});

// Hand-rolled inline SVG line chart rather than pulling in a charting library
// for one chart. Points are spaced evenly by index, not truly proportional to
// the real calendar gaps between them, since those gaps are irregular and the
// point here is the real shape of the trend and the real totals (given as an
// accessible label plus a per-point <title> and the two endpoint captions
// below it), not exact time spacing.
function renderPortfolioValueTimeline() {
  const el = document.getElementById('valueTimelineChart');
  const series = buildPortfolioValueTimeline();
  if (!series) {
    el.innerHTML = '<p class="activity-empty" role="status">Not enough real re-pricing history yet to chart a ' +
      'trend. This needs at least two distinct real dates (from <code class="inline-code">datePriced</code> or ' +
      '<code class="inline-code">priceHistory</code>) across the priced, unsold collection; right now everything ' +
      'priced shares one date, or nothing is priced yet. It fills in on its own as cards get re-priced over ' +
      'time.</p>';
    return;
  }
  const width = 720, height = 220, padX = 12, padY = 24;
  const values = series.map(p => p.total);
  const minV = Math.min(...values), maxV = Math.max(...values);
  const range = maxV - minV || 1;
  const xStep = (width - padX * 2) / (series.length - 1);
  const xFor = i => padX + i * xStep;
  const yFor = v => height - padY - ((v - minV) / range) * (height - padY * 2);
  const pathD = series.map((p, i) => (i === 0 ? 'M' : 'L') + xFor(i).toFixed(1) + ',' + yFor(p.total).toFixed(1)).join(' ');
  const baseline = (height - padY).toFixed(1);
  const areaD = pathD + ` L${xFor(series.length - 1).toFixed(1)},${baseline} L${xFor(0).toFixed(1)},${baseline} Z`;
  const dots = series.map((p, i) => {
    const label = `${p.date}: ${formatUsd(p.total)} (${p.countedCards} card${p.countedCards === 1 ? '' : 's'})`;
    return `<circle cx="${xFor(i).toFixed(1)}" cy="${yFor(p.total).toFixed(1)}" r="3.5" class="timeline-dot" tabindex="0" role="img" aria-label="${escapeHtml(label)}" data-point="${escapeHtml(label)}"><title>${escapeHtml(label)}</title></circle>`;
  }).join('');
  const first = series[0], last = series[series.length - 1];
  el.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" class="timeline-svg" role="img" aria-label="Real portfolio total value from ${escapeHtml(first.date)} (${escapeHtml(formatUsd(first.total))}) to ${escapeHtml(last.date)} (${escapeHtml(formatUsd(last.total))}), ${series.length} real pricing dates">
      <path d="${areaD}" class="timeline-area"></path>
      <path d="${pathD}" class="timeline-line"></path>
      ${dots}
    </svg>
    <div class="timeline-endpoints font-mono">
      <span>${escapeHtml(first.date)} &middot; ${escapeHtml(formatUsd(first.total))}</span>
      <span>${escapeHtml(last.date)} &middot; ${escapeHtml(formatUsd(last.total))}</span>
    </div>
  `;
  el.querySelectorAll('.timeline-dot').forEach(dot => {
    dot.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleTimelineTooltip(dot, e.clientX, e.clientY);
    });
    dot.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const rect = dot.getBoundingClientRect();
        toggleTimelineTooltip(dot, rect.left + rect.width / 2, rect.top);
      } else if (e.key === 'Escape') {
        hideTimelineTooltip();
      }
    });
  });
}

// Pulls "what got priced when" out of every card's own datePriced/backlogBatch
// fields into one chronological feed, newest first, the same pattern already
// used for Recent Activity in CSM/Garage/Sondrik. Reuses real per-card data,
// does not add anything new; without this the only way to see pricing history
// was scanning the whole table for datePriced values by eye.
const PRICING_ACTIVITY_PREVIEW_COUNT = 8;

function buildPricingEvents() {
  return cards
    .filter(c => !isExample(c) && c.datePriced)
    .slice()
    .sort((a, b) => b.datePriced.localeCompare(a.datePriced));
}

function renderPricingActivity() {
  const el = document.getElementById('activityFeed');
  const events = buildPricingEvents();
  if (!events.length) {
    el.innerHTML = '<p class="activity-empty" role="status">No pricing activity logged yet. Once a card ' +
      'gets a real datePriced, it shows up here in one feed, newest first, instead of only being visible by ' +
      'scanning the whole table.</p>';
    return;
  }
  const needsToggle = events.length > PRICING_ACTIVITY_PREVIEW_COUNT;
  const rowsHtml = events.map(c => `
    <div class="activity-row">
      <span class="activity-date font-mono">${escapeHtml(c.datePriced)}</span>
      ${basisBadge(c)}
      <span class="activity-who">${escapeHtml(c.cardName || 'Untitled card')}</span>
      <span class="activity-label">${c.backlogBatch ? escapeHtml(c.backlogBatch) : 'no batch logged'}</span>
    </div>
  `).join('');
  el.innerHTML = `<div class="activity-list${needsToggle ? ' is-collapsed' : ''}" id="pricingActivityList">${rowsHtml}</div>` +
    (needsToggle ? `<button type="button" class="activity-toggle font-mono" id="pricingActivityToggle" aria-expanded="false" aria-controls="pricingActivityList">Show all ${events.length}</button>` : '');
  const toggleBtn = document.getElementById('pricingActivityToggle');
  const listEl = document.getElementById('pricingActivityList');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      const collapsed = listEl.classList.toggle('is-collapsed');
      toggleBtn.textContent = collapsed ? `Show all ${events.length}` : 'Show fewer';
      toggleBtn.setAttribute('aria-expanded', String(!collapsed));
    });
  }
}

function isExampleCandidate(c) {
  return c.id === 'example-candidate-not-real';
}

// Applies the published "2x margin" rule of thumb for whether grading a raw
// card is actually worth it (see e.g. CardGrade.io's and PreGradeCards' 2026
// grading-ROI writeups): the expected gain over raw value should clear the
// full cost of grading by at least 2x before committing, since the card
// could come back at a lower grade than expected and a 1x-or-less margin
// leaves no room for that risk. Returns null (not a verdict) whenever any of
// the three real numbers this depends on hasn't actually been researched
// yet, same "never guess at a missing input" rule as everything else here.
const GRADING_RISK_MULTIPLE = 2;

function computeGradingMath(c) {
  if (c.rawValue == null || c.expectedGradedValue == null || c.estimatedGradingCost == null) return null;
  const totalCost = c.estimatedGradingCost + (c.shippingCost || 0);
  // The "2x margin" rule above is about the raw upside (graded value over
  // raw value) clearing the cost of grading by 2x, not the already-cost-net
  // expectedGain clearing it a second time (that silently demanded a 3x
  // margin instead of the documented 2x, since expectedGain is gross minus
  // totalCost already). expectedGain itself stays net, it is the real
  // "Expected gain" figure shown and sorted on elsewhere.
  const grossGain = c.expectedGradedValue - c.rawValue;
  const expectedGain = grossGain - totalCost;
  let verdict;
  if (grossGain >= totalCost * GRADING_RISK_MULTIPLE) verdict = 'worth-grading';
  else if (expectedGain > 0) verdict = 'marginal';
  else verdict = 'not-worth';
  return { totalCost, expectedGain, verdict };
}

const CANDIDATE_VERDICT_META = {
  'worth-grading': { label: 'Worth grading', cls: 'badge-worth' },
  marginal: { label: 'Marginal', cls: 'badge-marginal' },
  'not-worth': { label: 'Not worth it', cls: 'badge-notworth' },
  'needs-data': { label: 'Needs more data', cls: 'badge-needsdata' }
};

// Raw-card candidates being weighed against the real cost of grading them,
// sorted by expected dollar gain (highest first) so the most clear-cut "yes,
// send this one" cases lead the list; a candidate missing one of the three
// real inputs the math needs sorts last, same "unknown sinks to the bottom"
// rule the main table's sortRows uses.
function buildRankedCandidates() {
  return candidates
    .map(c => ({ c, math: computeGradingMath(c) }))
    .sort((a, b) => {
      if (!a.math && !b.math) return 0;
      if (!a.math) return 1;
      if (!b.math) return -1;
      return b.math.expectedGain - a.math.expectedGain;
    });
}

// Same search/sport/verdict filtering convention as the main inventory table
// (matchesSearchTerm/matchesSportValue/facetCount above), kept as a separate
// set of predicates since candidates use a computed verdict rather than a
// stored field and have no grader/basis/ownership dimensions to filter by.
function matchesCandidateSearchTerm(c, term) {
  term = term.trim().toLowerCase();
  return !term
    || (c.cardName || '').toLowerCase().includes(term)
    || (c.notes || '').toLowerCase().includes(term)
    || (c.rawValueNote || '').toLowerCase().includes(term)
    || (c.gradedValueNote || '').toLowerCase().includes(term);
}
function matchesCandidateSportValue(c, sport) { return sport === 'all' || c.sport === sport; }
function matchesCandidateVerdictValue(verdictKey, verdict) { return verdict === 'all' || verdictKey === verdict; }
// "Decided" means a real decision has been logged (hold/sell-raw/submit/
// pass), regardless of which one, since the point of this filter is telling
// a candidate that's already been weighed apart from one that hasn't, not
// distinguishing between the decisions themselves (the verdict chips above
// already cover the worth-grading math independent of this).
function matchesCandidateStatusValue(c, status) {
  return status === 'all' || (status === 'open' ? !c.decision : !!c.decision);
}

function matchesCandidateFilters(c, verdictKey) {
  return matchesCandidateSearchTerm(c, candidateSearchTerm)
    && matchesCandidateSportValue(c, activeCandidateSport)
    && matchesCandidateVerdictValue(verdictKey, activeCandidateVerdict)
    && matchesCandidateStatusValue(c, activeCandidateStatus);
}

function anyCandidateFilterActive() {
  return candidateSearchTerm.trim() !== '' || activeCandidateSport !== 'all' || activeCandidateVerdict !== 'all'
    || activeCandidateStatus !== 'all';
}

function candidateFacetCount(dimension, value, ranked) {
  return ranked.filter(({ c, math }) => {
    const verdictKey = math ? math.verdict : 'needs-data';
    if (!matchesCandidateSearchTerm(c, candidateSearchTerm)) return false;
    if (dimension !== 'sport' && !matchesCandidateSportValue(c, activeCandidateSport)) return false;
    if (dimension !== 'verdict' && !matchesCandidateVerdictValue(verdictKey, activeCandidateVerdict)) return false;
    if (dimension !== 'status' && !matchesCandidateStatusValue(c, activeCandidateStatus)) return false;
    if (dimension === 'sport') return matchesCandidateSportValue(c, value);
    if (dimension === 'verdict') return matchesCandidateVerdictValue(verdictKey, value);
    if (dimension === 'status') return matchesCandidateStatusValue(c, value);
    return true;
  }).length;
}

const CANDIDATE_FACET_DIMENSIONS = [
  ['candidateSportFilter', 'data-cand-sport', 'sport'],
  ['candidateVerdictFilter', 'data-cand-verdict', 'verdict'],
  ['candidateStatusFilter', 'data-cand-status', 'status']
];

// Takes the already-built ranked list rather than rebuilding it per chip:
// buildRankedCandidates() maps every candidate through computeGradingMath()
// and sorts the result, so calling it once here and reusing it across all
// 12 real filter chips (4 sport + 5 verdict + 3 status) avoids redoing that
// same map+sort 12 extra times on every single render (a keystroke in the
// search box, a chip click, a candidate edit save), against the real 86-row
// candidates.json this runs on.
function updateCandidateChipCounts(ranked) {
  CANDIDATE_FACET_DIMENSIONS.forEach(([containerId, dataAttr, dimension]) => {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.querySelectorAll('.chip').forEach(chip => {
      const countEl = chip.querySelector('.chip-count');
      if (!countEl) return;
      const value = chip.getAttribute(dataAttr);
      const count = candidateFacetCount(dimension, value, ranked);
      countEl.textContent = ' ' + count;
      chip.classList.toggle('chip-zero', count === 0 && chip.getAttribute('aria-pressed') !== 'true');
    });
  });
}

function renderCandidates() {
  syncUrl();
  const el = document.getElementById('candidatesFeed');
  const ranked = buildRankedCandidates();
  updateCandidateChipCounts(ranked);
  document.getElementById('candidatesClearFiltersBtn').hidden = !anyCandidateFilterActive();

  // rawCandidatesData is only ever null when loadCandidates' own fetch/parse
  // failed (see app.js's loadCandidates), never for a real, honestly-empty
  // candidates.json, so this is what tells a load failure apart from "log one
  // now" here, same distinction loadCards' own tableEmpty already makes.
  if (rawCandidatesData === null) {
    el.innerHTML = '<p class="submissions-empty" role="alert">Failed to load candidates.json.</p>';
    document.getElementById('candidatesFilterStatus').textContent = '';
    return;
  }

  if (!ranked.length) {
    el.innerHTML = '<p class="submissions-empty" role="status">No raw-card candidates logged yet.' +
      emptyStateCta('quickLogCandidateTool', 'quickCandidateForm', 'Log one now') + '</p>';
    document.getElementById('candidatesFilterStatus').textContent = '';
    return;
  }

  const filtered = ranked.filter(({ c, math }) => matchesCandidateFilters(c, math ? math.verdict : 'needs-data'));

  const status = document.getElementById('candidatesFilterStatus');
  status.textContent = anyCandidateFilterActive()
    ? filtered.length + ' candidate' + (filtered.length === 1 ? '' : 's') + ' match' + (filtered.length === 1 ? 'es' : '') +
      (candidateSearchTerm.trim() ? ' for "' + candidateSearchTerm.trim() + '"' : '')
    : '';

  if (!filtered.length) {
    el.innerHTML = '<p class="submissions-empty" role="status">No candidates match the current filters.</p>';
    return;
  }

  const rows = filtered.map(({ c, math }) => {
    const verdictKey = math ? math.verdict : 'needs-data';
    const meta = CANDIDATE_VERDICT_META[verdictKey];
    const gainText = math ? formatSignedUsd(math.expectedGain) : 'n/a';
    // A decided candidate (hold/sell-raw/submit/pass) previously rendered
    // visually identical to a genuinely open one until its modal was opened;
    // this badge is the same "already decided, not still being weighed"
    // signal the STATUS filter chips above now let you filter by.
    const decisionLabel = c.decision ? c.decision.replace('-', ' ') : null;
    const metaParts = [
      c.sport,
      c.targetGradingCompany,
      c.rawValue != null ? 'raw ' + formatUsd(c.rawValue) : null,
      c.expectedGradedValue != null ? 'est. graded ' + formatUsd(c.expectedGradedValue) + (c.expectedGrade ? ' (' + c.expectedGrade + ')' : '') : null,
      math ? 'costs ' + formatUsd(math.totalCost) : null
    ].filter(Boolean);
    return `
      <div class="submission-row candidate-row" tabindex="0" role="button" aria-label="View details for ${escapeHtml(c.cardName || 'Untitled candidate')}${decisionLabel ? ', decision: ' + escapeHtml(decisionLabel) : ''}" data-id="${escapeHtml(c.id)}">
        <span class="submission-days font-mono${math && math.expectedGain < 0 ? ' submission-days-late' : ''}">${escapeHtml(gainText)}</span>
        <span class="badge ${meta.cls}">${escapeHtml(meta.label)}</span>
        ${decisionLabel ? `<span class="badge badge-decided">${escapeHtml(decisionLabel)}</span>` : ''}
        <span class="submission-who">${escapeHtml(c.cardName || 'Untitled candidate')}${isExampleCandidate(c) ? ' <span class="badge badge-example">example</span>' : ''}</span>
        <span class="submission-meta">${escapeHtml(metaParts.join(' · '))}</span>
      </div>
    `;
  }).join('');

  el.innerHTML = rows;
  el.querySelectorAll('.candidate-row').forEach(row => {
    row.addEventListener('click', () => openCandidateModal(row.dataset.id));
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openCandidateModal(row.dataset.id);
      }
    });
  });
}

// Full detail for a "should I grade this?" candidate: the compact feed row
// above only has room for a few summary fields, which was hiding
// rawValueNote/gradedValueNote whenever a value was a comp-estimate. Those
// notes are required by validate.js precisely because a comp-estimate must
// never be shown with no explanation of what it's based on, so leaving them
// unreachable in the UI defeated the point of requiring them. Reuses the same
// modal shell as the card detail view (openModal below), including its own
// guided edit form (candidateEditFormHtml/wireCandidateEditForm below), and
// does not touch `activeCard`, which only the card modal uses.
function openCandidateModal(id) {
  const c = candidates.find(x => x.id === id);
  if (!c) return;
  lastFocusedEl = document.activeElement;

  document.getElementById('modalName').textContent = c.cardName || 'Untitled candidate';
  const subParts = [c.sport, c.targetGradingCompany, c.targetServiceLevel].filter(Boolean);
  document.getElementById('modalSub').textContent = subParts.length ? subParts.join(' · ') : 'No sport/target grader logged yet';

  const math = computeGradingMath(c);
  const verdictKey = math ? math.verdict : 'needs-data';
  const verdictMeta = CANDIDATE_VERDICT_META[verdictKey];

  let body = '';
  body += candidateEditFormHtml(c);
  body += `<div class="field-row"><span class="badge ${verdictMeta.cls}">${escapeHtml(verdictMeta.label)}</span></div>`;
  body += field('Year', c.year != null ? String(c.year) : null, c.year == null);
  body += field('Raw value (ungraded)', c.rawValue != null ? formatUsd(c.rawValue) : null, c.rawValue == null);
  body += field('Raw value basis', c.rawValueBasis === 'recent-sale' ? 'Recent sale' : c.rawValueBasis === 'comp-estimate' ? 'Comp-based estimate' : null, !c.rawValueBasis);
  body += field('Raw value note', c.rawValueNote, !c.rawValueNote);
  const rawComp = rawCompSearchLink(c);
  if (rawComp) {
    body += `<div class="field-row">
      <a href="${escapeHtml(rawComp.url)}" target="_blank" rel="noopener noreferrer" class="cert-link font-mono">${escapeHtml(rawComp.text)} &rarr;</a>
      <div class="field-note">Opens an eBay sold-listings search for the raw/ungraded card, for researching <code class="inline-code">rawValue</code>. eBay now requires you to be signed in to see sold results.</div>
    </div>`;
  }
  body += field('Estimated grading cost', c.estimatedGradingCost != null ? formatUsd(c.estimatedGradingCost) : null, c.estimatedGradingCost == null);
  body += field('Shipping cost', c.shippingCost != null ? formatUsd(c.shippingCost) : null, c.shippingCost == null);
  const targetPop = popReportLinkForCompany(c.targetGradingCompany);
  if (targetPop) {
    body += `<div class="field-row">
      <a href="${escapeHtml(targetPop.url)}" target="_blank" rel="noopener noreferrer" class="cert-link font-mono">${escapeHtml(targetPop.text)} &rarr;</a>
      <div class="field-note">How many copies ${escapeHtml(c.targetGradingCompany)} has graded at each grade so far, real context for what this card might realistically come back at, separate from the sold-comp search below.</div>
      ${targetPop.note ? `<div class="field-note">${escapeHtml(targetPop.note)}</div>` : ''}
    </div>`;
  }
  body += field('Expected grade', c.expectedGrade, !c.expectedGrade);
  body += field('Expected graded value', c.expectedGradedValue != null ? formatUsd(c.expectedGradedValue) : null, c.expectedGradedValue == null);
  const gradedComp = compSearchLink({ cardName: c.cardName, year: c.year, gradingCompany: c.targetGradingCompany, grade: c.expectedGrade });
  if (gradedComp) {
    body += `<div class="field-row">
      <a href="${escapeHtml(gradedComp.url)}" target="_blank" rel="noopener noreferrer" class="cert-link font-mono">${escapeHtml(gradedComp.text)} &rarr;</a>
      <div class="field-note">Opens an eBay sold-listings search for ${escapeHtml(c.targetGradingCompany)}${c.expectedGrade ? ' grade ' + escapeHtml(c.expectedGrade) : ''} comps, for researching <code class="inline-code">expectedGradedValue</code>. eBay now requires you to be signed in to see sold results.</div>
    </div>`;
  }
  body += field('Graded value basis', c.gradedValueBasis === 'recent-sale' ? 'Recent sale' : c.gradedValueBasis === 'comp-estimate' ? 'Comp-based estimate' : null, !c.gradedValueBasis);
  body += field('Graded value note', c.gradedValueNote, !c.gradedValueNote);
  if (math) {
    body += field('Total cost (grading + shipping)', formatUsd(math.totalCost), false);
    body += field('Expected gain', formatSignedUsd(math.expectedGain), false);
  }
  body += field('Date priced', c.datePriced, !c.datePriced);
  body += field('Decision', c.decision, !c.decision);
  body += field('Decision note', c.decisionNote, !c.decisionNote);
  body += field('Notes', c.notes, !c.notes);

  document.getElementById('modalBody').innerHTML = body;
  wireCandidateEditForm(c);
  document.getElementById('modalOverlay').hidden = false;
  lockBodyScroll();
  document.getElementById('modalClose').focus();
}

// Full detail for a grading submission: the feed row only has room for
// status/days-in-queue/a few summary fields. Previously the only way to move
// a batch from "in-queue" to "returned", log a tracking number, or record
// the real invoiced cost was to hand-edit submissions.json; this reuses the
// same guided-form -> JSON -> copy/paste convention as the card and
// candidate edit forms.
function openSubmissionModal(id) {
  const s = submissions.find(x => x.id === id);
  if (!s) return;
  lastFocusedEl = document.activeElement;

  document.getElementById('modalName').textContent = s.description || 'Untitled submission';
  const meta = SUBMISSION_STATUS_META[s.status] || { label: s.status || 'Unknown status' };
  const subParts = [s.gradingCompany, s.serviceLevel, meta.label].filter(Boolean);
  document.getElementById('modalSub').textContent = subParts.length ? subParts.join(' · ') : 'No grader/status logged yet';

  let body = '';
  body += submissionEditFormHtml(s);
  body += field('Card count', s.cardCount != null ? String(s.cardCount) : null, s.cardCount == null);
  body += field('Submitted date', s.submittedDate, !s.submittedDate);
  body += field('Tracking number', s.trackingNumber, !s.trackingNumber);
  body += field('Returned date', s.returnedDate, !s.returnedDate);
  body += field('Cost (grading fee)', s.cost != null ? formatUsd(s.cost) : null, s.cost == null);
  const lookup = s.gradingCompany && ORDER_STATUS_LOOKUP[s.gradingCompany];
  if (lookup) {
    body += `<div class="field-row"><a href="${escapeHtml(lookup.url)}" target="_blank" rel="noopener noreferrer" class="cert-link font-mono">${escapeHtml(lookup.text)} &rarr;</a></div>`;
  }
  body += field('Notes', s.notes, !s.notes);

  document.getElementById('modalBody').innerHTML = body;
  wireSubmissionEditForm(s);
  document.getElementById('modalOverlay').hidden = false;
  lockBodyScroll();
  document.getElementById('modalClose').focus();
}

// Cards currently out for grading (status != "returned"), oldest submitted
// first, since the longest-outstanding batch is the one most worth checking
// on. A submission with no submittedDate sorts last rather than first, same
// "unknown sinks to the bottom" rule sortRows uses for the main table.
function buildActiveSubmissions() {
  return submissions
    .filter(s => s.status !== 'returned')
    .slice()
    .sort((a, b) => {
      if (!a.submittedDate && !b.submittedDate) return 0;
      if (!a.submittedDate) return 1;
      if (!b.submittedDate) return -1;
      return a.submittedDate.localeCompare(b.submittedDate);
    });
}

// Shared by renderSubmissions below (the on-page "est. back ~" label) and
// buildSubmissionReturnReminders (the .ics export), so the two never drift:
// same real-history-beats-published-estimate rule, same "no estimate once
// it's already running long" cutoff.
function estimatedReturnFor(s, turnaroundByGrader) {
  const days = daysSince(s.submittedDate);
  const graderStats = s.gradingCompany && turnaroundByGrader.get(s.gradingCompany);
  const hasRealHistory = graderStats && graderStats.count >= 2;
  const runningLong = days != null && hasRealHistory && days > graderStats.value;
  const publishedDays = !hasRealHistory && s.gradingCompany ? publishedTurnaroundDays(s.gradingCompany, s.serviceLevel) : null;
  const estReturnDate = (!runningLong && s.submittedDate && hasRealHistory)
    ? addDaysIso(s.submittedDate, graderStats.value)
    : (!runningLong && s.submittedDate && publishedDays != null)
      ? addDaysIso(s.submittedDate, businessDaysToCalendarDays(publishedDays))
      : null;
  const estReturnIsPublished = estReturnDate != null && !hasRealHistory;
  return { days, graderStats, hasRealHistory, runningLong, publishedDays, estReturnDate, estReturnIsPublished };
}

// A separate feed from Pricing activity above: this is the front of the
// pipeline (cards shipped off, not graded yet) rather than the back of it
// (cards already priced). Kept in its own section since the two answer
// different questions: "what's still out" vs. "what got priced recently".
function renderSubmissions() {
  const el = document.getElementById('submissionsFeed');

  // Same real-failure-vs-honestly-empty distinction as renderCandidates
  // above: rawSubmissionsData is only null when loadSubmissions' own
  // fetch/parse failed, never for a real submissions.json with nothing
  // active in it.
  if (rawSubmissionsData === null) {
    el.innerHTML = '<p class="submissions-empty" role="alert">Failed to load submissions.json.</p>';
    return;
  }

  const active = buildActiveSubmissions();
  const returnedCount = submissions.filter(s => s.status === 'returned' && !isExampleSubmission(s)).length;

  if (!active.length) {
    el.innerHTML = '<p class="submissions-empty" role="status">Nothing currently out for grading.' +
      (returnedCount ? ' ' + returnedCount + ' past submission' + (returnedCount === 1 ? '' : 's') + ' logged as returned.' : '') +
      emptyStateCta('quickLogSubmissionTool', 'quickSubmissionForm', 'Log one now') + '</p>';
    return;
  }

  // Cross-references this grader's own real turnaround history (already
  // computed for the "Avg. grading turnaround" breakdown) against how long
  // this active submission has actually been out, so a batch running past
  // that grader's own average gets flagged instead of just quietly aging in
  // the list. Requires at least 2 returned submissions from that grader
  // before trusting the average enough to flag anything against it.
  const turnaroundByGrader = new Map(buildTurnaroundByGrader().map(g => [g.label, g]));

  const rows = active.map(s => {
    const meta = SUBMISSION_STATUS_META[s.status] || { label: s.status, cls: 'badge-status-queue' };
    const { days, graderStats, runningLong, publishedDays, estReturnDate, estReturnIsPublished } = estimatedReturnFor(s, turnaroundByGrader);
    const daysText = days == null ? 'no date logged' : days + ' day' + (days === 1 ? '' : 's') + ' in queue';
    const lookup = s.gradingCompany && ORDER_STATUS_LOOKUP[s.gradingCompany];
    const metaParts = [
      s.gradingCompany,
      s.serviceLevel,
      s.cardCount != null ? s.cardCount + ' card' + (s.cardCount === 1 ? '' : 's') : null,
      s.cost != null ? formatUsd(s.cost) + ' fee' : null
    ].filter(Boolean);
    // The tracking link below used to sit *inside* this same tabindex/
    // role="button" row, an interactive <a> nested inside another
    // interactive element, invalid ARIA (axe's nested-interactive check
    // flags it: screen readers can fail to announce or reach a control
    // nested this way). Split into two flex children of a plain, non-
    // interactive outer div instead: .submission-row-main keeps the exact
    // same flex/wrap/gap layout for the row's own click/keydown handling,
    // and the link is a sibling next to it, not a descendant.
    return `
      <div class="submission-row">
        <div class="candidate-row submission-row-main" tabindex="0" role="button" aria-label="View details for ${escapeHtml(s.description || 'Untitled submission')}" data-id="${escapeHtml(s.id)}">
          <span class="submission-days font-mono${runningLong ? ' submission-days-late' : ''}">${escapeHtml(daysText)}</span>
          <span class="badge ${meta.cls}">${escapeHtml(meta.label)}</span>
          <span class="submission-who">${escapeHtml(s.description || 'Untitled submission')}${isExampleSubmission(s) ? ' <span class="badge badge-example">example</span>' : ''}</span>
          <span class="submission-meta">${escapeHtml(metaParts.join(' · '))}</span>
          ${runningLong ? `<span class="badge badge-late" title="${escapeHtml(s.gradingCompany)}'s own average turnaround across ${graderStats.count} returned submission${graderStats.count === 1 ? '' : 's'} is ${graderStats.value} days">past ${escapeHtml(s.gradingCompany)} avg (${graderStats.value}d)</span>` : ''}
          ${estReturnDate ? (estReturnIsPublished
            ? `<span class="submission-meta font-mono" title="${escapeHtml(s.gradingCompany)}'s own published estimate is about ${publishedDays} business days for this service level, not a guarantee and not this dataset's own return history yet -- see Grading service tiers reference below">est. back ~${escapeHtml(estReturnDate)} (published est.)</span>`
            : `<span class="submission-meta font-mono" title="Based on ${escapeHtml(s.gradingCompany)}'s own average turnaround across ${graderStats.count} returned submission${graderStats.count === 1 ? '' : 's'} (${graderStats.value} days), not a guarantee from the grader">est. back ~${escapeHtml(estReturnDate)}</span>`
          ) : ''}
        </div>
        ${lookup ? `<a href="${escapeHtml(lookup.url)}" target="_blank" rel="noopener noreferrer" class="submission-link font-mono">${escapeHtml(lookup.text)} &rarr;</a>` : ''}
      </div>
    `;
  }).join('');

  el.innerHTML = rows + (returnedCount
    ? `<div class="submissions-returned-note">+ ${returnedCount} past submission${returnedCount === 1 ? '' : 's'} logged as returned</div>`
    : '');
  el.querySelectorAll('.submission-row-main[data-id]').forEach(row => {
    row.addEventListener('click', () => openSubmissionModal(row.dataset.id));
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openSubmissionModal(row.dataset.id);
      }
    });
  });
}

// Batches aren't a fixed vocabulary like sport/basis/grader, they're one per
// real pricing session (e.g. the 2026-08-08 full backlog pass), so the chip
// row is built from whatever labels actually show up in the data instead of
// a hardcoded list. Newest batch first; label sort works here because the
// documented convention is to lead with an ISO date.
function renderBatchFilter() {
  const container = document.getElementById('batchFilter');
  const batches = [...new Set(cards.map(c => c.backlogBatch).filter(Boolean))].sort().reverse();

  if (!batches.length) {
    container.hidden = true;
    return;
  }
  if (activeBatch !== 'all' && !batches.includes(activeBatch)) activeBatch = 'all';

  container.hidden = false;
  container.innerHTML = '<span class="filter-row-label font-mono">BATCH</span>' +
    `<button type="button" class="chip" data-batch="all" aria-pressed="${activeBatch === 'all'}">All<span class="chip-count"></span></button>` +
    batches.map(b => `<button type="button" class="chip" data-batch="${escapeHtml(b)}" aria-pressed="${activeBatch === b}">${escapeHtml(b)}<span class="chip-count"></span></button>`).join('');

  wireChipGroup('batchFilter', 'data-batch', (v) => { activeBatch = v; });
}

// Flags real (non-example) cards missing a field that validate.js does not
// already enforce as an error but that matters for the "individually
// researched, never a silent guess" methodology: a priced card with no
// record of where the price came from or when it was checked, or a graded
// card with no cert number logged (so it can't be looked back up later).
// Same "Needs backfill" pattern as the CSM hub's own data-quality panel,
// hidden entirely when nothing is flagged rather than showing an empty box.
// A card can be logged (name/year/sport known from the physical sweep) before
// it's been individually researched for a price. Distinct from
// buildDataQualityFlags below: those cards have a price on record but a
// metadata gap, these have no price at all yet and would otherwise be
// invisible outside the raw inventory table's "not priced" cell.
function buildUnpricedFlags() {
  return cards.filter(c => !isExample(c) && !isSold(c) && c.estimatedValue == null);
}

function renderUnpriced() {
  const section = document.getElementById('unpricedSection');
  const list = document.getElementById('unpricedList');
  const unpriced = buildUnpricedFlags();

  if (!unpriced.length) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  list.innerHTML = unpriced.map(c => `
    <button type="button" class="data-quality-row" data-id="${escapeHtml(c.id)}">
      <span class="dq-name">${escapeHtml(c.cardName || 'Untitled card')}</span>
      <span class="dq-meta">${escapeHtml([c.sport, c.gradingCompany, c.grade].filter(Boolean).join(' · '))}</span>
      <span class="dq-why">NO PRICE LOGGED</span>
    </button>
  `).join('');
  list.querySelectorAll('.data-quality-row').forEach(row => {
    row.addEventListener('click', () => openModal(row.dataset.id));
  });
}

function buildDataQualityFlags() {
  return cards
    .filter(c => !isExample(c))
    .map(c => {
      const reasons = [];
      if (c.estimatedValue != null && !c.sourceNote) reasons.push('PRICED BUT NO SOURCE LOGGED');
      if (c.estimatedValue != null && !c.datePriced) reasons.push('PRICED BUT NO DATE LOGGED');
      if (c.gradingCompany && !c.certNumber) reasons.push('NO CERT NUMBER LOGGED');
      // Same condition validate.js already warns on (CGTValidateCore), surfaced
      // here too since a swapped soldDate/datePriced silently corrupts the
      // realized gain/loss math (computeRealizedGainLoss trusts these fields
      // as given) and previously only showed up by running the CLI validator
      // by hand.
      if (c.soldDate && c.datePriced && c.soldDate < c.datePriced) reasons.push('SOLD DATE BEFORE PRICED DATE');
      return { c, reasons };
    })
    .filter(x => x.reasons.length > 0);
}

function renderDataQuality() {
  const section = document.getElementById('dataQualitySection');
  const list = document.getElementById('dataQualityList');
  const flagged = buildDataQualityFlags();

  if (!flagged.length) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  list.innerHTML = flagged.map(({ c, reasons }) => `
    <button type="button" class="data-quality-row" data-id="${escapeHtml(c.id)}">
      <span class="dq-name">${escapeHtml(c.cardName || 'Untitled card')}</span>
      <span class="dq-meta">${escapeHtml([c.sport, c.gradingCompany, c.grade].filter(Boolean).join(' · '))}</span>
      <span class="dq-why">${escapeHtml(reasons.join(' · '))}</span>
    </button>
  `).join('');
  list.querySelectorAll('.data-quality-row').forEach(row => {
    row.addEventListener('click', () => openModal(row.dataset.id));
  });
}

// A separate, distinct concern from buildDataQualityFlags above: those cards
// have a real price on record but it hasn't been re-checked in a while, not a
// missing field. Same click-to-jump list pattern as "Needs backfill" and
// CSM's own "Stalled in stage" panel, oldest price first since that is the
// most out of date and the most worth re-checking first.
function buildStalePricingFlags() {
  return cards
    .filter(c => !isExample(c) && !isSold(c) && isStale(c))
    .sort((a, b) => daysSince(b.datePriced) - daysSince(a.datePriced));
}

function renderStalePricing() {
  const section = document.getElementById('stalePricingSection');
  const list = document.getElementById('stalePricingList');
  const flagged = buildStalePricingFlags();

  if (!flagged.length) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  list.innerHTML = flagged.map(c => `
    <button type="button" class="data-quality-row" data-id="${escapeHtml(c.id)}">
      <span class="dq-name">${escapeHtml(c.cardName || 'Untitled card')}</span>
      <span class="dq-meta">${escapeHtml([c.sport, c.gradingCompany, c.grade].filter(Boolean).join(' · '))}</span>
      <span class="dq-why">PRICED ${daysSince(c.datePriced)} DAYS AGO</span>
    </button>
  `).join('');
  list.querySelectorAll('.data-quality-row').forEach(row => {
    row.addEventListener('click', () => openModal(row.dataset.id));
  });
}

// Reuses the exact same duplicate-detection rule validate.js runs on the
// command line (CGTValidateCore.findDuplicateGroups, shared so the two
// never drift apart), just rendered as a clickable panel instead of a CLI
// warning, so seeing "these two rows might be the same card" doesn't
// require running a script. Excludes the example row like every other
// real-data panel here.
function renderDuplicates() {
  const section = document.getElementById('duplicatesSection');
  const list = document.getElementById('duplicatesList');
  if (!window.CGTValidateCore) {
    section.hidden = true;
    return;
  }
  const groups = CGTValidateCore.findDuplicateGroups(cards.filter(c => !isExample(c)));

  if (!groups.length) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  list.innerHTML = groups.map(({ cards: group }) => group.map(c => `
    <button type="button" class="data-quality-row" data-id="${escapeHtml(c.id)}">
      <span class="dq-name">${escapeHtml(c.cardName || 'Untitled card')}${c.year ? ' (' + escapeHtml(String(c.year)) + ')' : ''}</span>
      <span class="dq-meta">${escapeHtml([c.sport, c.gradingCompany, c.grade].filter(Boolean).join(' · '))}</span>
      <span class="dq-why">${group.length} ROWS MATCH ON NAME/YEAR/GRADER/GRADE</span>
    </button>
  `).join('')).join('');
  list.querySelectorAll('.data-quality-row').forEach(row => {
    row.addEventListener('click', () => openModal(row.dataset.id));
  });
}

// Reuses CGTValidateCore.findGradeLadderInversions, the same rule validate.js
// runs on the command line, rendered as a clickable panel like the
// duplicates one above. Flags a higher numeric grade of the same real card
// priced lower than a lower grade of it, since that is far more often a
// price or grade typed against the wrong row than a genuine market quirk.
function renderGradeLadderFlags() {
  const section = document.getElementById('gradeLadderSection');
  const list = document.getElementById('gradeLadderList');
  if (!window.CGTValidateCore) {
    section.hidden = true;
    return;
  }
  const flags = CGTValidateCore.findGradeLadderInversions(cards.filter(c => !isExample(c)));

  if (!flags.length) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  list.innerHTML = flags.map(({ lower, higher }) => `
    <button type="button" class="data-quality-row" data-id="${escapeHtml(higher.id)}">
      <span class="dq-name">${escapeHtml(higher.cardName || 'Untitled card')}${higher.year ? ' (' + escapeHtml(String(higher.year)) + ')' : ''}</span>
      <span class="dq-meta">${escapeHtml(higher.gradingCompany)} ${escapeHtml(String(higher.grade))}: ${escapeHtml(formatUsd(higher.estimatedValue))}</span>
      <span class="dq-why">LOWER THAN ITS OWN ${escapeHtml(String(lower.grade))} AT ${escapeHtml(formatUsd(lower.estimatedValue))}</span>
    </button>
  `).join('');
  list.querySelectorAll('.data-quality-row').forEach(row => {
    row.addEventListener('click', () => openModal(row.dataset.id));
  });
}

// Same attention-bar convention as CSM's own renderAttentionBar: these
// panels (unpriced, data quality, stale pricing, duplicates, grade ladder,
// candidates stuck without a verdict) each already hide themselves when
// nothing's flagged, but each one only becomes visible by scrolling past
// every section above it, so a real flag buried near the bottom of the page
// could go unnoticed for a long time. This click-to-scroll summary surfaces
// all of them up top instead, hidden entirely (not an empty bar) when every
// one of them has nothing flagged.
function renderAttentionBar() {
  const bar = document.getElementById('attentionBar');
  const realCards = cards.filter(c => !isExample(c));
  const unpricedCount = buildUnpricedFlags().length;
  const dataQualityCount = buildDataQualityFlags().length;
  const stalePricingCount = buildStalePricingFlags().length;
  const duplicateCount = window.CGTValidateCore ? CGTValidateCore.findDuplicateGroups(realCards).length : 0;
  const gradeLadderCount = window.CGTValidateCore ? CGTValidateCore.findGradeLadderInversions(realCards).length : 0;
  // A candidate still being weighed (no decision logged yet) but missing
  // expectedGradedValue/estimatedGradingCost can't get a real verdict out of
  // computeGradingMath, so it sits stuck at "Needs more data" until that
  // research gets filled in. That's easy to miss since the verdict chips
  // just show it as one bucket among four rather than flagging it as a gap.
  const openCandidates = candidates.filter(c => !isExampleCandidate(c) && !c.decision);
  const candidatesNeedingDataCount = openCandidates.filter(c => !computeGradingMath(c)).length;

  const items = [];
  if (unpricedCount) {
    items.push({ n: unpricedCount, target: 'unpricedSection', label: unpricedCount === 1 ? 'card not priced yet' : 'cards not priced yet' });
  }
  if (dataQualityCount) {
    items.push({ n: dataQualityCount, target: 'dataQualitySection', label: dataQualityCount === 1 ? 'card needs backfill' : 'cards need backfill' });
  }
  if (stalePricingCount) {
    items.push({ n: stalePricingCount, target: 'stalePricingSection', label: stalePricingCount === 1 ? 'price is stale' : 'prices are stale' });
  }
  if (duplicateCount) {
    items.push({ n: duplicateCount, target: 'duplicatesSection', label: duplicateCount === 1 ? 'possible duplicate group' : 'possible duplicate groups' });
  }
  if (gradeLadderCount) {
    items.push({ n: gradeLadderCount, target: 'gradeLadderSection', label: gradeLadderCount === 1 ? 'grade ladder inversion' : 'grade ladder inversions' });
  }
  if (candidatesNeedingDataCount) {
    items.push({
      n: candidatesNeedingDataCount,
      target: 'candidatesSection',
      label: candidatesNeedingDataCount === 1
        ? 'open candidate has no verdict yet, needs graded-value research'
        : 'open candidates have no verdict yet, need graded-value research'
    });
  }

  if (!items.length) {
    bar.hidden = true;
    bar.innerHTML = '';
    return;
  }
  bar.hidden = false;
  bar.innerHTML = items.map(item =>
    '<button type="button" class="attention-pill attention-warn" data-target="' + escapeHtml(item.target) + '">' +
    '<strong>' + item.n + '</strong> ' + escapeHtml(item.label) + '</button>'
  ).join('');
  bar.querySelectorAll('[data-target]').forEach(btn => {
    btn.addEventListener('click', () => {
      const el = document.getElementById(btn.getAttribute('data-target'));
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

// Builds the itemized appraisal/insurance list once from the real dataset,
// independent of whatever the on-screen table is currently filtered/sorted
// to, since an insurance document needs "everything with a real value on
// record," not "whatever slice happened to be on screen when someone hit
// print." Unpriced cards and the example row are excluded from both the
// list and the total, and the exclusion count is stated plainly so the
// total on the page never gets mistaken for a complete collection value.
function renderInsuranceSummary() {
  const el = document.getElementById('insuranceSummary');
  // A sold card is no longer owned, so it has nothing to insure and does not
  // belong on an appraisal document, same reasoning as every other
  // currently-held-only total in renderStats/buildValueGroups above.
  const real = cards.filter(c => !isExample(c) && !isSold(c));
  const soldCount = cards.filter(c => !isExample(c) && isSold(c)).length;
  const priced = real
    .filter(c => c.estimatedValue != null)
    .slice()
    .sort((a, b) => b.estimatedValue - a.estimatedValue);
  const unpricedCount = real.length - priced.length;
  const generatedOn = todayIso();

  if (!priced.length) {
    el.innerHTML = `
      <h1 class="insurance-summary-title">Card Grading Tracker, Insurance / Appraisal Summary</h1>
      <p class="insurance-summary-meta">Generated ${escapeHtml(generatedOn)}</p>
      <p class="insurance-summary-empty">No cards with a researched value on record yet. Nothing to summarize.</p>
    `;
    return;
  }

  const total = priced.reduce((s, c) => s + c.estimatedValue, 0);
  const anyPhotos = priced.some(c => c.imageUrl);
  const rows = priced.map(c => `
    <tr>
      ${anyPhotos ? `<td>${c.imageUrl ? `<img src="${escapeHtml(c.imageUrl)}" alt="" class="insurance-summary-photo">` : ''}</td>` : ''}
      <td>${escapeHtml(c.cardName || 'Untitled card')}${c.year ? ' (' + escapeHtml(String(c.year)) + ')' : ''}</td>
      <td>${escapeHtml(c.sport || '')}</td>
      <td>${escapeHtml(c.gradingCompany || '')}</td>
      <td>${c.grade != null ? escapeHtml(String(c.grade)) : ''}</td>
      <td>${escapeHtml(c.certNumber || '')}</td>
      <td>${escapeHtml(c.storageLocation || '')}</td>
      <td class="num">${formatUsd(c.estimatedValue)}</td>
      <td>${c.valuationBasis === 'recent-sale' ? 'Recent sale' : c.valuationBasis === 'comp-estimate' ? 'Comp-based estimate' : 'Unlabeled'}</td>
      <td>${escapeHtml(c.datePriced || '')}</td>
    </tr>
  `).join('');

  el.innerHTML = `
    <h1 class="insurance-summary-title">Card Grading Tracker, Insurance / Appraisal Summary</h1>
    <p class="insurance-summary-meta">Generated ${escapeHtml(generatedOn)} &middot; ${priced.length} priced card${priced.length === 1 ? '' : 's'}</p>
    <p class="insurance-summary-note">${[
      unpricedCount ? unpricedCount + ' additional card' + (unpricedCount === 1 ? '' : 's') + ' logged with no researched value yet, excluded from this list and from the total below.' : null,
      soldCount ? soldCount + ' sold card' + (soldCount === 1 ? '' : 's') + ' excluded, no longer owned and nothing to insure.' : null
    ].filter(Boolean).join(' ') || 'Every logged card has a researched value on record; none excluded.'
    } A value marked "Comp-based estimate" has no directly comparable sale on record and is inferred from related sales, not a confirmed sale of this exact card and grade. A blank "Location" means no storage location has been logged for that card yet.${
      anyPhotos ? ' A blank "Photo" cell means no photo URL has been logged for that specific card yet, even though at least one other card in this list has one.' : ''
    }</p>
    <table class="insurance-summary-table">
      <thead>
        <tr>
          ${anyPhotos ? '<th>Photo</th>' : ''}
          <th>Card</th><th>Sport</th><th>Grader</th><th>Grade</th><th>Cert #</th><th>Location</th>
          <th class="num">Est. value</th><th>Basis</th><th>Date priced</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr class="insurance-summary-total">
          <td colspan="${anyPhotos ? 7 : 6}">Total (${priced.length} card${priced.length === 1 ? '' : 's'})</td>
          <td class="num">${formatUsd(total)}</td>
          <td colspan="2"></td>
        </tr>
      </tfoot>
    </table>
    ${(() => {
      const limit = loadCoverageLimit();
      if (limit == null) return '';
      const headroom = limit - total;
      return `<p class="insurance-summary-note insurance-coverage-line">Logged policy coverage limit: <strong>${formatUsd(limit)}</strong> &middot; ${
        headroom >= 0
          ? formatUsd(headroom) + ' under limit'
          : '<strong>' + formatUsd(Math.abs(headroom)) + ' over limit</strong>, worth checking with the insurer about raising it'
      }. Self-reported, entered on the main dashboard, not pulled from a real policy document.</p>`;
    })()}
  `;
}

// Real collectibles-insurance guidance (personal articles floaters /
// scheduled property riders) is to reassess a collection's value
// periodically and raise the policy's scheduled limit as it grows, since a
// floater only pays out up to the agreed value on file, not whatever the
// collection actually turns out to be worth. This never reads or guesses
// Jack's real policy limit, it only compares the real logged total against
// whatever number he types into coverageLimitInput himself, persisted to
// this browser only (same pattern as Garage's pace-per-day input).
const COVERAGE_LIMIT_STORAGE_KEY = 'cgt-insurance-coverage-limit';

function loadCoverageLimit() {
  try {
    const raw = localStorage.getItem(COVERAGE_LIMIT_STORAGE_KEY);
    const n = raw == null ? null : Number(raw);
    return n && n > 0 ? n : null;
  } catch {
    return null;
  }
}
function saveCoverageLimit(limit) {
  try {
    localStorage.setItem(COVERAGE_LIMIT_STORAGE_KEY, String(limit));
  } catch {
    // Storage unavailable, the limit just won't persist across visits.
  }
}

function renderCoverageCheck() {
  const result = document.getElementById('coverageResult');
  if (!result) return;
  const real = cards.filter(c => !isExample(c) && !isSold(c));
  const priced = real.filter(c => c.estimatedValue != null);
  const total = priced.reduce((s, c) => s + c.estimatedValue, 0);

  if (!priced.length) {
    result.innerHTML = '<p class="coverage-result-note">No cards with a researched value on record yet, nothing to compare against a coverage limit.</p>';
    return;
  }

  const input = document.getElementById('coverageLimitInput');
  const raw = input ? input.value.trim() : '';
  const limit = raw === '' ? null : Number(raw);

  if (raw === '' || Number.isNaN(limit) || limit <= 0) {
    result.innerHTML = `<p class="coverage-result-note">Current logged total: <strong>${formatUsd(total)}</strong> across ${priced.length} priced card(s). Enter your real policy limit above to see how it compares.</p>`;
    return;
  }

  const headroom = limit - total;
  if (headroom >= 0) {
    result.innerHTML = `<p class="coverage-result-note positive"><strong>${formatUsd(total)}</strong> logged, <strong>${formatUsd(headroom)}</strong> under your ${formatUsd(limit)} coverage limit.</p>`;
  } else {
    result.innerHTML = `<p class="coverage-result-note negative"><strong>${formatUsd(total)}</strong> logged, <strong>${formatUsd(Math.abs(headroom))} over</strong> your ${formatUsd(limit)} coverage limit. Worth checking with the insurer about raising it, a floater only pays out up to the scheduled amount on file.</p>`;
  }
}

function wireCoverageCheck() {
  const input = document.getElementById('coverageLimitInput');
  if (!input) return;
  const saved = loadCoverageLimit();
  if (saved) input.value = String(saved);
  input.addEventListener('input', () => {
    const raw = input.value.trim();
    const limit = raw === '' ? null : Number(raw);
    if (limit && limit > 0) saveCoverageLimit(limit);
    renderCoverageCheck();
    // Keep the printable appraisal doc's coverage line in sync too, it reads
    // the same saved limit but only re-renders when told to.
    renderInsuranceSummary();
  });
}

// Compact up/down/flat indicator next to a card's value in the table, so a
// re-priced card's direction is visible at a glance without opening the
// modal, the same "at a glance" convention collectibles trackers like Card
// Ladder use for portfolio value movement. Hidden entirely (not just muted)
// when there is nothing real to compare against.
function valueTrendBadge(c) {
  const trend = computeValueTrend(c);
  if (!trend) return '';
  const pctText = trend.pct != null ? ' (' + (trend.pct >= 0 ? '+' : '') + trend.pct.toFixed(0) + '%)' : '';
  if (trend.abs > 0) return ` <span class="value-trend up" title="Up from ${escapeHtml(formatUsd(trend.prevValue))} on ${escapeHtml(trend.prevDate)}">&#9650;${escapeHtml(pctText)}</span>`;
  if (trend.abs < 0) return ` <span class="value-trend down" title="Down from ${escapeHtml(formatUsd(trend.prevValue))} on ${escapeHtml(trend.prevDate)}">&#9660;${escapeHtml(pctText)}</span>`;
  return ` <span class="value-trend flat" title="Unchanged from ${escapeHtml(trend.prevDate)}">&#8213;</span>`;
}

function basisBadge(c) {
  if (c.estimatedValue == null) return '<span class="cell-value empty">not priced</span>';
  if (c.valuationBasis === 'recent-sale') return '<span class="badge badge-sale">recent sale</span>';
  if (c.valuationBasis === 'comp-estimate') return '<span class="badge badge-comp">comp estimate</span>';
  return '<span class="badge badge-comp">unlabeled</span>';
}

// Each predicate takes the filter value explicitly (rather than reading the
// active* globals) so the same functions drive both the real applied filters
// below and the per-chip facet counts in facetCount(), instead of keeping
// two copies of this logic in sync by hand.
function matchesSearchTerm(c, term) {
  term = term.trim().toLowerCase();
  return !term
    || (c.cardName || '').toLowerCase().includes(term)
    || (c.certNumber || '').toLowerCase().includes(term)
    || (c.storageLocation || '').toLowerCase().includes(term)
    || String(c.year ?? '').includes(term)
    || (c.notes || '').toLowerCase().includes(term)
    || (c.sourceNote || '').toLowerCase().includes(term)
    || (c.compNote || '').toLowerCase().includes(term);
}
function matchesSportValue(c, sport) { return sport === 'all' || c.sport === sport; }
function matchesGraderValue(c, grader) {
  if (grader === 'all') return true;
  if (grader === 'raw') return !c.gradingCompany;
  return c.gradingCompany === grader;
}
function matchesBatchValue(c, batch) { return batch === 'all' || c.backlogBatch === batch; }
function matchesBasisValue(c, basis) {
  if (basis === 'all') return true;
  if (basis === 'unpriced') return c.estimatedValue == null;
  return c.valuationBasis === basis;
}
function matchesOwnershipValue(c, ownership) {
  if (ownership === 'all') return true;
  return ownership === 'sold' ? isSold(c) : !isSold(c);
}

function matchesFilters(c) {
  return matchesSearchTerm(c, searchTerm)
    && matchesSportValue(c, activeSport)
    && matchesGraderValue(c, activeGrader)
    && matchesBatchValue(c, activeBatch)
    && matchesBasisValue(c, activeBasis)
    && matchesOwnershipValue(c, activeOwnership);
}

// Counts how many cards would match if this one dimension's chip were set to
// `value`, holding every other active filter (search included) as-is. This
// is the standard faceted-search convention (each chip shows what picking it
// would leave you with), so switching sport doesn't make the grader counts
// lie about what's actually reachable from here.
function facetCount(dimension, value) {
  return cards.filter(c => {
    if (!matchesSearchTerm(c, searchTerm)) return false;
    if (dimension !== 'sport' && !matchesSportValue(c, activeSport)) return false;
    if (dimension !== 'grader' && !matchesGraderValue(c, activeGrader)) return false;
    if (dimension !== 'batch' && !matchesBatchValue(c, activeBatch)) return false;
    if (dimension !== 'basis' && !matchesBasisValue(c, activeBasis)) return false;
    if (dimension !== 'ownership' && !matchesOwnershipValue(c, activeOwnership)) return false;
    if (dimension === 'sport') return matchesSportValue(c, value);
    if (dimension === 'grader') return matchesGraderValue(c, value);
    if (dimension === 'batch') return matchesBatchValue(c, value);
    if (dimension === 'basis') return matchesBasisValue(c, value);
    if (dimension === 'ownership') return matchesOwnershipValue(c, value);
    return true;
  }).length;
}

const FACET_DIMENSIONS = [
  ['sportFilter', 'data-sport', 'sport'],
  ['basisFilter', 'data-basis', 'basis'],
  ['graderFilter', 'data-grader', 'grader'],
  ['batchFilter', 'data-batch', 'batch'],
  ['ownershipFilter', 'data-owned', 'ownership']
];

function updateChipCounts() {
  FACET_DIMENSIONS.forEach(([containerId, dataAttr, dimension]) => {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.querySelectorAll('.chip').forEach(chip => {
      const countEl = chip.querySelector('.chip-count');
      if (!countEl) return;
      const value = chip.getAttribute(dataAttr);
      const count = facetCount(dimension, value);
      countEl.textContent = ' ' + count;
      // Dimmed, not disabled: a 0-count facet is still worth being able to
      // click (e.g. to confirm "yep, no football cards logged yet"), it just
      // shouldn't visually compete with facets that actually narrow anything.
      chip.classList.toggle('chip-zero', count === 0 && chip.getAttribute('aria-pressed') !== 'true');
    });
  });
}

function sortRows(rows) {
  if (!sortKey) return rows;
  const dir = sortDir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    // Cards with no value on the sort key always sink to the bottom
    // regardless of direction, since "unknown" is not meaningfully high or low.
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
    // Grades are stored as label strings ("10", "9.5") since that's what's
    // printed on the slab, but a plain string sort would rank "10" before
    // "9". Compare numerically whenever both sides parse as a number, and
    // only fall back to string order for non-numeric labels (e.g. "AUTHENTIC").
    if (sortKey === 'grade') {
      const an = parseFloat(av);
      const bn = parseFloat(bv);
      if (!Number.isNaN(an) && !Number.isNaN(bn)) return (an - bn) * dir;
    }
    return String(av).localeCompare(String(bv)) * dir;
  });
}

function updateSortHeaders() {
  document.querySelectorAll('th.sortable').forEach(th => {
    const key = th.getAttribute('data-sort');
    th.setAttribute('aria-sort', key === sortKey ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none');
  });
}

// Announces the live match count to screen-reader users, since the visual
// feedback (the table simply shrinking) isn't perceivable non-visually,
// same live region the main Command Center dashboard already uses for its
// own search/category filter.
function anyFilterActive() {
  return !!searchTerm.trim() || activeSport !== 'all' || activeGrader !== 'all' ||
    activeBatch !== 'all' || activeBasis !== 'all' || activeOwnership !== 'all';
}

function announceFilterStatus(matchCount) {
  const status = document.getElementById('filterStatus');
  status.textContent = anyFilterActive()
    ? matchCount + ' card' + (matchCount === 1 ? '' : 's') + ' match' + (matchCount === 1 ? 'es' : '') +
      (searchTerm.trim() ? ' for "' + searchTerm.trim() + '"' : '')
    : '';
}

// The breakdown section above totals real priced cards by one dimension at a
// time (sport, grader, grade), but never for whatever combination of filters
// is currently active, e.g. "PSA hockey cards from the 2026-08-08 batch". This
// reads that answer straight off the same `filtered` rows already computed
// for the table, so narrowing down to a specific slice of the collection
// always shows what it's worth without doing the math by hand.
function renderTableFooter(filtered) {
  const foot = document.getElementById('cardTableFoot');
  if (!filtered.length) {
    foot.innerHTML = '';
    return;
  }
  const real = filtered.filter(c => !isExample(c));
  const priced = real.filter(c => c.estimatedValue != null);
  const total = priced.reduce((s, c) => s + c.estimatedValue, 0);
  const includesExample = real.length !== filtered.length;
  const summary = [
    filtered.length + ' card' + (filtered.length === 1 ? '' : 's') + ' shown',
    priced.length + ' priced',
    formatUsd(total) + ' total'
  ].join(' · ');
  foot.innerHTML = `
    <tr class="table-foot-row">
      <td colspan="7" class="table-foot-cell font-mono">
        ${summary}${includesExample ? ' <span class="table-foot-note">(includes example row, excluded from $ total)</span>' : ''}
      </td>
    </tr>
  `;
}

function applyFiltersAndRender() {
  syncUrl();
  const filtered = sortRows(cards.filter(matchesFilters));
  const tbody = document.getElementById('cardTableBody');
  const empty = document.getElementById('tableEmpty');
  updateSortHeaders();
  updateChipCounts();
  announceFilterStatus(filtered.length);
  document.getElementById('clearFiltersBtn').hidden = !anyFilterActive();

  if (!filtered.length) {
    tbody.innerHTML = '';
    renderTableFooter(filtered);
    empty.hidden = false;
    empty.setAttribute('role', 'status');
    empty.innerHTML = cards.length ? 'No cards match the current filters.' :
      'No cards logged yet.' + emptyStateCta('quickLogTool', 'quickCardForm', 'Log one now');
    return;
  }
  empty.hidden = true;
  renderTableFooter(filtered);

  tbody.innerHTML = filtered.map(c => `
    <tr tabindex="0" role="button" aria-label="View details for ${escapeHtml(c.cardName || 'Untitled card')}" data-id="${escapeHtml(c.id)}">
      <td>
        <div class="cell-card-name">${escapeHtml(c.cardName || 'Untitled card')}${isExample(c) ? ' <span class="badge badge-example">example</span>' : ''}${isSold(c) ? ' <span class="badge badge-sold" title="Sold ' + escapeHtml(c.soldDate) + ' for ' + escapeHtml(formatUsd(c.soldPrice)) + '">sold</span>' : ''}</div>
        ${c.year ? `<div class="cell-card-meta">${escapeHtml(String(c.year))}</div>` : ''}
      </td>
      <td class="cell-muted">${c.sport ? `<span class="badge badge-sport">${escapeHtml(c.sport)}</span>` : '<span class="cell-value empty">unknown</span>'}</td>
      <td class="cell-muted">${c.gradingCompany ? escapeHtml(c.gradingCompany) : '<span class="cell-value empty">raw / ungraded</span>'}</td>
      <td class="cell-muted">${c.grade != null ? escapeHtml(String(c.grade)) : (c.gradingCompany ? '<span class="cell-value empty">unknown</span>' : '<span class="cell-value empty">n/a</span>')}</td>
      <td class="cell-value${c.estimatedValue == null ? ' empty' : ''}">${c.estimatedValue != null ? formatUsd(c.estimatedValue) : 'not priced'}${valueTrendBadge(c)}</td>
      <td>${basisBadge(c)}</td>
      <td class="cell-muted">${c.datePriced ? escapeHtml(c.datePriced) : '<span class="cell-value empty">n/a</span>'}${isStale(c) ? ' <span class="badge badge-stale" title="Priced more than 180 days ago, worth a re-check">stale</span>' : ''}</td>
    </tr>
  `).join('');

  tbody.querySelectorAll('tr[data-id]').forEach(row => {
    row.addEventListener('click', () => openModal(row.dataset.id));
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openModal(row.dataset.id);
      }
    });
  });
}

// The .table-wrap has a fixed min-width so columns stay legible, which
// means on a narrow screen it scrolls horizontally with no other visual
// cue. Toggles a fade at whichever edge still has content past the frame.
function initTableScrollShadows() {
  document.querySelectorAll('.table-wrap').forEach(wrap => {
    const update = () => {
      const maxScrollLeft = wrap.scrollWidth - wrap.clientWidth;
      wrap.classList.toggle('can-scroll-left', wrap.scrollLeft > 1);
      wrap.classList.toggle('can-scroll-right', wrap.scrollLeft < maxScrollLeft - 1);
    };
    if (!wrap.dataset.scrollShadowBound) {
      wrap.dataset.scrollShadowBound = '1';
      wrap.addEventListener('scroll', update, { passive: true });
      window.addEventListener('resize', update);
    }
    update();
  });
}

function field(label, value, isEmpty) {
  return `
    <div class="field-row">
      <div class="field-label">${escapeHtml(label)}</div>
      <div class="field-value${isEmpty ? ' empty' : ''}">${isEmpty ? 'not logged' : escapeHtml(value)}</div>
    </div>
  `;
}

// Renders the "how this card's price has moved" list in the detail modal:
// every prior priceHistory entry oldest first, then the current price with
// the change from the immediately preceding one. Returns the "not logged"
// empty state (same look as every other field row) rather than skipping the
// row entirely, so a card with only one price on record still shows why
// there's nothing to plot yet instead of the row just silently disappearing.
function renderPriceHistoryField(c) {
  const history = (c.priceHistory || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  if (!history.length) {
    return field('Price history', null, true);
  }
  const rows = history.map(h => `
    <div class="price-history-row">
      <span class="ph-date font-mono">${escapeHtml(h.date)}</span>
      <span>${escapeHtml(formatUsd(h.value))}</span>
      <span class="ph-basis">${h.basis === 'recent-sale' ? 'recent sale' : h.basis === 'comp-estimate' ? 'comp estimate' : 'unlabeled'}</span>
    </div>
  `).join('');
  const trend = computeValueTrend(c);
  const currentRow = c.estimatedValue != null ? `
    <div class="price-history-row price-history-current">
      <span class="ph-date font-mono">${escapeHtml(c.datePriced || 'current')}</span>
      <span>${escapeHtml(formatUsd(c.estimatedValue))}</span>
      <span>${trend ? valueTrendBadge(c) : ''}</span>
    </div>
  ` : '';
  return `
    <div class="field-row">
      <div class="field-label">Price history</div>
      <div class="price-history-list">${rows}${currentRow}</div>
    </div>
  `;
}

// Locks background scroll behind the modal overlay. Reserves the width the
// scrollbar was taking up as body padding first, so hiding it doesn't shift
// the layout sideways by a few pixels while the modal is open.
function lockBodyScroll() {
  const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
  if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;
  document.body.style.overflow = 'hidden';
}
function unlockBodyScroll() {
  document.body.style.overflow = '';
  document.body.style.paddingRight = '';
}

// step defaults to "0.01" for a number field (USD amounts, the common
// case), but a whole-number field like Year or Card count needs step="1"
// passed explicitly -- otherwise the browser's spinner arrows nudge a year
// like 1982 to 1982.01, and nothing downstream rejects the fractional value
// since it's a real editable number, not free text.
function ceInputInner(id, label, value, type, step) {
  type = type || 'text';
  const v = value == null ? '' : escapeHtml(String(value));
  if (type === 'textarea') {
    return '<div><label for="' + id + '">' + escapeHtml(label) + '</label>' +
      '<textarea id="' + id + '" class="np-input" rows="2">' + v + '</textarea></div>';
  }
  return '<div><label for="' + id + '">' + escapeHtml(label) + '</label>' +
    '<input type="' + type + '" id="' + id + '" class="np-input" value="' + v + '"' +
    (type === 'number' ? ' min="0" step="' + (step || '0.01') + '"' : '') + '></div>';
}

function ceFieldRow(id, label, value, type) {
  return '<div class="form-row">' + ceInputInner(id, label, value, type) + '</div>';
}

function ceSelectRow(id, label, value, options) {
  const opts = options.map(([val, text]) =>
    '<option value="' + escapeHtml(val) + '"' + (value === val || (!value && val === '') ? ' selected' : '') + '>' + escapeHtml(text) + '</option>'
  ).join('');
  return '<div class="form-row"><label for="' + id + '">' + escapeHtml(label) + '</label>' +
    '<select id="' + id + '" class="np-input">' + opts + '</select></div>';
}

// Editing an existing card's own fields previously had no guided path at
// all: the quick-log tool above only builds a brand-new record. Reuses the
// exact same guided-form -> JSON -> copy/paste convention, pre-filled with
// the current values, and outputs the card's *entire* record (id and
// priceHistory carried over untouched) so the result is a straight find-
// and-replace of one array entry in cards.json, not a fragment to merge by
// hand.
function cardEditFormHtml(c) {
  return '<details class="schema-help">' +
    '<summary>Edit this card&rsquo;s details</summary>' +
    '<div class="schema-help-body">' +
    '<p>Generates this card&rsquo;s full updated record with whatever fields below you change. ' +
    '<code>id</code> and <code>priceHistory</code> carry over unchanged. Re-pricing a card that already has an ' +
    'estimatedValue? Push its current value/date/basis into <code>priceHistory</code> yourself first, this form ' +
    'warns you if it looks like you forgot.</p>' +
    '<div class="np-form">' +
    ceFieldRow('ceCardName', 'Card name', c.cardName) +
    '<div class="form-row-split">' +
    ceInputInner('ceYear', 'Year', c.year, 'number', '1') +
    ceSelectRow('ceSport', 'Sport', c.sport, [['', 'Select one...'], ['hockey', 'Hockey'], ['baseball', 'Baseball'], ['football', 'Football']]) +
    '</div>' +
    '<div class="form-row-split">' +
    ceSelectRow('ceGradingCompany', 'Grading company', c.gradingCompany, [['', 'Not graded / raw'], ['PSA', 'PSA'], ['BGS', 'BGS'], ['SGC', 'SGC'], ['CGC', 'CGC'], ['HGA', 'HGA'], ['KSA', 'KSA']]) +
    ceInputInner('ceGrade', 'Grade', c.grade) +
    '</div>' +
    '<div class="form-row-split">' +
    ceInputInner('ceCertNumber', 'Cert number', c.certNumber) +
    ceInputInner('ceStorageLocation', 'Storage location', c.storageLocation) +
    '</div>' +
    '<div class="form-row-split">' +
    ceInputInner('ceEstimatedValue', 'Estimated value, USD', c.estimatedValue, 'number') +
    ceSelectRow('ceValuationBasis', 'Valuation basis', c.valuationBasis, [['', 'Select one...'], ['recent-sale', 'Recent sale'], ['comp-estimate', 'Comp estimate']]) +
    '</div>' +
    ceFieldRow('ceCompNote', 'Comp note', c.compNote) +
    ceFieldRow('ceSourceNote', 'Source note', c.sourceNote) +
    ceFieldRow('ceImageUrl', 'Photo URL (optional)', c.imageUrl) +
    '<div class="form-row-split">' +
    ceInputInner('ceCostBasis', 'Cost basis, USD', c.costBasis, 'number') +
    ceInputInner('ceDatePriced', 'Date priced', c.datePriced, 'date') +
    '</div>' +
    '<div class="form-row-split">' +
    ceInputInner('ceSoldDate', 'Sold date (leave blank if still owned)', c.soldDate, 'date') +
    ceInputInner('ceSoldPrice', 'Sold price, USD', c.soldPrice, 'number') +
    '</div>' +
    ceFieldRow('ceBacklogBatch', 'Backlog batch', c.backlogBatch) +
    ceFieldRow('ceNotes', 'Notes', c.notes, 'textarea') +
    '</div>' +
    '<button type="button" id="ceGenerateBtn" class="print-btn font-mono np-generate-btn">Generate updated JSON</button>' +
    '<div id="ceResult" class="np-result" hidden>' +
    '<ul id="ceWarnings" class="np-warnings"></ul>' +
    '<div class="np-output-head">' +
    '<span class="field-label" style="margin:0">Replace this card&rsquo;s whole entry with</span>' +
    '<button type="button" id="ceCopyBtn" class="print-btn font-mono" aria-live="polite">Copy JSON</button>' +
    '</div>' +
    '<pre class="np-output font-mono" id="ceOutput"></pre>' +
    '</div>' +
    '</div></details>';
}

// Same guided-form -> JSON -> copy/paste convention as cardEditFormHtml
// above, for candidates.json instead. Candidates previously had a read-only
// detail modal only: updating a decision or a re-researched raw/graded value
// meant hand-editing the JSON file directly, the exact gap the card edit
// form already closed for cards.json.
function candidateEditFormHtml(c) {
  return '<details class="schema-help">' +
    '<summary>Edit this candidate&rsquo;s details</summary>' +
    '<div class="schema-help-body">' +
    '<p>Generates this candidate&rsquo;s full updated record with whatever fields below you change. ' +
    '<code>id</code> carries over unchanged. Once this candidate is actually shipped for grading, set ' +
    '<code>decision</code> to &ldquo;submit&rdquo;, add the real batch to <code>submissions.json</code>, and note its id below rather than deleting this row.</p>' +
    '<div class="np-form">' +
    ceFieldRow('cceCardName', 'Card name', c.cardName) +
    '<div class="form-row-split">' +
    ceInputInner('cceYear', 'Year', c.year, 'number', '1') +
    ceSelectRow('cceSport', 'Sport', c.sport, [['', 'Select one...'], ['hockey', 'Hockey'], ['baseball', 'Baseball'], ['football', 'Football']]) +
    '</div>' +
    '<div class="form-row-split">' +
    ceInputInner('cceRawValue', 'Raw value (ungraded), USD', c.rawValue, 'number') +
    ceSelectRow('cceRawValueBasis', 'Raw value basis', c.rawValueBasis, [['', 'Select one...'], ['recent-sale', 'Recent sale'], ['comp-estimate', 'Comp estimate']]) +
    '</div>' +
    ceFieldRow('cceRawValueNote', 'Raw value note', c.rawValueNote) +
    '<div class="form-row-split">' +
    ceSelectRow('cceTargetGradingCompany', 'Target grading company', c.targetGradingCompany, [['', 'Not decided'], ['PSA', 'PSA'], ['BGS', 'BGS'], ['SGC', 'SGC'], ['CGC', 'CGC'], ['HGA', 'HGA'], ['KSA', 'KSA']]) +
    ceInputInner('cceTargetServiceLevel', 'Target service level', c.targetServiceLevel) +
    '</div>' +
    '<div class="form-row-split">' +
    ceInputInner('cceEstimatedGradingCost', 'Estimated grading cost, USD', c.estimatedGradingCost, 'number') +
    ceInputInner('cceShippingCost', 'Shipping cost, USD', c.shippingCost, 'number') +
    '</div>' +
    '<div class="form-row-split">' +
    ceInputInner('cceExpectedGrade', 'Expected grade', c.expectedGrade) +
    ceInputInner('cceExpectedGradedValue', 'Expected graded value, USD', c.expectedGradedValue, 'number') +
    '</div>' +
    ceSelectRow('cceGradedValueBasis', 'Graded value basis', c.gradedValueBasis, [['', 'Select one...'], ['recent-sale', 'Recent sale'], ['comp-estimate', 'Comp estimate']]) +
    ceFieldRow('cceGradedValueNote', 'Graded value note', c.gradedValueNote) +
    '<div class="form-row-split">' +
    ceInputInner('cceDatePriced', 'Date priced', c.datePriced, 'date') +
    ceSelectRow('cceDecision', 'Decision', c.decision, [['', 'Still weighing it'], ['submit', 'Submit'], ['hold', 'Hold'], ['sell-raw', 'Sell raw'], ['pass', 'Pass']]) +
    '</div>' +
    ceFieldRow('cceDecisionNote', 'Decision note', c.decisionNote) +
    ceFieldRow('cceNotes', 'Notes', c.notes, 'textarea') +
    '</div>' +
    '<button type="button" id="cceGenerateBtn" class="print-btn font-mono np-generate-btn">Generate updated JSON</button>' +
    '<div id="cceResult" class="np-result" hidden>' +
    '<ul id="cceWarnings" class="np-warnings"></ul>' +
    '<div class="np-output-head">' +
    '<span class="field-label" style="margin:0">Replace this candidate&rsquo;s whole entry with</span>' +
    '<button type="button" id="cceCopyBtn" class="print-btn font-mono" aria-live="polite">Copy JSON</button>' +
    '</div>' +
    '<pre class="np-output font-mono" id="cceOutput"></pre>' +
    '</div>' +
    '</div></details>';
}

function wireCandidateEditForm(c) {
  const generateBtn = document.getElementById('cceGenerateBtn');
  if (!generateBtn) return;
  const resultEl = document.getElementById('cceResult');
  const warningsEl = document.getElementById('cceWarnings');
  const outputEl = document.getElementById('cceOutput');
  const copyBtn = document.getElementById('cceCopyBtn');

  generateBtn.addEventListener('click', () => {
    const yearRaw = document.getElementById('cceYear').value.trim();
    const rawValueRaw = document.getElementById('cceRawValue').value.trim();
    const gradingCostRaw = document.getElementById('cceEstimatedGradingCost').value.trim();
    const shippingCostRaw = document.getElementById('cceShippingCost').value.trim();
    const gradedValueRaw = document.getElementById('cceExpectedGradedValue').value.trim();

    const edited = Object.assign({}, c, {
      cardName: ceVal('cceCardName') || c.cardName,
      year: yearRaw === '' ? null : Number(yearRaw),
      sport: document.getElementById('cceSport').value || null,
      rawValue: rawValueRaw === '' ? null : Number(rawValueRaw),
      rawValueBasis: document.getElementById('cceRawValueBasis').value || null,
      rawValueNote: ceVal('cceRawValueNote'),
      targetGradingCompany: document.getElementById('cceTargetGradingCompany').value || null,
      targetServiceLevel: ceVal('cceTargetServiceLevel'),
      estimatedGradingCost: gradingCostRaw === '' ? null : Number(gradingCostRaw),
      shippingCost: shippingCostRaw === '' ? null : Number(shippingCostRaw),
      expectedGrade: ceVal('cceExpectedGrade'),
      expectedGradedValue: gradedValueRaw === '' ? null : Number(gradedValueRaw),
      gradedValueBasis: document.getElementById('cceGradedValueBasis').value || null,
      gradedValueNote: ceVal('cceGradedValueNote'),
      datePriced: document.getElementById('cceDatePriced').value || null,
      decision: document.getElementById('cceDecision').value || null,
      decisionNote: ceVal('cceDecisionNote'),
      notes: ceVal('cceNotes')
    });

    let blockers = [];
    let advisory = [];
    if (window.CGTValidateCore) {
      const realCandidates = candidates.filter(x => !isExampleCandidate(x));
      const merged = realCandidates.slice();
      const idx = merged.findIndex(x => x.id === c.id);
      if (idx !== -1) merged[idx] = edited;
      const where = 'candidates[' + idx + ']';
      const strip = m => m.slice(m.indexOf(': ') + 2);
      const { errors, warnings } = window.CGTValidateCore.validateCandidates(merged);
      blockers = errors.filter(m => m.indexOf(where) === 0).map(strip);
      advisory = warnings.filter(m => m.indexOf(where) === 0).map(strip);
    }

    if (edited.decision === 'submit' && !edited.decisionNote) {
      advisory.push('Decision is "submit" but no decision note logging the real submissions.json id this turns ' +
        'into once shipped. Not required, just makes it easier to trace later.');
    }

    if (blockers.length) {
      warningsEl.innerHTML = blockers.map(w => '<li>' + escapeHtml(w) + '</li>').join('');
      outputEl.textContent = '';
      resultEl.hidden = false;
      resultEl.scrollIntoView({ block: 'nearest' });
      return;
    }

    warningsEl.innerHTML = advisory.map(w => '<li>' + escapeHtml(w) + '</li>').join('');
    outputEl.textContent = JSON.stringify(edited, null, 2) + ',';
    resultEl.hidden = false;
    resultEl.scrollIntoView({ block: 'nearest' });
  });

  copyBtn.addEventListener('click', () => {
    copyText(outputEl.textContent).then(() => {
      const original = copyBtn.textContent;
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = original; }, 1800);
    }).catch(() => {
      copyBtn.textContent = "Couldn't copy, select the text manually";
      setTimeout(() => { copyBtn.textContent = 'Copy JSON'; }, 2400);
    });
  });
}

function ceVal(id) {
  const v = document.getElementById(id).value.trim();
  return v === '' ? null : v;
}

// Same guided-form -> JSON -> copy/paste convention as the card and
// candidate edit forms above, for submissions.json. This is the only way to
// move a batch from "in-queue" to "returned" (or log its real tracking
// number / invoiced cost) that isn't hand-editing the file directly.
function submissionEditFormHtml(s) {
  return '<details class="schema-help">' +
    '<summary>Edit this submission&rsquo;s details</summary>' +
    '<div class="schema-help-body">' +
    '<p>Generates this submission&rsquo;s full updated record with whatever fields below you change. ' +
    '<code>id</code> carries over unchanged. Once a batch actually comes back, add the real graded cards to ' +
    '<code>cards.json</code> with their real cert numbers, then set status to &ldquo;returned&rdquo; here with a ' +
    'real returned date rather than deleting this row.</p>' +
    '<div class="np-form">' +
    ceFieldRow('sceDescription', 'Description', s.description) +
    '<div class="form-row-split">' +
    ceSelectRow('sceGradingCompany', 'Grading company', s.gradingCompany, [['', 'Select one...'], ['PSA', 'PSA'], ['BGS', 'BGS'], ['SGC', 'SGC'], ['CGC', 'CGC'], ['HGA', 'HGA'], ['KSA', 'KSA']]) +
    ceInputInner('sceServiceLevel', 'Service level', s.serviceLevel) +
    '</div>' +
    '<div class="form-row-split">' +
    ceInputInner('sceCardCount', 'Card count', s.cardCount, 'number', '1') +
    ceInputInner('sceCost', 'Cost (grading fee), USD', s.cost, 'number') +
    '</div>' +
    '<div class="form-row-split">' +
    ceInputInner('sceSubmittedDate', 'Submitted date', s.submittedDate, 'date') +
    ceInputInner('sceTrackingNumber', 'Tracking number', s.trackingNumber) +
    '</div>' +
    '<div class="form-row-split">' +
    ceSelectRow('sceStatus', 'Status', s.status, [['submitted', 'Submitted'], ['in-queue', 'In queue'], ['grading', 'Grading'], ['shipped-back', 'Shipped back'], ['returned', 'Returned']]) +
    ceInputInner('sceReturnedDate', 'Returned date (required once status is Returned)', s.returnedDate, 'date') +
    '</div>' +
    ceFieldRow('sceNotes', 'Notes', s.notes, 'textarea') +
    '</div>' +
    '<button type="button" id="sceGenerateBtn" class="print-btn font-mono np-generate-btn">Generate updated JSON</button>' +
    '<div id="sceResult" class="np-result" hidden>' +
    '<ul id="sceWarnings" class="np-warnings"></ul>' +
    '<div class="np-output-head">' +
    '<span class="field-label" style="margin:0">Replace this submission&rsquo;s whole entry with</span>' +
    '<button type="button" id="sceCopyBtn" class="print-btn font-mono" aria-live="polite">Copy JSON</button>' +
    '</div>' +
    '<pre class="np-output font-mono" id="sceOutput"></pre>' +
    '</div>' +
    '</div></details>';
}

function wireSubmissionEditForm(s) {
  const generateBtn = document.getElementById('sceGenerateBtn');
  if (!generateBtn) return;
  const resultEl = document.getElementById('sceResult');
  const warningsEl = document.getElementById('sceWarnings');
  const outputEl = document.getElementById('sceOutput');
  const copyBtn = document.getElementById('sceCopyBtn');

  generateBtn.addEventListener('click', () => {
    const cardCountRaw = document.getElementById('sceCardCount').value.trim();
    const costRaw = document.getElementById('sceCost').value.trim();

    const edited = Object.assign({}, s, {
      description: ceVal('sceDescription') || s.description,
      gradingCompany: document.getElementById('sceGradingCompany').value || null,
      serviceLevel: ceVal('sceServiceLevel'),
      cardCount: cardCountRaw === '' ? null : Number(cardCountRaw),
      submittedDate: document.getElementById('sceSubmittedDate').value || null,
      trackingNumber: ceVal('sceTrackingNumber'),
      status: document.getElementById('sceStatus').value || null,
      returnedDate: document.getElementById('sceReturnedDate').value || null,
      cost: costRaw === '' ? null : Number(costRaw),
      notes: ceVal('sceNotes')
    });

    let blockers = [];
    let advisory = [];
    if (window.CGTValidateCore) {
      const realSubmissions = submissions.filter(x => !isExampleSubmission(x));
      const merged = realSubmissions.slice();
      const idx = merged.findIndex(x => x.id === s.id);
      if (idx !== -1) merged[idx] = edited;
      const where = 'submissions[' + idx + ']';
      const strip = m => m.slice(m.indexOf(': ') + 2);
      const { errors, warnings } = window.CGTValidateCore.validateSubmissions(merged);
      blockers = errors.filter(m => m.indexOf(where) === 0).map(strip);
      advisory = warnings.filter(m => m.indexOf(where) === 0).map(strip);
    }

    if (blockers.length) {
      warningsEl.innerHTML = blockers.map(w => '<li>' + escapeHtml(w) + '</li>').join('');
      outputEl.textContent = '';
      resultEl.hidden = false;
      resultEl.scrollIntoView({ block: 'nearest' });
      return;
    }

    warningsEl.innerHTML = advisory.map(w => '<li>' + escapeHtml(w) + '</li>').join('');
    outputEl.textContent = JSON.stringify(edited, null, 2) + ',';
    resultEl.hidden = false;
    resultEl.scrollIntoView({ block: 'nearest' });
  });

  copyBtn.addEventListener('click', () => {
    copyText(outputEl.textContent).then(() => {
      const original = copyBtn.textContent;
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = original; }, 1800);
    }).catch(() => {
      copyBtn.textContent = "Couldn't copy, select the text manually";
      setTimeout(() => { copyBtn.textContent = 'Copy JSON'; }, 2400);
    });
  });
}

// Reuses CGTValidateCore.validateCards, same as the quick-log tool, by
// replacing this card in place within a copy of the real cards array so
// the exact same rules the CLI validator enforces catch a structural
// mistake here too, instead of only on the next `node validate.js` run.
function wireCardEditForm(c) {
  const generateBtn = document.getElementById('ceGenerateBtn');
  if (!generateBtn) return;
  const resultEl = document.getElementById('ceResult');
  const warningsEl = document.getElementById('ceWarnings');
  const outputEl = document.getElementById('ceOutput');
  const copyBtn = document.getElementById('ceCopyBtn');

  generateBtn.addEventListener('click', () => {
    const yearRaw = document.getElementById('ceYear').value.trim();
    const estimatedValueRaw = document.getElementById('ceEstimatedValue').value.trim();
    const costBasisRaw = document.getElementById('ceCostBasis').value.trim();
    const soldPriceRaw = document.getElementById('ceSoldPrice').value.trim();

    const edited = Object.assign({}, c, {
      cardName: ceVal('ceCardName') || c.cardName,
      year: yearRaw === '' ? null : Number(yearRaw),
      sport: document.getElementById('ceSport').value || null,
      gradingCompany: document.getElementById('ceGradingCompany').value || null,
      grade: ceVal('ceGrade'),
      certNumber: ceVal('ceCertNumber'),
      storageLocation: ceVal('ceStorageLocation'),
      estimatedValue: estimatedValueRaw === '' ? null : Number(estimatedValueRaw),
      valuationBasis: document.getElementById('ceValuationBasis').value || null,
      compNote: ceVal('ceCompNote'),
      sourceNote: ceVal('ceSourceNote'),
      imageUrl: ceVal('ceImageUrl'),
      costBasis: costBasisRaw === '' ? null : Number(costBasisRaw),
      datePriced: document.getElementById('ceDatePriced').value || null,
      soldDate: document.getElementById('ceSoldDate').value || null,
      soldPrice: soldPriceRaw === '' ? null : Number(soldPriceRaw),
      backlogBatch: ceVal('ceBacklogBatch'),
      notes: ceVal('ceNotes')
    });

    let blockers = [];
    let advisory = [];
    if (window.CGTValidateCore) {
      const realCards = cards.filter(x => !isExample(x));
      const merged = realCards.slice();
      const idx = merged.findIndex(x => x.id === c.id);
      if (idx !== -1) merged[idx] = edited;
      const where = 'cards[' + idx + ']';
      const strip = m => m.slice(m.indexOf(': ') + 2);
      const { errors, warnings } = window.CGTValidateCore.validateCards(merged);
      blockers = errors.filter(m => m.indexOf(where) === 0).map(strip);
      advisory = warnings.filter(m => m.indexOf(where) === 0).map(strip);

      const dupGroups = window.CGTValidateCore.findDuplicateGroups(merged);
      const ownGroup = dupGroups.find(g => g.cards.includes(edited));
      if (ownGroup) {
        const others = ownGroup.cards.filter(x => x !== edited).map(x => x.id).join(', ');
        advisory.push('Same card name, year, grading company, and grade as an existing card (' + others +
          '). Could be a real second copy, or a duplicate entry, double check before pasting this in.');
      }
    }

    // Re-pricing without moving the old number into priceHistory first loses
    // it silently, exactly the mistake the schema-help instructions above
    // warn against. Every field a real entry needs (value/date/basis) is
    // already sitting right here on the pre-edit card, so this appends it
    // automatically instead of just telling Jack to hand-write it himself.
    // Only when there's a real old datePriced to use, and only when the new
    // datePriced is a real date strictly after it: validate-core.js requires
    // every priceHistory date to be a real date before the card's current
    // datePriced, so auto-appending without either would just hand back a
    // JSON blob its own validator rejects. Falls back to the old advisory-
    // only behavior in that case, since there's no safe entry to build.
    if (c.estimatedValue != null && edited.estimatedValue !== c.estimatedValue &&
        JSON.stringify(edited.priceHistory || null) === JSON.stringify(c.priceHistory || null)) {
      const oldDateIsReal = window.CGTValidateCore ? window.CGTValidateCore.DATE_RE.test(c.datePriced || '') : !!c.datePriced;
      if (oldDateIsReal && edited.datePriced && edited.datePriced > c.datePriced) {
        edited.priceHistory = (c.priceHistory || []).concat([{
          value: c.estimatedValue, date: c.datePriced, basis: c.valuationBasis || null
        }]);
        advisory.push('Estimated value changed from ' + formatUsd(c.estimatedValue) + ' to ' +
          (edited.estimatedValue != null ? formatUsd(edited.estimatedValue) : 'null') +
          '. The old value/date/basis (' + formatUsd(c.estimatedValue) + ', ' + c.datePriced +
          ') was appended to priceHistory automatically, below. Double-check it before pasting this in.');
      } else {
        advisory.push('Estimated value changed from ' + formatUsd(c.estimatedValue) + ' to ' +
          (edited.estimatedValue != null ? formatUsd(edited.estimatedValue) : 'null') +
          ' but priceHistory was not updated, and could not be filled in automatically (the old "datePriced" ' +
          'or the new one is missing, or the new one is not later). Push the old value/date/basis into ' +
          'priceHistory yourself before pasting this in, or that old price is lost.');
      }
    }

    if (blockers.length) {
      warningsEl.innerHTML = blockers.map(w => '<li>' + escapeHtml(w) + '</li>').join('');
      outputEl.textContent = '';
      resultEl.hidden = false;
      resultEl.scrollIntoView({ block: 'nearest' });
      return;
    }

    warningsEl.innerHTML = advisory.map(w => '<li>' + escapeHtml(w) + '</li>').join('');
    outputEl.textContent = JSON.stringify(edited, null, 2) + ',';
    resultEl.hidden = false;
    resultEl.scrollIntoView({ block: 'nearest' });
  });

  copyBtn.addEventListener('click', () => {
    copyText(outputEl.textContent).then(() => {
      const original = copyBtn.textContent;
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = original; }, 1800);
    }).catch(() => {
      copyBtn.textContent = "Couldn't copy, select the text manually";
      setTimeout(() => { copyBtn.textContent = 'Copy JSON'; }, 2400);
    });
  });
}

function openModal(id) {
  activeCard = cards.find(c => c.id === id);
  if (!activeCard) return;
  lastFocusedEl = document.activeElement;

  document.getElementById('modalName').textContent = activeCard.cardName || 'Untitled card';
  const subParts = [activeCard.sport, activeCard.gradingCompany, activeCard.grade ? 'Grade ' + activeCard.grade : null].filter(Boolean);
  document.getElementById('modalSub').textContent = subParts.length ? subParts.join(' · ') : 'No sport/grader/grade logged yet';

  let body = '';
  if (activeCard.imageUrl) {
    body += `<div class="modal-photo-wrap">
      <img src="${escapeHtml(activeCard.imageUrl)}" alt="Photo of ${escapeHtml(activeCard.cardName || 'this card')}" class="modal-photo" loading="lazy">
      <p class="field-note modal-photo-error" hidden>Photo URL on record but the image did not load.</p>
    </div>`;
  }
  body += cardEditFormHtml(activeCard);
  body += field('Cert number', activeCard.certNumber, !activeCard.certNumber);
  const lookup = certLookupLink(activeCard);
  if (lookup) {
    body += `<div class="field-row">
      <a href="${escapeHtml(lookup.url)}" target="_blank" rel="noopener noreferrer" class="cert-link font-mono">${escapeHtml(lookup.text)} &rarr;</a>
      ${lookup.note ? `<div class="field-note">${escapeHtml(lookup.note)}</div>` : ''}
    </div>`;
  }
  const pop = popReportLink(activeCard);
  if (pop) {
    body += `<div class="field-row">
      <a href="${escapeHtml(pop.url)}" target="_blank" rel="noopener noreferrer" class="cert-link font-mono">${escapeHtml(pop.text)} &rarr;</a>
      <div class="field-note">How many copies of this card ${escapeHtml(activeCard.gradingCompany)} has graded at each grade, real rarity context for a grading decision, separate from verifying this one cert above.</div>
      ${pop.note ? `<div class="field-note">${escapeHtml(pop.note)}</div>` : ''}
    </div>`;
  }
  body += field('Storage location', activeCard.storageLocation, !activeCard.storageLocation);
  const comp = compSearchLink(activeCard);
  if (comp) {
    body += `<div class="field-row">
      <a href="${escapeHtml(comp.url)}" target="_blank" rel="noopener noreferrer" class="cert-link font-mono">${escapeHtml(comp.text)} &rarr;</a>
      <div class="field-note">Opens an eBay sold-listings search built from this card's own name/year/grade. eBay now requires you to be signed in to see sold results.</div>
    </div>`;
  }
  body += field('Estimated value', activeCard.estimatedValue != null ? formatUsd(activeCard.estimatedValue) : null, activeCard.estimatedValue == null);
  body += field('Valuation basis', activeCard.valuationBasis === 'recent-sale' ? 'Recent sale' : activeCard.valuationBasis === 'comp-estimate' ? 'Comp-based estimate' : null, !activeCard.valuationBasis);
  body += renderPriceHistoryField(activeCard);
  body += field('Cost basis (what was paid)', activeCard.costBasis != null ? formatUsd(activeCard.costBasis) : null, activeCard.costBasis == null);
  if (isSold(activeCard)) {
    body += field('Sold date', activeCard.soldDate, !activeCard.soldDate);
    body += field('Sold price', activeCard.soldPrice != null ? formatUsd(activeCard.soldPrice) : null, activeCard.soldPrice == null);
    const rgl = computeRealizedGainLoss(activeCard);
    if (rgl) {
      body += field('Realized gain / loss', formatSignedUsd(rgl.abs) + (rgl.pct != null ? ' (' + (rgl.pct >= 0 ? '+' : '') + rgl.pct.toFixed(1) + '%)' : ''), false);
    }
  } else {
    const gl = computeGainLoss(activeCard);
    if (gl) {
      body += field('Unrealized gain / loss', formatSignedUsd(gl.abs) + (gl.pct != null ? ' (' + (gl.pct >= 0 ? '+' : '') + gl.pct.toFixed(1) + '%)' : ''), false);
    }
  }
  body += field('Comp note', activeCard.compNote, !activeCard.compNote);
  body += field('Source', activeCard.sourceNote, !activeCard.sourceNote);
  const datePricedDisplay = activeCard.datePriced && isStale(activeCard)
    ? activeCard.datePriced + ' (180+ days ago, worth a re-check)'
    : activeCard.datePriced;
  body += field('Date priced', datePricedDisplay, !activeCard.datePriced);
  body += field('Backlog batch', activeCard.backlogBatch, !activeCard.backlogBatch);
  body += field('Notes', activeCard.notes, !activeCard.notes);

  document.getElementById('modalBody').innerHTML = body;
  const photoImg = document.querySelector('.modal-photo');
  if (photoImg) {
    photoImg.addEventListener('error', () => {
      photoImg.hidden = true;
      const errNote = document.querySelector('.modal-photo-error');
      if (errNote) errNote.hidden = false;
    });
  }
  wireCardEditForm(activeCard);
  document.getElementById('modalOverlay').hidden = false;
  lockBodyScroll();
  document.getElementById('modalClose').focus();
}

function closeModal() {
  document.getElementById('modalOverlay').hidden = true;
  unlockBodyScroll();
  if (lastFocusedEl && typeof lastFocusedEl.focus === 'function') lastFocusedEl.focus();
  lastFocusedEl = null;
}

function getModalFocusable() {
  return Array.from(document.getElementById('modal').querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  )).filter(el => !el.hasAttribute('disabled') && el.offsetParent !== null);
}

document.getElementById('modalClose').addEventListener('click', closeModal);
document.getElementById('modalOverlay').addEventListener('click', (e) => {
  if (e.target.id === 'modalOverlay') closeModal();
});
document.addEventListener('keydown', (e) => {
  const modalOpen = !document.getElementById('modalOverlay').hidden;
  if (!modalOpen) return;
  if (e.key === 'Escape') {
    closeModal();
    return;
  }
  // Without this, Tab from the last focusable element in the modal (or
  // Shift+Tab from the first) escapes into the table underneath, which a
  // screen reader user or keyboard-only user can't easily tell happened
  // since the modal overlay still visually covers everything.
  if (e.key === 'Tab') {
    const focusable = getModalFocusable();
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
});

document.getElementById('searchInput').addEventListener('input', (e) => {
  searchTerm = e.target.value;
  applyFiltersAndRender();
});

// Same "/" jumps to search shortcut as the main Command Center dashboard.
document.addEventListener('keydown', (e) => {
  const modalOpen = !document.getElementById('modalOverlay').hidden;
  if (!modalOpen && e.key === '/' && document.activeElement.id !== 'searchInput') {
    e.preventDefault();
    document.getElementById('searchInput').focus();
  }
});

let shortcutsOpen = false;
let shortcutsLastFocusedEl = null;

// Only the shortcuts this page actually wires up, never an invented or
// aspirational one -- same "?" convention as GitHub/Gmail/Linear, and the
// same overlay the main Command Center dashboard already added.
const SHORTCUTS = [
  { keys: ['/'], label: 'Focus search' },
  { keys: ['Enter', 'Space'], label: 'Open the focused row, or toggle the focused column sort' },
  { keys: ['Tab'], label: 'Cycle focus inside an open dialog' },
  { keys: ['Esc'], label: 'Close the open dialog' },
  { keys: ['?'], label: 'Show this help' }
];

function renderShortcutsList() {
  document.getElementById('shortcutsList').innerHTML = SHORTCUTS.map(s => `
    <div class="shortcut-row">
      <span class="shortcut-label">${escapeHtml(s.label)}</span>
      <span class="shortcut-keys">${s.keys.map(k => `<kbd class="shortcut-key">${escapeHtml(k)}</kbd>`).join('<span class="shortcut-label">or</span>')}</span>
    </div>
  `).join('');
}

function getShortcutsFocusable() {
  return Array.from(document.getElementById('shortcutsModal').querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  )).filter(el => !el.hasAttribute('disabled') && el.offsetParent !== null);
}

function openShortcuts() {
  if (shortcutsOpen) return;
  shortcutsOpen = true;
  shortcutsLastFocusedEl = document.activeElement;
  renderShortcutsList();
  document.getElementById('shortcutsOverlay').hidden = false;
  lockBodyScroll();
  document.getElementById('shortcutsClose').focus();
}

function closeShortcuts() {
  if (!shortcutsOpen) return;
  shortcutsOpen = false;
  document.getElementById('shortcutsOverlay').hidden = true;
  unlockBodyScroll();
  if (shortcutsLastFocusedEl && typeof shortcutsLastFocusedEl.focus === 'function') shortcutsLastFocusedEl.focus();
  shortcutsLastFocusedEl = null;
}

document.getElementById('shortcutsBtn').addEventListener('click', openShortcuts);
document.getElementById('shortcutsClose').addEventListener('click', closeShortcuts);
document.getElementById('shortcutsOverlay').addEventListener('click', (e) => {
  if (e.target.id === 'shortcutsOverlay') closeShortcuts();
});

document.addEventListener('keydown', (e) => {
  if (!shortcutsOpen) return;
  if (e.key === 'Escape') {
    closeShortcuts();
    return;
  }
  if (e.key === 'Tab') {
    const focusable = getShortcutsFocusable();
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
});

// "?" opens the shortcuts overlay, but never while the user is actually
// typing a "?" character into a real field (the quick-log forms, coverage
// limit input, and search box all take free text).
document.addEventListener('keydown', (e) => {
  if (e.key !== '?') return;
  const modalOpen = !document.getElementById('modalOverlay').hidden;
  if (modalOpen || shortcutsOpen) return;
  const active = document.activeElement;
  const tag = active && active.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (active && active.isContentEditable)) return;
  e.preventDefault();
  openShortcuts();
});

function wireChipGroup(containerId, dataAttr, setter, render) {
  const container = document.getElementById(containerId);
  render = render || applyFiltersAndRender;
  container.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      container.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', 'false'));
      chip.setAttribute('aria-pressed', 'true');
      setter(chip.getAttribute(dataAttr));
      render();
    });
  });
}
restoreStateFromUrl();
document.getElementById('searchInput').value = searchTerm;
setInitialChipState('sportFilter', 'data-sport', activeSport);
setInitialChipState('basisFilter', 'data-basis', activeBasis);
setInitialChipState('graderFilter', 'data-grader', activeGrader);
setInitialChipState('ownershipFilter', 'data-owned', activeOwnership);
// Same restore as the cards tab's chips/search box just above: without this,
// a shared/bookmarked ?candSport=hockey URL filtered the candidates list
// correctly (renderCandidates reads the restored state directly) but left
// every candidate chip showing "All" and the candidate search box empty,
// silently misrepresenting which filter was actually active.
document.getElementById('candidateSearchInput').value = candidateSearchTerm;
setInitialChipState('candidateSportFilter', 'data-cand-sport', activeCandidateSport);
setInitialChipState('candidateVerdictFilter', 'data-cand-verdict', activeCandidateVerdict);
setInitialChipState('candidateStatusFilter', 'data-cand-status', activeCandidateStatus);

wireChipGroup('sportFilter', 'data-sport', (v) => { activeSport = v; });
wireChipGroup('basisFilter', 'data-basis', (v) => { activeBasis = v; });
wireChipGroup('graderFilter', 'data-grader', (v) => { activeGrader = v; });
wireChipGroup('ownershipFilter', 'data-owned', (v) => { activeOwnership = v; });
wireChipGroup('candidateSportFilter', 'data-cand-sport', (v) => { activeCandidateSport = v; }, renderCandidates);
wireChipGroup('candidateVerdictFilter', 'data-cand-verdict', (v) => { activeCandidateVerdict = v; }, renderCandidates);
wireChipGroup('candidateStatusFilter', 'data-cand-status', (v) => { activeCandidateStatus = v; }, renderCandidates);
document.getElementById('candidateSearchInput').addEventListener('input', (e) => {
  candidateSearchTerm = e.target.value;
  renderCandidates();
});
document.getElementById('candidatesClearFiltersBtn').addEventListener('click', () => {
  candidateSearchTerm = '';
  activeCandidateSport = 'all';
  activeCandidateVerdict = 'all';
  activeCandidateStatus = 'all';
  document.getElementById('candidateSearchInput').value = '';
  setInitialChipState('candidateSportFilter', 'data-cand-sport', activeCandidateSport);
  setInitialChipState('candidateVerdictFilter', 'data-cand-verdict', activeCandidateVerdict);
  setInitialChipState('candidateStatusFilter', 'data-cand-status', activeCandidateStatus);
  renderCandidates();
  document.getElementById('candidateSearchInput').focus();
});
wireCoverageCheck();

// Resets search, all four chip groups (batch included, even though its own
// chips are rebuilt per-load rather than static markup like the others), and
// the address bar back to the bare /cgt/ URL in one action, since with four
// separate filter dimensions plus search, undoing them one at a time is
// tedious. Same "Clear filters" pattern as the main Command Center dashboard.
document.getElementById('clearFiltersBtn').addEventListener('click', () => {
  searchTerm = '';
  activeSport = 'all';
  activeBasis = 'all';
  activeGrader = 'all';
  activeBatch = 'all';
  activeOwnership = 'all';
  document.getElementById('searchInput').value = '';
  setInitialChipState('sportFilter', 'data-sport', activeSport);
  setInitialChipState('basisFilter', 'data-basis', activeBasis);
  setInitialChipState('graderFilter', 'data-grader', activeGrader);
  setInitialChipState('batchFilter', 'data-batch', activeBatch);
  setInitialChipState('ownershipFilter', 'data-owned', activeOwnership);
  applyFiltersAndRender();
  document.getElementById('searchInput').focus();
});

function handleSortHeaderActivate(th) {
  const key = th.getAttribute('data-sort');
  if (sortKey === key) {
    sortDir = sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    sortKey = key;
    sortDir = 'asc';
  }
  applyFiltersAndRender();
}
document.querySelectorAll('th.sortable').forEach(th => {
  th.addEventListener('click', () => handleSortHeaderActivate(th));
  th.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleSortHeaderActivate(th);
    }
  });
});

document.getElementById('printBtn').addEventListener('click', () => window.print());

// The grading service tiers reference is collapsed by default so the
// actionable submissions/inventory are closer to the top of the page.
// Once a real visitor opens it to check the current rates, re-collapsing
// on every reload would just make them reopen it again next time, so the
// open/closed state persists in this browser only.
const SECTION_OPEN_KEY_PREFIX = 'cgt-section-open-';
document.querySelectorAll('.section-details[id]').forEach(details => {
  const key = SECTION_OPEN_KEY_PREFIX + details.id;
  try {
    if (localStorage.getItem(key) === '1') details.open = true;
  } catch (e) { /* localStorage unavailable (private window, blocked storage): stays collapsed */ }
  details.addEventListener('toggle', () => {
    try { localStorage.setItem(key, details.open ? '1' : '0'); } catch (e) { /* see above */ }
  });
});

// Separate from the plain print button above: this prints only the
// itemized insurance/appraisal summary (see renderInsuranceSummary), not
// whatever the dashboard happens to be filtered/sorted to right now. The
// insurance-print-mode class is what style.css's @media print block keys
// off of to hide everything else; 'afterprint' cleans it back up whether
// the user actually printed or cancelled out of the print dialog.
document.getElementById('insurancePrintBtn').addEventListener('click', () => {
  document.body.classList.add('insurance-print-mode');
  window.print();
});
window.addEventListener('afterprint', () => {
  document.body.classList.remove('insurance-print-mode');
});

// The current filters/search/sort are already mirrored into the address bar
// by syncUrl(), but most people won't notice that on their own, so this
// copies it explicitly. Falls back to a hidden textarea + execCommand for
// browsers/contexts where the async Clipboard API isn't available.
function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
  } finally {
    document.body.removeChild(ta);
  }
  return Promise.resolve();
}

const copyLinkBtn = document.getElementById('copyLinkBtn');
const COPY_LINK_LABEL = copyLinkBtn.textContent;
copyLinkBtn.addEventListener('click', () => {
  copyText(location.href)
    .then(() => { copyLinkBtn.textContent = 'Link copied'; })
    .catch(() => { copyLinkBtn.textContent = "Couldn't copy, link is in the address bar"; })
    .finally(() => {
      setTimeout(() => { copyLinkBtn.textContent = COPY_LINK_LABEL; }, 1800);
    });
});

function csvField(v) {
  let s = v == null ? '' : String(v);
  // CSV/formula injection (OWASP): a hand-typed note starting with
  // =, +, -, @, tab, or a carriage return is read as a live formula by
  // Excel/Sheets when this export is opened there, not as plain text.
  // A leading single quote is the standard mitigation both recommend.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// Each column is [accessor, label] rather than [key, label] so a derived
// column (gain/loss isn't a real field on the card, it's computed from two
// of them) fits the same list instead of needing special-cased handling
// alongside the plain field lookups.
const CSV_COLUMNS = [
  [c => c.cardName, 'Card'], [c => c.year, 'Year'], [c => c.sport, 'Sport'], [c => c.gradingCompany, 'Grading company'],
  [c => c.grade, 'Grade'], [c => c.certNumber, 'Cert number'], [c => c.storageLocation, 'Storage location'],
  [c => c.estimatedValue, 'Estimated value'],
  [c => computeValueTrend(c)?.prevValue ?? null, 'Previous value'],
  [c => computeValueTrend(c)?.abs ?? null, 'Change since last check'],
  [c => c.valuationBasis, 'Valuation basis'], [c => c.compNote, 'Comp note'], [c => c.sourceNote, 'Source'],
  [c => c.imageUrl, 'Photo URL'],
  [c => c.costBasis, 'Cost basis'],
  [c => isSold(c) ? c.soldDate : null, 'Sold date'],
  [c => isSold(c) ? c.soldPrice : null, 'Sold price'],
  // Realized once a card is sold (soldPrice vs costBasis), unrealized otherwise
  // (estimatedValue vs costBasis), same branch the detail modal already uses;
  // the label column says which one a given row is so the two never get
  // read as the same kind of number.
  [c => isSold(c) ? (computeRealizedGainLoss(c)?.abs ?? null) : (computeGainLoss(c)?.abs ?? null), 'Gain/loss'],
  [c => isSold(c) ? 'Realized' : 'Unrealized', 'Gain/loss type'],
  [c => c.datePriced, 'Date priced'], [c => c.backlogBatch, 'Backlog batch'], [c => c.notes, 'Notes']
];

// Exports exactly what the table currently shows (same filters and sort
// applied), not the full dataset, so the file matches what's on screen.
document.getElementById('csvBtn').addEventListener('click', () => {
  const rows = sortRows(cards.filter(matchesFilters));
  const header = CSV_COLUMNS.map(([, label]) => csvField(label)).join(',');
  const lines = rows.map(c => CSV_COLUMNS.map(([accessor]) => csvField(accessor(c))).join(','));
  const csv = [header, ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'cgt-inventory-' + todayIso() + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

// Full-fidelity backup: unlike the CSV export above, which flattens each
// card to one row and only covers whatever the current filters show, this
// keeps cards.json/submissions.json/candidates.json exactly as loaded so a
// bad hand-edit can be diffed against or restored from a known-good copy.
// Local download only, nothing is sent anywhere. Same approach as CSM's
// own backup button.
document.getElementById('backupBtn').addEventListener('click', () => {
  if (!rawCardsData) return;
  const backup = {
    exportedAt: new Date().toISOString(),
    source: 'Command Center CGT inventory (/cgt), local download only',
    cardsJson: rawCardsData,
    submissionsJson: rawSubmissionsData,
    candidatesJson: rawCandidatesData
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'cgt-backup-' + todayIso() + '.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

// Same per-section CSV export convention as Sondrik's channelsCsvBtn: the
// main csvBtn above only ever covered the card inventory table, leaving these
// two real, hand-logged datasets (raw-card ROI candidates, grading
// submissions) with no flat-file export of their own, only reachable through
// the full-fidelity JSON backup below. Ranked in the same order the feed
// itself renders, unfiltered (buildRankedCandidates covers every real
// candidate, decided or not, same as the on-screen feed).
const CANDIDATES_CSV_COLUMNS = [
  [c => c.cardName, 'Card'], [c => c.year, 'Year'], [c => c.sport, 'Sport'],
  [c => c.targetGradingCompany, 'Target grading company'], [c => c.targetServiceLevel, 'Target service level'],
  [c => c.rawValue, 'Raw value'], [c => c.rawValueBasis, 'Raw value basis'], [c => c.rawValueNote, 'Raw value note'],
  [c => c.estimatedGradingCost, 'Estimated grading cost'], [c => c.shippingCost, 'Shipping cost'],
  [c => c.expectedGrade, 'Expected grade'], [c => c.expectedGradedValue, 'Expected graded value'],
  [c => c.gradedValueBasis, 'Graded value basis'], [c => c.gradedValueNote, 'Graded value note'],
  [c => computeGradingMath(c)?.totalCost ?? null, 'Total cost (grading + shipping)'],
  [c => computeGradingMath(c)?.expectedGain ?? null, 'Expected gain'],
  [c => CANDIDATE_VERDICT_META[computeGradingMath(c)?.verdict || 'needs-data'].label, 'Verdict'],
  [c => c.datePriced, 'Date priced'], [c => c.decision, 'Decision'], [c => c.decisionNote, 'Decision note'],
  [c => c.notes, 'Notes']
];

document.getElementById('candidatesCsvBtn').addEventListener('click', () => {
  const rows = buildRankedCandidates()
    .filter(({ c, math }) => matchesCandidateFilters(c, math ? math.verdict : 'needs-data'))
    .map(({ c }) => c);
  const header = CANDIDATES_CSV_COLUMNS.map(([, label]) => csvField(label)).join(',');
  const lines = rows.map(c => CANDIDATES_CSV_COLUMNS.map(([accessor]) => csvField(accessor(c))).join(','));
  const csv = [header, ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'cgt-candidates-' + todayIso() + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

// Unlike the on-screen feed (buildActiveSubmissions, active-only, since a
// returned batch just collapses into a one-line count there to save space),
// this exports every real submission, active and returned, oldest submitted
// first, since a returned batch's real cost/turnaround is exactly the kind
// of record a flat export exists for and the feed already has no per-row
// view of it at all.
const SUBMISSIONS_CSV_COLUMNS = [
  [s => s.description, 'Description'], [s => s.gradingCompany, 'Grading company'],
  [s => s.serviceLevel, 'Service level'],
  [s => (SUBMISSION_STATUS_META[s.status] || {}).label || s.status, 'Status'],
  [s => s.cardCount, 'Card count'], [s => s.submittedDate, 'Submitted date'],
  [s => s.trackingNumber, 'Tracking number'], [s => s.returnedDate, 'Returned date'],
  [s => s.status !== 'returned' ? daysSince(s.submittedDate) : null, 'Days in queue'],
  [s => computeTurnaroundDays(s), 'Actual turnaround (days)'],
  [s => s.cost, 'Cost'], [s => s.notes, 'Notes']
];

function buildAllSubmissionsSorted() {
  return submissions.slice().sort((a, b) => {
    if (!a.submittedDate && !b.submittedDate) return 0;
    if (!a.submittedDate) return 1;
    if (!b.submittedDate) return -1;
    return a.submittedDate.localeCompare(b.submittedDate);
  });
}

// RFC 5545 (iCalendar) text escaping and 75-octet line folding, same
// approach Garage's and Sondrik's own .ics exports already use.
function icsEscapeText(s) {
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function icsFoldLine(line) {
  if (line.length <= 75) return line;
  let out = line.slice(0, 75);
  let rest = line.slice(75);
  while (rest.length) {
    out += '\r\n ' + rest.slice(0, 74);
    rest = rest.slice(74);
  }
  return out;
}

// One all-day VEVENT per active submission with a real computable estimate,
// never anything invented for a submission with no submittedDate or no
// grader history/published schedule to estimate from (estimatedReturnFor
// already returns null in that case, filtered out below).
function buildSubmissionReturnReminders() {
  const turnaroundByGrader = new Map(buildTurnaroundByGrader().map(g => [g.label, g]));
  const today = todayIso();
  return buildActiveSubmissions().map(s => {
    const { estReturnDate, estReturnIsPublished, graderStats, publishedDays } = estimatedReturnFor(s, turnaroundByGrader);
    if (!estReturnDate) return null;
    const title = s.description || 'Untitled submission';
    // A stale estimate (submission running longer than its published/average
    // turnaround) still gets a reminder, pinned to today rather than a date
    // that's already passed, but the title needs to say so: without this,
    // "Expect back from PSA: ..." on today's date reads as a same-day
    // arrival, not the "this is now overdue" flag the on-screen submissions
    // feed already shows via its own "past PSA avg" badge (renderSubmissions
    // above).
    const isOverdue = estReturnDate < today;
    const date = isOverdue ? today : estReturnDate;
    const basis = estReturnIsPublished
      ? `${s.gradingCompany}'s own published estimate (about ${publishedDays} business days for this service level, not a guarantee)`
      : `${s.gradingCompany}'s own average turnaround across ${graderStats.count} returned submission${graderStats.count === 1 ? '' : 's'} (${graderStats.value} days), not a guarantee`;
    return {
      id: s.id,
      date,
      summary: isOverdue
        ? `Overdue: was expected back from ${s.gradingCompany || 'grader'}, ${title}`
        : `Expect back from ${s.gradingCompany || 'grader'}: ${title}`,
      description: `Estimated return around ${estReturnDate}, based on ${basis}. Command Center CGT.`
    };
  }).filter(Boolean);
}

function buildSubmissionsIcs(reminders) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Command Center//CGT Submission Reminders//EN', 'CALSCALE:GREGORIAN'];
  reminders.forEach(r => {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:cgt-${r.id}-${r.date}@command-center.local`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART;VALUE=DATE:${r.date.replace(/-/g, '')}`);
    lines.push(icsFoldLine(`SUMMARY:${icsEscapeText(r.summary)}`));
    lines.push(icsFoldLine(`DESCRIPTION:${icsEscapeText(r.description)}`));
    lines.push('BEGIN:VALARM');
    lines.push('ACTION:DISPLAY');
    lines.push(icsFoldLine(`DESCRIPTION:${icsEscapeText(r.summary)}`));
    lines.push('TRIGGER:PT9H');
    lines.push('END:VALARM');
    lines.push('END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

const submissionsIcsBtn = document.getElementById('submissionsIcsBtn');
const SUBMISSIONS_ICS_LABEL = submissionsIcsBtn.textContent;
submissionsIcsBtn.addEventListener('click', () => {
  const reminders = buildSubmissionReturnReminders();
  if (!reminders.length) {
    submissionsIcsBtn.textContent = 'No active submissions with an estimate yet';
    setTimeout(() => { submissionsIcsBtn.textContent = SUBMISSIONS_ICS_LABEL; }, 2400);
    return;
  }
  const ics = buildSubmissionsIcs(reminders);
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'cgt-submission-reminders-' + todayIso() + '.ics';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  submissionsIcsBtn.textContent = `Downloaded ${reminders.length} reminder${reminders.length === 1 ? '' : 's'}`;
  setTimeout(() => { submissionsIcsBtn.textContent = SUBMISSIONS_ICS_LABEL; }, 2400);
});

document.getElementById('submissionsCsvBtn').addEventListener('click', () => {
  const rows = buildAllSubmissionsSorted();
  const header = SUBMISSIONS_CSV_COLUMNS.map(([, label]) => csvField(label)).join(',');
  const lines = rows.map(s => SUBMISSIONS_CSV_COLUMNS.map(([accessor]) => csvField(accessor(s))).join(','));
  const csv = [header, ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'cgt-submissions-' + todayIso() + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

// Shared client-side draft-autosave for the three quick-log forms below:
// none of them write to a real file, this app has no backend to save a
// half-filled form to, so an accidental reload or navigation away used to
// throw away real typed data with no way back. Same pattern CSM's own
// new-prospect form already uses (public/csm/app.js), generalized to read
// whatever real input/select/textarea fields the given form actually has
// instead of a hand-maintained id list per form, since these three forms
// have 11 to 19 fields each that would otherwise need to be kept in sync by
// hand as fields are added. Autosaved to this browser's localStorage only,
// never sent anywhere, so it does not conflict with this page's
// no-fabricated-data rule; a private window or blocked storage just means
// the draft protection quietly no-ops.
function attachDraftGuard(form, storageKey, banner) {
  const bannerEl = document.getElementById(banner.bannerId);
  const bannerTimeEl = document.getElementById(banner.timeId);
  const discardBtn = document.getElementById(banner.discardId);
  if (!bannerEl || !bannerTimeEl || !discardBtn) return { clearDraft() {} };

  const fields = Array.from(form.querySelectorAll('input[id], select[id], textarea[id]'));
  let saveTimer = null;

  function readValues() {
    const values = {};
    fields.forEach(el => { values[el.id] = el.value; });
    return values;
  }
  function hasAnyValue(values) {
    return fields.some(el => (values[el.id] || '').trim() !== '');
  }
  function clearDraft() {
    try { localStorage.removeItem(storageKey); } catch (e) { /* see saveDraft below */ }
    bannerEl.hidden = true;
  }
  function saveDraft() {
    try {
      const values = readValues();
      if (!hasAnyValue(values)) { clearDraft(); return; }
      localStorage.setItem(storageKey, JSON.stringify({ savedAt: Date.now(), values }));
    } catch (e) { /* localStorage unavailable (private window, blocked storage): draft protection just no-ops */ }
  }

  form.addEventListener('input', () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDraft, 400);
  });
  // The 400ms debounce above means a value typed right before a reload or
  // tab close can be lost before it ever reaches localStorage, defeating
  // the whole point of this guard. visibilitychange (hidden) is the last
  // reliably-fired lifecycle event on both desktop and mobile, pagehide
  // covers same-tab navigation; unload/beforeunload are deprecated and
  // increasingly unreliable, so neither is used here.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { clearTimeout(saveTimer); saveDraft(); }
  });
  window.addEventListener('pagehide', () => { clearTimeout(saveTimer); saveDraft(); });
  discardBtn.addEventListener('click', () => {
    clearDraft();
    form.reset();
    if (banner.onDiscard) banner.onDiscard();
  });

  try {
    const raw = localStorage.getItem(storageKey);
    const draft = raw ? JSON.parse(raw) : null;
    if (draft && hasAnyValue(draft.values || {})) {
      fields.forEach(el => { if (el.id in draft.values) el.value = draft.values[el.id]; });
      bannerTimeEl.textContent = new Date(draft.savedAt).toLocaleString();
      bannerEl.hidden = false;
    }
  } catch (e) { /* see saveDraft above */ }

  return { clearDraft };
}

// Quick-log tool: builds one candidate card from the form and runs it
// through CGTValidateCore.validateCards, the exact same rules the CLI
// validator and the CSV importer already use (see validate-core.js's own
// header comment on why there is only one copy of these rules), instead of
// hand-rolling a second set of checks here that could drift from them.
// Never writes cards.json itself, Command Center's dashboards have no
// backend to save to; this only builds paste-ready JSON for the clipboard.
function initQuickLogTool() {
  const form = document.getElementById('quickCardForm');
  if (!form) return;
  const warningsBox = document.getElementById('ncWarnings');
  const output = document.getElementById('ncOutput');
  const copyBtn = document.getElementById('ncCopyBtn');
  const live = document.getElementById('quickLogLive');
  const draftGuard = attachDraftGuard(form, 'cgt-nc-draft-v1', {
    bannerId: 'ncDraftBanner', timeId: 'ncDraftBannerTime', discardId: 'ncDiscardDraftBtn',
    onDiscard: () => { output.hidden = true; copyBtn.hidden = true; warningsBox.textContent = ''; }
  });

  form.addEventListener('submit', e => {
    e.preventDefault();
    const id = document.getElementById('ncId').value.trim();
    const cardName = document.getElementById('ncCardName').value.trim();
    const yearRaw = document.getElementById('ncYear').value.trim();
    const estimatedValueRaw = document.getElementById('ncEstimatedValue').value.trim();
    const costBasisRaw = document.getElementById('ncCostBasis').value.trim();

    const candidate = {
      id,
      cardName: cardName || null,
      year: yearRaw === '' ? null : Number(yearRaw),
      sport: document.getElementById('ncSport').value || null,
      gradingCompany: document.getElementById('ncGradingCompany').value || null,
      grade: document.getElementById('ncGrade').value.trim() || null,
      certNumber: document.getElementById('ncCertNumber').value.trim() || null,
      storageLocation: document.getElementById('ncStorageLocation').value.trim() || null,
      estimatedValue: estimatedValueRaw === '' ? null : Number(estimatedValueRaw),
      valuationBasis: document.getElementById('ncValuationBasis').value || null,
      compNote: document.getElementById('ncCompNote').value.trim() || null,
      sourceNote: document.getElementById('ncSourceNote').value.trim() || null,
      imageUrl: document.getElementById('ncImageUrl').value.trim() || null,
      costBasis: costBasisRaw === '' ? null : Number(costBasisRaw),
      datePriced: document.getElementById('ncDatePriced').value || null,
      backlogBatch: document.getElementById('ncBacklogBatch').value.trim() || null,
      priceHistory: [],
      notes: document.getElementById('ncNotes').value.trim() || null
    };

    let blockers = [];
    let advisory = [];
    if (window.CGTValidateCore) {
      const realCards = cards.filter(c => !isExample(c));
      const merged = realCards.concat([candidate]);
      // The candidate is always the last element, so this is its own,
      // unambiguous "where" prefix, e.g. "cards[89]" or "cards[89] (my-id)".
      // The trailing "]" rules out index 8 matching as a prefix of index 89.
      const candidateWhere = 'cards[' + realCards.length + ']';
      const strip = m => m.slice(m.indexOf(': ') + 2);
      const { errors, warnings } = window.CGTValidateCore.validateCards(merged);
      blockers = errors.filter(m => m.indexOf(candidateWhere) === 0).map(strip);
      advisory = warnings.filter(m => m.indexOf(candidateWhere) === 0).map(strip);

      const dupGroups = window.CGTValidateCore.findDuplicateGroups(merged);
      const ownGroup = dupGroups.find(g => g.cards.includes(candidate));
      if (ownGroup) {
        const others = ownGroup.cards.filter(c => c !== candidate).map(c => c.id).join(', ');
        advisory.push('Same card name, year, grading company, and grade as an existing card (' + others +
          '). Could be a real second copy, or a duplicate entry, double check before pasting this in.');
      }
    }

    if (blockers.length) {
      warningsBox.textContent = blockers.join(' ');
      output.hidden = true;
      copyBtn.hidden = true;
      return;
    }

    warningsBox.textContent = advisory.join(' ');
    output.value = JSON.stringify(candidate, null, 2) + ',';
    output.hidden = false;
    copyBtn.hidden = false;
  });

  copyBtn.addEventListener('click', () => {
    copyText(output.value).then(() => {
      const original = copyBtn.textContent;
      copyBtn.textContent = 'Copied!';
      live.textContent = 'Card JSON copied to clipboard.';
      draftGuard.clearDraft();
      setTimeout(() => { copyBtn.textContent = original; }, 1800);
    }).catch(() => { live.textContent = 'Could not copy to clipboard.'; });
  });
}
initQuickLogTool();

// Same pattern as initQuickLogTool above, just for submissions.json instead
// of cards.json: fills a form, runs the real submissions validator against
// the real existing rows plus this one, and hands back JSON to paste in by
// hand rather than writing anything itself.
function initSubmissionQuickLogTool() {
  const form = document.getElementById('quickSubmissionForm');
  if (!form) return;
  const warningsBox = document.getElementById('nsWarnings');
  const output = document.getElementById('nsOutput');
  const copyBtn = document.getElementById('nsCopyBtn');
  const live = document.getElementById('nsLive');
  const draftGuard = attachDraftGuard(form, 'cgt-ns-draft-v1', {
    bannerId: 'nsDraftBanner', timeId: 'nsDraftBannerTime', discardId: 'nsDiscardDraftBtn',
    onDiscard: () => { output.hidden = true; copyBtn.hidden = true; warningsBox.textContent = ''; }
  });

  form.addEventListener('submit', e => {
    e.preventDefault();
    const id = document.getElementById('nsId').value.trim();
    const cardCountRaw = document.getElementById('nsCardCount').value.trim();
    const costRaw = document.getElementById('nsCost').value.trim();

    const candidate = {
      id,
      gradingCompany: document.getElementById('nsGradingCompany').value || null,
      serviceLevel: document.getElementById('nsServiceLevel').value.trim() || null,
      description: document.getElementById('nsDescription').value.trim() || null,
      cardCount: cardCountRaw === '' ? null : Number(cardCountRaw),
      submittedDate: document.getElementById('nsSubmittedDate').value || null,
      trackingNumber: document.getElementById('nsTrackingNumber').value.trim() || null,
      status: document.getElementById('nsStatus').value || null,
      returnedDate: document.getElementById('nsReturnedDate').value || null,
      cost: costRaw === '' ? null : Number(costRaw),
      notes: document.getElementById('nsNotes').value.trim() || null
    };

    let blockers = [];
    let advisory = [];
    if (window.CGTValidateCore) {
      const realSubmissions = submissions.filter(s => !isExampleSubmission(s));
      const merged = realSubmissions.concat([candidate]);
      const candidateWhere = 'submissions[' + realSubmissions.length + ']';
      const strip = m => m.slice(m.indexOf(': ') + 2);
      const { errors, warnings } = window.CGTValidateCore.validateSubmissions(merged);
      blockers = errors.filter(m => m.indexOf(candidateWhere) === 0).map(strip);
      advisory = warnings.filter(m => m.indexOf(candidateWhere) === 0).map(strip);
    }

    if (blockers.length) {
      warningsBox.textContent = blockers.join(' ');
      output.hidden = true;
      copyBtn.hidden = true;
      return;
    }

    warningsBox.textContent = advisory.join(' ');
    output.value = JSON.stringify(candidate, null, 2) + ',';
    output.hidden = false;
    copyBtn.hidden = false;
  });

  copyBtn.addEventListener('click', () => {
    copyText(output.value).then(() => {
      const original = copyBtn.textContent;
      copyBtn.textContent = 'Copied!';
      live.textContent = 'Submission JSON copied to clipboard.';
      draftGuard.clearDraft();
      setTimeout(() => { copyBtn.textContent = original; }, 1800);
    }).catch(() => { live.textContent = 'Could not copy to clipboard.'; });
  });
}
initSubmissionQuickLogTool();

// Same pattern again, for candidates.json.
function initCandidateQuickLogTool() {
  const form = document.getElementById('quickCandidateForm');
  if (!form) return;
  const warningsBox = document.getElementById('ncaWarnings');
  const output = document.getElementById('ncaOutput');
  const copyBtn = document.getElementById('ncaCopyBtn');
  const live = document.getElementById('ncaLive');
  const draftGuard = attachDraftGuard(form, 'cgt-nca-draft-v1', {
    bannerId: 'ncaDraftBanner', timeId: 'ncaDraftBannerTime', discardId: 'ncaDiscardDraftBtn',
    onDiscard: () => { output.hidden = true; copyBtn.hidden = true; warningsBox.textContent = ''; }
  });

  form.addEventListener('submit', e => {
    e.preventDefault();
    const id = document.getElementById('ncaId').value.trim();
    const yearRaw = document.getElementById('ncaYear').value.trim();
    const rawValueRaw = document.getElementById('ncaRawValue').value.trim();
    const estimatedGradingCostRaw = document.getElementById('ncaEstimatedGradingCost').value.trim();
    const shippingCostRaw = document.getElementById('ncaShippingCost').value.trim();
    const expectedGradedValueRaw = document.getElementById('ncaExpectedGradedValue').value.trim();

    const candidate = {
      id,
      cardName: document.getElementById('ncaCardName').value.trim() || null,
      year: yearRaw === '' ? null : Number(yearRaw),
      sport: document.getElementById('ncaSport').value || null,
      rawValue: rawValueRaw === '' ? null : Number(rawValueRaw),
      rawValueBasis: document.getElementById('ncaRawValueBasis').value || null,
      rawValueNote: document.getElementById('ncaRawValueNote').value.trim() || null,
      targetGradingCompany: document.getElementById('ncaTargetGradingCompany').value || null,
      targetServiceLevel: document.getElementById('ncaTargetServiceLevel').value.trim() || null,
      estimatedGradingCost: estimatedGradingCostRaw === '' ? null : Number(estimatedGradingCostRaw),
      shippingCost: shippingCostRaw === '' ? null : Number(shippingCostRaw),
      expectedGrade: document.getElementById('ncaExpectedGrade').value.trim() || null,
      expectedGradedValue: expectedGradedValueRaw === '' ? null : Number(expectedGradedValueRaw),
      gradedValueBasis: document.getElementById('ncaGradedValueBasis').value || null,
      gradedValueNote: document.getElementById('ncaGradedValueNote').value.trim() || null,
      datePriced: document.getElementById('ncaDatePriced').value || null,
      decision: document.getElementById('ncaDecision').value || null,
      decisionNote: document.getElementById('ncaDecisionNote').value.trim() || null,
      notes: document.getElementById('ncaNotes').value.trim() || null
    };

    let blockers = [];
    let advisory = [];
    if (window.CGTValidateCore) {
      const realCandidates = candidates.filter(c => !isExampleCandidate(c));
      const merged = realCandidates.concat([candidate]);
      const candidateWhere = 'candidates[' + realCandidates.length + ']';
      const strip = m => m.slice(m.indexOf(': ') + 2);
      const { errors, warnings } = window.CGTValidateCore.validateCandidates(merged);
      blockers = errors.filter(m => m.indexOf(candidateWhere) === 0).map(strip);
      advisory = warnings.filter(m => m.indexOf(candidateWhere) === 0).map(strip);
    }

    if (blockers.length) {
      warningsBox.textContent = blockers.join(' ');
      output.hidden = true;
      copyBtn.hidden = true;
      return;
    }

    warningsBox.textContent = advisory.join(' ');
    output.value = JSON.stringify(candidate, null, 2) + ',';
    output.hidden = false;
    copyBtn.hidden = false;
  });

  copyBtn.addEventListener('click', () => {
    copyText(output.value).then(() => {
      const original = copyBtn.textContent;
      copyBtn.textContent = 'Copied!';
      live.textContent = 'Candidate JSON copied to clipboard.';
      draftGuard.clearDraft();
      setTimeout(() => { copyBtn.textContent = original; }, 1800);
    }).catch(() => { live.textContent = 'Could not copy to clipboard.'; });
  });
}
initCandidateQuickLogTool();

// This device's own network path (navigator.onLine plus the real
// online/offline events), a different question from whether the last fetch
// succeeded: the service worker can serve a cached /data/*.json response
// successfully while genuinely offline, so "the fetch resolved" is not
// proof this page is current. Same banner Alpha already shows for the
// same reason.
function updateOfflineBanner() {
  const banner = document.getElementById('offlineBanner');
  if (banner) banner.hidden = navigator.onLine;
}
window.addEventListener('offline', updateOfflineBanner);
window.addEventListener('online', updateOfflineBanner);
updateOfflineBanner();

loadCards();

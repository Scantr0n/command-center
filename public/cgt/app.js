let cards = [];
let submissions = [];
let candidates = [];
let activeCard = null;
let lastFocusedEl = null;
let searchTerm = '';
let activeSport = 'all';
let activeBasis = 'all';
let activeGrader = 'all';
let activeBatch = 'all';
let sortKey = null;
let sortDir = 'asc';

// Filters, search, and sort are mirrored into the URL query string so a
// specific view (e.g. "PSA hockey cards sorted by value") can be bookmarked
// or shared as a link, the way collectibles trackers like collecto.rs do.
// Restored once on load, then kept in sync via history.replaceState so
// typing in the search box doesn't spam the browser's back/forward history.
const VALID_BASES = ['recent-sale', 'comp-estimate', 'unpriced'];
const VALID_GRADERS = ['PSA', 'BGS', 'SGC', 'CGC', 'HGA', 'KSA'];
const VALID_SPORTS = ['hockey', 'baseball', 'football'];

function restoreStateFromUrl() {
  const params = new URLSearchParams(location.search);
  const q = params.get('q');
  const sport = params.get('sport');
  const basis = params.get('basis');
  const grader = params.get('grader');
  const batch = params.get('batch');
  const sort = params.get('sort');
  const dir = params.get('dir');
  if (q) searchTerm = q;
  if (sport && VALID_SPORTS.includes(sport)) activeSport = sport;
  if (basis && VALID_BASES.includes(basis)) activeBasis = basis;
  if (grader && VALID_GRADERS.includes(grader)) activeGrader = grader;
  // Not validated against a fixed list like sport/basis/grader, since batch
  // labels are open-ended (one per real pricing session). An unknown batch
  // in the URL just matches nothing once applied, same as a stale bookmark.
  if (batch) activeBatch = batch;
  if (sort) sortKey = sort;
  if (dir === 'desc') sortDir = 'desc';
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
  if (sortKey) {
    params.set('sort', sortKey);
    if (sortDir === 'desc') params.set('dir', 'desc');
  }
  const qs = params.toString();
  const url = location.pathname + (qs ? '?' + qs : '');
  history.replaceState(null, '', url);
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function formatUsd(n) {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
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
  BGS: { deepLink: cert => 'https://www.beckett.com/grading/card-lookup?item_id=' + encodeURIComponent(cert) + '&item_type=BGS' },
  SGC: { landing: 'https://www.gosgc.com/auth-code' },
  CGC: { landing: 'https://www.cgccards.com/verify' },
  KSA: { landing: 'https://www.ksagrading.com/pages/card-serial-number-verification' }
};

function certLookupLink(c) {
  const entry = c.gradingCompany && CERT_LOOKUP[c.gradingCompany];
  if (!entry) return null;
  if (entry.deepLink && c.certNumber) {
    return { url: entry.deepLink(c.certNumber), text: 'Verify cert on ' + c.gradingCompany + '.com' };
  }
  if (entry.landing) {
    return { url: entry.landing, text: 'Open ' + c.gradingCompany + ' cert lookup (enter cert by hand)' };
  }
  return null;
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
  } catch (e) {
    submissions = [];
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
  } catch (e) {
    candidates = [];
    console.error("Couldn't load candidates.json: " + e.message);
  }
}

async function loadCards() {
  const errBox = document.getElementById('tableEmpty');
  await loadSubmissions();
  await loadCandidates();
  try {
    const res = await fetch('/cgt/data/cards.json');
    if (!res.ok) throw new Error('Server returned ' + res.status);
    const data = await res.json();
    cards = data.cards || [];
    renderStats();
    renderCandidates();
    renderSubmissions();
    renderValueBreakdown();
    renderBiggestMovers();
    renderPricingActivity();
    renderUnpriced();
    renderDataQuality();
    renderStalePricing();
    renderDuplicates();
    renderGradeLadderFlags();
    renderBatchFilter();
    renderInsuranceSummary();
    applyFiltersAndRender();
    initTableScrollShadows();
  } catch (e) {
    cards = [];
    document.getElementById('cardTableBody').innerHTML = '';
    errBox.hidden = false;
    errBox.setAttribute('role', 'alert');
    errBox.textContent = "Couldn't load cards.json: " + e.message;
  }
}

function renderStats() {
  const real = cards.filter(c => !isExample(c));
  const priced = real.filter(c => c.estimatedValue != null);
  const totalValue = priced.reduce((s, c) => s + c.estimatedValue, 0);
  const saleCards = priced.filter(c => c.valuationBasis === 'recent-sale');
  const compCards = priced.filter(c => c.valuationBasis === 'comp-estimate');
  const saleValue = saleCards.reduce((s, c) => s + c.estimatedValue, 0);
  const compValue = compCards.reduce((s, c) => s + c.estimatedValue, 0);
  const stale = priced.filter(isStale).length;
  // Built from whatever sport values actually appear on real cards, not a
  // hardcoded hockey/baseball/football list, so a card logged under any other
  // sport still shows up here instead of being silently uncounted.
  const bySportCounts = new Map();
  real.forEach(c => { if (c.sport) bySportCounts.set(c.sport, (bySportCounts.get(c.sport) || 0) + 1); });
  const bySportBreakdown = [...bySportCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([sport, count]) => sport.charAt(0).toUpperCase() + sport.slice(1) + ' ' + count)
    .join(' / ');

  // Only counts cards where both a real purchase price and a real researched
  // value are on record, same rule as computeGainLoss. A card with only one
  // of the two contributes to neither side, rather than being treated as a
  // break-even or a total-loss by assuming the missing field is zero.
  const withCostBasis = real.filter(c => c.costBasis != null && c.estimatedValue != null);
  const totalCostBasis = withCostBasis.reduce((s, c) => s + c.costBasis, 0);
  const totalCurrentValue = withCostBasis.reduce((s, c) => s + c.estimatedValue, 0);
  const netGainLoss = totalCurrentValue - totalCostBasis;
  const netGainLossPct = totalCostBasis > 0 ? (netGainLoss / totalCostBasis) * 100 : null;

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
  const trended = real.map(c => ({ c, trend: computeValueTrend(c) })).filter(x => x.trend);
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
    { value: real.length, label: 'Cards logged', sub: cards.length !== real.length ? '+ 1 example row' : null },
    { value: priced.length ? formatUsd(totalValue) : '$0', label: 'Total estimated value', sub: priced.length ? priced.length + ' priced' : 'nothing priced yet' },
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
  const priced = cards.filter(c => !isExample(c) && c.estimatedValue != null && c[field]);
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
  const priced = cards.filter(c => !isExample(c) && c.estimatedValue != null && c.gradingCompany && c.grade != null);
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
  const priced = cards.filter(c => !isExample(c) && c.estimatedValue != null && c.year != null);
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
  const priced = cards.filter(c => !isExample(c) && c.estimatedValue != null && c.backlogBatch);
  const totals = new Map();
  priced.forEach(c => totals.set(c.backlogBatch, (totals.get(c.backlogBatch) || 0) + c.estimatedValue));
  return [...totals.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.label.localeCompare(a.label));
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
  const rows = groups.map(g => `
    <div class="breakdown-row">
      <span class="breakdown-label">${escapeHtml(g.label)}</span>
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
    .filter(c => !isExample(c))
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
  const expectedGain = c.expectedGradedValue - c.rawValue - totalCost;
  let verdict;
  if (expectedGain >= totalCost * GRADING_RISK_MULTIPLE) verdict = 'worth-grading';
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

function renderCandidates() {
  const el = document.getElementById('candidatesFeed');
  const ranked = buildRankedCandidates();

  if (!ranked.length) {
    el.innerHTML = '<p class="submissions-empty" role="status">No raw-card candidates logged yet.</p>';
    return;
  }

  const rows = ranked.map(({ c, math }) => {
    const verdictKey = math ? math.verdict : 'needs-data';
    const meta = CANDIDATE_VERDICT_META[verdictKey];
    const gainText = math ? formatSignedUsd(math.expectedGain) : 'n/a';
    const metaParts = [
      c.sport,
      c.targetGradingCompany,
      c.rawValue != null ? 'raw ' + formatUsd(c.rawValue) : null,
      c.expectedGradedValue != null ? 'est. graded ' + formatUsd(c.expectedGradedValue) + (c.expectedGrade ? ' (' + c.expectedGrade + ')' : '') : null,
      math ? 'costs ' + formatUsd(math.totalCost) : null
    ].filter(Boolean);
    return `
      <div class="submission-row candidate-row">
        <span class="submission-days font-mono${math && math.expectedGain < 0 ? ' submission-days-late' : ''}">${escapeHtml(gainText)}</span>
        <span class="badge ${meta.cls}">${escapeHtml(meta.label)}</span>
        <span class="submission-who">${escapeHtml(c.cardName || 'Untitled candidate')}${isExampleCandidate(c) ? ' <span class="badge badge-example">example</span>' : ''}</span>
        <span class="submission-meta">${escapeHtml(metaParts.join(' · '))}</span>
      </div>
    `;
  }).join('');

  el.innerHTML = rows;
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

// A separate feed from Pricing activity above: this is the front of the
// pipeline (cards shipped off, not graded yet) rather than the back of it
// (cards already priced). Kept in its own section since the two answer
// different questions: "what's still out" vs. "what got priced recently".
function renderSubmissions() {
  const el = document.getElementById('submissionsFeed');
  const active = buildActiveSubmissions();
  const returnedCount = submissions.filter(s => s.status === 'returned' && !isExampleSubmission(s)).length;

  if (!active.length) {
    el.innerHTML = '<p class="submissions-empty" role="status">Nothing currently out for grading.' +
      (returnedCount ? ' ' + returnedCount + ' past submission' + (returnedCount === 1 ? '' : 's') + ' logged as returned.' : '') +
      '</p>';
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
    const days = daysSince(s.submittedDate);
    const daysText = days == null ? 'no date logged' : days + ' day' + (days === 1 ? '' : 's') + ' in queue';
    const graderStats = s.gradingCompany && turnaroundByGrader.get(s.gradingCompany);
    const runningLong = days != null && graderStats && graderStats.count >= 2 && days > graderStats.value;
    // Only projected forward while the submission is still within that
    // grader's own average window; once it's running long the "past avg"
    // badge below already says so, and a projected date already in the past
    // would just read as a broken estimate rather than a useful one.
    const estReturnDate = (!runningLong && s.submittedDate && graderStats && graderStats.count >= 2)
      ? addDaysIso(s.submittedDate, graderStats.value)
      : null;
    const lookup = s.gradingCompany && ORDER_STATUS_LOOKUP[s.gradingCompany];
    const metaParts = [
      s.gradingCompany,
      s.serviceLevel,
      s.cardCount != null ? s.cardCount + ' card' + (s.cardCount === 1 ? '' : 's') : null,
      s.cost != null ? formatUsd(s.cost) + ' fee' : null
    ].filter(Boolean);
    return `
      <div class="submission-row">
        <span class="submission-days font-mono${runningLong ? ' submission-days-late' : ''}">${escapeHtml(daysText)}</span>
        <span class="badge ${meta.cls}">${escapeHtml(meta.label)}</span>
        <span class="submission-who">${escapeHtml(s.description || 'Untitled submission')}${isExampleSubmission(s) ? ' <span class="badge badge-example">example</span>' : ''}</span>
        <span class="submission-meta">${escapeHtml(metaParts.join(' · '))}</span>
        ${runningLong ? `<span class="badge badge-late" title="${escapeHtml(s.gradingCompany)}'s own average turnaround across ${graderStats.count} returned submission${graderStats.count === 1 ? '' : 's'} is ${graderStats.value} days">past ${escapeHtml(s.gradingCompany)} avg (${graderStats.value}d)</span>` : ''}
        ${estReturnDate ? `<span class="submission-meta font-mono" title="Based on ${escapeHtml(s.gradingCompany)}'s own average turnaround across ${graderStats.count} returned submission${graderStats.count === 1 ? '' : 's'} (${graderStats.value} days), not a guarantee from the grader">est. back ~${escapeHtml(estReturnDate)}</span>` : ''}
        ${lookup ? `<a href="${escapeHtml(lookup.url)}" target="_blank" rel="noopener noreferrer" class="submission-link font-mono">${escapeHtml(lookup.text)} &rarr;</a>` : ''}
      </div>
    `;
  }).join('');

  el.innerHTML = rows + (returnedCount
    ? `<div class="submissions-returned-note">+ ${returnedCount} past submission${returnedCount === 1 ? '' : 's'} logged as returned</div>`
    : '');
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
  return cards.filter(c => !isExample(c) && c.estimatedValue == null);
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
    .filter(c => !isExample(c) && isStale(c))
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

// Builds the itemized appraisal/insurance list once from the real dataset,
// independent of whatever the on-screen table is currently filtered/sorted
// to, since an insurance document needs "everything with a real value on
// record," not "whatever slice happened to be on screen when someone hit
// print." Unpriced cards and the example row are excluded from both the
// list and the total, and the exclusion count is stated plainly so the
// total on the page never gets mistaken for a complete collection value.
function renderInsuranceSummary() {
  const el = document.getElementById('insuranceSummary');
  const real = cards.filter(c => !isExample(c));
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
  const rows = priced.map(c => `
    <tr>
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
    <p class="insurance-summary-note">${unpricedCount
      ? unpricedCount + ' additional card' + (unpricedCount === 1 ? '' : 's') + ' logged with no researched value yet, excluded from this list and from the total below.'
      : 'Every logged card has a researched value on record; none excluded.'
    } A value marked "Comp-based estimate" has no directly comparable sale on record and is inferred from related sales, not a confirmed sale of this exact card and grade. A blank "Location" means no storage location has been logged for that card yet.</p>
    <table class="insurance-summary-table">
      <thead>
        <tr>
          <th>Card</th><th>Sport</th><th>Grader</th><th>Grade</th><th>Cert #</th><th>Location</th>
          <th class="num">Est. value</th><th>Basis</th><th>Date priced</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr class="insurance-summary-total">
          <td colspan="6">Total (${priced.length} card${priced.length === 1 ? '' : 's'})</td>
          <td class="num">${formatUsd(total)}</td>
          <td colspan="2"></td>
        </tr>
      </tfoot>
    </table>
  `;
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
    || String(c.year ?? '').includes(term);
}
function matchesSportValue(c, sport) { return sport === 'all' || c.sport === sport; }
function matchesGraderValue(c, grader) { return grader === 'all' || c.gradingCompany === grader; }
function matchesBatchValue(c, batch) { return batch === 'all' || c.backlogBatch === batch; }
function matchesBasisValue(c, basis) {
  if (basis === 'all') return true;
  if (basis === 'unpriced') return c.estimatedValue == null;
  return c.valuationBasis === basis;
}

function matchesFilters(c) {
  return matchesSearchTerm(c, searchTerm)
    && matchesSportValue(c, activeSport)
    && matchesGraderValue(c, activeGrader)
    && matchesBatchValue(c, activeBatch)
    && matchesBasisValue(c, activeBasis);
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
    if (dimension === 'sport') return matchesSportValue(c, value);
    if (dimension === 'grader') return matchesGraderValue(c, value);
    if (dimension === 'batch') return matchesBatchValue(c, value);
    if (dimension === 'basis') return matchesBasisValue(c, value);
    return true;
  }).length;
}

const FACET_DIMENSIONS = [
  ['sportFilter', 'data-sport', 'sport'],
  ['basisFilter', 'data-basis', 'basis'],
  ['graderFilter', 'data-grader', 'grader'],
  ['batchFilter', 'data-batch', 'batch']
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
    activeBatch !== 'all' || activeBasis !== 'all';
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
    empty.textContent = cards.length ? 'No cards match the current filters.' : 'No cards logged yet.';
    return;
  }
  empty.hidden = true;
  renderTableFooter(filtered);

  tbody.innerHTML = filtered.map(c => `
    <tr tabindex="0" role="button" data-id="${escapeHtml(c.id)}">
      <td>
        <div class="cell-card-name">${escapeHtml(c.cardName || 'Untitled card')}${isExample(c) ? ' <span class="badge badge-example">example</span>' : ''}</div>
        ${c.year ? `<div class="cell-card-meta">${escapeHtml(String(c.year))}</div>` : ''}
      </td>
      <td class="cell-muted">${c.sport ? `<span class="badge badge-sport">${escapeHtml(c.sport)}</span>` : '<span class="cell-value empty">unknown</span>'}</td>
      <td class="cell-muted">${c.gradingCompany ? escapeHtml(c.gradingCompany) : '<span class="cell-value empty">unknown</span>'}</td>
      <td class="cell-muted">${c.grade != null ? escapeHtml(String(c.grade)) : '<span class="cell-value empty">unknown</span>'}</td>
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

function openModal(id) {
  activeCard = cards.find(c => c.id === id);
  if (!activeCard) return;
  lastFocusedEl = document.activeElement;

  document.getElementById('modalName').textContent = activeCard.cardName || 'Untitled card';
  const subParts = [activeCard.sport, activeCard.gradingCompany, activeCard.grade ? 'Grade ' + activeCard.grade : null].filter(Boolean);
  document.getElementById('modalSub').textContent = subParts.length ? subParts.join(' · ') : 'No sport/grader/grade logged yet';

  let body = '';
  body += field('Cert number', activeCard.certNumber, !activeCard.certNumber);
  const lookup = certLookupLink(activeCard);
  if (lookup) {
    body += `<div class="field-row"><a href="${escapeHtml(lookup.url)}" target="_blank" rel="noopener noreferrer" class="cert-link font-mono">${escapeHtml(lookup.text)} &rarr;</a></div>`;
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
  const gl = computeGainLoss(activeCard);
  if (gl) {
    body += field('Gain / loss', formatSignedUsd(gl.abs) + (gl.pct != null ? ' (' + (gl.pct >= 0 ? '+' : '') + gl.pct.toFixed(1) + '%)' : ''), false);
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

function wireChipGroup(containerId, dataAttr, setter) {
  const container = document.getElementById(containerId);
  container.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      container.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', 'false'));
      chip.setAttribute('aria-pressed', 'true');
      setter(chip.getAttribute(dataAttr));
      applyFiltersAndRender();
    });
  });
}
restoreStateFromUrl();
document.getElementById('searchInput').value = searchTerm;
setInitialChipState('sportFilter', 'data-sport', activeSport);
setInitialChipState('basisFilter', 'data-basis', activeBasis);
setInitialChipState('graderFilter', 'data-grader', activeGrader);

wireChipGroup('sportFilter', 'data-sport', (v) => { activeSport = v; });
wireChipGroup('basisFilter', 'data-basis', (v) => { activeBasis = v; });
wireChipGroup('graderFilter', 'data-grader', (v) => { activeGrader = v; });

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
  document.getElementById('searchInput').value = '';
  setInitialChipState('sportFilter', 'data-sport', activeSport);
  setInitialChipState('basisFilter', 'data-basis', activeBasis);
  setInitialChipState('graderFilter', 'data-grader', activeGrader);
  setInitialChipState('batchFilter', 'data-batch', activeBatch);
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
  const s = v == null ? '' : String(v);
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
  [c => c.costBasis, 'Cost basis'], [c => computeGainLoss(c)?.abs ?? null, 'Gain/loss'],
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

loadCards();

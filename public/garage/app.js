let listings = [];
let salesLog = [];
let expensesLog = [];
let disputesLog = [];
let suppliesLog = [];
let acquisitionsLog = [];
let searchTerm = '';
let activePlatform = 'all';
let sortKey = null;
let sortDir = 'asc';
let currentStages = [];
let rawListingsData = null;
let rawPipelineData = null;
let rawActivityData = null;
let rawSalesData = null;
let rawExpensesData = null;
let rawDisputesData = null;
let rawSuppliesData = null;
let rawAcquisitionsData = null;
let garageChangelogDriftStatus = null;

// Filters, search, and sort are mirrored into the URL query string so a
// specific view (e.g. "eBay listings sorted by price") can be bookmarked or
// shared as a link, same convention as the CSM and CGT hubs.
// Aliases GarageValidateCore.PLATFORMS (shared with validate.js) rather than
// its own copy, see PAYOUT_PLATFORMS below for why that used to be two
// separate identical arrays under different names.
const VALID_PLATFORMS = GarageValidateCore.PLATFORMS;

function restoreStateFromUrl() {
  const params = new URLSearchParams(location.search);
  const q = params.get('q');
  const platform = params.get('platform');
  const sort = params.get('sort');
  const dir = params.get('dir');
  if (q) searchTerm = q;
  if (platform && VALID_PLATFORMS.includes(platform)) activePlatform = platform;
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
  if (activePlatform !== 'all') params.set('platform', activePlatform);
  if (sortKey) {
    params.set('sort', sortKey);
    if (sortDir === 'desc') params.set('dir', 'desc');
  }
  const qs = params.toString();
  const url = location.pathname + (qs ? '?' + qs : '');
  history.replaceState(null, '', url);
}

// Shared, unit-tested fee/date math (public/garage/data/garage-core.js): the
// exact functions that have already produced real bugs on this page (a
// double-charged eBay fee, a mixed-up shoes rate twice over, a Poshmark
// dispute deadline on the wrong clock, a relist stat with nothing left to
// relist) now live in one place a test suite can actually exercise.
const {
  PLATFORM_LABELS, DEPOP_BOOST_FEE_PCT, RELIST_FRESH_DAYS, POSHMARK_HOLD_DAYS,
  estimateNetPayout, minListingPriceForNet,
  irsMileageRateForDate, mileageRateGapReason, computeExpenseAmount,
  addDaysToDateStr, addBusinessDays, disputeResponseDeadline,
  remainingPlatforms, daysSincePublished, isDueForRelist, relistGuidanceParts,
  poshmarkWeightTier, bundleNetComparison, computePoshmarkShareStreak,
  offerTier, offerCounterAmount, ebayTrsProgress, depopTopSellerProgress
} = GarageCore;

// This is the exact reference that already drifted wrong twice on this page
// (see the real-bug list in garage-core.js's header comment: a processing
// fee eBay no longer even charges, then a "shoes" rate mixed up twice over),
// both times silently, with nothing on the page saying the numbers might be
// stale. This date is the "as of September 2026" claim already made in the
// "Fee formulas used" callout above the payout table; keep the two in sync
// by hand whenever the schedule is re-verified. 45 days, not CGT's 30: this
// schedule has moved at least as fast in this file's own history, but it's
// a smaller page surface (one combined table, not six graders' full tier
// lists), so a slightly longer window before nagging is the right tradeoff.
const FEE_SCHEDULE_REVIEWED_ON = '2026-09-23';
const FEE_SCHEDULE_STALE_AFTER_DAYS = 45;

// Independent of listings/sales/etc. load state (no fetch involved, the
// review date is a hardcoded constant above), so this runs unconditionally
// at page load rather than from inside loadData()'s try/catch, same
// separation CGT's own renderGradingReferenceFreshness draws for the same
// reason: a bad listings.json shouldn't also blank a freshness note that
// has nothing to do with it.
function renderFeeScheduleFreshness() {
  const el = document.getElementById('feeScheduleFreshness');
  if (!el) return;
  const age = daysSincePublished(FEE_SCHEDULE_REVIEWED_ON);
  const stale = age != null && age > FEE_SCHEDULE_STALE_AFTER_DAYS;
  el.textContent = age == null
    ? 'Review date unknown'
    : 'Reviewed ' + age + ' day' + (age === 1 ? '' : 's') + ' ago' + (stale ? ' -- re-verify before relying on this' : '');
  el.className = 'reference-freshness' + (stale ? ' reference-freshness-stale' : '');
  el.title = 'Last hand-verified against each platform\'s own published seller fee schedule on ' + FEE_SCHEDULE_REVIEWED_ON + '.';
}

// Same freshness-badge pattern as FEE_SCHEDULE_REVIEWED_ON/TITLE_SPECS_REVIEWED_ON
// above: the "Return & dispute handling" table states real per-platform
// response windows and resolution mechanics as prose ("as of September
// 2026") with nothing on the page actually tracking whether that claim has
// aged past being trustworthy, same gap that let the fee schedule and title
// caps drift silently before this pattern existed. This table doubles as
// the direct follow-up to the real eBay return-policy bug (the auto-parts
// policy that blocked publish), so a stale response-window claim here is a
// real risk of missing a buyer's dispute deadline, not just a cosmetic
// reference going out of date. Re-verified 2026-09-24 against eBay, Vinted,
// and Poshmark's own current help-center pages; the Depop row is unchanged.
const RETURN_DISPUTE_REVIEWED_ON = '2026-09-24';
const RETURN_DISPUTE_STALE_AFTER_DAYS = 45;

function renderReturnDisputeFreshness() {
  const el = document.getElementById('returnDisputeFreshness');
  if (!el) return;
  const age = daysSincePublished(RETURN_DISPUTE_REVIEWED_ON);
  const stale = age != null && age > RETURN_DISPUTE_STALE_AFTER_DAYS;
  el.textContent = age == null
    ? 'Review date unknown'
    : 'Reviewed ' + age + ' day' + (age === 1 ? '' : 's') + ' ago' + (stale ? ' -- re-verify before relying on this' : '');
  el.className = 'reference-freshness' + (stale ? ' reference-freshness-stale' : '');
  el.title = 'Last hand-verified against each platform\'s own published return/dispute documentation on ' + RETURN_DISPUTE_REVIEWED_ON + '.';
}

// Same freshness-badge pattern as RETURN_DISPUTE_REVIEWED_ON above: the scam
// patterns this table warns about (eBay INAD return fraud and the $750
// signature-confirmation threshold, off-platform payment requests on
// Vinted/Poshmark, Depop Resolution Center miscategorization) are real,
// checkable claims sitting right next to the dispute-mechanics table this
// pattern was built for, with the same silent-drift risk if left untracked.
// Re-verified 2026-09-24 against eBay's own seller-protection policy page
// (the $750 threshold) and Vinted's own Buyer Protection help page (payment
// must go through Vinted's checkout); Poshmark and Depop rows unchanged.
const SCAM_PATTERNS_REVIEWED_ON = '2026-09-24';
const SCAM_PATTERNS_STALE_AFTER_DAYS = 45;

function renderScamPatternsFreshness() {
  const el = document.getElementById('scamPatternsFreshness');
  if (!el) return;
  const age = daysSincePublished(SCAM_PATTERNS_REVIEWED_ON);
  const stale = age != null && age > SCAM_PATTERNS_STALE_AFTER_DAYS;
  el.textContent = age == null
    ? 'Review date unknown'
    : 'Reviewed ' + age + ' day' + (age === 1 ? '' : 's') + ' ago' + (stale ? ' -- re-verify before relying on this' : '');
  el.className = 'reference-freshness' + (stale ? ' reference-freshness-stale' : '');
  el.title = 'Last hand-verified against each platform\'s own published fraud/protection documentation on ' + SCAM_PATTERNS_REVIEWED_ON + '.';
}

// Same freshness-badge pattern as the tables above: this one gates the
// highest-stakes numbers on the page (the exact eBay Top Rated Seller and
// Depop Top Seller thresholds "Real progress" is computed against below),
// and the callout above it says this matters "now, before the 48-draft
// Depop backlog goes live", so a stale threshold here is a real risk of
// Jack tracking progress against the wrong bar. Re-verified 2026-09-24
// against eBay's own seller-standards policy page (the 90-day/100-
// transaction/$1,000/0.5%/0.3%/3%/95% figures) and Depop's own Top Seller
// program page and third-party coverage of it (the $1,000/month, 4.5-star,
// 90%-in-5-days, and under-5%-refund figures); secondary sources disagree
// on whether Depop also requires a minimum live-listing count and whether
// that's sustained for 3 or 4 months, so that's deliberately left off this
// table rather than guessed at. Vinted and Poshmark rows are reference-only
// prose with no hard numbers pinned down, so re-verifying those isn't the
// same kind of drift risk as the two computed-progress rows are.
const SELLER_STANDARDS_REVIEWED_ON = '2026-09-24';
const SELLER_STANDARDS_STALE_AFTER_DAYS = 45;

function renderSellerStandardsFreshness() {
  const el = document.getElementById('sellerStandardsFreshness');
  if (!el) return;
  const age = daysSincePublished(SELLER_STANDARDS_REVIEWED_ON);
  const stale = age != null && age > SELLER_STANDARDS_STALE_AFTER_DAYS;
  el.textContent = age == null
    ? 'Review date unknown'
    : 'Reviewed ' + age + ' day' + (age === 1 ? '' : 's') + ' ago' + (stale ? ' -- re-verify before relying on this' : '');
  el.className = 'reference-freshness' + (stale ? ' reference-freshness-stale' : '');
  el.title = 'Last hand-verified against each platform\'s own published seller-status documentation on ' + SELLER_STANDARDS_REVIEWED_ON + '.';
}

// Same freshness-badge pattern as the tables above, applied to the one
// number on this page that isn't platform policy at all: the federal
// 1099-K threshold is set by Congress, not eBay/Vinted/Poshmark/Depop, and
// it has already flip-flopped once in real life (ARPA dropped it to $600
// for 2022, IRS delayed that twice, OBBBA restored $20,000/200 transactions
// in July 2025). A callout with no tracked verification date is exactly
// the silent-drift risk this pattern exists to catch, and getting a real
// tax-reporting threshold wrong is a worse failure mode than a stale fee
// schedule. Re-verified 2026-09-24 against current IRS/OBBBA reporting
// (1800Accountant, TaxAct, Avalara, 1099online): still $20,000 AND 200
// transactions per platform for the 2026 tax year, both conditions required.
const TAX_TRACKER_REVIEWED_ON = '2026-09-24';
const TAX_TRACKER_STALE_AFTER_DAYS = 45;

function renderTaxTrackerFreshness() {
  const el = document.getElementById('taxTrackerFreshness');
  if (!el) return;
  const age = daysSincePublished(TAX_TRACKER_REVIEWED_ON);
  const stale = age != null && age > TAX_TRACKER_STALE_AFTER_DAYS;
  el.textContent = age == null
    ? 'Review date unknown'
    : 'Reviewed ' + age + ' day' + (age === 1 ? '' : 's') + ' ago' + (stale ? ' -- re-verify before relying on this' : '');
  el.className = 'reference-freshness' + (stale ? ' reference-freshness-stale' : '');
  el.title = 'Last hand-verified against current IRS Form 1099-K reporting-threshold guidance on ' + TAX_TRACKER_REVIEWED_ON + '.';
}

// Same freshness-badge pattern as the tables above. Found a real error while
// re-verifying this one 2026-09-24: the eBay row had the USPS lithium
// battery mark transition backwards, it said the mark "without a phone
// number" was the older one retiring 2026-12-31, when USPS Publication 52
// (Feb 2026 edition) and the underlying PHMSA/Federal Register rule say the
// opposite, the older mark is the one WITH the phone number, and the mark
// dropping the phone number is the newer one required from 2027-01-01.
// Fixed the row text to match; this badge exists so that class of reversed
// claim gets caught faster next time instead of sitting live on a real
// battery-item listing's shipping requirements.
const ELECTRONICS_RULES_REVIEWED_ON = '2026-09-24';
const ELECTRONICS_RULES_STALE_AFTER_DAYS = 45;

function renderElectronicsRulesFreshness() {
  const el = document.getElementById('electronicsRulesFreshness');
  if (!el) return;
  const age = daysSincePublished(ELECTRONICS_RULES_REVIEWED_ON);
  const stale = age != null && age > ELECTRONICS_RULES_STALE_AFTER_DAYS;
  el.textContent = age == null
    ? 'Review date unknown'
    : 'Reviewed ' + age + ' day' + (age === 1 ? '' : 's') + ' ago' + (stale ? ' -- re-verify before relying on this' : '');
  el.className = 'reference-freshness' + (stale ? ' reference-freshness-stale' : '');
  el.title = 'Last hand-verified against each platform\'s own electronics/dangerous-goods policy and USPS Publication 52 on ' + ELECTRONICS_RULES_REVIEWED_ON + '.';
}

// Same freshness-badge pattern as the tables above. This table's own
// callout already frames the Poshmark row as "the same class of
// silent-failure risk as the eBay return-policy bug", so it gets the same
// tracking. Re-verified 2026-09-24: Poshmark's Ground Advantage-only,
// no-Priority-Mail-packaging rule (with the Post Office refusing or
// charging a $5 fee for Priority boxes) took effect 2025-09-12 and is
// still the live policy, no change to confirm here beyond that.
const PACKAGING_RULES_REVIEWED_ON = '2026-09-24';
const PACKAGING_RULES_STALE_AFTER_DAYS = 45;

function renderPackagingRulesFreshness() {
  const el = document.getElementById('packagingRulesFreshness');
  if (!el) return;
  const age = daysSincePublished(PACKAGING_RULES_REVIEWED_ON);
  const stale = age != null && age > PACKAGING_RULES_STALE_AFTER_DAYS;
  el.textContent = age == null
    ? 'Review date unknown'
    : 'Reviewed ' + age + ' day' + (age === 1 ? '' : 's') + ' ago' + (stale ? ' -- re-verify before relying on this' : '');
  el.className = 'reference-freshness' + (stale ? ' reference-freshness-stale' : '');
  el.title = 'Last hand-verified against each platform\'s own shipping/seller documentation on ' + PACKAGING_RULES_REVIEWED_ON + '.';
}

// Same freshness-badge pattern as the tables above. Found a real error while
// re-verifying this one 2026-09-24: the eBay row lumped sneakers, handbags,
// jewelry, and watches under one flat "$500+" threshold. That's wrong for
// two of the four. Watches only auto-qualify at $2,000+ (Wristwatches and
// Pocket Watches categories; $500-$1,999.99 is an optional add-on, not
// automatic) per eBay's own Authenticity Guarantee help page, and sneakers
// now start as low as $75+ and are brand/model-dependent, not a flat $500
// at all, a seller can only tell whether a given pair qualifies by what the
// listing form itself shows (eBay's own sneaker Authenticity Guarantee
// pages, corroborated by third-party seller-tooling coverage). Handbags and
// eligible-brand jewelry are the two categories actually at $500+ automatic
// (with a $200-$499.99 optional add-on tier below that), so the row now
// says so instead of overstating a $500 floor on watches and understating
// how low sneakers can actually go. This table's callout already warns a
// threshold "can trigger automatically... with no opt-in and no way to back
// out", so a wrong number here is a real risk of Jack being surprised by an
// authentication hold he didn't expect, or not budgeting for one he should
// have. Poshmark, Vinted, and Depop rows re-checked against their own
// current help pages too; no change needed on those three.
const AUTHENTICATION_RULES_REVIEWED_ON = '2026-09-24';
const AUTHENTICATION_RULES_STALE_AFTER_DAYS = 45;

function renderAuthenticationRulesFreshness() {
  const el = document.getElementById('authenticationRulesFreshness');
  if (!el) return;
  const age = daysSincePublished(AUTHENTICATION_RULES_REVIEWED_ON);
  const stale = age != null && age > AUTHENTICATION_RULES_STALE_AFTER_DAYS;
  el.textContent = age == null
    ? 'Review date unknown'
    : 'Reviewed ' + age + ' day' + (age === 1 ? '' : 's') + ' ago' + (stale ? ' -- re-verify before relying on this' : '');
  el.className = 'reference-freshness' + (stale ? ' reference-freshness-stale' : '');
  el.title = 'Last hand-verified against each platform\'s own authentication/verification program documentation on ' + AUTHENTICATION_RULES_REVIEWED_ON + '.';
}

// Same freshness-badge pattern as the tables above, applied to the last
// reference table on the page that still had prose claiming an "as of"
// date (September 2026) with nothing tracking whether that claim aged out.
// The retail box prices and the July 12, 2026 effective date were
// re-verified 2026-09-25 against current USPS/shipping-industry rate
// trackers: $13.65/$24.80/$34.00 for Small/Medium/Large Flat Rate boxes
// still hold, no rate change since. No content changed, only the missing
// freshness badge added.
const SHIPPING_COST_REVIEWED_ON = '2026-09-25';
const SHIPPING_COST_STALE_AFTER_DAYS = 45;

function renderShippingCostFreshness() {
  const el = document.getElementById('shippingCostFreshness');
  if (!el) return;
  const age = daysSincePublished(SHIPPING_COST_REVIEWED_ON);
  const stale = age != null && age > SHIPPING_COST_STALE_AFTER_DAYS;
  el.textContent = age == null
    ? 'Review date unknown'
    : 'Reviewed ' + age + ' day' + (age === 1 ? '' : 's') + ' ago' + (stale ? ' -- re-verify before relying on this' : '');
  el.className = 'reference-freshness' + (stale ? ' reference-freshness-stale' : '');
  el.title = 'Last hand-verified against USPS\'s own published retail rate schedule on ' + SHIPPING_COST_REVIEWED_ON + '.';
}

// Same freshness-badge pattern as the tables above. The "Best time to post"
// table drives real posting-schedule decisions on the 48-draft Depop
// backlog, so a stale claim here is a real risk of Jack posting into a dead
// window instead of the platform's own peak one, not just a cosmetic
// reference going stale. Re-verified 2026-09-25 against current
// reseller-tooling coverage (CLOSO, Vendy Studio, TopDown Trading,
// PoshSidekick) for all four platforms: the eBay Sunday-evening peak, the
// Vinted weekday-evening/Wednesday-6:30pm/Sunday-afternoon windows, the
// Poshmark lunch/evening/Sunday windows plus the 3x/day sharing cadence,
// and the Depop weekday-lunch/evening/weekend-morning windows all still
// match current guidance, no change needed.
const BEST_TIME_REVIEWED_ON = '2026-09-25';
const BEST_TIME_STALE_AFTER_DAYS = 45;

function renderBestTimeFreshness() {
  const el = document.getElementById('bestTimeFreshness');
  if (!el) return;
  const age = daysSincePublished(BEST_TIME_REVIEWED_ON);
  const stale = age != null && age > BEST_TIME_STALE_AFTER_DAYS;
  el.textContent = age == null
    ? 'Review date unknown'
    : 'Reviewed ' + age + ' day' + (age === 1 ? '' : 's') + ' ago' + (stale ? ' -- re-verify before relying on this' : '');
  el.className = 'reference-freshness' + (stale ? ' reference-freshness-stale' : '');
  el.title = 'Last hand-verified against current reseller-community posting-time research on ' + BEST_TIME_REVIEWED_ON + '.';
}

const STAGE_LABELS = { draft: 'Draft', 'ready-to-post': 'Ready to post', live: 'Live', sold: 'Sold' };
const EVENT_TYPE_LABELS = { 'bug-fix': 'Bug fix', 'photo-audit': 'Photo audit', other: 'Other' };
// Was its own separately-defined ['ebay', 'vinted', 'poshmark', 'depop'],
// identical to VALID_PLATFORMS above under a different name; now the same
// shared array both aliases point at.
const PAYOUT_PLATFORMS = GarageValidateCore.PLATFORMS;
const EXPENSE_CATEGORY_LABELS = {
  mileage: 'Mileage', supplies: 'Supplies', 'platform-fees': 'Platform fees',
  subscriptions: 'Subscriptions', other: 'Other'
};
const DISPUTE_TYPE_LABELS = {
  return: 'Return', 'not-as-described': 'Not as described', damaged: 'Damaged',
  'never-arrived': 'Never arrived', other: 'Other'
};
const DISPUTE_STATUS_LABELS = {
  open: 'Open', 'resolved-seller': "Resolved, seller's favor",
  'resolved-buyer': "Resolved, buyer's favor", 'resolved-split': 'Resolved, split'
};
const SUPPLY_CATEGORY_LABELS = {
  box: 'Box', mailer: 'Poly mailer', envelope: 'Envelope', tape: 'Tape', label: 'Label', other: 'Other'
};
const ACQUISITION_SOURCE_LABELS = {
  'thrift-store': 'Thrift store', 'estate-sale': 'Estate sale', 'garage-sale': 'Garage sale',
  'wholesale-lot': 'Wholesale lot', 'online-marketplace': 'Online marketplace',
  'personal-item': 'Personal item', other: 'Other'
};

// Only fires once both real numbers are on file, same "leave it honestly
// unknown rather than guess" rule as every other computed field on this
// page: a count with no reorder point set yet can't be judged low or not.
function isSupplyLowStock(s) {
  return s.qtyOnHand != null && s.reorderThreshold != null && s.qtyOnHand <= s.reorderThreshold;
}

// Looks up the eBay category of the listing a sale references, so a sold
// item's realized-profit math uses the same fee rate its live listing was
// tagged with. Undefined (not "shoes") if the listing can't be found, e.g.
// it fully sold through everywhere and was removed from listings.json.
function categoryForListingId(listingId) {
  const l = listings.find(item => item.id === listingId);
  return l ? l.category : undefined;
}

function disputeResponseInfo(d) {
  const deadline = disputeResponseDeadline(d);
  if (deadline) {
    const overdue = deadline < todayDateStr();
    return { text: (overdue ? 'overdue since ' : 'by ') + deadline, badgeClass: overdue ? 'badge-decline' : 'badge-due' };
  }
  if (d.status !== 'open') return null;
  if (d.platform === 'vinted') return { text: 'no fixed clock, payment withheld until you respond', badgeClass: 'badge-hold' };
  if (d.platform === 'depop') return { text: 'no fixed clock, escalation carries a seller fee', badgeClass: 'badge-hold' };
  return null;
}

// Shared, unit-tested XSS guard (html-core.js): escapeHtml now has a real
// regression test instead of only ever running live in a browser, same
// shared-core pattern already used for csvField (see GarageExportCore).
const escapeHtml = GarageHtmlCore.escapeHtml;

// A net payout can go negative on a cheap Poshmark listing (its flat $2.95
// fee under $15 exceeds the price), and '$' + (-1.95) renders as the
// confusing "$-1.95" instead of "-$1.95", so the sign goes before the symbol.
function formatUsd(n) {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  // toLocaleString drops trailing zero cents on its own (42.80 -> "42.8"),
  // which reads as a formatting bug next to "71.94" in the same table, so
  // force 2 decimals whenever the amount isn't a whole dollar.
  const hasCents = Math.round(abs * 100) % 100 !== 0;
  return sign + '$' + abs.toLocaleString('en-US', { minimumFractionDigits: hasCents ? 2 : 0, maximumFractionDigits: 2 });
}

// Also captures the real server "Last-Modified" header, which express.static
// sets from each JSON file's own on-disk mtime, so the page can honestly show
// when the hand-edited data was actually last touched without needing a
// separate timestamp field maintained by hand in every file (which could
// itself go stale or get forgotten on an edit).
function fetchJson(url) {
  return fetch(url).then(r => {
    if (!r.ok) throw new Error(url.split('/').pop() + ' returned ' + r.status);
    const lastModifiedHeader = r.headers.get('last-modified');
    const lastModified = lastModifiedHeader ? new Date(lastModifiedHeader) : null;
    return r.json().then(data => ({ data, lastModified }));
  });
}

// Latest mtime across whichever data files actually loaded, so a typo'd or
// missing file can't hide a stale sibling file's real edit date.
function renderDataFreshness(lastModifiedDates) {
  const el = document.getElementById('dataFreshness');
  const known = lastModifiedDates.filter(d => d && !Number.isNaN(d.getTime()));
  if (!known.length) {
    el.textContent = '';
    return;
  }
  const latest = new Date(Math.max(...known.map(d => d.getTime())));
  const daysAgo = Math.floor((Date.now() - latest.getTime()) / 86400000);
  const when = daysAgo <= 0 ? 'today' : daysAgo === 1 ? '1 day ago' : daysAgo + ' days ago';
  const latestDateStr = latest.getFullYear() + '-' + String(latest.getMonth() + 1).padStart(2, '0') + '-' + String(latest.getDate()).padStart(2, '0');
  el.textContent = ` Last hand-edited ${when} (${latestDateStr}).`;
  el.classList.toggle('data-freshness-stale', daysAgo > 14);
}

// changelog.json is generated (see public/garage/data/changelog.js), not
// hand-edited, from this repo's real git history over the eight data files
// TRACKED_FILES there lists. A fresh clone before anyone has run that script
// is a real, expected state (an honest empty state), not a load failure, so
// it never blocks or fails the rest of loadData. Same pattern as CSM's,
// Sondrik's, and CGT's own loadChangelog.
// driftStatus comes from /api/garage/changelog-status, the same live drift
// check already exposed for Sondrik, Alpha, CSM, and CGT: it compares
// changelog.json's recorded commit hashes against this repo's real git log
// for those eight files, so a real drift shows up here on the live page
// instead of only when someone happens to run node public/garage/data/
// changelog.js from the command line. Best-effort and independent of the
// changelog fetch itself, so a failure here (no git checkout, shallow clone,
// etc) never blocks rendering the changelog entries.
async function loadChangelog() {
  const [changelogResult, driftResult] = await Promise.allSettled([
    fetch('/garage/data/changelog.json').then(r => {
      if (!r.ok) throw new Error('Server returned ' + r.status);
      return r.json();
    }),
    fetch('/api/garage/changelog-status').then(r => r.ok ? r.json() : null)
  ]);
  const driftStatus = driftResult.status === 'fulfilled' ? driftResult.value : null;
  if (changelogResult.status === 'fulfilled') {
    renderChangelog(changelogResult.value, driftStatus);
  } else {
    renderChangelog({ entries: [] }, driftStatus);
    console.error("Couldn't load changelog.json: " + changelogResult.reason.message);
  }
  garageChangelogDriftStatus = driftStatus;
  renderAttentionBar();
}

function renderChangelog(data, driftStatus) {
  const el = document.getElementById('changelogFeed');
  const driftWarning = (driftStatus && driftStatus.drifted)
    ? '<div class="callout callout-warn"><strong>Changelog is out of sync.</strong> changelog.json records ' +
      driftStatus.recordedCount + ' commit' + (driftStatus.recordedCount === 1 ? '' : 's') +
      ' for its tracked data files, but this repo&rsquo;s real git history has ' + driftStatus.realCount +
      '. Run <code>node public/garage/data/changelog.js</code> to regenerate it.</div>'
    : '';
  const entries = (data && data.entries) || [];
  if (entries.length === 0) {
    el.innerHTML = driftWarning + '<p class="changelog-empty">No changelog generated yet. Run ' +
      '<code>node public/garage/data/changelog.js</code> to build one from this repo&rsquo;s git history.</p>';
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
  el.innerHTML = driftWarning + rowsHtml;
  let noteEl = el.nextElementSibling;
  if (!noteEl || !noteEl.classList.contains('changelog-generated-note')) {
    noteEl = document.createElement('p');
    noteEl.className = 'changelog-generated-note';
    el.after(noteEl);
  }
  noteEl.textContent = 'Generated ' + (data.generatedAt || 'at an unknown time').slice(0, 10) +
    ' from ' + (data.generatedFrom || 'git log') + '.';
}

// Each of the three files is a hand-edited record that can be typo'd at any
// time (see the sibling validate.js scripts). A single Promise.all would fail
// every section over one bad file, e.g. a typo in activity.json alone would
// also blank the listings table and payout section that have nothing to do
// with it. Promise.allSettled lets each section degrade independently instead,
// the same fix Sondrik's loadData already applies for the same reason.
async function loadData() {
  const errBox = document.getElementById('tableEmpty');
  loadChangelog();
  const [listingsResult, pipelineResult, activityResult, salesResult, expensesResult, disputesResult, suppliesResult, acquisitionsResult] = await Promise.allSettled([
    fetchJson('/garage/data/listings.json'),
    fetchJson('/garage/data/pipeline.json'),
    fetchJson('/garage/data/activity.json'),
    fetchJson('/garage/data/sales.json'),
    fetchJson('/garage/data/expenses.json'),
    fetchJson('/garage/data/disputes.json'),
    fetchJson('/garage/data/supplies.json'),
    fetchJson('/garage/data/acquisitions.json')
  ]);
  const listingsData = listingsResult.status === 'fulfilled' ? listingsResult.value.data : null;
  const pipelineData = pipelineResult.status === 'fulfilled' ? pipelineResult.value.data : null;
  const activityData = activityResult.status === 'fulfilled' ? activityResult.value.data : null;
  const salesData = salesResult.status === 'fulfilled' ? salesResult.value.data : null;
  const expensesData = expensesResult.status === 'fulfilled' ? expensesResult.value.data : null;
  const disputesData = disputesResult.status === 'fulfilled' ? disputesResult.value.data : null;
  const suppliesData = suppliesResult.status === 'fulfilled' ? suppliesResult.value.data : null;
  const acquisitionsData = acquisitionsResult.status === 'fulfilled' ? acquisitionsResult.value.data : null;
  rawListingsData = listingsData;
  rawPipelineData = pipelineData;
  rawActivityData = activityData;
  rawSalesData = salesData;
  rawExpensesData = expensesData;
  rawDisputesData = disputesData;
  rawSuppliesData = suppliesData;
  rawAcquisitionsData = acquisitionsData;
  const backupBtn = document.getElementById('backupBtn');
  backupBtn.disabled = !(listingsData || pipelineData || activityData || salesData || expensesData || disputesData || suppliesData || acquisitionsData);
  backupBtn.title = backupBtn.disabled ? "Can't back up, all data files failed to load (see below)" : '';
  const stages = (pipelineData && pipelineData.stages) || [];
  const sales = (salesData && salesData.sales) || [];
  const expenses = (expensesData && expensesData.expenses) || [];
  const disputes = (disputesData && disputesData.disputes) || [];
  const supplies = (suppliesData && suppliesData.supplies) || [];
  const acquisitions = (acquisitionsData && acquisitionsData.acquisitions) || [];

  renderDataFreshness([listingsResult, pipelineResult, activityResult, salesResult, expensesResult, disputesResult, suppliesResult, acquisitionsResult]
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value.lastModified));

  if (listingsData) {
    listings = listingsData.listings || [];
    renderStats(listings, stages, sales, expenses, supplies, acquisitions);
    renderDelistList(listings);
    renderDataQuality(listings, acquisitions);
    renderDuplicates(listings);
    applyFiltersAndRender();
    renderCoverage(listings);
    renderTitleFit(listings);
    renderRelist(listings);
    renderPayoutTable(listings);
    renderOfferItemChips(listings);
    renderTemplateItemChips(listings);
    renderPromotedItemChips(listings);
    renderKanban(listings, pipelineData);
    renderPoshmarkShareTracker(listings);
  } else {
    listings = [];
    document.getElementById('statRow').innerHTML = '';
    document.getElementById('delistSection').hidden = true;
    document.getElementById('dataQualitySection').hidden = true;
    document.getElementById('duplicatesSection').hidden = true;
    document.getElementById('listingTableBody').innerHTML = '';
    document.getElementById('coverageTableBody').innerHTML = '';
    document.getElementById('titleFitTableBody').innerHTML = '';
    document.getElementById('relistTableBody').innerHTML = '';
    document.getElementById('payoutTableBody').innerHTML = '';
    renderOfferItemChips([]);
    renderTemplateItemChips([]);
    renderPromotedItemChips([]);
    document.getElementById('kanbanBoard').innerHTML = '';
    document.getElementById('poshmarkShareSection').hidden = true;
    errBox.hidden = false;
    errBox.setAttribute('role', 'alert');
    errBox.textContent = "Couldn't load Garage data: " + listingsResult.reason.message;
  }

  if (pipelineData) {
    currentStages = stages;
    renderPipeline(stages);
    renderPacePlanner(stages);
  } else {
    currentStages = [];
    document.getElementById('pipelineRow').innerHTML =
      '<div class="table-empty" role="alert">Failed to load pipeline data: ' + escapeHtml(pipelineResult.reason.message) + '</div>';
    document.getElementById('paceResult').innerHTML =
      '<p class="pace-result-note" role="alert">Failed to load pipeline data: ' + escapeHtml(pipelineResult.reason.message) + '</p>';
  }

  if (activityData) {
    renderActivity(activityData.events || []);
  } else {
    document.getElementById('activityList').innerHTML =
      '<div class="activity-item" role="alert"><div class="activity-item-detail">Failed to load activity data: ' +
      escapeHtml(activityResult.reason.message) + '</div></div>';
  }

  if (salesData) {
    salesLog = sales;
    renderSales(sales);
    renderTaxTracker(sales);
  } else {
    salesLog = [];
    document.getElementById('salesTableBody').innerHTML = '';
    const empty = document.getElementById('salesTableEmpty');
    empty.hidden = false;
    empty.setAttribute('role', 'alert');
    empty.textContent = "Couldn't load sales data: " + salesResult.reason.message;
    document.getElementById('salesTotals').innerHTML = '';
    document.getElementById('taxTrackerBody').innerHTML =
      '<tr><td colspan="6" class="table-empty" role="alert">Failed to load sales data: ' + escapeHtml(salesResult.reason.message) + '</td></tr>';
  }

  if (expensesData) {
    expensesLog = expenses;
    renderExpenses(expenses);
  } else {
    expensesLog = [];
    document.getElementById('expensesTableBody').innerHTML = '';
    const expensesEmpty = document.getElementById('expensesTableEmpty');
    expensesEmpty.hidden = false;
    expensesEmpty.setAttribute('role', 'alert');
    expensesEmpty.textContent = "Couldn't load expenses data: " + expensesResult.reason.message;
    document.getElementById('expensesTotals').innerHTML = '';
  }

  if (disputesData) {
    disputesLog = disputes;
    renderDisputes(disputes);
  } else {
    disputesLog = [];
    document.getElementById('disputesTableBody').innerHTML = '';
    const disputesEmpty = document.getElementById('disputesTableEmpty');
    disputesEmpty.hidden = false;
    disputesEmpty.setAttribute('role', 'alert');
    disputesEmpty.textContent = "Couldn't load disputes data: " + disputesResult.reason.message;
    document.getElementById('disputesTotals').innerHTML = '';
  }

  if (suppliesData) {
    suppliesLog = supplies;
    renderSupplies(supplies);
  } else {
    suppliesLog = [];
    document.getElementById('suppliesTableBody').innerHTML = '';
    const suppliesEmpty = document.getElementById('suppliesTableEmpty');
    suppliesEmpty.hidden = false;
    suppliesEmpty.setAttribute('role', 'alert');
    suppliesEmpty.textContent = "Couldn't load supplies data: " + suppliesResult.reason.message;
  }

  if (acquisitionsData) {
    acquisitionsLog = acquisitions;
    renderAcquisitions(acquisitions, listings, salesLog);
  } else {
    acquisitionsLog = [];
    document.getElementById('acquisitionsTableBody').innerHTML = '';
    const acquisitionsEmpty = document.getElementById('acquisitionsTableEmpty');
    acquisitionsEmpty.hidden = false;
    acquisitionsEmpty.setAttribute('role', 'alert');
    acquisitionsEmpty.textContent = "Couldn't load acquisitions data: " + acquisitionsResult.reason.message;
    document.getElementById('acquisitionsTotals').innerHTML = '';
  }

  renderSellerStandardsProgress(sales, disputes);
  initTableScrollShadows();
  renderAttentionBar();
}

// Purely a "you are here" pointer into the static seasonal reference table,
// not computed from any logged listing/sale data.
function renderSeasonalCalendarHighlight() {
  const rows = document.querySelectorAll('#seasonalGuideTable tbody tr');
  const currentMonth = new Date().getMonth();
  rows.forEach(row => {
    row.classList.toggle('is-current-month', Number(row.dataset.month) === currentMonth);
  });
}

// Best-case total: for each live item, the highest net payout among the
// platforms it's still actually listed on (excluding ones already sold via
// soldOn, same as every other stat here), falling back to price if fees
// can't be estimated, summed across all items. Not a prediction of what will
// sell where, just what picking the best-fee platform for each item nets.
function bestCaseTotalPayout(live) {
  return live.reduce((sum, l) => {
    const nets = remainingPlatforms(l)
      .map(p => estimateNetPayout(p, l.price, l.category))
      .filter(n => n != null);
    if (nets.length) return sum + Math.max(...nets);
    return sum + (l.price || 0);
  }, 0);
}

function renderStats(listings, stages, sales, expenses, supplies, acquisitions) {
  sales = sales || [];
  expenses = expenses || [];
  supplies = supplies || [];
  acquisitions = acquisitions || [];
  const live = listings.filter(l => l.status === 'live');
  const totalValue = live.reduce((s, l) => s + (l.price || 0), 0);
  const platformCounts = {};
  live.forEach(l => remainingPlatforms(l).forEach(p => { platformCounts[p] = (platformCounts[p] || 0) + 1; }));
  const activePlatforms = Object.keys(platformCounts).length;
  const listingInstances = live.reduce((s, l) => s + remainingPlatforms(l).length, 0);
  const readyStage = stages.find(s => s.stage === 'ready-to-post');
  const atRiskCount = live.filter(l => (l.soldOn || []).length > 0 && remainingPlatforms(l).length > 0).length;
  const bestCaseTotal = bestCaseTotalPayout(live);
  const coverageGapCount = live.filter(l => missingPlatforms(l).length > 0).length;
  const knownAgeCount = live.filter(l => l.datePublished).length;
  const dueForRelistCount = live.filter(l => isDueForRelist(l, daysSincePublished(l.datePublished))).length;
  const realizedRevenue = sales.reduce((s, sale) => s + (sale.salePrice || 0), 0);
  const salesWithCost = sales.filter(sale => sale.costBasis != null || sale.shippingCost != null);
  const realizedProfit = salesWithCost.reduce((s, sale) => {
    const net = estimateNetPayout(sale.platform, sale.salePrice, categoryForListingId(sale.listingId));
    return s + ((net != null ? net : (sale.salePrice || 0)) - (sale.costBasis || 0) - (sale.shippingCost || 0));
  }, 0);
  const computedExpenses = expenses.map(e => computeExpenseAmount(e)).filter(a => a != null);
  const totalExpenses = computedExpenses.reduce((s, a) => s + a, 0);
  const uncomputedExpenseCount = expenses.length - computedExpenses.length;
  // Bottom-line figure for Schedule C: only shown once at least one sale has a
  // real profit computed (cost basis or shipping logged), since without that
  // "net income" would just be revenue, not profit. Expenses default to the
  // real $0 logged so far if none exist yet, never estimated.
  const netIncomeTracked = salesWithCost.length > 0;
  const netIncome = realizedProfit - totalExpenses;
  const suppliesCounted = supplies.filter(s => s.qtyOnHand != null && s.reorderThreshold != null);
  const lowStockCount = suppliesCounted.filter(isSupplyLowStock).length;
  const totalSourcingSpend = acquisitions.reduce((s, a) => s + (a.pricePaid || 0), 0);

  const tiles = [
    { value: listingInstances, label: 'Live listing instances', sub: live.length + ' unique item(s)' },
    { value: live.length, label: 'Unique items live', sub: null },
    { value: activePlatforms, label: 'Platforms active', sub: Object.keys(platformCounts).map(p => PLATFORM_LABELS[p] || p).join(', ') || null },
    { value: formatUsd(totalValue), label: 'Total live asking value', sub: null },
    { value: formatUsd(bestCaseTotal), label: 'Best-case net payout', sub: 'If each item sells on its best-fee platform' },
    { value: readyStage ? readyStage.count : 0, label: 'Drafts ready to post', sub: readyStage && readyStage.note ? readyStage.note : null },
    { value: atRiskCount, label: 'Needs delisting elsewhere', sub: atRiskCount ? 'Sold on one platform, still live on others' : null, warn: atRiskCount > 0 },
    { value: coverageGapCount, label: 'Items with cross-post gaps', sub: coverageGapCount ? 'Not yet on all 4 platforms' : 'Fully cross-listed' },
    { value: dueForRelistCount, label: 'Due for a relist', sub: knownAgeCount ? 'Live 30+ days on at least one platform' : 'No publish dates logged yet', warn: dueForRelistCount > 0 },
    { value: sales.length, label: 'Real sales logged', sub: sales.length ? null : 'None yet' },
    { value: formatUsd(realizedRevenue), label: 'Realized revenue', sub: sales.length ? 'Sum of actual sale prices' : 'No sales logged yet' },
    { value: salesWithCost.length ? formatUsd(realizedProfit) : 'not tracked yet', label: 'Realized profit', sub: salesWithCost.length ? `Net payout minus cost basis and shipping, ${salesWithCost.length}/${sales.length} sale(s) have at least one logged` : 'No sale has a cost basis or shipping cost logged yet' },
    { value: expenses.length, label: 'Business expenses logged', sub: expenses.length ? null : 'None yet' },
    { value: formatUsd(totalExpenses), label: 'Real business expenses', sub: uncomputedExpenseCount ? `${uncomputedExpenseCount} of ${expenses.length} not counted yet, missing amount or a usable mileage rate` : (expenses.length ? 'For Schedule C, not tax advice' : 'No expenses logged yet') },
    { value: netIncomeTracked ? formatUsd(netIncome) : 'not tracked yet', label: 'Net business income', sub: netIncomeTracked ? (expenses.length ? 'Realized profit minus real logged expenses' : 'Realized profit minus $0, no expenses logged yet') : 'Needs at least one sale with cost basis or shipping logged', warn: netIncomeTracked && netIncome < 0 },
    { value: lowStockCount, label: 'Supplies low on stock', sub: supplies.length ? `${suppliesCounted.length}/${supplies.length} have both a count and a reorder point logged` : 'No supplies logged yet', warn: lowStockCount > 0 },
    { value: acquisitions.length, label: 'Sourcing trips logged', sub: acquisitions.length ? formatUsd(totalSourcingSpend) + ' real total spent' : 'None yet' }
  ];

  document.getElementById('statRow').innerHTML = tiles.map(t => `
    <div class="stat-tile${t.warn ? ' stat-tile-warn' : ''}">
      <div class="stat-tile-value font-display">${escapeHtml(String(t.value))}</div>
      <div class="stat-tile-label">${escapeHtml(t.label)}</div>
      ${t.sub ? `<div class="stat-tile-sub">${escapeHtml(t.sub)}</div>` : ''}
    </div>
  `).join('');
}

function renderPipeline(stages) {
  const order = ['draft', 'ready-to-post', 'live', 'sold'];
  const sorted = [...stages].sort((a, b) => order.indexOf(a.stage) - order.indexOf(b.stage));

  document.getElementById('pipelineRow').innerHTML = sorted.map(s => `
    <div class="pipeline-stage">
      <div class="pipeline-stage-name font-mono">${escapeHtml(STAGE_LABELS[s.stage] || s.stage)}</div>
      <div class="pipeline-stage-count font-display${s.count === 0 ? ' zero' : ''}">${s.count}</div>
      <div class="pipeline-stage-note${s.note ? '' : ' empty'}">${s.note ? escapeHtml(s.note) : 'Nothing logged'}</div>
    </div>
  `).join('');
}

const PACE_STORAGE_KEY = 'garage-pace-per-day';

function loadPaceRate() {
  try {
    const raw = localStorage.getItem(PACE_STORAGE_KEY);
    const n = raw == null ? null : Number(raw);
    return n && n > 0 ? n : null;
  } catch {
    return null;
  }
}
function savePaceRate(rate) {
  try {
    localStorage.setItem(PACE_STORAGE_KEY, String(rate));
  } catch {
    // Storage unavailable, the rate just won't persist across visits.
  }
}

// Turns the real "ready-to-post" count from pipeline.json into a projected
// clear date at a seller-entered daily rate. Plain calendar days, not
// business days, since posting isn't tied to a work week here. Never
// invents the backlog count itself, only does arithmetic on the real
// pipeline stage.
function renderPacePlanner(stages) {
  const result = document.getElementById('paceResult');
  const input = document.getElementById('pacePerDayInput');
  const stage = stages.find(s => s.stage === 'ready-to-post');
  const backlog = stage ? stage.count : 0;

  if (!backlog) {
    result.innerHTML = '<p class="pace-result-note">Nothing in "ready to post" right now, no pace to plan.</p>';
    return;
  }

  const raw = input.value.trim();
  const rate = raw === '' ? null : Number(raw);
  if (raw === '' || Number.isNaN(rate) || rate <= 0) {
    result.innerHTML = `<p class="pace-result-note">Enter how many of the real ${backlog} ready-to-post listing(s) actually get posted per day to see a projected clear date.</p>`;
    return;
  }

  const days = Math.ceil(backlog / rate);
  const finishStr = addDaysToDateStr(todayDateStr(), days);
  const dayWord = days === 1 ? 'day' : 'days';

  result.innerHTML = `
    <p class="pace-result-note">
      <span class="pace-result-figure">${days} ${dayWord}</span> to clear the real
      <span class="pace-result-figure">${backlog}</span>-listing backlog at
      <span class="pace-result-figure">${rate}</span>/day, done around
      <span class="pace-result-figure">${finishStr}</span> if today's pace holds.
    </p>`;
}

function wirePacePlanner() {
  const input = document.getElementById('pacePerDayInput');
  const saved = loadPaceRate();
  if (saved) input.value = String(saved);
  input.addEventListener('input', () => {
    const raw = input.value.trim();
    const rate = raw === '' ? null : Number(raw);
    if (rate && rate > 0) savePaceRate(rate);
    renderPacePlanner(currentStages);
  });
}

const POSHMARK_SHARE_STORAGE_KEY = 'garage-poshmark-share-log';
const POSHMARK_SHARE_DIMINISHING_AT = 4;

function loadPoshmarkShareLog() {
  try {
    const raw = localStorage.getItem(POSHMARK_SHARE_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}
function savePoshmarkShareLog(log) {
  try {
    localStorage.setItem(POSHMARK_SHARE_STORAGE_KEY, JSON.stringify(log));
  } catch {
    // Storage unavailable, today's log just won't persist across visits.
  }
}

// Only shows up when a real listing is actually on Poshmark, the tracker has
// nothing to do otherwise. Purely a manual log, no live Poshmark connection
// exists to confirm a share actually happened.
function renderPoshmarkShareTracker(listings) {
  const section = document.getElementById('poshmarkShareSection');
  const onPoshmark = (listings || []).some(l => (l.platforms || []).includes('poshmark'));
  if (!onPoshmark) {
    section.hidden = true;
    return;
  }
  section.hidden = false;

  const log = loadPoshmarkShareLog();
  const today = todayDateStr();
  const todayCount = log[today] || 0;
  const streak = computePoshmarkShareStreak(log, today);
  const dayWord = streak === 1 ? 'day' : 'days';

  const result = document.getElementById('poshmarkShareResult');
  const streakBadge = streak > 0
    ? `<span class="badge badge-fresh">${streak}-${dayWord} streak</span>`
    : `<span class="badge badge-due">No streak yet, log today's first share</span>`;
  const todayBadge = todayCount >= POSHMARK_SHARE_DIMINISHING_AT
    ? `<span class="badge badge-hold">${todayCount} logged today, past the point of extra benefit</span>`
    : `<span class="badge ${todayCount > 0 ? 'badge-fresh' : 'badge-due'}">${todayCount} logged today</span>`;

  result.innerHTML = `<p class="pace-result-note">${streakBadge} ${todayBadge}</p>`;
  document.getElementById('poshmarkShareUndoBtn').hidden = todayCount === 0;
}

function wirePoshmarkShareTracker() {
  document.getElementById('poshmarkShareLogBtn').addEventListener('click', () => {
    const log = loadPoshmarkShareLog();
    const today = todayDateStr();
    log[today] = (log[today] || 0) + 1;
    savePoshmarkShareLog(log);
    renderPoshmarkShareTracker(listings);
  });
  document.getElementById('poshmarkShareUndoBtn').addEventListener('click', () => {
    const log = loadPoshmarkShareLog();
    const today = todayDateStr();
    if (log[today] > 0) {
      log[today]--;
      if (log[today] === 0) delete log[today];
      savePoshmarkShareLog(log);
      renderPoshmarkShareTracker(listings);
    }
  });
}

// Which of the four known platforms an item isn't listed on yet, used for
// the "Cross-post coverage" section. Only reads the real platforms array,
// doesn't guess whether a given item actually fits an unlisted platform.
function missingPlatforms(l) {
  const listedOn = l.platforms || [];
  return VALID_PLATFORMS.filter(p => !listedOn.includes(p));
}

function renderCoverage(listings) {
  const tbody = document.getElementById('coverageTableBody');
  const empty = document.getElementById('coverageTableEmpty');
  const rows = listings.filter(l => l.status === 'live');

  if (!rows.length) {
    tbody.innerHTML = '';
    empty.hidden = false;
    empty.textContent = 'No live listings to check coverage for yet.';
    return;
  }
  empty.hidden = true;

  tbody.innerHTML = rows.map(l => {
    const missing = missingPlatforms(l);
    // Depop bans battery-powered/electronic items outright (see the
    // Electronics & battery-item rules reference), so for those listings
    // Depop isn't a real coverage gap to close, it's ineligible. Showing it
    // with the same plain "missing" badge as an actual expansion
    // opportunity would tell Jack to cross-post something Depop's own
    // policy already forbids, exactly the kind of silent-failure risk this
    // page exists to catch, not create.
    const depopBanned = GarageValidateCore.isDepopIneligible(l) && missing.includes('depop');
    const missingHtml = missing.length
      ? missing.map(p => (p === 'depop' && depopBanned)
        ? `<span class="badge badge-ineligible" title="Depop bans battery-powered/electronic items outright, see the Electronics &amp; battery-item rules reference">${escapeHtml(PLATFORM_LABELS[p] || p)}</span>`
        : `<span class="badge badge-missing">${escapeHtml(PLATFORM_LABELS[p] || p)}</span>`).join('')
      : '<span class="cell-value empty">none, fully cross-listed</span>';
    return `
    <tr>
      <td><div class="cell-card-name">${escapeHtml(l.title || 'Untitled item')}</div></td>
      <td class="cell-platforms">${platformBadges(l.platforms, l.soldOn)}</td>
      <td class="cell-platforms">${missingHtml}</td>
    </tr>
  `;
  }).join('');
}

const RELIST_BADGE_CLASS = { fresh: 'badge-fresh', due: 'badge-due', hold: 'badge-hold' };

function relistGuidanceHtml(l, days) {
  return relistGuidanceParts(l, days).map(part => part.tier === 'unknown'
    ? `<span class="cell-value empty">${escapeHtml(part.text)}</span>`
    : `<span class="badge ${RELIST_BADGE_CLASS[part.tier]}">${escapeHtml(part.text)}</span>`
  ).join(' ');
}

function relistGuidanceText(l, days) {
  return relistGuidanceParts(l, days).map(part => part.text).join('; ');
}

// Same items the "Needs delisting elsewhere" stat tile already counts (sold
// on at least one platform, still live on at least one other), but as an
// actual clickable list instead of just a number, matching the "Needs
// backfill" data-quality list's own click-through-to-record pattern. Without
// this, finding *which* items were at risk of a double sale meant scanning
// the whole listings table by eye for the sold-elsewhere badge styling.
function buildAtRiskListings(listings) {
  return listings.filter(l => l.status === 'live' && (l.soldOn || []).length > 0 && remainingPlatforms(l).length > 0);
}

function renderDelistList(listings) {
  const section = document.getElementById('delistSection');
  const list = document.getElementById('delistList');
  const atRisk = buildAtRiskListings(listings);

  if (!atRisk.length) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  list.innerHTML = atRisk.map(l => {
    const soldLabels = (l.soldOn || []).map(p => PLATFORM_LABELS[p] || p).join(', ');
    const stillLive = remainingPlatforms(l).map(p => PLATFORM_LABELS[p] || p).join(', ');
    return `
    <button type="button" class="data-quality-row" data-listing-id="${escapeHtml(l.id)}">
      <span class="dq-name">${escapeHtml(l.title || 'Untitled item')}</span>
      <span class="dq-why">SOLD ON ${escapeHtml(soldLabels.toUpperCase())}, STILL LIVE ON ${escapeHtml(stillLive.toUpperCase())}</span>
    </button>
  `;
  }).join('');
  list.querySelectorAll('[data-listing-id]').forEach(row => {
    row.addEventListener('click', () => openModal(row.dataset.listingId));
  });
}

// Flags real listings missing an optional-but-load-bearing field: a live
// item with no datePublished can never get real relist guidance (see
// relistGuidanceParts above, which requires it), and a live item with no
// costBasis silently drops the profit column from its own payout-by-platform
// table in the detail modal (see openModal). Neither is a validate.js error,
// both are schema-documented "leave null until known, never guess" fields,
// so nothing forces a hand-edit to notice the gap. Also flags a live eBay
// listing with no ebayReturnPolicy logged, or one that looks like it
// inherited an unrelated template (see isSuspiciousEbayReturnPolicy in
// validate-core.js): the exact silent-failure shape as the real "30-Day
// Seller-Paid Returns (Parts & Accessories)" bug already caught once (see
// activity.json), so a future relist can't repeat it unnoticed. Same "Needs
// backfill" pattern as the CSM/CGT hubs' own data-quality panels, hidden
// entirely when nothing is flagged rather than showing an empty box.
// Only ever a same-source suggestion, the first acquisition that both links
// this listing id and has enough logged to compute a real per-item cost
// (pricePaid and itemCount together, see acquisitionPerItemCost), never a
// guess made up from nothing. A listing fed by more than one acquisition
// (e.g. re-sourced after damage) just surfaces whichever comes first, the
// real "which acquisition" call is left to a human copying the number in.
function suggestedCostBasisFromAcquisitions(listingId, acquisitions) {
  for (const a of (acquisitions || [])) {
    if ((a.listingIds || []).includes(listingId)) {
      const cost = acquisitionPerItemCost(a);
      if (cost != null) return cost;
    }
  }
  return null;
}

function buildDataQualityFlags(listings, acquisitions) {
  return listings
    .filter(l => l.status === 'live')
    .map(l => {
      const reasons = [];
      if (!l.datePublished) reasons.push('NO DATE PUBLISHED LOGGED (BLOCKS RELIST GUIDANCE)');
      if (l.costBasis == null) {
        const suggested = suggestedCostBasisFromAcquisitions(l.id, acquisitions);
        reasons.push(suggested != null
          ? 'NO COST BASIS LOGGED, BUT ' + formatUsd(suggested) + ' IS AVAILABLE FROM A LOGGED ACQUISITION, COPY IT IN'
          : 'NO COST BASIS LOGGED (BLOCKS PROFIT CALC)');
      }
      if (!l.location) reasons.push('NO STORAGE LOCATION LOGGED (SLOWS FULFILLMENT ON SALE)');
      if ((l.platforms || []).includes('ebay')) {
        if (!l.ebayReturnPolicy) {
          reasons.push('NO EBAY RETURN POLICY LOGGED (COULD BE A SILENTLY INHERITED WRONG POLICY)');
        } else if (GarageValidateCore.isSuspiciousEbayReturnPolicy(l.ebayReturnPolicy)) {
          reasons.push('EBAY RETURN POLICY "' + l.ebayReturnPolicy.toUpperCase() + '" LOOKS INHERITED FROM AN UNRELATED TEMPLATE, CONFIRM IT');
        }
      }
      // Not eBay-only: Poshmark, Vinted, and Depop all expose the same
      // brand/size/condition/color fields as buyer search filters, so a
      // listing missing one drops out of a filtered search on whichever of
      // those platforms it's actually live on, not just eBay's Cassini.
      const missingSpecifics = GarageValidateCore.missingItemSpecifics(l);
      if (missingSpecifics.length) {
        reasons.push('MISSING ITEM SPECIFICS: ' +
          missingSpecifics.map(f => GarageValidateCore.ITEM_SPECIFIC_LABELS[f].toUpperCase()).join(', ') +
          ' (EXCLUDED FROM FILTERED SEARCH RESULTS ON ' + (l.platforms || []).map(p => (PLATFORM_LABELS[p] || p).toUpperCase()).join(', ') + ' FOR THESE)');
      }
      const missingUrlPlatforms = (l.platforms || []).filter(p =>
        !(l.soldOn || []).includes(p) && !(l.listingUrls && l.listingUrls[p])
      );
      if (missingUrlPlatforms.length) {
        reasons.push('NO LISTING URL FOR ' + missingUrlPlatforms.map(p => (PLATFORM_LABELS[p] || p).toUpperCase()).join(', '));
      }
      return { l, reasons };
    })
    .filter(x => x.reasons.length > 0);
}

function renderDataQuality(listings, acquisitions) {
  const section = document.getElementById('dataQualitySection');
  const list = document.getElementById('dataQualityList');
  const flagged = buildDataQualityFlags(listings, acquisitions);

  if (!flagged.length) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  list.innerHTML = flagged.map(({ l, reasons }) => `
    <button type="button" class="data-quality-row" data-listing-id="${escapeHtml(l.id)}">
      <span class="dq-name">${escapeHtml(l.title || 'Untitled item')}</span>
      <span class="dq-why">${escapeHtml(reasons.join(' · '))}</span>
    </button>
  `).join('');
  list.querySelectorAll('[data-listing-id]').forEach(row => {
    row.addEventListener('click', () => openModal(row.dataset.listingId));
  });
}

// Real risk this catches: re-adding an item after a platform sync, or
// copy-pasting an existing listing as a starting point for a new one and
// forgetting to change the id, would otherwise silently double-count in
// "Total live asking value" and every other stat tile with no flag ever
// surfacing. Grouping logic lives in GarageValidateCore, shared with
// validate.js (same reasoning as CGT's and CSM's own validate-core.js) so
// the two can never drift.
function renderDuplicates(listings) {
  const section = document.getElementById('duplicatesSection');
  const list = document.getElementById('duplicatesList');
  const groups = GarageValidateCore.findDuplicateListings(listings);

  if (!groups.length) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  list.innerHTML = groups.map(group => group.map(l => `
    <button type="button" class="data-quality-row" data-listing-id="${escapeHtml(l.id)}">
      <span class="dq-name">${escapeHtml(l.title || 'Untitled item')}</span>
      <span class="dq-why">${group.length} LIVE LISTINGS MATCH ON TITLE + PRICE</span>
    </button>
  `).join('')).join('');
  list.querySelectorAll('[data-listing-id]').forEach(row => {
    row.addEventListener('click', () => openModal(row.dataset.listingId));
  });
}

// Same attention-bar convention as CGT's and CSM's own renderAttentionBar:
// every one of these panels (needs-backfill, needs-delisting, duplicates,
// relist reminders, dispute deadlines, changelog drift) already hides
// itself when nothing's flagged, but each only becomes visible by scrolling
// past every section above it, so a real flag near the bottom of a page
// this long could go unnoticed for weeks. This click-to-scroll summary
// surfaces all of them up top instead, hidden entirely (not an empty bar)
// when every one of them has nothing flagged. Called once loadData's main
// fetch settles and again once loadChangelog's drift check settles, since
// the two run concurrently and either can finish first; both calls are
// idempotent, just re-render the same bar from current module state.
function renderAttentionBar() {
  const bar = document.getElementById('attentionBar');
  if (!bar) return;
  const today = todayDateStr();
  const dataQualityCount = buildDataQualityFlags(listings, acquisitionsLog).length;
  const atRiskCount = buildAtRiskListings(listings).length;
  const duplicateCount = window.GarageValidateCore ? GarageValidateCore.findDuplicateListings(listings).length : 0;
  const relistDueCount = buildRelistReminders(listings).filter(r => r.date <= today).length;
  const disputeDueCount = buildDisputeReminders(disputesLog).filter(r => r.date <= today).length;
  const lowStockCount = suppliesLog.filter(isSupplyLowStock).length;

  const items = [];
  // A drifted changelog is misinformation already live on the page (a real
  // commit history that no longer matches this repo's git log), an urgent
  // tone rather than the routine "needs backfill" warn tone below.
  if (garageChangelogDriftStatus && garageChangelogDriftStatus.drifted) {
    items.push({ n: 1, tone: 'urgent', target: 'changelogFeed', label: 'data changelog out of sync with real git history' });
  }
  if (disputeDueCount) {
    items.push({
      n: disputeDueCount,
      tone: 'urgent',
      target: 'disputeGuideSection',
      label: disputeDueCount === 1 ? 'dispute response is due or overdue' : 'dispute responses are due or overdue'
    });
  }
  if (atRiskCount) {
    items.push({
      n: atRiskCount,
      tone: 'warn',
      target: 'delistSection',
      label: atRiskCount === 1 ? 'listing needs delisting elsewhere (sold on one platform, still live on another)' : 'listings need delisting elsewhere (sold on one platform, still live on another)'
    });
  }
  if (dataQualityCount) {
    items.push({ n: dataQualityCount, tone: 'warn', target: 'dataQualitySection', label: dataQualityCount === 1 ? 'listing needs backfill' : 'listings need backfill' });
  }
  if (duplicateCount) {
    items.push({ n: duplicateCount, tone: 'warn', target: 'duplicatesSection', label: duplicateCount === 1 ? 'possible duplicate listing' : 'possible duplicate listings' });
  }
  if (relistDueCount) {
    items.push({ n: relistDueCount, tone: 'warn', target: 'relistSection', label: relistDueCount === 1 ? 'relist reminder is due' : 'relist reminders are due' });
  }
  if (lowStockCount) {
    items.push({ n: lowStockCount, tone: 'warn', target: 'suppliesSection', label: lowStockCount === 1 ? 'shipping supply is at or below its reorder point' : 'shipping supplies are at or below their reorder point' });
  }

  if (!items.length) {
    bar.hidden = true;
    bar.innerHTML = '';
    return;
  }
  bar.hidden = false;
  bar.innerHTML = items.map(item =>
    '<button type="button" class="attention-pill attention-' + item.tone + '" data-target="' + escapeHtml(item.target) + '">' +
    '<strong>' + item.n + '</strong> ' + escapeHtml(item.label) + '</button>'
  ).join('');
  bar.querySelectorAll('[data-target]').forEach(btn => {
    btn.addEventListener('click', () => {
      const el = document.getElementById(btn.getAttribute('data-target'));
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

// Real published title-length caps, and Depop's soft mobile-truncation
// point: now GarageValidateCore.TITLE_HARD_LIMITS / .DEPOP_TITLE_SOFT_LIMIT,
// the same shared constants validate.js checks against, rather than this
// file's own separately hand-maintained copy (see validate-core.js for the
// real sourcing note and the Vinted 70-vs-100 drift this used to risk).
const TITLE_HARD_LIMITS = GarageValidateCore.TITLE_HARD_LIMITS;
const DEPOP_SOFT_LIMIT = GarageValidateCore.DEPOP_TITLE_SOFT_LIMIT;

// Same freshness-badge pattern as FEE_SCHEDULE_REVIEWED_ON below: this table
// drives a real advisory/blocker on the pre-publish checklist and the photo
// draft tool, not just a display table, so a stale cap is a real risk of a
// missed rejection (or an over-cautious false warning, as the Vinted 70
// bug above was) rather than just a cosmetic reference going out of date.
const TITLE_SPECS_REVIEWED_ON = '2026-09-23';
const TITLE_SPECS_STALE_AFTER_DAYS = 45;

function renderTitleSpecsFreshness() {
  const el = document.getElementById('titleSpecsFreshness');
  if (!el) return;
  const age = daysSincePublished(TITLE_SPECS_REVIEWED_ON);
  const stale = age != null && age > TITLE_SPECS_STALE_AFTER_DAYS;
  el.textContent = age == null
    ? 'Review date unknown'
    : 'Reviewed ' + age + ' day' + (age === 1 ? '' : 's') + ' ago' + (stale ? ' -- re-verify before relying on this' : '');
  el.className = 'reference-freshness' + (stale ? ' reference-freshness-stale' : '');
  el.title = 'Last hand-verified against each platform\'s own published title/photo specs on ' + TITLE_SPECS_REVIEWED_ON + '.';
}

function titleFitCell(platform, title, platforms) {
  if (!(platforms || []).includes(platform)) {
    return '<span class="cell-value empty">not listed</span>';
  }
  const len = title.length;
  if (platform === 'depop') {
    return len > DEPOP_SOFT_LIMIT
      ? `<span class="badge badge-hold" title="Depop has no hard cap, but mobile search truncates around ${DEPOP_SOFT_LIMIT} characters">${len}, may truncate</span>`
      : `<span class="cell-muted">${len}, fits before truncation</span>`;
  }
  const limit = TITLE_HARD_LIMITS[platform];
  return len > limit
    ? `<span class="badge badge-due" title="${escapeHtml(PLATFORM_LABELS[platform] || platform)}'s title cap is ${limit} characters">${len}/${limit}, over</span>`
    : `<span class="cell-muted">${len}/${limit}</span>`;
}

function renderTitleFit(listings) {
  const tbody = document.getElementById('titleFitTableBody');
  const empty = document.getElementById('titleFitTableEmpty');
  const rows = listings.filter(l => l.status === 'live');

  if (!rows.length) {
    tbody.innerHTML = '';
    empty.hidden = false;
    empty.textContent = 'No live listings to check title length for yet.';
    return;
  }
  empty.hidden = true;

  tbody.innerHTML = rows.map(l => {
    const title = l.title || '';
    return `
    <tr>
      <td><div class="cell-card-name">${escapeHtml(title || 'Untitled item')}</div></td>
      <td class="cell-value">${title.length}</td>
      <td>${titleFitCell('ebay', title, l.platforms)}</td>
      <td>${titleFitCell('vinted', title, l.platforms)}</td>
      <td>${titleFitCell('poshmark', title, l.platforms)}</td>
      <td>${titleFitCell('depop', title, l.platforms)}</td>
    </tr>
  `;
  }).join('');
}

function renderRelist(listings) {
  const tbody = document.getElementById('relistTableBody');
  const empty = document.getElementById('relistTableEmpty');
  const rows = listings.filter(l => l.status === 'live');

  if (!rows.length) {
    tbody.innerHTML = '';
    empty.hidden = false;
    empty.textContent = 'No live listings to track relist timing for yet.';
    return;
  }
  empty.hidden = true;

  tbody.innerHTML = rows.map(l => {
    const days = daysSincePublished(l.datePublished);
    return `
    <tr>
      <td><div class="cell-card-name">${escapeHtml(l.title || 'Untitled item')}</div></td>
      <td class="cell-muted">${l.datePublished ? escapeHtml(l.datePublished) : '<span class="cell-value empty">not logged</span>'}</td>
      <td class="cell-value${days == null ? ' empty' : ''}">${days != null ? days : 'unknown'}</td>
      <td>${relistGuidanceHtml(l, days)}</td>
    </tr>
  `;
  }).join('');
}

// Local calendar date as YYYY-MM-DD, same convention as CGT's todayIso/
// addDaysIso and Sondrik's todayIso: new Date().toISOString().slice(0, 10)
// reads the UTC calendar date, which for anyone west of UTC still reads
// yesterday until the local evening rollover, and for anyone east of UTC
// rolls over to tomorrow before local midnight. That shifted an already-due
// relist reminder in buildRelistReminders below by a real calendar day
// instead of leaving it due today.
function todayDateStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Same due-date math as relistGuidanceParts above, turned into actual dated
// reminders instead of a relative "Nd until due" badge. No live cross-listing
// tool is connected here to relist automatically, this is the manual
// substitute: a real calendar event on the day each item's freshness window
// actually opens, computed only from a real logged datePublished. An
// already-overdue date is pulled forward to today rather than exported in
// the past, so the reminder still actually surfaces when imported.
function buildRelistReminders(currentListings) {
  const today = todayDateStr();
  const reminders = [];
  currentListings.filter(l => l.status === 'live' && l.datePublished).forEach(l => {
    const platforms = remainingPlatforms(l);
    if (!platforms.length) return;
    const title = l.title || 'Untitled item';
    const nonPoshmark = platforms.filter(p => p !== 'poshmark');
    if (nonPoshmark.length) {
      const due = addDaysToDateStr(l.datePublished, RELIST_FRESH_DAYS);
      reminders.push({
        id: `${l.id}-relist`,
        date: due < today ? today : due,
        summary: `Relist/renew: ${title}`,
        description: `Refresh or renew on ${nonPoshmark.map(p => PLATFORM_LABELS[p] || p).join(', ')}, ` +
          `${RELIST_FRESH_DAYS} days without a sale since it went live on ${l.datePublished}. Command Center Garage.`
      });
    }
    if (platforms.includes('poshmark')) {
      const due = addDaysToDateStr(l.datePublished, POSHMARK_HOLD_DAYS);
      reminders.push({
        id: `${l.id}-poshmark-relist`,
        date: due < today ? today : due,
        summary: `Poshmark relist eligible: ${title}`,
        description: `Past Poshmark's ${POSHMARK_HOLD_DAYS}-day Excessive Listing Removal Policy window, ` +
          `safe to relist the same item there now. Command Center Garage.`
      });
    }
  });
  return reminders;
}

// Same "real calendar event, computed only from real logged data, pulled
// forward to today rather than exported in the past" convention as
// buildRelistReminders above, but for the one deadline that actually has
// money attached: missing eBay's 3-business-day or Poshmark's ~24-hour
// response window can mean the case auto-resolves in the buyer's favor.
// Only built for disputes disputeResponseDeadline can actually compute a
// real date for (open, a logged openedDate, and a platform with a fixed
// clock), same guard that function already applies.
function buildDisputeReminders(disputesList) {
  const today = todayDateStr();
  return disputesList.filter(d => d.status === 'open').map(d => {
    const deadline = disputeResponseDeadline(d);
    if (!deadline) return null;
    const title = d.title || 'Untitled item';
    const overdue = deadline < today;
    return {
      id: `${d.id}-dispute-respond`,
      date: overdue ? today : deadline,
      summary: `Respond to ${PLATFORM_LABELS[d.platform] || d.platform} dispute: ${title}`,
      description: `${DISPUTE_TYPE_LABELS[d.type] || d.type || 'Dispute'} case opened ${d.openedDate}, ` +
        `response ${overdue ? 'was due ' + deadline + ' (overdue)' : 'due ' + deadline} or it may auto-resolve ` +
        `in the buyer's favor. Command Center Garage.`
    };
  }).filter(Boolean);
}

function icsEscapeText(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\n/g, '\\n');
}

// RFC 5545 requires folding any content line over 75 octets onto a
// continuation line starting with a single space, applied here since the
// description text can run past that on a multi-platform item.
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

function icsDateStamp(date) {
  return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

// One all-day VEVENT per reminder, each with a DISPLAY alarm at 9am on the
// day so it actually shows up rather than sitting silent on an all-day row.
function buildIcsCalendar(reminders) {
  const stamp = icsDateStamp(new Date());
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Command Center//Garage Reminders//EN', 'CALSCALE:GREGORIAN'];
  reminders.forEach(r => {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:garage-${r.id}-${r.date}@command-center.local`);
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

// listingUrls is optional and only honored here (the modal detail view),
// not in the table/coverage rows, since those rows are themselves clickable
// to open the modal and a nested <a> inside a clickable row is both an
// accessibility trap and a click-target conflict.
function platformBadges(platforms, soldOn, listingUrls) {
  const sold = soldOn || [];
  return (platforms || []).map(p => {
    const isSold = sold.includes(p);
    const cls = isSold ? 'badge badge-sold-elsewhere' : `badge badge-${escapeHtml(p)}`;
    const label = escapeHtml(PLATFORM_LABELS[p] || p) + (isSold ? ' (sold)' : '');
    const url = !isSold && listingUrls ? listingUrls[p] : null;
    if (url) {
      return `<a class="${cls} badge-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" title="Open the real ${escapeHtml(PLATFORM_LABELS[p] || p)} listing">${label} <span aria-hidden="true">&#8599;</span></a>`;
    }
    return `<span class="${cls}">${label}</span>`;
  }).join('');
}

// Matches CGT/CSM's own search depth (cardName+certNumber+storageLocation,
// name+company+verifiedHook+notes): title alone missed the one other real
// free-text field a listing carries, so a distinctive flaw or brand
// mentioned only in notes was unfindable by search.
function matchesSearchTerm(l, term) {
  term = term.trim().toLowerCase();
  return !term
    || (l.title || '').toLowerCase().includes(term)
    || (l.notes || '').toLowerCase().includes(term)
    || (l.location || '').toLowerCase().includes(term);
}
function matchesPlatformValue(l, platform) {
  return platform === 'all' || (l.platforms || []).includes(platform);
}

function matchesFilters(l) {
  return l.status === 'live' && matchesSearchTerm(l, searchTerm) && matchesPlatformValue(l, activePlatform);
}

// Counts how many live listings would match if the platform chip were set to
// `value`, holding search as-is, so each chip shows what picking it would
// actually leave on the table (same faceted-search convention as CGT).
function facetCount(value) {
  return listings.filter(l => l.status === 'live' && matchesSearchTerm(l, searchTerm) && matchesPlatformValue(l, value)).length;
}

function anyFilterActive() {
  return !!searchTerm.trim() || activePlatform !== 'all';
}

function updateChipCounts() {
  const container = document.getElementById('platformFilter');
  container.querySelectorAll('.chip').forEach(chip => {
    const countEl = chip.querySelector('.chip-count');
    if (!countEl) return;
    const value = chip.getAttribute('data-platform');
    const count = facetCount(value);
    countEl.textContent = ' ' + count;
    // Dimmed, not disabled: a 0-count facet is still worth being able to
    // click, it just shouldn't visually compete with facets that actually
    // narrow anything.
    chip.classList.toggle('chip-zero', count === 0 && chip.getAttribute('aria-pressed') !== 'true');
  });
}

function sortRows(rows) {
  if (!sortKey) return rows;
  const dir = sortDir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
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
function announceFilterStatus(matchCount) {
  const status = document.getElementById('filterStatus');
  status.textContent = anyFilterActive()
    ? matchCount + ' listing' + (matchCount === 1 ? '' : 's') + ' match' + (matchCount === 1 ? 'es' : '')
      + (activePlatform !== 'all' ? ' on ' + (PLATFORM_LABELS[activePlatform] || activePlatform) : '')
      + (searchTerm.trim() ? ' for "' + searchTerm.trim() + '"' : '')
    : '';
}

function applyFiltersAndRender() {
  const filtered = sortRows(listings.filter(matchesFilters));
  const tbody = document.getElementById('listingTableBody');
  const empty = document.getElementById('tableEmpty');
  updateSortHeaders();
  announceFilterStatus(filtered.length);
  updateChipCounts();
  document.getElementById('clearFiltersBtn').hidden = !anyFilterActive();

  if (!filtered.length) {
    tbody.innerHTML = '';
    empty.hidden = false;
    empty.setAttribute('role', 'status');
    empty.textContent = listings.length ? 'No live listings match the current filters.' : 'No live listings logged yet.';
    syncUrl();
    return;
  }
  empty.hidden = true;

  // No aria-label here on purpose: this row's own real price/platform/date/
  // location cells are the actual content a screen reader user needs the
  // same way a sighted user reads them off the table, an aria-label reciting
  // only the title would silently override all of that with just the name.
  tbody.innerHTML = filtered.map(l => `
    <tr class="row-clickable" data-listing-id="${escapeHtml(l.id)}" tabindex="0" role="button">
      <td>
        <div class="cell-card-name">${escapeHtml(l.title || 'Untitled item')}</div>
        ${l.notes ? `<div class="cell-card-meta">${escapeHtml(l.notes)}</div>` : ''}
      </td>
      <td class="cell-value${l.price == null ? ' empty' : ''}">${l.price != null ? formatUsd(l.price) : 'not set'}</td>
      <td class="cell-platforms">${platformBadges(l.platforms, l.soldOn)}</td>
      <td class="cell-muted">${l.datePublished ? escapeHtml(l.datePublished) : '<span class="cell-value empty">not logged</span>'}</td>
      <td class="cell-muted">${l.location ? escapeHtml(l.location) : '<span class="cell-value empty">not logged</span>'}</td>
    </tr>
  `).join('');
  tbody.querySelectorAll('[data-listing-id]').forEach(row => {
    row.addEventListener('click', () => openModal(row.getAttribute('data-listing-id')));
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openModal(row.getAttribute('data-listing-id'));
      }
    });
  });
  syncUrl();
}

// Finds which of an item's own listed platforms nets the most after fees, so
// the payout table can point at the actual highest-payout choice rather than
// making the seller compare four columns by eye. Only considers platforms the
// item is actually still sellable on (remainingPlatforms), not every platform
// it was ever listed to, since a platform it already sold on can't be a real
// "best" recommendation, it's just a stale figure. Ties (e.g. two platforms
// both net exactly the same) intentionally mark none, since there's no real
// "best" to point to.
function bestPayoutPlatform(l) {
  const candidates = remainingPlatforms(l)
    .map(p => ({ p, net: estimateNetPayout(p, l.price, l.category) }))
    .filter(c => c.net != null);
  if (candidates.length < 2) return null;
  candidates.sort((a, b) => b.net - a.net);
  if (candidates[1].net === candidates[0].net) return null;
  return candidates[0].p;
}

function renderPayoutTable(listings) {
  const tbody = document.getElementById('payoutTableBody');
  const empty = document.getElementById('payoutTableEmpty');
  const rows = listings.filter(l => l.status === 'live');

  if (!rows.length) {
    tbody.innerHTML = '';
    empty.hidden = false;
    empty.textContent = 'No live listings to estimate payout for yet.';
    return;
  }
  empty.hidden = true;

  tbody.innerHTML = rows.map(l => {
    const best = bestPayoutPlatform(l);
    const soldSet = new Set(l.soldOn || []);
    return `
    <tr>
      <td><div class="cell-card-name">${escapeHtml(l.title || 'Untitled item')}</div></td>
      <td class="cell-value${l.price == null ? ' empty' : ''}">${l.price != null ? formatUsd(l.price) : 'not set'}</td>
      ${PAYOUT_PLATFORMS.map(p => {
        if (!(l.platforms || []).includes(p)) return '<td class="cell-value empty">not listed</td>';
        if (soldSet.has(p)) return '<td class="cell-value empty" title="Already sold here, no longer sellable on this platform">sold here</td>';
        const net = estimateNetPayout(p, l.price, l.category);
        const isBest = p === best;
        return `<td class="cell-value${isBest ? ' cell-value-best' : ''}">${net != null ? formatUsd(net) : 'not set'}${isBest ? ' <span class="best-tag" title="Highest net payout for this item">best</span>' : ''}</td>`;
      }).join('')}
    </tr>
  `;
  }).join('');
}

// Each .table-wrap has a fixed min-width so columns stay legible, which
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

// "Price a new item" what-if calculator: purely client-side, not tied to
// any logged listing, so someone can check payout across platforms before
// a draft even exists. Same fee formulas and best-tag convention as the
// payout table above, just driven by a typed price instead of listings.json.
const CALC_FEE_DESCRIPTIONS = {
  ebay: '13.6% final value fee + $0.30 ($0.40 over $10) per-order fee',
  ebayShoes: '15.3% final value fee (Clothing, Shoes & Accessories) + $0.30 ($0.40 over $10) per-order fee',
  vinted: 'No seller fees',
  poshmark: 'Flat $2.95 under $15, otherwise 20% commission',
  depop: '3.3% + $0.45 payment processing, no commission'
};
// Real, optional Depop add-on fee (DEPOP_BOOST_FEE_PCT, from GarageCore),
// separate from estimateNetPayout() above: a seller opts a specific listing
// into Boosted Listings (eligible new listings only, live since 2026-03-23)
// and only pays 12% if it then sells through that boost. It's not part of
// Depop's baseline fee, so it stays out of the payout table (which reflects
// already-published, un-boosted listings) and only applies here, where a
// seller is deciding whether boosting a new item is worth it.
let calcPlatforms = new Set(PAYOUT_PLATFORMS);
let includeDepopBoost = false;
let includeEbayShoesRate = false;

// Reads a positive-or-zero numeric input, treating blank as "not provided"
// (null) rather than 0, since a real $0 cost and "haven't entered one yet"
// are different states, same distinction the rest of this file draws
// between null and 0 everywhere else.
function readOptionalNonNegativeInput(el) {
  const raw = el.value.trim();
  if (raw === '') return null;
  const n = Number(raw);
  return Number.isNaN(n) || n < 0 ? undefined : n;
}

// Same real-time em-dash catch CSM's own prospect-entry form just got: a
// free-text field pasted in with an em dash used to go uncaught until the
// next `node validate.js` run, since GarageValidateCore.emDashFields only
// ever checked the file on disk, never what was actually typed into one of
// these quick-log or edit forms. One shared helper for every quick-log tool
// below, so the warning text can't drift between entities the way the
// hand-duplicated blocker/advisory checks already do in this file.
function emDashAdvisory(obj, fields) {
  const hits = GarageValidateCore.emDashFields(obj, fields);
  return hits.length
    ? ['"' + hits.join('", "') + '" contains an em dash, this tracker never uses one, check for a paste-in.']
    : [];
}

// Listings also carry itemSpecifics, a nested object the plain emDashAdvisory
// above can't reach on its own, so this adds that check with the same
// "itemSpecifics.<field>" prefix validate.js already uses. Shared between
// wireQuickLogTool and wireListingEditForm so the two can't drift.
function listingEmDashAdvisory(candidate) {
  const hits = GarageValidateCore.emDashFields(candidate, ['title', 'location']);
  const specificHits = GarageValidateCore.emDashFields(candidate.itemSpecifics, Object.keys(GarageValidateCore.ITEM_SPECIFIC_LABELS))
    .map(f => 'itemSpecifics.' + f);
  const allHits = hits.concat(specificHits);
  return allHits.length
    ? ['"' + allHits.join('", "') + '" contains an em dash, this tracker never uses one, check for a paste-in.']
    : [];
}

function renderCalc() {
  const input = document.getElementById('calcPriceInput');
  const costInput = document.getElementById('calcCostInput');
  const costError = document.getElementById('calcCostError');
  const shippingInput = document.getElementById('calcShippingInput');
  const shippingError = document.getElementById('calcShippingError');
  const tbody = document.getElementById('calcTableBody');
  const empty = document.getElementById('calcTableEmpty');
  const table = document.getElementById('calcTable');
  const profitHead = document.getElementById('calcProfitHead');
  const raw = input.value.trim();
  const price = raw === '' ? null : Number(raw);
  const cost = readOptionalNonNegativeInput(costInput);
  const shipping = readOptionalNonNegativeInput(shippingInput);
  // undefined (as opposed to null) means something was typed but it wasn't a
  // valid non-negative number, e.g. a negative cost, which the input's own
  // min="0" doesn't actually block from being typed. Say so instead of
  // silently dropping the profit column with no indication why.
  const costInvalid = cost === undefined;
  costError.hidden = !costInvalid;
  costError.textContent = costInvalid ? 'Enter a valid cost of $0 or more, ignoring it for now.' : '';
  const shippingInvalid = shipping === undefined;
  shippingError.hidden = !shippingInvalid;
  shippingError.textContent = shippingInvalid ? 'Enter a valid shipping cost of $0 or more, ignoring it for now.' : '';
  // Profit shows once either cost or shipping is entered, treating the other
  // as $0 rather than hiding the whole column, since a seller who only knows
  // one of the two numbers still gets a real (if partial) profit estimate.
  const hasCost = cost != null && cost !== undefined;
  const hasShipping = shipping != null && shipping !== undefined;
  const showProfit = hasCost || hasShipping;
  document.getElementById('calcDepopBoostWrap').hidden = !calcPlatforms.has('depop');
  document.getElementById('calcEbayShoesWrap').hidden = !calcPlatforms.has('ebay');

  if (price == null || Number.isNaN(price) || price < 0 || calcPlatforms.size === 0) {
    table.hidden = true;
    empty.hidden = false;
    empty.textContent = calcPlatforms.size === 0
      ? 'No platforms selected above.'
      : 'Enter a price above to see estimated payouts.';
    return;
  }
  table.hidden = false;
  empty.hidden = true;
  profitHead.hidden = !showProfit;

  const applyBoost = includeDepopBoost && calcPlatforms.has('depop');
  const applyEbayShoesRate = includeEbayShoesRate && calcPlatforms.has('ebay');
  const ebayCategory = applyEbayShoesRate ? 'shoes' : undefined;

  const rows = PAYOUT_PLATFORMS.filter(p => calcPlatforms.has(p)).map(p => {
    const net = p === 'depop' && applyBoost
      ? estimateNetPayout(p, price) - price * DEPOP_BOOST_FEE_PCT
      : estimateNetPayout(p, price, p === 'ebay' ? ebayCategory : undefined);
    return { p, net };
  });
  const bestNet = rows.length > 1 ? Math.max(...rows.map(r => r.net)) : null;
  const tiedForBest = bestNet != null && rows.filter(r => r.net === bestNet).length > 1;

  tbody.innerHTML = rows.map(r => {
    const isBest = bestNet != null && !tiedForBest && r.net === bestNet;
    const profit = showProfit ? r.net - (hasCost ? cost : 0) - (hasShipping ? shipping : 0) : null;
    const feeDescription = r.p === 'depop' && applyBoost
      ? CALC_FEE_DESCRIPTIONS.depop + ' + 12% boost fee'
      : r.p === 'ebay' && applyEbayShoesRate
        ? CALC_FEE_DESCRIPTIONS.ebayShoes
        : CALC_FEE_DESCRIPTIONS[r.p];
    return `
    <tr>
      <td>${escapeHtml(PLATFORM_LABELS[r.p])}</td>
      <td class="cell-muted">${escapeHtml(feeDescription)}</td>
      <td class="cell-value${isBest ? ' cell-value-best' : ''}">${formatUsd(r.net)}${isBest ? ' <span class="best-tag" title="Highest net payout at this price">best</span>' : ''}</td>
      ${showProfit ? `<td class="cell-value${profit < 0 ? ' cell-value-loss' : ''}">${formatUsd(profit)}</td>` : ''}
    </tr>
  `;
  }).join('');
}

function wireCalc() {
  document.getElementById('calcPriceInput').addEventListener('input', renderCalc);
  document.getElementById('calcCostInput').addEventListener('input', renderCalc);
  document.getElementById('calcShippingInput').addEventListener('input', renderCalc);
  document.getElementById('calcDepopBoostInput').addEventListener('change', e => {
    includeDepopBoost = e.target.checked;
    renderCalc();
  });
  document.getElementById('calcEbayShoesInput').addEventListener('change', e => {
    includeEbayShoesRate = e.target.checked;
    renderCalc();
  });
  const container = document.getElementById('calcPlatformToggle');
  container.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const platform = chip.getAttribute('data-platform');
      const nowOn = chip.getAttribute('aria-pressed') !== 'true';
      chip.setAttribute('aria-pressed', String(nowOn));
      if (nowOn) calcPlatforms.add(platform); else calcPlatforms.delete(platform);
      renderCalc();
    });
  });
  renderCalc();
}

// Break-even / target-profit price finder: the inverse of the calculator
// above. That one goes price -> net payout -> profit; this one starts from
// the net proceeds a seller actually needs (cost + shipping + target profit)
// and solves each platform's fee formula backward for the minimum listing
// price that clears it. Each platform's fee formula from estimateNetPayout()
// is algebraically inverted here rather than reused, since none of it is a
// simple lookup once fees are a function of the unknown price.
let beCalcPlatforms = new Set(PAYOUT_PLATFORMS);
let beIncludeDepopBoost = false;
let beIncludeEbayShoesRate = false;

// eBay's per-order fee is a step function of price ($0.30 at/under $10, else
// $0.40), so solve assuming the lower step first; the lower step is always
// the cheaper of the two prices that clear targetNet, so it's the true
// minimum whenever it actually lands at/under $10. Only fall back to the
// higher step when the lower step's own price would cross $10 (which
// invalidates the $0.30 assumption it was solved under). Trying the higher
// step first, as an earlier version of this did, missed that a price just
// under $10 can clear the same target net as a price just over $10 (the fee
// jump absorbs the gap), and returned the more expensive one every time.
function renderBreakEven() {
  const costInput = document.getElementById('beCostInput');
  const costError = document.getElementById('beCostError');
  const shippingInput = document.getElementById('beShippingInput');
  const shippingError = document.getElementById('beShippingError');
  const profitInput = document.getElementById('beProfitInput');
  const profitError = document.getElementById('beProfitError');
  const tbody = document.getElementById('beTableBody');
  const empty = document.getElementById('beTableEmpty');
  const table = document.getElementById('beTable');

  const cost = readOptionalNonNegativeInput(costInput);
  const shipping = readOptionalNonNegativeInput(shippingInput);
  const profit = readOptionalNonNegativeInput(profitInput);

  const costInvalid = cost === undefined;
  costError.hidden = !costInvalid;
  costError.textContent = costInvalid ? 'Enter a valid cost of $0 or more, ignoring it for now.' : '';
  const shippingInvalid = shipping === undefined;
  shippingError.hidden = !shippingInvalid;
  shippingError.textContent = shippingInvalid ? 'Enter a valid shipping cost of $0 or more, ignoring it for now.' : '';
  const profitInvalid = profit === undefined;
  profitError.hidden = !profitInvalid;
  profitError.textContent = profitInvalid ? 'Enter a valid target profit of $0 or more, ignoring it for now.' : '';

  document.getElementById('beDepopBoostWrap').hidden = !beCalcPlatforms.has('depop');
  document.getElementById('beEbayShoesWrap').hidden = !beCalcPlatforms.has('ebay');

  const hasCost = cost != null && cost !== undefined && cost > 0;
  const hasAnyInput = hasCost || (shipping != null && shipping !== undefined && shipping > 0) ||
    (profit != null && profit !== undefined && profit > 0);

  if (!hasAnyInput || beCalcPlatforms.size === 0) {
    table.hidden = true;
    empty.hidden = false;
    empty.textContent = beCalcPlatforms.size === 0
      ? 'No platforms selected above.'
      : 'Enter a cost above to find the break-even price.';
    return;
  }
  table.hidden = false;
  empty.hidden = true;

  const targetNet = (cost || 0) + (shipping || 0) + (profit || 0);
  const applyBoost = beIncludeDepopBoost && beCalcPlatforms.has('depop');
  const applyEbayShoesRate = beIncludeEbayShoesRate && beCalcPlatforms.has('ebay');

  const rows = PAYOUT_PLATFORMS.filter(p => beCalcPlatforms.has(p)).map(p => {
    const minPrice = minListingPriceForNet(p, targetNet, applyBoost, p === 'ebay' && applyEbayShoesRate ? 'shoes' : undefined);
    return { p, minPrice };
  });
  const lowest = rows.length > 1 ? Math.min(...rows.map(r => r.minPrice)) : null;
  const tiedForLowest = lowest != null && rows.filter(r => r.minPrice === lowest).length > 1;

  tbody.innerHTML = rows.map(r => {
    const isBest = lowest != null && !tiedForLowest && r.minPrice === lowest;
    const feeDescription = r.p === 'depop' && applyBoost
      ? CALC_FEE_DESCRIPTIONS.depop + ' + 12% boost fee'
      : r.p === 'ebay' && applyEbayShoesRate
        ? CALC_FEE_DESCRIPTIONS.ebayShoes
        : CALC_FEE_DESCRIPTIONS[r.p];
    return `
    <tr>
      <td>${escapeHtml(PLATFORM_LABELS[r.p])}</td>
      <td class="cell-muted">${escapeHtml(feeDescription)}</td>
      <td class="cell-value${isBest ? ' cell-value-best' : ''}">${formatUsd(r.minPrice)}${isBest ? ' <span class="best-tag" title="Lowest price that still clears the target across included platforms">lowest</span>' : ''}</td>
    </tr>
  `;
  }).join('');
}

function wireBreakEven() {
  document.getElementById('beCostInput').addEventListener('input', renderBreakEven);
  document.getElementById('beShippingInput').addEventListener('input', renderBreakEven);
  document.getElementById('beProfitInput').addEventListener('input', renderBreakEven);
  document.getElementById('beDepopBoostInput').addEventListener('change', e => {
    beIncludeDepopBoost = e.target.checked;
    renderBreakEven();
  });
  document.getElementById('beEbayShoesInput').addEventListener('change', e => {
    beIncludeEbayShoesRate = e.target.checked;
    renderBreakEven();
  });
  const container = document.getElementById('bePlatformToggle');
  container.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const platform = chip.getAttribute('data-platform');
      const nowOn = chip.getAttribute('aria-pressed') !== 'true';
      chip.setAttribute('aria-pressed', String(nowOn));
      if (nowOn) beCalcPlatforms.add(platform); else beCalcPlatforms.delete(platform);
      renderBreakEven();
    });
  });
  renderBreakEven();
}

// Multi-item bundle discount calculator: the one real seller-net lever in a
// bundle sale, separate from the shipping-convenience angle covered in the
// callout text. eBay/Poshmark/Depop each charge their fixed per-order fee
// once per transaction, so combining N items into one sale pays that fee
// once instead of N times; Vinted charges the seller no fee at all, so it
// always shows the full discount as a loss with no offsetting saving, which
// is the real, correct answer for that platform, not a bug in this table.
let bundleItemValues = ['', ''];
let bundlePlatforms = new Set(PAYOUT_PLATFORMS);

function bundleItemRowHtml(i, value) {
  return `
    <div class="bundle-item-row" data-bundle-row="${i}">
      <div class="calc-price-input-wrap">
        <label class="calc-price-prefix font-mono" for="bundleItem${i}">item ${i + 1} $</label>
        <input
          type="number"
          id="bundleItem${i}"
          class="calc-price-input font-mono bundle-item-input"
          data-row-index="${i}"
          min="0"
          step="0.01"
          inputmode="decimal"
          placeholder="0.00"
          value="${escapeHtml(value)}"
          aria-label="Item ${i + 1} asking price">
      </div>
      <button type="button" class="bundle-remove-btn" data-remove-row="${i}" aria-label="Remove item ${i + 1}"${bundleItemValues.length <= 2 ? ' disabled' : ''}>&times;</button>
    </div>`;
}

function renderBundleItemRows() {
  const container = document.getElementById('bundleItemRows');
  container.innerHTML = bundleItemValues.map((v, i) => bundleItemRowHtml(i, v)).join('');
  container.querySelectorAll('.bundle-item-input').forEach(input => {
    input.addEventListener('input', e => {
      bundleItemValues[Number(e.target.getAttribute('data-row-index'))] = e.target.value;
      renderBundle();
    });
  });
  container.querySelectorAll('[data-remove-row]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (bundleItemValues.length <= 2) return;
      bundleItemValues.splice(Number(btn.getAttribute('data-remove-row')), 1);
      renderBundleItemRows();
      renderBundle();
    });
  });
}

function renderBundle() {
  const discountInput = document.getElementById('bundleDiscountInput');
  const tbody = document.getElementById('bundleTableBody');
  const empty = document.getElementById('bundleTableEmpty');
  const table = document.getElementById('bundleTable');

  const prices = bundleItemValues
    .map(v => v.trim() === '' ? null : Number(v))
    .filter(n => n != null && !Number.isNaN(n) && n >= 0);

  if (prices.length < 2 || bundlePlatforms.size === 0) {
    table.hidden = true;
    empty.hidden = false;
    empty.textContent = bundlePlatforms.size === 0
      ? 'No platforms selected above.'
      : 'Enter at least two item prices above to compare.';
    return;
  }
  table.hidden = false;
  empty.hidden = true;

  const discountRaw = Number(discountInput.value);
  const discountPct = Number.isNaN(discountRaw) ? 0 : discountRaw;

  const rows = PAYOUT_PLATFORMS.filter(p => bundlePlatforms.has(p))
    .map(p => ({ p, ...bundleNetComparison(p, prices, discountPct) }));

  tbody.innerHTML = rows.map(r => `
    <tr>
      <td>${escapeHtml(PLATFORM_LABELS[r.p])}</td>
      <td class="cell-muted">${formatUsd(r.separateNet)}</td>
      <td class="cell-value">${formatUsd(r.bundledNet)}</td>
      <td class="cell-value${r.swing < 0 ? ' cell-value-loss' : ''}">${r.swing >= 0 ? '+' : ''}${formatUsd(r.swing)}</td>
    </tr>
  `).join('');
}

function wireBundle() {
  renderBundleItemRows();
  document.getElementById('bundleAddItemBtn').addEventListener('click', () => {
    bundleItemValues.push('');
    renderBundleItemRows();
    renderBundle();
  });
  document.getElementById('bundleDiscountInput').addEventListener('input', renderBundle);
  const container = document.getElementById('bundlePlatformToggle');
  container.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const platform = chip.getAttribute('data-platform');
      const nowOn = chip.getAttribute('aria-pressed') !== 'true';
      chip.setAttribute('aria-pressed', String(nowOn));
      if (nowOn) bundlePlatforms.add(platform); else bundlePlatforms.delete(platform);
      renderBundle();
    });
  });
  renderBundle();
}

// Poshmark heavy-item shipping check: tier math lives in GarageCore's
// poshmarkWeightTier (see its own comment there), this just renders it.
function renderPoshWeightCheck() {
  const input = document.getElementById('poshWeightInput');
  const result = document.getElementById('poshWeightResult');
  const weight = readOptionalNonNegativeInput(input);
  if (weight === undefined) {
    result.textContent = 'Enter a valid boxed weight of 0 lb or more.';
    return;
  }
  if (weight == null || weight === 0) {
    result.textContent = 'Enter a boxed weight above to check.';
    return;
  }
  const tier = poshmarkWeightTier(weight);
  if (!tier) {
    result.textContent = `At ${weight} lb, this is past Poshmark's 15 lb flat-rate tiers entirely, check ` +
      `Poshmark's current large-item shipping options before listing, this calculator doesn't cover it.`;
    return;
  }
  result.textContent = tier.sellerCost === 0
    ? `At ${weight} lb, this stays under the 5 lb flat-rate cutoff. The buyer pays the standard ` +
      `$${tier.buyerRate.toFixed(2)} label, no shipping cost to you as the seller.`
    : `At ${weight} lb, this bumps the label to $${tier.labelCost.toFixed(2)}. The buyer still covers the ` +
      `first $${tier.buyerRate.toFixed(2)}, you absorb the $${tier.sellerCost.toFixed(2)} step-up out of the ` +
      `sale, worth logging as a real shipping cost once this sells.`;
}

function wirePoshWeightCheck() {
  document.getElementById('poshWeightInput').addEventListener('input', renderPoshWeightCheck);
  renderPoshWeightCheck();
}

// eBay Promoted Listings Standard (General campaign) cost check: a
// cost-per-sale ad, so the only real dollar cost is adRate% of the item's
// actual sale price, charged only if that exact listing sells inside eBay's
// 30-day attribution window (a click on it now attributing any purchase of
// it within 30 days, not only by the same buyer, since eBay's January 2026
// attribution change). eBay's own published minimum ad rate for a General
// campaign is 2%, raised from 1% in July 2023, so anything entered below
// that isn't a rate eBay would actually let this be set to. Only applies to
// listings still live on eBay, Promoted Listings Standard is eBay-only.
const EBAY_PROMOTED_MIN_RATE = 2;
let promotedItemId = null;

function promotedEligibleListings(currentListings) {
  return currentListings.filter(l =>
    l.status === 'live' && (l.platforms || []).includes('ebay') && !(l.soldOn || []).includes('ebay'));
}

function renderPromotedItemChips(currentListings) {
  const container = document.getElementById('promotedItemChips');
  const eligible = promotedEligibleListings(currentListings);
  if (!eligible.some(l => l.id === promotedItemId)) {
    promotedItemId = eligible.length ? eligible[0].id : null;
  }
  container.innerHTML = eligible.map(l => `
    <button type="button" class="chip" data-promoted-item="${escapeHtml(l.id)}" aria-pressed="${promotedItemId === l.id}">${escapeHtml(l.title || 'Untitled item')}</button>
  `).join('');
  container.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      promotedItemId = chip.getAttribute('data-promoted-item');
      renderPromotedItemChips(listings);
      renderPromotedCalc();
    });
  });
  renderPromotedCalc();
}

function renderPromotedCalc() {
  const result = document.getElementById('promotedResult');
  const rateInput = document.getElementById('promotedRateInput');
  const eligible = promotedEligibleListings(listings);

  if (!eligible.length) {
    result.innerHTML = '<p class="pace-result-note">No live eBay listing to check, Promoted Listings Standard is eBay-only.</p>';
    return;
  }
  const l = eligible.find(x => x.id === promotedItemId) || eligible[0];
  if (l.price == null) {
    result.innerHTML = `<p class="pace-result-note">` +
      `<span class="pace-result-figure">${escapeHtml(l.title || 'This item')}</span> has no asking price logged yet, nothing to check against.</p>`;
    return;
  }
  const raw = rateInput.value.trim();
  const rate = raw === '' ? null : Number(raw);

  if (raw === '' || Number.isNaN(rate) || rate <= 0) {
    result.innerHTML = `<p class="pace-result-note">Enter an ad rate to see the real cost against ` +
      `<span class="pace-result-figure">${escapeHtml(l.title || 'this item')}</span>'s ` +
      `<span class="pace-result-figure">${formatUsd(l.price)}</span> real asking price.</p>`;
    return;
  }
  if (rate < EBAY_PROMOTED_MIN_RATE) {
    result.innerHTML = `<p class="pace-result-note">eBay's own General campaign minimum is ` +
      `<span class="pace-result-figure">${EBAY_PROMOTED_MIN_RATE}%</span>, a rate can't actually be set below that.</p>`;
    return;
  }

  const price = l.price;
  const organicNet = estimateNetPayout('ebay', price, l.category);
  const adFee = price * (rate / 100);
  const promotedNet = organicNet - adFee;

  result.innerHTML = `
    <p class="pace-result-note">
      A <span class="pace-result-figure">${rate}%</span> ad rate on
      <span class="pace-result-figure">${escapeHtml(l.title || 'this item')}</span>'s real
      <span class="pace-result-figure">${formatUsd(price)}</span> asking price costs
      <span class="pace-result-figure">${formatUsd(adFee)}</span>, only if this exact listing sells within eBay's
      30-day attribution window after a promoted click, taking net payout from
      <span class="pace-result-figure">${formatUsd(organicNet)}</span> organic down to
      <span class="pace-result-figure">${formatUsd(promotedNet)}</span> promoted.
    </p>`;
}

function wirePromotedCalc() {
  document.getElementById('promotedRateInput').addEventListener('input', renderPromotedCalc);
  renderPromotedItemChips([]);
}

// Offer response guide: applies a real, documented counteroffer-ladder
// framework (accept near-target, counter once on good-but-low, let a
// borderline offer's answer depend on real listing age, decline a deep
// lowball outright) to a real logged asking price. Reuses daysSincePublished
// and RELIST_FRESH_DAYS from the relist guidance above rather than a second
// staleness threshold, and estimateNetPayout/costBasis from the payout table
// so the cost-basis check here can't drift from either.
let offerItemId = 'custom';
let offerPlatform = null;

function offerGuideSelectedListing() {
  return offerItemId !== 'custom' ? listings.find(l => l.id === offerItemId) || null : null;
}

function offerGuideAskingPrice() {
  const l = offerGuideSelectedListing();
  if (l) return l.price;
  const raw = document.getElementById('offerCustomPriceInput').value.trim();
  return raw === '' ? null : Number(raw);
}

function renderOfferPlatformChips(available) {
  const container = document.getElementById('offerPlatformChips');
  container.innerHTML = available.map(p => `
    <button type="button" class="chip" data-offer-platform="${escapeHtml(p)}" aria-pressed="${p === offerPlatform}">${escapeHtml(PLATFORM_LABELS[p] || p)}</button>
  `).join('');
  container.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      offerPlatform = chip.getAttribute('data-offer-platform');
      container.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', String(c === chip)));
      renderOfferGuide();
    });
  });
}

function onOfferItemChange() {
  document.getElementById('offerItemChips').querySelectorAll('.chip').forEach(c => {
    c.setAttribute('aria-pressed', String(c.getAttribute('data-offer-item') === offerItemId));
  });
  document.getElementById('offerCustomPriceWrap').hidden = offerItemId !== 'custom';
  const l = offerGuideSelectedListing();
  const available = l ? remainingPlatforms(l) : PAYOUT_PLATFORMS;
  if (!offerPlatform || !available.includes(offerPlatform)) {
    offerPlatform = available[0] || null;
  }
  renderOfferPlatformChips(available);
  renderOfferGuide();
}

function renderOfferItemChips(currentListings) {
  const container = document.getElementById('offerItemChips');
  const live = currentListings.filter(l => l.status === 'live');
  if (offerItemId !== 'custom' && !live.some(l => l.id === offerItemId)) offerItemId = 'custom';
  container.innerHTML = [
    `<button type="button" class="chip" data-offer-item="custom" aria-pressed="${offerItemId === 'custom'}">Custom price</button>`,
    ...live.map(l => `<button type="button" class="chip" data-offer-item="${escapeHtml(l.id)}" aria-pressed="${offerItemId === l.id}">${escapeHtml(l.title || 'Untitled item')}</button>`)
  ].join('');
  container.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      offerItemId = chip.getAttribute('data-offer-item');
      onOfferItemChange();
    });
  });
  onOfferItemChange();
}

// A copy-paste reply matching the ladder verdict above, same "Copy" pattern
// as the buyer message templates below: the guide already computes the
// right counter number, this is the last step from "what to do" to an
// actual message sent, so a real offer doesn't still need composing from
// scratch once the math's done.
function offerReplyText(tier, itemTitle, offer, counterAmount) {
  const item = itemTitle || 'this item';
  const offerFmt = formatUsd(offer);
  if (tier === 'accept') {
    return `Thanks for the offer on ${item}! ${offerFmt} works for me, go ahead and send it through and I'll get it packed up.`;
  }
  if (tier === 'decline') {
    return `Thanks for the offer on ${item}, I appreciate it, but ${offerFmt} is a bit further off than I can go on this one.`;
  }
  const counterFmt = formatUsd(counterAmount);
  return `Thanks for the offer on ${item}! I can't quite do ${offerFmt}, but I could do ${counterFmt} if that works for you?`;
}

function renderOfferGuide() {
  const result = document.getElementById('offerResult');
  const asking = offerGuideAskingPrice();
  const l = offerGuideSelectedListing();

  if (asking == null || Number.isNaN(asking) || asking <= 0) {
    result.innerHTML = `<p class="pace-result-note">${
      l ? 'This item has no asking price logged yet.' : 'Enter an asking price above to evaluate an offer against it.'
    }</p>`;
    return;
  }
  if (!offerPlatform) {
    result.innerHTML = '<p class="pace-result-note">No platform available to evaluate an offer against.</p>';
    return;
  }
  const offerRaw = document.getElementById('offerAmountInput').value.trim();
  const offer = offerRaw === '' ? null : Number(offerRaw);
  if (offer == null || Number.isNaN(offer) || offer < 0) {
    result.innerHTML = '<p class="pace-result-note">Enter the real offer amount received to see where it falls on the ladder.</p>';
    return;
  }

  const pct = offer / asking;
  const pctLabel = Math.round(pct * 100) + '%';
  const tier = offerTier(pct);
  const days = l ? daysSincePublished(l.datePublished) : null;

  let tierLabel, badgeClass, actionText, counterAmount = null;
  if (tier === 'accept') {
    tierLabel = 'Accept'; badgeClass = 'badge-fresh';
    actionText = `At ${pctLabel} of asking, this is close enough to target, common ladder guidance is to accept rather than risk losing the sale over a small gap.`;
  } else if (tier === 'counter') {
    tierLabel = 'Counter once'; badgeClass = 'badge-due';
    counterAmount = Math.round(offerCounterAmount(tier, offer, asking, days));
    actionText = `At ${pctLabel} of asking, counter once rather than accept or decline outright, common ladder guidance splits the gap between the offer and asking.`;
  } else if (tier === 'borderline') {
    tierLabel = 'Borderline, use listing age'; badgeClass = 'badge-hold';
    counterAmount = Math.round(offerCounterAmount(tier, offer, asking, days));
    if (days != null && days >= RELIST_FRESH_DAYS) {
      actionText = `At ${pctLabel} of asking and ${days} day(s) listed, past the ${RELIST_FRESH_DAYS}-day fresh window, common guidance leans toward accepting or countering close to their number, a stale listing has more to gain from finally moving than from holding the line.`;
    } else {
      actionText = days != null
        ? `At ${pctLabel} of asking and only ${days} day(s) listed, inside the ${RELIST_FRESH_DAYS}-day fresh window, common guidance is to counter firmly, closer to asking, since there's little pressure yet to move it.`
        : `At ${pctLabel} of asking with no listing date logged, defaulting to a firmer counter as if this were a fresh listing.`;
    }
  } else {
    tierLabel = 'Decline'; badgeClass = 'badge-decline';
    actionText = `At ${pctLabel} of asking, this is a deep lowball by ladder guidance, common practice is to decline without countering rather than anchor the negotiation that low.`;
  }

  const rows = [];
  rows.push(fieldRow('Offer vs. asking', `${formatUsd(offer)} is ${pctLabel} of ${formatUsd(asking)}`));
  rows.push(`<div class="field-row"><div class="field-label font-mono">Tier</div><div class="field-value"><span class="badge ${badgeClass}">${escapeHtml(tierLabel)}</span></div></div>`);
  rows.push(fieldRow('Suggested action', escapeHtml(actionText)));
  if (counterAmount != null) rows.push(fieldRow('Suggested counter', formatUsd(counterAmount)));

  const replyText = offerReplyText(tier, l && l.title, offer, counterAmount);
  rows.push(`
    <div class="field-row">
      <div class="field-label font-mono">Suggested reply</div>
      <div class="field-value">
        <p class="offer-reply-text">${escapeHtml(replyText)}</p>
        <button type="button" class="print-btn font-mono offer-reply-copy" data-reply="${escapeHtml(replyText)}">Copy reply</button>
      </div>
    </div>
  `);

  if (l && l.costBasis != null) {
    const checkAmount = counterAmount != null ? counterAmount : offer;
    const net = estimateNetPayout(offerPlatform, checkAmount, l.category);
    if (net != null) {
      const margin = net - l.costBasis;
      const label = (counterAmount != null ? 'Counter' : 'Offer') + ' vs. cost basis';
      rows.push(fieldRow(label, margin < 0
        ? `Would net about ${formatUsd(net)} after estimated ${escapeHtml(PLATFORM_LABELS[offerPlatform] || offerPlatform)} fees, below the logged ${formatUsd(l.costBasis)} cost basis by ${formatUsd(Math.abs(margin))}.`
        : `Would net about ${formatUsd(net)} after estimated ${escapeHtml(PLATFORM_LABELS[offerPlatform] || offerPlatform)} fees, about ${formatUsd(margin)} over the logged ${formatUsd(l.costBasis)} cost basis.`
      ));
    }
  }

  result.innerHTML = rows.join('');
}

function wireOfferGuide() {
  document.getElementById('offerCustomPriceInput').addEventListener('input', renderOfferGuide);
  document.getElementById('offerAmountInput').addEventListener('input', renderOfferGuide);
  renderOfferItemChips([]);
  document.getElementById('offerResult').addEventListener('click', e => {
    const btn = e.target.closest('.offer-reply-copy');
    if (!btn) return;
    const original = btn.textContent;
    copyText(btn.getAttribute('data-reply'))
      .then(() => { btn.textContent = 'Copied'; })
      .catch(() => { btn.textContent = "Couldn't copy"; })
      .finally(() => { setTimeout(() => { btn.textContent = original; }, 1800); });
  });
}

// Buyer message templates: canned replies for the handful of buyer
// questions that repeat across every platform (availability, bundling,
// price firmness, condition, shipping status), a documented reseller
// time-saver. Copy-only, nothing here sends a real message.
const MESSAGE_TEMPLATES = [
  {
    id: 'availability',
    label: 'Is this still available?',
    text: 'Hi! Yes, {item} is still available and ready to ship. Let me know if you have any other questions!'
  },
  {
    id: 'bundle',
    label: 'Bundle / combined shipping request',
    text: "Thanks for asking! I'm happy to combine shipping on a bundle. Send over the other listing(s) you're interested in and I'll work out a combined price for {item} plus those before you check out."
  },
  {
    id: 'firm-price',
    label: '"Would you take less?" question',
    text: "I appreciate the interest! {price} is where I have {item} priced for now. Feel free to send an actual offer through the platform's offer button and I'll take a look."
  },
  {
    id: 'condition',
    label: 'Condition / measurements question',
    text: "Good question, {item} is described as accurately as I can in the listing. Let me know exactly which measurement or detail you're checking and I'll get you a real number rather than guessing."
  },
  {
    id: 'shipping-status',
    label: 'Shipping / handling time question',
    text: "{item} ships within my normal handling time listed on the platform. Once it's out I'll upload real tracking so you can follow it the rest of the way."
  },
  {
    id: 'shipped',
    label: 'Item shipped notification',
    text: "Good news, {item} is on its way! Tracking is uploaded to the order, let me know once it arrives safely."
  },
  {
    id: 'post-sale-review',
    label: 'Post-sale thank-you / review request',
    text: "Thanks so much for grabbing {item}! I hope it's exactly what you were looking for. If anything's off, message me first and I'll make it right, and if you're happy with it, a review goes a long way for a small seller like me."
  }
];

let templateItemId = 'custom';

function templateGuideSelectedListing() {
  return templateItemId !== 'custom' ? listings.find(l => l.id === templateItemId) || null : null;
}

function fillTemplate(text) {
  const l = templateGuideSelectedListing();
  const item = l && l.title ? l.title : '[item]';
  const price = l && l.price != null ? formatUsd(l.price) : '[price]';
  return text.replace(/\{item\}/g, item).replace(/\{price\}/g, price);
}

function renderTemplateGrid() {
  const grid = document.getElementById('templateGrid');
  grid.innerHTML = MESSAGE_TEMPLATES.map(t => `
    <div class="template-card">
      <span class="template-card-label">${escapeHtml(t.label)}</span>
      <p class="template-card-text">${escapeHtml(fillTemplate(t.text))}</p>
      <button type="button" class="print-btn font-mono template-card-copy" data-template-id="${escapeHtml(t.id)}">Copy</button>
    </div>
  `).join('');
}

function onTemplateItemChange() {
  document.getElementById('templateItemChips').querySelectorAll('.chip').forEach(c => {
    c.setAttribute('aria-pressed', String(c.getAttribute('data-template-item') === templateItemId));
  });
  renderTemplateGrid();
}

function renderTemplateItemChips(currentListings) {
  const container = document.getElementById('templateItemChips');
  const live = currentListings.filter(l => l.status === 'live');
  if (templateItemId !== 'custom' && !live.some(l => l.id === templateItemId)) templateItemId = 'custom';
  container.innerHTML = [
    `<button type="button" class="chip" data-template-item="custom" aria-pressed="${templateItemId === 'custom'}">Custom</button>`,
    ...live.map(l => `<button type="button" class="chip" data-template-item="${escapeHtml(l.id)}" aria-pressed="${templateItemId === l.id}">${escapeHtml(l.title || 'Untitled item')}</button>`)
  ].join('');
  container.querySelectorAll('.chip').forEach(chip => chip.addEventListener('click', () => {
    templateItemId = chip.getAttribute('data-template-item');
    onTemplateItemChange();
  }));
  onTemplateItemChange();
}

function wireMessageTemplates() {
  renderTemplateItemChips([]);
  document.getElementById('templateGrid').addEventListener('click', e => {
    const btn = e.target.closest('.template-card-copy');
    if (!btn) return;
    const t = MESSAGE_TEMPLATES.find(m => m.id === btn.getAttribute('data-template-id'));
    if (!t) return;
    const original = btn.textContent;
    copyText(fillTemplate(t.text))
      .then(() => { btn.textContent = 'Copied'; })
      .catch(() => { btn.textContent = "Couldn't copy"; })
      .finally(() => { setTimeout(() => { btn.textContent = original; }, 1800); });
  });
}

function renderActivity(events) {
  const list = document.getElementById('activityList');
  if (!events.length) {
    list.innerHTML = '<div class="activity-item"><div class="activity-item-detail">No fixes or audits logged yet.</div></div>';
    return;
  }
  list.innerHTML = events.map(e => `
    <div class="activity-item">
      <div class="activity-item-head">
        <span class="activity-item-title">${escapeHtml(e.title || 'Untitled event')}</span>
        <span class="badge badge-${escapeHtml(e.type || 'other')}">${escapeHtml(EVENT_TYPE_LABELS[e.type] || e.type || 'other')}</span>
        ${e.platform ? `<span class="badge badge-${escapeHtml(e.platform)}">${escapeHtml(PLATFORM_LABELS[e.platform] || e.platform)}</span>` : ''}
      </div>
      <div class="activity-item-detail">${escapeHtml(e.detail || '')}</div>
      <div class="activity-item-meta">${e.itemsReviewed != null ? e.itemsReviewed + ' item(s) reviewed' : ''}${e.itemsReviewed != null && e.issuesFound != null ? ' &middot; ' : ''}${e.issuesFound != null ? e.issuesFound + ' issue(s) found' : ''}${e.date ? ' &middot; ' + escapeHtml(e.date) : ''}</div>
    </div>
  `).join('');
}

// Sale rows are sorted most-recent-first when a date is logged; undated
// sales (date not tracked yet) sort to the bottom rather than being treated
// as oldest, since an unknown date isn't the same real information as an
// old one.
function renderSales(sales) {
  const tbody = document.getElementById('salesTableBody');
  const empty = document.getElementById('salesTableEmpty');
  const totalsEl = document.getElementById('salesTotals');

  if (!sales.length) {
    tbody.innerHTML = '';
    empty.hidden = false;
    empty.textContent = 'No sales logged yet.';
    totalsEl.innerHTML = '';
    return;
  }
  empty.hidden = true;

  const sorted = [...sales].sort((a, b) => {
    if (!a.saleDate && !b.saleDate) return 0;
    if (!a.saleDate) return 1;
    if (!b.saleDate) return -1;
    return b.saleDate.localeCompare(a.saleDate);
  });

  // Tallied in the same pass as each row's own net/profit math (never
  // recomputed separately, so the totals below can't drift from what the
  // table itself shows), grouped by platform since nothing else on this page
  // shows which platform is actually the profitable one, only aggregate
  // realized-revenue/profit stat tiles at the top of the page.
  const byPlatform = {};

  tbody.innerHTML = sorted.map(s => {
    const net = estimateNetPayout(s.platform, s.salePrice, categoryForListingId(s.listingId));
    const hasEither = s.costBasis != null || s.shippingCost != null;
    const profit = net != null && hasEither ? net - (s.costBasis || 0) - (s.shippingCost || 0) : null;
    const askingPct = computeAskingPct(s);

    const platformKey = s.platform || 'unknown';
    if (!byPlatform[platformKey]) byPlatform[platformKey] = { revenue: 0, count: 0, profit: 0, profitCount: 0 };
    byPlatform[platformKey].count++;
    byPlatform[platformKey].revenue += s.salePrice || 0;
    if (profit != null) {
      byPlatform[platformKey].profit += profit;
      byPlatform[platformKey].profitCount++;
    }

    return `
    <tr>
      <td><div class="cell-card-name">${escapeHtml(s.title || 'Untitled item')}</div></td>
      <td class="cell-platforms">${s.platform ? `<span class="badge badge-${escapeHtml(s.platform)}">${escapeHtml(PLATFORM_LABELS[s.platform] || s.platform)}</span>` : ''}</td>
      <td class="cell-value${s.salePrice == null ? ' empty' : ''}">${s.salePrice != null ? formatUsd(s.salePrice) : 'not set'}</td>
      <td class="cell-value${askingPct == null ? ' empty' : ''}">${askingPct != null ? askingPct.toFixed(0) + '% of ' + formatUsd(s.askingPrice) : 'not tracked'}</td>
      <td class="cell-value${net == null ? ' empty' : ''}">${net != null ? formatUsd(net) : 'unknown'}</td>
      <td class="cell-value${s.costBasis == null ? ' empty' : ''}">${s.costBasis != null ? formatUsd(s.costBasis) : 'not logged'}</td>
      <td class="cell-value${s.shippingCost == null ? ' empty' : ''}">${s.shippingCost != null ? formatUsd(s.shippingCost) : 'not logged'}</td>
      <td class="cell-value${profit == null ? ' empty' : (profit < 0 ? ' cell-value-loss' : '')}">${profit != null ? formatUsd(profit) : 'not logged'}</td>
      <td class="cell-muted">${s.saleDate ? escapeHtml(s.saleDate) : '<span class="cell-value empty">not logged</span>'}</td>
    </tr>
  `;
  }).join('');

  const totalRevenue = sales.reduce((sum, s) => sum + (s.salePrice || 0), 0);
  const profitTrackedCount = Object.values(byPlatform).reduce((sum, b) => sum + b.profitCount, 0);
  const totalProfit = Object.values(byPlatform).reduce((sum, b) => sum + b.profit, 0);

  // Sorted by revenue so the biggest platform leads, same convention as
  // renderExpenses' by-category breakdown below its own table.
  const platformParts = Object.keys(byPlatform)
    .sort((a, b) => byPlatform[b].revenue - byPlatform[a].revenue)
    .map(p => {
      const bucket = byPlatform[p];
      const label = PLATFORM_LABELS[p] || p;
      const profitText = bucket.profitCount === bucket.count ? formatUsd(bucket.profit) + ' profit'
        : bucket.profitCount ? formatUsd(bucket.profit) + ` profit (${bucket.profitCount}/${bucket.count} tracked)`
        : 'profit not tracked';
      return `${label}: ${formatUsd(bucket.revenue)} revenue, ${profitText}`;
    })
    .join('; ');

  totalsEl.innerHTML = `
    <p class="pace-result-note">
      <span class="pace-result-figure">${formatUsd(totalRevenue)}</span> total realized revenue across
      ${sales.length} real logged sale(s)${platformParts ? ', by platform: ' + escapeHtml(platformParts) : ''}.
      ${profitTrackedCount ? `${formatUsd(totalProfit)} total profit across the ${profitTrackedCount}/${sales.length} sale(s) with cost data logged.` : 'No sale has a cost basis or shipping cost logged yet, so profit by platform is not tracked.'}
    </p>`;
}

// What the real sale price came out to as a percent of the asking price
// logged at time of sale, e.g. "85% of $40 asking". Both fields are optional
// and only meaningful together (askingPrice is validated by validate.js and
// exported to CSV, but was never rendered anywhere on this page), so this
// returns null unless both are real numbers and askingPrice is a real
// positive baseline to divide by. Not colored as a loss below 100%: selling
// under the original ask is the normal outcome of negotiating down, not a
// problem the way negative profit is.
function computeAskingPct(s) {
  if (s.askingPrice == null || s.salePrice == null || !(s.askingPrice > 0)) return null;
  return (s.salePrice / s.askingPrice) * 100;
}

const TAX_1099K_USD_THRESHOLD = 20000;
const TAX_1099K_TXN_THRESHOLD = 200;

// Federal 1099-K threshold as of the 2026 tax year: more than $20,000 in
// gross payments AND more than 200 transactions, per platform, restored
// permanently by the One Big Beautiful Bill Act (July 2025), no sunset date.
// Only real sales.json rows count here, current calendar year only, since
// the threshold resets each January and an undated or prior-year sale can't
// honestly be attributed to "this year's" total.
function renderTaxTracker(sales) {
  const tbody = document.getElementById('taxTrackerBody');
  const note = document.getElementById('taxTrackerNote');
  const year = new Date().getFullYear();
  document.getElementById('taxTrackerYear').textContent = String(year);

  const undated = sales.filter(s => !s.saleDate);
  const thisYear = sales.filter(s => s.saleDate && Number(s.saleDate.slice(0, 4)) === year);
  // A sale with no platform, or one validate.js would already reject as
  // unrecognized, still lands here on a hand-edit typo since that check only
  // runs when someone remembers to run `npm run validate`. Track these
  // separately rather than tallying them into byPlatform under an
  // untracked key, where they would silently never reach the table below
  // (it only ever renders PAYOUT_PLATFORMS rows), same "never drop real
  // data without saying so" rule the undated-sale note above already
  // follows, and this table specifically feeds 1099-K threshold tracking.
  const unrecognizedPlatform = thisYear.filter(s => !PAYOUT_PLATFORMS.includes(s.platform));

  const byPlatform = {};
  PAYOUT_PLATFORMS.forEach(p => { byPlatform[p] = { gross: 0, count: 0 }; });
  thisYear.forEach(s => {
    if (!PAYOUT_PLATFORMS.includes(s.platform)) return;
    byPlatform[s.platform].gross += s.salePrice || 0;
    byPlatform[s.platform].count += 1;
  });

  tbody.innerHTML = PAYOUT_PLATFORMS.map(p => {
    const d = byPlatform[p];
    const grossPct = Math.min(100, (d.gross / TAX_1099K_USD_THRESHOLD) * 100);
    const txnPct = Math.min(100, (d.count / TAX_1099K_TXN_THRESHOLD) * 100);
    const met = d.gross > TAX_1099K_USD_THRESHOLD && d.count > TAX_1099K_TXN_THRESHOLD;
    return `
    <tr>
      <td><span class="badge badge-${escapeHtml(p)}">${escapeHtml(PLATFORM_LABELS[p] || p)}</span></td>
      <td class="cell-value">${formatUsd(d.gross)} <span class="cell-muted">/ ${formatUsd(TAX_1099K_USD_THRESHOLD)}</span></td>
      <td>
        <div class="tax-progress-row">
          <div class="tax-progress-track"><div class="tax-progress-fill" style="width:${grossPct}%"></div></div>
          <span class="tax-progress-pct font-mono">${grossPct.toFixed(0)}%</span>
        </div>
      </td>
      <td class="cell-value">${d.count} <span class="cell-muted">/ ${TAX_1099K_TXN_THRESHOLD}</span></td>
      <td>
        <div class="tax-progress-row">
          <div class="tax-progress-track"><div class="tax-progress-fill" style="width:${txnPct}%"></div></div>
          <span class="tax-progress-pct font-mono">${txnPct.toFixed(0)}%</span>
        </div>
      </td>
      <td class="${met ? 'tax-status-met' : 'cell-muted'}">${met ? 'Meets both, expect a 1099-K' : 'Below threshold'}</td>
    </tr>`;
  }).join('');

  const noteParts = [];
  if (undated.length) {
    noteParts.push(`${undated.length} sale(s) in sales.json have no saleDate logged and aren't counted toward the ${year} totals above until dated.`);
  }
  if (unrecognizedPlatform.length) {
    noteParts.push(`${unrecognizedPlatform.length} sale(s) dated in ${year} have a missing or unrecognized "platform" and aren't counted toward any row above until fixed, run \`npm run validate\` to find them.`);
  }
  note.hidden = noteParts.length === 0;
  note.textContent = noteParts.join(' ');
}

// Turns the eBay and Depop rows of the "Seller status & standards" reference
// table from static text into a real progress readout, computed from actual
// sales.json/disputes.json rows via ebayTrsProgress/depopTopSellerProgress in
// garage-core.js. Vinted and Poshmark's tiers key off a star rating and
// review count this dashboard has no data source for, so those two rows stay
// plain reference text (see the static markup in index.html) rather than
// getting a fabricated number here.
function renderSellerStandardsProgress(sales, disputes) {
  const today = todayDateStr();
  const ebay = ebayTrsProgress(sales, disputes, today);
  const depop = depopTopSellerProgress(sales, disputes, today);

  const progressBar = (value, target) => {
    const pct = Math.min(100, (value / target) * 100);
    return `<div class="tax-progress-row"><div class="tax-progress-track"><div class="tax-progress-fill" ` +
      `style="width:${pct}%"></div></div><span class="tax-progress-pct font-mono">${pct.toFixed(0)}%</span></div>`;
  };
  const rateText = rate => rate == null ? 'no sales yet' : (rate * 100).toFixed(1) + '%';

  document.getElementById('ebayTrsProgressCell').innerHTML =
    `<div class="cell-value">${ebay.transactions} <span class="cell-muted">/ ${ebay.transactionsTarget} txns</span></div>` +
    progressBar(ebay.transactions, ebay.transactionsTarget) +
    `<div class="cell-value">${formatUsd(ebay.grossSales)} <span class="cell-muted">/ ${formatUsd(ebay.grossSalesTarget)}</span></div>` +
    progressBar(ebay.grossSales, ebay.grossSalesTarget) +
    `<div class="cell-muted">Cases resolved against seller: ${rateText(ebay.nonSellerResolvedRate)} (target &le;0.3%), ` +
    `trailing ${ebay.windowDays} days. Defect rate and late-shipment rate aren't computed here, this dashboard ` +
    `doesn't log per-order ship timestamps.</div>`;

  document.getElementById('depopTopSellerProgressCell').innerHTML =
    `<div class="cell-value">${formatUsd(depop.grossSales)} <span class="cell-muted">/ ${formatUsd(depop.grossSalesTarget)}</span></div>` +
    progressBar(depop.grossSales, depop.grossSalesTarget) +
    `<div class="cell-muted">Refund rate: ${rateText(depop.nonSellerResolvedRate)} (target &lt;5%), rolling ` +
    `${depop.windowDays} days. On-time-shipping rate isn't computed here, same reason as eBay's.</div>`;
}

// Expenses are sorted most-recent-first when a date is logged, undated
// entries sort to the bottom, same convention renderSales already uses.
function renderExpenses(expenses) {
  const tbody = document.getElementById('expensesTableBody');
  const empty = document.getElementById('expensesTableEmpty');
  const totalsEl = document.getElementById('expensesTotals');

  if (!expenses.length) {
    tbody.innerHTML = '';
    empty.hidden = false;
    empty.textContent = 'No business expenses logged yet.';
    totalsEl.innerHTML = '';
    return;
  }
  empty.hidden = true;

  const sorted = [...expenses].sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return b.date.localeCompare(a.date);
  });

  tbody.innerHTML = sorted.map(e => {
    const amount = computeExpenseAmount(e);
    const isComputedMileage = e.amount == null && e.category === 'mileage' && amount != null;
    const rate = isComputedMileage ? irsMileageRateForDate(e.date) : null;
    const gapReason = amount == null ? mileageRateGapReason(e) : null;
    const amountTitle = isComputedMileage
      ? `Computed at the real IRS rate of ${(rate * 100).toFixed(1)}&cent;/mile for this date`
      : (gapReason ? escapeHtml(gapReason) : '');
    const amountText = amount != null
      ? formatUsd(amount) + (isComputedMileage ? ' <span class="cell-muted">(mileage)</span>' : '')
      : (gapReason ? 'no rate for this date' : 'not logged');
    return `
    <tr>
      <td><div class="cell-card-name">${escapeHtml(e.description || 'Untitled expense')}</div></td>
      <td>${e.category ? `<span class="badge">${escapeHtml(EXPENSE_CATEGORY_LABELS[e.category] || e.category)}</span>` : ''}</td>
      <td class="cell-value${e.miles == null ? ' empty' : ''}">${e.miles != null ? e.miles : ''}</td>
      <td class="cell-value${amount == null ? ' empty' : ''}" title="${amountTitle}">${amountText}</td>
      <td class="cell-muted">${e.date ? escapeHtml(e.date) : '<span class="cell-value empty">not logged</span>'}</td>
    </tr>
  `;
  }).join('');

  const computed = expenses.map(e => ({ e, amount: computeExpenseAmount(e) }));
  const uncounted = computed.filter(c => c.amount == null).length;
  const rateTableGaps = computed.filter(c => c.amount == null && mileageRateGapReason(c.e)).length;
  const byCategory = {};
  computed.forEach(({ e, amount }) => {
    if (amount == null) return;
    const cat = e.category || 'other';
    byCategory[cat] = (byCategory[cat] || 0) + amount;
  });
  const total = Object.values(byCategory).reduce((s, v) => s + v, 0);
  const categoryParts = Object.keys(byCategory)
    .map(cat => `${EXPENSE_CATEGORY_LABELS[cat] || cat}: ${formatUsd(byCategory[cat])}`)
    .join(', ');

  totalsEl.innerHTML = `
    <p class="pace-result-note">
      <span class="pace-result-figure">${formatUsd(total)}</span> total real expenses logged${categoryParts ? ' (' + escapeHtml(categoryParts) + ')' : ''}.
      ${uncounted ? `${uncounted} expense(s) not counted yet, missing a real amount or a usable mileage rate${rateTableGaps ? ` (${rateTableGaps} of them because this tool's mileage rate table itself needs a newer year added, not a logging gap)` : ''}.` : ''}
    </p>`;
}

function renderDisputes(disputes) {
  const tbody = document.getElementById('disputesTableBody');
  const empty = document.getElementById('disputesTableEmpty');
  const totalsEl = document.getElementById('disputesTotals');

  if (!disputes.length) {
    tbody.innerHTML = '';
    empty.hidden = false;
    empty.textContent = 'No returns or disputes logged yet.';
    totalsEl.innerHTML = '';
    return;
  }
  empty.hidden = true;

  const sorted = [...disputes].sort((a, b) => {
    if (!a.openedDate && !b.openedDate) return 0;
    if (!a.openedDate) return 1;
    if (!b.openedDate) return -1;
    return b.openedDate.localeCompare(a.openedDate);
  });

  tbody.innerHTML = sorted.map(d => {
    const respondInfo = disputeResponseInfo(d);
    return `
    <tr>
      <td><div class="cell-card-name">${escapeHtml(d.title || 'Untitled item')}</div></td>
      <td>${d.platform ? `<span class="badge badge-${escapeHtml(d.platform)}">${escapeHtml(PLATFORM_LABELS[d.platform] || d.platform)}</span>` : ''}</td>
      <td class="cell-muted">${d.type ? escapeHtml(DISPUTE_TYPE_LABELS[d.type] || d.type) : ''}</td>
      <td class="cell-muted">${d.status ? escapeHtml(DISPUTE_STATUS_LABELS[d.status] || d.status) : ''}</td>
      <td class="cell-muted">${d.openedDate ? escapeHtml(d.openedDate) : '<span class="cell-value empty">not logged</span>'}</td>
      <td>${respondInfo ? `<span class="badge ${respondInfo.badgeClass}">${escapeHtml(respondInfo.text)}</span>` : '<span class="cell-value empty">-</span>'}</td>
      <td class="cell-muted">${d.outcome ? escapeHtml(d.outcome) : '<span class="cell-value empty">not logged</span>'}</td>
    </tr>
  `;
  }).join('');

  const open = disputes.filter(d => d.status === 'open');
  const overdue = open.filter(d => {
    const deadline = disputeResponseDeadline(d);
    return deadline && deadline < todayDateStr();
  });
  const resolved = disputes.length - open.length;

  totalsEl.innerHTML = `
    <p class="pace-result-note">
      <span class="pace-result-figure">${open.length}</span> open, ${resolved} resolved, out of ${disputes.length} real logged case(s).
      ${overdue.length ? `${overdue.length} past its real platform response window, see "Respond by" above.` : ''}
    </p>`;
}

function supplyStatusCell(s) {
  if (s.qtyOnHand == null) return '<span class="cell-value empty">not counted yet</span>';
  if (s.reorderThreshold == null) return '<span class="cell-value empty">no reorder point set</span>';
  return isSupplyLowStock(s)
    ? '<span class="badge badge-due">Low stock, reorder</span>'
    : '<span class="badge badge-fresh">In stock</span>';
}

// Sorted low-stock-first (nulls, i.e. not yet judgeable, sort last) so the
// one thing that actually needs action surfaces at the top of the table
// rather than wherever it happens to sit in supplies.json.
function renderSupplies(supplies) {
  const tbody = document.getElementById('suppliesTableBody');
  const empty = document.getElementById('suppliesTableEmpty');

  if (!supplies.length) {
    tbody.innerHTML = '';
    empty.hidden = false;
    empty.textContent = 'No supplies logged yet.';
    return;
  }
  empty.hidden = true;

  const sorted = [...supplies].sort((a, b) => Number(isSupplyLowStock(b)) - Number(isSupplyLowStock(a)));

  tbody.innerHTML = sorted.map(s => `
    <tr>
      <td><div class="cell-card-name">${escapeHtml(s.name || 'Untitled supply')}</div></td>
      <td class="cell-muted">${s.category ? escapeHtml(SUPPLY_CATEGORY_LABELS[s.category] || s.category) : ''}</td>
      <td class="cell-value${s.qtyOnHand == null ? ' empty' : ''}">${s.qtyOnHand != null ? s.qtyOnHand : 'not logged'}</td>
      <td class="cell-value${s.reorderThreshold == null ? ' empty' : ''}">${s.reorderThreshold != null ? s.reorderThreshold : 'not set'}</td>
      <td>${supplyStatusCell(s)}</td>
      <td class="cell-muted">${s.lastRestocked ? escapeHtml(s.lastRestocked) : '<span class="cell-value empty">not logged</span>'}</td>
      <td class="cell-muted">${s.notes ? escapeHtml(s.notes) : ''}</td>
    </tr>
  `).join('');
}

// Needs both real numbers together, same "can't compute from half the
// inputs" rule validate.js already enforces for this pair.
function acquisitionPerItemCost(a) {
  if (a.pricePaid == null || !a.itemCount) return null;
  return a.pricePaid / a.itemCount;
}

// Real reseller-tooling pattern (per-item cost of goods, sourcing-channel
// ROI): distinct from a listing's own costBasis, which is the allocated
// cost of one item once it's split out of a lot, this is the real purchase
// event that produced it, one row can be a single item or a whole trip that
// yielded several. "Revenue realized" only ever counts a sale actually
// logged in sales.json for one of this acquisition's linked listingIds,
// never a live asking price, so a channel's real payoff can't be
// overstated before anything has actually sold from it yet.
function renderAcquisitions(acquisitions, currentListings, sales) {
  const tbody = document.getElementById('acquisitionsTableBody');
  const empty = document.getElementById('acquisitionsTableEmpty');
  const totalsEl = document.getElementById('acquisitionsTotals');
  sales = sales || [];

  if (!acquisitions.length) {
    tbody.innerHTML = '';
    empty.hidden = false;
    empty.textContent = 'No sourcing/acquisitions logged yet.';
    totalsEl.innerHTML = '';
    return;
  }
  empty.hidden = true;

  const sorted = [...acquisitions].sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return b.date.localeCompare(a.date);
  });

  tbody.innerHTML = sorted.map(a => {
    const perItem = acquisitionPerItemCost(a);
    const listingIds = a.listingIds || [];
    const linkedHtml = listingIds.length
      ? listingIds.map(id => {
          const l = currentListings.find(x => x.id === id);
          const label = l ? (l.title || id) : id + ' (not itemized yet)';
          return `<button type="button" class="badge badge-link badge-button" data-listing-id="${escapeHtml(id)}">${escapeHtml(label)}</button>`;
        }).join(' ')
      : '<span class="cell-value empty">not itemized yet</span>';
    return `
    <tr>
      <td>
        <div class="cell-card-name">${escapeHtml(ACQUISITION_SOURCE_LABELS[a.source] || a.source || 'Unknown source')}</div>
        ${a.sourceName ? `<div class="cell-muted">${escapeHtml(a.sourceName)}</div>` : ''}
      </td>
      <td class="cell-muted">${a.date ? escapeHtml(a.date) : '<span class="cell-value empty">not logged</span>'}</td>
      <td class="cell-value${a.pricePaid == null ? ' empty' : ''}">${a.pricePaid != null ? formatUsd(a.pricePaid) : 'not logged'}</td>
      <td class="cell-value${a.itemCount == null ? ' empty' : ''}">${a.itemCount != null ? a.itemCount : 'not logged'}</td>
      <td class="cell-value${perItem == null ? ' empty' : ''}">${perItem != null ? formatUsd(perItem) : 'needs paid + count'}</td>
      <td class="cell-platforms">${linkedHtml}</td>
      <td class="cell-muted">${a.notes ? escapeHtml(a.notes) : ''}</td>
    </tr>
  `;
  }).join('');

  tbody.querySelectorAll('[data-listing-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (currentListings.some(l => l.id === btn.dataset.listingId)) openModal(btn.dataset.listingId);
    });
  });

  const bySource = {};
  acquisitions.forEach(a => {
    const key = a.source || 'other';
    if (!bySource[key]) bySource[key] = { spend: 0, revenue: 0 };
    bySource[key].spend += a.pricePaid || 0;
  });
  // One pass over sales, not one pass per acquisition: a listing fed by more
  // than one acquisition record (re-sourced after damage, same real case
  // suggestedCostBasisFromAcquisitions above already documents) used to have
  // its sale revenue added once per acquisition that links it, inflating
  // realized revenue by however many times that listing id was re-logged.
  // Same "first acquisition that links this listing wins" rule as cost basis
  // above, so a sale's revenue and a listing's cost basis always agree on
  // which channel gets credit.
  //
  // Built once as a listingId -> owner acquisition lookup rather than an
  // acquisitions.find() per sale (same O(sales x acquisitions) shape the CGT
  // 13x-rebuild and photo-audit-grid perf fixes already caught elsewhere in
  // this codebase, harmless at today's small log size but growing quadratic
  // with real use). Iterated in array order, first acquisition to claim a
  // listingId wins, matching .find()'s own first-match semantics exactly.
  const acquisitionByListingId = new Map();
  acquisitions.forEach(a => {
    (a.listingIds || []).forEach(listingId => {
      if (!acquisitionByListingId.has(listingId)) acquisitionByListingId.set(listingId, a);
    });
  });
  sales.forEach(sale => {
    const owner = acquisitionByListingId.get(sale.listingId);
    if (!owner) return;
    const key = owner.source || 'other';
    bySource[key].revenue += sale.salePrice || 0;
  });
  const totalSpend = acquisitions.reduce((s, a) => s + (a.pricePaid || 0), 0);
  const sourceParts = Object.keys(bySource).map(key => {
    const b = bySource[key];
    const label = ACQUISITION_SOURCE_LABELS[key] || key;
    return `${label}: ${formatUsd(b.spend)} spent${b.revenue ? ', ' + formatUsd(b.revenue) + ' realized so far' : ''}`;
  }).join('; ');

  totalsEl.innerHTML = `
    <p class="pace-result-note">
      <span class="pace-result-figure">${formatUsd(totalSpend)}</span> total real sourcing spend across
      ${acquisitions.length} logged acquisition(s)${sourceParts ? ' (' + escapeHtml(sourceParts) + ')' : ''}.
    </p>`;
}

document.getElementById('searchInput').addEventListener('input', (e) => {
  searchTerm = e.target.value;
  applyFiltersAndRender();
});

// Same "/" jumps to search shortcut as the main Command Center dashboard.
document.addEventListener('keydown', (e) => {
  if (!document.getElementById('modalOverlay').hidden || shortcutsOpen || jumpNavOpen) return;
  if (e.key === '/' && document.activeElement.id !== 'searchInput') {
    e.preventDefault();
    document.getElementById('searchInput').focus();
  }
});

let shortcutsOpen = false;
let shortcutsLastFocusedEl = null;

// Only the shortcuts this page actually wires up, never an invented or
// aspirational one -- same "?" convention as GitHub/Gmail/Linear, and the
// same overlay the main Command Center dashboard, CGT, CSM, and Sondrik
// hubs already added.
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
// typing a "?" character into a real field (the quick-log forms, price
// calculators, and search box all take free text or numbers).
document.addEventListener('keydown', (e) => {
  if (e.key !== '?') return;
  if (!document.getElementById('modalOverlay').hidden || shortcutsOpen || jumpNavOpen) return;
  const active = document.activeElement;
  const tag = active && active.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (active && active.isContentEditable)) return;
  e.preventDefault();
  openShortcuts();
});

// Jump-to-section nav: this page is 25+ real sections long and the header
// isn't sticky, so this is the one way back to a specific section without
// scrolling blind. Built from the real on-page section titles at load
// time, no separate list to keep in sync by hand as sections get added.
let jumpNavOpen = false;
let jumpNavLastFocusedEl = null;

function collectJumpSections() {
  const usedIds = new Set();
  return Array.from(document.querySelectorAll('main > section')).map((section) => {
    if (section.hidden) return null;
    const titleEl = section.querySelector('h2.section-title, summary.section-title');
    const label = titleEl && titleEl.textContent.trim();
    if (!label) return null;
    if (!section.id) {
      let slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'section';
      let candidate = 'jump-' + slug;
      let n = 2;
      while (usedIds.has(candidate) || document.getElementById(candidate)) {
        candidate = 'jump-' + slug + '-' + n;
        n++;
      }
      section.id = candidate;
    }
    usedIds.add(section.id);
    return { id: section.id, label };
  }).filter(Boolean);
}

function renderJumpNavList() {
  const sections = collectJumpSections();
  document.getElementById('jumpNavList').innerHTML = sections.map(s => `
    <a class="jump-nav-link" href="#${s.id}" data-jump-target="${s.id}">${escapeHtml(s.label)}</a>
  `).join('');
}

function getJumpNavFocusable() {
  return Array.from(document.getElementById('jumpNavModal').querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  )).filter(el => !el.hasAttribute('disabled') && el.offsetParent !== null);
}

function openJumpNav() {
  if (jumpNavOpen) return;
  jumpNavOpen = true;
  jumpNavLastFocusedEl = document.activeElement;
  renderJumpNavList();
  document.getElementById('jumpNavOverlay').hidden = false;
  lockBodyScroll();
  document.getElementById('jumpNavClose').focus();
}

function closeJumpNav() {
  if (!jumpNavOpen) return;
  jumpNavOpen = false;
  document.getElementById('jumpNavOverlay').hidden = true;
  unlockBodyScroll();
  if (jumpNavLastFocusedEl && typeof jumpNavLastFocusedEl.focus === 'function') jumpNavLastFocusedEl.focus();
  jumpNavLastFocusedEl = null;
}

document.getElementById('jumpNavBtn').addEventListener('click', openJumpNav);
document.getElementById('jumpNavClose').addEventListener('click', closeJumpNav);
document.getElementById('jumpNavOverlay').addEventListener('click', (e) => {
  if (e.target.id === 'jumpNavOverlay') closeJumpNav();
});
document.getElementById('jumpNavList').addEventListener('click', (e) => {
  const link = e.target.closest('.jump-nav-link');
  if (!link) return;
  e.preventDefault();
  const target = document.getElementById(link.dataset.jumpTarget);
  closeJumpNav();
  if (target) {
    // The scroll-lock release above needs a frame to settle, starting the
    // smooth scroll before that clobbers it.
    requestAnimationFrame(() => target.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }
});

document.addEventListener('keydown', (e) => {
  if (!jumpNavOpen) return;
  if (e.key === 'Escape') {
    closeJumpNav();
    return;
  }
  if (e.key === 'Tab') {
    const focusable = getJumpNavFocusable();
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
setInitialChipState('platformFilter', 'data-platform', activePlatform);
wireChipGroup('platformFilter', 'data-platform', (v) => { activePlatform = v; });

// Resets search and the platform chip back to "All" plus the address bar
// back to the bare /garage/ URL in one action, same "Clear filters" pattern
// as the CGT and main Command Center dashboards.
document.getElementById('clearFiltersBtn').addEventListener('click', () => {
  searchTerm = '';
  activePlatform = 'all';
  document.getElementById('searchInput').value = '';
  setInitialChipState('platformFilter', 'data-platform', activePlatform);
  applyFiltersAndRender();
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

// Platform-reference tables (best time to post, seasonal calendar,
// search/discovery, listing upkeep, markdown guidance, packaging,
// electronics rules, shipping cost, dispute handling) are collapsed by
// default so the actual listings and tools are closer to the top of the
// page. Once a real visitor opens one to check it, re-collapsing it on
// every reload would just make them reopen it again next time, so the
// open/closed state persists per section, same this-browser-only
// localStorage convention as the pace planner's rate above.
const SECTION_OPEN_KEY_PREFIX = 'garage-section-open-';
document.querySelectorAll('.section-details[id]').forEach(details => {
  const key = SECTION_OPEN_KEY_PREFIX + details.id;
  try {
    if (localStorage.getItem(key) === '1') details.open = true;
  } catch (e) { /* localStorage unavailable (private window, blocked storage): stays collapsed */ }
  details.addEventListener('toggle', () => {
    try { localStorage.setItem(key, details.open ? '1' : '0'); } catch (e) { /* see above */ }
  });
});

// A closed <details>'s content sits behind an internal browser slot that a
// plain CSS "display: block !important" on the slotted children can't
// override, so printing whatever was left collapsed has to force each one
// open in JS instead, for both the in-page "Print / export PDF" button and
// a browser/OS print triggered directly. Restored after printing so the
// on-screen state (and its localStorage record above) isn't disturbed by
// having printed.
let printReopenedDetails = null;
window.addEventListener('beforeprint', () => {
  printReopenedDetails = [];
  document.querySelectorAll('.section-details').forEach(d => {
    printReopenedDetails.push([d, d.open]);
    d.open = true;
  });
});
window.addEventListener('afterprint', () => {
  if (!printReopenedDetails) return;
  printReopenedDetails.forEach(([d, wasOpen]) => { d.open = wasOpen; });
  printReopenedDetails = null;
});

const relistIcsBtn = document.getElementById('relistIcsBtn');
const RELIST_ICS_LABEL = relistIcsBtn.textContent;
relistIcsBtn.addEventListener('click', () => {
  const reminders = buildRelistReminders(listings);
  if (!reminders.length) {
    relistIcsBtn.textContent = 'No live items with a publish date logged yet';
    setTimeout(() => { relistIcsBtn.textContent = RELIST_ICS_LABEL; }, 2400);
    return;
  }
  const ics = buildIcsCalendar(reminders);
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'garage-relist-reminders-' + todayDateStr() + '.ics';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  relistIcsBtn.textContent = `Downloaded ${reminders.length} reminder${reminders.length === 1 ? '' : 's'}`;
  setTimeout(() => { relistIcsBtn.textContent = RELIST_ICS_LABEL; }, 2400);
});

// Detail modal: click or Enter/Space a listing row to see the full record
// (all platforms, sold-elsewhere status, per-platform net payout, notes)
// in one place, same pattern and scroll-lock behavior as the CSM and CGT hubs.
let lastFocusedEl = null;
const modalOverlay = document.getElementById('modalOverlay');
const modalClose = document.getElementById('modalClose');

function lockBodyScroll() {
  const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
  if (scrollbarWidth > 0) document.body.style.paddingRight = scrollbarWidth + 'px';
  document.body.style.overflow = 'hidden';
}
function unlockBodyScroll() {
  document.body.style.overflow = '';
  document.body.style.paddingRight = '';
}

function fieldRow(label, valueHtml, empty) {
  return `
    <div class="field-row">
      <div class="field-label font-mono">${escapeHtml(label)}</div>
      <div class="field-value${empty ? ' empty' : ''}">${valueHtml}</div>
    </div>
  `;
}

// eBay's own documented search params: LH_Complete=1 returns every listing
// that ended (sold or not), LH_Sold=1 narrows that to ones that actually
// found a buyer, with the real final sale price shown instead of an asking
// price. Only covers eBay, whose sold-listings search is public; Vinted,
// Poshmark and Depop don't expose an equivalent public "sold" search URL,
// so this deliberately isn't offered for those. eBay's own sold data only
// covers roughly the last 90 days.
function ebaySoldSearchUrl(title) {
  return 'https://www.ebay.com/sch/i.html?_nkw=' + encodeURIComponent(title) + '&LH_Complete=1&LH_Sold=1';
}

function leInputInner(id, label, value, type) {
  type = type || 'text';
  const v = value == null ? '' : escapeHtml(String(value));
  if (type === 'textarea') {
    return '<div><label for="' + id + '">' + escapeHtml(label) + '</label>' +
      '<textarea id="' + id + '" class="np-input" rows="2">' + v + '</textarea></div>';
  }
  return '<div><label for="' + id + '">' + escapeHtml(label) + '</label>' +
    '<input type="' + type + '" id="' + id + '" class="np-input" value="' + v + '"' +
    (type === 'number' ? ' min="0" step="0.01"' : '') + '></div>';
}

function leFieldRow(id, label, value, type) {
  return '<div class="form-row">' + leInputInner(id, label, value, type) + '</div>';
}

function leSelectRow(id, label, value, options) {
  const opts = options.map(([val, text]) =>
    '<option value="' + escapeHtml(val) + '"' + (value === val ? ' selected' : '') + '>' + escapeHtml(text) + '</option>'
  ).join('');
  return '<div class="form-row"><label for="' + id + '">' + escapeHtml(label) + '</label>' +
    '<select id="' + id + '" class="np-input">' + opts + '</select></div>';
}

// Editing an existing listing's own fields previously had no guided path at
// all: the quick-log tool above only builds a brand-new record. Reuses the
// exact same guided-form -> JSON -> copy/paste convention, pre-filled with
// the current values, and outputs the listing's *entire* record so the
// result is a straight find-and-replace of one array entry in
// listings.json, not a fragment to merge by hand. id, soldOn, and
// listingUrls carry over unchanged: soldOn/listingUrls entries reference a
// specific platform, and unchecking that platform from Platforms below
// without also touching those would leave listings.json failing its own
// validator, so this form blocks that combination instead of guessing what
// to do with the orphaned entry.
function listingEditFormHtml(l) {
  return '<details class="schema-help">' +
    '<summary>Edit this listing&rsquo;s details</summary>' +
    '<div class="schema-help-body">' +
    '<p>Generates this listing&rsquo;s full updated record with whatever fields below you change. ' +
    '<code>id</code>, <code>soldOn</code>, and <code>listingUrls</code> carry over unchanged, edit those by hand ' +
    'once a real sale or a live URL exists.</p>' +
    '<div class="np-form">' +
    leFieldRow('leTitle', 'Title', l.title) +
    '<div class="form-row-split">' +
    leInputInner('lePrice', 'Asking price, USD', l.price, 'number') +
    leInputInner('leCostBasis', 'Cost basis, USD', l.costBasis, 'number') +
    '</div>' +
    '<div class="form-row"><label id="lePlatformsLabel">Platforms (at least one)</label>' +
    '<div class="quick-log-checkbox-row" role="group" aria-labelledby="lePlatformsLabel">' +
    ['ebay', 'vinted', 'poshmark', 'depop'].map(p =>
      '<label class="quick-log-checkbox"><input type="checkbox" class="le-platform" value="' + p + '"' +
      ((l.platforms || []).includes(p) ? ' checked' : '') + '> ' + escapeHtml(PLATFORM_LABELS[p]) + '</label>'
    ).join('') +
    '</div></div>' +
    leSelectRow('leStatus', 'Status', l.status, [['draft', 'Draft'], ['ready-to-post', 'Ready to post'], ['live', 'Live'], ['sold', 'Sold']]) +
    leFieldRow('leDatePublished', 'Date published', l.datePublished, 'date') +
    leFieldRow('leLocation', 'Storage location', l.location) +
    leFieldRow('leEbayReturnPolicy', 'eBay return policy (the real policy set on the eBay listing, if any)', l.ebayReturnPolicy) +
    '<div class="form-row-split">' +
    leInputInner('leBrand', 'Brand (eBay/Poshmark/Vinted/Depop search filter)', l.itemSpecifics && l.itemSpecifics.brand) +
    leInputInner('leCondition', 'Condition (eBay/Poshmark/Vinted/Depop search filter)', l.itemSpecifics && l.itemSpecifics.condition) +
    '</div>' +
    '<div class="form-row-split">' +
    leInputInner('leSize', 'Size (shoes only, eBay/Poshmark/Vinted/Depop search filter)', l.itemSpecifics && l.itemSpecifics.size) +
    leInputInner('leColor', 'Color (shoes only, eBay/Poshmark/Vinted/Depop search filter)', l.itemSpecifics && l.itemSpecifics.color) +
    '</div>' +
    leFieldRow('leNotes', 'Notes', l.notes, 'textarea') +
    '</div>' +
    '<button type="button" id="leGenerateBtn" class="print-btn font-mono np-generate-btn">Generate updated JSON</button>' +
    '<div id="leResult" class="np-result" hidden>' +
    '<ul id="leWarnings" class="np-warnings"></ul>' +
    '<div class="np-output-head">' +
    '<span class="field-label" style="margin:0">Replace this listing&rsquo;s whole entry with</span>' +
    '<button type="button" id="leCopyBtn" class="print-btn font-mono" aria-live="polite">Copy JSON</button>' +
    '</div>' +
    '<pre class="np-output font-mono" id="leOutput"></pre>' +
    '</div>' +
    '</div></details>';
}

function leVal(id) {
  const v = document.getElementById(id).value.trim();
  return v === '' ? null : v;
}

// Checks kept in sync with validate.js by hand, same as the quick-log tool
// above (Garage has no shared browser-safe validator module the way CGT
// does).
function wireListingEditForm(l) {
  const generateBtn = document.getElementById('leGenerateBtn');
  if (!generateBtn) return;
  const resultEl = document.getElementById('leResult');
  const warningsEl = document.getElementById('leWarnings');
  const outputEl = document.getElementById('leOutput');
  const copyBtn = document.getElementById('leCopyBtn');

  generateBtn.addEventListener('click', () => {
    const title = leVal('leTitle');
    const price = readOptionalNonNegativeInput(document.getElementById('lePrice'));
    const costBasis = readOptionalNonNegativeInput(document.getElementById('leCostBasis'));
    const platforms = Array.from(document.querySelectorAll('.le-platform:checked')).map(el => el.value);
    const status = document.getElementById('leStatus').value;
    const datePublished = leVal('leDatePublished');
    const location = leVal('leLocation');
    const ebayReturnPolicy = leVal('leEbayReturnPolicy');
    const notes = leVal('leNotes');
    const itemSpecifics = {
      brand: leVal('leBrand'),
      size: leVal('leSize'),
      color: leVal('leColor'),
      condition: leVal('leCondition')
    };

    const blockers = [];
    const advisory = [];

    if (!title) blockers.push('A title is required.');
    if (!platforms.length) blockers.push('Select at least one platform.');
    if (price === undefined) blockers.push('Enter a valid asking price of $0 or more, or leave it blank.');
    if (costBasis === undefined) blockers.push('Enter a valid cost basis of $0 or more, or leave it blank.');

    // soldOn/listingUrls each reference a specific platform; validate.js
    // errors if either holds a platform no longer in this listing's own
    // platforms array, so this blocks the same combination here instead of
    // silently producing a record that fails the next validate.js run.
    const orphanedSoldOn = (l.soldOn || []).filter(p => !platforms.includes(p));
    if (orphanedSoldOn.length) {
      blockers.push('This listing is marked sold on ' + orphanedSoldOn.map(p => PLATFORM_LABELS[p]).join(', ') +
        ' but that platform was unchecked above. Keep it checked, or edit soldOn in listings.json by hand first.');
    }
    const orphanedUrls = Object.keys(l.listingUrls || {}).filter(p => !platforms.includes(p));
    if (orphanedUrls.length) {
      blockers.push('This listing has a logged URL for ' + orphanedUrls.map(p => PLATFORM_LABELS[p]).join(', ') +
        ' but that platform was unchecked above. Keep it checked, or edit listingUrls in listings.json by hand first.');
    }

    if (title && platforms.length) {
      platforms.forEach(p => {
        const limit = TITLE_HARD_LIMITS[p];
        if (limit && title.length > limit) {
          advisory.push('Title is ' + title.length + ' chars, over ' + PLATFORM_LABELS[p] + '\'s ' + limit +
            '-char cap, it will get rejected or truncated there.');
        }
      });
    }
    if (platforms.includes('ebay') && ebayReturnPolicy && GarageValidateCore.isSuspiciousEbayReturnPolicy(ebayReturnPolicy)) {
      advisory.push('"' + ebayReturnPolicy + '" mentions parts/accessories/auto, the same wrong-inherited-template ' +
        'pattern as the real eBay return-policy bug already caught once. Double check the real eBay listing.');
    }
    if (platforms.length) {
      const missingSpecifics = GarageValidateCore.missingItemSpecifics(Object.assign({}, l, { platforms, itemSpecifics }));
      if (missingSpecifics.length) {
        advisory.push('Missing "' + missingSpecifics.join('", "') + '" in item specifics. Each of ' +
          platforms.map(p => PLATFORM_LABELS[p] || p).join(', ') + ' lets a buyer filter by that field, and this ' +
          'listing drops out of the filtered results entirely there, not just ranks lower.');
      }
    }

    // Same double-sale gap buildAtRiskListings/"Needs delisting elsewhere" is
    // meant to catch, but that safeguard only scans status === 'live'
    // listings, so a listing moving straight to sold (via this form or a
    // Kanban drop, which reuses this same generate handler) drops out of it
    // the instant status flips, even if it's still genuinely live elsewhere
    // with nothing in soldOn for those platforms. Advisory, not a blocker:
    // a real single-item sale where soldOn/platforms just haven't been
    // trimmed yet is a legitimate case this shouldn't trap.
    if (status === 'sold' && platforms.length > 1) {
      const stillUncovered = platforms.filter(p => !(l.soldOn || []).includes(p));
      if (stillUncovered.length > 0) {
        advisory.push('Marking this Sold, but it\'s still checked on ' +
          stillUncovered.map(p => PLATFORM_LABELS[p]).join(', ') + ' with no soldOn entry logged for ' +
          (stillUncovered.length > 1 ? 'those platforms' : 'that platform') + '. Once status is Sold this drops out of ' +
          'the "Needs delisting elsewhere" safeguard, so mark it sold-on or delist it on ' +
          (stillUncovered.length > 1 ? 'those platforms' : 'that platform') + ' first, or this isn\'t really a clean ' +
          'single-item sold record yet.');
      }
    }

    if (blockers.length) {
      warningsEl.innerHTML = blockers.map(w => '<li>' + escapeHtml(w) + '</li>').join('');
      outputEl.textContent = '';
      resultEl.hidden = false;
      resultEl.scrollIntoView({ block: 'nearest' });
      return;
    }

    const edited = Object.assign({}, l, {
      title,
      price: price === undefined ? null : price,
      costBasis: costBasis === undefined ? null : costBasis,
      platforms,
      status,
      datePublished,
      location,
      ebayReturnPolicy,
      notes,
      itemSpecifics
    });

    advisory.push(...listingEmDashAdvisory(edited));
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

// Kanban board: real individually-logged listings placed into columns by
// their actual `status` field. A column's real pipeline.json count can
// exceed the number of individual records logged for it (most of the real
// 48 ready-to-post items, for example, only exist as that one aggregate
// count), that gap is shown as a plain note, never papered over with
// fabricated cards. Same drag-to-prep pattern as CSM's kanban: a drop
// never writes to listings.json (no live backend here either), it opens
// the listing's own real edit form with the target status pre-selected
// and pre-generates the snippet, since this listing already has valid
// data on every required field and the form's own blockers exist for
// genuinely incomplete records, not this case.
const KANBAN_STAGE_ORDER = ['draft', 'ready-to-post', 'live', 'sold'];

function renderKanban(listings, pipelineData) {
  const board = document.getElementById('kanbanBoard');
  if (!board) return;
  const countByStage = {};
  ((pipelineData && pipelineData.stages) || []).forEach(s => { countByStage[s.stage] = s.count; });

  board.innerHTML = KANBAN_STAGE_ORDER.map(stageId => {
    const cards = listings.filter(l => l.status === stageId);
    const known = countByStage[stageId];
    // pipeline.json's real "live" count is documented as listing instances
    // across platforms (its own note field says so, e.g. "9, 3 unique
    // items"), a different unit than every other stage's count, which is a
    // real count of items. Comparing it against cards.length (unique items,
    // same as renderStats' own listingInstances split above) falsely showed
    // "+N more" live items that don't exist: 3 real live listings across 9
    // platform instances read as only 3 logged against a known 9, an
    // apparent 6-item gap that was never real.
    const loggedForCompare = stageId === 'live'
      ? cards.reduce((s, l) => s + remainingPlatforms(l).length, 0)
      : cards.length;
    const moreCount = (typeof known === 'number' && known > loggedForCompare) ? known - loggedForCompare : 0;
    const cardsHtml = cards.length ? cards.map(l => {
      const priceText = l.price != null ? formatUsd(l.price) : 'no price set';
      const platformText = (l.platforms || []).length + ' platform' + ((l.platforms || []).length === 1 ? '' : 's');
      // The aria-label used to say only "{title}, open to edit", dropping the
      // real price/platform-count the card's own visible sub-line shows, an
      // aria-label that doesn't contain a control's real visible text is a
      // genuine WCAG 2.5.3 miss (confirmed via Lighthouse's accessibility
      // audit), not just a style nit: it silently withholds real data a
      // screen reader user would otherwise get. Built from the same
      // priceText/platformText the visible sub-line renders below so the two
      // can never drift; "open to edit" kept at the end since that's real
      // added context (this is a drag target, but a plain click/Enter opens
      // the edit form too) the visible text alone doesn't convey.
      return `
      <div class="kanban-card" draggable="true" data-listing-id="${escapeHtml(l.id)}" tabindex="0" role="button" aria-label="${escapeHtml(l.title || 'Untitled item')}, ${escapeHtml(priceText)} &middot; ${escapeHtml(platformText)}, open to edit">
        <div class="kanban-card-title">${escapeHtml(l.title || 'Untitled item')}</div>
        <div class="kanban-card-sub">${escapeHtml(priceText)} &middot; ${escapeHtml(platformText)}</div>
      </div>
    `;
    }).join('') : '<div class="kanban-empty">No individually logged items in this stage.</div>';
    const moreHtml = moreCount > 0
      ? `<div class="kanban-more-note">+${moreCount} more known from the real pipeline count, not individually logged yet</div>`
      : '';
    return `
      <div class="kanban-column" data-stage-id="${stageId}">
        <div class="kanban-column-head"><span>${escapeHtml(STAGE_LABELS[stageId] || stageId)}</span><span class="kanban-column-count">${cards.length}${moreCount ? '+' : ''}</span></div>
        ${cardsHtml}
        ${moreHtml}
      </div>
    `;
  }).join('');

  board.querySelectorAll('.kanban-card[data-listing-id]').forEach(card => {
    const id = card.getAttribute('data-listing-id');
    card.addEventListener('click', () => openModal(id));
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openModal(id); }
    });
    card.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/plain', id);
      e.dataTransfer.effectAllowed = 'move';
      card.classList.add('card-dragging');
    });
    card.addEventListener('dragend', () => card.classList.remove('card-dragging'));
  });

  board.querySelectorAll('.kanban-column[data-stage-id]').forEach(column => {
    column.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      column.classList.add('column-dragover');
    });
    column.addEventListener('dragleave', e => {
      if (!column.contains(e.relatedTarget)) column.classList.remove('column-dragover');
    });
    column.addEventListener('drop', e => {
      e.preventDefault();
      column.classList.remove('column-dragover');
      const id = e.dataTransfer.getData('text/plain');
      const targetStageId = column.getAttribute('data-stage-id');
      const l = listings.find(item => item.id === id);
      if (!l || l.status === targetStageId) return;
      openModalForStatusMove(id, targetStageId);
    });
  });
}

function openModalForStatusMove(id, targetStatus) {
  openModal(id);
  const details = document.querySelector('#modalBody details.schema-help');
  if (details) details.open = true;
  const select = document.getElementById('leStatus');
  if (select) select.value = targetStatus;
  const generateBtn = document.getElementById('leGenerateBtn');
  if (generateBtn) generateBtn.click();
}

function setGarageView(view) {
  const isKanban = view === 'kanban';
  document.getElementById('kanbanBoard').hidden = !isKanban;
  document.getElementById('listingsTableWrap').hidden = isKanban;
  document.getElementById('tableViewBtn').setAttribute('aria-pressed', String(!isKanban));
  document.getElementById('kanbanViewBtn').setAttribute('aria-pressed', String(isKanban));
  try { localStorage.setItem('garage-view', view); } catch { /* private browsing etc, not worth failing over */ }
}

document.getElementById('tableViewBtn').addEventListener('click', () => setGarageView('table'));
document.getElementById('kanbanViewBtn').addEventListener('click', () => setGarageView('kanban'));

function openModal(id) {
  const l = listings.find(item => item.id === id);
  if (!l) return;
  lastFocusedEl = document.activeElement;

  document.getElementById('modalTitle').textContent = l.title || 'Untitled item';
  document.getElementById('modalSub').textContent = STAGE_LABELS[l.status] || l.status || 'Status not logged';

  const rows = [];
  rows.push(listingEditFormHtml(l));
  rows.push(fieldRow('Asking price', l.price != null ? formatUsd(l.price) : 'Not set', l.price == null));
  rows.push(fieldRow('Cost basis', l.costBasis != null ? formatUsd(l.costBasis) : 'Not logged', l.costBasis == null));
  rows.push(fieldRow('Platforms', (l.platforms || []).length ? platformBadges(l.platforms, l.soldOn, l.listingUrls) : 'None logged', !(l.platforms || []).length));
  rows.push(fieldRow('Published', l.datePublished ? escapeHtml(l.datePublished) : 'Not logged yet', !l.datePublished));

  const modalDays = daysSincePublished(l.datePublished);
  rows.push(fieldRow('Relist guidance', relistGuidanceHtml(l, modalDays), modalDays == null));

  const modalBest = bestPayoutPlatform(l);
  const hasCostBasis = l.costBasis != null;
  const modalSoldSet = new Set(l.soldOn || []);
  const payoutHtml = (l.platforms || []).length
    ? '<table class="modal-payout-table">' + (l.platforms || []).map(p => {
        const label = escapeHtml(PLATFORM_LABELS[p] || p);
        if (modalSoldSet.has(p)) {
          return `<tr><td>${label} (sold)</td><td class="cell-value empty" title="Already sold here, no longer sellable on this platform">sold here</td>${hasCostBasis ? '<td class="cell-value empty">not applicable</td>' : ''}</tr>`;
        }
        const net = estimateNetPayout(p, l.price, l.category);
        const isBest = p === modalBest;
        const profit = net != null && hasCostBasis ? net - l.costBasis : null;
        // net is null whenever the asking price itself isn't set yet (see
        // estimateNetPayout above), which used to still render "$0 profit"
        // here: formatUsd(null) coerces to 0 instead of throwing, so a cost
        // basis logged before a price falsely read as break-even instead of
        // "not applicable", the same wording the sold-here row above already
        // uses for its own not-applicable case.
        const profitCell = !hasCostBasis ? '' : profit != null
          ? `<td class="cell-value${profit < 0 ? ' cell-value-loss' : ''}">${formatUsd(profit)} profit</td>`
          : '<td class="cell-value empty">not applicable</td>';
        return `<tr><td>${label}</td><td class="cell-value${net == null ? ' empty' : ''}${isBest ? ' cell-value-best' : ''}">${net != null ? formatUsd(net) : 'not set'}${isBest ? ' <span class="best-tag" title="Highest net payout for this item">best</span>' : ''}</td>${profitCell}</tr>`;
      }).join('') + '</table>'
    : 'Not applicable, not listed anywhere yet.';
  rows.push(fieldRow('Est. net payout by platform', payoutHtml, !(l.platforms || []).length));

  rows.push(fieldRow('Storage location', l.location ? escapeHtml(l.location) : 'Not logged', !l.location));

  if ((l.platforms || []).includes('ebay')) {
    const suspicious = l.ebayReturnPolicy && GarageValidateCore.isSuspiciousEbayReturnPolicy(l.ebayReturnPolicy);
    const returnPolicyHtml = !l.ebayReturnPolicy
      ? 'Not logged, confirm the real eBay listing isn\'t silently carrying a wrong inherited policy'
      : suspicious
        ? escapeHtml(l.ebayReturnPolicy) + ' <span class="badge badge-hold" title="Mentions parts/accessories/auto, the same wrong-template pattern as the real bug already caught once">check this</span>'
        : escapeHtml(l.ebayReturnPolicy);
    rows.push(fieldRow('eBay return policy', returnPolicyHtml, !l.ebayReturnPolicy || suspicious));
  }

  if ((l.platforms || []).length) {
    const specifics = l.itemSpecifics || {};
    const missingSpecifics = GarageValidateCore.missingItemSpecifics(l);
    const specHtml = ['brand', 'size', 'color', 'condition'].map(f => {
      const val = specifics[f];
      return escapeHtml(GarageValidateCore.ITEM_SPECIFIC_LABELS[f]) + ': ' +
        (val ? escapeHtml(val) : '<span class="cell-value empty">not logged</span>');
    }).join(' &middot; ');
    rows.push(fieldRow('Item specifics (' + l.platforms.map(p => PLATFORM_LABELS[p] || p).join('/') + ' search filters)', specHtml, missingSpecifics.length > 0));
  }

  const compsHtml = l.title
    ? `<a class="badge badge-link" href="${escapeHtml(ebaySoldSearchUrl(l.title))}" target="_blank" rel="noopener noreferrer" title="Opens eBay's real sold-listings search for this title in a new tab">eBay sold listings for "${escapeHtml(l.title)}" <span aria-hidden="true">&#8599;</span></a>`
    : 'Not applicable, no title logged.';
  rows.push(fieldRow('Price research', compsHtml, !l.title));

  rows.push(fieldRow('Notes', l.notes ? escapeHtml(l.notes) : 'None', !l.notes));

  document.getElementById('modalBody').innerHTML = rows.join('');
  wireListingEditForm(l);
  modalOverlay.hidden = false;
  lockBodyScroll();
  modalClose.focus();
}

function closeModal() {
  modalOverlay.hidden = true;
  unlockBodyScroll();
  if (lastFocusedEl && typeof lastFocusedEl.focus === 'function') lastFocusedEl.focus();
  lastFocusedEl = null;
}

function getModalFocusable() {
  // offsetParent is null for anything inside a hidden ancestor, same check
  // CGT and the main dashboard already use so Tab-wraparound can't land
  // focus on an invisible button if a hidden block is ever added in here.
  return Array.from(document.getElementById('modal').querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  )).filter(el => !el.hasAttribute('disabled') && el.offsetParent !== null);
}

modalClose.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeModal(); });
document.addEventListener('keydown', (e) => {
  if (modalOverlay.hidden) return;
  if (e.key === 'Escape') { closeModal(); return; }
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

// Shared, unit-tested CSV serialization (export-core.js): csvField's
// CSV/formula-injection guard now has a real regression test instead of
// only ever running live in a browser, same shared-core pattern already
// used for GarageValidateCore above.
const csvField = GarageExportCore.csvField;

const CSV_COLUMNS = [
  ['title', 'Item'], ['price', 'Price'], ['costBasis', 'Cost basis'], ['platforms', 'Platforms'], ['soldOn', 'Sold elsewhere'],
  ['status', 'Status'], ['datePublished', 'Published'], ['daysListed', 'Days listed'],
  ['relistGuidance', 'Relist guidance'], ['location', 'Location'], ['ebayReturnPolicy', 'eBay return policy'],
  ['brand', 'Brand'], ['size', 'Size'], ['color', 'Color'], ['condition', 'Condition'], ['notes', 'Notes']
];

// Exports exactly what the table currently shows (same search, platform
// filter, and sort applied), not the full dataset, so the file matches
// what's on screen. Includes the same relist guidance as the on-page
// section, computed fresh at export time rather than cached, since "days
// listed" changes daily even with the underlying data untouched.
document.getElementById('csvBtn').addEventListener('click', () => {
  const rows = sortRows(listings.filter(matchesFilters)).map(l => {
    const days = daysSincePublished(l.datePublished);
    const specifics = l.itemSpecifics || {};
    return {
      ...l,
      platforms: (l.platforms || []).map(p => PLATFORM_LABELS[p] || p).join('; '),
      soldOn: (l.soldOn || []).map(p => PLATFORM_LABELS[p] || p).join('; '),
      daysListed: days != null ? days : '',
      relistGuidance: relistGuidanceText(l, days),
      brand: specifics.brand || '',
      size: specifics.size || '',
      color: specifics.color || '',
      condition: specifics.condition || ''
    };
  });
  const header = CSV_COLUMNS.map(([, label]) => csvField(label)).join(',');
  const lines = rows.map(l => CSV_COLUMNS.map(([key]) => csvField(l[key])).join(','));
  const csv = [header, ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'garage-listings-' + todayDateStr() + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

// Full-fidelity backup: unlike the CSV exports, which flatten one table at a
// time to whatever's currently filtered, this keeps listings.json,
// pipeline.json, activity.json, sales.json, expenses.json, and
// disputes.json exactly as loaded, so a bad hand-edit to any of them can be
// diffed against or restored from a known-good copy. Local download only,
// nothing is sent anywhere. Same approach as CSM's own backup button.
document.getElementById('backupBtn').addEventListener('click', () => {
  if (!rawListingsData && !rawPipelineData && !rawActivityData && !rawSalesData && !rawExpensesData && !rawDisputesData && !rawSuppliesData && !rawAcquisitionsData) return;
  const backup = {
    exportedAt: new Date().toISOString(),
    source: 'Command Center Garage (/garage), local download only',
    listingsJson: rawListingsData,
    pipelineJson: rawPipelineData,
    activityJson: rawActivityData,
    salesJson: rawSalesData,
    expensesJson: rawExpensesData,
    disputesJson: rawDisputesData,
    suppliesJson: rawSuppliesData,
    acquisitionsJson: rawAcquisitionsData
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'garage-backup-' + todayDateStr() + '.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

const SALES_CSV_COLUMNS = [
  ['title', 'Item'], ['platform', 'Platform'], ['salePrice', 'Sale price'], ['askingPrice', 'Asking price'],
  ['netPayout', 'Est. net payout'], ['costBasis', 'Cost basis'], ['shippingCost', 'Shipping paid'],
  ['profit', 'Profit'], ['saleDate', 'Sale date']
];

// Exports every real logged sale, same computed net-payout/profit columns as
// the on-page sales table (recomputed fresh, not cached), so a full sale
// history with real numbers can leave the browser for bookkeeping or taxes.
// Unlike the listings CSV export above this isn't filtered by the page's
// search/platform controls, since the sales log has no filter UI of its own,
// this exports the full real sales.json.
document.getElementById('salesCsvBtn').addEventListener('click', () => {
  const rows = salesLog.map(s => {
    const net = estimateNetPayout(s.platform, s.salePrice, categoryForListingId(s.listingId));
    const hasEither = s.costBasis != null || s.shippingCost != null;
    const profit = net != null && hasEither ? net - (s.costBasis || 0) - (s.shippingCost || 0) : null;
    return {
      ...s,
      platform: PLATFORM_LABELS[s.platform] || s.platform || '',
      netPayout: net != null ? net.toFixed(2) : '',
      profit: profit != null ? profit.toFixed(2) : ''
    };
  });
  const header = SALES_CSV_COLUMNS.map(([, label]) => csvField(label)).join(',');
  const lines = rows.map(s => SALES_CSV_COLUMNS.map(([key]) => csvField(s[key])).join(','));
  const csv = [header, ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'garage-sales-' + todayDateStr() + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

const EXPENSES_CSV_COLUMNS = [
  ['description', 'Description'], ['category', 'Category'], ['miles', 'Miles'],
  ['amount', 'Amount'], ['date', 'Date']
];

// Exports every real logged expense, with the same computed mileage-at-the-
// real-IRS-rate amount as the on-page table, for a real Schedule C record.
document.getElementById('expensesCsvBtn').addEventListener('click', () => {
  const rows = expensesLog.map(e => {
    const amount = computeExpenseAmount(e);
    return {
      ...e,
      category: EXPENSE_CATEGORY_LABELS[e.category] || e.category || '',
      amount: amount != null ? amount.toFixed(2) : ''
    };
  });
  const header = EXPENSES_CSV_COLUMNS.map(([, label]) => csvField(label)).join(',');
  const lines = rows.map(e => EXPENSES_CSV_COLUMNS.map(([key]) => csvField(e[key])).join(','));
  const csv = [header, ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'garage-expenses-' + todayDateStr() + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

const DISPUTES_CSV_COLUMNS = [
  ['title', 'Item'], ['platform', 'Platform'], ['type', 'Type'], ['status', 'Status'],
  ['openedDate', 'Opened'], ['respondBy', 'Respond by'], ['resolvedDate', 'Resolved'], ['outcome', 'Outcome']
];

// Exports every real logged return/dispute, with the same computed
// respond-by deadline as the on-page table (recomputed fresh, not cached).
document.getElementById('disputesCsvBtn').addEventListener('click', () => {
  const rows = disputesLog.map(d => {
    const respondInfo = disputeResponseInfo(d);
    return {
      ...d,
      platform: PLATFORM_LABELS[d.platform] || d.platform || '',
      type: DISPUTE_TYPE_LABELS[d.type] || d.type || '',
      status: DISPUTE_STATUS_LABELS[d.status] || d.status || '',
      respondBy: respondInfo ? respondInfo.text : ''
    };
  });
  const header = DISPUTES_CSV_COLUMNS.map(([, label]) => csvField(label)).join(',');
  const lines = rows.map(d => DISPUTES_CSV_COLUMNS.map(([key]) => csvField(d[key])).join(','));
  const csv = [header, ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'garage-disputes-' + todayDateStr() + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

const SUPPLIES_CSV_COLUMNS = [
  ['name', 'Supply'], ['category', 'Category'], ['qtyOnHand', 'Qty on hand'],
  ['reorderThreshold', 'Reorder at'], ['lastRestocked', 'Last restocked'], ['notes', 'Notes']
];

// Exports every real logged supply, in the same low-stock-first order as
// the on-page table.
document.getElementById('suppliesCsvBtn').addEventListener('click', () => {
  const rows = [...suppliesLog]
    .sort((a, b) => Number(isSupplyLowStock(b)) - Number(isSupplyLowStock(a)))
    .map(s => ({ ...s, category: SUPPLY_CATEGORY_LABELS[s.category] || s.category || '' }));
  const header = SUPPLIES_CSV_COLUMNS.map(([, label]) => csvField(label)).join(',');
  const lines = rows.map(s => SUPPLIES_CSV_COLUMNS.map(([key]) => csvField(s[key])).join(','));
  const csv = [header, ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'garage-supplies-' + todayDateStr() + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

const ACQUISITIONS_CSV_COLUMNS = [
  ['source', 'Source'], ['sourceName', 'Source name'], ['date', 'Acquired'], ['pricePaid', 'Paid'],
  ['itemCount', 'Items'], ['perItemCost', 'Per-item cost'], ['listingIds', 'Linked listings'], ['notes', 'Notes']
];

// Exports every real logged acquisition, newest-first, same order as the
// on-page table.
document.getElementById('acquisitionsCsvBtn').addEventListener('click', () => {
  const rows = [...acquisitionsLog]
    .sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      return b.date.localeCompare(a.date);
    })
    .map(a => ({
      ...a,
      source: ACQUISITION_SOURCE_LABELS[a.source] || a.source || '',
      perItemCost: acquisitionPerItemCost(a),
      listingIds: (a.listingIds || []).join('; ')
    }));
  const header = ACQUISITIONS_CSV_COLUMNS.map(([, label]) => csvField(label)).join(',');
  const lines = rows.map(a => ACQUISITIONS_CSV_COLUMNS.map(([key]) => csvField(a[key])).join(','));
  const csv = [header, ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a2 = document.createElement('a');
  a2.href = url;
  a2.download = 'garage-acquisitions-' + todayDateStr() + '.csv';
  document.body.appendChild(a2);
  a2.click();
  document.body.removeChild(a2);
  URL.revokeObjectURL(url);
});

const disputesIcsBtn = document.getElementById('disputesIcsBtn');
const DISPUTES_ICS_LABEL = disputesIcsBtn.textContent;
disputesIcsBtn.addEventListener('click', () => {
  const reminders = buildDisputeReminders(disputesLog);
  if (!reminders.length) {
    disputesIcsBtn.textContent = 'No open disputes with a real response deadline yet';
    setTimeout(() => { disputesIcsBtn.textContent = DISPUTES_ICS_LABEL; }, 2400);
    return;
  }
  const ics = buildIcsCalendar(reminders);
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'garage-dispute-deadlines-' + todayDateStr() + '.ics';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  disputesIcsBtn.textContent = `Downloaded ${reminders.length} reminder${reminders.length === 1 ? '' : 's'}`;
  setTimeout(() => { disputesIcsBtn.textContent = DISPUTES_ICS_LABEL; }, 2400);
});

// Pre-publish checklist: state is per-browser only (not shared data, and
// not worth a JSON file for a personal reminder), so it's fine to sit in
// localStorage. Falls back to an in-memory Set and just doesn't persist
// across reloads if storage is unavailable (private window, blocked, etc).
const CHECKLIST_STORAGE_KEY = 'garage-publish-checklist';
function loadChecklistState() {
  try {
    return new Set(JSON.parse(localStorage.getItem(CHECKLIST_STORAGE_KEY) || '[]'));
  } catch {
    return new Set();
  }
}
function saveChecklistState(checked) {
  try {
    localStorage.setItem(CHECKLIST_STORAGE_KEY, JSON.stringify([...checked]));
  } catch {
    // Storage unavailable, checklist just won't persist this session.
  }
}
function wireChecklist() {
  const checked = loadChecklistState();
  const boxes = document.querySelectorAll('#publishChecklist input[type="checkbox"]');
  boxes.forEach(box => {
    box.checked = checked.has(box.getAttribute('data-check-id'));
    box.addEventListener('change', () => {
      const id = box.getAttribute('data-check-id');
      if (box.checked) checked.add(id); else checked.delete(id);
      saveChecklistState(checked);
    });
  });
  document.getElementById('resetChecklistBtn').addEventListener('click', () => {
    checked.clear();
    boxes.forEach(box => { box.checked = false; });
    saveChecklistState(checked);
  });
}

// Photo audit tool: runs entirely client-side, nothing selected here is
// uploaded or persisted. Mirrors the real two-part check from the 48-draft
// Depop audit logged above: a raw-dimension flag for anything wider than
// tall (the automated sideways/landscape check), plus a thumbnail grid so
// the actual visual review pass that caught the Haggar pants bug can be
// re-run on the next batch.
function initPhotoAudit() {
  const input = document.getElementById('photoAuditInput');
  const grid = document.getElementById('photoAuditGrid');
  const summary = document.getElementById('photoAuditSummary');
  if (!input) return;

  // Large batches (the real 48-photo Depop audit this mirrors) take real
  // time to decode, so a re-selection made before the previous batch
  // finishes loading must not let that previous batch's late img.onload
  // callbacks render over the new one. Same monotonic-run-id guard as
  // index.html's loadClusters/sendChat, scoped to this input instead of
  // the whole page.
  let auditRunId = 0;

  input.addEventListener('change', () => {
    const runId = ++auditRunId;
    const files = Array.from(input.files || []);
    grid.querySelectorAll('.photo-audit-card img').forEach(img => URL.revokeObjectURL(img.src));
    // One hidden placeholder slot per file, in file order, so each photo's
    // card can be swapped into its own stable position as it resolves. The
    // old version rebuilt grid.innerHTML from the full results array on
    // every single onload/onerror, re-creating every already-rendered
    // <img> each time, an O(n^2) cost for a real n-photo batch (the actual
    // 48-photo Depop audit this mirrors runs ~48x48 card-renders instead of
    // 48). A [hidden] slot is display:none by default, so it takes no space
    // in the grid until swapped for its real card, same as the old
    // behavior's compacted list of only-resolved-so-far cards.
    grid.innerHTML = files.map((_, i) => `<div class="photo-audit-card-slot" id="paCard${i}" hidden></div>`).join('');
    summary.textContent = '';
    if (!files.length) return;

    let loaded = 0;
    let landscapeFlagged = 0;
    let smallFlagged = 0;

    files.forEach((file, i) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        if (runId !== auditRunId) { URL.revokeObjectURL(url); return; }
        loaded++;
        const isLandscape = img.naturalWidth > img.naturalHeight;
        // eBay's own documented minimum is 500px on the longest side (see the
        // Title & photo specs table above), below that eBay itself will
        // reject or downscale the listing photo at publish. A too-small
        // image is the same class of silent-failure risk as the sideways
        // check this tool already runs.
        const isSmall = Math.max(img.naturalWidth, img.naturalHeight) < 500;
        if (isLandscape) landscapeFlagged++;
        if (isSmall) smallFlagged++;
        swapPhotoAuditCard(i, { file, url, w: img.naturalWidth, h: img.naturalHeight, isLandscape, isSmall, failed: false });
        renderPhotoAuditSummary(loaded, files.length, landscapeFlagged, smallFlagged);
      };
      img.onerror = () => {
        // Unlike the onload path above, a failed card never gets an <img>
        // tag (photoAuditCardHtml only shows a "couldn't read image" badge
        // for it), so the re-selection cleanup at the top of this handler,
        // which only revokes URLs still attached to a rendered <img>, never
        // reaches this one. Revoked right here instead, same as
        // resizeImageForDraft's own onerror does for the identical failure
        // case, so a batch with an unreadable file (HEIC, a non-image
        // dropped in by mistake) doesn't leak its blob for the rest of the
        // page session.
        URL.revokeObjectURL(url);
        if (runId !== auditRunId) return;
        loaded++;
        swapPhotoAuditCard(i, { file, failed: true });
        renderPhotoAuditSummary(loaded, files.length, landscapeFlagged, smallFlagged);
      };
      img.src = url;
    });
  });
}

function photoAuditCardHtml(r) {
  if (r.failed) {
    return `<div class="photo-audit-card"><div class="photo-audit-meta"><span class="photo-audit-name">${escapeHtml(r.file.name)}</span><span class="badge badge-due">couldn't read image</span></div></div>`;
  }
  const badges = [
    r.isLandscape ? '<span class="badge badge-due">check orientation</span>' : '',
    r.isSmall ? '<span class="badge badge-due">under 500px min</span>' : ''
  ].join('');
  return `
    <a class="photo-audit-card${(r.isLandscape || r.isSmall) ? ' photo-audit-flagged' : ''}" href="${r.url}" target="_blank" rel="noopener noreferrer" title="Open ${escapeHtml(r.file.name)} full-size">
      <img src="${r.url}" alt="${escapeHtml(r.file.name)}" loading="lazy">
      <div class="photo-audit-meta">
        <span class="photo-audit-name">${escapeHtml(r.file.name)}</span>
        <span class="photo-audit-dims">${r.w}&times;${r.h}${badges}</span>
      </div>
    </a>
  `;
}

// Replaces just the one resolved photo's placeholder slot in place, instead
// of rebuilding every other already-resolved card's DOM on each callback.
function swapPhotoAuditCard(i, r) {
  const slot = document.getElementById('paCard' + i);
  if (slot) slot.outerHTML = photoAuditCardHtml(r);
}

function renderPhotoAuditSummary(loaded, total, landscapeFlagged, smallFlagged) {
  const summary = document.getElementById('photoAuditSummary');
  summary.textContent = loaded < total
    ? `Checking ${loaded}/${total} photo(s)...`
    : `${total} photo(s) checked, ${landscapeFlagged} flagged for possible sideways/landscape orientation, ` +
      `${smallFlagged} under eBay's documented 500px minimum on the longest side. ` +
      `Click any photo to open it full-size for the visual review pass, an automated flag alone caught nothing in the real audit.`;
}

// Shared client-side draft-autosave for the four quick-log forms below: none
// of them write to a real file, this app has no backend to save a
// half-filled form to, so an accidental reload or navigation away used to
// throw away real typed data with no way back. Same pattern CGT's own
// attachDraftGuard uses (public/cgt/app.js), reading whatever real
// input/select/textarea fields the given form actually has rather than a
// hand-maintained id list. Extended here with an optional checkboxGroup
// selector, since the listing form's platform checkboxes have no individual
// ids to key on (see initQuickLogTool's own '.nl-platform' selector), keyed
// by their real `value` instead. Autosaved to this browser's localStorage
// only, never sent anywhere, so it does not conflict with this page's
// no-fabricated-data rule; a private window or blocked storage just means
// the draft protection quietly no-ops.
function attachDraftGuard(form, storageKey, opts) {
  const bannerEl = document.getElementById(opts.bannerId);
  const bannerTimeEl = document.getElementById(opts.timeId);
  const discardBtn = document.getElementById(opts.discardId);
  if (!bannerEl || !bannerTimeEl || !discardBtn) return { clearDraft() {} };

  const fields = Array.from(form.querySelectorAll('input[id], select[id], textarea[id]'));
  const checkboxGroup = opts.checkboxGroupSelector ? Array.from(form.querySelectorAll(opts.checkboxGroupSelector)) : [];
  let saveTimer = null;

  function readValues() {
    const values = {};
    fields.forEach(el => { values[el.id] = el.value; });
    if (checkboxGroup.length) values.__checked = checkboxGroup.filter(el => el.checked).map(el => el.value);
    return values;
  }
  function hasAnyValue(values) {
    return fields.some(el => (values[el.id] || '').trim() !== '') ||
      !!(values.__checked && values.__checked.length);
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
    if (opts.onDiscard) opts.onDiscard();
  });

  try {
    const raw = localStorage.getItem(storageKey);
    const draft = raw ? JSON.parse(raw) : null;
    if (draft && hasAnyValue(draft.values || {})) {
      fields.forEach(el => { if (el.id in draft.values) el.value = draft.values[el.id]; });
      if (checkboxGroup.length && draft.values.__checked) {
        checkboxGroup.forEach(el => { el.checked = draft.values.__checked.includes(el.value); });
      }
      bannerTimeEl.textContent = new Date(draft.savedAt).toLocaleString();
      bannerEl.hidden = false;
    }
  } catch (e) { /* see saveDraft above */ }

  return { clearDraft };
}

// Quick-log tool: builds one candidate listing from the form and checks it
// against the same rules validate.js enforces (a unique id, a non-empty
// platforms array, a title over a platform's real character cap), so a
// mistake surfaces here instead of only on the next `node validate.js` run.
// Garage has no shared browser-safe validator module the way CGT does, so
// these checks are kept in sync with validate.js by hand, same pattern as
// Sondrik's and CSM's own quick-log tools. soldOn and listingUrls always
// come out empty, a brand-new listing hasn't sold or been posted anywhere
// yet. Never writes listings.json itself, Command Center's dashboards have
// no backend to save to; this only builds paste-ready JSON for the clipboard.
function wireQuickLogTool() {
  const form = document.getElementById('quickListingForm');
  if (!form) return;
  const warningsBox = document.getElementById('nlWarnings');
  const output = document.getElementById('nlOutput');
  const copyBtn = document.getElementById('nlCopyBtn');
  const live = document.getElementById('quickLogLive');
  const draftGuard = attachDraftGuard(form, 'garage-nl-draft-v1', {
    bannerId: 'nlDraftBanner', timeId: 'nlDraftBannerTime', discardId: 'nlDiscardDraftBtn',
    checkboxGroupSelector: '.nl-platform',
    onDiscard: () => { output.hidden = true; copyBtn.hidden = true; warningsBox.textContent = ''; }
  });

  form.addEventListener('submit', e => {
    e.preventDefault();
    const id = document.getElementById('nlId').value.trim();
    const title = document.getElementById('nlTitle').value.trim();
    const price = readOptionalNonNegativeInput(document.getElementById('nlPrice'));
    const costBasis = readOptionalNonNegativeInput(document.getElementById('nlCostBasis'));
    const category = document.getElementById('nlCategory').value || null;
    const platforms = Array.from(document.querySelectorAll('.nl-platform:checked')).map(el => el.value);
    const status = document.getElementById('nlStatus').value;
    const datePublished = document.getElementById('nlDatePublished').value || null;
    const location = document.getElementById('nlLocation').value.trim() || null;
    const ebayReturnPolicy = document.getElementById('nlEbayReturnPolicy').value.trim() || null;
    const notes = document.getElementById('nlNotes').value.trim() || null;
    const itemSpecifics = {
      brand: document.getElementById('nlBrand').value.trim() || null,
      size: document.getElementById('nlSize').value.trim() || null,
      color: document.getElementById('nlColor').value.trim() || null,
      condition: document.getElementById('nlCondition').value.trim() || null
    };

    const blockers = [];
    const advisory = [];

    if (!id) blockers.push('An id is required.');
    else if (listings.some(l => l.id === id)) {
      blockers.push('"' + id + '" is already used by another listing, ids must be unique.');
    }
    if (!title) blockers.push('A title is required.');
    if (!platforms.length) blockers.push('Select at least one platform.');
    // undefined (as opposed to null) means something was typed but it wasn't
    // a valid non-negative number, same distinction the price calculator
    // above already makes with this same helper.
    if (price === undefined) blockers.push('Enter a valid asking price of $0 or more, or leave it blank.');
    if (costBasis === undefined) blockers.push('Enter a valid cost basis of $0 or more, or leave it blank.');

    if (title && platforms.length) {
      platforms.forEach(p => {
        const limit = TITLE_HARD_LIMITS[p];
        if (limit && title.length > limit) {
          advisory.push('Title is ' + title.length + ' chars, over ' + PLATFORM_LABELS[p] + '\'s ' + limit +
            '-char cap, it will get rejected or truncated there.');
        }
      });
    }
    if (platforms.includes('ebay') && ebayReturnPolicy && GarageValidateCore.isSuspiciousEbayReturnPolicy(ebayReturnPolicy)) {
      advisory.push('"' + ebayReturnPolicy + '" mentions parts/accessories/auto, the same wrong-inherited-template ' +
        'pattern as the real eBay return-policy bug already caught once. Double check the real eBay listing before publishing.');
    }
    if (platforms.length) {
      const missingSpecifics = GarageValidateCore.missingItemSpecifics({ category, itemSpecifics });
      if (missingSpecifics.length) {
        advisory.push('Missing "' + missingSpecifics.join('", "') + '" in item specifics. Each of ' +
          platforms.map(p => PLATFORM_LABELS[p] || p).join(', ') + ' lets a buyer filter by that field, and this ' +
          'listing drops out of the filtered results entirely there, not just ranks lower.');
      }
    }

    if (blockers.length) {
      warningsBox.textContent = blockers.join(' ');
      output.hidden = true;
      copyBtn.hidden = true;
      return;
    }

    const candidate = {
      id,
      title,
      price: price === undefined ? null : price,
      costBasis: costBasis === undefined ? null : costBasis,
      category,
      platforms,
      soldOn: [],
      listingUrls: platforms.reduce((o, p) => { o[p] = null; return o; }, {}),
      status,
      datePublished,
      notes,
      location,
      ebayReturnPolicy,
      itemSpecifics
    };

    advisory.push(...listingEmDashAdvisory(candidate));
    warningsBox.textContent = advisory.join(' ');
    output.value = JSON.stringify(candidate, null, 2) + ',';
    output.hidden = false;
    copyBtn.hidden = false;
  });

  copyBtn.addEventListener('click', () => {
    copyText(output.value).then(() => {
      const original = copyBtn.textContent;
      copyBtn.textContent = 'Copied!';
      live.textContent = 'Listing JSON copied to clipboard.';
      draftGuard.clearDraft();
      setTimeout(() => { copyBtn.textContent = original; }, 1800);
    }).catch(() => { live.textContent = 'Could not copy to clipboard.'; });
  });
}

// Same quick-log convention as wireQuickLogTool above, for sales.json instead
// of listings.json: sales.json had no logging UI at all before this, only
// hand-editing the file directly, unlike every other entity in every other
// app here (CGT submissions/candidates, CSM prospects, Sondrik channels/
// leads all get an equivalent form). Checked against the same rules
// validate.js runs on sales.json (unique id, a real platform, a non-negative
// salePrice), kept in sync by hand like the listing tool above since Garage
// has no shared browser-safe validator module the way CGT does.
function wireQuickLogSaleTool() {
  const form = document.getElementById('quickSaleForm');
  if (!form) return;
  const warningsBox = document.getElementById('nsWarnings');
  const output = document.getElementById('nsOutput');
  const copyBtn = document.getElementById('nsCopyBtn');
  const live = document.getElementById('quickLogSaleLive');
  const draftGuard = attachDraftGuard(form, 'garage-ns-draft-v1', {
    bannerId: 'nsDraftBanner', timeId: 'nsDraftBannerTime', discardId: 'nsDiscardDraftBtn',
    onDiscard: () => { output.hidden = true; copyBtn.hidden = true; warningsBox.textContent = ''; }
  });

  form.addEventListener('submit', e => {
    e.preventDefault();
    const id = document.getElementById('nsId').value.trim();
    const title = document.getElementById('nsTitle').value.trim();
    const listingId = document.getElementById('nsListingId').value.trim() || null;
    const platform = document.getElementById('nsPlatform').value;
    const salePrice = readOptionalNonNegativeInput(document.getElementById('nsSalePrice'));
    const askingPrice = readOptionalNonNegativeInput(document.getElementById('nsAskingPrice'));
    const costBasis = readOptionalNonNegativeInput(document.getElementById('nsCostBasis'));
    const shippingCost = readOptionalNonNegativeInput(document.getElementById('nsShippingCost'));
    const saleDate = document.getElementById('nsSaleDate').value || null;

    const blockers = [];
    const advisory = [];

    if (!id) blockers.push('An id is required.');
    else if (salesLog.some(s => s.id === id)) {
      blockers.push('"' + id + '" is already used by another sale, ids must be unique.');
    }
    if (!title) blockers.push('A title is required.');
    if (!platform) blockers.push('Select a platform.');
    // salePrice is required (unlike the optional cost/asking fields), so an
    // empty box is exactly as wrong here as an invalid number, both mean
    // there is no real non-negative number to log yet.
    if (salePrice === null || salePrice === undefined) blockers.push('Enter a valid sale price of $0 or more.');
    if (askingPrice === undefined) blockers.push('Enter a valid asking price of $0 or more, or leave it blank.');
    if (costBasis === undefined) blockers.push('Enter a valid cost basis of $0 or more, or leave it blank.');
    if (shippingCost === undefined) blockers.push('Enter a valid shipping cost of $0 or more, or leave it blank.');

    if (listingId && !(listings || []).some(l => l.id === listingId)) {
      advisory.push('"' + listingId + '" does not match any listing in listings.json. Fine if that listing has ' +
        'since fully sold through and was removed, otherwise double-check the id.');
    }
    if (listingId && platform) {
      const listing = (listings || []).find(l => l.id === listingId);
      if (listing && !(listing.soldOn || []).includes(platform)) {
        advisory.push('Remember to add "' + platform + '" to this listing\'s own "soldOn" array too, logging the ' +
          'sale here does not do that automatically.');
      }
    }

    if (blockers.length) {
      warningsBox.textContent = blockers.join(' ');
      output.hidden = true;
      copyBtn.hidden = true;
      return;
    }

    const sale = {
      id,
      title,
      listingId,
      platform,
      salePrice,
      askingPrice: askingPrice === undefined ? null : askingPrice,
      costBasis: costBasis === undefined ? null : costBasis,
      shippingCost: shippingCost === undefined ? null : shippingCost,
      saleDate
    };

    advisory.push(...emDashAdvisory(sale, ['title']));
    warningsBox.textContent = advisory.join(' ');
    output.value = JSON.stringify(sale, null, 2) + ',';
    output.hidden = false;
    copyBtn.hidden = false;
  });

  copyBtn.addEventListener('click', () => {
    copyText(output.value).then(() => {
      const original = copyBtn.textContent;
      copyBtn.textContent = 'Copied!';
      live.textContent = 'Sale JSON copied to clipboard.';
      draftGuard.clearDraft();
      setTimeout(() => { copyBtn.textContent = original; }, 1800);
    }).catch(() => { live.textContent = 'Could not copy to clipboard.'; });
  });
}

// Same gap as sales.json above: expenses.json had no logging UI at all,
// despite Net business income and the Schedule C-style totals both reading
// straight from it. Reuses computeExpenseAmount and mileageRateGapReason,
// the exact same functions renderExpenses already uses to preview what a
// mileage entry with no manual amount would compute to (or why it can't
// yet), so the preview shown here can never drift from what the real table
// would show once this gets pasted in.
function wireQuickLogExpenseTool() {
  const form = document.getElementById('quickExpenseForm');
  if (!form) return;
  const warningsBox = document.getElementById('neWarnings');
  const output = document.getElementById('neOutput');
  const copyBtn = document.getElementById('neCopyBtn');
  const live = document.getElementById('quickLogExpenseLive');
  const draftGuard = attachDraftGuard(form, 'garage-ne-draft-v1', {
    bannerId: 'neDraftBanner', timeId: 'neDraftBannerTime', discardId: 'neDiscardDraftBtn',
    onDiscard: () => { output.hidden = true; copyBtn.hidden = true; warningsBox.textContent = ''; }
  });

  form.addEventListener('submit', e => {
    e.preventDefault();
    const id = document.getElementById('neId').value.trim();
    const description = document.getElementById('neDescription').value.trim();
    const category = document.getElementById('neCategory').value;
    const miles = readOptionalNonNegativeInput(document.getElementById('neMiles'));
    const amount = readOptionalNonNegativeInput(document.getElementById('neAmount'));
    const date = document.getElementById('neDate').value || null;

    const blockers = [];
    const advisory = [];

    if (!id) blockers.push('An id is required.');
    else if (expensesLog.some(x => x.id === id)) {
      blockers.push('"' + id + '" is already used by another expense, ids must be unique.');
    }
    if (!description) blockers.push('A description is required.');
    if (!category) blockers.push('Select a category.');
    if (miles === undefined) blockers.push('Enter a valid mileage of 0 or more, or leave it blank.');
    if (amount === undefined) blockers.push('Enter a valid amount of $0 or more, or leave it blank.');

    if (blockers.length) {
      warningsBox.textContent = blockers.join(' ');
      output.hidden = true;
      copyBtn.hidden = true;
      return;
    }

    const expense = {
      id,
      description,
      category,
      miles: miles === undefined ? null : miles,
      amount: amount === undefined ? null : amount,
      date
    };

    // Same three data-quality checks validate.js runs on a real expense row,
    // reused here so a gap surfaces before pasting instead of on the next
    // `node validate.js` run.
    if (expense.miles != null && expense.category !== 'mileage') {
      advisory.push('"miles" is set but category is "' + category + '", not "mileage", it will be ignored.');
    }
    const computed = computeExpenseAmount(expense);
    const gapReason = mileageRateGapReason(expense);
    if (computed == null && expense.category === 'mileage') {
      if (expense.miles == null) advisory.push('Mileage expense has no amount and no miles to compute one from.');
      else if (!expense.date) advisory.push('Mileage expense has miles but no date, can\'t look up which IRS rate applies.');
      else if (gapReason) advisory.push(gapReason);
    } else if (computed == null) {
      advisory.push('No amount logged yet for this expense.');
    } else if (expense.amount == null && expense.category === 'mileage') {
      advisory.push('Amount left blank, the table will compute ' + formatUsd(computed) + ' from ' + expense.miles +
        ' miles at the real IRS rate for ' + expense.date + '.');
    }

    advisory.push(...emDashAdvisory(expense, ['description']));
    warningsBox.textContent = advisory.join(' ');
    output.value = JSON.stringify(expense, null, 2) + ',';
    output.hidden = false;
    copyBtn.hidden = false;
  });

  copyBtn.addEventListener('click', () => {
    copyText(output.value).then(() => {
      const original = copyBtn.textContent;
      copyBtn.textContent = 'Copied!';
      live.textContent = 'Expense JSON copied to clipboard.';
      draftGuard.clearDraft();
      setTimeout(() => { copyBtn.textContent = original; }, 1800);
    }).catch(() => { live.textContent = 'Could not copy to clipboard.'; });
  });
}

// Same quick-log convention as the sale/expense tools above, for
// disputes.json: the "Return & dispute handling, by platform" reference
// table had real per-platform response-clock facts but nowhere to actually
// track a real open case against them, so a real dispute had to be tracked
// by memory or a hand-edit with no validation until the next `node
// validate.js` run. Checked against the same rules validate.js runs on
// disputes.json (unique id, a real platform/type/status, resolvedDate not
// before openedDate).
function wireQuickLogDisputeTool() {
  const form = document.getElementById('quickDisputeForm');
  if (!form) return;
  const warningsBox = document.getElementById('ndWarnings');
  const output = document.getElementById('ndOutput');
  const copyBtn = document.getElementById('ndCopyBtn');
  const live = document.getElementById('quickLogDisputeLive');
  const draftGuard = attachDraftGuard(form, 'garage-nd-draft-v1', {
    bannerId: 'ndDraftBanner', timeId: 'ndDraftBannerTime', discardId: 'ndDiscardDraftBtn',
    onDiscard: () => { output.hidden = true; copyBtn.hidden = true; warningsBox.textContent = ''; }
  });

  form.addEventListener('submit', e => {
    e.preventDefault();
    const id = document.getElementById('ndId').value.trim();
    const title = document.getElementById('ndTitle').value.trim();
    const listingId = document.getElementById('ndListingId').value.trim() || null;
    const platform = document.getElementById('ndPlatform').value;
    const type = document.getElementById('ndType').value;
    const status = document.getElementById('ndStatus').value;
    const openedDate = document.getElementById('ndOpenedDate').value || null;
    const resolvedDate = document.getElementById('ndResolvedDate').value || null;
    const outcome = document.getElementById('ndOutcome').value.trim() || null;
    const notes = document.getElementById('ndNotes').value.trim() || null;

    const blockers = [];
    const advisory = [];

    if (!id) blockers.push('An id is required.');
    else if (disputesLog.some(x => x.id === id)) {
      blockers.push('"' + id + '" is already used by another dispute, ids must be unique.');
    }
    if (!title) blockers.push('A title is required.');
    if (!platform) blockers.push('Select a platform.');
    if (!type) blockers.push('Select a type.');
    if (!status) blockers.push('Select a status.');
    if (openedDate && resolvedDate && resolvedDate < openedDate) {
      blockers.push('Date resolved is before date opened.');
    }

    if (listingId && !(listings || []).some(l => l.id === listingId)) {
      advisory.push('"' + listingId + '" does not match any listing in listings.json. Fine if that listing has ' +
        'since fully sold through and was removed, otherwise double-check the id.');
    }
    if (status === 'open' && resolvedDate) {
      advisory.push('Status is "Open" but a resolved date is set, switch status to one of the resolved options instead.');
    }
    if (status !== 'open' && !resolvedDate) {
      advisory.push('Status is resolved but no date resolved is logged yet.');
    }

    if (blockers.length) {
      warningsBox.textContent = blockers.join(' ');
      output.hidden = true;
      copyBtn.hidden = true;
      return;
    }

    const dispute = { id, title, listingId, platform, type, status, openedDate, resolvedDate, outcome, notes };

    if (status === 'open' && openedDate) {
      const respondInfo = disputeResponseInfo(dispute);
      if (respondInfo) advisory.push('Real response window: ' + respondInfo.text + '.');
    }

    advisory.push(...emDashAdvisory(dispute, ['title', 'outcome', 'notes']));
    warningsBox.textContent = advisory.join(' ');
    output.value = JSON.stringify(dispute, null, 2) + ',';
    output.hidden = false;
    copyBtn.hidden = false;
  });

  copyBtn.addEventListener('click', () => {
    copyText(output.value).then(() => {
      const original = copyBtn.textContent;
      copyBtn.textContent = 'Copied!';
      live.textContent = 'Dispute JSON copied to clipboard.';
      draftGuard.clearDraft();
      setTimeout(() => { copyBtn.textContent = original; }, 1800);
    }).catch(() => { live.textContent = 'Could not copy to clipboard.'; });
  });
}

// Same quick-log convention as the sale/expense/dispute tools above, for
// supplies.json. qtyOnHand and reorderThreshold are whole-number counts, not
// dollar amounts, so they get their own non-negative-integer check rather
// than reusing readOptionalNonNegativeInput (which allows a fraction like
// "2.5 boxes", not a real count).
function readOptionalNonNegativeInteger(el) {
  const raw = el.value.trim();
  if (raw === '') return null;
  const n = Number(raw);
  return Number.isNaN(n) || n < 0 || !Number.isInteger(n) ? undefined : n;
}

function wireQuickLogSupplyTool() {
  const form = document.getElementById('quickSupplyForm');
  if (!form) return;
  const warningsBox = document.getElementById('nsuWarnings');
  const output = document.getElementById('nsuOutput');
  const copyBtn = document.getElementById('nsuCopyBtn');
  const live = document.getElementById('quickLogSupplyLive');
  const draftGuard = attachDraftGuard(form, 'garage-nsu-draft-v1', {
    bannerId: 'nsuDraftBanner', timeId: 'nsuDraftBannerTime', discardId: 'nsuDiscardDraftBtn',
    onDiscard: () => { output.hidden = true; copyBtn.hidden = true; warningsBox.textContent = ''; }
  });

  form.addEventListener('submit', e => {
    e.preventDefault();
    const id = document.getElementById('nsuId').value.trim();
    const name = document.getElementById('nsuName').value.trim();
    const category = document.getElementById('nsuCategory').value;
    const qtyOnHand = readOptionalNonNegativeInteger(document.getElementById('nsuQty'));
    const reorderThreshold = readOptionalNonNegativeInteger(document.getElementById('nsuThreshold'));
    const lastRestocked = document.getElementById('nsuRestocked').value || null;
    const notes = document.getElementById('nsuNotes').value.trim() || null;

    const blockers = [];
    const advisory = [];

    if (!id) blockers.push('An id is required.');
    else if (suppliesLog.some(x => x.id === id)) {
      blockers.push('"' + id + '" is already used by another supply, ids must be unique.');
    }
    if (!name) blockers.push('A name is required.');
    if (!category) blockers.push('Select a category.');
    if (qtyOnHand === undefined) blockers.push('Enter a valid whole-number quantity of 0 or more, or leave it blank.');
    if (reorderThreshold === undefined) blockers.push('Enter a valid whole-number reorder point of 0 or more, or leave it blank.');

    if (blockers.length) {
      warningsBox.textContent = blockers.join(' ');
      output.hidden = true;
      copyBtn.hidden = true;
      return;
    }

    const supply = { id, name, category, qtyOnHand, reorderThreshold, lastRestocked, notes };

    if (qtyOnHand == null) {
      advisory.push('No quantity logged yet, low-stock check can\'t run until a real count is entered.');
    } else if (reorderThreshold == null) {
      advisory.push('Quantity logged but no reorder point set, low-stock check can\'t fire without both.');
    } else if (isSupplyLowStock(supply)) {
      advisory.push('Already at or below the reorder point, this will show as low stock right away.');
    }

    advisory.push(...emDashAdvisory(supply, ['name', 'notes']));
    warningsBox.textContent = advisory.join(' ');
    output.value = JSON.stringify(supply, null, 2) + ',';
    output.hidden = false;
    copyBtn.hidden = false;
  });

  copyBtn.addEventListener('click', () => {
    copyText(output.value).then(() => {
      const original = copyBtn.textContent;
      copyBtn.textContent = 'Copied!';
      live.textContent = 'Supply JSON copied to clipboard.';
      draftGuard.clearDraft();
      setTimeout(() => { copyBtn.textContent = original; }, 1800);
    }).catch(() => { live.textContent = 'Could not copy to clipboard.'; });
  });
}

// Same quick-log convention as the tools above, for acquisitions.json.
// listingIds comes in as a comma-separated field (a lot can feed several
// items) and gets split/trimmed into a real array; an id that doesn't match
// anything currently in listings.json is only an advisory, not a blocker,
// since a lot not itemized there yet is a real, expected state.
function wireQuickLogAcquisitionTool() {
  const form = document.getElementById('quickAcquisitionForm');
  if (!form) return;
  const warningsBox = document.getElementById('naqWarnings');
  const output = document.getElementById('naqOutput');
  const copyBtn = document.getElementById('naqCopyBtn');
  const live = document.getElementById('quickLogAcquisitionLive');
  const draftGuard = attachDraftGuard(form, 'garage-naq-draft-v1', {
    bannerId: 'naqDraftBanner', timeId: 'naqDraftBannerTime', discardId: 'naqDiscardDraftBtn',
    onDiscard: () => { output.hidden = true; copyBtn.hidden = true; warningsBox.textContent = ''; }
  });

  form.addEventListener('submit', e => {
    e.preventDefault();
    const id = document.getElementById('naqId').value.trim();
    const source = document.getElementById('naqSource').value;
    const sourceName = document.getElementById('naqSourceName').value.trim() || null;
    const date = document.getElementById('naqDate').value || null;
    const pricePaid = readOptionalNonNegativeInput(document.getElementById('naqPricePaid'));
    const itemCount = readOptionalNonNegativeInteger(document.getElementById('naqItemCount'));
    const listingIds = document.getElementById('naqListingIds').value
      .split(',').map(s => s.trim()).filter(Boolean);
    const notes = document.getElementById('naqNotes').value.trim() || null;

    const blockers = [];
    const advisory = [];

    if (!id) blockers.push('An id is required.');
    else if (acquisitionsLog.some(x => x.id === id)) {
      blockers.push('"' + id + '" is already used by another acquisition, ids must be unique.');
    }
    if (!source) blockers.push('Select a source.');
    if (pricePaid === undefined) blockers.push('Enter a valid price paid of 0 or more, or leave it blank.');
    if (itemCount === undefined) blockers.push('Enter a valid whole-number item count of 0 or more, or leave it blank.');

    if (blockers.length) {
      warningsBox.textContent = blockers.join(' ');
      output.hidden = true;
      copyBtn.hidden = true;
      return;
    }

    if (pricePaid != null && itemCount == null) {
      advisory.push('Price paid is logged but item count is not, per-item cost can\'t be computed without both.');
    } else if (pricePaid == null && itemCount != null) {
      advisory.push('Item count is logged but price paid is not, per-item cost can\'t be computed without both.');
    }
    listingIds.forEach(lid => {
      if (!listings.some(l => l.id === lid)) {
        advisory.push('"' + lid + '" does not match any listing in listings.json yet, fine if it\'s not itemized there yet.');
      }
    });

    const acquisition = { id, source, sourceName, date, pricePaid, itemCount, listingIds, notes };

    advisory.push(...emDashAdvisory(acquisition, ['sourceName', 'notes']));
    warningsBox.textContent = advisory.join(' ');
    output.value = JSON.stringify(acquisition, null, 2) + ',';
    output.hidden = false;
    copyBtn.hidden = false;
  });

  copyBtn.addEventListener('click', () => {
    copyText(output.value).then(() => {
      const original = copyBtn.textContent;
      copyBtn.textContent = 'Copied!';
      live.textContent = 'Acquisition JSON copied to clipboard.';
      draftGuard.clearDraft();
      setTimeout(() => { copyBtn.textContent = original; }, 1800);
    }).catch(() => { live.textContent = 'Could not copy to clipboard.'; });
  });
}

// AI photo-to-listing drafter. Two-stage flow: stage 1 (draft) sends real
// item photos to /api/garage/draft-listing and shows every field with its
// confidence and reasoning, purely informational, nothing saved. Stage 2
// (finalize) only appears once a draft exists, asks for the handful of
// fields the drafter can't know on its own (a unique id, which platforms
// this is actually headed to, status) and then runs the exact same
// generate-JSON-only, save-nothing flow as wireQuickLogTool above. The rich
// fields the AI drafts (category, condition notes, description, shipping
// dimensions, comps) have no dedicated column in listings.json, so they get
// folded into the free-text notes field rather than silently dropped.
const CONFIDENCE_BADGE_CLASS = { high: 'badge-fresh', medium: 'badge-due', low: 'badge-decline' };
const MAX_PHOTO_DRAFT_IMAGES = 8;
const PHOTO_DRAFT_MAX_DIMENSION = 1568; // Claude's own documented sweet spot for image input

function slugifyForListingId(title) {
  return (title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'item';
}

// Downscales client-side before the photo ever leaves the browser: a raw
// phone photo can run 3-4000px on the long edge, well past what the model
// actually uses (it downsamples internally anyway), so sending it full-size
// only costs upload time and server body-size headroom for no real gain in
// what the model can see.
function resizeImageForDraft(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      // Uncaught here (a hardened browser handing back a null 2d context, a
      // corrupt image decoding enough to fire onload but not enough to draw)
      // previously left the Promise this executor returns never settling,
      // since a throw inside a DOM event handler doesn't reject it on its
      // own. That hung the caller's Promise.all(files.map(...)) forever on
      // one bad photo, stuck on "Reading photos..." with no error shown.
      try {
        const scale = Math.min(1, PHOTO_DRAFT_MAX_DIMENSION / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Could not get a 2d canvas context for ' + file.name);
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        resolve({ mediaType: 'image/jpeg', dataBase64: dataUrl.split(',')[1] });
      } catch (err) {
        reject(new Error('Could not process ' + file.name + ': ' + err.message));
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read ' + file.name + ' as an image')); };
    img.src = url;
  });
}

function confidenceBadgeHtml(confidence) {
  const cls = CONFIDENCE_BADGE_CLASS[confidence] || 'badge-hold';
  return `<span class="badge ${cls}">${escapeHtml(confidence || 'unknown')} confidence</span>`;
}

// One editable field block: label, confidence badge, an input the human can
// correct pre-filled with the AI's own value, and its reasoning underneath so
// the "why" is never hidden behind the value. multiline picks a textarea for
// the longer prose fields (description, condition notes) over a single-line
// input.
function photoDraftFieldHtml(key, label, field, multiline) {
  if (!field) return '';
  const value = field.value == null ? '' : String(field.value);
  const inputTag = multiline
    ? `<textarea class="quick-log-input photo-draft-field-input" id="pdField_${key}" rows="3">${escapeHtml(value)}</textarea>`
    : `<input class="quick-log-input photo-draft-field-input" id="pdField_${key}" type="text" value="${escapeHtml(value)}">`;
  return `
    <div class="photo-draft-field">
      <div class="photo-draft-field-head">
        <label class="quick-log-label" for="pdField_${key}">${escapeHtml(label)}</label>
        ${confidenceBadgeHtml(field.confidence)}
      </div>
      ${inputTag}
      ${field.reasoning ? `<p class="photo-draft-reasoning">${escapeHtml(field.reasoning)}</p>` : ''}
    </div>`;
}

function photoDraftCompsHtml(priceField) {
  const comps = (priceField && priceField.comps) || [];
  if (!comps.length) return '';
  return `
    <div class="photo-draft-comps">
      <p class="quick-log-label">Real comps used</p>
      <ul class="photo-draft-comps-list">
        ${comps.map(c => `
          <li>
            ${c.url ? `<a href="${escapeHtml(c.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(c.title || 'Untitled comp')}</a>` : escapeHtml(c.title || 'Untitled comp')}
            : ${c.price != null ? formatUsd(c.price) : 'price unknown'}${c.platform ? ', ' + escapeHtml(c.platform) : ''}${c.condition ? ', ' + escapeHtml(c.condition) : ''}
          </li>
        `).join('')}
      </ul>
    </div>`;
}

function wirePhotoDraftTool() {
  const photoInput = document.getElementById('pdPhotoInput');
  if (!photoInput) return;
  const thumbsBox = document.getElementById('pdThumbs');
  const notesInput = document.getElementById('pdNotes');
  const draftBtn = document.getElementById('pdDraftBtn');
  const warningsBox = document.getElementById('pdWarnings');
  const resultsBox = document.getElementById('pdResults');
  const actionsRow = document.getElementById('pdActionsRow');
  const generateBtn = document.getElementById('pdGenerateBtn');
  const output = document.getElementById('pdOutput');
  const copyBtn = document.getElementById('pdCopyBtn');

  let stagedImages = []; // [{mediaType, dataBase64, name}]
  let lastDraft = null;

  photoInput.addEventListener('change', async () => {
    const files = Array.from(photoInput.files || []).slice(0, MAX_PHOTO_DRAFT_IMAGES);
    warningsBox.textContent = '';
    if (photoInput.files.length > MAX_PHOTO_DRAFT_IMAGES) {
      warningsBox.textContent = `Only the first ${MAX_PHOTO_DRAFT_IMAGES} photos were kept, that's the max per draft.`;
    }
    thumbsBox.innerHTML = '<p class="photo-draft-loading">Reading photos...</p>';
    try {
      const resized = await Promise.all(files.map(f => resizeImageForDraft(f)));
      stagedImages = resized.map((r, i) => ({ ...r, name: files[i].name }));
      thumbsBox.innerHTML = stagedImages.map((img, i) =>
        `<img class="photo-draft-thumb" src="data:${img.mediaType};base64,${img.dataBase64}" alt="${escapeHtml(img.name)}" title="${escapeHtml(img.name)}">`
      ).join('');
    } catch (err) {
      warningsBox.textContent = err.message;
      thumbsBox.innerHTML = '';
      stagedImages = [];
    }
  });

  draftBtn.addEventListener('click', async () => {
    if (!stagedImages.length) {
      warningsBox.textContent = 'Add at least one photo first.';
      return;
    }
    warningsBox.textContent = '';
    resultsBox.hidden = true;
    actionsRow.hidden = true;
    output.hidden = true;
    copyBtn.hidden = true;
    const originalLabel = draftBtn.textContent;
    draftBtn.textContent = 'Drafting... (real comp search, can take up to 2 minutes)';
    draftBtn.disabled = true;
    try {
      const r = await fetch('/api/garage/draft-listing', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          images: stagedImages.map(({ mediaType, dataBase64 }) => ({ mediaType, dataBase64 })),
          notes: notesInput.value.trim() || undefined
        })
      });
      const data = await r.json();
      if (!r.ok) throw new Error((data && data.error && (data.error.message || data.error)) || 'Draft request failed');
      lastDraft = data.draft;
      renderPhotoDraftResults(lastDraft);
      resultsBox.hidden = false;
      actionsRow.hidden = false;
    } catch (err) {
      warningsBox.textContent = 'Could not draft a listing: ' + err.message;
    } finally {
      draftBtn.textContent = originalLabel;
      draftBtn.disabled = false;
    }
  });

  function renderPhotoDraftResults(draft) {
    const flags = draft.flagsForReview || [];
    resultsBox.innerHTML = `
      ${flags.length ? `<div class="callout photo-draft-flags"><strong>Flagged for review:</strong> ${flags.map(f => escapeHtml(f)).join(' &middot; ')}</div>` : ''}
      ${photoDraftFieldHtml('itemSummary', 'Item summary', draft.itemSummary, false)}
      <div class="photo-draft-field-row">
        ${photoDraftFieldHtml('brand', 'Brand', draft.brand, false)}
        ${photoDraftFieldHtml('exactModelOrVariant', 'Exact model / variant', draft.exactModelOrVariant, false)}
        ${photoDraftFieldHtml('size', 'Size', draft.size, false)}
        ${photoDraftFieldHtml('color', 'Color', draft.color, false)}
      </div>
      ${photoDraftFieldHtml('title', 'Title', draft.title, false)}
      ${photoDraftFieldHtml('category', 'Category', draft.category, false)}
      ${photoDraftFieldHtml('conditionNotes', 'Condition notes', draft.conditionNotes, true)}
      ${photoDraftFieldHtml('description', 'Description', draft.description, true)}
      ${photoDraftFieldHtml('suggestedPrice', 'Suggested price (USD)', draft.suggestedPrice, false)}
      ${photoDraftCompsHtml(draft.suggestedPrice)}
      ${photoDraftFieldHtml('shippingDimensions', 'Shipping dimensions & weight', draft.shippingDimensions, false)}
      <div class="photo-draft-finalize">
        <h3 class="quick-log-title font-mono">Finalize for listings.json</h3>
        <label class="quick-log-label" for="pdId">Id (unique slug)</label>
        <input class="quick-log-input" type="text" id="pdId" value="${escapeHtml(slugifyForListingId(draft.title && draft.title.value))}">
        <label class="quick-log-label" id="pdPlatformsLabel">Platforms (at least one, where this is actually headed)</label>
        <div class="quick-log-checkbox-row" role="group" aria-labelledby="pdPlatformsLabel">
          <label class="quick-log-checkbox"><input type="checkbox" class="pd-platform" value="ebay"> eBay</label>
          <label class="quick-log-checkbox"><input type="checkbox" class="pd-platform" value="vinted"> Vinted</label>
          <label class="quick-log-checkbox"><input type="checkbox" class="pd-platform" value="poshmark"> Poshmark</label>
          <label class="quick-log-checkbox"><input type="checkbox" class="pd-platform" value="depop"> Depop</label>
        </div>
        <label class="quick-log-label" for="pdCostBasis">Cost basis, USD (optional)</label>
        <input class="quick-log-input" type="number" id="pdCostBasis" min="0" step="0.01">
        <label class="quick-log-label" for="pdLocation">Storage location (optional)</label>
        <input class="quick-log-input" type="text" id="pdLocation" placeholder="e.g. Bin 3">
      </div>
    `;
  }

  generateBtn.addEventListener('click', () => {
    if (!lastDraft) return;
    const readField = key => {
      const el = document.getElementById('pdField_' + key);
      return el ? el.value.trim() : '';
    };
    const id = document.getElementById('pdId').value.trim();
    const platforms = Array.from(document.querySelectorAll('.pd-platform:checked')).map(el => el.value);
    const costBasis = readOptionalNonNegativeInput(document.getElementById('pdCostBasis'));
    const location = document.getElementById('pdLocation').value.trim() || null;
    const title = readField('title');
    const priceRaw = readField('suggestedPrice');
    const price = priceRaw === '' ? null : Number(priceRaw);

    const blockers = [];
    if (!id) blockers.push('An id is required.');
    else if (listings.some(l => l.id === id)) blockers.push('"' + id + '" is already used by another listing, ids must be unique.');
    if (!title) blockers.push('A title is required.');
    if (!platforms.length) blockers.push('Select at least one platform this is actually headed to.');
    if (priceRaw !== '' && (Number.isNaN(price) || price < 0)) blockers.push('Suggested price must be a number 0 or more, or cleared.');
    if (costBasis === undefined) blockers.push('Enter a valid cost basis of $0 or more, or leave it blank.');

    if (blockers.length) {
      warningsBox.textContent = blockers.join(' ');
      output.hidden = true;
      copyBtn.hidden = true;
      return;
    }

    // No dedicated columns exist in listings.json for category/condition/
    // description/shipping (see the schema-help table above), so the rest of
    // what the AI drafted rides along in notes rather than getting silently
    // dropped once this becomes a real listings.json entry; still fully
    // human-editable right in the output textarea before it's pasted anywhere.
    const noteParts = [
      readField('brand') && `Brand: ${readField('brand')}`,
      readField('exactModelOrVariant') && `Model/variant: ${readField('exactModelOrVariant')}`,
      readField('size') && `Size: ${readField('size')}`,
      readField('color') && `Color: ${readField('color')}`,
      readField('category') && `Category: ${readField('category')}`,
      readField('conditionNotes') && `Condition: ${readField('conditionNotes')}`,
      readField('description') && `Description: ${readField('description')}`,
      readField('shippingDimensions') && `Shipping: ${readField('shippingDimensions')}`
    ].filter(Boolean);

    const candidate = {
      id,
      title,
      price: price == null || Number.isNaN(price) ? null : price,
      costBasis: costBasis === undefined ? null : costBasis,
      platforms,
      soldOn: [],
      listingUrls: platforms.reduce((o, p) => { o[p] = null; return o; }, {}),
      status: 'draft',
      datePublished: null,
      notes: noteParts.length ? noteParts.join(' | ') : null,
      location
    };

    output.value = JSON.stringify(candidate, null, 2) + ',';
    output.hidden = false;
    copyBtn.hidden = false;
  });

  copyBtn.addEventListener('click', () => {
    copyText(output.value).then(() => {
      const original = copyBtn.textContent;
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = original; }, 1800);
    }).catch(() => { warningsBox.textContent = 'Could not copy to clipboard.'; });
  });
}

wireCalc();
wireBreakEven();
wireBundle();
wirePoshWeightCheck();
wirePromotedCalc();
wireOfferGuide();
wireMessageTemplates();
wireChecklist();
wirePacePlanner();
wirePoshmarkShareTracker();
wireQuickLogTool();
wireQuickLogSaleTool();
wireQuickLogExpenseTool();
wireQuickLogDisputeTool();
wireQuickLogSupplyTool();
wireQuickLogAcquisitionTool();
wirePhotoDraftTool();
initPhotoAudit();
renderSeasonalCalendarHighlight();
renderFeeScheduleFreshness();
renderBestTimeFreshness();
renderTitleSpecsFreshness();
renderReturnDisputeFreshness();
renderScamPatternsFreshness();
renderSellerStandardsFreshness();
renderTaxTrackerFreshness();
renderElectronicsRulesFreshness();
renderPackagingRulesFreshness();
renderAuthenticationRulesFreshness();
renderShippingCostFreshness();

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

let initialGarageView = 'table';
try { if (localStorage.getItem('garage-view') === 'kanban') initialGarageView = 'kanban'; } catch { /* private browsing etc */ }
setGarageView(initialGarageView);

loadData();

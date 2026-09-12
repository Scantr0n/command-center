let cards = [];
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

function isExample(c) {
  return c.id === 'example-row-not-real';
}

// Card market prices drift over months, not days, so this is a much longer
// window than the 7-day staleness check used elsewhere in Command Center
// (e.g. the Sondrik download tracker). It just means "worth a re-check
// before relying on this number," not that the price is wrong.
const PRICE_STALE_AFTER_DAYS = 180;

function daysSince(isoDate) {
  if (!isoDate) return null;
  const then = new Date(isoDate + 'T00:00:00Z').getTime();
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
  PSA: { deepLink: cert => 'https://www.psacard.com/cert/' + encodeURIComponent(cert) },
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

function isStale(c) {
  if (c.estimatedValue == null || !c.datePriced) return false;
  const age = daysSince(c.datePriced);
  return age != null && age > PRICE_STALE_AFTER_DAYS;
}

async function loadCards() {
  const errBox = document.getElementById('tableEmpty');
  try {
    const res = await fetch('/cgt/data/cards.json');
    if (!res.ok) throw new Error('Server returned ' + res.status);
    const data = await res.json();
    cards = data.cards || [];
    renderStats();
    renderValueBreakdown();
    renderPricingActivity();
    renderBatchFilter();
    applyFiltersAndRender();
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
  const bySport = { hockey: 0, baseball: 0, football: 0 };
  real.forEach(c => { if (bySport[c.sport] != null) bySport[c.sport]++; });

  const tiles = [
    { value: real.length, label: 'Cards logged', sub: cards.length !== real.length ? '+ 1 example row' : null },
    { value: priced.length ? formatUsd(totalValue) : '$0', label: 'Total estimated value', sub: priced.length ? priced.length + ' priced' : 'nothing priced yet' },
    // Splitting the dollar total by basis, not just the card count, makes the
    // "how much of this is a real sale vs. an estimate" question answerable
    // at a glance, which is the whole point of never blending the two silently.
    { value: saleCards.length, label: 'Recent-sale priced', sub: saleCards.length ? formatUsd(saleValue) : null },
    { value: compCards.length, label: 'Comp-estimate priced', sub: compCards.length ? formatUsd(compValue) : null },
    { value: stale, label: 'Priced 180+ days ago', sub: stale ? 'worth a re-check' : null },
    { value: bySport.hockey + ' / ' + bySport.baseball + ' / ' + bySport.football, label: 'Hockey / baseball / football', sub: null }
  ];

  document.getElementById('statRow').innerHTML = tiles.map(t => `
    <div class="stat-tile">
      <div class="stat-tile-value font-display">${escapeHtml(String(t.value))}</div>
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

function renderBreakdownList(title, groups) {
  if (!groups.length) {
    return `
      <div class="breakdown-card">
        <h3 class="breakdown-title font-mono">${escapeHtml(title)}</h3>
        <p class="breakdown-empty">No priced real cards yet.</p>
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
      <span class="breakdown-value font-mono">${formatUsd(g.value)}</span>
    </div>
  `).join('');
  return `
    <div class="breakdown-card">
      <h3 class="breakdown-title font-mono">${escapeHtml(title)}</h3>
      <div class="breakdown-list">${rows}</div>
    </div>
  `;
}

function renderValueBreakdown() {
  const el = document.getElementById('breakdownGrid');
  el.innerHTML =
    renderBreakdownList('By sport', buildValueGroups('sport')) +
    renderBreakdownList('By grading company', buildValueGroups('gradingCompany'));
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
    (needsToggle ? `<button type="button" class="activity-toggle font-mono" id="pricingActivityToggle">Show all ${events.length}</button>` : '');
  const toggleBtn = document.getElementById('pricingActivityToggle');
  const listEl = document.getElementById('pricingActivityList');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      const collapsed = listEl.classList.toggle('is-collapsed');
      toggleBtn.textContent = collapsed ? `Show all ${events.length}` : 'Show fewer';
    });
  }
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
    empty.hidden = false;
    empty.setAttribute('role', 'status');
    empty.textContent = cards.length ? 'No cards match the current filters.' : 'No cards logged yet.';
    return;
  }
  empty.hidden = true;

  tbody.innerHTML = filtered.map(c => `
    <tr tabindex="0" role="button" data-id="${escapeHtml(c.id)}">
      <td>
        <div class="cell-card-name">${escapeHtml(c.cardName || 'Untitled card')}${isExample(c) ? ' <span class="badge badge-example">example</span>' : ''}</div>
        ${c.year ? `<div class="cell-card-meta">${escapeHtml(String(c.year))}</div>` : ''}
      </td>
      <td class="cell-muted">${c.sport ? `<span class="badge badge-sport">${escapeHtml(c.sport)}</span>` : '<span class="cell-value empty">unknown</span>'}</td>
      <td class="cell-muted">${c.gradingCompany ? escapeHtml(c.gradingCompany) : '<span class="cell-value empty">unknown</span>'}</td>
      <td class="cell-muted">${c.grade != null ? escapeHtml(String(c.grade)) : '<span class="cell-value empty">unknown</span>'}</td>
      <td class="cell-value${c.estimatedValue == null ? ' empty' : ''}">${c.estimatedValue != null ? formatUsd(c.estimatedValue) : 'not priced'}</td>
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

function field(label, value, isEmpty) {
  return `
    <div class="field-row">
      <div class="field-label">${escapeHtml(label)}</div>
      <div class="field-value${isEmpty ? ' empty' : ''}">${isEmpty ? 'not logged' : escapeHtml(value)}</div>
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
  body += field('Estimated value', activeCard.estimatedValue != null ? formatUsd(activeCard.estimatedValue) : null, activeCard.estimatedValue == null);
  body += field('Valuation basis', activeCard.valuationBasis === 'recent-sale' ? 'Recent sale' : activeCard.valuationBasis === 'comp-estimate' ? 'Comp-based estimate' : null, !activeCard.valuationBasis);
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

const CSV_COLUMNS = [
  ['cardName', 'Card'], ['year', 'Year'], ['sport', 'Sport'], ['gradingCompany', 'Grading company'],
  ['grade', 'Grade'], ['certNumber', 'Cert number'], ['estimatedValue', 'Estimated value'],
  ['valuationBasis', 'Valuation basis'], ['compNote', 'Comp note'], ['sourceNote', 'Source'],
  ['datePriced', 'Date priced'], ['backlogBatch', 'Backlog batch'], ['notes', 'Notes']
];

// Exports exactly what the table currently shows (same filters and sort
// applied), not the full dataset, so the file matches what's on screen.
document.getElementById('csvBtn').addEventListener('click', () => {
  const rows = sortRows(cards.filter(matchesFilters));
  const header = CSV_COLUMNS.map(([, label]) => csvField(label)).join(',');
  const lines = rows.map(c => CSV_COLUMNS.map(([key]) => csvField(c[key])).join(','));
  const csv = [header, ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'cgt-inventory-' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

loadCards();

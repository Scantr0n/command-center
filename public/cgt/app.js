let cards = [];
let activeCard = null;
let lastFocusedEl = null;
let searchTerm = '';
let activeSport = 'all';
let activeBasis = 'all';
let activeGrader = 'all';
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
  const sort = params.get('sort');
  const dir = params.get('dir');
  if (q) searchTerm = q;
  if (sport && VALID_SPORTS.includes(sport)) activeSport = sport;
  if (basis && VALID_BASES.includes(basis)) activeBasis = basis;
  if (grader && VALID_GRADERS.includes(grader)) activeGrader = grader;
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
  const bySale = priced.filter(c => c.valuationBasis === 'recent-sale').length;
  const byComp = priced.filter(c => c.valuationBasis === 'comp-estimate').length;
  const stale = priced.filter(isStale).length;
  const bySport = { hockey: 0, baseball: 0, football: 0 };
  real.forEach(c => { if (bySport[c.sport] != null) bySport[c.sport]++; });

  const tiles = [
    { value: real.length, label: 'Cards logged', sub: cards.length !== real.length ? '+ 1 example row' : null },
    { value: priced.length ? formatUsd(totalValue) : '$0', label: 'Total estimated value', sub: priced.length ? priced.length + ' priced' : 'nothing priced yet' },
    { value: bySale, label: 'Recent-sale priced', sub: null },
    { value: byComp, label: 'Comp-estimate priced', sub: null },
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

function basisBadge(c) {
  if (c.estimatedValue == null) return '<span class="cell-value empty">not priced</span>';
  if (c.valuationBasis === 'recent-sale') return '<span class="badge badge-sale">recent sale</span>';
  if (c.valuationBasis === 'comp-estimate') return '<span class="badge badge-comp">comp estimate</span>';
  return '<span class="badge badge-comp">unlabeled</span>';
}

function matchesFilters(c) {
  const term = searchTerm.trim().toLowerCase();
  const matchesSearch = !term
    || (c.cardName || '').toLowerCase().includes(term)
    || (c.certNumber || '').toLowerCase().includes(term)
    || String(c.year ?? '').includes(term);
  const matchesSport = activeSport === 'all' || c.sport === activeSport;
  const matchesGrader = activeGrader === 'all' || c.gradingCompany === activeGrader;
  let matchesBasis = true;
  if (activeBasis === 'unpriced') matchesBasis = c.estimatedValue == null;
  else if (activeBasis !== 'all') matchesBasis = c.valuationBasis === activeBasis;
  return matchesSearch && matchesSport && matchesGrader && matchesBasis;
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

function applyFiltersAndRender() {
  syncUrl();
  const filtered = sortRows(cards.filter(matchesFilters));
  const tbody = document.getElementById('cardTableBody');
  const empty = document.getElementById('tableEmpty');
  updateSortHeaders();

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
  document.getElementById('modalClose').focus();
}

function closeModal() {
  document.getElementById('modalOverlay').hidden = true;
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

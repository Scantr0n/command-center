let listings = [];
let searchTerm = '';
let activePlatform = 'all';
let sortKey = null;
let sortDir = 'asc';

// Filters, search, and sort are mirrored into the URL query string so a
// specific view (e.g. "eBay listings sorted by price") can be bookmarked or
// shared as a link, same convention as the CSM and CGT hubs.
const VALID_PLATFORMS = ['ebay', 'vinted', 'poshmark', 'depop'];

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

const PLATFORM_LABELS = { ebay: 'eBay', vinted: 'Vinted', poshmark: 'Poshmark', depop: 'Depop' };
const STAGE_LABELS = { draft: 'Draft', 'ready-to-post': 'Ready to post', live: 'Live', sold: 'Sold' };
const EVENT_TYPE_LABELS = { 'bug-fix': 'Bug fix', 'photo-audit': 'Photo audit', other: 'Other' };
const PAYOUT_PLATFORMS = ['ebay', 'vinted', 'poshmark', 'depop'];

// Standard published 2026 seller fee schedules, not a live account connection.
// See the "Fee formulas used" details on the page for the rate each case applies.
function estimateNetPayout(platform, price) {
  if (price == null) return null;
  switch (platform) {
    case 'ebay': return price - (price * 0.1325 + price * 0.029 + 0.30);
    case 'vinted': return price;
    case 'poshmark': return price < 15 ? price - 2.95 : price * 0.80;
    case 'depop': return price - (price * 0.033 + 0.45);
    default: return null;
  }
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function formatUsd(n) {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

async function loadData() {
  const errBox = document.getElementById('tableEmpty');
  try {
    const [listingsRes, pipelineRes, activityRes] = await Promise.all([
      fetch('/garage/data/listings.json'),
      fetch('/garage/data/pipeline.json'),
      fetch('/garage/data/activity.json')
    ]);
    if (!listingsRes.ok) throw new Error('listings.json returned ' + listingsRes.status);
    if (!pipelineRes.ok) throw new Error('pipeline.json returned ' + pipelineRes.status);
    if (!activityRes.ok) throw new Error('activity.json returned ' + activityRes.status);

    const listingsData = await listingsRes.json();
    const pipelineData = await pipelineRes.json();
    const activityData = await activityRes.json();

    listings = listingsData.listings || [];
    renderStats(listings, pipelineData.stages || []);
    renderPipeline(pipelineData.stages || []);
    applyFiltersAndRender();
    renderPayoutTable(listings);
    renderActivity(activityData.events || []);
  } catch (e) {
    listings = [];
    document.getElementById('listingTableBody').innerHTML = '';
    errBox.hidden = false;
    errBox.setAttribute('role', 'alert');
    errBox.textContent = "Couldn't load Garage data: " + e.message;
  }
}

function remainingPlatforms(l) {
  const soldOn = l.soldOn || [];
  return (l.platforms || []).filter(p => !soldOn.includes(p));
}

function renderStats(listings, stages) {
  const live = listings.filter(l => l.status === 'live');
  const totalValue = live.reduce((s, l) => s + (l.price || 0), 0);
  const platformCounts = {};
  live.forEach(l => remainingPlatforms(l).forEach(p => { platformCounts[p] = (platformCounts[p] || 0) + 1; }));
  const activePlatforms = Object.keys(platformCounts).length;
  const listingInstances = live.reduce((s, l) => s + remainingPlatforms(l).length, 0);
  const readyStage = stages.find(s => s.stage === 'ready-to-post');
  const atRiskCount = live.filter(l => (l.soldOn || []).length > 0 && remainingPlatforms(l).length > 0).length;

  const tiles = [
    { value: listingInstances, label: 'Live listing instances', sub: live.length + ' unique item(s)' },
    { value: live.length, label: 'Unique items live', sub: null },
    { value: activePlatforms, label: 'Platforms active', sub: Object.keys(platformCounts).map(p => PLATFORM_LABELS[p] || p).join(', ') || null },
    { value: formatUsd(totalValue), label: 'Total live asking value', sub: null },
    { value: readyStage ? readyStage.count : 0, label: 'Drafts ready to post', sub: readyStage && readyStage.note ? readyStage.note : null },
    { value: atRiskCount, label: 'Needs delisting elsewhere', sub: atRiskCount ? 'Sold on one platform, still live on others' : null, warn: atRiskCount > 0 }
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

function platformBadges(platforms, soldOn) {
  const sold = soldOn || [];
  return (platforms || []).map(p => {
    const isSold = sold.includes(p);
    const cls = isSold ? 'badge badge-sold-elsewhere' : `badge badge-${escapeHtml(p)}`;
    const label = escapeHtml(PLATFORM_LABELS[p] || p) + (isSold ? ' (sold)' : '');
    return `<span class="${cls}">${label}</span>`;
  }).join('');
}

function matchesFilters(l) {
  const term = searchTerm.trim().toLowerCase();
  const matchesSearch = !term || (l.title || '').toLowerCase().includes(term);
  const matchesPlatform = activePlatform === 'all' || (l.platforms || []).includes(activePlatform);
  return l.status === 'live' && matchesSearch && matchesPlatform;
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

function applyFiltersAndRender() {
  const filtered = sortRows(listings.filter(matchesFilters));
  const tbody = document.getElementById('listingTableBody');
  const empty = document.getElementById('tableEmpty');
  updateSortHeaders();

  if (!filtered.length) {
    tbody.innerHTML = '';
    empty.hidden = false;
    empty.setAttribute('role', 'status');
    empty.textContent = listings.length ? 'No live listings match the current filters.' : 'No live listings logged yet.';
    syncUrl();
    return;
  }
  empty.hidden = true;

  tbody.innerHTML = filtered.map(l => `
    <tr>
      <td>
        <div class="cell-card-name">${escapeHtml(l.title || 'Untitled item')}</div>
        ${l.notes ? `<div class="cell-card-meta">${escapeHtml(l.notes)}</div>` : ''}
      </td>
      <td class="cell-value${l.price == null ? ' empty' : ''}">${l.price != null ? formatUsd(l.price) : 'not set'}</td>
      <td class="cell-platforms">${platformBadges(l.platforms, l.soldOn)}</td>
      <td class="cell-muted">${l.datePublished ? escapeHtml(l.datePublished) : '<span class="cell-value empty">not logged</span>'}</td>
    </tr>
  `).join('');
  syncUrl();
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

  tbody.innerHTML = rows.map(l => `
    <tr>
      <td><div class="cell-card-name">${escapeHtml(l.title || 'Untitled item')}</div></td>
      <td class="cell-value${l.price == null ? ' empty' : ''}">${l.price != null ? formatUsd(l.price) : 'not set'}</td>
      ${PAYOUT_PLATFORMS.map(p => {
        if (!(l.platforms || []).includes(p)) return '<td class="cell-value empty">not listed</td>';
        const net = estimateNetPayout(p, l.price);
        return `<td class="cell-value">${net != null ? formatUsd(net) : 'not set'}</td>`;
      }).join('')}
    </tr>
  `).join('');
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

document.getElementById('searchInput').addEventListener('input', (e) => {
  searchTerm = e.target.value;
  applyFiltersAndRender();
});

// Same "/" jumps to search shortcut as the main Command Center dashboard.
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement.id !== 'searchInput') {
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
setInitialChipState('platformFilter', 'data-platform', activePlatform);
wireChipGroup('platformFilter', 'data-platform', (v) => { activePlatform = v; });

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
  ['title', 'Item'], ['price', 'Price'], ['platforms', 'Platforms'], ['soldOn', 'Sold elsewhere'],
  ['status', 'Status'], ['datePublished', 'Published'], ['notes', 'Notes']
];

// Exports exactly what the table currently shows (same search, platform
// filter, and sort applied), not the full dataset, so the file matches
// what's on screen.
document.getElementById('csvBtn').addEventListener('click', () => {
  const rows = sortRows(listings.filter(matchesFilters)).map(l => ({
    ...l,
    platforms: (l.platforms || []).map(p => PLATFORM_LABELS[p] || p).join('; '),
    soldOn: (l.soldOn || []).map(p => PLATFORM_LABELS[p] || p).join('; ')
  }));
  const header = CSV_COLUMNS.map(([, label]) => csvField(label)).join(',');
  const lines = rows.map(l => CSV_COLUMNS.map(([key]) => csvField(l[key])).join(','));
  const csv = [header, ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'garage-listings-' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

loadData();

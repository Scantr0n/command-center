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
// eBay moved to managed payments years ago: the final value fee is one combined
// rate with no separate card-processing surcharge on top, so the old "13.25% +
// 2.9% + $0.30" formula here was double-charging a processing fee that no
// longer exists, and undercounting every eBay net payout on the page by it.
function estimateNetPayout(platform, price) {
  if (price == null) return null;
  switch (platform) {
    case 'ebay': return price - (price * 0.136 + (price > 10 ? 0.40 : 0.30));
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

// A net payout can go negative on a cheap Poshmark listing (its flat $2.95
// fee under $15 exceeds the price), and '$' + (-1.95) renders as the
// confusing "$-1.95" instead of "-$1.95", so the sign goes before the symbol.
function formatUsd(n) {
  const sign = n < 0 ? '-' : '';
  return sign + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
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
  el.textContent = ` Last hand-edited ${when} (${latest.toISOString().slice(0, 10)}).`;
  el.classList.toggle('data-freshness-stale', daysAgo > 14);
}

// Each of the three files is a hand-edited record that can be typo'd at any
// time (see the sibling validate.js scripts). A single Promise.all would fail
// every section over one bad file, e.g. a typo in activity.json alone would
// also blank the listings table and payout section that have nothing to do
// with it. Promise.allSettled lets each section degrade independently instead,
// the same fix Sondrik's loadData already applies for the same reason.
async function loadData() {
  const errBox = document.getElementById('tableEmpty');
  const [listingsResult, pipelineResult, activityResult, salesResult] = await Promise.allSettled([
    fetchJson('/garage/data/listings.json'),
    fetchJson('/garage/data/pipeline.json'),
    fetchJson('/garage/data/activity.json'),
    fetchJson('/garage/data/sales.json')
  ]);
  const listingsData = listingsResult.status === 'fulfilled' ? listingsResult.value.data : null;
  const pipelineData = pipelineResult.status === 'fulfilled' ? pipelineResult.value.data : null;
  const activityData = activityResult.status === 'fulfilled' ? activityResult.value.data : null;
  const salesData = salesResult.status === 'fulfilled' ? salesResult.value.data : null;
  const stages = (pipelineData && pipelineData.stages) || [];
  const sales = (salesData && salesData.sales) || [];

  renderDataFreshness([listingsResult, pipelineResult, activityResult, salesResult]
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value.lastModified));

  if (listingsData) {
    listings = listingsData.listings || [];
    renderStats(listings, stages, sales);
    renderDataQuality(listings);
    applyFiltersAndRender();
    renderCoverage(listings);
    renderTitleFit(listings);
    renderRelist(listings);
    renderPayoutTable(listings);
  } else {
    listings = [];
    document.getElementById('statRow').innerHTML = '';
    document.getElementById('dataQualitySection').hidden = true;
    document.getElementById('listingTableBody').innerHTML = '';
    document.getElementById('coverageTableBody').innerHTML = '';
    document.getElementById('titleFitTableBody').innerHTML = '';
    document.getElementById('relistTableBody').innerHTML = '';
    document.getElementById('payoutTableBody').innerHTML = '';
    errBox.hidden = false;
    errBox.setAttribute('role', 'alert');
    errBox.textContent = "Couldn't load Garage data: " + listingsResult.reason.message;
  }

  if (pipelineData) {
    renderPipeline(stages);
  } else {
    document.getElementById('pipelineRow').innerHTML =
      '<div class="table-empty" role="alert">Failed to load pipeline data: ' + escapeHtml(pipelineResult.reason.message) + '</div>';
  }

  if (activityData) {
    renderActivity(activityData.events || []);
  } else {
    document.getElementById('activityList').innerHTML =
      '<div class="activity-item" role="alert"><div class="activity-item-detail">Failed to load activity data: ' +
      escapeHtml(activityResult.reason.message) + '</div></div>';
  }

  if (salesData) {
    renderSales(sales);
    renderTaxTracker(sales);
  } else {
    document.getElementById('salesTableBody').innerHTML = '';
    const empty = document.getElementById('salesTableEmpty');
    empty.hidden = false;
    empty.setAttribute('role', 'alert');
    empty.textContent = "Couldn't load sales data: " + salesResult.reason.message;
    document.getElementById('taxTrackerBody').innerHTML =
      '<tr><td colspan="6" class="table-empty" role="alert">Failed to load sales data: ' + escapeHtml(salesResult.reason.message) + '</td></tr>';
  }

  initTableScrollShadows();
}

function remainingPlatforms(l) {
  const soldOn = l.soldOn || [];
  return (l.platforms || []).filter(p => !soldOn.includes(p));
}

// Best-case total: for each live item, the highest net payout among the
// platforms it's still actually listed on (excluding ones already sold via
// soldOn, same as every other stat here), falling back to price if fees
// can't be estimated, summed across all items. Not a prediction of what will
// sell where, just what picking the best-fee platform for each item nets.
function bestCaseTotalPayout(live) {
  return live.reduce((sum, l) => {
    const nets = remainingPlatforms(l)
      .map(p => estimateNetPayout(p, l.price))
      .filter(n => n != null);
    if (nets.length) return sum + Math.max(...nets);
    return sum + (l.price || 0);
  }, 0);
}

function renderStats(listings, stages, sales) {
  sales = sales || [];
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
  const dueForRelistCount = live.filter(l => {
    const days = daysSincePublished(l.datePublished);
    return days != null && days >= RELIST_FRESH_DAYS;
  }).length;
  const realizedRevenue = sales.reduce((s, sale) => s + (sale.salePrice || 0), 0);
  const salesWithCost = sales.filter(sale => sale.costBasis != null);
  const realizedProfit = salesWithCost.reduce((s, sale) => {
    const net = estimateNetPayout(sale.platform, sale.salePrice);
    return s + ((net != null ? net : (sale.salePrice || 0)) - sale.costBasis);
  }, 0);

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
    { value: salesWithCost.length ? formatUsd(realizedProfit) : 'not tracked yet', label: 'Realized profit', sub: salesWithCost.length ? `Net payout minus cost basis, ${salesWithCost.length}/${sales.length} sale(s) have a cost logged` : 'No sale has a cost basis logged yet' }
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
    const missingHtml = missing.length
      ? missing.map(p => `<span class="badge badge-missing">${escapeHtml(PLATFORM_LABELS[p] || p)}</span>`).join('')
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

// Real reseller-tooling convention (Vendoo, Crosslist, etc.): eBay, Vinted,
// and Depop's search all favor listing recency, so ~30 days without a sale
// is the common point to relist or renew. Poshmark is the opposite case,
// its Excessive Listing Removal Policy blocks relisting the same item again
// before day 60, so it needs its own later threshold instead of the general
// 30-day one.
const RELIST_FRESH_DAYS = 30;
const POSHMARK_HOLD_DAYS = 60;

// Returns null (not days-ago-unknown-as-zero) when there's no real logged
// date to compute from, so the UI can show an honest "not logged" state
// instead of a misleading "0 days".
function daysSincePublished(dateStr) {
  if (!dateStr) return null;
  const published = new Date(dateStr + 'T00:00:00');
  if (Number.isNaN(published.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - published.getTime()) / 86400000));
}

// Plain-text guidance pieces shared by the on-page badges and the CSV export,
// so both read the exact same underlying judgment instead of two versions
// that could quietly drift apart.
function relistGuidanceParts(l, days) {
  if (days == null) return [{ tier: 'unknown', text: 'log a publish date for guidance' }];
  if (days < RELIST_FRESH_DAYS) {
    return [{ tier: 'fresh', text: `Fresh, ${RELIST_FRESH_DAYS - days}d until a refresh is worth considering` }];
  }
  const platforms = remainingPlatforms(l);
  const parts = [];
  const nonPoshmark = platforms.filter(p => p !== 'poshmark');
  if (nonPoshmark.length) {
    parts.push({ tier: 'due', text: `Relist/renew on ${nonPoshmark.map(p => PLATFORM_LABELS[p] || p).join(', ')}` });
  }
  if (platforms.includes('poshmark')) {
    parts.push(days < POSHMARK_HOLD_DAYS
      ? { tier: 'hold', text: `Hold off on Poshmark until day ${POSHMARK_HOLD_DAYS}` }
      : { tier: 'due', text: 'Eligible to relist on Poshmark' });
  }
  return parts.length ? parts : [{ tier: 'unknown', text: 'nothing left to relist' }];
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

// Flags real listings missing an optional-but-load-bearing field: a live
// item with no datePublished can never get real relist guidance (see
// relistGuidanceParts above, which requires it), and a live item with no
// costBasis silently drops the profit column from its own payout-by-platform
// table in the detail modal (see openModal). Neither is a validate.js error,
// both are schema-documented "leave null until known, never guess" fields,
// so nothing forces a hand-edit to notice the gap. Same "Needs backfill"
// pattern as the CSM/CGT hubs' own data-quality panels, hidden entirely when
// nothing is flagged rather than showing an empty box.
function buildDataQualityFlags(listings) {
  return listings
    .filter(l => l.status === 'live')
    .map(l => {
      const reasons = [];
      if (!l.datePublished) reasons.push('NO DATE PUBLISHED LOGGED (BLOCKS RELIST GUIDANCE)');
      if (l.costBasis == null) reasons.push('NO COST BASIS LOGGED (BLOCKS PROFIT CALC)');
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

function renderDataQuality(listings) {
  const section = document.getElementById('dataQualitySection');
  const list = document.getElementById('dataQualityList');
  const flagged = buildDataQualityFlags(listings);

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

// Real published title-length caps as of September 2026, sourced from each
// platform's own seller/help documentation (see the "Title & photo specs"
// details on the page). eBay and Poshmark share an 80-char hard cap, Vinted
// is tighter at 70. Depop has no published hard cap, its mobile search UI
// just visibly truncates around 50 chars, so that's a soft warning tier,
// not a hard "over" like the other three.
const TITLE_HARD_LIMITS = { ebay: 80, vinted: 70, poshmark: 80 };
const DEPOP_SOFT_LIMIT = 50;

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

function matchesSearchTerm(l, term) {
  term = term.trim().toLowerCase();
  return !term || (l.title || '').toLowerCase().includes(term);
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

  tbody.innerHTML = filtered.map(l => `
    <tr class="row-clickable" data-listing-id="${escapeHtml(l.id)}" tabindex="0" role="button" aria-label="View details for ${escapeHtml(l.title || 'Untitled item')}">
      <td>
        <div class="cell-card-name">${escapeHtml(l.title || 'Untitled item')}</div>
        ${l.notes ? `<div class="cell-card-meta">${escapeHtml(l.notes)}</div>` : ''}
      </td>
      <td class="cell-value${l.price == null ? ' empty' : ''}">${l.price != null ? formatUsd(l.price) : 'not set'}</td>
      <td class="cell-platforms">${platformBadges(l.platforms, l.soldOn)}</td>
      <td class="cell-muted">${l.datePublished ? escapeHtml(l.datePublished) : '<span class="cell-value empty">not logged</span>'}</td>
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
// making the seller compare four columns by eye. Ties (e.g. two platforms
// both net exactly the same) intentionally mark none, since there's no real
// "best" to point to.
function bestPayoutPlatform(l) {
  const candidates = (l.platforms || [])
    .map(p => ({ p, net: estimateNetPayout(p, l.price) }))
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
    return `
    <tr>
      <td><div class="cell-card-name">${escapeHtml(l.title || 'Untitled item')}</div></td>
      <td class="cell-value${l.price == null ? ' empty' : ''}">${l.price != null ? formatUsd(l.price) : 'not set'}</td>
      ${PAYOUT_PLATFORMS.map(p => {
        if (!(l.platforms || []).includes(p)) return '<td class="cell-value empty">not listed</td>';
        const net = estimateNetPayout(p, l.price);
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
  vinted: 'No seller fees',
  poshmark: 'Flat $2.95 under $15, otherwise 20% commission',
  depop: '3.3% + $0.45 payment processing, no commission'
};
let calcPlatforms = new Set(PAYOUT_PLATFORMS);

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

  const rows = PAYOUT_PLATFORMS.filter(p => calcPlatforms.has(p)).map(p => ({
    p, net: estimateNetPayout(p, price)
  }));
  const bestNet = rows.length > 1 ? Math.max(...rows.map(r => r.net)) : null;
  const tiedForBest = bestNet != null && rows.filter(r => r.net === bestNet).length > 1;

  tbody.innerHTML = rows.map(r => {
    const isBest = bestNet != null && !tiedForBest && r.net === bestNet;
    const profit = showProfit ? r.net - (hasCost ? cost : 0) - (hasShipping ? shipping : 0) : null;
    return `
    <tr>
      <td>${escapeHtml(PLATFORM_LABELS[r.p])}</td>
      <td class="cell-muted">${escapeHtml(CALC_FEE_DESCRIPTIONS[r.p])}</td>
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

  if (!sales.length) {
    tbody.innerHTML = '';
    empty.hidden = false;
    empty.textContent = 'No sales logged yet.';
    return;
  }
  empty.hidden = true;

  const sorted = [...sales].sort((a, b) => {
    if (!a.saleDate && !b.saleDate) return 0;
    if (!a.saleDate) return 1;
    if (!b.saleDate) return -1;
    return b.saleDate.localeCompare(a.saleDate);
  });

  tbody.innerHTML = sorted.map(s => {
    const net = estimateNetPayout(s.platform, s.salePrice);
    const profit = net != null && s.costBasis != null ? net - s.costBasis : null;
    return `
    <tr>
      <td><div class="cell-card-name">${escapeHtml(s.title || 'Untitled item')}</div></td>
      <td class="cell-platforms">${s.platform ? `<span class="badge badge-${escapeHtml(s.platform)}">${escapeHtml(PLATFORM_LABELS[s.platform] || s.platform)}</span>` : ''}</td>
      <td class="cell-value${s.salePrice == null ? ' empty' : ''}">${s.salePrice != null ? formatUsd(s.salePrice) : 'not set'}</td>
      <td class="cell-value${net == null ? ' empty' : ''}">${net != null ? formatUsd(net) : 'unknown'}</td>
      <td class="cell-value${s.costBasis == null ? ' empty' : ''}">${s.costBasis != null ? formatUsd(s.costBasis) : 'not logged'}</td>
      <td class="cell-value${profit == null ? ' empty' : (profit < 0 ? ' cell-value-loss' : '')}">${profit != null ? formatUsd(profit) : 'not logged'}</td>
      <td class="cell-muted">${s.saleDate ? escapeHtml(s.saleDate) : '<span class="cell-value empty">not logged</span>'}</td>
    </tr>
  `;
  }).join('');
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

document.getElementById('searchInput').addEventListener('input', (e) => {
  searchTerm = e.target.value;
  applyFiltersAndRender();
});

// Same "/" jumps to search shortcut as the main Command Center dashboard.
document.addEventListener('keydown', (e) => {
  if (!document.getElementById('modalOverlay').hidden) return;
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

function openModal(id) {
  const l = listings.find(item => item.id === id);
  if (!l) return;
  lastFocusedEl = document.activeElement;

  document.getElementById('modalTitle').textContent = l.title || 'Untitled item';
  document.getElementById('modalSub').textContent = STAGE_LABELS[l.status] || l.status || 'Status not logged';

  const rows = [];
  rows.push(fieldRow('Asking price', l.price != null ? formatUsd(l.price) : 'Not set', l.price == null));
  rows.push(fieldRow('Cost basis', l.costBasis != null ? formatUsd(l.costBasis) : 'Not logged', l.costBasis == null));
  rows.push(fieldRow('Platforms', (l.platforms || []).length ? platformBadges(l.platforms, l.soldOn, l.listingUrls) : 'None logged', !(l.platforms || []).length));
  rows.push(fieldRow('Published', l.datePublished ? escapeHtml(l.datePublished) : 'Not logged yet', !l.datePublished));

  const modalDays = daysSincePublished(l.datePublished);
  rows.push(fieldRow('Relist guidance', relistGuidanceHtml(l, modalDays), modalDays == null));

  const modalBest = bestPayoutPlatform(l);
  const hasCostBasis = l.costBasis != null;
  const payoutHtml = (l.platforms || []).length
    ? '<table class="modal-payout-table">' + (l.platforms || []).map(p => {
        const net = estimateNetPayout(p, l.price);
        const isBest = p === modalBest;
        const profit = net != null && hasCostBasis ? net - l.costBasis : null;
        return `<tr><td>${escapeHtml(PLATFORM_LABELS[p] || p)}</td><td class="cell-value${net == null ? ' empty' : ''}${isBest ? ' cell-value-best' : ''}">${net != null ? formatUsd(net) : 'not set'}${isBest ? ' <span class="best-tag" title="Highest net payout for this item">best</span>' : ''}</td>${hasCostBasis ? `<td class="cell-value${profit < 0 ? ' cell-value-loss' : ''}">${formatUsd(profit)} profit</td>` : ''}</tr>`;
      }).join('') + '</table>'
    : 'Not applicable, not listed anywhere yet.';
  rows.push(fieldRow('Est. net payout by platform', payoutHtml, !(l.platforms || []).length));

  rows.push(fieldRow('Notes', l.notes ? escapeHtml(l.notes) : 'None', !l.notes));

  document.getElementById('modalBody').innerHTML = rows.join('');
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

function csvField(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

const CSV_COLUMNS = [
  ['title', 'Item'], ['price', 'Price'], ['costBasis', 'Cost basis'], ['platforms', 'Platforms'], ['soldOn', 'Sold elsewhere'],
  ['status', 'Status'], ['datePublished', 'Published'], ['daysListed', 'Days listed'],
  ['relistGuidance', 'Relist guidance'], ['notes', 'Notes']
];

// Exports exactly what the table currently shows (same search, platform
// filter, and sort applied), not the full dataset, so the file matches
// what's on screen. Includes the same relist guidance as the on-page
// section, computed fresh at export time rather than cached, since "days
// listed" changes daily even with the underlying data untouched.
document.getElementById('csvBtn').addEventListener('click', () => {
  const rows = sortRows(listings.filter(matchesFilters)).map(l => {
    const days = daysSincePublished(l.datePublished);
    return {
      ...l,
      platforms: (l.platforms || []).map(p => PLATFORM_LABELS[p] || p).join('; '),
      soldOn: (l.soldOn || []).map(p => PLATFORM_LABELS[p] || p).join('; '),
      daysListed: days != null ? days : '',
      relistGuidance: relistGuidanceText(l, days)
    };
  });
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

wireCalc();
wireChecklist();
loadData();

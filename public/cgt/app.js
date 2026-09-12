let cards = [];
let activeCard = null;
let lastFocusedEl = null;
let searchTerm = '';
let activeSport = 'all';
let activeBasis = 'all';

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
    errBox.textContent = "Couldn't load cards.json: " + e.message;
  }
}

function renderStats() {
  const real = cards.filter(c => !isExample(c));
  const priced = real.filter(c => c.estimatedValue != null);
  const totalValue = priced.reduce((s, c) => s + c.estimatedValue, 0);
  const bySale = priced.filter(c => c.valuationBasis === 'recent-sale').length;
  const byComp = priced.filter(c => c.valuationBasis === 'comp-estimate').length;
  const bySport = { hockey: 0, baseball: 0, football: 0 };
  real.forEach(c => { if (bySport[c.sport] != null) bySport[c.sport]++; });

  const tiles = [
    { value: real.length, label: 'Cards logged', sub: cards.length !== real.length ? '+ 1 example row' : null },
    { value: priced.length ? formatUsd(totalValue) : '$0', label: 'Total estimated value', sub: priced.length ? priced.length + ' priced' : 'nothing priced yet' },
    { value: bySale, label: 'Recent-sale priced', sub: null },
    { value: byComp, label: 'Comp-estimate priced', sub: null },
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
  const matchesSearch = !term || (c.cardName || '').toLowerCase().includes(term);
  const matchesSport = activeSport === 'all' || c.sport === activeSport;
  let matchesBasis = true;
  if (activeBasis === 'unpriced') matchesBasis = c.estimatedValue == null;
  else if (activeBasis !== 'all') matchesBasis = c.valuationBasis === activeBasis;
  return matchesSearch && matchesSport && matchesBasis;
}

function applyFiltersAndRender() {
  const filtered = cards.filter(matchesFilters);
  const tbody = document.getElementById('cardTableBody');
  const empty = document.getElementById('tableEmpty');

  if (!filtered.length) {
    tbody.innerHTML = '';
    empty.hidden = false;
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
      <td class="cell-muted">${c.datePriced ? escapeHtml(c.datePriced) : '<span class="cell-value empty">n/a</span>'}</td>
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
  body += field('Estimated value', activeCard.estimatedValue != null ? formatUsd(activeCard.estimatedValue) : null, activeCard.estimatedValue == null);
  body += field('Valuation basis', activeCard.valuationBasis === 'recent-sale' ? 'Recent sale' : activeCard.valuationBasis === 'comp-estimate' ? 'Comp-based estimate' : null, !activeCard.valuationBasis);
  body += field('Comp note', activeCard.compNote, !activeCard.compNote);
  body += field('Source', activeCard.sourceNote, !activeCard.sourceNote);
  body += field('Date priced', activeCard.datePriced, !activeCard.datePriced);
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

document.getElementById('modalClose').addEventListener('click', closeModal);
document.getElementById('modalOverlay').addEventListener('click', (e) => {
  if (e.target.id === 'modalOverlay') closeModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !document.getElementById('modalOverlay').hidden) closeModal();
});

document.getElementById('searchInput').addEventListener('input', (e) => {
  searchTerm = e.target.value;
  applyFiltersAndRender();
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
wireChipGroup('sportFilter', 'data-sport', (v) => { activeSport = v; });
wireChipGroup('basisFilter', 'data-basis', (v) => { activeBasis = v; });

document.getElementById('printBtn').addEventListener('click', () => window.print());

loadCards();

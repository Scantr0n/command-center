// Shared, self-contained sidebar nav for jumping directly between hubs
// without returning to the main dashboard first. Injected at runtime by
// every page (index + each hub) via a single <script src="/sidebar.js">
// tag, rather than duplicating markup across six separate HTML files.
//
// Real gap this closes: the graph/grid dashboard already shows every
// project at a glance, but once inside a specific hub (Alpha, CSM,
// Sondrik, CGT, Garage) there was no way to jump to another hub except
// clicking "Command Center" to go back, then finding and clicking the
// next node. Every real reference dashboard looked at for this pass
// (Linear, Notion, n8n) uses a persistent sidebar for exactly this.
//
// Deliberately only lists clusters with a real `link` field (an actual
// built sub-hub page), never fabricates a nav entry for a cluster that's
// just a dashboard card with no page behind it.
(function () {
  const STORAGE_KEY = 'cc-sidebar-expanded';
  const BREAKPOINT = 860; // below this, the rail is hidden entirely, same call as yesterday's mobile category-row fix: don't eat mobile width for a nav a phone user can already get via the back-link.

  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  const STATUS_COLOR = {
    active: '#3DDC84', done: '#5B9FE0', stalled: '#E0A030',
    broken: '#E0605A', unknown: '#7B8188'
  };

  const STYLE = `
    #ccSidebar {
      position: fixed;
      top: 0; left: 0; bottom: 0;
      width: 56px;
      display: flex;
      flex-direction: column;
      background: #0D0E10;
      border-right: 1px solid rgba(255,255,255,0.07);
      z-index: 40;
      overflow-y: auto;
      overflow-x: hidden;
      transition: width 0.15s ease;
    }
    #ccSidebar.expanded { width: 208px; }
    @media (max-width: ${BREAKPOINT}px) { #ccSidebar { display: none; } }
    body.cc-has-sidebar { padding-left: 56px; transition: padding-left 0.15s ease; }
    body.cc-has-sidebar.cc-sidebar-expanded { padding-left: 208px; }
    @media (max-width: ${BREAKPOINT}px) { body.cc-has-sidebar, body.cc-has-sidebar.cc-sidebar-expanded { padding-left: 0; } }

    .cc-sb-toggle {
      display: flex; align-items: center; gap: 10px;
      padding: 16px 16px;
      background: transparent; border: none; border-bottom: 1px solid rgba(255,255,255,0.07);
      color: #7B8188; cursor: pointer; font-family: inherit; width: 100%; text-align: left;
    }
    .cc-sb-toggle:hover, .cc-sb-toggle:focus-visible { color: #F5F6F7; }
    .cc-sb-toggle-icon { flex-shrink: 0; width: 16px; height: 16px; }

    .cc-sb-row {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 16px;
      color: #9A9FA6; text-decoration: none;
      white-space: nowrap;
      border-left: 2px solid transparent;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 0.72rem;
    }
    .cc-sb-row:hover, .cc-sb-row:focus-visible { background: rgba(255,255,255,0.03); color: #F5F6F7; outline: none; }
    .cc-sb-row.active { color: #F5F6F7; border-left-color: rgba(255,255,255,0.4); background: rgba(255,255,255,0.03); }
    .cc-sb-dot { flex-shrink: 0; width: 8px; height: 8px; border-radius: 50%; }
    .cc-sb-label { overflow: hidden; text-overflow: ellipsis; opacity: 0; transition: opacity 0.1s ease; }
    #ccSidebar.expanded .cc-sb-label { opacity: 1; }
    .cc-sb-divider { height: 1px; background: rgba(255,255,255,0.07); margin: 8px 16px; }
    .cc-sb-home {
      display: flex; align-items: center; gap: 10px;
      padding: 14px 16px;
      color: #F5F6F7; text-decoration: none; font-weight: 700;
      font-family: 'Manrope', -apple-system, sans-serif; font-size: 0.8rem;
      border-bottom: 1px solid rgba(255,255,255,0.07);
    }
    .cc-sb-home-mark { flex-shrink: 0; width: 20px; height: 20px; border-radius: 5px; background: #F5F6F7; color: #0D0E10; display: flex; align-items: center; justify-content: center; font-size: 0.65rem; font-weight: 800; }
    .cc-sb-label-home { opacity: 0; transition: opacity 0.1s ease; }
    #ccSidebar.expanded .cc-sb-label-home { opacity: 1; }
  `;

  function currentPathIsHub(link) {
    if (!link) return false;
    // Matches "/alpha" or "/alpha/" or "/alpha/index.html" against the current path.
    const norm = p => p.replace(/\/index\.html$/, '').replace(/\/$/, '') || '/';
    return norm(location.pathname) === norm(link);
  }

  async function init() {
    const styleEl = document.createElement('style');
    styleEl.textContent = STYLE;
    document.head.appendChild(styleEl);

    const expanded = localStorage.getItem(STORAGE_KEY) === '1';
    const nav = document.createElement('nav');
    nav.id = 'ccSidebar';
    nav.setAttribute('aria-label', 'Hub navigation');
    if (expanded) {
      nav.classList.add('expanded');
      document.body.classList.add('cc-sidebar-expanded');
    }

    nav.innerHTML = `
      <a class="cc-sb-home" href="/" title="Command Center">
        <span class="cc-sb-home-mark" aria-hidden="true">CC</span>
        <span class="cc-sb-label-home">Command Center</span>
      </a>
      <button type="button" class="cc-sb-toggle" id="ccSidebarToggle" aria-label="${expanded ? 'Collapse' : 'Expand'} sidebar" aria-pressed="${expanded}">
        <svg class="cc-sb-toggle-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M5 3l5 5-5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <span class="cc-sb-label">Collapse</span>
      </button>
      <div class="cc-sb-divider"></div>
      <div id="ccSidebarHubs"></div>
    `;
    document.body.prepend(nav);
    document.body.classList.add('cc-has-sidebar');

    document.getElementById('ccSidebarToggle').addEventListener('click', () => {
      const nowExpanded = nav.classList.toggle('expanded');
      document.body.classList.toggle('cc-sidebar-expanded', nowExpanded);
      localStorage.setItem(STORAGE_KEY, nowExpanded ? '1' : '0');
      const btn = document.getElementById('ccSidebarToggle');
      btn.setAttribute('aria-pressed', String(nowExpanded));
      btn.setAttribute('aria-label', (nowExpanded ? 'Collapse' : 'Expand') + ' sidebar');
    });

    try {
      const res = await fetch('/api/clusters');
      if (!res.ok) return;
      const data = await res.json();
      const hubs = (data.clusters || []).filter(c => c.link).sort((a, b) => a.name.localeCompare(b.name));
      const hubsEl = document.getElementById('ccSidebarHubs');
      hubsEl.innerHTML = hubs.map(c => {
        const active = currentPathIsHub(c.link);
        const color = STATUS_COLOR[c.status] || STATUS_COLOR.unknown;
        return `
          <a class="cc-sb-row${active ? ' active' : ''}" href="${escapeHtml(c.link)}" title="${escapeHtml(c.name)}" ${active ? 'aria-current="page"' : ''}>
            <span class="cc-sb-dot" style="background:${color}" aria-hidden="true"></span>
            <span class="cc-sb-label">${escapeHtml(c.name)}</span>
          </a>
        `;
      }).join('');
    } catch {
      // No sidebar hub list on a fetch failure is an honest degrade, same
      // silent-fallback convention /api/clusters itself already uses for
      // Drive being unreachable. The home link and toggle still work.
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

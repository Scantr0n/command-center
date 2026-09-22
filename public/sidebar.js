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
  const PIN_STORAGE_KEY = 'cc-sidebar-pinned';
  const BREAKPOINT = 860; // below this, the rail is hidden entirely, same call as yesterday's mobile category-row fix: don't eat mobile width for a nav a phone user can already get via the back-link.

  // localStorage itself can throw on access, not just return corrupt JSON
  // (Safari's "Block All Cookies", locked-down browser policies), and unlike
  // every other localStorage touchpoint in this codebase (Sondrik's own
  // safeStorageGet/Set, guarded reads in Garage/CSM), this file's init() ran
  // a bare `localStorage.getItem` as its first real statement, with no
  // fallback. Since this script injects the one nav shared across every hub
  // page, that uncaught throw silently killed the sidebar everywhere, not
  // just degraded one feature on one page.
  function safeStorageGet(key) {
    try { return localStorage.getItem(key); } catch { return null; }
  }
  function safeStorageSet(key, value) {
    try { localStorage.setItem(key, value); } catch { /* ignore */ }
  }

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
    #ccSidebar.expanded .cc-sb-row { padding-right: 34px; }
    .cc-sb-divider { height: 1px; background: rgba(255,255,255,0.07); margin: 8px 16px; }

    .cc-sb-row-wrap { position: relative; }
    .cc-sb-pin {
      display: none;
      position: absolute; right: 10px; top: 50%; transform: translateY(-50%);
      align-items: center; justify-content: center;
      width: 20px; height: 20px; padding: 0; border: none; border-radius: 5px;
      background: transparent; color: #565B64; cursor: pointer;
      opacity: 0; transition: opacity 0.1s ease, color 0.1s ease;
    }
    #ccSidebar.expanded .cc-sb-pin { display: flex; }
    .cc-sb-row-wrap:hover .cc-sb-pin, .cc-sb-pin:focus-visible, .cc-sb-pin.pinned { opacity: 1; }
    .cc-sb-pin:hover, .cc-sb-pin:focus-visible { color: #F5F6F7; background: rgba(255,255,255,0.06); outline: none; }
    .cc-sb-pin.pinned { color: #E0A030; }
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

    /* Every hub's own print stylesheet (index.html/style.css) predates this
       sidebar, none of them know to hide it, so a fixed-position nav rail
       with live status dots was printing on top of the left edge of every
       report. Hidden here once, in the shared file, rather than patching
       the same rule into five separate print blocks. */
    @media print {
      #ccSidebar { display: none !important; }
      body.cc-has-sidebar, body.cc-has-sidebar.cc-sidebar-expanded { padding-left: 0 !important; }
    }

    /* Same precedent as every hub's own style.css (CGT/CSM/Garage/Sondrik,
       and now Alpha): this rail's expand/collapse width transition and its
       label/pin fade-ins still trigger vestibular discomfort for someone who
       has set this preference, so cut them to near-instant, same as every
       other transition on the page it's injected into. This file is loaded
       on all five hub pages, so it was the one shared gap in that coverage. */
    @media (prefers-reduced-motion: reduce) {
      #ccSidebar, body.cc-has-sidebar, .cc-sb-label, .cc-sb-pin, .cc-sb-label-home {
        transition-duration: 0.001ms !important;
      }
    }
  `;

  function currentPathIsHub(link) {
    if (!link) return false;
    // Matches "/alpha" or "/alpha/" or "/alpha/index.html" against the current path.
    const norm = p => p.replace(/\/index\.html$/, '').replace(/\/$/, '') || '/';
    return norm(location.pathname) === norm(link);
  }

  // The home page (this script also loads there via the same shared
  // <script src="/sidebar.js"> tag) already *is* the hub nav, graph, grid,
  // and search all at once, so injecting this rail on top of it just adds a
  // "Command Center" link pointing at the page already on screen, plus a
  // permanent 56px+ padding-left squeeze on the one page with the least
  // spare width to give up (a 900x900 force-directed graph).
  function isHomePage() {
    const p = location.pathname.replace(/\/index\.html$/, '').replace(/\/$/, '') || '/';
    return p === '/';
  }

  async function init() {
    if (isHomePage()) return;
    const styleEl = document.createElement('style');
    styleEl.textContent = STYLE;
    document.head.appendChild(styleEl);

    const expanded = safeStorageGet(STORAGE_KEY) === '1';
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
    // A plain prepend() put this nav ahead of every page's own skip-link
    // (present on all 8 real pages, either as body's direct first child or,
    // on CSM, wrapped in its own <nav>), silently making "Skip to main
    // content" unreachable as the first Tab stop app-wide since this sidebar
    // injects itself after the skip-link already exists in the parsed DOM.
    // Walking up from the skip-link to whichever of its ancestors is body's
    // direct child, then inserting right after that element, keeps the skip
    // link the true first focusable element on every page while still
    // falling back to a plain prepend if a page ever has no skip-link at all.
    const skipLink = document.querySelector('.skip-link');
    let skipLinkTopAncestor = skipLink;
    while (skipLinkTopAncestor && skipLinkTopAncestor.parentElement !== document.body) {
      skipLinkTopAncestor = skipLinkTopAncestor.parentElement;
    }
    if (skipLinkTopAncestor) {
      skipLinkTopAncestor.insertAdjacentElement('afterend', nav);
    } else {
      document.body.prepend(nav);
    }
    document.body.classList.add('cc-has-sidebar');

    document.getElementById('ccSidebarToggle').addEventListener('click', () => {
      const nowExpanded = nav.classList.toggle('expanded');
      document.body.classList.toggle('cc-sidebar-expanded', nowExpanded);
      safeStorageSet(STORAGE_KEY, nowExpanded ? '1' : '0');
      const btn = document.getElementById('ccSidebarToggle');
      btn.setAttribute('aria-pressed', String(nowExpanded));
      btn.setAttribute('aria-label', (nowExpanded ? 'Collapse' : 'Expand') + ' sidebar');
    });

    try {
      const res = await fetch('/api/clusters');
      if (!res.ok) return;
      const data = await res.json();
      const hubs = (data.clusters || []).filter(c => c.link).sort((a, b) => a.name.localeCompare(b.name));
      renderHubs(hubs);
    } catch {
      // No sidebar hub list on a fetch failure is an honest degrade, same
      // silent-fallback convention /api/clusters itself already uses for
      // Drive being unreachable. The home link and toggle still work.
    }
  }

  function getPinned() {
    try { return new Set(JSON.parse(safeStorageGet(PIN_STORAGE_KEY) || '[]')); }
    catch { return new Set(); }
  }

  function setPinned(pinnedSet) {
    safeStorageSet(PIN_STORAGE_KEY, JSON.stringify([...pinnedSet]));
  }

  // Pinned hubs sort to their own group above the rest, same pattern the
  // research pass found across Grafana/Raycast/Homarr: a flat equal-weight
  // list doesn't scale once there are more than a couple hubs someone
  // actually revisits constantly.
  function renderHubs(hubs) {
    const hubsEl = document.getElementById('ccSidebarHubs');
    const pinned = getPinned();
    const row = c => {
      const active = currentPathIsHub(c.link);
      const status = c.status || 'unknown';
      const color = STATUS_COLOR[status] || STATUS_COLOR.unknown;
      const statusLabel = status.toUpperCase();
      const isPinned = pinned.has(c.id);
      return `
        <div class="cc-sb-row-wrap">
          <a class="cc-sb-row${active ? ' active' : ''}" href="${escapeHtml(c.link)}" title="${escapeHtml(c.name)}, status: ${escapeHtml(statusLabel)}" aria-label="${escapeHtml(c.name)}, status: ${escapeHtml(statusLabel)}" ${active ? 'aria-current="page"' : ''}>
            <span class="cc-sb-dot" style="background:${color}" aria-hidden="true"></span>
            <span class="cc-sb-label">${escapeHtml(c.name)}</span>
          </a>
          <button type="button" class="cc-sb-pin${isPinned ? ' pinned' : ''}" data-pin-id="${escapeHtml(c.id)}" aria-label="${isPinned ? 'Unpin' : 'Pin'} ${escapeHtml(c.name)}" aria-pressed="${isPinned}" title="${isPinned ? 'Unpin' : 'Pin to top'}">
            <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="M8 1l1.5 4.5L14 7l-4 2.5L9.5 14 8 11 6.5 14 6 9.5 2 7l4.5-1.5z" fill="currentColor"/></svg>
          </button>
        </div>
      `;
    };
    const pinnedHubs = hubs.filter(c => pinned.has(c.id));
    const restHubs = hubs.filter(c => !pinned.has(c.id));
    hubsEl.innerHTML =
      (pinnedHubs.length ? pinnedHubs.map(row).join('') + '<div class="cc-sb-divider"></div>' : '') +
      restHubs.map(row).join('');

    hubsEl.querySelectorAll('.cc-sb-pin').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault();
        const id = btn.dataset.pinId;
        const p = getPinned();
        if (p.has(id)) p.delete(id); else p.add(id);
        setPinned(p);
        renderHubs(hubs);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

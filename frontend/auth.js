/**
 * auth.js — Shared frontend authentication utility
 * Include on every page EXCEPT login.html.
 * Handles auth checks, page permission enforcement, and logout.
 */
(function() {
  'use strict';

  const AUTH_TOKEN_KEY = 'authToken';
  const AUTH_USER_KEY  = 'authUser';

  // Page ID mapping: filename → page id used in permissions
  const PAGE_MAP = {
    'ai-assistant.html':     'ai-assistant',
    'ai-workflow.html':      'ai-workflow',
    'knowledge-base.html':   'knowledge-base',
    'retrieval-config.html': 'retrieval-config',
    'qa-builder.html':       'qa-builder',
    'internal-reminder.html':'internal-reminder',
    'accuracy-test.html':    'accuracy-test',
    'index.html':            'scraper',
    'cron-monitor.html':     'cron-monitor',
    'llm-evaluation.html':   'llm-evaluation',
    'triage-debug.html':     'triage-debug',
  };

  function getToken() {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  }

  function getUser() {
    try { return JSON.parse(localStorage.getItem(AUTH_USER_KEY)); } catch { return null; }
  }

  function logout() {
    const token = getToken();
    if (token) {
      fetch('/auth/logout', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token }
      }).catch(() => {});
    }
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
    window.location.href = '/login.html';
  }

  function getCurrentPageId() {
    const filename = window.location.pathname.split('/').pop() || 'index.html';
    return PAGE_MAP[filename] || null;
  }

  function hasPageAccess(pageId) {
    const user = getUser();
    if (!user) return false;
    if (user.role === 'admin') return true;
    return user.pages && user.pages.includes(pageId);
  }

  // Global (admin-controlled) page visibility stored in localStorage.aw_pageVisibility
  function isGloballyVisible(pageId) {
    try {
      const v = JSON.parse(localStorage.getItem('aw_pageVisibility') || '{}') || {};
      return v[pageId] !== false;
    } catch { return true; }
  }

  // ── AUTH BYPASS FLAG ──
  // Set to true to skip login enforcement (for development/testing)
  const AUTH_DISABLED = true;

  // Check auth on page load
  async function checkAuth() {
    // If auth is disabled, skip all checks and allow access
    if (AUTH_DISABLED) return true;

    const token = getToken();
    if (!token) {
      window.location.href = '/login.html';
      return false;
    }

    try {
      const res = await fetch('/auth/me', {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      if (!res.ok) {
        logout();
        return false;
      }
      const userData = await res.json();
      localStorage.setItem(AUTH_USER_KEY, JSON.stringify(userData));

      // Check page permission + global visibility (non-admin redirects away from hidden pages)
      const pageId = getCurrentPageId();
      const blocked = pageId && (
        !hasPageAccess(pageId) ||
        (userData.role !== 'admin' && !isGloballyVisible(pageId))
      );
      if (blocked) {
        // Redirect to the first allowed + visible page
        const visiblePages = (userData.pages || []).filter(function(pid){
          return userData.role === 'admin' || isGloballyVisible(pid);
        });
        const firstAllowed = userData.role === 'admin' ? userData.pages[0] : visiblePages[0];
        if (firstAllowed) {
          const target = Object.entries(PAGE_MAP).find(([, v]) => v === firstAllowed);
          window.location.href = target ? '/' + target[0] : '/login.html';
        } else {
          document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:Inter,sans-serif;color:#888;font-size:14px;">No pages available. Contact admin.</div>';
        }
        return false;
      }

      return true;
    } catch {
      logout();
      return false;
    }
  }

  // Filter nav links based on permissions + global visibility
  function filterNavLinks() {
    const user = getUser();
    if (!user) return;
    const isAdmin = user.role === 'admin';

    document.querySelectorAll('.nav-links a').forEach(link => {
      const href = link.getAttribute('href');
      if (!href) return;
      const filename = href.replace('/', '');
      const pageId = PAGE_MAP[filename];
      if (!pageId) return;
      const hidden = !hasPageAccess(pageId) || (!isAdmin && !isGloballyVisible(pageId));
      if (hidden) link.style.display = 'none';
    });
  }

  // Inject username + logout into the AI Settings panel header
  function injectLogoutButton() {
    const headerRight = document.querySelector('.ais-header-right');
    if (!headerRight) return;
    const user = getUser();
    if (!user) return;

    // Insert before the close button (last child)
    const closeBtn = headerRight.querySelector('button[title="Close"]');

    const sep = document.createElement('span');
    sep.style.cssText = 'width:1px;height:16px;background:var(--border);';

    const userLabel = document.createElement('span');
    userLabel.style.cssText = 'font-size:11px;color:var(--text3);font-weight:500;';
    userLabel.textContent = user.username;

    const logoutBtn = document.createElement('button');
    logoutBtn.textContent = 'Logout';
    logoutBtn.style.cssText = 'font-family:var(--font);font-size:11px;font-weight:500;padding:3px 9px;border:1px solid var(--border);border-radius:5px;background:none;color:var(--text3);cursor:pointer;transition:all 0.15s;';
    logoutBtn.addEventListener('mouseenter', () => { logoutBtn.style.color = 'var(--red)'; logoutBtn.style.borderColor = 'var(--red)'; });
    logoutBtn.addEventListener('mouseleave', () => { logoutBtn.style.color = 'var(--text3)'; logoutBtn.style.borderColor = 'var(--border)'; });
    logoutBtn.addEventListener('click', logout);

    headerRight.insertBefore(sep, closeBtn);
    headerRight.insertBefore(userLabel, closeBtn);
    headerRight.insertBefore(logoutBtn, closeBtn);
  }

  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  async function init() {
    const ok = await checkAuth();
    if (ok) {
      filterNavLinks();
      injectLogoutButton();
    }
  }

  // Export for use by other scripts
  window.Auth = {
    getToken,
    getUser,
    logout,
    hasPageAccess,
    isGloballyVisible,
    getCurrentPageId,
    checkAuth
  };
})();

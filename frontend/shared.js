/* ═══════════════════════════════════════════
   AI Workflow — Shared Utilities
   ═══════════════════════════════════════════ */

/** Escape HTML entities (safe for innerHTML injection) */
function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/** Alias for templates / attribute contexts */
const escHtml = esc;

/** Escape for HTML attribute values (double-quote safe) */
function escAttr(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/** Show a toast notification (bottom-right, auto-dismiss) */
function showToast(msg, duration) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast on';
  setTimeout(() => t.className = 'toast', duration || 3500);
}

/** Capitalize first letter */
function cap(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

/** Check embed mode from URL params */
function checkEmbed() {
  if (new URLSearchParams(location.search).get('embed') === '1') {
    document.body.classList.add('embed');
  }
}

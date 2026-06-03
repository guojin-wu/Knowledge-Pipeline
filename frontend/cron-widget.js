/* ── Draggable Floating Cron Widget ──
   Self-contained: injects its own CSS + HTML.
   On ai-workflow.html, call window.cronWidget.update(jobs) to feed live data.
*/
(function() {
  'use strict';

  // Only show on ai-workflow.html
  if (!/ai-workflow/i.test(window.location.pathname)) return;

  var STORAGE_KEY = 'cronWidgetJobs';
  var POS_KEY     = 'cronWidgetPos';

  // ── CSS ──
  var css = document.createElement('style');
  css.textContent =

    /* ── FAB ── */
    '.cw-fab{position:fixed;z-index:9999;width:38px;height:38px;border-radius:50%;' +
      'background:var(--bg);border:1.5px solid #000;' +
      'box-shadow:0 1px 6px rgba(0,0,0,.06);' +
      'cursor:grab;display:flex;align-items:center;justify-content:center;' +
      'user-select:none;-webkit-user-select:none;transition:border-color .3s,box-shadow .3s,background .2s;}' +
    '.cw-fab:hover{box-shadow:0 2px 12px rgba(0,0,0,.1);background:var(--bg2);}' +
    '.cw-fab:active{cursor:grabbing;}' +

    /* secureview logo svg inside fab */
    '.cw-fab svg{pointer-events:none;transition:transform .2s;}' +
    '.cw-fab svg path{fill:var(--text);transition:fill .3s;}' +

    /* hover: scale up icon slightly */
    '.cw-fab:hover svg{transform:scale(1.1);}' +
    '.cw-fab:hover svg path{fill:var(--text);}' +

    /* running: smooth ocean-wave opacity */
    '.cw-fab.has-running{border-color:#000;}' +
    '.cw-fab.has-running svg path{fill:var(--text);animation:cw-wave 3s cubic-bezier(.45,.05,.55,.95) infinite;}' +
    '.cw-fab.has-running svg path:nth-child(1){animation-delay:0s;}' +
    '.cw-fab.has-running svg path:nth-child(2){animation-delay:.4s;}' +
    '.cw-fab.has-running svg path:nth-child(3){animation-delay:.8s;}' +
    '@keyframes cw-wave{' +
      '0%,100%{opacity:1}' +
      '50%{opacity:.12}' +
    '}' +

    /* error: static red — no animation, it's stopped */
    '.cw-fab.has-error{border-color:var(--red,#ff453a);}' +
    '.cw-fab.has-error svg path{fill:var(--red,#ff453a);animation:none;}' +

    /* count badge */
    '.cw-fab-count{position:absolute;top:-3px;right:-3px;min-width:14px;height:14px;' +
      'border-radius:7px;background:var(--text);color:#fff;font-size:9px;font-weight:700;' +
      'display:none;align-items:center;justify-content:center;padding:0 3px;' +
      'pointer-events:none;border:1.5px solid var(--bg);}' +
    '.cw-fab.has-running .cw-fab-count{display:flex;}' +
    '.cw-fab.has-error .cw-fab-count{display:flex;background:var(--red,#ff453a);}' +

    /* ── Popup ── */
    '.cw-popup{position:fixed;z-index:9998;width:440px;max-height:520px;' +
      'background:var(--bg);border:1px solid var(--border);border-radius:14px;' +
      'box-shadow:0 8px 40px rgba(0,0,0,.14);overflow:hidden;display:none;' +
      'flex-direction:column;transition:opacity .18s ease,transform .18s ease;' +
      'opacity:0;transform:scale(.96);}' +
    '.cw-popup.open{display:flex;opacity:1;transform:scale(1);}' +

    /* head */
    '.cw-popup-head{padding:16px 20px 14px;border-bottom:1px solid var(--border);' +
      'display:flex;align-items:center;justify-content:space-between;}' +
    '.cw-popup-title{font-size:15px;font-weight:700;color:var(--text);margin:0;}' +
    '.cw-popup-sub{font-size:12px;color:var(--text3);margin:0;margin-top:2px;}' +
    '.cw-popup-close{background:none;border:none;cursor:pointer;color:var(--text3);padding:4px;border-radius:6px;}' +
    '.cw-popup-close:hover{background:var(--bg2);color:var(--text);}' +

    /* body */
    '.cw-popup-body{padding:14px;overflow-y:auto;flex:1;}' +

    /* job card */
    '.cw-job{border:1px solid var(--border);border-radius:10px;background:var(--bg);' +
      'margin-bottom:10px;overflow:hidden;padding:14px 16px;}' +
    '.cw-job:last-child{margin-bottom:0;}' +

    /* top row: status + name + schedule */
    '.cw-job-top{display:flex;align-items:center;gap:8px;margin-bottom:4px;}' +
    '.cw-job-name{flex:1;font-size:14px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
    '.cw-job-sched{font-size:12px;color:var(--text3);}' +

    /* scope */
    '.cw-job-scope{font-size:12px;color:var(--text3);line-height:1.4;margin-bottom:8px;}' +

    /* kv grid */
    '.cw-kv{display:grid;grid-template-columns:80px 1fr;gap:3px 10px;}' +
    '.cw-kv-k{font-size:11px;color:var(--text3);font-weight:600;}' +
    '.cw-kv-v{font-size:12px;color:var(--text);word-break:break-all;}' +

    /* status badge */
    '.cw-status{display:inline-flex;align-items:center;font-size:10px;font-weight:700;' +
      'letter-spacing:.3px;padding:2px 8px;border-radius:99px;flex-shrink:0;}' +
    '.cw-status.is-running{background:#dcfce7;color:#15803d;}' +
    '.cw-status.is-paused{background:var(--bg2);color:var(--text3);}' +
    '.cw-status.is-error{background:#fee2e2;color:#dc2626;}' +

    /* action buttons — horizontal, bottom-right */
    '.cw-actions{display:flex;gap:6px;justify-content:flex-end;margin-top:10px;}' +
    '.cw-btn{padding:5px 14px;font-size:11px;font-weight:600;font-family:var(--font);' +
      'background:var(--bg2);border:1px solid var(--border);border-radius:8px;' +
      'cursor:pointer;color:var(--text2);white-space:nowrap;transition:background .15s;}' +
    '.cw-btn:hover{background:var(--border);color:var(--text);}' +
    '.cw-btn-go{background:var(--text);color:#fff;border-color:var(--text);}' +
    '.cw-btn-go:hover{background:#333;color:#fff;}';

  document.head.appendChild(css);

  // ── HTML ──
  var fab = document.createElement('div');
  fab.className = 'cw-fab';
  fab.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none">' +
    '<path d="M1.5,0 H10 A4,4,0,0,1,14,4 H0 V1.5 A1.5,1.5,0,0,1,1.5,0Z"/>' +
    '<path d="M4,5 H14 V6 A4,4,0,0,1,10,9 H0 V8 A4,4,0,0,1,4,5Z"/>' +
    '<path d="M0,10 H14 V14 H1.5 A1.5,1.5,0,0,1,0,12.5 V10Z"/>' +
    '</svg><span class="cw-fab-count" id="cwCount">0</span>';

  var popup = document.createElement('div');
  popup.className = 'cw-popup';
  popup.innerHTML =
    '<div class="cw-popup-head">' +
      '<div><p class="cw-popup-title">Crons</p><p class="cw-popup-sub" id="cwSub"></p></div>' +
      '<button class="cw-popup-close" id="cwClose" title="Close">' +
        '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' +
      '</button>' +
    '</div>' +
    '<div class="cw-popup-body" id="cwBody"></div>';

  document.body.appendChild(fab);
  document.body.appendChild(popup);

  popup.querySelector('#cwClose').addEventListener('click', function() {
    popup.classList.remove('open');
  });

  // ── Fab position ──
  var savedPos = null;
  try { savedPos = JSON.parse(localStorage.getItem(POS_KEY)); } catch(e) {}
  if (savedPos && typeof savedPos.x === 'number') {
    fab.style.left = Math.min(savedPos.x, window.innerWidth - 44) + 'px';
    fab.style.top  = Math.min(savedPos.y, window.innerHeight - 44) + 'px';
  } else {
    fab.style.left = '16px';
    fab.style.bottom = '16px';
  }

  // ── Drag ──
  var dragging = false, dragMoved = false, startX, startY, fabX, fabY;

  fab.addEventListener('pointerdown', function(e) {
    dragging = true; dragMoved = false;
    startX = e.clientX; startY = e.clientY;
    var r = fab.getBoundingClientRect();
    fabX = r.left; fabY = r.top;
    fab.setPointerCapture(e.pointerId);
    fab.style.bottom = 'auto';
    e.preventDefault();
  });

  fab.addEventListener('pointermove', function(e) {
    if (!dragging) return;
    var dx = e.clientX - startX, dy = e.clientY - startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragMoved = true;
    var nx = fabX + dx, ny = fabY + dy;
    nx = Math.max(0, Math.min(nx, window.innerWidth - 44));
    ny = Math.max(0, Math.min(ny, window.innerHeight - 44));
    fab.style.left = nx + 'px';
    fab.style.top  = ny + 'px';
    if (popup.classList.contains('open')) positionPopup();
  });

  fab.addEventListener('pointerup', function(e) {
    if (!dragging) return;
    dragging = false;
    fab.releasePointerCapture(e.pointerId);
    var r = fab.getBoundingClientRect();
    try { localStorage.setItem(POS_KEY, JSON.stringify({x: r.left, y: r.top})); } catch(e) {}
    if (!dragMoved) togglePopup();
  });

  // ── Position popup relative to FAB ──
  var GAP = 10; // px between FAB and popup
  function positionPopup() {
    var fr = fab.getBoundingClientRect();
    var pw = 440, ph = Math.min(popup.scrollHeight || 520, 520);
    var vw = window.innerWidth, vh = window.innerHeight;
    var cx = fr.left + fr.width / 2, cy = fr.top + fr.height / 2;
    var l, t;

    // Decide horizontal: open to the side with more space
    if (cx < vw / 2) {
      // FAB on left half → open to the right
      l = fr.right + GAP;
    } else {
      // FAB on right half → open to the left
      l = fr.left - GAP - pw;
    }

    // Vertical: align top of popup with top of FAB, but clamp
    t = fr.top;
    // Clamp so popup stays in viewport
    if (t + ph > vh - 10) t = vh - 10 - ph;
    if (t < 10) t = 10;
    if (l + pw > vw - 10) l = vw - 10 - pw;
    if (l < 10) l = 10;

    popup.style.left = l + 'px';
    popup.style.top  = t + 'px';
  }

  // ── Toggle popup ──
  function togglePopup() {
    var isOpen = popup.classList.toggle('open');
    if (isOpen) {
      positionPopup();
      if (typeof window.cronJobRows === 'function') {
        try { render(window.cronJobRows()); } catch(e) {}
      }
    }
  }

  document.addEventListener('pointerdown', function(e) {
    if (!popup.classList.contains('open')) return;
    if (popup.contains(e.target) || fab.contains(e.target)) return;
    popup.classList.remove('open');
  });

  // ── Render ──
  var _currentJobs = [];
  function esc(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  function render(jobs) {
    _currentJobs = jobs || [];
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs.map(function(j) {
        return { key:j.key, name:j.name, type:j.type||'', scope:j.scope||'',
                 schedule:j.schedule, statusLabel:j.statusLabel, statusClass:j.statusClass,
                 lastRun:j.lastRun||'', nextRun:j.nextRun||'', lastResult:j.lastResult||'',
                 primaryAction:j.primaryAction||'', primaryHandler:j.primaryHandler||'',
                 secondaryAction:j.secondaryAction||'', secondaryHandler:j.secondaryHandler||'' };
      })));
    } catch(e) {}

    var running = jobs.filter(function(j){ return j.statusClass === 'is-running'; }).length;
    var errors  = jobs.filter(function(j){ return j.statusClass === 'is-error'; }).length;

    fab.classList.toggle('has-running', running > 0);
    fab.classList.toggle('has-error', errors > 0 && running === 0);

    var countEl = document.getElementById('cwCount');
    if (countEl) countEl.textContent = errors > 0 ? errors : running;

    var sub = document.getElementById('cwSub');
    if (sub) sub.textContent = running + ' running \u00b7 ' + errors + ' error' + (errors !== 1 ? 's' : '');

    var body = document.getElementById('cwBody');
    if (!body) return;

    var isWorkflow = typeof window.cronJobRows === 'function';

    body.innerHTML = jobs.map(function(job) {
      var actions = '';
      if (isWorkflow && job.primaryHandler) {
        actions =
          '<div class="cw-actions">' +
            (job.secondaryHandler ?
              '<button class="cw-btn" type="button" onclick="event.stopPropagation();' +
                job.secondaryHandler + ';if(window.cronWidget)window.cronWidget.update(cronJobRows());">' +
                esc(job.secondaryAction) + '</button>' : '') +
            '<button class="cw-btn cw-btn-go" type="button" onclick="event.stopPropagation();' +
              job.primaryHandler + ';if(window.cronWidget)window.cronWidget.update(cronJobRows());">' +
              esc(job.primaryAction) + '</button>' +
          '</div>';
      }

      return '<div class="cw-job">' +
        '<div class="cw-job-top">' +
          '<span class="cw-status ' + esc(job.statusClass) + '">' + esc(job.statusLabel) + '</span>' +
          '<span class="cw-job-name">' + esc(job.name) + '</span>' +
          '<span class="cw-job-sched">' + esc(job.schedule) + '</span>' +
        '</div>' +
        (job.scope ? '<div class="cw-job-scope">' + esc(job.scope) + '</div>' : '') +
        '<div class="cw-kv">' +
          (job.type ? '<span class="cw-kv-k">Type</span><span class="cw-kv-v">' + esc(job.type) + '</span>' : '') +
          '<span class="cw-kv-k">Last run</span><span class="cw-kv-v">' + esc(job.lastRun || 'Never') + '</span>' +
          '<span class="cw-kv-k">Next run</span><span class="cw-kv-v">' + esc(job.nextRun || 'Paused') + '</span>' +
          (job.lastResult ? '<span class="cw-kv-k">Result</span><span class="cw-kv-v">' + esc(job.lastResult) + '</span>' : '') +
        '</div>' +
        actions +
      '</div>';
    }).join('');
  }

  // ── Public API ──
  window.cronWidget = {
    update: function(jobs) { render(jobs); },
    refresh: function() {
      if (typeof window.cronJobRows === 'function') {
        render(window.cronJobRows());
      }
    }
  };

  // ── Init ──
  function init() {
    if (typeof window.cronJobRows === 'function') {
      try { render(window.cronJobRows()); return; } catch(e) {}
    }
    var jobs = [];
    try { jobs = JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch(e) {}
    if (jobs.length) render(jobs);
  }
  init();
  setTimeout(function() {
    if (_currentJobs.length === 0 && typeof window.cronJobRows === 'function') {
      try { render(window.cronJobRows()); } catch(e) {}
    }
  }, 1500);

})();

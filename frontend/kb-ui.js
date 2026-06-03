  // ─── KB internal sidebar views ───
  function switchKbView(view) {
    // Map old view names to merged views for backward compat
    if (view === 'qa-clean' || view === 'ai-review') view = 'quality-review';
    if (view === 'rag-format' || view === 'ingestion') view = 'rag-ingestion';
    if (!KB_VIEWS.includes(view)) view = 'overview';
    const prevView = activeKbView;
    if (prevView === 'quality-review' && view !== 'quality-review') {
      try { persistCurrentAiReviewState(); } catch(_) {}
    }
    activeKbView = view;
    saveKbUiMemory({ activeView: view });
    try { document.documentElement.setAttribute('data-kb-view', view); } catch (_e) {}
    try {
      const nextHash = `#kb=${view}`;
      if (window.location.hash !== nextHash) history.replaceState(null, '', nextHash);
    } catch (_e) {}
    document.querySelectorAll('.kb-menu-item').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === view);
    });
    document.querySelectorAll('.kb-view').forEach(panel => {
      panel.classList.toggle('active', panel.id === `view-${view}`);
    });
    if (view === 'overview') renderOverviewDashboard();
    if (view === 'rag-ingestion') {
      // Init the active sub-tab
      const activeIngestSub = document.querySelector('#view-rag-ingestion .merged-sub-panel.active');
      if (activeIngestSub && activeIngestSub.dataset.subPanel === 'ingest') {
        loadIngestedSources().catch?.(() => {});
        loadJobs().catch?.(() => {});
      }
    }
    if (view === 'analysis') loadServerProfile();
    if (view === 'cleaning') initCleaningPage();
    if (view === 'quality-review') {
      // Init the active sub-tab
      const activeQrSub = document.querySelector('#view-quality-review .merged-sub-panel.active');
      if (activeQrSub && activeQrSub.dataset.subPanel === 'qa') {
        initQaCleanPage();
      } else if (activeQrSub && activeQrSub.dataset.subPanel === 'ai') {
        const mode = document.getElementById('aiReviewMode')?.value || localStorage.getItem('aiReviewMode') || 'diagnostics';
        _ensureModeStateLoaded(mode).then((restored) => {
          if (restored) _restoreModeState(mode);
          else if (!_aiReviewInput.cleaned || !_aiReviewInput.cleaned.length) restoreAiInputSnapshot();
          else { refreshRunStatusBar(); refreshScoringStatusBar(); }
        }).catch(() => {
          if (!_aiReviewInput.cleaned || !_aiReviewInput.cleaned.length) restoreAiInputSnapshot();
        });
      }
    }
  }

  function restoreKbViewState(force = false) {
    const memory = getKbUiMemory();
    const preferred = getKbViewFromHash() || memory.activeView || activeKbView || 'overview';
    if (!KB_VIEWS.includes(preferred)) return;
    if (force || preferred !== activeKbView) {
      switchKbView(preferred);
      return;
    }
    if (!window.location.hash) {
      try { history.replaceState(null, '', `#kb=${preferred}`); } catch (_e) {}
    }
  }

  // ─── Merged sub-tab switching ───
  function switchMergedSub(btn, parentView) {
    const parent = document.getElementById('view-' + parentView);
    if (!parent) return;
    const sub = btn.dataset.sub;
    // Toggle tab active state
    parent.querySelectorAll('.merged-sub-tab').forEach(t => t.classList.toggle('active', t.dataset.sub === sub));
    // Toggle panel visibility
    parent.querySelectorAll('.merged-sub-panel').forEach(p => p.classList.toggle('active', p.dataset.subPanel === sub));
    // Trigger init for the sub-view
    if (parentView === 'quality-review') {
      if (sub === 'qa') initQaCleanPage();
      if (sub === 'ai') {
        const mode = document.getElementById('aiReviewMode')?.value || localStorage.getItem('aiReviewMode') || 'diagnostics';
        _ensureModeStateLoaded(mode).then(restored => {
          if (restored) _restoreModeState(mode);
          else if (!_aiReviewInput.cleaned || !_aiReviewInput.cleaned.length) restoreAiInputSnapshot();
          else { refreshRunStatusBar(); refreshScoringStatusBar(); }
        }).catch(() => { if (!_aiReviewInput.cleaned || !_aiReviewInput.cleaned.length) restoreAiInputSnapshot(); });
      }
    }
    if (parentView === 'rag-ingestion' && sub === 'ingest') {
      loadIngestedSources().catch?.(() => {});
      loadJobs().catch?.(() => {});
    }
  }
  window.switchMergedSub = switchMergedSub;

  function toggleKbSidebar() {
    document.querySelector('.layout').classList.toggle('kb-collapsed');
    saveKbUiMemory({ collapsed: document.querySelector('.layout').classList.contains('kb-collapsed') });
    updateKbToggle();
  }

  function updateKbToggle() {
    const collapsed = document.querySelector('.layout').classList.contains('kb-collapsed');
    const toggle = document.getElementById('kbToggle');
    toggle.textContent = collapsed ? '\u203A' : '\u2039';
    toggle.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
  }


  // ─── File handling ───
  let selectedFile = null;
  const fileInput = document.getElementById('fileInput');
  const uploadZone = document.getElementById('uploadZone');

  fileInput.addEventListener('change', e => { if(e.target.files.length) selectFile(e.target.files[0]); });
  uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('dragover'); });
  uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
  uploadZone.addEventListener('drop', e => {
    e.preventDefault(); uploadZone.classList.remove('dragover');
    if(e.dataTransfer.files.length) selectFile(e.dataTransfer.files[0]);
  });

  function selectFile(file) {
    if(!file.name.endsWith('.json')) { showToast('Only JSON files'); return; }
    selectedFile = file;
    document.getElementById('fileName').textContent = file.name;
    document.getElementById('fileSize').textContent = fmtSize(file.size);
    document.getElementById('fileInfo').className = 'file-info on';
    refreshIngestActionButtons();
  }
  function clearFile() {
    selectedFile = null; fileInput.value = '';
    document.getElementById('fileInfo').className = 'file-info';
    refreshIngestActionButtons();
  }
  function fmtSize(b) { return b<1024?b+' B':b<1048576?(b/1024).toFixed(1)+' KB':(b/1048576).toFixed(1)+' MB'; }
  function refreshIngestActionButtons() {
    const running = Boolean(activeJobId);
    const fileButtonsEnabled = Boolean(selectedFile) && !running;
    const btnIngestFile = document.getElementById('btnIngestFile');
    const btnAppendFile = document.getElementById('btnAppendFile');
    if (btnIngestFile) btnIngestFile.disabled = !fileButtonsEnabled;
    if (btnAppendFile) btnAppendFile.disabled = !fileButtonsEnabled;
  }

  // ─── Upload & Ingest (user-selected file) ───
  async function startIngestionFile(mode = 'replace') {
    if(activeJobId) { showToast('An ingestion job is already running'); return; }
    if(!selectedFile) { showToast('Select a JSON file first'); return; }
    const appendMode = mode === 'append';
    const btn = document.getElementById(appendMode ? 'btnAppendFile' : 'btnIngestFile');
    const fd = new FormData(); fd.append('file', selectedFile);
    try {
      refreshIngestActionButtons();
      const r = await fetch(`${KB_BASE}/upload?mode=${appendMode ? 'append' : 'replace'}`,{method:'POST',body:fd});
      const d = await r.json();
      if(!r.ok) throw new Error(d.error);
      activeJobId = d.jobId;
      rememberUploadedFile(d.fileName, d.mode || mode);
      refreshIngestActionButtons();
      showToast(`${appendMode ? 'Add' : 'Ingestion'} started (job ${d.jobId})`);
      appendLog('info',`Started ${appendMode ? 'append' : 'replace'}: ${d.fileName} (${fmtSize(d.fileSize)})`);
      clearFile(); startPolling();
    } catch(e) {
      showToast(e.message);
      refreshIngestActionButtons();
    }
  }

  // ─── Profile file upload handling ───

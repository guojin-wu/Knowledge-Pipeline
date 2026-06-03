  const KB_BASE = '/kb';
  // Demo mode — skip all backend API calls to avoid console errors when no server is running
  const KB_DEMO_MODE = (window.location.hostname === 'localhost' || window.location.protocol === 'file:' || !navigator.onLine || true);
  const PROFILE_SNAPSHOT_KEY = 'kb_profile_snapshot';
  const KB_UI_MEMORY_KEY = 'kb_ui_memory';
  let pendingDeleteSourceFile = '';
  // ─── Prompt Manager Config (shared for Profiling + Cleaning) ───
  const PM_CONFIGS = {
    profiling: {
      storageKey: 'kb_analysis_prompts_v2',
      selectedKey: 'kb_selected_analysis_prompt_v2',
      defaults: [
        { id:'default-general', name:'General Analysis', content:'Analyze this dataset for structure and quality. Report total tickets, messages, average thread length, noise ratio, and top issue categories. Flag any data quality concerns.', isDefault:true },
        { id:'default-rag', name:'RAG Readiness Check', content:'Evaluate this dataset for RAG pipeline readiness. Check noise levels (headers, signatures, quoted chains), encoding artifacts, semantic diversity, and recommend chunking strategy for optimal retrieval.', isDefault:true },
      ],
      selectId: 'profilingPromptSelect',
      titleId: 'profilingPromptTitle',
      textareaId: 'profilingPromptTextarea',
      deleteBtnId: 'profilingBtnDelete',
    },
    cleaning: {
      storageKey: 'kb_cleaning_prompts_v2',
      selectedKey: 'kb_selected_cleaning_prompt_v2',
      defaults: [
        { id:'default-standard', name:'Standard Cleaning', content:'Apply all cleaning rules: strip quoted reply chains, fix encoding artifacts, remove HTML tags, normalize whitespace. Preserve original message content.', isDefault:true },
        { id:'default-minimal', name:'Minimal Cleaning', content:'Light cleaning only: fix encoding artifacts and normalize whitespace. Keep signatures, quoted chains, and original formatting intact.', isDefault:true },
      ],
      selectId: 'cleaningPromptSelect',
      titleId: 'cleaningPromptTitle',
      textareaId: 'cleaningPromptTextarea',
      deleteBtnId: 'cleaningBtnDelete',
    },
  };
  const KB_VIEWS = ['overview', 'analysis', 'cleaning', 'quality-review', 'rag-ingestion', 'llm-evaluation'];
  const INGEST_FILE_HISTORY_KEY = 'kbIngestFileHistory';
  const INGEST_SOURCE_CACHE_KEY = 'kbIngestSourceCache';
  let activeJobId = null, pollWorker = null, knownLogCount = 0;
  let activeKbView = 'overview';
  let jobsCache = [];
  let qdrantSourceFiles = [];

  function getKbViewFromHash() {
    try {
      const raw = String(window.location.hash || '').replace(/^#/, '').trim();
      if (!raw) return '';
      if (KB_VIEWS.includes(raw)) return raw;
      if (raw.startsWith('kb=')) {
        const view = raw.slice(3);
        return KB_VIEWS.includes(view) ? view : '';
      }
      return '';
    } catch (_e) {
      return '';
    }
  }

  function getKbUiMemory() {
    try {
      const hashView = getKbViewFromHash();
      const raw = localStorage.getItem(KB_UI_MEMORY_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return {
        activeView: hashView || (KB_VIEWS.includes(parsed?.activeView) ? parsed.activeView : 'overview'),
        collapsed: !!parsed?.collapsed
      };
    } catch (_e) {
      return { activeView: getKbViewFromHash() || 'overview', collapsed: false };
    }
  }

  function saveKbUiMemory(patch = {}) {
    try {
      const current = getKbUiMemory();
      const next = { ...current, ...patch };
      localStorage.setItem(KB_UI_MEMORY_KEY, JSON.stringify(next));
    } catch (_e) {}
  }

  function getIngestFileHistory() {
    try {
      const raw = localStorage.getItem(INGEST_FILE_HISTORY_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (_e) {
      return [];
    }
  }

  function getIngestSourceCache() {
    try {
      const raw = localStorage.getItem(INGEST_SOURCE_CACHE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (_e) {
      return [];
    }
  }

  function saveIngestSourceCache(items) {
    try {
      localStorage.setItem(INGEST_SOURCE_CACHE_KEY, JSON.stringify((Array.isArray(items) ? items : []).slice(0, 50)));
    } catch (_e) {}
  }

  function saveIngestFileHistory(items) {
    try {
      localStorage.setItem(INGEST_FILE_HISTORY_KEY, JSON.stringify(items.slice(0, 12)));
    } catch (_e) {}
  }

  function mergeIngestFileHistory(items = []) {
    const existing = getIngestFileHistory();
    const merged = new Map();
    [...items, ...existing].forEach(item => {
      if (!item || !item.fileName) return;
      const prev = merged.get(item.fileName);
      const nextTs = new Date(item.startedAt || item.time || 0).getTime() || 0;
      const prevTs = prev ? (new Date(prev.startedAt || prev.time || 0).getTime() || 0) : -1;
      if (!prev || nextTs >= prevTs) merged.set(item.fileName, item);
    });
    const result = [...merged.values()]
      .sort((a, b) => (new Date(b.startedAt || b.time || 0).getTime() || 0) - (new Date(a.startedAt || a.time || 0).getTime() || 0))
      .slice(0, 12);
    saveIngestFileHistory(result);
    return result;
  }

  function mergeDisplayedIngestFiles(items = getIngestFileHistory(), sources = qdrantSourceFiles) {
    const merged = new Map();
    [...(items || []), ...(sources || []).map(s => ({
      fileName: s.fileName,
      mode: 'existing',
      startedAt: s.lastSeen || null,
      sourceCount: s.count || 0,
      fromDb: true
    }))].forEach(item => {
      if (!item || !item.fileName) return;
      const prev = merged.get(item.fileName);
      const nextTs = new Date(item.startedAt || item.time || 0).getTime() || 0;
      const prevTs = prev ? (new Date(prev.startedAt || prev.time || 0).getTime() || 0) : -1;
      if (!prev) {
        merged.set(item.fileName, item);
        return;
      }
      const fromDb = !!(prev.fromDb || item.fromDb);
      merged.set(item.fileName, {
        ...prev,
        ...item,
        mode: prev.mode === 'append' || item.mode === 'append' ? 'append' : (prev.mode || item.mode),
        startedAt: nextTs >= prevTs ? (item.startedAt || item.time || prev.startedAt || prev.time || null) : (prev.startedAt || prev.time || item.startedAt || item.time || null),
        sourceCount: Math.max(prev.sourceCount || 0, item.sourceCount || 0),
        fromDb,
        deleted: fromDb ? false : !!(prev.deleted || item.deleted)
      });
    });
    return [...merged.values()]
      .filter(item => item && item.fileName && !item.deleted)
      .sort((a, b) => (new Date(b.startedAt || b.time || 0).getTime() || 0) - (new Date(a.startedAt || a.time || 0).getTime() || 0))
      .slice(0, 20);
  }

  function rememberUploadedFile(fileName, mode = 'replace', startedAt = new Date().toISOString()) {
    if (!fileName) return;
    const history = mergeIngestFileHistory([{ fileName, mode, startedAt }]);
    renderIngestFileHistory(history);
  }

  function tombstoneUploadedFile(fileName, startedAt = new Date().toISOString()) {
    if (!fileName) return;
    const history = mergeIngestFileHistory([{ fileName, deleted: true, startedAt }]);
    renderIngestFileHistory(history);
  }

  function renderIngestFileHistory(items = getIngestFileHistory()) {
    const el = document.getElementById('fileHistoryList');
    if (!el) return;
    const visibleItems = mergeDisplayedIngestFiles(items, qdrantSourceFiles);
    if (!visibleItems.length) {
      el.innerHTML = '<div class="file-history-empty">No uploaded files yet</div>';
      return;
    }
    el.innerHTML = visibleItems.map(item => {
      const dt = item.startedAt || item.time;
      const meta = dt ? new Date(dt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
      const encodedName = encodeURIComponent(String(item.fileName));
      const modeLabel = item.mode === 'append' ? 'add' : item.mode === 'replace' ? 'replace' : 'existing';
      const sourceMeta = item.sourceCount ? `${item.sourceCount} vector${item.sourceCount === 1 ? '' : 's'}` : '';
      const metaLabel = [modeLabel, meta, sourceMeta].filter(Boolean).join(' · ');
      return `<div class="file-history-chip" title="${esc(item.fileName)}">
        <span class="name">${esc(item.fileName)}</span>
        <span class="mode">${esc(modeLabel)}</span>
        <span class="meta">${esc(metaLabel.replace(new RegExp(`^${modeLabel} · `), ''))}</span>
        <button class="delete" type="button" title="Delete this source from the vector DB" onclick="openDeleteSourceConfirm(decodeURIComponent('${encodedName}'))">&times;</button>
      </div>`;
    }).join('');
  }

  async function loadIngestedSources() {
    if (KB_DEMO_MODE) return;
    try {
      const r = await fetch(`${KB_BASE}/sources?_=${Date.now()}`, { cache: 'no-store' });
      const sources = await r.json();
      if (!r.ok) throw new Error(sources.error || 'Failed to load sources');
      const fresh = Array.isArray(sources) ? sources : [];
      qdrantSourceFiles = fresh;
      // Only update cache if Qdrant returned actual data.
      // If Qdrant returned empty (e.g. data lost after container restart),
      // keep the existing cache so localStorage history can still be shown.
      if (fresh.length > 0) {
        saveIngestSourceCache(fresh);
      } else {
        // Qdrant is empty — check if we have cached sources or file history
        const cachedSources = getIngestSourceCache();
        const historyItems  = getIngestFileHistory();
        if (cachedSources.length || historyItems.length) {
          // Data may have been lost from Qdrant. Show a subtle warning.
          appendLog('warn', 'Qdrant collection is empty — previously uploaded files may have been lost. Re-upload your JSON dataset to restore them.');
        }
      }
      renderIngestFileHistory();
    } catch (_e) {
      const cachedSources = getIngestSourceCache();
      if (cachedSources.length) {
        qdrantSourceFiles = cachedSources;
        renderIngestFileHistory();
      }
      setTimeout(() => {
        fetch(`${KB_BASE}/sources?_=${Date.now()}`, { cache: 'no-store' })
          .then(r => r.json().then(data => ({ ok: r.ok, data })))
          .then(({ ok, data }) => {
            if (!ok) return;
            const retryFresh = Array.isArray(data) ? data : [];
            qdrantSourceFiles = retryFresh;
            // Same guard: don't wipe cache on empty Qdrant
            if (retryFresh.length > 0) saveIngestSourceCache(retryFresh);
            renderIngestFileHistory();
          })
          .catch(() => {});
      }, 1500);
    }
  }

  function refreshIngestedSourcesSoon(delay = 0) {
    setTimeout(() => {
      loadIngestedSources().catch?.(() => {});
    }, delay);
  }

  function refreshUploadedFiles() {
    loadIngestedSources().catch?.(() => {});
    loadJobs().catch?.(() => {});
  }

  function openDeleteSourceConfirm(fileName) {
    const sourceFile = String(fileName || '').trim();
    if (!sourceFile) return;
    pendingDeleteSourceFile = sourceFile;
    const overlay = document.getElementById('deleteSourceConfirmOverlay');
    const fileEl = document.getElementById('deleteSourceConfirmFile');
    if (fileEl) fileEl.textContent = sourceFile;
    if (overlay) overlay.classList.add('open');
  }

  function closeDeleteSourceConfirm() {
    pendingDeleteSourceFile = '';
    const overlay = document.getElementById('deleteSourceConfirmOverlay');
    if (overlay) overlay.classList.remove('open');
  }

  async function confirmDeleteIngestedSource() {
    const sourceFile = String(pendingDeleteSourceFile || '').trim();
    if (!sourceFile) {
      closeDeleteSourceConfirm();
      return;
    }
    try {
      const r = await fetch(`${KB_BASE}/delete-source`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceFile })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Failed to delete source');
      tombstoneUploadedFile(sourceFile);
      qdrantSourceFiles = qdrantSourceFiles.filter(item => item && item.fileName !== sourceFile);
      closeDeleteSourceConfirm();
      renderIngestFileHistory();
      showToast(`Deleted vectors for ${sourceFile}`);
      appendLog('info', `Deleted all vectors ingested from "${sourceFile}"`);
    } catch (e) {
      closeDeleteSourceConfirm();
      showToast(e.message || 'Failed to delete source');
    }
  }

  // ─── Generic Prompt Manager (works for both profiling & cleaning) ───
  function pmGetPrompts(scope) {
    const cfg = PM_CONFIGS[scope];
    try {
      const raw = localStorage.getItem(cfg.storageKey);
      if (!raw) return [...cfg.defaults];
      const parsed = JSON.parse(raw);
      const ids = new Set(parsed.map(p => p.id));
      for (const def of cfg.defaults) {
        if (!ids.has(def.id)) parsed.unshift(def);
      }
      return parsed;
    } catch (_e) { return [...cfg.defaults]; }
  }
  function pmSavePrompts(scope, prompts) {
    try { localStorage.setItem(PM_CONFIGS[scope].storageKey, JSON.stringify(prompts)); } catch (_e) {}
  }
  function pmGetSelectedId(scope) {
    const cfg = PM_CONFIGS[scope];
    try { return localStorage.getItem(cfg.selectedKey) || cfg.defaults[0].id; } catch (_e) { return cfg.defaults[0].id; }
  }
  function pmSetSelectedId(scope, id) {
    try { localStorage.setItem(PM_CONFIGS[scope].selectedKey, id); } catch (_e) {}
  }
  function pmPopulate(scope) {
    const cfg = PM_CONFIGS[scope];
    const select = document.getElementById(cfg.selectId);
    if (!select) return;
    const prompts = pmGetPrompts(scope);
    const selectedId = pmGetSelectedId(scope);
    select.innerHTML = prompts.map(p =>
      `<option value="${p.id}">${esc(p.name)}${p.isDefault ? ' (default)' : ''}</option>`
    ).join('') + '<option value="__new__">+ New Custom Prompt</option>';
    select.value = prompts.find(p => p.id === selectedId) ? selectedId : prompts[0].id;
    // Also populate the custom dropdown menu if it exists
    const menuId = cfg.selectId.replace('Select', 'Menu');
    const menu = document.getElementById(menuId);
    const btnId = cfg.selectId.replace('Select', 'Btn');
    const btn = document.getElementById(btnId);
    if (menu) {
      const activeId = select.value;
      menu.innerHTML = prompts.map(p =>
        `<div class="ai-dropdown-item${p.id === activeId ? ' active' : ''}" data-value="${p.id}" onclick="pmSelectFromDropdown('${scope}',this)">${esc(p.name)}${p.isDefault ? ' <span style=&quot;opacity:0.5;font-size:10px;&quot;>(default)</span>' : ''}</div>`
      ).join('') + `<div class="ai-dropdown-item" data-value="__new__" onclick="pmSelectFromDropdown('${scope}',this)" style="border-top:1px solid var(--border);margin-top:4px;padding-top:8px;">+ New Prompt</div>`;
    }
    if (btn) {
      const current = prompts.find(p => p.id === select.value);
      btn.querySelector('span').textContent = current ? current.name : 'Select prompt...';
    }
    pmOnSelect(scope);
  }
  function pmSelectFromDropdown(scope, el) {
    const val = el.dataset.value;
    const cfg = PM_CONFIGS[scope];
    const select = document.getElementById(cfg.selectId);
    if (select) select.value = val;
    const wrap = el.closest('.ai-dropdown');
    if (wrap) wrap.classList.remove('open');
    wrap?.querySelectorAll('.ai-dropdown-item').forEach(i => i.classList.remove('active'));
    el.classList.add('active');
    const btnId = cfg.selectId.replace('Select', 'Btn');
    const btn = document.getElementById(btnId);
    if (btn) btn.querySelector('span').textContent = el.textContent.replace(' (default)', '').trim();
    pmOnSelect(scope);
  }
  window.pmSelectFromDropdown = pmSelectFromDropdown;
  function pmOnSelect(scope) {
    const cfg = PM_CONFIGS[scope];
    const select = document.getElementById(cfg.selectId);
    const titleInput = document.getElementById(cfg.titleId);
    const textarea = document.getElementById(cfg.textareaId);
    const deleteBtn = document.getElementById(cfg.deleteBtnId);
    const selectedId = select.value;
    if (selectedId === '__new__') {
      titleInput.value = '';
      titleInput.readOnly = false;
      textarea.value = '';
      deleteBtn.style.display = 'none';
      pmSetSelectedId(scope, '__new__');
      return;
    }
    const prompts = pmGetPrompts(scope);
    const prompt = prompts.find(p => p.id === selectedId);
    if (prompt) {
      titleInput.value = prompt.name;
      titleInput.readOnly = !!prompt.isDefault;
      textarea.value = prompt.content;
      deleteBtn.style.display = prompt.isDefault ? 'none' : '';
      pmSetSelectedId(scope, selectedId);
    }
  }
  function pmSave(scope) {
    const cfg = PM_CONFIGS[scope];
    const titleInput = document.getElementById(cfg.titleId);
    const textarea = document.getElementById(cfg.textareaId);
    const select = document.getElementById(cfg.selectId);
    const content = textarea.value.trim();
    const name = titleInput.value.trim();
    if (!content) { showToast('Enter prompt content before saving'); return; }
    if (!name) { showToast('Enter a prompt name'); titleInput.focus(); return; }
    const prompts = pmGetPrompts(scope);
    const selectedId = select.value;
    // If editing an existing custom prompt, update it in-place
    const existing = prompts.find(p => p.id === selectedId && !p.isDefault);
    if (existing) {
      existing.name = name;
      existing.content = content;
      pmSavePrompts(scope, prompts);
      pmPopulate(scope);
      showToast(`Prompt "${name}" updated`);
    } else {
      // Create new prompt
      const newPrompt = { id:'custom-'+Date.now(), name, content, isDefault:false, createdAt:new Date().toISOString() };
      prompts.push(newPrompt);
      pmSavePrompts(scope, prompts);
      pmSetSelectedId(scope, newPrompt.id);
      pmPopulate(scope);
      showToast(`Prompt "${name}" saved`);
    }
  }
  function pmDelete(scope) {
    const cfg = PM_CONFIGS[scope];
    const select = document.getElementById(cfg.selectId);
    const prompts = pmGetPrompts(scope);
    const prompt = prompts.find(p => p.id === select.value);
    if (!prompt || prompt.isDefault) { showToast('Cannot delete default prompts'); return; }
    if (!confirm(`Delete prompt "${prompt.name}"?`)) return;
    pmSavePrompts(scope, prompts.filter(p => p.id !== select.value));
    pmSetSelectedId(scope, cfg.defaults[0].id);
    pmPopulate(scope);
    showToast('Prompt deleted');
  }
  function pmGetContent(scope) {
    const el = document.getElementById(PM_CONFIGS[scope].textareaId);
    return (el && el.value.trim()) || '';
  }

  // ─── KB internal sidebar views ───

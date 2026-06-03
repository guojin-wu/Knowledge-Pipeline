/**
 * ai-settings-presets.js — Preset system, pane navigation, and connection testing
 * Handles loading/saving/applying presets, switching panes, and Ollama connection testing
 * Exposed on global scope: all functions available as window.functionName()
 */

// ─── PRESET STORAGE ──────────────────────────────────────────────────────
function loadAllPresets() {
  try {
    const raw = localStorage.getItem('ollamaPresets');
    if (!raw) return {};
    const data = JSON.parse(raw);
    if (data.cleanup && !data.normalize) { data.normalize = data.cleanup; delete data.cleanup; }
    return data;
  } catch (_) { return {}; }
}

function saveAllPresets(p) {
  try { localStorage.setItem('ollamaPresets', JSON.stringify(p)); } catch (_) {}
}

function getPresetValues(preset, presetDefaults) {
  return { ...presetDefaults[preset], ...(loadAllPresets()[preset] || {}) };
}

// ─── PARAM I/O (per-pane suffix) ─────────────────────────────────────────
function _sfx(pane, paneSuffix) { return paneSuffix[pane] || '_a'; }

function applyPresetToPane(preset, pane, presetDefaults, paneSuffix) {
  const v   = getPresetValues(preset, presetDefaults);
  const s   = _sfx(pane, paneSuffix);
  const set = (id, val) => { const el = document.getElementById(id + s); if (el) el.value = val; };
  set('aiTemperature',   v.temperature);
  set('aiTopP',          v.top_p);
  set('aiTopK',          v.top_k);
  set('aiRepeatPenalty', v.repeat_penalty);
  set('aiNumPredict',    v.num_predict);
  set('aiNumCtx',        v.num_ctx);
  set('aiSeed',          v.seed);
  set('aiBatchSize',     v.batch_size);
  set('aiConcurrency',   v.concurrency);
  set('aiThinking',      v.thinking || 'no');
  set('aiStop',          v.stop || '');
  // Also sync hidden canonical inputs (for getOllamaOptions compatibility)
  _syncCanonical(v);
}

function _syncCanonical(v) {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  set('aiTemperature',   v.temperature);
  set('aiTopP',          v.top_p);
  set('aiTopK',          v.top_k);
  set('aiRepeatPenalty', v.repeat_penalty);
  set('aiNumPredict',    v.num_predict);
  set('aiNumCtx',        v.num_ctx);
  set('aiSeed',          v.seed);
  set('aiBatchSize',     v.batch_size);
  set('aiConcurrency',   v.concurrency);
  set('aiThinking',      v.thinking || 'no');
  set('aiStop',          v.stop || '');
}

function readPresetFromPane(pane, paneSuffix) {
  const s = _sfx(pane, paneSuffix);
  const f = (id, fb) => { const v = parseFloat(document.getElementById(id + s)?.value); return isFinite(v) ? v : fb; };
  const i = (id, fb) => { const v = parseInt(document.getElementById(id + s)?.value, 10); return isFinite(v) ? v : fb; };
  return {
    temperature:    f('aiTemperature',   0.3),
    top_p:          f('aiTopP',          0.8),
    top_k:          i('aiTopK',          40),
    repeat_penalty: f('aiRepeatPenalty', 1.1),
    num_predict:    i('aiNumPredict',    2048),
    num_ctx:        i('aiNumCtx',        4096),
    seed:           i('aiSeed',          -1),
    batch_size:     i('aiBatchSize',     8),
    concurrency:    i('aiConcurrency',   1),
    thinking:       document.getElementById('aiThinking' + s)?.value || 'no',
    stop:           document.getElementById('aiStop' + s)?.value.trim() || '',
  };
}

// Legacy: read from canonical hidden inputs (used by getOllamaOptions)
function readPresetFromUI() {
  const f = (id, fb) => { const v = parseFloat(document.getElementById(id)?.value); return isFinite(v) ? v : fb; };
  const i = (id, fb) => { const v = parseInt(document.getElementById(id)?.value, 10); return isFinite(v) ? v : fb; };
  return {
    temperature:    f('aiTemperature',   0.3),
    top_p:          f('aiTopP',          0.8),
    top_k:          i('aiTopK',          40),
    repeat_penalty: f('aiRepeatPenalty', 1.1),
    num_predict:    i('aiNumPredict',    2048),
    num_ctx:        i('aiNumCtx',        4096),
    seed:           i('aiSeed',          -1),
    batch_size:     i('aiBatchSize',     8),
    concurrency:    i('aiConcurrency',   1),
    thinking:       document.getElementById('aiThinking')?.value || 'no',
    stop:           document.getElementById('aiStop')?.value.trim() || '',
  };
}

// Exposed globally for external callers
window.loadAllPresets = loadAllPresets;
window.saveAllPresets = saveAllPresets;
window.getPresetValues = getPresetValues;
window.applyPresetToPane = applyPresetToPane;
window.readPresetFromPane = readPresetFromPane;
window.readPresetFromUI = readPresetFromUI;

// ─── PANE NAVIGATION ─────────────────────────────────────────────────────
function switchAisPane(pane, context) {
  const overlay = context.overlay;
  const PANE_SUFFIX = context.PANE_SUFFIX;
  const AI_PRESET_DEFAULTS = context.AI_PRESET_DEFAULTS;
  const PANE_DEFAULT_PRESET = context.PANE_DEFAULT_PRESET;
  const _stateObj = context._stateObj;

  // Save current before switching
  saveCurrentPreset(context);

  _stateObj._currentPane = pane;

  // Update nav items
  overlay.querySelectorAll('.ais-nav-item').forEach(function (btn) {
    btn.classList.toggle('active', btn.dataset.pane === pane);
  });
  // Show correct pane
  overlay.querySelectorAll('.ais-pane').forEach(function (p) {
    p.classList.toggle('active', p.id === 'ais-pane-' + pane);
  });

  // Load preset for this pane
  if (PANE_DEFAULT_PRESET[pane]) {
    // For KB: use currently active KB tab, or default
    if (pane === 'kb') {
      const activeTab = overlay.querySelector('.ai-preset-tab.active');
      if (activeTab) {
        _stateObj._currentAiPreset = activeTab.dataset.preset;
      } else {
        _stateObj._currentAiPreset = 'diagnostic';
        const firstTab = overlay.querySelector('.ai-preset-tab');
        if (firstTab) firstTab.classList.add('active');
      }
    } else {
      _stateObj._currentAiPreset = PANE_DEFAULT_PRESET[pane];
    }
    applyPresetToPane(_stateObj._currentAiPreset, pane, AI_PRESET_DEFAULTS, PANE_SUFFIX);
    try { localStorage.setItem('ollamaActivePreset', _stateObj._currentAiPreset); } catch (_) {}
  }
  // Re-render workflow panel content when switching to that pane
  if (pane === 'workflow' && typeof buildWorkflowPanel === 'function') buildWorkflowPanel();
  // Load users when switching to users pane
  if (pane === 'users' && typeof loadUsersList === 'function') loadUsersList();
  // Build Pages visibility panel
  if (pane === 'pages' && typeof buildPagesPanel === 'function') buildPagesPanel();
}
window.switchAisPane = switchAisPane;

// ─── KB SUB-PRESET SWITCH ────────────────────────────────────────────────
function switchAiPreset(el, context) {
  const overlay = context.overlay;
  const AI_PRESET_DEFAULTS = context.AI_PRESET_DEFAULTS;
  const _stateObj = context._stateObj;

  saveCurrentPreset(context);
  const preset = el.dataset.preset;
  _stateObj._currentAiPreset = preset;
  overlay.querySelectorAll('.ai-preset-tab').forEach(function (t) { t.classList.remove('active'); });
  el.classList.add('active');
  applyPresetToPane(preset, 'kb', AI_PRESET_DEFAULTS, context.PANE_SUFFIX);
  try { localStorage.setItem('ollamaActivePreset', preset); } catch (_) {}
}
window.switchAiPreset = switchAiPreset;

function saveCurrentPreset(context) {
  const pane = context._stateObj._currentPane;
  const PANE_SUFFIX = context.PANE_SUFFIX;
  const _currentAiPreset = context._stateObj._currentAiPreset;
  if (!PANE_SUFFIX[pane]) return; // connection pane has no params
  const p = loadAllPresets();
  p[_currentAiPreset] = readPresetFromPane(pane, PANE_SUFFIX);
  saveAllPresets(p);
  _syncCanonical(p[_currentAiPreset]);
}
window.saveCurrentPreset = (fn) => fn(); // Will be bound in ai-settings.js

// ─── CONNECTION TEST ─────────────────────────────────────────────────────
let _testTimer = null;
function scheduleOllamaConnectionTest(delay) {
  clearTimeout(_testTimer);
  _testTimer = setTimeout(testOllamaConnection, delay || 300);
}

async function testOllamaConnection() {
  if (typeof KB_DEMO_MODE !== 'undefined' && KB_DEMO_MODE) return;
  const mode    = document.getElementById('aiConnMode')?.value || 'direct';
  const baseUrl = mode === 'direct'
    ? (document.getElementById('aiApiUrl')?.value.trim() || 'http://localhost:11434')
    : window.location.origin;
  const dot    = document.getElementById('aiDot');
  const status = document.getElementById('aiConnStatus');
  if (dot)    dot.className    = 'ai-dot busy';
  if (status) status.textContent = 'Testing...';
  _syncNavDot('ai-dot busy');

  try {
    const res  = await fetch(baseUrl + '/api/tags', { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    const models  = (data.models || []).map(m => m.name || m.model || '');
    const sel     = document.getElementById('aiModel');
    const current = sel?.value || '';
    const hasModel = current ? models.some(m => m.startsWith(current.split(':')[0])) : models.length > 0;
    const cls = hasModel ? 'ai-dot ok' : 'ai-dot warn';
    if (dot)    dot.className = cls;
    if (status) { status.textContent = hasModel ? 'Connected' : (current ? `Online · ${current} not found` : 'Online'); status.style.color = 'var(--text2)'; }
    _syncNavDot(cls);

    if (window.AI_REVIEWER) {
      window.AI_REVIEWER.apiUrl   = baseUrl;
      window.AI_REVIEWER.useProxy = (mode === 'proxy');
      window.AI_REVIEWER.proxyBase = window.location.origin;
    }

    if (sel && models.length) {
      const embedPat = /embed|nomic-embed|bge-|e5-|gte-|all-minilm/i;
      const chat = models.filter(m => !embedPat.test(m));
      const list = chat.length ? chat : models;
      sel.innerHTML = '';
      list.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m; opt.textContent = m;
        if (m === current) opt.selected = true;
        sel.appendChild(opt);
      });
      if (!current && list.length) sel.value = list[0];
    }

    if (typeof preferDiagnosticsModel === 'function') preferDiagnosticsModel();

  } catch (e) {
    if (dot)    dot.className = 'ai-dot err';
    if (status) { status.textContent = 'Offline'; status.style.color = 'var(--text3)'; }
    _syncNavDot('ai-dot err');
    if (!testOllamaConnection._retried) {
      testOllamaConnection._retried = true;
      setTimeout(() => { testOllamaConnection._retried = false; testOllamaConnection(); }, 5000);
    }
  }
}
window.testOllamaConnection = testOllamaConnection;

/* Nav dot: stay green until we've connected at least once, then allow err */
let _navDotConnectedOnce = false;

function _syncNavDot(cls) {
  const d = document.getElementById('aiDotNav');
  if (!d) return;
  if (cls === 'ai-dot ok' || cls === 'ai-dot warn') _navDotConnectedOnce = true;
  if (cls === 'ai-dot err' && !_navDotConnectedOnce) return;
  d.className = cls;
}

function toggleAiApiUrl() {
  const el = document.getElementById('aiApiUrl');
  if (el) el.style.display = document.getElementById('aiConnMode')?.value === 'direct' ? '' : 'none';
  scheduleOllamaConnectionTest(150);
}
window.toggleAiApiUrl = toggleAiApiUrl;
window.scheduleOllamaConnectionTest = scheduleOllamaConnectionTest;

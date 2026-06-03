/**
 * ai-settings.js — Main entry point for AI Settings Panel (full-page layout)
 *
 * DEPENDENCIES: This file expects the following to be loaded BEFORE it:
 * - ai-settings-presets.js (preset management, pane navigation, connection testing)
 * - ai-settings-workflow.js (workflow panel builder)
 *
 * This file provides:
 * - CSS injection for the entire panel
 * - HTML template for the settings panel overlay
 * - Initialization and integration logic
 * - User management and page visibility controls
 *
 * Include this on every page that needs the AI settings panel.
 * Usage: <script src="ai-settings-presets.js"></script>
 *        <script src="ai-settings-workflow.js"></script>
 *        <script src="ai-settings.js"></script>
 */

(function () {
  'use strict';

  // ─── CSS ─────────────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    @keyframes aiPulse   { 0%,100%{opacity:1} 50%{opacity:.3} }
    @keyframes aiFadeIn  { from{opacity:0;transform:scale(.97)} to{opacity:1;transform:scale(1)} }

    /* ── shared inputs ── */
    .ai-input { width:100%; padding:6px 8px; border:1px solid var(--border); border-radius:6px; font-size:12px; font-family:var(--font); background:var(--bg1,var(--bg)); color:var(--text); box-sizing:border-box; }
    .ai-input:focus { outline:none; border-color:var(--blue,#0a84ff); }
    select.ai-input { appearance:auto; }
    .ai-field-label { font-size:10px; color:var(--text3); display:block; margin-bottom:3px; text-transform:uppercase; letter-spacing:.3px; font-weight:500; }

    /* ── KB sub-tabs ── */
    .ai-preset-tabs { display:flex; gap:0; border:1px solid var(--border); border-radius:8px; overflow:hidden; }
    .ai-preset-tab  { flex:1; padding:7px 4px; font-size:11px; font-weight:500; font-family:var(--font); background:var(--bg1,var(--bg)); color:var(--text3); border:none; cursor:pointer; transition:all 0.15s; border-right:1px solid var(--border); }
    .ai-preset-tab:last-child { border-right:none; }
    .ai-preset-tab:hover  { background:var(--bg2); color:var(--text2); }
    .ai-preset-tab.active { background:var(--text); color:#fff; font-weight:600; }

    /* ── overlay: flex centering ── */
    #ollamaSettingsOverlay {
      display:none; position:fixed; inset:0; z-index:9999;
      background:rgba(0,0,0,.35); backdrop-filter:blur(2px);
      align-items:center; justify-content:center;
    }

    /* ── panel: CSS Grid — row 0: header (auto), row 1: body (fills rest) ── */
    #ollamaSettingsPanel {
      width:min(860px, calc(100vw - 32px));
      height:min(640px, calc(100vh - 48px));
      background:var(--bg);
      border:1px solid var(--border);
      border-radius:14px;
      box-shadow:0 16px 60px rgba(0,0,0,.2);
      animation:aiFadeIn .15s ease;
      display:grid;
      grid-template-rows:auto 1fr;
      overflow:hidden;
    }

    /* ── header (grid row 0) ── */
    .ais-header {
      display:flex; align-items:center; justify-content:space-between;
      padding:14px 20px;
      border-bottom:1px solid var(--border);
    }
    .ais-header-title { font-size:14px; font-weight:600; color:var(--text); }
    .ais-header-right { display:flex; align-items:center; gap:10px; }

    /* ── body (grid row 1): CSS Grid — col 0: nav (150px), col 1: content (fills rest) ── */
    .ais-body {
      display:grid;
      grid-template-columns:150px 1fr;
      overflow:hidden;
    }

    /* ── sidebar nav ── */
    .ais-nav {
      border-right:1px solid var(--border);
      padding:10px 0;
      overflow-y:auto;
      overflow-x:hidden;
    }
    .ais-nav-item {
      display:flex; align-items:center; gap:8px;
      padding:9px 12px;
      font-size:12px; font-weight:500;
      color:var(--text3);
      cursor:pointer;
      border:none; background:none;
      font-family:var(--font);
      text-align:left;
      border-radius:8px;
      margin:0 6px;
      width:calc(100% - 12px);
      box-sizing:border-box;
      transition:background .1s, color .1s;
    }
    .ais-nav-item:hover  { background:var(--bg1); color:var(--text2); }
    .ais-nav-item.active { background:var(--bg2); color:var(--text); font-weight:600; }
    .ais-nav-icon { opacity:.5; flex-shrink:0; }
    .ais-nav-item.active .ais-nav-icon { opacity:1; }
    .ais-nav-sep { height:1px; background:var(--border); margin:6px 16px; }

    /* ── content panes ── */
    .ais-content { overflow-y:auto; overflow-x:hidden; }
    .ais-pane { display:none; padding:24px 28px; }
    .ais-pane.active { display:block; }
    .ais-pane-title { font-size:13px; font-weight:600; color:var(--text); margin-bottom:4px; }
    .ais-pane-sub   { font-size:11px; color:var(--text3); margin-bottom:20px; line-height:1.5; }
    .ais-section-label {
      display:flex; align-items:center; gap:8px;
      font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:.6px;
      color:var(--text); margin-bottom:12px; margin-top:22px;
    }
    .ais-section-label:first-child { margin-top:4px; }
    .ais-section-label svg { color:var(--text); flex-shrink:0; }

    /* ── params grid ── */
    .ais-params-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; }
    .ais-param-item .ai-input  { text-align:center; padding:5px 4px; font-size:11px; }
    .ais-param-item .ai-field-label { font-size:9px; text-align:center; }
    .ais-params-grid2 { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-top:10px; }

    /* ── connection status dot ── */
    .ai-dot { display:inline-block; width:8px; height:8px; border-radius:50%; background:var(--text); }
    .ai-dot.ok   { background:#22c55e; }
    .ai-dot.err  { background:var(--red,#ff453a); }
    .ai-dot.warn { background:var(--text3); }
    .ai-dot.busy { background:var(--text); animation:aiPulse 1s infinite; }
  `;
  document.head.appendChild(style);

  // ─── PANEL HTML ──────────────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.id = 'ollamaSettingsOverlay';

  // Icons (inline SVG snippets)
  const ICON = {
    plug:   '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22V12"/><path d="M5 12H2a10 10 0 0 0 20 0h-3"/><rect x="7" y="2" width="10" height="8" rx="1"/><line x1="7" y1="6" x2="3" y2="6"/><line x1="17" y1="6" x2="21" y2="6"/></svg>',
    bot:    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><line x1="12" y1="7" x2="12" y2="11"/><line x1="8" y1="15" x2="8" y2="17"/><line x1="16" y1="15" x2="16" y2="17"/></svg>',
    flow:   '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="2"/><circle cx="19" cy="19" r="2"/><circle cx="5" cy="19" r="2"/><line x1="12" y1="7" x2="12" y2="14"/><polyline points="5,17 12,14 19,17"/></svg>',
    db:     '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v6c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/><path d="M3 11v6c0 1.66 4.03 3 9 3s9-1.34 9-3v-6"/></svg>',
    search: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    users:  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    eye:    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
  };

  // Shared params HTML (single set of inputs, shared across all panes)
  function paramsHTML(suffix) {
    // suffix allows unique IDs per pane if needed, but we use the canonical IDs on the active pane
    return `
      ${suffix === '_w' ? '<div style="height:1px;background:var(--border);margin:22px 0 0;"></div>' : ''}
      <div class="ais-section-label">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>
        <span>Model Parameters</span>
      </div>
      <div class="ais-params-grid">
        <div class="ais-param-item"><label class="ai-field-label">Temperature</label><input type="number" id="aiTemperature${suffix}" class="ai-input" value="0.3" min="0" max="2" step="0.05" onchange="saveCurrentPreset()"></div>
        <div class="ais-param-item"><label class="ai-field-label">Top P</label><input type="number" id="aiTopP${suffix}" class="ai-input" value="0.8" min="0" max="1" step="0.05" onchange="saveCurrentPreset()"></div>
        <div class="ais-param-item"><label class="ai-field-label">Top K</label><input type="number" id="aiTopK${suffix}" class="ai-input" value="40" min="0" max="200" step="1" onchange="saveCurrentPreset()"></div>
        <div class="ais-param-item"><label class="ai-field-label">Repeat Penalty</label><input type="number" id="aiRepeatPenalty${suffix}" class="ai-input" value="1.1" min="0.5" max="2" step="0.05" onchange="saveCurrentPreset()"></div>
        <div class="ais-param-item"><label class="ai-field-label">Max Predict</label><input type="number" id="aiNumPredict${suffix}" class="ai-input" value="2048" min="64" max="32768" step="64" onchange="saveCurrentPreset()"></div>
        <div class="ais-param-item"><label class="ai-field-label">Context</label><input type="number" id="aiNumCtx${suffix}" class="ai-input" value="4096" min="256" max="131072" step="256" onchange="saveCurrentPreset()"></div>
        <div class="ais-param-item"><label class="ai-field-label">Seed</label><input type="number" id="aiSeed${suffix}" class="ai-input" value="-1" min="-1" step="1" onchange="saveCurrentPreset()"></div>
        <div class="ais-param-item"><label class="ai-field-label">Batch Size</label><input type="number" id="aiBatchSize${suffix}" class="ai-input" value="8" min="1" max="50" onchange="saveCurrentPreset()"></div>
      </div>
      <div class="ais-params-grid2">
        <div><label class="ai-field-label">Concurrency</label><input type="number" id="aiConcurrency${suffix}" class="ai-input" value="1" min="1" max="6" onchange="saveCurrentPreset()"></div>
        <div><label class="ai-field-label">Thinking</label>
          <select id="aiThinking${suffix}" class="ai-input" onchange="saveCurrentPreset()">
            <option value="yes">Yes</option><option value="no" selected>No</option>
          </select>
        </div>
        <div><label class="ai-field-label">Stop Tokens</label><input type="text" id="aiStop${suffix}" class="ai-input" value="" placeholder="\\n, ###" onchange="saveCurrentPreset()"></div>
      </div>`;
  }

  overlay.innerHTML = `
    <div id="ollamaSettingsPanel">

      <!-- Header -->
      <div class="ais-header">
        <span class="ais-header-title">Pipeline Settings</span>
        <div class="ais-header-right">
          <span class="ai-dot" id="aiDot"></span>
          <span id="aiConnStatus" style="font-size:11px;color:var(--text3);">Not connected</span>
          <button onclick="toggleOllamaSettingsPanel()" style="background:none;border:none;cursor:pointer;padding:4px 6px;color:var(--text3);font-size:18px;line-height:1;border-radius:6px;" title="Close">&times;</button>
        </div>
      </div>

      <!-- Body -->
      <div class="ais-body">

        <!-- Left nav -->
        <div class="ais-nav">
          <button class="ais-nav-item active" data-pane="conn"      onclick="switchAisPane('conn', window._aisContext)">
            <span class="ais-nav-icon">${ICON.plug}</span>Connection
          </button>
          <div class="ais-nav-sep"></div>
          <button class="ais-nav-item" data-pane="kb"        onclick="switchAisPane('kb', window._aisContext)">
            <span class="ais-nav-icon">${ICON.db}</span>RAG Pipeline
          </button>
          <button class="ais-nav-item" data-pane="retrieval" onclick="switchAisPane('retrieval', window._aisContext)">
            <span class="ais-nav-icon">${ICON.search}</span>Retrieval
          </button>
        </div>

        <!-- Right content -->
        <div class="ais-content">

          <!-- ── Connection ── -->
          <div class="ais-pane active" id="ais-pane-conn">
            <div class="ais-pane-title">Connection</div>
            <div class="ais-pane-sub">Configure Ollama endpoint and select the model to use across all features.</div>

            <div class="ais-section-label">Endpoint</div>
            <div style="display:flex;gap:8px;margin-bottom:10px;">
              <div style="flex:3;">
                <label class="ai-field-label">URL</label>
                <input type="text" id="aiApiUrl" class="ai-input" value="http://localhost:11434" placeholder="Ollama base URL">
              </div>
              <div style="flex:1;">
                <label class="ai-field-label">Mode</label>
                <select id="aiConnMode" class="ai-input" onchange="toggleAiApiUrl()">
                  <option value="direct" selected>Direct</option>
                </select>
              </div>
            </div>

            <div class="ais-section-label">Model</div>
            <div style="display:flex;gap:8px;align-items:flex-end;">
              <div style="flex:1;">
                <label class="ai-field-label">Active Model</label>
                <select id="aiModel" class="ai-input"><option value="" disabled selected>Click Test to load models</option></select>
              </div>
              <button onclick="testOllamaConnection()" style="padding:7px 18px;font-size:12px;font-weight:500;font-family:var(--font);background:var(--bg2);border:1px solid var(--border);border-radius:6px;cursor:pointer;color:var(--text2);white-space:nowrap;flex-shrink:0;">Test Connection</button>
            </div>
          </div>

          <!-- ── AI Assistant ── -->
          <!-- ── RAG Pipeline Settings (injected by ai-settings-workflow.js) ── -->
          <div class="ais-pane" id="ais-pane-workflow" style="display:none;">
            <div id="sec-body-workflow"></div>
          </div>

          <!-- ── Knowledge Base ── -->
          <div class="ais-pane" id="ais-pane-kb">
            <div class="ais-pane-title">Knowledge Base</div>
            <div class="ais-pane-sub">Each pipeline stage uses its own tuned preset. Select a stage to view and edit its parameters.</div>

            <div class="ais-section-label">Pipeline Stage</div>
            <div class="ai-preset-tabs" style="margin-bottom:20px;">
              <button class="ai-preset-tab active" data-preset="diagnostic" onclick="switchAiPreset(this, window._aisContext)">Diagnostic</button>
              <button class="ai-preset-tab"        data-preset="scoring"    onclick="switchAiPreset(this, window._aisContext)">Filter</button>
              <button class="ai-preset-tab"        data-preset="normalize"  onclick="switchAiPreset(this, window._aisContext)">Normalize</button>
              <button class="ai-preset-tab"        data-preset="generalize" onclick="switchAiPreset(this, window._aisContext)">Generalize</button>
              <button class="ai-preset-tab"        data-preset="llm_eval"   onclick="switchAiPreset(this, window._aisContext)">LLM Eval</button>
              <button class="ai-preset-tab"        data-preset="qa_builder" onclick="switchAiPreset(this, window._aisContext)">QA Builder</button>
            </div>

            ${paramsHTML('_kb')}
          </div>

          <!-- ── Retrieval ── -->
          <div class="ais-pane" id="ais-pane-retrieval">
            <div class="ais-pane-title">Retrieval</div>
            <div class="ais-pane-sub">RAG query and vector search parameters. Balanced temperature for accurate but flexible retrieval.</div>
            ${paramsHTML('_r')}
          </div>

          <!-- ── Pages (global visibility) ── -->
          <div class="ais-pane" id="ais-pane-pages">
            <div class="ais-pane-title">Page Visibility</div>
            <div class="ais-pane-sub">Toggle which pages are visible across the app. Hidden pages disappear from navigation and their settings section is collapsed.</div>
            <div id="pageVisibilityList"></div>
          </div>

          <!-- ── Users ── -->
          <div class="ais-pane" id="ais-pane-users">
            <div class="ais-pane-title">User Management</div>
            <div class="ais-pane-sub">Create accounts and control page access for each user.</div>

            <div id="usersListContainer" style="margin-bottom:20px;"></div>

            <div style="border-top:1px solid var(--border);padding-top:16px;">
              <div class="ais-section-label">Create New User</div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
                <div><label class="ai-field-label">Username</label><input type="text" id="newUserName" class="ai-input" placeholder="username"></div>
                <div><label class="ai-field-label">Password</label><input type="password" id="newUserPass" class="ai-input" placeholder="password"></div>
              </div>
              <div style="margin-bottom:8px;">
                <label class="ai-field-label">Role</label>
                <select id="newUserRole" class="ai-input" onchange="toggleNewUserPages()">
                  <option value="user">User</option>
                  <option value="admin">Admin (all access)</option>
                </select>
              </div>
              <div id="newUserPagesSection">
                <label class="ai-field-label">Page Access</label>
                <div id="newUserPages" style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:10px;"></div>
              </div>
              <button onclick="createNewUser()" style="width:100%;padding:8px;font-size:12px;font-weight:600;font-family:var(--font);background:var(--text);color:#fff;border:none;border-radius:6px;cursor:pointer;">Create User</button>
              <div id="createUserMsg" style="font-size:11px;margin-top:6px;display:none;"></div>
            </div>
          </div>

        </div><!-- /ais-content -->
      </div><!-- /ais-body -->

      <!-- Hidden for KB compatibility -->
      <div style="display:none;">
        <input type="checkbox" id="aiReviewKept" checked>
        <input type="checkbox" id="aiReviewRemoved">
        <input type="checkbox" id="aiQuickMode">
        <!-- Canonical param IDs (aliases resolved in JS) -->
        <input type="hidden" id="aiTemperature">
        <input type="hidden" id="aiTopP">
        <input type="hidden" id="aiTopK">
        <input type="hidden" id="aiRepeatPenalty">
        <input type="hidden" id="aiNumPredict">
        <input type="hidden" id="aiNumCtx">
        <input type="hidden" id="aiSeed">
        <input type="hidden" id="aiBatchSize">
        <input type="hidden" id="aiConcurrency">
        <select id="aiThinking" style="display:none;"><option value="no" selected>No</option><option value="yes">Yes</option></select>
        <input type="hidden" id="aiStop">
      </div>
    </div>
  `;

  // ─── CONFIGURATION CONSTANTS ──────────────────────────────────────────────
  // Which pane each preset belongs to
  const PRESET_PANE = {
    assistant:  'assistant',
    triage:     'workflow',
    diagnostic: 'kb', scoring: 'kb', normalize: 'kb', generalize: 'kb', llm_eval: 'kb', qa_builder: 'kb',
    rag:        'retrieval',
  };
  // Default preset for each pane
  const PANE_DEFAULT_PRESET = {
    assistant: 'assistant',
    workflow:  'triage',
    kb:        'diagnostic',
    retrieval: 'rag',
  };
  // Per-pane param input suffixes
  const PANE_SUFFIX = {
    assistant: '_a',
    workflow:  '_w',
    kb:        '_kb',
    retrieval: '_r',
  };

  // ─── PRESET DEFAULTS ────────────────────────────────────────────────────
  const AI_PRESET_DEFAULTS = {
    assistant:  { temperature: 0.7,  top_p: 0.9, top_k: 40,  repeat_penalty: 1.1,  num_predict: 2048,  num_ctx: 4096,  seed: -1, batch_size: 8,  concurrency: 1, thinking: 'yes', stop: '' },
    triage:     { temperature: 0.1,  top_p: 0.8, top_k: 20,  repeat_penalty: 1.1,  num_predict: 256,   num_ctx: 4096,  seed: 42, batch_size: 8,  concurrency: 1, thinking: 'no',  stop: '' },
    diagnostic: { temperature: 0.3,  top_p: 0.8, top_k: 30,  repeat_penalty: 1.15, num_predict: 4096,  num_ctx: 8192,  seed: -1, batch_size: 15, concurrency: 3, thinking: 'no',  stop: '' },
    scoring:    { temperature: 0.1,  top_p: 0.8, top_k: 30,  repeat_penalty: 1.1,  num_predict: 512,   num_ctx: 4096,  seed: 42, batch_size: 10, concurrency: 2, thinking: 'no',  stop: '' },
    normalize:  { temperature: 0.1,  top_p: 0.7, top_k: 20,  repeat_penalty: 1.2,  num_predict: 1024,  num_ctx: 4096,  seed: 42, batch_size: 20, concurrency: 2, thinking: 'no',  stop: '' },
    generalize: { temperature: 0.1,  top_p: 0.7, top_k: 20,  repeat_penalty: 1.2,  num_predict: 1800,  num_ctx: 4096,  seed: 42, batch_size: 8,  concurrency: 2, thinking: 'no',  stop: '' },
    llm_eval:   { temperature: 0,    top_p: 1,   top_k: 1,   repeat_penalty: 1,    num_predict: 160,   num_ctx: 4096,  seed: 42, batch_size: 8,  concurrency: 2, thinking: 'no',  stop: '' },
    qa_builder: { temperature: 0.3,  top_p: 0.85,top_k: 40,  repeat_penalty: 1.1,  num_predict: 800,   num_ctx: 6144,  seed: -1, batch_size: 4,  concurrency: 1, thinking: 'no',  stop: '' },
    rag:        { temperature: 0.2,  top_p: 0.9, top_k: 40,  repeat_penalty: 1.1,  num_predict: 1024,  num_ctx: 8192,  seed: -1, batch_size: 4,  concurrency: 1, thinking: 'no',  stop: '' },
  };

  // State object accessible to preset module
  const _stateObj = {
    _currentAiPreset: 'assistant',
    _currentPane: 'conn'
  };

  // Context object passed to switchAisPane/switchAiPreset
  const context = {
    overlay: overlay,
    PANE_SUFFIX: PANE_SUFFIX,
    AI_PRESET_DEFAULTS: AI_PRESET_DEFAULTS,
    PANE_DEFAULT_PRESET: PANE_DEFAULT_PRESET,
    _stateObj: _stateObj
  };

  // Expose context globally so onclick handlers can access it
  window._aisContext = context;

  // Wrap saveCurrentPreset to pass context
  window.saveCurrentPreset = () => {
    window.saveCurrentPreset = (ctx) => {
      const pane = ctx._stateObj._currentPane;
      if (!ctx.PANE_SUFFIX[pane]) return;
      const p = window.loadAllPresets();
      p[ctx._stateObj._currentAiPreset] = window.readPresetFromPane(pane, ctx.PANE_SUFFIX);
      window.saveAllPresets(p);
      // No _syncCanonical here as it's in preset module
    };
    window.saveCurrentPreset(context);
  };

  // ─── PANEL OPEN/CLOSE ────────────────────────────────────────────────────
  function toggleOllamaSettingsPanel() {
    const isOpen = overlay.style.display !== 'none' && overlay.style.display !== '';
    overlay.style.display = isOpen ? 'none' : 'flex';
    if (!isOpen) {
      const panel = document.getElementById('ollamaSettingsPanel');
      if (panel) { panel.style.animation = 'none'; requestAnimationFrame(() => { panel.style.animation = ''; }); }
      try { applyGlobalPageVisibility(); } catch (_) {}
    }
  }
  window.toggleOllamaSettingsPanel = toggleOllamaSettingsPanel;

  overlay.addEventListener('click', function (e) {
    if (e.target === overlay) toggleOllamaSettingsPanel();
  });

  // ─── getOllamaOptions (external callers use canonical hidden inputs) ──────
  function getOllamaOptions() {
    const v = window.readPresetFromUI();
    const opts = {
      temperature:    v.temperature,
      top_p:          v.top_p,
      top_k:          v.top_k,
      repeat_penalty: v.repeat_penalty,
      num_predict:    v.num_predict,
      num_ctx:        v.num_ctx,
    };
    if (v.seed >= 0) opts.seed = v.seed;
    if (v.stop) opts.stop = v.stop.split(',').map(s => s.trim().replace(/\\n/g, '\n')).filter(Boolean);
    return opts;
  }
  window.getOllamaOptions = getOllamaOptions;

  // ─── Legacy stubs (kept for external call compatibility) ──────────────────
  window.toggleSettingsSection   = () => {};       // no-op
  window.toggleParamsSection     = () => {};       // no-op
  window.selectUseRow            = () => {};       // no-op
  window.selectPresetRow         = () => {};       // no-op

  // ─── GLOBAL PAGE VISIBILITY ─────────────────────────────────────────────
  const PAGE_VIS_KEY = 'aw_pageVisibility';
  function getPageVisibility() {
    try { return JSON.parse(localStorage.getItem(PAGE_VIS_KEY) || '{}') || {}; }
    catch { return {}; }
  }
  function setPageVisibility(id, on) {
    var v = getPageVisibility();
    if (on) delete v[id]; else v[id] = false;
    localStorage.setItem(PAGE_VIS_KEY, JSON.stringify(v));
  }
  function isPageVisible(id) {
    var v = getPageVisibility();
    return v[id] !== false;
  }
  window.isPageVisible      = isPageVisible;
  window.getPageVisibility  = getPageVisibility;
  window.setPageVisibility  = setPageVisibility;

  // Maps settings nav pane → the page id it configures
  var PANE_PAGE_ID = {
    assistant: 'ai-assistant',
    workflow:  'ai-workflow',
    kb:        'knowledge-base',
    retrieval: 'retrieval-config',
  };

  // Apply visibility: hide external .nav-links entries + settings nav items for hidden pages
  function applyGlobalPageVisibility() {
    var v = getPageVisibility();
    var user = null;
    try { user = JSON.parse(localStorage.getItem('authUser')); } catch (_) {}
    var isAdmin = user && user.role === 'admin';

    var PAGE_MAP = {
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
    document.querySelectorAll('.nav-links a').forEach(function(a){
      var href = (a.getAttribute('href') || '').replace('/', '');
      var pid  = PAGE_MAP[href];
      if (!pid) return;
      if (v[pid] === false) a.style.display = 'none';
    });

    Object.keys(PANE_PAGE_ID).forEach(function(pane){
      var pid = PANE_PAGE_ID[pane];
      var btn = overlay.querySelector('.ais-nav-item[data-pane="'+pane+'"]');
      if (!btn) return;
      btn.style.display = (v[pid] === false) ? 'none' : '';
    });

    var activePane = overlay.querySelector('.ais-nav-item.active');
    if (activePane && activePane.style.display === 'none') {
      if (typeof switchAisPane === 'function') switchAisPane('conn', context);
    }
  }
  window.applyGlobalPageVisibility = applyGlobalPageVisibility;

  function buildPagesPanel() {
    var container = document.getElementById('pageVisibilityList');
    if (!container) return;
    var v = getPageVisibility();
    container.innerHTML =
      '<style>' +
      '.pv-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;margin-bottom:6px;}' +
      '.pv-row:hover{border-color:var(--text3);}' +
      '.pv-name{font-size:12px;font-weight:500;color:var(--text);}' +
      '.pv-id{font-size:10px;color:var(--text3);margin-top:2px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;}' +
      '.pv-sw{display:flex;align-items:center;cursor:pointer;flex-shrink:0;}' +
      '.pv-sw input{position:absolute;opacity:0;width:0;height:0;}' +
      '.pv-sw-track{width:32px;height:18px;border-radius:10px;background:var(--border);transition:background .15s;}' +
      '.pv-sw-track.on{background:var(--text);}' +
      '.pv-sw-knob{width:14px;height:14px;border-radius:50%;background:#fff;margin-top:2px;transform:translateX(2px);transition:transform .15s;box-shadow:0 1px 2px rgba(0,0,0,.18);}' +
      '.pv-sw-track.on > .pv-sw-knob{transform:translateX(16px);}' +
      '</style>' +
      ALL_PAGE_OPTIONS.map(function(p){
        var EXCLUDE = ['settings','scraper','cron-monitor','llm-evaluation','triage-debug'];
        if (EXCLUDE.indexOf(p.id) >= 0) return '';
        var on = v[p.id] !== false;
        return '<div class="pv-row">'
             +   '<div style="min-width:0;flex:1;">'
             +     '<div class="pv-name">' + p.label + '</div>'
             +     '<div class="pv-id">' + p.id + '</div>'
             +   '</div>'
             +   '<label class="pv-sw">'
             +     '<input type="checkbox" ' + (on ? 'checked' : '') + ' '
             +       'onchange="(function(cb){ setPageVisibility(\'' + p.id + '\', !!cb.checked); '
             +       'var t=cb.parentElement.querySelector(\'.pv-sw-track\'); if(t) t.classList.toggle(\'on\', !!cb.checked); '
             +       'applyGlobalPageVisibility(); })(this)">'
             +     '<div class="pv-sw-track ' + (on ? 'on' : '') + '"><div class="pv-sw-knob"></div></div>'
             +   '</label>'
             + '</div>';
      }).join('');
  }
  window.buildPagesPanel = buildPagesPanel;

  // ─── USER MANAGEMENT ─────────────────────────────────────────────────────
  const ALL_PAGE_OPTIONS = [
    { id: 'ai-assistant',      label: 'AI Assistant' },
    { id: 'ai-workflow',       label: 'AI Workflow' },
    { id: 'knowledge-base',    label: 'Knowledge Base' },
    { id: 'retrieval-config',  label: 'Retrieval Config' },
    { id: 'qa-builder',        label: 'Support QA' },
    { id: 'internal-reminder', label: 'Internal AI' },
    { id: 'accuracy-test',     label: 'Accuracy Lab' },
    { id: 'scraper',           label: 'Scraper Dashboard' },
    { id: 'cron-monitor',      label: 'Cron Monitor' },
    { id: 'llm-evaluation',    label: 'LLM Evaluation' },
    { id: 'triage-debug',      label: 'Triage Debug' },
    { id: 'settings',          label: 'AI Settings' },
  ];

  function _authHeaders() {
    const token = localStorage.getItem('authToken');
    return token ? { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
  }

  function _isAdmin() {
    try {
      const u = JSON.parse(localStorage.getItem('authUser'));
      return u && u.role === 'admin';
    } catch { return false; }
  }

  function _showUsersNav() {
    if (!_isAdmin()) return;
    var u = document.getElementById('ais-nav-users');  if (u) u.style.display = '';
    var p = document.getElementById('ais-nav-pages');  if (p) p.style.display = '';
  }

  async function loadUsersList() {
    const container = document.getElementById('usersListContainer');
    if (!container) return;
    try {
      const res = await fetch('/auth/users', { headers: _authHeaders() });
      if (!res.ok) { container.innerHTML = '<div style="font-size:11px;color:var(--red);">Failed to load users</div>'; return; }
      const users = await res.json();
      if (!users.length) { container.innerHTML = '<div style="font-size:11px;color:var(--text3);">No users</div>'; return; }

      container.innerHTML = users.map(function(u) {
        var deleteBtn = '';
        if (u.username !== 'admin') {
          deleteBtn = '<button onclick="deleteUserConfirm(\'' + u.username + '\')" style="font-size:11px;padding:4px 10px;border:1px solid var(--border);border-radius:5px;background:none;cursor:pointer;color:var(--red);font-family:var(--font);">Delete</button>';
        }
        var pagesText = 'No pages';
        if (u.role === 'admin') {
          pagesText = 'All pages';
        } else if (u.pages && u.pages.length) {
          pagesText = u.pages.map(function(p) { var f = ALL_PAGE_OPTIONS.find(function(o){return o.id===p;}); return f ? f.label : p; }).join(', ');
        }
        var roleBg = u.role === 'admin' ? 'var(--text)' : 'var(--bg2)';
        var roleColor = u.role === 'admin' ? '#fff' : 'var(--text3)';
        return '<div style="display:flex;align-items:center;gap:8px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;margin-bottom:6px;">'
          + '<div style="flex:1;min-width:0;">'
          + '<div style="font-size:12px;font-weight:600;color:var(--text);">' + u.username
          + ' <span style="font-size:10px;font-weight:500;padding:1px 6px;border-radius:4px;background:' + roleBg + ';color:' + roleColor + ';margin-left:4px;">' + u.role + '</span></div>'
          + '<div style="font-size:10px;color:var(--text3);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + pagesText + '</div>'
          + '</div>'
          + '<button onclick="editUserModal(\'' + u.username + '\')" style="font-size:11px;padding:4px 10px;border:1px solid var(--border);border-radius:5px;background:none;cursor:pointer;color:var(--text2);font-family:var(--font);">Edit</button>'
          + deleteBtn
          + '</div>';
      }).join('');
    } catch (e) {
      container.innerHTML = '<div style="font-size:11px;color:var(--red);">Error: ' + e.message + '</div>';
    }
  }
  window.loadUsersList = loadUsersList;

  function renderNewUserPages() {
    const container = document.getElementById('newUserPages');
    if (!container) return;
    container.innerHTML = ALL_PAGE_OPTIONS.map(p => `
      <label style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text2);cursor:pointer;padding:3px 0;">
        <input type="checkbox" value="${p.id}" class="new-user-page-cb" style="accent-color:var(--text);">
        ${p.label}
      </label>
    `).join('');
  }

  function toggleNewUserPages() {
    const role = document.getElementById('newUserRole')?.value;
    const sec = document.getElementById('newUserPagesSection');
    if (sec) sec.style.display = role === 'admin' ? 'none' : '';
  }
  window.toggleNewUserPages = toggleNewUserPages;

  async function createNewUser() {
    const username = document.getElementById('newUserName')?.value.trim();
    const password = document.getElementById('newUserPass')?.value;
    const role = document.getElementById('newUserRole')?.value || 'user';
    const msgEl = document.getElementById('createUserMsg');

    if (!username || !password) {
      if (msgEl) { msgEl.textContent = 'Username and password required'; msgEl.style.color = 'var(--red)'; msgEl.style.display = 'block'; }
      return;
    }

    let pages = [];
    if (role === 'admin') {
      pages = ALL_PAGE_OPTIONS.map(p => p.id);
    } else {
      document.querySelectorAll('.new-user-page-cb:checked').forEach(cb => pages.push(cb.value));
    }

    try {
      const res = await fetch('/auth/users', {
        method: 'POST',
        headers: _authHeaders(),
        body: JSON.stringify({ username, password, role, pages })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      if (msgEl) { msgEl.textContent = 'User "' + username + '" created'; msgEl.style.color = 'var(--green,#30d158)'; msgEl.style.display = 'block'; }
      document.getElementById('newUserName').value = '';
      document.getElementById('newUserPass').value = '';
      document.querySelectorAll('.new-user-page-cb').forEach(cb => cb.checked = false);
      loadUsersList();
      setTimeout(() => { if (msgEl) msgEl.style.display = 'none'; }, 3000);
    } catch (e) {
      if (msgEl) { msgEl.textContent = e.message; msgEl.style.color = 'var(--red)'; msgEl.style.display = 'block'; }
    }
  }
  window.createNewUser = createNewUser;

  async function deleteUserConfirm(username) {
    if (!confirm('Delete user "' + username + '"?')) return;
    try {
      const res = await fetch('/auth/users/' + encodeURIComponent(username), {
        method: 'DELETE',
        headers: _authHeaders()
      });
      if (!res.ok) { const d = await res.json(); alert(d.error || 'Failed'); return; }
      loadUsersList();
    } catch (e) { alert(e.message); }
  }
  window.deleteUserConfirm = deleteUserConfirm;

  async function editUserModal(username) {
    let users;
    try {
      const res = await fetch('/auth/users', { headers: _authHeaders() });
      users = await res.json();
    } catch { return; }
    const user = users.find(u => u.username === username);
    if (!user) return;

    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;z-index:10001;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;';
    const isAdmin = user.role === 'admin';
    const pagesHTML = ALL_PAGE_OPTIONS.map(p => `
      <label style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text2);cursor:pointer;padding:3px 0;">
        <input type="checkbox" value="${p.id}" class="edit-user-page-cb" ${(user.pages||[]).includes(p.id)?'checked':''} style="accent-color:var(--text);" ${isAdmin?'disabled':''}>
        ${p.label}
      </label>
    `).join('');

    modal.innerHTML = `
      <div style="width:380px;background:var(--bg);border-radius:12px;padding:24px;box-shadow:0 12px 40px rgba(0,0,0,.2);">
        <div style="font-size:14px;font-weight:600;color:var(--text);margin-bottom:16px;">Edit User: ${username}</div>
        <div style="margin-bottom:10px;">
          <label class="ai-field-label">New Password (leave blank to keep)</label>
          <input type="password" id="editUserPass" class="ai-input" placeholder="new password">
        </div>
        <div style="margin-bottom:10px;">
          <label class="ai-field-label">Role</label>
          <select id="editUserRole" class="ai-input" onchange="document.getElementById('editPagesSection').style.display=this.value==='admin'?'none':'';">
            <option value="user" ${user.role==='user'?'selected':''}>User</option>
            <option value="admin" ${user.role==='admin'?'selected':''}>Admin (all access)</option>
          </select>
        </div>
        <div id="editPagesSection" style="${isAdmin?'display:none;':''}">
          <label class="ai-field-label">Page Access</label>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:12px;">
            ${pagesHTML}
          </div>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button id="editUserCancel" style="padding:7px 16px;font-size:12px;font-weight:500;font-family:var(--font);background:var(--bg2);border:1px solid var(--border);border-radius:6px;cursor:pointer;color:var(--text2);">Cancel</button>
          <button id="editUserSave" style="padding:7px 16px;font-size:12px;font-weight:600;font-family:var(--font);background:var(--text);color:#fff;border:none;border-radius:6px;cursor:pointer;">Save</button>
        </div>
        <div id="editUserMsg" style="font-size:11px;margin-top:8px;display:none;"></div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#editUserCancel').onclick = () => modal.remove();
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

    modal.querySelector('#editUserSave').onclick = async () => {
      const newPass = modal.querySelector('#editUserPass').value;
      const newRole = modal.querySelector('#editUserRole').value;
      let pages = [];
      if (newRole === 'admin') {
        pages = ALL_PAGE_OPTIONS.map(p => p.id);
      } else {
        modal.querySelectorAll('.edit-user-page-cb:checked').forEach(cb => pages.push(cb.value));
      }
      const body = { role: newRole, pages };
      if (newPass) body.password = newPass;

      try {
        const res = await fetch('/auth/users/' + encodeURIComponent(username), {
          method: 'PUT',
          headers: _authHeaders(),
          body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');
        modal.remove();
        loadUsersList();
      } catch (e) {
        const msg = modal.querySelector('#editUserMsg');
        if (msg) { msg.textContent = e.message; msg.style.color = 'var(--red)'; msg.style.display = 'block'; }
      }
    };
  }
  window.editUserModal = editUserModal;

  // ─── INIT ────────────────────────────────────────────────────────────────
  function _init() {
    document.body.appendChild(overlay);

    // Restore saved preset
    const saved = localStorage.getItem('ollamaActivePreset');
    if (saved && AI_PRESET_DEFAULTS[saved]) _stateObj._currentAiPreset = saved;

    // Restore URL + model
    const savedUrl = localStorage.getItem('ollamaApiUrl');
    if (savedUrl) { const el = document.getElementById('aiApiUrl'); if (el) el.value = savedUrl; }
    const savedModel = localStorage.getItem('ollamaModel');
    if (savedModel) {
      const sel = document.getElementById('aiModel');
      if (sel) sel.innerHTML = `<option value="${savedModel}" selected>${savedModel}</option>`;
    }

    // Determine which pane to open from saved preset
    const savedPane = PRESET_PANE[_stateObj._currentAiPreset] || 'conn';
    _stateObj._currentPane = savedPane;

    // Activate correct nav + pane
    overlay.querySelectorAll('.ais-nav-item').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.pane === savedPane);
    });
    overlay.querySelectorAll('.ais-pane').forEach(function (p) {
      p.classList.toggle('active', p.id === 'ais-pane-' + savedPane);
    });

    // Apply preset values to the correct pane
    if (PANE_SUFFIX[savedPane]) {
      window.applyPresetToPane(_stateObj._currentAiPreset, savedPane, AI_PRESET_DEFAULTS, PANE_SUFFIX);
    }

    // For KB: activate the correct sub-tab
    if (savedPane === 'kb') {
      overlay.querySelectorAll('.ai-preset-tab').forEach(function (t) {
        t.classList.toggle('active', t.dataset.preset === _stateObj._currentAiPreset);
      });
    }

    // Persist URL and model changes
    document.getElementById('aiApiUrl')?.addEventListener('input', function () {
      localStorage.setItem('ollamaApiUrl', this.value.trim());
      window.scheduleOllamaConnectionTest(600);
    });
    document.getElementById('aiModel')?.addEventListener('change', function () {
      localStorage.setItem('ollamaModel', this.value);
    });
    document.getElementById('aiConnMode')?.addEventListener('change', () => window.scheduleOllamaConnectionTest(150));

    // Populate the AI Workflow pane (Teams config, triage toggle, signals)
    if (typeof buildWorkflowPanel === 'function') buildWorkflowPanel();

    // Auto-connect on load
    window.scheduleOllamaConnectionTest(800);

    // User management
    _showUsersNav();
    renderNewUserPages();

    // Apply global page visibility
    try { applyGlobalPageVisibility(); } catch (_) {}

    // Auto-save on param change
    ['_a','_w','_kb','_r'].forEach(function (s) {
      const ids = ['aiTemperature','aiTopP','aiTopK','aiRepeatPenalty','aiNumPredict','aiNumCtx','aiSeed','aiBatchSize','aiConcurrency','aiThinking','aiStop'];
      ids.forEach(function (base) {
        const el = document.getElementById(base + s);
        if (el) {
          el.addEventListener('change', () => { window.saveCurrentPreset = () => window.saveCurrentPreset(context); window.saveCurrentPreset(); });
          el.addEventListener('input', () => { window.saveCurrentPreset = () => window.saveCurrentPreset(context); window.saveCurrentPreset(); });
        }
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    _init();
  }

})();

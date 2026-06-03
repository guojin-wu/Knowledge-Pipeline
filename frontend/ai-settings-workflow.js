/**
 * ai-settings-workflow.js — RAG Pipeline settings panel
 * Handles building the RAG pipeline configuration UI
 * Exposed on global scope: all functions available as window.functionName()
 */

// ─── WORKFLOW PANEL (shared across all pages) ────────────────────────────
function _wfLS(key, def) {
  try { var v = localStorage.getItem(key); return (v === null) ? def : v; } catch (_) { return def; }
}

function _getTriageAiEnabled() { return _wfLS('aw_triageAiEnabled', 'true') !== 'false'; }
function _getTriageFirstMsgOnly() { return _wfLS('aw_triageFirstMsgOnly', 'false') === 'true'; }
function _getTeamsEnabled()    { return false; }
function _getTeamsTrigger()    { return 'urgent'; }
function _getTeamsWebhookUrl() { return ''; }

function buildWorkflowPanel() {
  var body = document.getElementById('sec-body-workflow');
  if (!body) return;

  var chunkSize  = _wfLS('aw_ragChunkSize', '512');
  var chunkOverlap = _wfLS('aw_ragChunkOverlap', '64');
  var embModel   = _wfLS('aw_ragEmbedModel', 'nomic-embed-text');
  var vectorDb   = _wfLS('aw_ragVectorDb', 'chroma');
  var qaEnabled  = _wfLS('aw_ragQaEnabled', 'true') !== 'false';
  var dedup      = _wfLS('aw_ragDedupEnabled', 'true') !== 'false';

  var AW_ICON = {
    chunk:  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
    embed:  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12l3 3 5-5"/></svg>',
    db:     '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v6c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/><path d="M3 11v6c0 1.66 4.03 3 9 3s9-1.34 9-3v-6"/></svg>',
    clean:  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>',
  };

  body.innerHTML = `
    <style>
      .aw-sec { margin-top:22px; }
      .aw-sec:first-child { margin-top:4px; }
      .aw-sec-head {
        display:flex; align-items:center; justify-content:space-between;
        gap:10px; margin-bottom:12px;
      }
      .aw-sec-title {
        display:flex; align-items:center; gap:8px;
        font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:.6px;
        color:var(--text);
      }
      .aw-sec-title svg { opacity:1; color:var(--text); flex-shrink:0; }
      .aw-sec-sub { font-size:11px; color:var(--text3); margin:-4px 0 12px; line-height:1.5; }

      .aw-field { margin-bottom:10px; }
      .aw-field:last-child { margin-bottom:0; }
      .aw-grid2 { display:grid; grid-template-columns:1fr 1fr; gap:10px; }

      .aw-row {
        display:flex; align-items:center; justify-content:space-between;
        gap:12px; padding:7px 0; border-bottom:1px solid var(--border);
      }
      .aw-row:last-child { border-bottom:none; }
      .aw-row-text { font-size:12px; color:var(--text2); }
      .aw-row-desc { font-size:11px; color:var(--text3); margin-top:1px; line-height:1.4; }

      .aw-tag {
        font-size:10px; font-weight:600; letter-spacing:.04em;
        padding:2px 7px; border-radius:4px;
        border:1px solid var(--border); background:transparent; color:var(--text3);
      }

      .aw-switch { display:flex; align-items:center; cursor:pointer; position:relative; flex-shrink:0; }
      .aw-switch input { position:absolute; opacity:0; width:0; height:0; }
      .aw-switch-track { width:32px; height:18px; border-radius:10px; background:var(--border); transition:background .15s; }
      .aw-switch-track.on { background:var(--text); }
      .aw-switch-knob { width:14px; height:14px; border-radius:50%; background:#fff; margin-top:2px; transform:translateX(2px); transition:transform .15s; box-shadow:0 1px 2px rgba(0,0,0,.18); }
      .aw-switch-track.on > .aw-switch-knob { transform:translateX(16px); }

      .aw-divider { height:1px; background:var(--border); margin:22px 0 0; }
    </style>

    <div style="padding-top:2px;">

      <!-- ── Chunking ── -->
      <div class="aw-sec">
        <div class="aw-sec-head">
          <div class="aw-sec-title">${AW_ICON.chunk}<span>Chunking</span></div>
        </div>
        <div class="aw-sec-sub">Configure how documents are split into chunks before embedding.</div>

        <div class="aw-grid2">
          <div class="aw-field">
            <label class="ai-field-label">Chunk Size (tokens)</label>
            <input type="number" class="ai-input" value="${chunkSize}" min="128" max="4096" step="64"
              oninput="localStorage.setItem('aw_ragChunkSize', this.value)">
          </div>
          <div class="aw-field">
            <label class="ai-field-label">Chunk Overlap (tokens)</label>
            <input type="number" class="ai-input" value="${chunkOverlap}" min="0" max="512" step="16"
              oninput="localStorage.setItem('aw_ragChunkOverlap', this.value)">
          </div>
        </div>
      </div>

      <div class="aw-divider"></div>

      <!-- ── Embedding ── -->
      <div class="aw-sec">
        <div class="aw-sec-head">
          <div class="aw-sec-title">${AW_ICON.embed}<span>Embedding</span></div>
        </div>
        <div class="aw-sec-sub">Select the model used to generate vector embeddings for each chunk.</div>

        <div class="aw-field">
          <label class="ai-field-label">Embedding Model</label>
          <select class="ai-input" onchange="localStorage.setItem('aw_ragEmbedModel', this.value)">
            <option value="nomic-embed-text" ${embModel === 'nomic-embed-text' ? 'selected' : ''}>nomic-embed-text</option>
            <option value="mxbai-embed-large" ${embModel === 'mxbai-embed-large' ? 'selected' : ''}>mxbai-embed-large</option>
            <option value="all-minilm" ${embModel === 'all-minilm' ? 'selected' : ''}>all-minilm</option>
          </select>
        </div>
      </div>

      <div class="aw-divider"></div>

      <!-- ── Vector Store ── -->
      <div class="aw-sec">
        <div class="aw-sec-head">
          <div class="aw-sec-title">${AW_ICON.db}<span>Vector Store</span></div>
        </div>

        <div class="aw-field">
          <label class="ai-field-label">Backend</label>
          <select class="ai-input" onchange="localStorage.setItem('aw_ragVectorDb', this.value)">
            <option value="chroma" ${vectorDb === 'chroma' ? 'selected' : ''}>ChromaDB</option>
            <option value="qdrant" ${vectorDb === 'qdrant' ? 'selected' : ''}>Qdrant</option>
            <option value="pinecone" ${vectorDb === 'pinecone' ? 'selected' : ''}>Pinecone</option>
          </select>
        </div>
      </div>

      <div class="aw-divider"></div>

      <!-- ── Quality ── -->
      <div class="aw-sec">
        <div class="aw-sec-head">
          <div class="aw-sec-title">${AW_ICON.clean}<span>Quality Controls</span></div>
        </div>

        <div class="aw-row">
          <div>
            <div class="aw-row-text">QA scoring</div>
            <div class="aw-row-desc">Run confidence scoring on each chunk before ingestion.</div>
          </div>
          <label class="aw-switch">
            <input type="checkbox" ${qaEnabled ? 'checked' : ''}
              onchange="(function(cb){
                localStorage.setItem('aw_ragQaEnabled', cb.checked ? 'true' : 'false');
                var t=cb.parentElement.querySelector('.aw-switch-track');
                if(t) t.classList.toggle('on', !!cb.checked);
              })(this)">
            <div class="aw-switch-track ${qaEnabled ? 'on' : ''}">
              <div class="aw-switch-knob"></div>
            </div>
          </label>
        </div>
        <div class="aw-row">
          <div>
            <div class="aw-row-text">Deduplication</div>
            <div class="aw-row-desc">Skip near-duplicate chunks based on cosine similarity threshold.</div>
          </div>
          <label class="aw-switch">
            <input type="checkbox" ${dedup ? 'checked' : ''}
              onchange="(function(cb){
                localStorage.setItem('aw_ragDedupEnabled', cb.checked ? 'true' : 'false');
                var t=cb.parentElement.querySelector('.aw-switch-track');
                if(t) t.classList.toggle('on', !!cb.checked);
              })(this)">
            <div class="aw-switch-track ${dedup ? 'on' : ''}">
              <div class="aw-switch-knob"></div>
            </div>
          </label>
        </div>
      </div>

    </div>
  `;
}
window.buildWorkflowPanel = buildWorkflowPanel;

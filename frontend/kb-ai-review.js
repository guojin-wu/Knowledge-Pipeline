  // ── Full Conversation AI Review (FCR) UI ─────────────────────────────
  let _fcrPollTimer = null;

  async function exportFirstCustomerMessages() {
    const statusText = document.getElementById('fcrStatusText');
    const progressWrap = document.getElementById('fcrProgressWrap');
    const progressFill = document.getElementById('fcrFill');
    const progressLabel = document.getElementById('fcrProgressLabel');

    // Source 1: DEEP_CLEAN already has conversation data
    if (DEEP_CLEAN.cleanedData && DEEP_CLEAN.cleanedData.length > 0) {
      statusText.textContent = 'Extracting from QA Clean results...';
      const results = [];
      for (const entry of DEEP_CLEAN.cleanedData) {
        const conv = entry.conversation || [];
        const firstCustomer = conv.find(m => m.customer);
        if (!firstCustomer) continue;
        results.push({
          ticket_id: entry.ticket_id || '',
          subject: entry.problem || '',
          first_message: firstCustomer.customer,
          email: firstCustomer.poster_email || entry.email || '',
          created_at: entry.created_at || null,
        });
      }
      if (results.length > 0) return _downloadFirstMessages(results, statusText);
    }

    // Source 2: _qaImportFile (user uploaded a file to QA Clean)
    if (_qaImportFile) {
      statusText.textContent = 'Streaming large file...';
      progressWrap.style.display = 'block';
      try {
        const results = await streamParseJsonArray(_qaImportFile, (pct, count, bytes) => {
          progressFill.style.width = pct + '%';
          progressLabel.textContent = `${pct}% — ${count.toLocaleString()} tickets (${fmtSize(bytes)})`;
        }, function(ticket) {
          // Transform: extract first customer message from each raw ticket
          if (!ticket.ticket_header && !ticket.ticket_thread_section) return null;
          const tid = ticket.ticket_header?.ticket_number || '';
          const subject = ticket.ticket_header?.subject || '';
          const msgs = ticket.ticket_thread_section?.messages || [];
          const createdAt = ticket.ticket_summary_left_panel?.create_date || null;
          const firstCustomer = msgs.find(m =>
            m.poster_role === 'client' &&
            (m.message_body_clean_text || '').trim().length > 5
          );
          if (!firstCustomer) return null;
          return {
            ticket_id: tid,
            subject: subject,
            first_message: (firstCustomer.message_body_clean_text || '').trim(),
            email: firstCustomer.poster_email || '',
            created_at: createdAt,
          };
        });
        progressWrap.style.display = 'none';
        if (results.length > 0) return _downloadFirstMessages(results, statusText);
        statusText.textContent = 'No customer messages found in uploaded file.';
      } catch(e) {
        progressWrap.style.display = 'none';
        statusText.textContent = 'Error: ' + e.message;
      }
      return;
    }

    // Source 3: Fetch from backend
    statusText.textContent = 'Loading tickets from server...';
    try {
      const r = await fetch(`${KB_BASE}/scraped-tickets`);
      const data = await r.json();
      const tickets = data.tickets || data || [];
      if (!tickets.length) { statusText.textContent = 'No tickets found. Upload a file to QA Clean first.'; return; }
      const results = [];
      for (const ticket of tickets) {
        const tid = ticket.ticket_header?.ticket_number || ticket.ticket_id || '';
        const subject = ticket.ticket_header?.subject || ticket.subject || '';
        const msgs = ticket.ticket_thread_section?.messages || ticket.messages || [];
        const createdAt = ticket.ticket_summary_left_panel?.create_date || ticket.created_at || null;
        const firstCustomer = msgs.find(m =>
          (m.poster_role === 'client' || m.role === 'client') &&
          ((m.message_body_clean_text || m.text || '').trim().length > 5)
        );
        if (!firstCustomer) continue;
        results.push({
          ticket_id: tid,
          subject: subject,
          first_message: (firstCustomer.message_body_clean_text || firstCustomer.text || '').trim(),
          email: firstCustomer.poster_email || '',
          created_at: createdAt,
        });
      }
      if (results.length > 0) _downloadFirstMessages(results, statusText);
      else statusText.textContent = 'No customer messages found.';
    } catch(e) { statusText.textContent = 'Error: ' + e.message; }
  }

  function _downloadFirstMessages(results, statusEl) {
    const date = new Date().toISOString().split('T')[0];
    const blob = new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const fname = `first_customer_messages_${date}.json`;

    // After async streaming, browser may block programmatic a.click().
    // Show a visible download link the user can click instead.
    statusEl.innerHTML = '';
    const link = document.createElement('a');
    link.href = url;
    link.download = fname;
    link.style.cssText = 'display:inline-block;padding:8px 18px;background:var(--accent,#4f8cff);color:#fff;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600;cursor:pointer;margin-top:4px;';
    link.textContent = '\u2B07 Download ' + results.length + ' messages (' + fname + ')';
    statusEl.appendChild(link);

    // Also try programmatic click in case we're still in user-gesture context
    try {
      const a2 = document.createElement('a');
      a2.href = url;
      a2.download = fname;
      document.body.appendChild(a2);
      a2.click();
      document.body.removeChild(a2);
    } catch(_) {}
  }
  // ─────────────────────────────────────────────────────────────────────

  function downloadQaCleaned() {
    const src = DEEP_CLEAN.cleanedData ? DEEP_CLEAN : QA_PIPELINE;
    if (!src.cleanedData) return;
    const date = new Date().toISOString().split('T')[0];
    const data = _toKbFormat(src.cleanedData);
    const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `qa_cleaned_${date}.json`; a.click();
    URL.revokeObjectURL(url);
  }

  function downloadQaReport() {
    if (DEEP_CLEAN.log && DEEP_CLEAN.log.length) {
      const s = DEEP_CLEAN.stats;
      let md = `# Deep Clean Pipeline Report\n\nGenerated: ${new Date().toISOString()}\n\n`;
      md += `## Dataset Statistics\n\n| Metric | Value |\n|--------|-------|\n`;
      md += `| Original entries | ${s.original||0} |\n| Cleaned entries | ${s.cleaned||0} |\n| Removed | ${s.removed||0} (${s.removedPct||0}%) |\n| With Technical Signals | ${s.sigCoverage||0} (${s.sigCoveragePct||0}%) |\n\n`;
      md += `## Processing Log\n\n`;
      DEEP_CLEAN.log.forEach(l => md += `[${l.time}] [${l.tag.toUpperCase()}] ${l.msg}\n`);
      const blob = new Blob([md], {type:'text/markdown'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'DEEP_CLEAN_REPORT.md'; a.click();
      URL.revokeObjectURL(url);
    } else if (QA_PIPELINE.log.length) {
      const md = QA_PIPELINE.exportReport();
      const blob = new Blob([md], {type:'text/markdown'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'QA_REPORT.md'; a.click();
      URL.revokeObjectURL(url);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // DEEP CLEAN — Duplicates QA Clean pipeline with simplified output
  // Output format: { ticket_id, issue_type, problem, solution, technical_signals, created_at }
  // ═══════════════════════════════════════════════════════════

  const DEEP_CLEAN = {
    cleanedData: null,
    log: [],
    stats: {},

    addLog(tag, msg) {
      const time = new Date().toLocaleTimeString('en-US', {hour12:false, hour:'2-digit', minute:'2-digit', second:'2-digit'});
      this.log.push({time, tag, msg});
    },

    /**
     * Run the deep clean pipeline on already-cleaned QA data.
     * Applies all QA_PIPELINE cleaning stages, then strips to minimal format.
     */
    async run(rawData, onProgress) {
      this.log = []; this.stats = {};
      this.cleanedData = null;

      const _s = ms => new Promise(r => setTimeout(r, ms));

      // Validate input — accept QA export wrapper or raw array
      let entries;
      if (rawData && rawData.VALID_KNOWLEDGE_DATASET) {
        entries = rawData.VALID_KNOWLEDGE_DATASET;
        this.addLog('info', `Using VALID_KNOWLEDGE_DATASET: ${entries.length} entries`);
      } else if (Array.isArray(rawData)) {
        // Check if raw tickets need conversion (same as QA pipeline)
        const isRaw = rawData.length > 0 && rawData[0].ticket_header;
        if (isRaw) {
          this.addLog('info', `Detected raw ticket format, converting ${rawData.length} tickets...`);
          entries = [];
          for (let i = 0; i < rawData.length; i++) {
            const entry = QA_PIPELINE.convertSingleTicketLight(rawData[i]);
            if (entry) entries.push(entry);
            rawData[i] = null; // free for GC
          }
          this.addLog('info', `Converted to ${entries.length} compact entries`);
        } else {
          entries = rawData;
          // For large non-raw arrays, strip heavy fields to reduce memory
          if (entries.length > 5000) {
            this.addLog('info', `Large dataset: stripping heavy fields for memory efficiency...`);
            for (let i = 0; i < entries.length; i++) {
              const e = entries[i];
              // Keep only fields needed by deep clean pipeline
              entries[i] = {
                ticket_id: e.ticket_id || '',
                issue_type: e.issue_type || 'technical_support',
                problem: ((e.problem || '').slice(0, 3000)).trim(),
                solution: ((e.solution || '').slice(0, 5000)).trim(),
                root_cause: e.root_cause || null,
                technical_signals: e.technical_signals || {},
                confidence: e.confidence || 'medium',
                source_subject: e.source_subject || '',
                created_at: e.created_at || null,
              };
            }
          }
        }
        this.addLog('info', `Using ${isRaw ? 'converted' : 'compact'} array: ${entries.length} entries`);
      } else {
        throw new Error('Invalid input format');
      }

      const origCount = entries.length;
      const isLarge = entries.length > 5000;
      // Free rawData reference for GC
      rawData = null;
      onProgress(5, `Loaded ${origCount} entries${isLarge ? ' (large dataset mode)' : ''}`); await _s(100);

      // Stage 1: Deep-clean text fields (reuse QA_PIPELINE's text cleaner)
      // For large datasets, skip JSON deep-clone to avoid V8 string limit (>512MB)
      onProgress(15, 'Deep-cleaning text fields...');
      if (isLarge) {
        entries = QA_PIPELINE.deepCleanTexts(entries);
      } else {
        entries = QA_PIPELINE.deepCleanTexts(JSON.parse(JSON.stringify(entries)));
      }
      this.addLog('info', `Text cleaning complete: ${entries.length} entries`);
      await _s(100);

      // Stage 2: Remove junk
      onProgress(25, 'Removing junk entries...');
      const preJunk = entries.length;
      entries = QA_PIPELINE.removeJunk(entries);
      this.addLog('info', `Junk removal: ${preJunk} → ${entries.length} (removed ${preJunk - entries.length})`);
      await _s(100);

      // Stage 3: Remove fragments
      onProgress(35, 'Removing fragments...');
      const preFrag = entries.length;
      entries = QA_PIPELINE.removeFragments(entries);
      this.addLog('info', `Fragment removal: ${preFrag} → ${entries.length} (removed ${preFrag - entries.length})`);
      await _s(100);

      // Stage 4: Merge multi-entry tickets
      onProgress(45, 'Merging multi-entry tickets...');
      const preMerge = entries.length;
      entries = QA_PIPELINE.mergeTickets(entries);
      this.addLog('info', `Merge: ${preMerge} → ${entries.length} (merged ${preMerge - entries.length})`);
      await _s(100);

      // Stage 5: Clean problems & solutions
      onProgress(55, 'Cleaning problems...');
      entries = QA_PIPELINE.cleanProblems(entries);
      await _s(50);
      onProgress(65, 'Cleaning solutions...');
      entries = QA_PIPELINE.cleanSolutions(entries);
      await _s(50);

      // Stage 6: Re-classify issue types & extract technical signals
      // For large datasets, process in batches to keep UI responsive
      onProgress(75, 'Classifying issue types & extracting signals...');
      const SIGNAL_BATCH = isLarge ? 500 : entries.length;
      for (let bi = 0; bi < entries.length; bi += SIGNAL_BATCH) {
        const end = Math.min(bi + SIGNAL_BATCH, entries.length);
        for (let i = bi; i < end; i++) {
          const e = entries[i];
          e.issue_type = QA_PIPELINE.classifyIssueTypeFromEntry(e);

          // Extract technical signals
          const allText = (e.problem || '') + ' ' + (e.solution || '');
          const signals = {};
          const urls = allText.match(/https?:\/\/[^\s<>"]+/g);
          if (urls) signals.urls = [...new Set(urls)];
          const versions = allText.match(/v\d+[\.\d]*/gi);
          if (versions) signals.versions = [...new Set(versions)];
          const files = allText.match(/[\w\-]+\.(exe|msi|dll|fxg|xml|json|csv|swf|html|zip|pdf)/gi);
          if (files) signals.files = [...new Set(files)];
          const components = allText.match(/(TouchDirectory|Publisher|DataSync|TCMS|secureview|Kiosk|Player)\w*/gi);
          if (components) signals.software_components = [...new Set(components)];
          const errors = allText.match(/(error|exception|fail(ed|ure)?|crash|timeout|denied|refused|not found|404|500|503)\b[^.]{0,80}/gi);
          if (errors) signals.error_patterns = [...new Set(errors.map(x => x.trim().slice(0, 100)))];
          e.technical_signals = signals;
        }
        if (isLarge) {
          onProgress(75 + Math.round((end / entries.length) * 13), `Classifying & extracting signals: ${end.toLocaleString()} / ${entries.length.toLocaleString()}`);
          await _s(0); // yield to UI
        }
      }
      this.addLog('info', `Classified ${entries.length} entries with issue types & signals`);
      await _s(100);

      // Stage 7: Strip to minimal format (preserves full conversation)
      onProgress(90, 'Stripping to minimal RAG format...');
      const cleaned = entries.map(e => {
        // Build conversation array: [{customer:"..."}, {support:"..."}, ...]
        const conversation = (e.messages || []).map(m => {
          const text = (m.text || '').trim();
          if (!text) return null;
          return m.role === 'staff' ? { support: text } : { customer: text };
        }).filter(Boolean);

        return {
          ticket_id: e.ticket_id || '',
          issue_type: e.issue_type || 'technical_support',
          problem: (e.problem || '').trim(),
          solution: (e.solution || '').trim(),
          conversation: conversation,
          technical_signals: e.technical_signals || {},
          created_at: e.created_at || null,
        };
      }).filter(e => e.problem && e.solution);
      this.addLog('info', `Final format: ${cleaned.length} entries (stripped from ${entries.length})`);
      await _s(100);

      // Build stats
      const issueTypeDist = {};
      cleaned.forEach(e => { const t = e.issue_type; issueTypeDist[t] = (issueTypeDist[t]||0) + 1; });
      const sigCoverage = cleaned.filter(e => Object.values(e.technical_signals).some(v => v && v.length > 0)).length;

      this.stats = {
        original: origCount,
        cleaned: cleaned.length,
        removed: origCount - cleaned.length,
        removedPct: ((origCount - cleaned.length) / origCount * 100).toFixed(1),
        issueTypeDist,
        sigCoverage,
        sigCoveragePct: (sigCoverage / cleaned.length * 100).toFixed(1),
      };

      this.cleanedData = cleaned;
      this.addLog('info', `Deep clean complete! ${cleaned.length} entries in minimal format`);
      onProgress(100, 'Complete!');
      return cleaned;
    },

    exportJSON() {
      return {
        _metadata: {
          version: 'v1.0',
          source: 'deep-clean-pipeline',
          format: 'minimal-rag',
          timestamp: new Date().toISOString(),
          stats: this.stats,
        },
        VALID_KNOWLEDGE_DATASET: this.cleanedData,
      };
    },
  };

  // ── Deep Clean UI ──
  let _deepImportFile = null;
  let _deepInitialized = false;

  function initDeepCleanPage() {
    if (_deepInitialized) return;
    _deepInitialized = true;
    // Setup file upload
    const zone = document.getElementById('deepImportZone');
    const input = document.getElementById('deepImportInput');
    if (zone && input) {
      input.addEventListener('change', e => { if (e.target.files.length) selectDeepImport(e.target.files[0]); });
      zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
      zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
      zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('dragover'); if (e.dataTransfer.files.length) selectDeepImport(e.dataTransfer.files[0]); });
    }
    // Setup tabs
    document.querySelectorAll('.qa-tab[data-deeptab]').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.qa-tab[data-deeptab]').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('#view-deep-clean .qa-tab-content').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const target = document.getElementById(tab.dataset.deeptab);
        if (target) target.classList.add('active');
      });
    });
    // Setup search
    const searchBox = document.getElementById('deepSearchBox');
    if (searchBox) searchBox.addEventListener('input', e => {
      const q = e.target.value.toLowerCase(); if (!DEEP_CLEAN.cleanedData) return;
      const filtered = q ? DEEP_CLEAN.cleanedData.filter(en => (en.ticket_id||'').toLowerCase().includes(q) || (en.problem||'').toLowerCase().includes(q) || (en.solution||'').toLowerCase().includes(q)) : DEEP_CLEAN.cleanedData;
      renderDeepBrowser(filtered);
    });
  }

  function selectDeepImport(file) {
    if (!file.name.endsWith('.json')) { showToast('Only JSON files'); return; }
    _deepImportFile = file;
    document.getElementById('deepImportFileName').textContent = file.name;
    document.getElementById('deepImportFileSize').textContent = fmtSize(file.size);
    document.getElementById('deepImportFileInfo').className = 'file-info on';
    document.getElementById('deepImportLabel').innerHTML = `<strong>${esc(file.name)}</strong> selected`;
    document.getElementById('btnRunDeep').style.display = '';
  }

  function clearDeepImport() {
    _deepImportFile = null;
    document.getElementById('deepImportInput').value = '';
    document.getElementById('deepImportFileInfo').className = 'file-info';
    document.getElementById('deepImportLabel').innerHTML = 'Upload custom JSON';
    document.getElementById('btnRunDeep').style.display = 'none';
  }

  function updateDeepPipelineUI(pct, stage) {
    document.getElementById('deepProgressFill').style.width = pct + '%';
    document.getElementById('deepProgressPct').textContent = pct + '%';
    document.getElementById('deepProgressStage').textContent = stage;
    const logEl = document.getElementById('deepPipelineLog');
    logEl.innerHTML = DEEP_CLEAN.log.map(l =>
      `<div class="qa-log-entry"><span class="qa-log-time">${l.time}</span><span class="qa-log-tag ${l.tag}">${l.tag}</span><span class="qa-log-msg">${esc(l.msg)}</span></div>`
    ).join('');
    logEl.scrollTop = logEl.scrollHeight;
  }

  async function runDeepFromQa() {
    if (!QA_PIPELINE.cleanedData || !QA_PIPELINE.cleanedData.length) {
      showToast('No QA Clean output available. Run QA Clean first.');
      return;
    }
    const btn = document.getElementById('btnRunDeepFromQa');
    btn.disabled = true; btn.textContent = 'Processing...';
    try {
      const data = QA_PIPELINE.exportJSON();
      await runDeepCleanCore(data);
    } catch(e) {
      showToast(`Failed: ${e.message}`);
      document.getElementById('deepStatus').textContent = `Error: ${e.message}`;
    } finally {
      btn.disabled = false; btn.textContent = 'Use QA Clean Output';
    }
  }

  async function runDeepCleanPipeline() {
    if (!_deepImportFile) return;
    const btn = document.getElementById('btnRunDeep');
    const statusEl = document.getElementById('deepStatus');
    btn.disabled = true; btn.textContent = 'Processing...';
    try {
      let data;
      // For files > 200MB, use streaming parser with inline transform to keep memory low
      if (_deepImportFile.size > 200 * 1024 * 1024) {
        statusEl.textContent = 'Reading large file (streaming + converting)...';
        // Use transform callback to convert raw tickets during streaming
        // This avoids holding 713MB of raw objects in memory — each ticket is
        // converted to a ~1-3KB compact entry immediately and the raw object is discarded
        let isRawDetected = null;
        data = await streamParseJsonArray(_deepImportFile, (pct, count, bytes) => {
          statusEl.textContent = `Streaming: ${pct}% — ${count.toLocaleString()} entries (${fmtSize(bytes)})`;
        }, (obj) => {
          // Auto-detect format on first object
          if (isRawDetected === null) isRawDetected = !!obj.ticket_header;
          if (isRawDetected) {
            return QA_PIPELINE.convertSingleTicketLight(obj);
          }
          return obj;
        });
        if (isRawDetected) {
          DEEP_CLEAN.addLog('info', `Stream-converted ${data.length.toLocaleString()} entries from large file (${fmtSize(_deepImportFile.size)})`);
        }
        statusEl.textContent = `${data.length.toLocaleString()} entries ready, running deep clean pipeline...`;
        await new Promise(r => setTimeout(r, 50));
      } else {
        const text = await _deepImportFile.text();
        data = JSON.parse(text);
      }
      await runDeepCleanCore(data);
    } catch(e) {
      showToast(`Failed: ${e.message}`);
      document.getElementById('deepStatus').textContent = `Error: ${e.message}`;
    } finally {
      btn.disabled = false; btn.textContent = 'Run Deep Clean';
    }
  }

  async function runDeepCleanCore(data) {
    document.getElementById('deepPipelineProgress').style.display = '';
    document.getElementById('deepStatsPanel').style.display = 'none';
    document.getElementById('deepResultsTabs').style.display = 'none';
    document.getElementById('deepExportPanel').style.display = 'none';

    await DEEP_CLEAN.run(data, updateDeepPipelineUI);

    // Show stats
    const S = DEEP_CLEAN.stats;
    document.getElementById('deepStatus').textContent = `Done — ${S.cleaned} entries in minimal format (${S.removedPct}% removed)`;
    showToast(`Deep clean complete! ${S.cleaned} entries`);

    // Render stats grid
    const statsGrid = document.getElementById('deepStatsGrid');
    statsGrid.innerHTML = [
      { label: 'Original', value: S.original.toLocaleString() },
      { label: 'Deep Cleaned', value: S.cleaned.toLocaleString() },
      { label: 'Removed', value: `${S.removed.toLocaleString()} (${S.removedPct}%)` },
      { label: 'Signal Coverage', value: `${S.sigCoverage.toLocaleString()} (${S.sigCoveragePct}%)` },
      { label: 'Issue Types', value: Object.keys(S.issueTypeDist).length },
    ].map(s => `<div class="qa-stat-card"><div class="qa-stat-val">${s.value}</div><div class="qa-stat-lbl">${s.label}</div></div>`).join('');
    document.getElementById('deepStatsPanel').style.display = '';

    // Render log
    const logEl = document.getElementById('deepResultsLog');
    logEl.innerHTML = DEEP_CLEAN.log.map(l =>
      `<div class="qa-log-entry"><span class="qa-log-time">${l.time}</span><span class="qa-log-tag ${l.tag}">${l.tag}</span><span class="qa-log-msg">${esc(l.msg)}</span></div>`
    ).join('');

    // Render browse
    renderDeepBrowser(DEEP_CLEAN.cleanedData);

    document.getElementById('deepResultsTabs').style.display = '';
    document.getElementById('deepExportPanel').style.display = '';
  }

  function renderDeepBrowser(entries) {
    const container = document.getElementById('deepEntryBrowser');
    if (!container) return;
    const show = entries.slice(0, 100);
    container.innerHTML = show.map(e => {
      const sigKeys = Object.keys(e.technical_signals || {}).filter(k => {
        const v = e.technical_signals[k];
        return v && (Array.isArray(v) ? v.length > 0 : true);
      });
      const sigBadges = sigKeys.map(k => `<span style="background:var(--bg2); padding:2px 6px; border-radius:4px; font-size:10px;">${k}</span>`).join(' ');
      return `<div class="qa-entry-card">
        <div class="qa-entry-header">
          <span class="qa-entry-id">${esc(e.ticket_id)}</span>
          <span class="qa-entry-type">${esc(e.issue_type)}</span>
        </div>
        <div class="qa-entry-field"><strong>Problem:</strong> ${esc((e.problem||'').slice(0,300))}</div>
        <div class="qa-entry-field"><strong>Solution:</strong> ${esc((e.solution||'').slice(0,300))}</div>
        ${sigBadges ? `<div style="margin-top:4px;">${sigBadges}</div>` : ''}
      </div>`;
    }).join('');
    if (entries.length > 100) {
      container.innerHTML += `<div style="text-align:center; padding:12px; color:var(--text3); font-size:12px;">Showing 100 of ${entries.length.toLocaleString()} entries</div>`;
    }
  }

  function downloadDeepCleaned() {
    if (!DEEP_CLEAN.cleanedData) return;
    const data = DEEP_CLEAN.exportJSON();
    const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'tickets_deep_cleaned.json'; a.click();
    URL.revokeObjectURL(url);
  }

  // ═══════════════════════════════════════════════════════════
  // RAG FORMATTING ENGINE
  // ═══════════════════════════════════════════════════════════

  const RAG_ENGINE = {
    log: [],
    ragDataset: null,
    stats: null,

    addLog(type, msg) { this.log.push({ type, msg, ts: Date.now() }); },

    ISSUE_LABELS: {
      screen_flickering: 'Screen Flickering',
      display_connection_issue: 'Display Connection Issue',
      display_configuration_issue: 'Display Configuration Issue',
      software_version_compatibility: 'Software Version Compatibility',
      software_update_request: 'Software Update Request',
      license_activation_issue: 'License Activation Issue',
      account_access_issue: 'Account Access Issue',
      remote_access_support: 'Remote Access Support',
      calendar_integration: 'Calendar Integration',
      api_integration: 'API Integration',
      data_sync_issue: 'Data Sync Issue',
      player_offline: 'Player Offline',
      license_issue: 'License Issue',
      software_crash: 'Software Crash',
      map_rendering: 'Map Rendering Issue',
      installation_issue: 'Installation Issue',
      display_issue: 'Display Issue',
      system_configuration: 'System Configuration',
      content_issue: 'Content Issue',
      monitoring_issue: 'Monitoring Issue',
      network_issue: 'Network Issue',
      hardware_issue: 'Hardware Issue',
      technical_support: 'Technical Support'
    },

    cleanSummary(text, maxLen = 220) {
      let t = String(text || '').replace(/\s+/g, ' ').trim();
      t = t.replace(/^(hi|hello|hey|dear)\b[^,:\-]{0,40}[,:-]?\s*/i, '');
      t = t.replace(/^(thanks|thank you)\b[^.]{0,80}\.?\s*/i, '');
      t = t.replace(/\b(let me know|please advise|please confirm|hope this helps|thanks)\b[^.]*$/i, '');
      if (t.length > maxLen) {
        const cut = t.slice(0, maxLen);
        const sentenceCut = cut.lastIndexOf('.');
        t = sentenceCut > 80 ? cut.slice(0, sentenceCut + 1) : cut.trim() + '...';
      }
      return t;
    },

    summarizeProblem(entry) {
      const issueLabel = this.ISSUE_LABELS[entry.issue_type] || (entry.issue_type || 'support issue').replace(/_/g, ' ');
      const source = entry.problem_summary || entry.problem;
      const cleaned = this.cleanSummary(source, 220);
      return cleaned || issueLabel;
    },

    summarizeSolution(entry) {
      const source = entry.solution_summary || entry.solution;
      const cleaned = this.cleanSummary(source, 320);
      return cleaned || 'Follow the documented support steps for this issue.';
    },

    // ── Generate a concise 8-12 word title from problem + solution ──
    generateTitle(problem, solution, subject) {
      // Try subject first — it's often a good title
      let sub = (subject || '').trim();
      // Strip RE:/FW:/FWD: prefixes
      sub = sub.replace(/^(re|fw|fwd)\s*:\s*/i, '').trim();
      if (sub && sub.length > 5 && sub.length < 80) {
        let t = sub.replace(/^(ticket\s*#?\d+\s*[-:]\s*)/i, '');
        t = t.replace(/\s*[-–—]\s*(opened|closed|created|updated|assigned).*$/i, '');
        // Skip if it's just a name, email, or generic
        if (t.length > 5 && t.split(/\s+/).length <= 14 && !/^(greetings|hello|help|hi|hey|support|test|\[EMAIL\])/i.test(t)) {
          return t.charAt(0).toUpperCase() + t.slice(1);
        }
      }
      // Otherwise derive from problem
      let p = (problem || '').trim();
      // Remove leading email/noise artifacts
      p = p.replace(/^\[EMAIL\]\s*/g, '').replace(/^[\s\S]{0,5}$/,'').trim();
      if (!p || p.length < 5) {
        // Try solution if problem is empty/tiny
        const s = (solution || '').trim();
        const firstSolSentence = s.split(/[.!?\n]/)[0].trim();
        if (firstSolSentence.length > 10) return firstSolSentence.split(/\s+/).slice(0, 10).join(' ');
        return 'Support ticket';
      }
      // Take first sentence or first 12 words
      let title = p.split(/[.!?\n]/)[0].trim();
      const words = title.split(/\s+/);
      if (words.length > 12) title = words.slice(0, 12).join(' ');
      if (words.length < 3 && solution) {
        const solWords = (solution || '').split(/\s+/).slice(0, 5).join(' ');
        title = title + ' — ' + solWords;
      }
      // Remove leading greetings / noise
      title = title.replace(/^(hi|hello|hey|dear\s+\w+)[,:]?\s*/i, '');
      title = title.replace(/^(I\s+(am|have|need|want)\s+)/i, '');
      title = title.replace(/^\[EMAIL\]\s*/g, '');
      title = title.replace(/^[^a-zA-Z0-9]+/, ''); // strip leading punctuation
      // Capitalize first letter
      if (title.length > 0) title = title.charAt(0).toUpperCase() + title.slice(1);
      return title || 'Support ticket';
    },

    // ── Extract retrieval phrases from problem + solution ──
    generateKeywords(problem, solution, issueType, techContext) {
      const combined = `${problem || ''} ${solution || ''}`.toLowerCase();
      const phrases = new Set();

      const add = (value) => {
        const cleaned = String(value || '')
          .toLowerCase()
          .replace(/[_|]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (!cleaned || cleaned.length < 3) return;
        if (/^(issue|problem|support|technical support)$/.test(cleaned)) return;
        phrases.add(cleaned);
      };

      const issueLabel = this.ISSUE_LABELS[issueType];
      if (issueLabel) add(issueLabel);

      const patternMap = [
        [/\bblank screen|black screen|display not detected|screen not recognized\b/i, 'blank screen'],
        [/\bflicker|flickering|flashing|blinking\b/i, 'screen flickering'],
        [/\bplayer offline|offline player|not responding player\b/i, 'player offline'],
        [/\blicense|ucode|activation\b/i, 'license activation'],
        [/\bpassword reset|reset password|login\b/i, 'account access'],
        [/\banti[- ]alias|orientation|portrait screen|resolution\b/i, 'display settings'],
        [/\bteamviewer|logmein|remote access\b/i, 'remote access'],
        [/\bapi|json feed|xml feed|endpoint|webhook\b/i, 'api integration'],
        [/\bcalendar|ical|outlook|exchange\b/i, 'calendar integration'],
        [/\bmap|wayfinding|floor plan|directory\b/i, 'wayfinding map'],
        [/\bversion conflict|compatible|incompatible|upgrade|downgrade|framework\b/i, 'version compatibility'],
        [/\bcontent not updating|content issue|publish|publishing\b/i, 'content publishing']
      ];
      patternMap.forEach(([re, label]) => { if (re.test(combined)) add(label); });

      (techContext.software_components || []).slice(0, 4).forEach(add);
      (techContext.versions || []).slice(0, 2).forEach(add);
      (techContext.files || []).slice(0, 2).forEach(add);
      (techContext.errors || []).slice(0, 2).forEach(err => add(String(err).slice(0, 48)));

      const firstNouns = (problem || '')
        .replace(/[^\w\s.-]/g, ' ')
        .split(/\s+/)
        .filter(Boolean)
        .filter(w => w.length > 3 && !/^(please|thanks|issue|problem|screen|display|player|about|need|with|this|that|from)$/i.test(w))
        .slice(0, 3);
      if (firstNouns.length >= 2) add(firstNouns.join(' '));

      return [...phrases].slice(0, 8);
    },

    normalizeKeywordList(value) {
      const list = Array.isArray(value)
        ? value
        : String(value || '')
            .split(/[,\n|]/)
            .map((v) => v.trim())
            .filter(Boolean);
      const seen = new Set();
      const out = [];
      for (const raw of list) {
        const cleaned = String(raw || '')
          .toLowerCase()
          .replace(/\s+/g, ' ')
          .trim();
        if (!cleaned || cleaned.length < 2) continue;
        if (seen.has(cleaned)) continue;
        seen.add(cleaned);
        out.push(cleaned);
      }
      return out.slice(0, 10);
    },

    refineKeywords(problemSummary, solutionSummary, issueType, techContext) {
      const base = this.normalizeKeywordList(techContext.entry_keywords);
      const generated = this.generateKeywords(problemSummary, solutionSummary, issueType, techContext);
      const mergedBase = base.length ? [...new Set([...base, ...generated])] : generated;
      const enriched = new Set(mergedBase);
      const joined = `${problemSummary} ${solutionSummary}`;
      if (/content manager/i.test(joined)) enriched.add('content manager');
      if (/secureview/i.test(joined)) enriched.add('secureview');
      if (/datasync/i.test(joined)) enriched.add('datasync');
      if (/player settings|device manager|program data/i.test(joined)) {
        if (/player settings/i.test(joined)) enriched.add('player settings');
        if (/device manager/i.test(joined)) enriched.add('device manager');
        if (/program data/i.test(joined)) enriched.add('programdata');
      }
      return [...enriched].slice(0, 8);
    },

    // ── Extract technical context from entry ──
    extractTechContext(entry) {
      const ts = entry.technical_signals || {};
      const text = ((entry.problem || '') + ' ' + (entry.solution || ''));
      const ctx = {
        software_components: [],
        versions: [],
        files: [],
        commands: [],
        errors: [],
        entry_keywords: [],
      };

      // From existing technical_signals (could be object or array)
      if (typeof ts === 'object' && !Array.isArray(ts)) {
        if (ts.software_components) ctx.software_components = Array.isArray(ts.software_components) ? ts.software_components : [ts.software_components];
        if (ts.versions) ctx.versions = Array.isArray(ts.versions) ? ts.versions : [ts.versions];
        if (ts.files) ctx.files = Array.isArray(ts.files) ? ts.files : [ts.files];
        if (ts.commands) ctx.commands = Array.isArray(ts.commands) ? ts.commands : [ts.commands];
        if (ts.error_messages) ctx.errors = Array.isArray(ts.error_messages) ? ts.error_messages : [ts.error_messages];
        if (ts.errors) ctx.errors = [...ctx.errors, ...(Array.isArray(ts.errors) ? ts.errors : [ts.errors])];
      } else if (Array.isArray(ts)) {
        // Flat array — try to classify
        ts.forEach(s => {
          const sl = (s || '').toLowerCase();
          if (/\.exe|\.msi|\.dll|\.fxg|\.xml|\.json|\.zip/.test(sl)) ctx.files.push(s);
          else if (/v?\d+\.\d+/.test(sl) && sl.length < 15) ctx.versions.push(s);
          else if (/error|fail|exception|crash/i.test(sl)) ctx.errors.push(s);
          else ctx.software_components.push(s);
        });
      }

      ctx.entry_keywords = this.normalizeKeywordList(entry.keywords);

      // Supplement from text extraction if arrays are empty
      if (!ctx.software_components.length) {
        const comps = [];
        if (/touchdirectory/i.test(text)) comps.push('TouchDirectory');
        if (/publisher/i.test(text)) comps.push('Publisher');
        if (/datasync/i.test(text)) comps.push('DataSync');
        if (/tcms/i.test(text)) comps.push('TCMS');
        if (/kiosk/i.test(text)) comps.push('Kiosk');
        if (/player/i.test(text)) comps.push('Player');
        if (/wayfind/i.test(text)) comps.push('Wayfinding');
        if (/secureview/i.test(text)) comps.push('SecureView');
        ctx.software_components = comps;
      }

      if (!ctx.versions.length) {
        const vers = text.match(/\bv?\d+\.\d+(?:\.\d+)*\b/gi);
        if (vers) ctx.versions = [...new Set(vers)].slice(0, 4);
      }

      if (!ctx.files.length) {
        const files = text.match(/\b[\w.-]+\.(?:exe|msi|dll|fxg|xml|json|zip|log|cfg|ini|bat|ps1|sh)\b/gi);
        if (files) ctx.files = [...new Set(files)].slice(0, 6);
      }

      if (!ctx.commands.length) {
        const cmds = text.match(/\b(?:cmd|powershell|regedit|ipconfig|ping|netstat|nslookup|sfc|chkdsk|taskkill|sc\s+(?:stop|start|query))\b[^.\n]{0,60}/gi);
        if (cmds) ctx.commands = [...new Set(cmds)].slice(0, 4);
      }

      // Clean up
      Object.keys(ctx).forEach(k => {
        ctx[k] = ctx[k].filter(v => v && String(v).trim().length > 0);
      });

      return ctx;
    },

    // ── Generate signals_text for embedding boost ──
    generateSignalsText(title, techContext, issueType) {
      const parts = [title];
      if (techContext.software_components.length) parts.push(techContext.software_components.join(' '));
      if (techContext.versions.length) parts.push(techContext.versions.join(' '));
      if (techContext.errors.length) parts.push(techContext.errors[0]);
      if (issueType && issueType !== 'technical_support') parts.push(issueType.replace(/_/g, ' '));
      return parts.join(' | ');
    },

    // ── Build embedding_text for vector DB ──
    buildEmbeddingText(doc) {
      const lines = [];
      const issueLabel = this.ISSUE_LABELS[doc.issue_type] || String(doc.issue_type || 'technical_support').replace(/_/g, ' ');
      lines.push(`Title: ${doc.title}`);
      lines.push(`Issue Type: ${issueLabel}`);
      lines.push(`Problem Summary: ${doc.problem_summary}`);
      lines.push(`Solution Summary: ${doc.solution_summary}`);
      const problemDetail = String(doc.problem || '').trim();
      const solutionDetail = String(doc.solution || '').trim();
      if (problemDetail && problemDetail !== doc.problem_summary) {
        lines.push(`Problem Detail: ${problemDetail.length > 320 ? problemDetail.slice(0, 320) + '...' : problemDetail}`);
      }
      if (solutionDetail && solutionDetail !== doc.solution_summary) {
        lines.push(`Solution Detail: ${solutionDetail.length > 420 ? solutionDetail.slice(0, 420) + '...' : solutionDetail}`);
      }
      if (Array.isArray(doc.action_steps) && doc.action_steps.length) {
        lines.push(`Action Steps: ${doc.action_steps.join(' | ')}`);
      }
      if (doc.root_cause) lines.push(`Root Cause: ${doc.root_cause}`);
      if (doc.technical_context.software_components.length) {
        lines.push(`Software: ${doc.technical_context.software_components.join(', ')}`);
      }
      if (doc.technical_context.versions.length) {
        lines.push(`Versions: ${doc.technical_context.versions.join(', ')}`);
      }
      if (doc.technical_context.files.length) {
        lines.push(`Files: ${doc.technical_context.files.join(', ')}`);
      }
      if (doc.keywords.length) {
        lines.push(`Keywords: ${doc.keywords.join(', ')}`);
      }
      if (doc.recency_band) lines.push(`Recency Band: ${doc.recency_band}`);
      return lines.join('\n');
    },

    // ── Determine retrieval priority ──
    getRetrievalPriority(entry) {
      const s = (entry.solution || '').trim();
      const p = (entry.problem || '').trim();
      const rules = window.KB_SHARED_RULES || {};
      if (s.length < 40) return 'low';
      if (/^(replied by email|sent by email|ticket assignment|the content is back up|will check)/i.test(s)) return 'low';
      if (entry.rag_quality === 'dilution') return 'low';
      // Attachment-only solutions — no RAG value since attachments aren't in the dataset
      if (/\b(attached|see\s+attach|pdf\s+(is\s+)?attached|docs?\s+(are\s+)?attached|file\s+(is\s+)?attached|sending\s+the\s+(file|document|attachment))\b/i.test(s) && s.length < 120 && !(rules.hasInstructionStructure && rules.hasInstructionStructure(s))) return 'low';
      // Request-type problems — user asking for materials/info, not reporting a technical issue
      if (/^(please\s+send|can\s+you\s+send|I\s+need\s+.{0,30}\b(training|manual|documentation|materials|guide|license|installer|credentials|access)\b|send\s+me\s+|requesting\s+|request\s+for\s+)/i.test(p) && s.length < 150 && !/\b(install|update|click|navigate|configure|run|execute|error|issue|bug|fail|crash)\b/i.test(s)) return 'low';
      if (/^(here is|use this|download here|please use this link|please see attached)/i.test(s) && s.length < 160) return 'low';
      if (/^(yes|no|okay|sure|thanks)[.!]?\s*$/i.test(s)) return 'low';
      if (rules.isSupportRequestNoise && rules.isSupportRequestNoise(p, s)) return 'low';
      if (rules.isCoordinationOnly && rules.isCoordinationOnly(s)) return 'low';
      if (rules.hasOneTimeLink && rules.hasOneTimeLink(s)) return 'low';
      if (rules.isManualResolutionOnly && rules.isManualResolutionOnly(s)) return 'low';
      return 'normal';
    },

    // ── Transform single entry ──
    transformEntry(entry) {
      const techContext = this.extractTechContext(entry);
      const problemSummary = this.summarizeProblem(entry);
      const solutionSummary = this.summarizeSolution(entry);
      const title = this.generateTitle(problemSummary, solutionSummary, entry.source_subject);
      const keywords = this.refineKeywords(problemSummary, solutionSummary, entry.issue_type, techContext);
      const signalsText = this.generateSignalsText(title, techContext, entry.issue_type);
      const priority = this.getRetrievalPriority(entry);
      const actionSteps = Array.isArray(entry.action_steps)
        ? entry.action_steps.filter(Boolean).slice(0, 8)
        : this.normalizeKeywordList(entry.action_steps).slice(0, 8);

      const doc = {
        doc_id: entry.ticket_id,
        title,
        problem_summary: problemSummary,
        solution_summary: solutionSummary,
        problem: (entry.problem || '').trim(),
        solution: (entry.solution || '').trim(),
        action_steps: actionSteps,
        root_cause: entry.likely_cause || entry.root_cause || null,
        keywords,
        technical_context: techContext,
        signals_text: signalsText,
        issue_type: entry.issue_type || 'technical_support',
        retrieval_priority: priority,
        source_type: entry.source_type || 'ticket',
        source_ticket: entry.ticket_id,
        created_at: entry.created_at || null,
        source_date: entry.source_date || entry.created_at || null,
        recency_band: entry.recency_band || null,
        recency_weight: entry.recency_weight ?? null,
        embedding_text: '',  // set below
      };
      doc.embedding_text = this.buildEmbeddingText(doc);
      return doc;
    },

    // ── Main run: transform all entries ──
    async run(data, onProgress) {
      this.log = [];
      this.ragDataset = null;
      this.stats = null;
      const _s = ms => new Promise(r => setTimeout(r, ms));

      // Detect input format
      let entries;
      if (data.VALID_KNOWLEDGE_DATASET) {
        entries = data.VALID_KNOWLEDGE_DATASET;
        this.addLog('info', `Input: cleaned KB format — ${entries.length} entries`);
      } else if (Array.isArray(data)) {
        entries = data;
        this.addLog('info', `Input: plain array — ${entries.length} entries`);
      } else {
        throw new Error('Unrecognized format. Expected VALID_KNOWLEDGE_DATASET or array.');
      }

      onProgress(5, 'Analyzing input dataset...');
      await _s(100);

      // Transform each entry
      const docs = [];
      let lowPriority = 0, withRC = 0, withComps = 0, withErrors = 0, totalKw = 0;

      for (let i = 0; i < entries.length; i++) {
        const pct = 10 + Math.round((i / entries.length) * 80);
        if (i % 50 === 0) {
          onProgress(pct, `Transforming entry ${i + 1}/${entries.length}...`);
          await _s(10);
        }

        const doc = this.transformEntry(entries[i]);
        docs.push(doc);

        // Stats
        if (doc.retrieval_priority === 'low') lowPriority++;
        if (doc.root_cause) withRC++;
        if (doc.technical_context.software_components.length) withComps++;
        if (doc.technical_context.errors.length) withErrors++;
        totalKw += doc.keywords.length;
      }

      onProgress(92, 'Computing statistics...');
      await _s(100);

      // Compute stats
      const embLengths = docs.map(d => d.embedding_text.length);
      const avgEmb = Math.round(embLengths.reduce((a, b) => a + b, 0) / docs.length);
      const medEmb = embLengths.sort((a, b) => a - b)[Math.floor(docs.length / 2)];

      this.stats = {
        total_docs: docs.length,
        normal_priority: docs.length - lowPriority,
        low_priority: lowPriority,
        with_root_cause: withRC,
        with_components: withComps,
        with_errors: withErrors,
        avg_keywords: (totalKw / docs.length).toFixed(1),
        avg_embedding_length: avgEmb,
        median_embedding_length: medEmb,
      };

      this.ragDataset = docs;
      this.addLog('info', `RAG formatting complete: ${docs.length} documents generated`);
      this.addLog('info', `Priority: ${docs.length - lowPriority} normal, ${lowPriority} low`);
      this.addLog('info', `Avg embedding text: ${avgEmb} chars, Avg keywords: ${(totalKw / docs.length).toFixed(1)}/entry`);

      onProgress(100, 'Done');
      return docs;
    },

    exportJSON() {
      return { RAG_DATASET: this.ragDataset || [] };
    },

    exportEmbeddingTexts() {
      if (!this.ragDataset) return '';
      return this.ragDataset.map(d =>
        `=== DOC: ${d.doc_id} ===\n${d.embedding_text}\n`
      ).join('\n');
    },
  };

  // ═══ RAG Formatting UI Wiring ═══

  let _ragImportFile = null;
  const ragFileInput = document.getElementById('ragFileInput');
  const ragUploadZone = document.getElementById('ragUploadZone');

  if (ragFileInput) {
    ragFileInput.addEventListener('change', e => { if (e.target.files.length) selectRagFile(e.target.files[0]); });
  }
  if (ragUploadZone) {
    ragUploadZone.addEventListener('dragover', e => { e.preventDefault(); ragUploadZone.classList.add('dragover'); });
    ragUploadZone.addEventListener('dragleave', () => ragUploadZone.classList.remove('dragover'));
    ragUploadZone.addEventListener('drop', e => {
      e.preventDefault(); ragUploadZone.classList.remove('dragover');
      if (e.dataTransfer.files.length) selectRagFile(e.dataTransfer.files[0]);
    });
  }

  function selectRagFile(file) {
    if (!file.name.endsWith('.json')) { showToast('Only JSON files'); return; }
    _ragImportFile = file;
    document.getElementById('ragFileName').textContent = file.name;
    document.getElementById('ragFileSize').textContent = fmtSize(file.size);
    document.getElementById('ragFileInfo').className = 'file-info on';
    document.getElementById('ragUploadLabel').textContent = file.name;
    document.getElementById('btnRunRag').style.display = '';
  }

  function clearRagFile() {
    _ragImportFile = null;
    ragFileInput.value = '';
    document.getElementById('ragFileInfo').className = 'file-info';
    document.getElementById('ragUploadLabel').textContent = 'Upload validated keep KB JSON';
    document.getElementById('btnRunRag').style.display = 'none';
  }

  function getRagPipelineSource() {
    const mode = document.getElementById('aiReviewMode')?.value || '';
    if (mode === 'validation' && Array.isArray(window._normalizeOutput) && window._normalizeOutput.length) {
      const kept = _toValidatedKeepFormat(window._normalizeOutput.filter((e) => e.qa_disposition === 'KEEP'));
      if (kept.length) {
        return { label: 'AI Validation keep output', data: kept };
      }
    }
    if (DEEP_CLEAN.cleanedData?.length) {
      return { label: 'Deep Clean output', data: DEEP_CLEAN.exportJSON() };
    }
    if (QA_PIPELINE.cleanedData?.length) {
      return { label: 'QA Clean output', data: QA_PIPELINE.exportJSON() };
    }
    return null;
  }

  // Use latest pipeline output directly (prefers AI Validation keep output)
  function ragFromQaPipeline() {
    const src = getRagPipelineSource();
    if (!src || !src.data || !src.data.length) {
      showToast('No validation keep output available. Run AI Validation or upload a validated keep JSON.');
      return;
    }
    document.getElementById('ragStatus').textContent = `Using ${src.label}: ${src.data.length.toLocaleString()} entries`;
    runRagCore(src.data);
  }

  // Use uploaded file
  async function runRagFormat() {
    if (!_ragImportFile) return;
    const btn = document.getElementById('btnRunRag');
    btn.disabled = true; btn.textContent = 'Processing...';
    try {
      const text = await _ragImportFile.text();
      const data = JSON.parse(text);
      await runRagCore(data);
    } catch (e) {
      showToast(`RAG format failed: ${e.message}`);
      document.getElementById('ragStatus').textContent = `Error: ${e.message}`;
    } finally {
      btn.disabled = false; btn.textContent = 'Run RAG Format';
    }
  }

  async function runRagCore(data) {
    const progressPanel = document.getElementById('ragProgressPanel');
    const fill = document.getElementById('ragProgressFill');
    const stage = document.getElementById('ragProgressStage');
    const pct = document.getElementById('ragProgressPct');
    const logEl = document.getElementById('ragLog');

    progressPanel.style.display = '';
    document.getElementById('ragStatsPanel').style.display = 'none';
    document.getElementById('ragResultsTabs').style.display = 'none';
    document.getElementById('ragExportPanel').style.display = 'none';
    logEl.innerHTML = '';

    try {
      const docs = await RAG_ENGINE.run(data, (p, msg) => {
        fill.style.width = p + '%';
        stage.textContent = msg;
        pct.textContent = p + '%';
      });

      // Render log
      RAG_ENGINE.log.forEach(l => {
        const div = document.createElement('div');
        div.className = 'qa-log-entry';
        div.style.color = l.type === 'info' ? 'var(--blue)' : 'var(--text3)';
        div.textContent = l.msg;
        logEl.appendChild(div);
      });

      // Render stats
      renderRagStats(RAG_ENGINE.stats);

      // Render browse tab
      renderRagBrowser(docs);

      // Sample preview
      if (docs.length > 0) {
        document.getElementById('ragSamplePreview').textContent = JSON.stringify(docs[0], null, 2);
      }

      // Copy log to results log
      const resultsLog = document.getElementById('ragResultsLog');
      resultsLog.innerHTML = logEl.innerHTML;

      document.getElementById('ragStatsPanel').style.display = '';
      document.getElementById('ragResultsTabs').style.display = '';
      document.getElementById('ragExportPanel').style.display = '';
      document.getElementById('ragStatus').textContent = `Done — ${docs.length} RAG documents generated`;
      showToast(`RAG formatting complete: ${docs.length} documents`);

      // Update overview with RAG data
      renderOverviewDashboard();
    } catch (e) {
      showToast(`RAG format failed: ${e.message}`);
      document.getElementById('ragStatus').textContent = `Error: ${e.message}`;
    }
  }

  function renderRagStats(stats) {
    const grid = document.getElementById('ragStatsGrid');
    const items = [
      { label: 'Total Documents', val: stats.total_docs, cls: 'blue' },
      { label: 'Normal Priority', val: stats.normal_priority, cls: 'green' },
      { label: 'Low Priority', val: stats.low_priority, cls: 'orange' },
      { label: 'With Root Cause', val: stats.with_root_cause, cls: '' },
      { label: 'With Components', val: stats.with_components, cls: '' },
      { label: 'With Errors', val: stats.with_errors, cls: '' },
      { label: 'Avg Keywords/Doc', val: stats.avg_keywords, cls: '' },
      { label: 'Avg Embedding Len', val: stats.avg_embedding_length + ' chars', cls: '' },
    ];
    grid.innerHTML = items.map(i => `
      <div class="qa-stat-card">
        <div class="qa-stat-val ${i.cls}">${i.val}</div>
        <div class="qa-stat-lbl">${i.label}</div>
      </div>
    `).join('');
  }

  function renderRagBrowser(docs) {
    const browser = document.getElementById('ragBrowser');
    let page = 0;
    const perPage = 20;

    function render(filter) {
      const filtered = filter
        ? docs.filter(d => {
            const q = filter.toLowerCase();
            return (d.doc_id||'').toLowerCase().includes(q) ||
                   (d.title||'').toLowerCase().includes(q) ||
                   (d.problem||'').toLowerCase().includes(q) ||
                   d.keywords.some(k => k.toLowerCase().includes(q));
          })
        : docs;

      const slice = filtered.slice(page * perPage, (page + 1) * perPage);
      const totalPages = Math.ceil(filtered.length / perPage);

      let html = `<div style="font-size:11px; color:var(--text3); margin-bottom:8px;">${filtered.length} documents${filter ? ' (filtered)' : ''} — Page ${page + 1}/${totalPages || 1}</div>`;
      slice.forEach(d => {
        const priColor = d.retrieval_priority === 'low' ? 'var(--orange)' : 'var(--green)';
        html += `<div class="qa-entry" style="margin-bottom:10px; border:1px solid var(--border); border-radius:8px; padding:12px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <span style="font-weight:600; color:var(--text);">${esc(d.doc_id)}</span>
            <div style="display:flex; gap:6px;">
              <span style="font-size:10px; padding:2px 6px; border-radius:4px; background:${priColor}22; color:${priColor};">${d.retrieval_priority}</span>
              <span style="font-size:10px; padding:2px 6px; border-radius:4px; background:var(--blue)22; color:var(--blue);">${d.issue_type}</span>
            </div>
          </div>
          <div style="font-size:12px; font-weight:600; color:var(--blue); margin-bottom:4px;">${esc(d.title)}</div>
          <div style="font-size:11px; color:var(--text2); margin-bottom:4px;"><b>Problem:</b> ${esc((d.problem||'').substring(0, 200))}${d.problem.length > 200 ? '...' : ''}</div>
          <div style="font-size:11px; color:var(--text2); margin-bottom:4px;"><b>Solution:</b> ${esc((d.solution||'').substring(0, 200))}${d.solution.length > 200 ? '...' : ''}</div>
          <div style="font-size:10px; color:var(--text3);"><b>Keywords:</b> ${esc(d.keywords.join(', '))}</div>
          ${d.technical_context.software_components.length ? `<div style="font-size:10px; color:var(--text3);"><b>Components:</b> ${esc(d.technical_context.software_components.join(', '))}</div>` : ''}
        </div>`;
      });

      // Pagination
      if (totalPages > 1) {
        html += `<div style="display:flex; gap:6px; justify-content:center; margin-top:10px;">`;
        if (page > 0) html += `<button class="btn-sm" onclick="ragBrowsePage(${page - 1})">← Prev</button>`;
        if (page < totalPages - 1) html += `<button class="btn-sm" onclick="ragBrowsePage(${page + 1})">Next →</button>`;
        html += `</div>`;
      }

      browser.innerHTML = html;
    }

    render();

    // Search box
    const searchBox = document.getElementById('ragSearchBox');
    searchBox.oninput = () => { page = 0; render(searchBox.value.trim()); };

    // Expose pagination
    window.ragBrowsePage = (p) => { page = p; render(searchBox.value.trim()); };
  }

  function downloadRagDataset() {
    if (!RAG_ENGINE.ragDataset) return;
    const data = RAG_ENGINE.exportJSON();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'rag_dataset.json'; a.click();
    URL.revokeObjectURL(url);
  }

  function downloadRagEmbeddingTexts() {
    if (!RAG_ENGINE.ragDataset) return;
    const text = RAG_ENGINE.exportEmbeddingTexts();
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'rag_embedding_texts.txt'; a.click();
    URL.revokeObjectURL(url);
  }

  // RAG tab switching
  document.querySelectorAll('[data-ragtab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.dataset.ragtab;
      btn.closest('.qa-tabs').querySelectorAll('.qa-tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      btn.closest('.section-card').querySelectorAll('.qa-tab-content').forEach(c => c.classList.remove('active'));
      document.getElementById(tabId).classList.add('active');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // ── AI_REVIEWER — Ollama-based second-pass validation ──
  // ═══════════════════════════════════════════════════════════
  const AI_REVIEWER = {
    // State
    cleanedData: null,
    removedData: null,
    results: null,
    log: [],
    stats: {},
    aborted: false,

    // Config defaults
    apiUrl: 'http://localhost:11434',
    model: 'llama3:latest',
    batchSize: 8,
    concurrency: 1,       // Ollama serializes internally, so 1 avoids queue buildup
    useProxy: true,       // route through backend /ollama proxy by default
    proxyBase: '',        // e.g. http://localhost:3001

    onLog: null, // callback for real-time log rendering

    // Returns the base URL depending on proxy mode
    getBaseUrl() {
      if (this.useProxy) {
        const base = this.proxyBase || window.location.origin;
        return `${base}/ollama`;
      }
      return this.apiUrl;
    },

    isQwenModel() {
      return String(this.model || '').toLowerCase().startsWith('qwen3');
    },

    _prepareQwenPrompts(systemPrompt, userPrompt) {
      // Check UI setting: Thinking = No → suppress thinking
      const thinkingSetting = document.getElementById('aiThinking')?.value || 'no';
      const suppressThinking = thinkingSetting === 'no';
      if (!suppressThinking) return { systemPrompt, userPrompt };
      return {
        systemPrompt: `${systemPrompt}\n\nIMPORTANT: Do NOT output reasoning or thinking steps. Do NOT use <think> tags. Return only the final answer in the requested format.`,
        userPrompt: `/no_think\n${userPrompt}`
      };
    },

    _stripThink(text) {
      const raw = String(text || '');
      const stripped = raw.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<\/?think>/g, '').trim();
      return stripped || raw.trim();
    },

    _extractOllamaText(data) {
      const messageContent = this._stripThink(data?.message?.content || '');
      const responseText = this._stripThink(data?.response || '');
      if (messageContent) return messageContent;
      if (responseText) return responseText;
      const thinkingText = this._stripThink(data?.thinking || '');
      if (thinkingText) return thinkingText;
      return '';
    },

    addLog(tag, msg) {
      const t = new Date().toLocaleTimeString('en-US',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'});
      this.log.push({t, tag, msg});
      if (this.onLog) try { this.onLog(); } catch(_) {}
    },

   

    getDiagnosticsPrompt(customPrompt = '') {
      const userPolicy = String(customPrompt || '').trim();
      return `You are a diagnostics engine analyzing a support ticket dataset.

Your task is NOT to summarize the whole batch in prose.
Your task is to extract one normalized JSON object per entry so downstream code can aggregate a consistent diagnostics report.

IMPORTANT RULES

1. ENTITY NORMALIZATION
- Merge spelling variants into one canonical technical entity.
- Prefer concrete product/component names over generic labels.

2. ROOT CAUSE AGGREGATION
- Group similar causes into one normalized pattern.
- Use concise lower-case patterns such as "license issues", "network timeout", "publish workflow gap".

3. STATISTICAL CONSISTENCY
- Each ticket gets exactly ONE primary_category.
- Each ticket gets exactly ONE knowledge_bucket.
- Do not duplicate the same technical signal with spelling variants.

4. TECHNICAL SIGNAL EXTRACTION
- Focus on real technical entities: software, services, components, protocols, dependencies.
- Avoid generic labels like "installation", "configuration", "technical support" as technical signals.

5. NOISE PATTERN DETECTION
- Detect communication artifacts: greetings, acknowledgements, signatures, thread markers, attachment-only replies.

For EACH entry, return exactly one JSON object on its own line using this schema:
{"id":"ticket id","primary_category":"normalized category","normalized_signals":["signal"],"root_cause_pattern":"pattern or null","noise_patterns":["pattern"],"weak_patterns":["pattern"],"knowledge_bucket":"troubleshooting|configuration|installation|compatibility|workflow|software_behavior","has_solution":true,"has_clear_problem":true,"has_technical_signals":true,"estimated_noise":false}

Rules for field values:
- primary_category: one concise normalized ticket category
- normalized_signals: array of canonical technical entities only
- root_cause_pattern: aggregated root cause pattern or null
- noise_patterns: array of communication artifacts, can be empty
- weak_patterns: array of low-information patterns, can be empty
- knowledge_bucket: must be exactly one enum value
- has_solution: true only if the entry contains an actionable solution
- has_clear_problem: true only if the problem statement is specific enough for retrieval
- has_technical_signals: true only if at least one real technical signal is present
- estimated_noise: true if the entry is materially degraded by communication noise

Return JSON lines only. No markdown. No commentary. No batch summary.
${userPolicy ? `\nAdditional normalization policy:\n${userPolicy}\n` : ''}`;
    },

    getSystemPrompt() {
      return `You are an AI assistant for a support ticket knowledge base system. You help review, analyze, and improve support ticket entries. Respond concisely and in the requested format.`;
    },

    getNormalizePrompt() {
      return `You are a STRICT query extraction system.
GOAL:
Convert a noisy support ticket "problem" into ONE clean, high-quality search query for a RAG system.
══════════ RULES ══════════
1. Extract ONLY the core technical question or intent
2. REMOVE:
   - greetings ("hi", "hope you are well")
   - names, signatures, emails
   - coordination ("please advise", "let me know")
   - redundant context
3. KEEP:
   - product names (SecureView, Publisher, Player, etc.)
   - key entities (feature, config, error, device)
   - important constraints (version, format, environment)
4. REWRITE:
   - make it clear, concise, and self-contained
   - replace vague words ("this", "it") with explicit terms if possible
5. FORMAT:
   - ONE sentence only
   - MUST be a question if intent is a question
   - 5–15 words preferred
6. DO NOT:
   - explain
   - add extra info not present
   - output multiple queries
══════════ OUTPUT FORMAT ══════════
Return ONLY the query as plain text.
No JSON. No quotes. No explanation.
══════════ EXAMPLES ══════════
Input:
"I hope this message finds you well... client asks which codec is best for 4K playback in SecureView"
Output:
What video codec works best for 4K playback in SecureView?
---
Input:
"User cannot log in after update, asks what to check"
Output:
Why can't user log in after system update?
---
Input:
"Player not syncing content, we rebooted but still not working, need help"
Output:
Why is player not syncing content after reboot?`;
    },

    getSolutionCleanPrompt() {
      return `You are a STRICT solution cleaning system for a technical support knowledge base.
GOAL:
Clean a noisy support ticket "solution" into a reusable, actionable technical answer suitable for RAG retrieval.
══════════ RULES ══════════
1. REMOVE completely:
   - Greetings and closings ("Hi John", "Thanks", "Let me know", "Please advise", "Hope this helps")
   - Personal names (replace with "the user" or remove)
   - Internal notes not useful to a third party ("I've remoted in and fixed it")
   - Filler phrases ("As discussed", "As per our call", "Sorry for the delay")
   - Image references like "image9Z", "screenshot123", attachment placeholders
   - Trailing noise ("Let me know if that works", "Feel free to reach out")
2. KEEP and PRESERVE:
   - All technical steps, commands, file paths, URLs
   - Version numbers, product names, config values
   - Conditional logic ("if X → do Y")
   - Error patterns and their fixes
3. REWRITE non-reusable resolutions into reusable steps:
   - "We remoted in and changed X" → "Change X in [location]"
   - "I fixed the typo in the server name" → "Verify the server name is spelled correctly in [config location]"
   - "Brent, I've changed anti-aliasing on all players" → "Change the anti-aliasing settings on the affected players"
4. CLEAN URLs:
   - Remove any text accidentally appended to URLs (e.g. "http://example.com/file.zipRun" → "http://example.com/file.zip")
5. FORMAT:
   - Plain text only, no JSON, no markdown headers
   - Keep original paragraph/step structure if present
   - Concise but complete — do not omit technical details
══════════ OUTPUT FORMAT ══════════
Return ONLY the cleaned solution as plain text.
One solution per line of input. No numbering. No explanation.
══════════ EXAMPLES ══════════
Input:
"David, I've remoted onto your system and changed the anti aliasing settings on all players, this should resolve the issue. Please give it a few seconds image9Z"
Output:
Change the anti-aliasing settings on the affected players to resolve display issues.
---
Input:
"Troy, You should be able to do it by going to Maintenance tab. There is a link to change company names. Let me know if that works"
Output:
Go to the Maintenance tab. Use the link to change company names.
---
Input:
"Please download and install Touchscreen Tool below.\nhttps://cdn.example.net/deploy/html5/TouchScreenTool.apkRun the installer and reboot."
Output:
Download and install Touchscreen Tool from: https://cdn.example.net/deploy/html5/TouchScreenTool.apk
Run the installer and reboot.`;
    },

    getValidationPrompt() {
      return `You are a QA consistency validator for normalized support tickets.

TASK:
Decide whether the solution is materially aligned with the problem and issue type.

EVALUATION RULES:
- PASS if the solution addresses the dominant issue in the problem.
- PASS if the ticket contains multiple sub-issues and the solution clearly addresses one explicit sub-issue.
- PASS if the solution gives a related prerequisite, diagnostic, configuration step, or hardware check for the stated problem.
- PASS if the solution is narrower than the problem but still belongs to the same operational domain.
- FAIL only if the solution is clearly about a different issue, different system domain, or unrelated administrative coordination.

IMPORTANT:
- Do not fail just because the ticket mentions multiple devices or historical context.
- Do not fail just because the solution only addresses one player/device in a multi-device thread.
- Prefer PASS when the solution is technically related and actionable.

Input will be a JSON object mapping ticket_id to:
{
  "issue_type": "...",
  "problem": "...",
  "solution": "..."
}

Return ONLY a valid JSON object mapping each ticket_id to:
{
  "valid": true or false,
  "reason": "short explanation"
}

No markdown. No extra text.`;
    },

    getScoringPrompt() {
      return `You are a STRICT JSON API.
OUTPUT:
- ONLY valid JSON array
- NO explanation
- NO extra text
TASK:
Score each ticket for RAG knowledge base inclusion.
══════════ RULES ══════════
1. noise_score (0 or 1)
1 = valid technical/support content
0 = noise (meeting, coordination, admin, empty)
---
2. solution_score (0 or 1)
1 = actionable OR directionally useful solution
0 = no solution
AUTO FAIL (→ 0):
- pure question
- coordination only
- "we will check / update / investigate"
- no action or guidance at all
ALLOW (→ 1):
A. DIRECT SOLUTION
- step-by-step instructions
- executed fix
- clear action
B. DIRECTIONAL SOLUTION
- troubleshooting steps that move user closer to solution
- concrete checks (network, config, version, logs)
- partial but useful guidance
C. CONDITIONAL / DIAGNOSTIC
- "if X → do Y"
- root-cause hints with action
⚠️ HARD FAIL (overrides ALL above):
Even if guidance exists, set solution_score = 0 if:
- requires user confirmation to proceed ("can you confirm", "let me know")
- requires follow-up from support
- depends on missing context or external action
- is mainly exploratory conversation
- does not provide a complete actionable path
ONLY mark 1 if:
- user can take action immediately WITHOUT further interaction
---
3. reusability_score (0 or 1)
1 = reusable in similar cases
0 = one-time/admin/user-specific
AUTO FAIL:
- license reset done
- account updated
- "we fixed it for you"
- hardware-specific replacement without general rule
ALLOW:
- troubleshooting patterns
- config changes
- environment checks
- system behavior explanations
---
4. quality_score (0–8)
IF noise_score = 0 → 0
ELSE:
8 = clear problem + root cause + steps
7 = clear problem + strong solution
6 = usable solution or strong diagnostic guidance
4-5 = weak / vague
1-3 = poor
NOTE:
- DO NOT force 0 just because solution is partial
- allow 6 for useful troubleshooting guidance
---
FINAL:
keep = true ONLY IF:
noise_score = 1
AND solution_score = 1
AND reusability_score = 1
AND quality_score >= 6
══════════ OUTPUT FORMAT ══════════
[
  {
    "ticket_id": number,
    "noise_score": 0 or 1,
    "solution_score": 0 or 1,
    "reusability_score": 0 or 1,
    "quality_score": number,
    "keep": true or false,
    "reason": "short"
  }
]
INVALID if any extra text is included.`;
    },

    async testConnection() {
      try {
        const base = this.getBaseUrl();
        const r = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(8000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        return { ok: true, models: (data.models||[]).map(m => m.name||m.model||'') };
      } catch(e) {
        return { ok: false, error: e.message };
      }
    },

    buildBatchPrompt(entries) {
      const lines = ['Review these support ticket knowledge base entries:\n'];
      entries.forEach((e, i) => {
        lines.push(`--- ENTRY ${i+1} ---`);
        lines.push(`ID: ${e.ticket_id}`);
        lines.push(`Problem: ${(e.problem||'').substring(0,400)}`);
        lines.push(`Solution: ${(e.solution||'').substring(0,400)}`);
        if (e.root_cause) lines.push(`Root Cause: ${(e.root_cause||'').substring(0,150)}`);
        lines.push('');
      });
      lines.push(`Respond with exactly ${entries.length} JSON objects, one per line, in the same order.`);
      return lines.join('\n');
    },

    parseResponse(text) {
      const results = [];
      // Primary: line-by-line JSON parsing (most reliable for multi-field objects)
      const _valid = (obj) => obj.id && (obj.verdict || obj.problem || obj.solution);
      text.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (!trimmed.startsWith('{')) return;
        try {
          const obj = JSON.parse(trimmed);
          if (_valid(obj)) results.push(obj);
        } catch(_) {
          // Try to extract JSON substring from the line
          const start = trimmed.indexOf('{');
          const end = trimmed.lastIndexOf('}');
          if (start >= 0 && end > start) {
            try {
              const obj = JSON.parse(trimmed.substring(start, end + 1));
              if (_valid(obj)) results.push(obj);
            } catch(_) {}
          }
        }
      });
      // Fallback: regex for simple flat JSON (no nested objects)
      if (results.length === 0) {
        const jsonRe = /\{[^{}]*"id"\s*:\s*"[^"]*"[^{}]*\}/g;
        let m;
        while ((m = jsonRe.exec(text)) !== null) {
          try {
            const obj = JSON.parse(m[0]);
            if (_valid(obj)) results.push(obj);
          } catch(_) {}
        }
      }
      return results;
    },

    async reviewBatch(entries) {
      const userPrompt = this.buildBatchPrompt(entries);

      // Try /api/chat first (Ollama >= 0.1.14), fallback to /api/generate
      let responseText = '';
      try {
        responseText = await this._tryChat(userPrompt);
      } catch(chatErr) {
        try {
          responseText = await this._tryGenerate(userPrompt);
        } catch(genErr) {
          throw new Error(`Both /api/chat and /api/generate failed. Chat: ${chatErr.message}. Generate: ${genErr.message}`);
        }
      }
      return this.parseResponse(responseText);
    },

    async _tryChat(userPrompt, systemOverride, optionsOverride = {}) {
      const sysPrompt = systemOverride || this.getSystemPrompt();
      const prepared = this._prepareQwenPrompts(sysPrompt, userPrompt);
      const presetOpts = typeof getOllamaOptions === 'function' ? getOllamaOptions() : {};
      const numPredict = optionsOverride.num_predict || presetOpts.num_predict || (systemOverride ? 4096 : Math.max(800, this.batchSize * 120));
      const payload = {
        model: this.model,
        messages: [
          { role: 'system', content: prepared.systemPrompt },
          { role: 'user', content: prepared.userPrompt }
        ],
        stream: false,
        options: {
          ...presetOpts,
          ...optionsOverride,
          num_predict: numPredict
        }
      };
      const base = this.getBaseUrl();
      const timeout = systemOverride ? 600000 : 180000;
      const r = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeout),
      });
      if (!r.ok) throw new Error(`Chat HTTP ${r.status} ${r.statusText}`);
      const data = await r.json();
      const text = this._extractOllamaText(data);
      if (!text) throw new Error('Chat returned no usable text');
      return text;
    },

    async _tryGenerate(userPrompt, systemOverride, optionsOverride = {}) {
      const sysPrompt = systemOverride || this.getSystemPrompt();
      const prepared = this._prepareQwenPrompts(sysPrompt, userPrompt);
      const presetOpts = typeof getOllamaOptions === 'function' ? getOllamaOptions() : {};
      const numPredict = optionsOverride.num_predict || presetOpts.num_predict || (systemOverride ? 4096 : Math.max(800, this.batchSize * 120));
      const payload = {
        model: this.model,
        prompt: prepared.userPrompt,
        system: prepared.systemPrompt,
        stream: false,
        options: {
          ...presetOpts,
          ...optionsOverride,
          num_predict: numPredict
        }
      };
      const base = this.getBaseUrl();
      const timeout = systemOverride ? 600000 : 180000;
      const r = await fetch(`${base}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeout),
      });
      if (!r.ok) throw new Error(`Generate HTTP ${r.status} ${r.statusText}`);
      const data = await r.json();
      const text = this._extractOllamaText(data);
      if (!text) throw new Error('Generate returned no usable text');
      return text;
    },

    // Process a single batch and collect results (used by concurrent runner)
    async _processBatch(batch, batchIdx, totalBatches) {
      let batchProcessed = 0, batchErrors = 0;
      this.addLog('info', `Batch ${batchIdx+1} started (${batch.length} entries)...`);
      const t0 = Date.now();
      try {
        const reviews = await this.reviewBatch(batch);
        for (const rev of reviews) {
          const entry = batch.find(e => String(e.ticket_id) === String(rev.id));
          if (!entry) continue;

          this.results.reviews[rev.id] = { ...rev, _source: entry._source };
          batchProcessed++;

          if (rev.verdict === 'remove' && entry._source === 'kept') {
            this.results.flagged.push({ entry, review: rev });
            this.addLog('flag', `[${rev.id}] Remove: ${rev.reason||''}`);
          } else if ((rev.verdict === 'keep' || rev.verdict === 'edit') && entry._source === 'removed') {
            this.results.rescue.push({ entry, review: rev });
            this.addLog('rescue', `[${rev.id}] Rescue: ${rev.reason||''}`);
          }
          if (rev.verdict === 'edit' && rev.edits && (rev.edits.problem || rev.edits.solution)) {
            this.results.edits.push({ entry, review: rev });
          }
        }
        if (reviews.length < batch.length) {
          const missed = batch.length - reviews.length;
          this.addLog('warn', `Batch ${batchIdx+1}: ${missed} entries got no AI response`);
          batchErrors += missed;
        }
        this.addLog('info', `Batch ${batchIdx+1} done in ${((Date.now()-t0)/1000).toFixed(1)}s (${batchProcessed} ok)`);
      } catch(e) {
        this.addLog('error', `Batch ${batchIdx+1} failed after ${((Date.now()-t0)/1000).toFixed(1)}s: ${e.message}`);
        batchErrors += batch.length;
      }
      return { processed: batchProcessed, errors: batchErrors };
    },

    async run(cleanedData, removedData, onProgress) {
      this.log = [];
      this.results = { flagged: [], rescue: [], edits: [], reviews: {} };
      this.aborted = false;
      this.cleanedData = cleanedData;
      this.removedData = removedData;

      const reviewKept = document.getElementById('aiReviewKept')?.checked !== false;
      const reviewRemoved = document.getElementById('aiReviewRemoved')?.checked === true;
      const quickMode = document.getElementById('aiQuickMode')?.checked === true;

      let toReview = [];
      if (reviewKept) toReview.push(...cleanedData.map(e => ({...e, _source: 'kept'})));
      if (reviewRemoved && removedData) toReview.push(...removedData.map(e => ({...e, _source: 'removed'})));

      // Quick mode: sample ~20% (min 50, max entries)
      if (quickMode && toReview.length > 50) {
        const sampleSize = Math.max(50, Math.round(toReview.length * 0.2));
        // Shuffle and take sample
        const shuffled = [...toReview].sort(() => Math.random() - 0.5);
        toReview = shuffled.slice(0, sampleSize);
        this.addLog('info', `Quick mode: sampling ${toReview.length} of ${cleanedData.length + (removedData||[]).length} entries`);
      }

      const concurrency = this.concurrency || 3;

      this.addLog('info', `Starting AI review: ${toReview.length} entries (kept:${reviewKept?cleanedData.length:0}, removed:${reviewRemoved?(removedData||[]).length:0})`);
      this.addLog('info', `Model: ${this.model}, Batch: ${this.batchSize}, Concurrency: ${concurrency}${quickMode?' [QUICK]':''}`);

      const batches = [];
      for (let i = 0; i < toReview.length; i += this.batchSize) {
        batches.push(toReview.slice(i, i + this.batchSize));
      }

      this.addLog('info', `${batches.length} batches to process (${concurrency} parallel)`);
      let processed = 0, errors = 0, batchesDone = 0;
      const t0 = Date.now();

      const _updateProgress = () => {
        const pct = Math.round((batchesDone / batches.length) * 95);
        const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
        const eta = batchesDone > 0 ? Math.round(((Date.now() - t0) / batchesDone) * (batches.length - batchesDone) / 1000) : '?';
        onProgress(pct, `Batch ${batchesDone}/${batches.length} (${processed} entries, ${elapsed}s, ~${eta}s left)...`);
      };

      // Concurrent pool: each batch updates progress immediately on completion
      let nextIdx = 0;
      const runNext = async () => {
        while (nextIdx < batches.length && !this.aborted) {
          const bi = nextIdx++;
          const r = await this._processBatch(batches[bi], bi, batches.length);
          processed += r.processed;
          errors += r.errors;
          batchesDone++;
          _updateProgress();
        }
      };

      // Launch N workers
      _updateProgress();
      const workers = Array.from({ length: Math.min(concurrency, batches.length) }, () => runNext());
      await Promise.all(workers);

      if (this.aborted) this.addLog('warn', 'Aborted by user');

      // Stats
      const verdicts = { keep: 0, remove: 0, edit: 0 };
      Object.values(this.results.reviews).forEach(r => { if (verdicts[r.verdict] !== undefined) verdicts[r.verdict]++; });

      const totalTime = ((Date.now() - t0) / 1000).toFixed(1);
      this.stats = {
        total: toReview.length,
        processed,
        errors,
        flagged: this.results.flagged.length,
        rescue: this.results.rescue.length,
        edits: this.results.edits.length,
        verdicts,
        quickMode,
        timeSeconds: parseFloat(totalTime),
      };

      this.addLog('info', `Complete in ${totalTime}s: ${processed}/${toReview.length} reviewed, ${errors} errors`);
      this.addLog('info', `Verdicts — keep:${verdicts.keep} remove:${verdicts.remove} edit:${verdicts.edit}`);
      this.addLog('info', `Flagged:${this.results.flagged.length} Rescue:${this.results.rescue.length} Edits:${this.results.edits.length}`);

      onProgress(100, `AI Review complete (${totalTime}s)`);
      return this.results;
    },
  };

  // ── AI Review: suggestion tracking ──
  const _aiSuggestions = {};
  function acceptAiSuggestion(tid, action) {
    _aiSuggestions[tid] = { accepted: true, action };
    const card = document.querySelector(`[data-ai-tid="${tid}"]`);
    if (card) {
      const btns = card.querySelectorAll('.ai-rev-actions button');
      btns[0]?.classList.add('accepted'); btns[0]?.classList.remove('rejected');
      btns[1]?.classList.remove('accepted'); btns[1]?.classList.remove('rejected');
    }
  }
  function rejectAiSuggestion(tid) {
    _aiSuggestions[tid] = { accepted: false };
    const card = document.querySelector(`[data-ai-tid="${tid}"]`);
    if (card) {
      const btns = card.querySelectorAll('.ai-rev-actions button');
      btns[1]?.classList.add('rejected'); btns[1]?.classList.remove('accepted');
      btns[0]?.classList.remove('accepted'); btns[0]?.classList.remove('rejected');
    }
  }

  function aiBulkAction(category, action) {
    if (!AI_REVIEWER.results) return;
    const items = category === 'flagged' ? AI_REVIEWER.results.flagged
                : category === 'rescue' ? AI_REVIEWER.results.rescue
                : category === 'edits' ? AI_REVIEWER.results.edits : [];
    let count = 0;
    items.forEach(item => {
      const tid = item.entry.ticket_id;
      if (action === 'accept') {
        acceptAiSuggestion(tid, item.review.verdict);
      } else {
        rejectAiSuggestion(tid);
      }
      count++;
    });
    showToast(`${action === 'accept' ? 'Accepted' : 'Rejected'} ${count} entries`);
  }

  // ── AI Review: UI Functions ──
  // ── AI Review data source functions ──
  let _aiReviewInput = { cleaned: null, removed: null, source: '' };
  let _scoringImportedState = null;

  function aiReviewFromQa() {
    const src = DEEP_CLEAN.cleanedData?.length ? DEEP_CLEAN : QA_PIPELINE;
    if (!src.cleanedData || !src.cleanedData.length) {
      showToast('No pipeline output available. Run QA Clean first.'); return;
    }
    _clearModeStates();
    window._normalizeOutput = null;
    _aiReviewInput.cleaned = src.cleanedData;
    _aiReviewInput.removed = src.removedEntries || [];
    _aiReviewInput.source = DEEP_CLEAN.cleanedData?.length ? 'Deep Clean output' : 'QA Clean output';
    _scoringImportedState = null;
    document.getElementById('aiSourceStatus').textContent = `Loaded ${_aiReviewInput.cleaned.length} entries from ${_aiReviewInput.source}`;
    document.getElementById('aiSourceStatus').style.color = 'var(--text2)';
    saveAiInputSnapshot();
    if (typeof checkDiagCache === 'function') checkDiagCache();
    const currentMode = document.getElementById('aiReviewMode')?.value;
    if (currentMode === 'scoring') { if (typeof refreshScoringStatusBar === 'function') refreshScoringStatusBar(); }
    else { if (typeof refreshRunStatusBar === 'function') refreshRunStatusBar(); }
  }

  function getPreviousAiPipelineInputMode(mode) {
    if (mode === 'validation') return 'extraction';
    if (mode === 'extraction') return 'generalize';
    if (mode === 'generalize') return 'normalize';
    if (mode === 'normalize') return 'scoring';
    if (mode === 'scoring') return 'distill';
    return '';
  }

  function getAiPipelineDatasetLabel(mode) {
    if (mode === 'validation') return 'validated dataset';
    if (mode === 'extraction') return 'extracted dataset';
    if (mode === 'generalize') return 'generalized dataset';
    if (mode === 'normalize') return 'normalized dataset';
    if (mode === 'scoring') return 'filtered dataset';
    if (mode === 'distill') return 'distilled dataset';
    return 'pipeline dataset';
  }

  function getAiPreviousStepMissingMessage(mode) {
    if (mode === 'validation') return 'No extracted output available yet. Run AI Extraction first.';
    if (mode === 'extraction') return 'No generalized output available yet. Run AI Generalize first.';
    if (mode === 'generalize') return 'No normalized output available yet. Run AI Normalize first.';
    if (mode === 'normalize') return 'No filtered output available yet. Run AI Filter first.';
    if (mode === 'scoring') return 'No distilled output available yet. Run AI Distill first.';
    return 'No previous step output available.';
  }

  async function aiReviewUsePreviousStepOutput() {
    const currentMode = document.getElementById('aiReviewMode')?.value || 'diagnostics';
    const prevMode = getPreviousAiPipelineInputMode(currentMode);

    if (!prevMode) {
      aiReviewFromQa();
      return;
    }

    await _ensureModeStateLoaded(prevMode);
    const prevState = _modeStates[prevMode];
    const prevOutput = _cloneAiValue(prevState?.pipelineOutput || prevState?.cleaned || null);
    if (!Array.isArray(prevOutput) || !prevOutput.length) {
      if (currentMode === 'normalize' || currentMode === 'scoring') {
        aiReviewFromQa();
        return;
      }
      showToast(getAiPreviousStepMissingMessage(currentMode));
      return;
    }

    _aiReviewInput.cleaned = prevOutput;
    _aiReviewInput.removed = [];
    _aiReviewInput.source = getAiPipelineDatasetLabel(prevMode);
    _scoringImportedState = null;
    window._normalizeOutput = _cloneAiValue(prevOutput);

    const statusEl = document.getElementById('aiSourceStatus');
    if (statusEl) {
      statusEl.textContent = `Loaded ${prevOutput.length.toLocaleString()} entries from ${_aiReviewInput.source}`;
      statusEl.style.color = 'var(--text2)';
    }

    const titleEl = document.querySelector('#aiImportZone .upload-title');
    if (titleEl) {
      titleEl.textContent = prevState?.uploadTitle || `Using ${getAiPipelineDatasetLabel(prevMode)}`;
    }

    saveAiInputSnapshot();
    if (typeof checkDiagCache === 'function') checkDiagCache();
    if (currentMode === 'scoring') {
      if (typeof refreshScoringStatusBar === 'function') refreshScoringStatusBar();
    } else {
      if (typeof refreshRunStatusBar === 'function') refreshRunStatusBar();
    }
  }

  function aiReviewFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
      try {
        if (activeAiPipelineJobId || _aiRunning) {
          detachActiveAiPipelineJob(true);
          resetAiReviewPanels();
        }
        const data = JSON.parse(e.target.result);
        const entries = data.VALID_KNOWLEDGE_DATASET || data.RAG_DATASET || (Array.isArray(data) ? data : null) || (Array.isArray(data.entries) ? data.entries : null);
        if (!entries || !entries.length) { showToast('No valid entries found in file.'); return; }
        const removed = data.REMOVED_POISON_ENTRIES || [];

        const currentMode = document.getElementById('aiReviewMode')?.value;
        const hasScoringData = entries.some(e => e.ai_scoring !== undefined);

        _clearModeStates();
        window._normalizeOutput = null;
        _aiReviewInput.cleaned = entries;
        _aiReviewInput.removed = removed;
        _aiReviewInput.source = file.name;
        _scoringImportedState = null;
        saveAiInputSnapshot();
        document.getElementById('aiSourceStatus').textContent = `Loaded ${entries.length} entries from ${file.name}` + (removed.length ? ` + ${removed.length} removed` : '');
        document.getElementById('aiSourceStatus').style.color = 'var(--text2)';
        // Show filename in upload zone
        const titleEl = document.querySelector('#aiImportZone .upload-title');
        if (titleEl) titleEl.textContent = file.name;
        // Check if we have cached diagnostics for this file
        if (typeof checkDiagCache === 'function') checkDiagCache();

        if (currentMode === 'normalize') {
          _normalizeCacheKey = normalizeFingerprint(file.name, entries);
        } else if (currentMode === 'scoring') {
          // Set cache key so status bar can count cached entries
          if (typeof scoringFingerprint === 'function') {
            _scoringCacheKey = scoringFingerprint(file.name, entries);
          }
          if (hasScoringData) {
            // File already has scores — restore summary only.
            // Do NOT auto-save imported scores into local cache and do NOT
            // imply the current dataset was fully scored in this browser.
            window._scoringOutput = entries;
            const scoredEntries = entries.filter(e => e.ai_scoring);
            const keptEntries   = scoredEntries.filter(e => e.ai_scoring.keep);
            const droppedEntries = scoredEntries.filter(e => !e.ai_scoring.keep);
            const allScored = scoredEntries.length === entries.length;
            const keepOnlySubset = scoredEntries.length > 0 && droppedEntries.length === 0 && /keep/i.test(file.name);
            _scoringImportedState = { allScored, keepOnlySubset, scored: scoredEntries.length };
            // Show progress panel with summary bar
            const progPanel = document.getElementById('aiRevProgress');
            const fill  = document.getElementById('aiRevProgressFill');
            const stage = document.getElementById('aiRevStage');
            const pct   = document.getElementById('aiRevPct');
            const logEl = document.getElementById('aiRevLog');
            if (progPanel) progPanel.style.display = '';
            if (fill)  fill.style.width = allScored && !keepOnlySubset ? '100%' : '0%';
            if (pct)   pct.textContent = allScored && !keepOnlySubset ? '100%' : '—';
            if (stage) {
              stage.textContent = keepOnlySubset
                ? `Imported keep-only scored file — ${keptEntries.length} kept entries loaded`
                : allScored
                  ? `Imported scored file — ${scoredEntries.length} scored, ${keptEntries.length} kept, ${droppedEntries.length} dropped`
                  : `Imported partial scored file — ${scoredEntries.length}/${entries.length} entries already scored`;
            }
            if (logEl) {
              logEl.innerHTML = `<div class="qa-log-entry"><span class="qa-log-tag info">INFO</span><span class="qa-log-msg">${
                keepOnlySubset
                  ? `Keep-only scored file loaded — ${keptEntries.length} kept entries from ${file.name}. Cache was not updated.`
                  : allScored
                    ? `Scored file loaded — ${scoredEntries.length} scored entries imported from ${file.name}. Cache was not updated.`
                    : `Partial scored file loaded — ${scoredEntries.length}/${entries.length} entries already scored in ${file.name}. Cache was not updated.`
              }</span></div>`;
            }
            // Hide stale pipeline report (no log data from file)
            const pipelineReport = document.getElementById('pipelineReport');
            if (pipelineReport) pipelineReport.style.display = 'none';
            // Render scoring summary
            if (typeof renderScoringReport === 'function') {
              renderScoringReport({ total: entries.length, scored: scoredEntries.length, kept: keptEntries.length, dropped: droppedEntries.length });
            }
          } else {
            // No scoring data — clear pipeline UI
            const progPanel = document.getElementById('aiRevProgress');
            if (progPanel) progPanel.style.display = 'none';
            const summaryEl = document.getElementById('aiScoringSummary');
            if (summaryEl) summaryEl.style.display = 'none';
            const pipelineReport = document.getElementById('pipelineReport');
            if (pipelineReport) { pipelineReport.style.display = 'none'; document.getElementById('pipelineContent').innerHTML = ''; }
            _scoringCacheKey = '';
          }
          if (typeof refreshScoringStatusBar === 'function') refreshScoringStatusBar();
        } else { if (typeof refreshRunStatusBar === 'function') refreshRunStatusBar(); }
      } catch(err) {
        showToast('Failed to parse JSON: ' + err.message);
      }
    };
    reader.readAsText(file);
  }


  // Drag-drop for AI Review
  (function() {
    const zone = document.getElementById('aiImportZone');
    if (!zone) return;
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.style.borderColor = 'var(--blue)'; });
    zone.addEventListener('dragleave', () => { zone.style.borderColor = 'var(--border)'; });
    zone.addEventListener('drop', e => {
      e.preventDefault(); zone.style.borderColor = 'var(--border)';
      const file = e.dataTransfer.files[0];
      if (file) { document.getElementById('aiImportInput').files = e.dataTransfer.files; aiReviewFileUpload({target:{files:e.dataTransfer.files}}); }
    });
  })();

  // ── Per-mode UI state store ──────────────────────────────────
  const _modeStates = {};

  const AI_PIPELINE_STATE_DB = 'kbAiReviewStateDb';
  const AI_PIPELINE_STATE_STORE = 'modeStates';

  function _openAiReviewStateDb() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new Error('IndexedDB unavailable'));
        return;
      }
      const req = indexedDB.open(AI_PIPELINE_STATE_DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(AI_PIPELINE_STATE_STORE)) {
          db.createObjectStore(AI_PIPELINE_STATE_STORE, { keyPath: 'mode' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('Failed to open AI state DB'));
    });
  }

  async function _persistModeState(mode, state) {
    const db = await _openAiReviewStateDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(AI_PIPELINE_STATE_STORE, 'readwrite');
      const store = tx.objectStore(AI_PIPELINE_STATE_STORE);
      const req = store.put({ mode, state, savedAt: Date.now() });
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error || new Error('Failed to persist AI mode state'));
    }).finally(() => db.close());
  }

  async function _loadPersistedModeState(mode) {
    const db = await _openAiReviewStateDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(AI_PIPELINE_STATE_STORE, 'readonly');
      const store = tx.objectStore(AI_PIPELINE_STATE_STORE);
      const req = store.get(mode);
      req.onsuccess = () => resolve(req.result?.state || null);
      req.onerror = () => reject(req.error || new Error('Failed to load AI mode state'));
    }).finally(() => db.close());
  }

  async function _deletePersistedModeState(mode) {
    const db = await _openAiReviewStateDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(AI_PIPELINE_STATE_STORE, 'readwrite');
      const store = tx.objectStore(AI_PIPELINE_STATE_STORE);
      const req = store.delete(mode);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error || new Error('Failed to delete AI mode state'));
    }).finally(() => db.close());
  }

  async function _clearPersistedModeStates() {
    const db = await _openAiReviewStateDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(AI_PIPELINE_STATE_STORE, 'readwrite');
      const store = tx.objectStore(AI_PIPELINE_STATE_STORE);
      const req = store.clear();
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error || new Error('Failed to clear AI mode states'));
    }).finally(() => db.close());
  }

  async function _ensureModeStateLoaded(mode) {
    if (_modeStates[mode]) return true;
    try {
      const persisted = await _loadPersistedModeState(mode);
      if (!persisted) return false;
      _modeStates[mode] = persisted;
      return true;
    } catch (_) {
      return false;
    }
  }

  function _cloneAiValue(value) {
    if (value == null) return value;
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function _hasMeaningfulModeState(state) {
    if (!state) return false;
    if (Array.isArray(state.pipelineOutput) && state.pipelineOutput.length) return true;
    if (state.downloadDisplay && state.downloadDisplay !== 'none') return true;
    if (state.validationKeepDisplay && state.validationKeepDisplay !== 'none') return true;
    if (state.normSummaryDisplay && state.normSummaryDisplay !== 'none') return true;
    if (state.filterSummaryDisplay && state.filterSummaryDisplay !== 'none') return true;
    if (state.summaryDisplay && state.summaryDisplay !== 'none') return true;
    if (state.pipelineDisplay && state.pipelineDisplay !== 'none') return true;
    if (state.progDisplay && state.progDisplay !== 'none' && state.logHTML) return true;
    return false;
  }

  function _clearModeStates(modes = null) {
    const keys = Array.isArray(modes) && modes.length ? modes : Object.keys(_modeStates);
    keys.forEach((key) => delete _modeStates[key]);
    if (Array.isArray(modes) && modes.length) {
      keys.forEach((key) => { _deletePersistedModeState(key).catch(() => {}); });
    } else {
      _clearPersistedModeStates().catch(() => {});
    }
  }

  function _saveModeState(mode) {
    const g = (id) => document.getElementById(id);
    const nextState = {
      // shared input
      cleaned:  _cloneAiValue(_aiReviewInput.cleaned),
      removed:  _cloneAiValue(_aiReviewInput.removed),
      source:   _aiReviewInput.source,
      // source status
      sourceText:  g('aiSourceStatus')?.textContent || '',
      sourceColor: g('aiSourceStatus')?.style.color || '',
      // upload zone label
      uploadTitle: document.querySelector('#aiImportZone .upload-title')?.textContent || '',
      // progress panel
      progDisplay:  g('aiRevProgress')?.style.display || 'none',
      fillWidth:    g('aiRevProgressFill')?.style.width || '0%',
      stageHTML:    g('aiRevStage')?.innerHTML || '',
      pctText:      g('aiRevPct')?.textContent || '0%',
      logHTML:      g('aiRevLog')?.innerHTML || '',
      // scoring summary
      summaryDisplay: g('aiScoringSummary')?.style.display || 'none',
      statTotal:  g('scoringStatTotal')?.textContent || '0',
      statScored: g('scoringStatScored')?.textContent || '0',
      statKeep:   g('scoringStatKeep')?.textContent || '0',
      statDrop:   g('scoringStatDrop')?.textContent || '0',
      // pipeline report
      pipelineDisplay: g('pipelineReport')?.style.display || 'none',
      pipelineHTML:    g('pipelineContent')?.innerHTML || '',
      // normalize + filter summary panels
      normSummaryDisplay:   g('aiNormalizeSummary')?.style.display || 'none',
      filterSummaryDisplay: g('aiFilterSummary')?.style.display || 'none',
      // pipeline summary content
      summaryTitle:  g('aiSummaryTitle')?.textContent || '',
      summaryLabel1: g('aiSummaryLabel1')?.textContent || '',
      summaryLabel2: g('aiSummaryLabel2')?.textContent || '',
      summaryLabel3: g('aiSummaryLabel3')?.textContent || '',
      summaryLabel4: g('aiSummaryLabel4')?.textContent || '',
      summaryLabel5: g('aiSummaryLabel5')?.textContent || '',
      summaryLabel6: g('aiSummaryLabel6')?.textContent || '',
      summaryVal1:   g('normStatTotal')?.textContent || '0',
      summaryVal2:   g('normStatProbChanged')?.textContent || '—',
      summaryVal3:   g('normStatSolChanged')?.textContent || '—',
      summaryVal4:   g('normStatCached')?.textContent || '0',
      summaryVal5:   g('normStatCompression')?.textContent || '—',
      summaryVal6:   g('normStatInvalid')?.textContent || '—',
      cachedCount:   g('aiRunStatCachedN')?.textContent || '0',
      downloadLabel: g('btnDownloadAiStep')?.textContent || 'Download',
      downloadDisplay: g('btnDownloadAiStep')?.style.display || 'none',
      validationKeepDisplay: g('btnDownloadValidationKeep')?.style.display || 'none',
      runScope: document.querySelector('input[name="aiRunScope"]:checked')?.value || 'total',
      testSize: document.getElementById('aiTestSize')?.value || '30',
      ticketIds: document.getElementById('aiTicketIds')?.value || '',
      parallel: document.getElementById('aiNormalizeParallel')?.value || '10',
      pipelineOutput: _cloneAiValue(window._normalizeOutput || null),
    };
    const prevState = _modeStates[mode];
    if (_hasMeaningfulModeState(prevState) && !_hasMeaningfulModeState(nextState)) {
      // Do not let an empty/hidden UI snapshot overwrite a completed step result.
      return;
    }
    _modeStates[mode] = nextState;
    _persistModeState(mode, _modeStates[mode]).catch(() => {});
  }

  function persistCurrentAiReviewState() {
    try {
      const mode = document.getElementById('aiReviewMode')?.value || localStorage.getItem('aiReviewMode') || 'diagnostics';
      _saveModeState(mode);
      saveAiInputSnapshot();
    } catch (_) {}
  }

  function _restoreModeState(mode) {
    const s = _modeStates[mode];
    const g = (id) => document.getElementById(id);
    if (!s) {
      // Never visited — clear only result panels and preserve current input/source.
      if (g('aiRevProgress'))        g('aiRevProgress').style.display = 'none';
      if (g('aiRevProgressFill'))    g('aiRevProgressFill').style.width = '0%';
      if (g('aiRevStage'))           g('aiRevStage').textContent = 'Initializing...';
      if (g('aiRevPct'))             g('aiRevPct').textContent = '0%';
      if (g('aiRevLog'))             g('aiRevLog').innerHTML = '';
      if (g('aiScoringSummary'))     g('aiScoringSummary').style.display = 'none';
      if (g('aiNormalizeSummary'))   g('aiNormalizeSummary').style.display = 'none';
      if (g('aiFilterSummary'))      g('aiFilterSummary').style.display = 'none';
      if (g('btnDownloadValidationKeep')) g('btnDownloadValidationKeep').style.display = 'none';
      if (g('btnDownloadAiStep')) {
        g('btnDownloadAiStep').textContent = 'Download';
        g('btnDownloadAiStep').style.display = 'none';
      }
      if (g('pipelineReport'))       g('pipelineReport').style.display = 'none';
      if (g('pipelineContent'))      g('pipelineContent').innerHTML = '';
      window._normalizeOutput = null;
      refreshRunStatusBar();
      return;
    }
    // Restore input
    _aiReviewInput.cleaned = s.cleaned;
    _aiReviewInput.removed = s.removed;
    _aiReviewInput.source  = s.source;
    if (g('aiSourceStatus')) { g('aiSourceStatus').textContent = s.sourceText; g('aiSourceStatus').style.color = s.sourceColor; }
    const inputEl2 = document.getElementById('aiImportInput');
    if (inputEl2) inputEl2.value = '';
    const titleEl = document.querySelector('#aiImportZone .upload-title');
    if (titleEl && s.uploadTitle) titleEl.textContent = s.uploadTitle;
    // Restore progress panel
    if (g('aiRevProgress'))     g('aiRevProgress').style.display = s.progDisplay;
    if (g('aiRevProgressFill')) g('aiRevProgressFill').style.width = s.fillWidth;
    if (g('aiRevStage'))        g('aiRevStage').innerHTML = s.stageHTML;
    if (g('aiRevPct'))          g('aiRevPct').textContent = s.pctText;
    if (g('aiRevLog'))          g('aiRevLog').innerHTML = s.logHTML;
    // Restore scoring summary
    if (g('aiScoringSummary'))  g('aiScoringSummary').style.display = s.summaryDisplay;
    if (g('scoringStatTotal'))  g('scoringStatTotal').textContent = s.statTotal;
    if (g('scoringStatScored')) g('scoringStatScored').textContent = s.statScored;
    if (g('scoringStatKeep'))   g('scoringStatKeep').textContent = s.statKeep;
    if (g('scoringStatDrop'))   g('scoringStatDrop').textContent = s.statDrop;
    // Restore pipeline report
    if (g('pipelineReport'))    g('pipelineReport').style.display = s.pipelineDisplay;
    if (g('pipelineContent'))   g('pipelineContent').innerHTML = s.pipelineHTML;
    // Restore normalize + filter summary panels
    if (g('aiNormalizeSummary'))  g('aiNormalizeSummary').style.display = s.normSummaryDisplay || 'none';
    if (g('aiFilterSummary'))     g('aiFilterSummary').style.display = s.filterSummaryDisplay || 'none';
    if (g('aiSummaryTitle'))      g('aiSummaryTitle').textContent = s.summaryTitle || 'AI Summary';
    if (g('aiSummaryLabel1'))     g('aiSummaryLabel1').textContent = s.summaryLabel1 || 'Total';
    if (g('aiSummaryLabel2'))     g('aiSummaryLabel2').textContent = s.summaryLabel2 || 'Problem';
    if (g('aiSummaryLabel3'))     g('aiSummaryLabel3').textContent = s.summaryLabel3 || 'Solution';
    if (g('aiSummaryLabel4'))     g('aiSummaryLabel4').textContent = s.summaryLabel4 || 'Cached';
    if (g('aiSummaryLabel5'))     g('aiSummaryLabel5').textContent = s.summaryLabel5 || 'Compression';
    if (g('aiSummaryLabel6'))     g('aiSummaryLabel6').textContent = s.summaryLabel6 || 'QA Invalid';
    if (g('normStatTotal'))       g('normStatTotal').textContent = s.summaryVal1 || '0';
    if (g('normStatProbChanged')) g('normStatProbChanged').textContent = s.summaryVal2 || '—';
    if (g('normStatSolChanged'))  g('normStatSolChanged').textContent = s.summaryVal3 || '—';
    if (g('normStatCached'))      g('normStatCached').textContent = s.summaryVal4 || '0';
    if (g('normStatCompression')) g('normStatCompression').textContent = s.summaryVal5 || '—';
    if (g('normStatInvalid'))     g('normStatInvalid').textContent = s.summaryVal6 || '—';
    if (g('btnDownloadAiStep')) {
      g('btnDownloadAiStep').textContent = s.downloadLabel || 'Download';
      g('btnDownloadAiStep').style.display = s.downloadDisplay || 'none';
    }
    if (g('btnDownloadValidationKeep')) g('btnDownloadValidationKeep').style.display = s.validationKeepDisplay || 'none';
    const runScopeEl = document.querySelector(`input[name="aiRunScope"][value="${s.runScope || 'total'}"]`);
    if (runScopeEl) runScopeEl.checked = true;
    const testSizeEl = document.getElementById('aiTestSize');
    if (testSizeEl) testSizeEl.value = s.testSize || '30';
    const ticketIdsEl = document.getElementById('aiTicketIds');
    if (ticketIdsEl) ticketIdsEl.value = s.ticketIds || '';
    const parallelEl = document.getElementById('aiNormalizeParallel');
    if (parallelEl) parallelEl.value = s.parallel || '10';
    toggleAiRunScopeInputs();
    window._normalizeOutput = _cloneAiValue(s.pipelineOutput || null);

    // If this step is actively running right now, keep its historical state in memory
    // but do not show stale summary/download UI until the job stops or completes.
    if (_aiRunning && activeAiPipelineJobId && activeAiPipelineMode === mode) {
      hideAiCurrentResultUi();
      if (g('aiRevProgress')) g('aiRevProgress').style.display = '';
    }

    refreshRunStatusBar();
  }

  function getAiPipelineCachedCount(mode) {
    if (mode === 'normalize') return typeof getNormalizeCachedCount === 'function' ? getNormalizeCachedCount() : 0;
    const state = _modeStates[mode];
    const raw = state?.cachedCount || '0';
    const n = parseInt(String(raw).replace(/[^\d-]/g, ''), 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  async function selectAiMode(el) {
    const val = el.dataset.value;
    const wrap = el.closest('.ai-dropdown');
    // Save current mode state before switching
    const prevMode = document.getElementById('aiReviewMode').value;
    if (prevMode !== val) _saveModeState(prevMode);
    // Update hidden select
    document.getElementById('aiReviewMode').value = val;
    // Update button text
    document.getElementById('aiReviewModeBtn').innerHTML = el.textContent + ' <svg width="10" height="10" viewBox="0 0 10 10" style="margin-left:4px;opacity:0.4;"><path d="M2 3.5L5 6.5L8 3.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    // Update active state
    wrap.querySelectorAll('.ai-dropdown-item').forEach(i => i.classList.remove('active'));
    el.classList.add('active');
    // Close dropdown
    wrap.classList.remove('open');
    // Save to localStorage
    localStorage.setItem('aiReviewMode', val);
    // Restore new mode state
    await _ensureModeStateLoaded(val);
    _restoreModeState(val);
    // Trigger mode change (toolbar visibility etc.)
    toggleAiReviewMode();
  }
  const AI_PIPELINE_JOB_KEY = 'kbActiveAiJob';
  const AI_PIPELINE_RESUME_TOAST_KEY = 'kbAiResumeToastSeen';
  const AI_PIPELINE_INPUT_KEY = 'kbActiveAiInput';
  const AI_PIPELINE_AUTORUN_KEY = 'kbAiAutoPipeline';
  const AI_PIPELINE_ORDER = ['distill', 'scoring', 'normalize', 'generalize', 'extraction', 'validation'];
  var activeAiPipelineJobId = null;
  var activeAiPipelineMode = '';
  var aiJobPollWorker = null;

  // Auto-select a capable model for diagnostics / scoring / extraction modes
  function preferDiagnosticsModel() {
    const sel = document.getElementById('aiModel');
    if (!sel) return;
    // If model already looks like a large model, leave it alone
    const cur = (sel.value || '').toLowerCase();
    if (cur.includes('32b') || cur.includes('70b') || cur.includes('72b')) return;
    // Try to pick the largest available option
    const opts = Array.from(sel.options).map(o => o.value);
    const preferred = opts.find(o => /32b|70b|72b/i.test(o));
    if (preferred) sel.value = preferred;
  }

  // Restore scoring options from localStorage
  (function restoreScoringOptions() {
    // Restore AI mode dropdown
    const savedMode = localStorage.getItem('aiReviewMode');
    if (savedMode) {
      document.getElementById('aiReviewMode').value = savedMode;
      const item = document.querySelector(`.ai-dropdown-item[data-value="${savedMode}"]`);
      if (item) {
        document.querySelectorAll('.ai-dropdown-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        document.getElementById('aiReviewModeBtn').innerHTML = item.textContent + ' <svg width="10" height="10" viewBox="0 0 10 10" style="margin-left:4px;opacity:0.4;"><path d="M2 3.5L5 6.5L8 3.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      }
      toggleAiReviewMode();
    }
    const savedScope = localStorage.getItem('aiScoreScope');
    if (savedScope) {
      const radio = document.querySelector(`input[name="aiScoreScope"][value="${savedScope}"]`);
      if (radio) radio.checked = true;
    }
    const savedSize = localStorage.getItem('aiScoreTestSize');
    if (savedSize) document.getElementById('aiScoreTestSize').value = savedSize;
    const savedParallel = localStorage.getItem('aiScoringParallel');
    if (savedParallel) document.getElementById('aiScoringParallel').value = savedParallel;
    const savedNormParallel = localStorage.getItem('aiNormalizeParallel');
    if (savedNormParallel) document.getElementById('aiNormalizeParallel').value = savedNormParallel;
    const savedNormTarget = localStorage.getItem('aiNormalizeTarget');
    if (savedNormTarget) document.getElementById('aiNormalizeTarget').value = savedNormTarget;
    const savedRunScope = localStorage.getItem('aiRunScope');
    if (savedRunScope) {
      document.querySelectorAll('input[name="aiRunScope"]').forEach(r => { r.checked = (r.value === savedRunScope); });
    }
    const savedTestSize = localStorage.getItem('aiTestSize');
    if (savedTestSize) document.getElementById('aiTestSize').value = savedTestSize;
    const savedTicketIds = localStorage.getItem('aiTicketIds');
    if (savedTicketIds) document.getElementById('aiTicketIds').value = savedTicketIds;
    toggleAiRunScopeInputs();
    // ── Cleanup stale / orphaned localStorage keys ───────────────────────
    ['diagCacheMap', 'diagCachedResults', 'diagLastPrompt', 'kb_selected_prompt_id'].forEach(k => localStorage.removeItem(k));
    // Fix stale ollamaActivePreset if it points to a removed preset
    const _validPresets = ['normalize', 'generalize', 'diagnostic', 'scoring', 'assistant', 'llm_eval'];
    const _activePreset = localStorage.getItem('ollamaActivePreset');
    if (_activePreset && !_validPresets.includes(_activePreset)) localStorage.setItem('ollamaActivePreset', 'normalize');
  })();

  function isPipelineMode(mode) {
    return AI_PIPELINE_ORDER.includes(mode);
  }

  function getNextPipelineMode(mode) {
    const idx = AI_PIPELINE_ORDER.indexOf(mode);
    if (idx === -1 || idx >= AI_PIPELINE_ORDER.length - 1) return '';
    return AI_PIPELINE_ORDER[idx + 1];
  }

  function isAiAutoPipelineEnabled() {
    const el = document.getElementById('aiAutoPipeline');
    return !!(el && el.checked);
  }

  function syncAiAutoPipelineUi(mode) {
    const wrap = document.getElementById('aiAutoPipelineWrap');
    const input = document.getElementById('aiAutoPipeline');
    if (!wrap || !input) return;
    const enabledForMode = isPipelineMode(mode) && mode !== 'validation';
    wrap.style.display = enabledForMode ? 'flex' : 'none';
    if (!enabledForMode) input.checked = false;
  }

  function setAiAutoPipelineSetting(enabled) {
    try {
      localStorage.setItem(AI_PIPELINE_AUTORUN_KEY, enabled ? '1' : '0');
      localStorage.removeItem('aiAutoPipeline');
    } catch (_) {}
  }

  function restoreAiAutoPipelineSetting() {
    const input = document.getElementById('aiAutoPipeline');
    if (!input) return;
    const stored = localStorage.getItem(AI_PIPELINE_AUTORUN_KEY);
    const legacy = localStorage.getItem('aiAutoPipeline');
    const enabled = (stored === '1') || (!stored && legacy === '1');
    input.checked = enabled;
    if (!stored && legacy !== null) setAiAutoPipelineSetting(enabled);
    const mode = document.getElementById('aiReviewMode')?.value || 'diagnostics';
    syncAiAutoPipelineUi(mode);
  }

  async function maybeAutoContinueAiPipeline(completedMode) {
    if (!isAiAutoPipelineEnabled()) return false;
    const nextMode = getNextPipelineMode(completedMode);
    if (!nextMode) return false;
    _saveModeState(completedMode);
    clearAiPipelineMemory();
    activeAiPipelineMode = nextMode;
    setAiModeUi(nextMode);
    showToast(`${getAiModeLabel(completedMode).replace('Run ','')} complete — starting ${getAiModeLabel(nextMode).replace('Run ','')}`);
    await startAiBackendJob(nextMode);
    return true;
  }

  restoreAiAutoPipelineSetting();

  function getAiPipelineMemory() {
    try {
      const raw = localStorage.getItem(AI_PIPELINE_JOB_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function saveAiPipelineMemory(job) {
    if (!job?.id) return;
    activeAiPipelineJobId = job.id;
    activeAiPipelineMode = job.mode || activeAiPipelineMode || '';
    try {
      localStorage.setItem(AI_PIPELINE_JOB_KEY, JSON.stringify({
        id: activeAiPipelineJobId,
        mode: activeAiPipelineMode,
        source: _aiReviewInput.source || '',
        savedAt: new Date().toISOString()
      }));
    } catch (_) {}
  }

  function clearAiPipelineMemory() {
    activeAiPipelineJobId = null;
    activeAiPipelineMode = '';
    try { localStorage.removeItem(AI_PIPELINE_JOB_KEY); } catch (_) {}
  }

  async function ensureNoStaleAiPipelineJob() {
    if (!activeAiPipelineJobId) return true;
    try {
      const res = await fetch(`${KB_BASE}/ai-jobs/${activeAiPipelineJobId}`);
      if (!res.ok) {
        clearAiPipelineMemory();
        return true;
      }
      const job = await res.json();
      if (!job || !['queued', 'running', 'stopping'].includes(job.status)) {
        clearAiPipelineMemory();
        return true;
      }
      return false;
    } catch (_) {
      clearAiPipelineMemory();
      return true;
    }
  }

  function detachActiveAiPipelineJob(stopRemote = false) {
    AI_REVIEWER.aborted = false;
    if (stopRemote && activeAiPipelineJobId) {
      fetch(`${KB_BASE}/ai-jobs/${activeAiPipelineJobId}/stop`, { method: 'POST' }).catch(() => {});
    }
    stopAiJobPolling();
    clearAiPipelineMemory();
    clearAiInputSnapshot();
    setAiRunning(false, getAiModeLabel(document.getElementById('aiReviewMode')?.value));
  }

  function saveAiInputSnapshot() {
    try {
      localStorage.setItem(AI_PIPELINE_INPUT_KEY, JSON.stringify({
        cleaned: _aiReviewInput.cleaned || [],
        removed: _aiReviewInput.removed || [],
        source: _aiReviewInput.source || '',
        savedAt: new Date().toISOString()
      }));
    } catch (_) {}
  }

  function restoreAiInputSnapshot() {
    try {
      const raw = localStorage.getItem(AI_PIPELINE_INPUT_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!Array.isArray(data.cleaned) || !data.cleaned.length) return false;
      _aiReviewInput.cleaned = data.cleaned;
      _aiReviewInput.removed = Array.isArray(data.removed) ? data.removed : [];
      _aiReviewInput.source = data.source || 'restored ai dataset';
      const statusEl = document.getElementById('aiSourceStatus');
      if (statusEl) {
        statusEl.textContent = `Loaded ${_aiReviewInput.cleaned.length.toLocaleString()} entries from ${_aiReviewInput.source}`;
        statusEl.style.color = 'var(--text2)';
      }
      const titleEl = document.querySelector('#aiImportZone .upload-title');
      if (titleEl) {
        titleEl.textContent = _aiReviewInput.source || 'Restored AI Review input';
      }
      refreshRunStatusBar();
      refreshScoringStatusBar();
      return true;
    } catch (_) {
      return false;
    }
  }

  function clearAiInputSnapshot() {
    try { localStorage.removeItem(AI_PIPELINE_INPUT_KEY); } catch (_) {}
  }

  function maybeShowAiResumeToast(job) {
    if (!job?.id) return;
    const resumed = Array.isArray(job.logs) && job.logs.some((l) => String(l.message || '').includes('Backend restarted — resuming job from persisted state'));
    if (!resumed) return;
    const key = `${job.id}:restart`;
    try {
      const seen = localStorage.getItem(AI_PIPELINE_RESUME_TOAST_KEY);
      if (seen === key) return;
      localStorage.setItem(AI_PIPELINE_RESUME_TOAST_KEY, key);
    } catch (_) {}
    showToast('Resumed after server restart');
  }

  function createAiJobPollWorker() {
    const code = `let t=null;self.onmessage=function(e){if(e.data==='start'){if(t)clearInterval(t);t=setInterval(()=>self.postMessage('tick'),1500)}else if(e.data==='stop'){if(t){clearInterval(t);t=null}}};`;
    const worker = new Worker(URL.createObjectURL(new Blob([code], { type:'application/javascript' })));
    worker.onmessage = () => pollAiPipelineJob();
    return worker;
  }

  function startAiJobPolling() {
    if (aiJobPollWorker) aiJobPollWorker.postMessage('stop');
    else aiJobPollWorker = createAiJobPollWorker();
    aiJobPollWorker.postMessage('start');
  }

  function stopAiJobPolling() {
    if (aiJobPollWorker) aiJobPollWorker.postMessage('stop');
  }

  function setAiModeUi(mode) {
    const modeSelect = document.getElementById('aiReviewMode');
    if (!modeSelect || !mode) return;
    modeSelect.value = mode;
    try { localStorage.setItem('aiReviewMode', mode); } catch (_) {}
    const item = document.querySelector(`.ai-dropdown-item[data-value="${mode}"]`);
    if (item) {
      document.querySelectorAll('.ai-dropdown-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      document.getElementById('aiReviewModeBtn').innerHTML = item.textContent + ' <svg width="10" height="10" viewBox="0 0 10 10" style="margin-left:4px;opacity:0.4;"><path d="M2 3.5L5 6.5L8 3.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    }
    toggleAiReviewMode();
  }

  function getAiJobDatasetOrToast() {
    if (!_aiReviewInput.cleaned && (DEEP_CLEAN.cleanedData?.length || QA_PIPELINE.cleanedData?.length)) aiReviewFromQa();
    if (!_aiReviewInput.cleaned || !_aiReviewInput.cleaned.length) {
      showToast('No data loaded. Upload a file or run QA Clean first.');
      return null;
    }
    return _aiReviewInput.cleaned;
  }

  function getAiModeLabel(mode) {
    if (mode === 'diagnostics') return 'Run AI Diagnostics';
    if (mode === 'distill') return 'Run AI Distill';
    if (mode === 'scoring') return 'Run AI Filter';
    if (mode === 'normalize') return 'Run AI Normalize';
    if (mode === 'generalize') return 'Run AI Generalize';
    if (mode === 'extraction') return 'Run AI Extraction';
    if (mode === 'validation') return 'Run AI Validation';
    return 'Run AI Review';
  }

  function buildAiJobRequest(mode) {
    const sourceDataset = getAiJobDatasetOrToast();
    if (!sourceDataset) return null;

    const connMode = document.getElementById('aiConnMode').value;
    const apiUrl = connMode === 'proxy'
      ? `${window.location.origin}/ollama`
      : document.getElementById('aiApiUrl').value.trim();

    const config = {
      apiUrl,
      model: document.getElementById('aiModel').value,
      batchSize: parseInt(document.getElementById('aiBatchSize')?.value || '8', 10) || 8,
      parallel: parseInt(document.getElementById(mode === 'scoring' ? 'aiScoringParallel' : 'aiNormalizeParallel')?.value || '5', 10) || 5,
      normTarget: document.getElementById('aiNormalizeTarget')?.value || 'problem',
      customPrompt: document.getElementById('diagCustomPrompt')?.value || '',
      scope: 'total',
      testSize: 0,
      ticketIds: [],
      includeRemoved: false
    };

    if (mode === 'normalize' || mode === 'generalize' || mode === 'extraction' || mode === 'validation' || mode === 'diagnostics') {
      config.scope = document.querySelector('input[name="aiRunScope"]:checked')?.value || 'total';
      config.testSize = Math.max(1, parseInt(document.getElementById('aiTestSize')?.value || '30', 10));
      config.ticketIds = parseAiTicketIds(document.getElementById('aiTicketIds')?.value || '');
    }
    if (mode === 'scoring') {
      config.scope = document.querySelector('input[name="aiScoreScope"]:checked')?.value || 'total';
      config.testSize = Math.max(1, parseInt(document.getElementById('aiScoreTestSize')?.value || '300', 10));
    }
    if (mode === 'diagnostics') {
      config.includeRemoved = document.getElementById('aiRunShowRemoved')?.checked === true;
    }

    let dataset = [...sourceDataset];
    if (config.scope === 'test' && config.testSize > 0 && dataset.length > config.testSize) {
      dataset = dataset.slice(0, config.testSize);
    }
    if (config.scope === 'ids') {
      if (!config.ticketIds.length) {
        showToast('Enter one or more ticket IDs.');
        return null;
      }
      const wanted = new Set(config.ticketIds.map(String));
      dataset = dataset.filter(entry => wanted.has(String(entry?.ticket_id ?? '')));
      if (!dataset.length) {
        showToast('None of the ticket IDs matched the current dataset.');
        return null;
      }
    }

    let removed = mode === 'diagnostics' ? (_aiReviewInput.removed || []) : [];
    if (mode === 'diagnostics' && config.includeRemoved && config.scope === 'test' && config.testSize > 0 && removed.length > config.testSize) {
      removed = removed.slice(0, config.testSize);
    }
    if (mode === 'diagnostics' && config.includeRemoved && config.scope === 'ids' && removed.length) {
      const wanted = new Set(config.ticketIds.map(String));
      removed = removed.filter(entry => wanted.has(String(entry?.ticket_id ?? '')));
    }

    return {
      mode,
      dataset,
      removed,
      source: _aiReviewInput.source || 'uploaded dataset',
      config
    };
  }

  function parseAiTicketIds(raw) {
    return String(raw || '')
      .split(/[\s,]+/)
      .map(s => s.trim())
      .filter(Boolean)
      .filter((id, idx, arr) => arr.indexOf(id) === idx);
  }

  function toggleAiRunScopeInputs() {
    const scope = document.querySelector('input[name="aiRunScope"]:checked')?.value || 'total';
    const testInput = document.getElementById('aiTestSize');
    const idsInput = document.getElementById('aiTicketIds');
    if (testInput) {
      testInput.style.display = scope === 'test' ? '' : 'none';
    }
    if (idsInput) {
      idsInput.style.display = scope === 'ids' ? '' : 'none';
    }
  }

  function setAiSummaryCard(opts = {}) {
    const title = document.getElementById('aiSummaryTitle');
    const labels = [
      document.getElementById('aiSummaryLabel1'),
      document.getElementById('aiSummaryLabel2'),
      document.getElementById('aiSummaryLabel3'),
      document.getElementById('aiSummaryLabel4'),
      document.getElementById('aiSummaryLabel5'),
      document.getElementById('aiSummaryLabel6')
    ];
    const values = [
      document.getElementById('normStatTotal'),
      document.getElementById('normStatProbChanged'),
      document.getElementById('normStatSolChanged'),
      document.getElementById('normStatCached'),
      document.getElementById('normStatCompression'),
      document.getElementById('normStatInvalid')
    ];
    if (title) title.textContent = opts.title || 'AI Summary';
    (opts.labels || []).forEach((label, idx) => { if (labels[idx]) labels[idx].textContent = label; });
    (opts.values || []).forEach((value, idx) => { if (values[idx]) values[idx].textContent = value; });
    const downloadBtn = document.getElementById('btnDownloadAiStep');
    if (downloadBtn) {
      downloadBtn.textContent = opts.downloadLabel || 'Download';
      downloadBtn.style.display = '';
    }
  }

  function hideAiCurrentResultUi() {
    const summaryEl = document.getElementById('aiNormalizeSummary');
    const scoringSummaryEl = document.getElementById('aiScoringSummary');
    const filterSummaryEl = document.getElementById('aiFilterSummary');
    const diagReportEl = document.getElementById('aiDiagReport');
    const downloadBtn = document.getElementById('btnDownloadAiStep');
    const keepBtn = document.getElementById('btnDownloadValidationKeep');
    if (summaryEl) summaryEl.style.display = 'none';
    if (scoringSummaryEl) scoringSummaryEl.style.display = 'none';
    if (filterSummaryEl) filterSummaryEl.style.display = 'none';
    if (diagReportEl) diagReportEl.style.display = 'none';
    if (downloadBtn) downloadBtn.style.display = 'none';
    if (keepBtn) keepBtn.style.display = 'none';
  }

  function hideAiActiveModeResultUiIfRunning(mode) {
    if (_aiRunning && activeAiPipelineJobId && activeAiPipelineMode === mode) {
      hideAiCurrentResultUi();
      const progPanel = document.getElementById('aiRevProgress');
      if (progPanel) progPanel.style.display = '';
    }
  }

  function renderAiJobLogs(logs) {
    const logEl = document.getElementById('aiRevLog');
    if (!logEl) return;
    logEl.innerHTML = (logs || []).map(l => {
      const tag = (l.level || 'info').toLowerCase();
      const tagClass = tag === 'error' || tag === 'remove'
        ? 'remove'
        : tag === 'warn' || tag === 'edit'
          ? 'rescue'
          : 'info';
      const time = l.time
        ? new Date(l.time).toLocaleTimeString('en-US', { hour12: false })
        : new Date().toLocaleTimeString('en-US', { hour12: false });
      return `<div class="qa-log-entry"><span class="qa-log-time">${time}</span><span class="qa-log-tag ${tagClass}">${escHtml(tag)}</span><span class="qa-log-msg">${escHtml(l.message || '')}</span></div>`;
    }).join('');
    logEl.scrollTop = logEl.scrollHeight;
  }

  function updateAiJobUi(job) {
    const progPanel = document.getElementById('aiRevProgress');
    const fill = document.getElementById('aiRevProgressFill');
    const stage = document.getElementById('aiRevStage');
    const pct = document.getElementById('aiRevPct');
    if (['queued', 'running', 'stopping'].includes(job?.status || '')) {
      hideAiCurrentResultUi();
    }
    if (progPanel) progPanel.style.display = '';
    const progress = Math.max(0, Math.min(100, parseInt(job?.progress || 0, 10) || 0));
    if (fill) fill.style.width = `${progress}%`;
    if (pct) pct.textContent = `${progress}%`;
    if (stage) stage.textContent = job?.stage || 'Working...';
    const cachedN = document.getElementById('aiRunStatCachedN');
    if (cachedN && ['normalize', 'generalize', 'extraction', 'validation'].includes(job?.mode || '')) {
      const restoredLog = [...(job?.logs || [])].reverse().find((l) => /Cache restored:\s+\d+/.test(String(l.message || '')));
      if (restoredLog) {
        const m = String(restoredLog.message || '').match(/Cache restored:\s+(\d+)/);
        if (m) cachedN.textContent = Number(m[1]).toLocaleString();
      }
    }
    renderAiJobLogs(job?.logs || []);
  }

  function renderNormalizeJobResult(result) {
    const output = Array.isArray(result?.output) ? result.output : [];
    const summary = result?.summary || {};
    window._normalizeOutput = output;
    _aiReviewInput.cleaned = output;
    _aiReviewInput.removed = [];
    _aiReviewInput.source = 'normalized dataset';
    const statusEl = document.getElementById('aiSourceStatus');
    if (statusEl) {
      statusEl.textContent = `Loaded ${output.length.toLocaleString()} normalized entries`;
      statusEl.style.color = 'var(--text2)';
    }
    const titleEl = document.querySelector('#aiImportZone .upload-title');
    if (titleEl) titleEl.textContent = 'Normalized output';
    const summaryEl = document.getElementById('aiNormalizeSummary');
    if (summaryEl) {
      setAiSummaryCard({
        title: 'Normalize Summary',
        labels: ['Total', 'Problem Changed', 'Solution Changed', 'Cached', 'Compression', 'QA Invalid'],
        values: [
          (summary.total || output.length || 0).toLocaleString(),
          (summary.problemChanged || 0).toLocaleString(),
          (summary.solutionChanged || 0).toLocaleString(),
          (summary.restoredFromCache || 0).toLocaleString(),
          '—',
          '—'
        ],
        downloadLabel: 'Download Normalized'
      });
      summaryEl.style.display = '';
    }
    const keepBtn = document.getElementById('btnDownloadValidationKeep');
    if (keepBtn) keepBtn.style.display = 'none';
    saveAiInputSnapshot();
    refreshRunStatusBar();
  }

  function renderGeneralizeJobResult(result) {
    const output = Array.isArray(result?.output) ? result.output : [];
    const summary = result?.summary || {};
    window._normalizeOutput = output;
    _aiReviewInput.cleaned = output;
    _aiReviewInput.removed = [];
    _aiReviewInput.source = 'generalized dataset';
    const statusEl = document.getElementById('aiSourceStatus');
    if (statusEl) {
      statusEl.textContent = `Loaded ${output.length.toLocaleString()} generalized entries`;
      statusEl.style.color = 'var(--text2)';
    }
    const titleEl = document.querySelector('#aiImportZone .upload-title');
    if (titleEl) titleEl.textContent = 'Generalized output';
    const summaryEl = document.getElementById('aiNormalizeSummary');
    if (summaryEl) {
      setAiSummaryCard({
        title: 'Generalize Summary',
        labels: ['Total', 'Problem Changed', 'Solution Changed', 'Cached', 'Version', 'QA Invalid'],
        values: [
          (summary.total || output.length || 0).toLocaleString(),
          (summary.problemChanged || 0).toLocaleString(),
          (summary.solutionChanged || 0).toLocaleString(),
          (summary.restoredFromCache || 0).toLocaleString(),
          summary.generalizationVersion || '—',
          '—'
        ],
        downloadLabel: 'Download Generalized'
      });
      summaryEl.style.display = '';
    }
    const keepBtn = document.getElementById('btnDownloadValidationKeep');
    if (keepBtn) keepBtn.style.display = 'none';
    saveAiInputSnapshot();
    refreshRunStatusBar();
  }

  function renderExtractionJobResult(result) {
    const output = Array.isArray(result?.output) ? result.output : [];
    const summary = result?.summary || {};
    window._normalizeOutput = output;
    _aiReviewInput.cleaned = output;
    _aiReviewInput.removed = [];
    _aiReviewInput.source = 'extracted dataset';
    const statusEl = document.getElementById('aiSourceStatus');
    if (statusEl) {
      statusEl.textContent = `Loaded ${output.length.toLocaleString()} extracted entries`;
      statusEl.style.color = 'var(--text2)';
    }
    const titleEl = document.querySelector('#aiImportZone .upload-title');
    if (titleEl) titleEl.textContent = 'Extracted output';
    const summaryEl = document.getElementById('aiNormalizeSummary');
    if (summaryEl) {
      setAiSummaryCard({
        title: 'Extraction Summary',
        labels: ['Total', 'Extracted', 'Action Steps', 'Cached', 'Root Cause', 'Keywords'],
        values: [
          (summary.total || output.length || 0).toLocaleString(),
          (summary.extracted || 0).toLocaleString(),
          (summary.withActionSteps || 0).toLocaleString(),
          (summary.restoredFromCache || 0).toLocaleString(),
          (summary.withRootCause || 0).toLocaleString(),
          (summary.withKeywords || 0).toLocaleString()
        ],
        downloadLabel: 'Download Extracted'
      });
      summaryEl.style.display = '';
    }
    const keepBtn = document.getElementById('btnDownloadValidationKeep');
    if (keepBtn) keepBtn.style.display = 'none';
    const cachedN = document.getElementById('aiRunStatCachedN');
    if (cachedN) cachedN.textContent = (summary.restoredFromCache || 0).toLocaleString();
    saveAiInputSnapshot();
    refreshRunStatusBar();
  }

  function renderValidationJobResult(result) {
    const output = Array.isArray(result?.output) ? result.output : [];
    const summary = result?.summary || {};
    window._normalizeOutput = output;
    _aiReviewInput.cleaned = output;
    _aiReviewInput.removed = [];
    _aiReviewInput.source = 'validated dataset';
    const statusEl = document.getElementById('aiSourceStatus');
    if (statusEl) {
      statusEl.textContent = `Loaded ${output.length.toLocaleString()} validated entries`;
      statusEl.style.color = 'var(--text2)';
    }
    const titleEl = document.querySelector('#aiImportZone .upload-title');
    if (titleEl) titleEl.textContent = 'Validated output';
    const summaryEl = document.getElementById('aiNormalizeSummary');
    if (summaryEl) {
      setAiSummaryCard({
        title: 'Validation Summary',
        labels: ['Total', 'Keep', 'Review', 'Drop', 'Reclassify', 'Cached'],
        values: [
          (summary.total || output.length || 0).toLocaleString(),
          (summary.keep || 0).toLocaleString(),
          (summary.review || 0).toLocaleString(),
          (summary.drop || 0).toLocaleString(),
          (summary.reclassify || 0).toLocaleString(),
          ((summary.qaLocked || 0) + (summary.qaSkipped || 0)).toLocaleString()
        ],
        downloadLabel: 'Download Validated'
      });
      summaryEl.style.display = '';
    }
    const keepBtn = document.getElementById('btnDownloadValidationKeep');
    if (keepBtn) keepBtn.style.display = '';
    saveAiInputSnapshot();
    refreshRunStatusBar();
  }

  function renderScoringJobResult(result) {
    const output = Array.isArray(result?.output) ? result.output : [];
    window._scoringOutput = output;
    _aiReviewInput.cleaned = output;
    _scoringImportedState = null;
    const scoredEntries = output.filter(e => e.ai_scoring);
    const keptEntries = scoredEntries.filter(e => e.ai_scoring.keep);
    const droppedEntries = scoredEntries.filter(e => !e.ai_scoring.keep);
    renderScoringReport({
      total: output.length,
      scored: scoredEntries.length,
      kept: keptEntries.length,
      dropped: droppedEntries.length,
      errors: result?.summary?.errors || 0,
      seconds: result?.summary?.seconds || '0.0'
    });
    saveAiInputSnapshot();
    refreshScoringStatusBar();
  }

  function renderDiagnosticsJobResult(result) {
    if (!result?.report) return;
    _diagReportJson = result.report;
    _diagReportText = formatDiagnosticsReport(result.report);
    _diagCachedCount = result.report?.dataset_summary?.total_entries || 0;
    saveDiagCache(_diagReportJson, _diagReportText, _diagCachedCount);
    renderDiagMarkdown(_diagReportText);
    const reportEl = document.getElementById('aiDiagReport');
    if (reportEl) reportEl.style.display = '';
    refreshRunStatusBar();
  }

  async function applyAiJobResult(job) {
    setAiModeUi(job.mode);
    const res = await fetch(`${KB_BASE}/ai-jobs/${job.id}/result`);
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Failed to load AI job result');
    if (job.mode === 'normalize') renderNormalizeJobResult(result);
    else if (job.mode === 'generalize') renderGeneralizeJobResult(result);
    else if (job.mode === 'extraction') renderExtractionJobResult(result);
    else if (job.mode === 'validation') renderValidationJobResult(result);
    else if (job.mode === 'scoring') renderScoringJobResult(result);
    else if (job.mode === 'diagnostics') renderDiagnosticsJobResult(result);
    _saveModeState(job.mode);
  }

  async function pollAiPipelineJob() {
    if (!activeAiPipelineJobId) return;
    try {
      const res = await fetch(`${KB_BASE}/ai-jobs/${activeAiPipelineJobId}`);
      const job = await res.json();
      if (!res.ok) throw new Error(job.error || 'Failed to poll AI job');
      maybeShowAiResumeToast(job);
      updateAiJobUi(job);
      if (['queued', 'running'].includes(job.status)) {
        setAiRunning(true);
        return;
      }
      if (job.status === 'stopping') {
        setAiStopping();
        return;
      }
      stopAiJobPolling();
      if (job.status === 'completed') {
        await applyAiJobResult(job);
        const continued = await maybeAutoContinueAiPipeline(job.mode);
        if (continued) return;
        showToast(`${job.mode} complete`);
      } else if (job.status === 'stopped') {
        // Backend saves result even on stop — load it so user can still download
        try { await applyAiJobResult(job); } catch (_) {}
        showToast(`${job.mode} stopped — partial results available for download`);
      } else if (job.status === 'error') {
        showToast(`${job.mode} failed: ${job.error || 'Unknown error'}`);
      }
      clearAiPipelineMemory();
      setAiRunning(false, getAiModeLabel(job.mode));
    } catch (err) {
      stopAiJobPolling();
      setAiRunning(false, getAiModeLabel(activeAiPipelineMode));
      showToast(err.message || 'AI job poll failed');
    }
  }

  async function startAiBackendJob(mode) {
    const canStartFresh = await ensureNoStaleAiPipelineJob();
    if (!canStartFresh && activeAiPipelineJobId) {
      showToast('An AI pipeline job is already running.');
      return;
    }
    if (mode === 'diagnostics' || mode === 'scoring' || mode === 'generalize' || mode === 'extraction' || mode === 'validation') preferDiagnosticsModel();
    const payload = buildAiJobRequest(mode);
    if (!payload) return;
    saveAiInputSnapshot();
    setAiModeUi(mode);
    AI_REVIEWER.aborted = false;
    document.getElementById('aiDiagReport').style.display = 'none';
    hideAiCurrentResultUi();
    document.getElementById('aiRevProgress').style.display = '';
    document.getElementById('aiRevProgressFill').style.width = '2%';
    document.getElementById('aiRevPct').textContent = '2%';
    document.getElementById('aiRevStage').textContent = `Submitting ${mode} job...`;
    document.getElementById('aiRevLog').innerHTML = '';
    setAiRunning(true);
    try {
      const res = await fetch(`${KB_BASE}/ai-jobs/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed to start ${mode}`);
      saveAiPipelineMemory({ id: data.jobId, mode });
      updateAiJobUi({
        progress: 2,
        stage: `${mode} job queued`,
        logs: [{ level: 'info', message: `${mode} job ${data.jobId} queued`, time: new Date().toISOString() }]
      });
      startAiJobPolling();
      pollAiPipelineJob();
    } catch (err) {
      setAiRunning(false, getAiModeLabel(mode));
      showToast(err.message || `Failed to start ${mode}`);
    }
  }

  async function restoreActiveAiPipelineJob() {
    const saved = getAiPipelineMemory();
    if (!saved?.id || !saved?.mode) return;
    restoreAiInputSnapshot();
    activeAiPipelineJobId = saved.id;
    activeAiPipelineMode = saved.mode;
    switchKbView('ai-review');
    setAiModeUi(saved.mode);
    setAiRunning(true);
    hideAiCurrentResultUi();
    document.getElementById('aiRevProgress').style.display = '';
    document.getElementById('aiRevStage').textContent = `Reconnecting to ${saved.mode} job...`;
    showToast('Reconnected to running job');
    startAiJobPolling();
    await pollAiPipelineJob();
  }

  window.addEventListener('pagehide', () => {
    if (activeKbView === 'ai-review') persistCurrentAiReviewState();
  });

  window.addEventListener('beforeunload', () => {
    if (activeKbView === 'ai-review') persistCurrentAiReviewState();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && activeKbView === 'ai-review') {
      persistCurrentAiReviewState();
    }
  });

  // Close dropdown on outside click
  document.addEventListener('click', (e) => {
    document.querySelectorAll('.ai-dropdown.open').forEach(d => {
      if (!d.contains(e.target)) d.classList.remove('open');
    });
  });

  function updateAiStepStrip(mode) {
    document.querySelectorAll('#aiPipelineSteps .ai-step-chip').forEach((chip) => {
      const active = chip.dataset.step === mode;
      chip.style.background = active ? '#111' : '#fff';
      chip.style.color = active ? '#fff' : 'var(--text2)';
      chip.style.borderColor = active ? '#111' : 'var(--border)';
      chip.style.fontWeight = active ? '600' : '500';
    });
  }

  function toggleAiReviewMode() {
    const mode = document.getElementById('aiReviewMode').value;
    const label = getAiModeLabel(mode);
    if (!_aiRunning) setAiRunning(false, label);
    if (mode === 'diagnostics' || mode === 'distill' || mode === 'scoring' || mode === 'generalize' || mode === 'extraction' || mode === 'validation') preferDiagnosticsModel();
    updateAiStepStrip(mode);
    syncAiAutoPipelineUi(mode);
    const sourceBtn = document.getElementById('btnAiFromQa');
    if (sourceBtn) {
      if (mode === 'validation') sourceBtn.textContent = 'Use Extracted Output';
      else if (mode === 'extraction') sourceBtn.textContent = 'Use Generalized Output';
      else if (mode === 'generalize') sourceBtn.textContent = 'Use Previous Step Output';
      else if (mode === 'normalize') sourceBtn.textContent = 'Use Previous Step Output';
      else if (mode === 'scoring') sourceBtn.textContent = 'Use Distilled Output';
      else if (mode === 'distill') sourceBtn.textContent = 'Use QA Clean Output';
      else sourceBtn.textContent = 'Use Previous Step Output';
    }

    // Toggle toolbar sections based on mode
    const isScoring = mode === 'scoring';
    // Diagnostics toolbar
    document.getElementById('aiDiagStatusBar').style.display = isScoring ? 'none' : 'flex';
    document.getElementById('aiDiagDivider1').style.display = isScoring ? 'none' : '';
    document.getElementById('aiDiagOptions').style.display = isScoring ? 'none' : 'flex';
    // Scoring toolbar
    document.getElementById('aiScoringStatusBar').style.display = isScoring ? 'flex' : 'none';
    document.getElementById('aiScoringDivider1').style.display = isScoring ? '' : 'none';
    document.getElementById('aiScoringOptions').style.display = isScoring ? 'flex' : 'none';
    // Normalize mode: swap Removed+Score → Compression
    const isNormalize = mode === 'distill' || mode === 'normalize' || mode === 'generalize' || mode === 'extraction' || mode === 'validation';
    const isValidation = mode === 'validation';
    const isExtraction = mode === 'extraction';
    const isGeneralize = mode === 'generalize';
    const _rmWrap = document.getElementById('aiRunStatRemoved');
    if (_rmWrap) _rmWrap.style.display = isNormalize ? 'none' : '';
    const _rmCbWrap = document.getElementById('aiRunShowRemovedWrap');
    if (_rmCbWrap) _rmCbWrap.style.display = isNormalize ? 'none' : '';
    const _normParallelWrap = document.getElementById('aiNormalizeParallelWrap');
    if (_normParallelWrap) _normParallelWrap.style.display = isNormalize ? 'flex' : 'none';
    const _normTargetWrap = document.getElementById('aiNormalizeTargetWrap');
    if (_normTargetWrap) _normTargetWrap.style.display = (isValidation || isExtraction || isGeneralize) ? 'none' : 'flex';
    const _scoreWrap = document.getElementById('aiRunStatScoreWrap');
    if (_scoreWrap) _scoreWrap.style.display = isNormalize ? 'none' : '';
    const _comprWrap = document.getElementById('aiRunStatCompressionWrap');
    if (_comprWrap) _comprWrap.style.display = isNormalize ? '' : 'none';

    // Hide summary panels not belonging to the current mode
    const _normSummary = document.getElementById('aiNormalizeSummary');
    if (_normSummary) _normSummary.style.display = isNormalize ? _normSummary.style.display : 'none';
    const _validationKeepBtn = document.getElementById('btnDownloadValidationKeep');
    if (_validationKeepBtn) _validationKeepBtn.style.display = (mode === 'validation' && Array.isArray(window._normalizeOutput) && window._normalizeOutput.length) ? '' : 'none';
    const downloadBtn = document.getElementById('btnDownloadAiStep');
    if (downloadBtn && _normSummary) {
      if (mode === 'generalize') downloadBtn.textContent = 'Download Generalized';
      else if (mode === 'extraction') downloadBtn.textContent = 'Download Extracted';
      else if (mode === 'validation') downloadBtn.textContent = 'Download Validated';
      else downloadBtn.textContent = 'Download Normalized';
    }

    // Toggle result sections visibility
    const diagSections = ['aiDiagPromptEditor', 'aiDiagHistory', 'aiDiagReport', 'aiDiagCompare'];
    const scoringSections = [];
    const filterSections = [];
    // Hide all mode-specific sections first
    [...diagSections, ...scoringSections, ...filterSections].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });

    // Refresh scoring stats if switching to scoring
    if (isScoring) refreshScoringStatusBar();
    else refreshRunStatusBar();

    hideAiActiveModeResultUiIfRunning(mode);
  }

  function refreshRunStatusBar() {
    // Shared AI pipeline status bar
    const dataset = _aiReviewInput.cleaned || [];
    const _curMode = document.getElementById('aiReviewMode')?.value;
    const isPipelineMode = ['distill', 'normalize', 'generalize', 'extraction', 'validation'].includes(_curMode);
    // Only use localStorage fallback in diagnostics-like modes (not pipeline modes — no file = 0)
    const savedCount = isPipelineMode ? 0 : parseInt(localStorage.getItem('diagLastEntryCount') || '0');
    const total = dataset.length || savedCount;

    const entriesN = document.getElementById('aiRunStatEntriesN');
    if (entriesN) entriesN.textContent = total.toLocaleString();

    const removedWrap = document.getElementById('aiRunStatRemoved');
    const removedN = document.getElementById('aiRunStatRemovedN');
    const removedArr = _aiReviewInput.removed || [];
    const savedRemoved = parseInt(localStorage.getItem('diagLastRemovedCount') || '0');
    const removedTotal = removedArr.length || savedRemoved;
    if (removedWrap && removedN) {
      const _curMode = document.getElementById('aiReviewMode').value;
      if (['normalize', 'generalize', 'extraction', 'validation'].includes(_curMode)) {
        removedWrap.style.display = 'none';
      } else if (removedTotal > 0) {
        removedN.textContent = removedTotal.toLocaleString();
        removedWrap.style.display = '';
      } else {
        removedWrap.style.display = 'none';
      }
    }

    const cachedN = document.getElementById('aiRunStatCachedN');
    const _modeForCache = document.getElementById('aiReviewMode').value;
    const cached = (['normalize', 'generalize', 'extraction', 'validation'].includes(_modeForCache))
      ? getAiPipelineCachedCount(_modeForCache)
      : (typeof getAnalyzedCount === 'function' ? getAnalyzedCount() : 0);
    if (cachedN) cachedN.textContent = (cached ?? 0).toLocaleString();

    const _curMode2 = document.getElementById('aiReviewMode').value;
    const scoreWrapEl = document.getElementById('aiRunStatScoreWrap');
    if (scoreWrapEl) scoreWrapEl.style.display = (_curMode2 === 'normalize' || _curMode2 === 'generalize' || _curMode2 === 'extraction' || _curMode2 === 'validation') ? 'none' : '';
    const comprWrapEl = document.getElementById('aiRunStatCompressionWrap');
    if (comprWrapEl) comprWrapEl.style.display = (_curMode2 === 'normalize' || _curMode2 === 'generalize' || _curMode2 === 'extraction' || _curMode2 === 'validation') ? '' : 'none';
    const scoreN = document.getElementById('aiRunStatScoreN');
    if (scoreN && _curMode2 !== 'normalize' && _curMode2 !== 'generalize' && _curMode2 !== 'extraction' && _curMode2 !== 'validation') {
      if (typeof _diagHistory !== 'undefined' && _diagHistory.length > 0 && _diagHistory[0].score > 0) {
        scoreN.textContent = _diagHistory[0].score;
      } else {
        scoreN.textContent = '—';
      }
    }
  }

  function refreshScoringStatusBar() {
    const dataset = _aiReviewInput.cleaned || [];
    const total = dataset.length;
    const scoredEntries = dataset.filter(e => e.ai_scoring);
    const keptEntries = scoredEntries.filter(e => e.ai_scoring.keep);
    const removedEntries = scoredEntries.filter(e => !e.ai_scoring.keep);
    const rate = scoredEntries.length > 0 ? Math.round((keptEntries.length / scoredEntries.length) * 100) : 0;

    // Count cached: only reflect actual localStorage cache (not in-memory ai_scoring from uploaded files)
    const isTest = document.querySelector('input[name="aiScoreScope"][value="test"]')?.checked;
    if (!_scoringCacheKey && dataset.length) {
      _scoringCacheKey = scoringFingerprint(_aiReviewInput.source, dataset);
    }
    const cachedN = _scoringImportedState
      ? 0
      : ((!isTest && _scoringCacheKey) ? loadScoringProgress().size : 0);

    // Show Rerun Audit button only when all entries are fully scored
    const rerunBtn = document.getElementById('btnRerunAudit');
    if (rerunBtn) rerunBtn.style.display = (total > 0 && scoredEntries.length === total) ? '' : 'none';

    const ticketsN = document.getElementById('aiScoreStatTicketsN');
    const cachedEl = document.getElementById('aiScoreStatCachedN');
    const scoredN = document.getElementById('aiScoreStatScoredN');
    const keepN = document.getElementById('aiScoreStatKeepN');
    const removeN = document.getElementById('aiScoreStatRemoveN');
    const rateN = document.getElementById('aiScoreStatRateN');

    if (ticketsN) ticketsN.textContent = total.toLocaleString();
    if (cachedEl) cachedEl.textContent = cachedN.toLocaleString();
    if (scoredN) scoredN.textContent = scoredEntries.length.toLocaleString();
    if (keepN) keepN.textContent = keptEntries.length.toLocaleString();
    if (removeN) removeN.textContent = removedEntries.length.toLocaleString();
    if (rateN) rateN.textContent = scoredEntries.length > 0 ? rate + '%' : '—';
  }

  var _diagReportText = '';
  var _diagReportJson = null;
  var _diagCachedCount = 0;
  var _diagCacheKey = '';   // current dataset fingerprint

  const DIAG_HISTORY_KEY = 'diagHistory';
  const DIAG_HISTORY_MAX = 5;

  function getAnalyzedCount() { return _diagCachedCount; }

  // Generate a fingerprint for a dataset (source name + entry count + sample IDs)
  function diagFingerprint(source, entries) {
    if (!entries || !entries.length) return '';
    const sampleIds = entries.slice(0, 5).map(e => e.ticket_id || '').join(',');
    return `${source || 'unknown'}|${entries.length}|${sampleIds}`;
  }

  function loadDiagHistory() {
    try {
      const raw = localStorage.getItem(DIAG_HISTORY_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (_) { return []; }
  }

  function saveDiagHistory(history) {
    try { localStorage.setItem(DIAG_HISTORY_KEY, JSON.stringify(history)); } catch (_) {}
  }

  function saveDiagCache(reportJson, reportText, processedCount) {
    _diagCachedCount = processedCount;
    if (!_diagCacheKey) return;
    const history = loadDiagHistory();
    // Remove existing entry with same key
    const filtered = history.filter(h => h.key !== _diagCacheKey);
    // Add new entry at front
    filtered.unshift({
      key: _diagCacheKey,
      reportJson, reportText, processedCount,
      ts: Date.now(),
      source: _aiReviewInput.source || 'unknown'
    });
    // Keep only last N
    saveDiagHistory(filtered.slice(0, DIAG_HISTORY_MAX));
  }

  function findDiagCache(fingerprint) {
    if (!fingerprint) return null;
    const history = loadDiagHistory();
    return history.find(h => h.key === fingerprint) || null;
  }

  // Called when dataset changes (file upload or QA output load)
  function checkDiagCache() {
    const entries = _aiReviewInput.cleaned || [];
    const source = _aiReviewInput.source || '';
    _diagCacheKey = diagFingerprint(source, entries);
    const cached = findDiagCache(_diagCacheKey);
    if (cached && cached.reportJson) {
      _diagReportJson = cached.reportJson;
      _diagReportText = cached.reportText || '';
      _diagCachedCount = cached.processedCount || 0;
      // Restore report UI (only show if currently in diagnostics mode)
      const reportEl = document.getElementById('aiDiagReport');
      const currentMode = document.getElementById('aiReviewMode')?.value;
      if (reportEl && _diagReportText) { renderDiagMarkdown(_diagReportText); reportEl.style.display = currentMode === 'diagnostics' ? '' : 'none'; }
      AI_REVIEWER.addLog('info', `Restored cached diagnostics for "${source}" (${_diagCachedCount} entries)`);
    } else {
      _diagReportJson = null;
      _diagReportText = '';
      _diagCachedCount = 0;
    }
    refreshRunStatusBar();
  }

  // Restore most recent cache on page load
  (function restoreDiagCache() {
    const history = loadDiagHistory();
    if (!history.length) return;
    const latest = history[0];
    _diagReportJson = latest.reportJson;
    _diagReportText = latest.reportText || '';
    _diagCachedCount = latest.processedCount || 0;
    _diagCacheKey = latest.key || '';
    setTimeout(() => {
      if (_diagReportText) {
        const reportEl = document.getElementById('aiDiagReport');
        const currentMode = document.getElementById('aiReviewMode')?.value;
        if (reportEl) { renderDiagMarkdown(_diagReportText); reportEl.style.display = currentMode === 'diagnostics' ? '' : 'none'; }
      }
      refreshRunStatusBar();
    }, 300);
  })();

  // ── Diag prompt / history / compare helpers ──────────────────────────
  function resetDiagPrompt() {
    const ta = document.getElementById('diagCustomPrompt');
    if (ta) { ta.value = ''; showToast('Prompt reset to default'); }
  }

  function clearDiagHistory(silent = false) {
    saveDiagHistory([]);
    const listEl = document.getElementById('diagHistoryList');
    if (listEl) listEl.innerHTML = '';
    const histEl = document.getElementById('aiDiagHistory');
    if (histEl) histEl.style.display = 'none';
    const compareEl = document.getElementById('aiDiagCompare');
    if (compareEl) compareEl.style.display = 'none';
    const btn = document.getElementById('btnDiagCompare');
    if (btn) btn.disabled = true;
    if (!silent) showToast('Diagnostics history cleared');
  }

  function toggleDiagCompare() {
    const compareEl = document.getElementById('aiDiagCompare');
    if (!compareEl) return;
    const isVisible = compareEl.style.display !== 'none';
    if (isVisible) { compareEl.style.display = 'none'; return; }
    // Populate selects with history entries
    const history = loadDiagHistory();
    if (history.length < 2) { showToast('Need at least 2 history entries to compare'); return; }
    const selA = document.getElementById('diagCompareA');
    const selB = document.getElementById('diagCompareB');
    if (!selA || !selB) return;
    const opts = history.map((h, i) => {
      const d = new Date(h.ts).toLocaleDateString();
      return `<option value="${i}">${d} — ${h.source || 'unknown'} (${h.processedCount || 0} entries)</option>`;
    }).join('');
    selA.innerHTML = opts;
    selB.innerHTML = opts;
    if (history.length > 1) selB.selectedIndex = 1;
    compareEl.style.display = '';
    renderDiagComparison();
  }

  function closeDiagCompare() {
    const compareEl = document.getElementById('aiDiagCompare');
    if (compareEl) compareEl.style.display = 'none';
  }

  function renderDiagComparison() {
    const selA = document.getElementById('diagCompareA');
    const selB = document.getElementById('diagCompareB');
    const bodyEl = document.getElementById('diagCompareBody');
    if (!selA || !selB || !bodyEl) return;
    const history = loadDiagHistory();
    const entryA = history[parseInt(selA.value)] || null;
    const entryB = history[parseInt(selB.value)] || null;
    const renderSide = (entry) => {
      if (!entry) return '<div style="color:var(--text3); font-size:12px;">No data</div>';
      const d = new Date(entry.ts).toLocaleString();
      const header = `<div style="font-size:10px; color:var(--text3); margin-bottom:6px;">${entry.source || 'unknown'} · ${d} · ${entry.processedCount || 0} entries</div>`;
      if (entry.reportText) {
        const div = document.createElement('div');
        div.innerHTML = header + '<div class="diag-markdown">' + (typeof marked !== 'undefined' ? marked.parse(entry.reportText) : entry.reportText.replace(/\n/g,'<br>')) + '</div>';
        return div.innerHTML;
      }
      return header + '<div style="color:var(--text3); font-size:12px;">No report text available</div>';
    };
    bodyEl.innerHTML = `<div style="overflow:auto; max-height:500px; font-size:12px;">${renderSide(entryA)}</div><div style="overflow:auto; max-height:500px; font-size:12px;">${renderSide(entryB)}</div>`;
  }

  function getDiagnosticsBatchConfig() {
    const isQwen = typeof AI_REVIEWER !== 'undefined' && AI_REVIEWER && AI_REVIEWER.isQwenModel && AI_REVIEWER.isQwenModel();
    return isQwen
      ? {
          longThreshold: 1600,
          targetChars: 5200,
          maxBatchSize: 4,
          minBatchSize: 1,
          subjectMax: 180,
          problemMax: 700,
          solutionMax: 700,
          rootCauseMax: 220,
          signalMax: 500
        }
      : {
          longThreshold: 2200,
          targetChars: 14000,
          maxBatchSize: 25,
          minBatchSize: 5,
          subjectMax: 220,
          problemMax: 1200,
          solutionMax: 1200,
          rootCauseMax: 300,
          signalMax: 1000
        };
  }

  function estimateDiagEntryChars(entry) {
    const cfg = getDiagnosticsBatchConfig();
    const signalText = JSON.stringify(entry.technical_signals || {});
    return (
      String(entry.ticket_id || '').length +
      String(entry.issue_type || '').length +
      Math.min(String(entry.problem || '').length, cfg.problemMax) +
      Math.min(String(entry.solution || '').length, cfg.solutionMax) +
      Math.min(String(entry.root_cause || '').length, cfg.rootCauseMax) +
      Math.min(String(entry.source_subject || '').length, cfg.subjectMax) +
      Math.min(signalText.length, cfg.signalMax)
    );
  }

  function normalizeDiagText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function formatDiagDuration(ms) {
    if (!Number.isFinite(ms) || ms < 0) return '—';
    const totalSeconds = Math.round(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, '0')}s` : `${seconds}s`;
  }

  function buildDiagnosticsBatchPrompt(entries) {
    const cfg = getDiagnosticsBatchConfig();
    const lines = ['Analyze these support ticket entries one by one and return one JSON object per line.\n'];
    entries.forEach((e, i) => {
      lines.push(`--- ENTRY ${i + 1} ---`);
      lines.push(`ID: ${e.ticket_id}`);
      if (e.issue_type) lines.push(`Issue Type: ${normalizeDiagText(e.issue_type)}`);
      if (e.source_subject) lines.push(`Subject: ${normalizeDiagText(e.source_subject).substring(0, cfg.subjectMax)}`);
      lines.push(`Problem: ${normalizeDiagText(e.problem).substring(0, cfg.problemMax)}`);
      lines.push(`Solution: ${normalizeDiagText(e.solution).substring(0, cfg.solutionMax)}`);
      if (e.root_cause) lines.push(`Root Cause: ${normalizeDiagText(e.root_cause).substring(0, cfg.rootCauseMax)}`);
      if (e.technical_signals && Object.keys(e.technical_signals).length) {
        lines.push(`Technical Signals: ${JSON.stringify(e.technical_signals).substring(0, cfg.signalMax)}`);
      }
      lines.push('');
    });
    lines.push(`Return exactly ${entries.length} JSON objects, one per line.`);
    return lines.join('\n');
  }

  function splitDiagnosticsBatches(entries) {
    const { longThreshold, targetChars, maxBatchSize, minBatchSize } = getDiagnosticsBatchConfig();
    const batches = [];
    let current = [];
    let currentChars = 0;

    entries.forEach(entry => {
      const chars = estimateDiagEntryChars(entry);
      if (chars >= longThreshold) {
        if (current.length) {
          batches.push(current);
          current = [];
          currentChars = 0;
        }
        batches.push([entry]);
        return;
      }
      const nextSize = current.length + 1;
      const wouldOverflow = currentChars + chars > targetChars;
      if (current.length && (nextSize > maxBatchSize || (wouldOverflow && current.length >= minBatchSize))) {
        batches.push(current);
        current = [];
        currentChars = 0;
      }
      current.push(entry);
      currentChars += chars;
    });
    if (current.length) batches.push(current);
    return batches;
  }

  function parseDiagnosticsBatchResponse(text) {
    const rows = [];
    if (!text || !text.trim()) return rows;

    // Strip markdown code blocks: ```json ... ``` or ``` ... ```
    let cleaned = text.replace(/```(?:json)?\s*\n?/gi, '').replace(/```/g, '');
    // Strip residual <think> tags
    cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<\/?think>/g, '');

    // Strategy 1: Try parsing as a JSON array first
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try {
        const arr = JSON.parse(arrayMatch[0]);
        if (Array.isArray(arr)) {
          arr.forEach(item => { if (item && item.id) rows.push(item); });
          if (rows.length) return rows;
        }
      } catch (_) {}
    }

    // Strategy 2: Line-by-line — find JSON objects on each line
    cleaned.split('\n').forEach(line => {
      let trimmed = line.trim();
      if (!trimmed) return;
      // Strip leading numbering like "1. " or "- " or "* "
      trimmed = trimmed.replace(/^[\d]+[\.\)]\s*/, '').replace(/^[-*]\s*/, '');
      // Find first { and last } on the line
      const start = trimmed.indexOf('{');
      const end = trimmed.lastIndexOf('}');
      if (start < 0 || end <= start) return;
      const candidate = trimmed.slice(start, end + 1);
      try {
        const parsed = JSON.parse(candidate);
        if (parsed && parsed.id) rows.push(parsed);
      } catch (_) {}
    });
    if (rows.length) return rows;

    // Strategy 3: Brace-depth extraction for multi-line JSON objects
    let depth = 0, inStr = false, esc = false, objStart = -1;
    for (let i = 0; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (esc) { esc = false; continue; }
      if (ch === '\\' && inStr) { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === '{') { if (depth === 0) objStart = i; depth++; }
      else if (ch === '}') {
        depth--;
        if (depth === 0 && objStart >= 0) {
          try {
            const parsed = JSON.parse(cleaned.slice(objStart, i + 1));
            if (parsed && parsed.id) rows.push(parsed);
          } catch (_) {}
          objStart = -1;
        }
      }
    }
    return rows;
  }

  function canonicalSignal(value) {
    const raw = normalizeDiagText(value);
    if (!raw) return '';
    const lower = raw.toLowerCase();
    if (/^v?\d+(?:\.\d+){1,3}$/i.test(raw)) return '';
    const map = [
      [/team\s*viewer/i, 'TeamViewer'],
      [/data\s*synchronizer|datasynchroizer/i, 'DataSyncAgent'],
      [/publisher(\s*pro)?/i, 'Publisher'],
      [/player(\s*pro)?(\s*2015)?/i, 'Player'],
      [/22\s*miles|secureview/i, 'SecureView'],
      [/\bkiosks?\b/i, 'Kiosk'],
      [/\.net\s*framework|dotnet/i, '.NET Framework'],
      [/\.swf\b|swf\s*file/i, 'SWF File'],
      [/adobe\s*illustrator/i, 'Adobe Illustrator'],
      [/3dmapviewer\.installer|3d\s*map\s*viewer/i, '3D Map Viewer'],
      [/3d\s*extrusion/i, '3D Extrusion'],
      [/touch\s*directory\s*manager\s*4/i, 'TouchDirectoryManager4'],
      [/\bcms\b/i, 'CMS'],
      [/\bapi\b/i, 'API']
    ];
    for (const [re, name] of map) {
      if (re.test(lower)) return name;
    }
    return raw
      .replace(/\s+/g, ' ')
      .replace(/\b([a-z])/g, s => s.toUpperCase());
  }

  function canonicalPattern(value) {
    const normalized = normalizeDiagText(value);
    if (!normalized) return null;
    const raw = normalized.split(/[;,|]/)[0].trim().toLowerCase();
    if (!raw) return null;
    const map = [
      [/\blicen(s|c)e|renew|expir|activation/i, 'license issues'],
      [/\btimeout|timed out|latency|connection/i, 'network timeout'],
      [/\bpublish|schedule|playlist|workflow/i, 'publish workflow gap'],
      [/\blogin|password|credential|access denied|unauthorized/i, 'authentication failure'],
      [/\bcrash|freeze|hang/i, 'software instability'],
      [/\boffline|disconnect/i, 'connectivity loss'],
      [/\bversion|compatib|upgrade|downgrade|framework\b/i, 'software version incompatibility'],
      [/\bdownload\b|email delivery|link failure/i, 'download delivery failure'],
      [/\bfont\b|\bsize\b|display setting/i, 'display configuration issue'],
      [/\binstall|installation incomplete|missing component/i, 'incomplete software installation'],
      [/\bmanual|guide|documentation|how to\b/i, 'documentation gap'],
      [/\bcalendar\b.*\bmerge\b|\bmerge\b.*\bcalendar\b/i, 'calendar integration limitation'],
      [/\bhardware\b|\bremote access\b|\bon-site\b/i, 'hardware access dependency'],
      [/\bcustomi[sz]|option|turn-by-turn|direction/i, 'feature limitation']
    ];
    for (const [re, name] of map) {
      if (re.test(raw)) return name;
    }
    return raw
      .replace(/[^a-z0-9\s-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || null;
  }

  function canonicalNoisePattern(value) {
    const raw = normalizeDiagText(value).toLowerCase();
    if (!raw) return '';
    const map = [
      [/\bthanks\b|thank you|support!?$/i, 'courtesy language'],
      [/\battached?\b|attachment|screenshot|see below|see attached/i, 'attachment reference'],
      [/\bmaintenance\b|are you guys doing maintenance/i, 'service-status question'],
      [/\bjeff\b|\[[^\]]+\]/i, 'internal note fragment'],
      [/\bagence\b|\badresse\b|phone|fax|regards|best regards|sent from/i, 'signature block'],
      [/\bhi\b|\bhello\b|\bdear\b|\ball,\b/i, 'greeting line']
    ];
    for (const [re, name] of map) {
      if (re.test(raw)) return name;
    }
    if (raw.length > 40) return 'long conversational fragment';
    return raw;
  }

  function canonicalWeakPattern(value) {
    const raw = normalizeDiagText(value).toLowerCase();
    if (!raw) return '';
    const map = [
      [/\bplease follow below\b|please see below|below step/i, 'procedural instruction'],
      [/\bsorry for the confusion\b|confusion/i, 'clarification language'],
      [/\bguide\b|user guide|manual/i, 'documentation request'],
      [/\bupgrade\b|very soon we will upgrade/i, 'upgrade notice'],
      [/\bneed your support\b|support needed|technical point/i, 'support request'],
      [/\bcan\b|\bhow to\b|\bhelp\b/i, 'underspecified request']
    ];
    for (const [re, name] of map) {
      if (re.test(raw)) return name;
    }
    if (raw.length > 50) return 'low-information fragment';
    return raw;
  }

  function aggregateCount(items, limit = 12) {
    return Array.from(items.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      .slice(0, limit);
  }

  function normalizePrimaryCategory(value, entry = {}) {
    const raw = normalizeDiagText(value);
    if (raw) return raw;
    const fallback = normalizeDiagText(entry.issue_type || '').replace(/_/g, ' ');
    if (fallback) {
      return fallback.split(/\s+/).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
    }
    return 'Support Workflow';
  }

  function buildFallbackDiagnosticsRow(entry) {
    const hasSolution = normalizeDiagText(entry.solution).length > 20;
    const hasClearProblem = normalizeDiagText(entry.problem).length > 25;
    const signalValues = Object.values(entry.technical_signals || {}).flat().map(canonicalSignal).filter(Boolean);
    const bucketMap = {
      installation_issue: 'installation',
      software_version_compatibility: 'compatibility',
      software_update_request: 'workflow',
      display_configuration_issue: 'configuration',
      display_connection_issue: 'troubleshooting',
      license_activation_issue: 'workflow',
      account_access_issue: 'configuration',
      remote_access_support: 'troubleshooting',
      screen_flickering: 'software_behavior',
      system_configuration: 'configuration',
      license_issue: 'workflow',
      map_rendering: 'software_behavior',
      software_crash: 'software_behavior',
      api_integration: 'compatibility',
      network_issue: 'troubleshooting',
      player_offline: 'troubleshooting',
      content_issue: 'workflow',
      data_sync_issue: 'workflow'
    };
    return {
      id: String(entry.ticket_id),
      primary_category: normalizePrimaryCategory('', entry),
      normalized_signals: signalValues,
      root_cause_pattern: canonicalPattern(entry.root_cause || entry.issue_type || ''),
      noise_patterns: [],
      weak_patterns: hasClearProblem ? [] : ['vague_questions'],
      knowledge_bucket: bucketMap[entry.issue_type] || 'troubleshooting',
      has_solution: hasSolution,
      has_clear_problem: hasClearProblem,
      has_technical_signals: signalValues.length > 0,
      estimated_noise: false
    };
  }

  function computeDiagnosticsScore(summary) {
    const total = Math.max(summary.total_entries || 1, 1);
    const solutionRate = summary.entries_with_solution / total;
    const clearRate = summary.entries_with_clear_problem / total;
    const signalRatio = summary.technical_signal_ratio || 0;
    const noisePenalty = summary.estimated_noise_ratio || 0;
    const score = Math.round((solutionRate * 0.3 + clearRate * 0.3 + signalRatio * 0.3 + (1 - noisePenalty) * 0.1) * 100);
    return Math.max(0, Math.min(100, score));
  }

  function buildDiagnosticsReport(aggregate) {
    const score = computeDiagnosticsScore(aggregate.dataset_summary);
    aggregate.quality_score = score;
    return aggregate;
  }

  function formatDiagnosticsReport(report) {
    const lines = [];
    lines.push('## Dataset Summary');
    lines.push(`- Total Entries: ${report.dataset_summary.total_entries}`);
    lines.push(`- Entries With Solution: ${report.dataset_summary.entries_with_solution}`);
    lines.push(`- Entries Missing Solution: ${report.dataset_summary.entries_missing_solution}`);
    lines.push(`- Entries With Clear Problem: ${report.dataset_summary.entries_with_clear_problem}`);
    lines.push(`- Entries With Vague Problem: ${report.dataset_summary.entries_with_vague_problem}`);
    lines.push(`- Technical Signal Ratio: ${(report.dataset_summary.technical_signal_ratio * 100).toFixed(1)}%`);
    lines.push(`- Estimated Noise Ratio: ${(report.dataset_summary.estimated_noise_ratio * 100).toFixed(1)}%`);
    lines.push('');
    lines.push('## Technical Signals');
    report.technical_signals.forEach(item => lines.push(`- ${item.signal}: ${item.count}`));
    lines.push('');
    lines.push('## Root Cause Patterns');
    report.root_cause_patterns.forEach(item => lines.push(`- ${item.pattern}: ${item.count}`));
    lines.push('');
    lines.push('## Noise Patterns');
    report.noise_patterns.forEach(item => lines.push(`- ${item.pattern}: ${item.count}`));
    lines.push('');
    lines.push('## Weak Patterns');
    report.weak_patterns.forEach(item => lines.push(`- ${item.pattern}: ${item.count}`));
    lines.push('');
    lines.push('## Knowledge Distribution');
    Object.entries(report.knowledge_distribution).forEach(([label, count]) => lines.push(`- ${label}: ${count}`));
    lines.push('');
    lines.push('## Suggested Cleaning Targets');
    lines.push(`- Remove Candidates: ${(report.suggested_cleaning_targets.remove_candidates || []).join(', ') || 'None'}`);
    lines.push(`- Flag Candidates: ${(report.suggested_cleaning_targets.flag_candidates || []).join(', ') || 'None'}`);
    lines.push('');
    lines.push(`## Quality Score\n- ${report.quality_score}/100`);
    return lines.join('\n');
  }

  async function startDiagnostics() {
    if (!_aiReviewInput.cleaned && (DEEP_CLEAN.cleanedData?.length || QA_PIPELINE.cleanedData?.length)) aiReviewFromQa();
    if (!_aiReviewInput.cleaned || !_aiReviewInput.cleaned.length) {
      showToast('No data loaded. Upload a file or run QA Clean first.'); return;
    }
    // Ensure cache key is set for this dataset
    if (!_diagCacheKey) {
      _diagCacheKey = diagFingerprint(_aiReviewInput.source, _aiReviewInput.cleaned);
    }

    setAiRunning(true);

    const connMode = document.getElementById('aiConnMode').value;
    AI_REVIEWER.useProxy = (connMode === 'proxy');
    AI_REVIEWER.proxyBase = window.location.origin;
    AI_REVIEWER.apiUrl = document.getElementById('aiApiUrl').value.trim();
    preferDiagnosticsModel();
    AI_REVIEWER.model = document.getElementById('aiModel').value;
    AI_REVIEWER.aborted = false;

    const progPanel = document.getElementById('aiRevProgress');
    const fill = document.getElementById('aiRevProgressFill');
    const stage = document.getElementById('aiRevStage');
    const pct = document.getElementById('aiRevPct');
    const logEl = document.getElementById('aiRevLog');
    AI_REVIEWER.log = [];
    AI_REVIEWER.onLog = () => {
      logEl.innerHTML = AI_REVIEWER.log.map(l => {
        const tagClass = l.tag === 'error' ? 'remove' : l.tag === 'warn' ? 'rescue' : 'info';
        return `<div class="qa-log-entry"><span class="qa-log-time">${l.t}</span><span class="qa-log-tag ${tagClass}">${l.tag}</span><span class="qa-log-msg">${l.msg}</span></div>`;
      }).join('');
      logEl.scrollTop = logEl.scrollHeight;
    };

    progPanel.style.display = '';
    document.getElementById('aiDiagReport').style.display = 'none';
    logEl.innerHTML = '';
    fill.style.width = '0%';
    stage.textContent = 'Preparing dataset for diagnostics...';
    pct.textContent = '0%';

    const scope = document.querySelector('input[name="aiRunScope"]:checked')?.value || 'total';
    const testSize = Math.max(1, parseInt(document.getElementById('aiTestSize')?.value || '30', 10));
    const includeRemoved = document.getElementById('aiRunShowRemoved')?.checked === true;
    const customPrompt = document.getElementById('diagCustomPrompt')?.value || '';

    const keptEntries = [...(_aiReviewInput.cleaned || [])].map(e => ({ ...e, _source: 'kept' }));
    const removedEntries = includeRemoved ? [...(_aiReviewInput.removed || [])].map(e => ({ ...e, _source: 'removed' })) : [];
    let entries = [...keptEntries, ...removedEntries];
    if (scope === 'test') entries = entries.slice(0, testSize);

    if (!entries.length) {
      showToast('No entries available for diagnostics.');
      setAiRunning(false, 'Run AI Diagnostics');
      return;
    }

    const batches = splitDiagnosticsBatches(entries);
    const activeEndpoint = AI_REVIEWER.useProxy ? `${AI_REVIEWER.proxyBase || window.location.origin}/ollama` : AI_REVIEWER.apiUrl;
    stage.textContent = `Running ${entries.length} entries through ${batches.length} adaptive batches...`;
    fill.style.width = '2%'; pct.textContent = '2%';
    AI_REVIEWER.addLog('info', `Diagnostics target: ${AI_REVIEWER.model} via ${activeEndpoint}`);

    const counts = {
      signals: new Map(),
      causes: new Map(),
      noise: new Map(),
      weak: new Map(),
      buckets: new Map([
        ['troubleshooting', 0],
        ['configuration', 0],
        ['installation', 0],
        ['compatibility', 0],
        ['workflow', 0],
        ['software_behavior', 0]
      ])
    };
    let withSolution = 0;
    let withClearProblem = 0;
    let withTechSignals = 0;
    let withNoise = 0;
    let processed = 0;
    const diagStartedAt = Date.now();
    let completedBatchCount = 0;
    let stageTicker = null;

    const setDiagStage = (prefix, currentBatchIndex = null) => {
      const elapsedMs = Date.now() - diagStartedAt;
      const parts = [`Elapsed ${formatDiagDuration(elapsedMs)}`];
      if (completedBatchCount > 0) {
        const avgBatchMs = elapsedMs / completedBatchCount;
        const remaining = currentBatchIndex == null
          ? Math.max(0, batches.length - completedBatchCount)
          : Math.max(0, batches.length - currentBatchIndex);
        parts.push(`ETA ${formatDiagDuration(avgBatchMs * remaining)}`);
      } else {
        parts.push('ETA estimating...');
      }
      stage.textContent = `${prefix} · ${parts.join(' · ')}`;
    };

    try {
      AI_REVIEWER.addLog('info', `Diagnostics run prepared: ${entries.length} entries, ${batches.length} batches`);
      for (let i = 0; i < batches.length; i++) {
        if (AI_REVIEWER.aborted) break;
        const batch = batches[i];
        const batchPrompt = buildDiagnosticsBatchPrompt(batch);
        const batchSizeLabel = `${batch.length} entries`;
        const batchIds = batch.map(entry => entry.ticket_id).join(', ');

        let responseText = '';
        // Use preset values from Ollama Settings panel; only set num_predict floor
        const presetNumPredict = (typeof getOllamaOptions === 'function' ? getOllamaOptions() : {}).num_predict || 1200;
        const llmOptions = {
          num_predict: Math.max(presetNumPredict, batch.length * 260)
        };
        const batchStartedAt = Date.now();
        AI_REVIEWER.addLog('info', `Diagnostics batch ${i + 1}/${batches.length} started (${batchSizeLabel}, ${batchPrompt.length} chars, num_predict=${llmOptions.num_predict})`);
        AI_REVIEWER.addLog('info', `Diagnostics batch ${i + 1}/${batches.length} ids: ${batchIds}`);
        setDiagStage(`Batch ${i + 1}/${batches.length}: sending ${batchSizeLabel} (${batchPrompt.length} chars) to ${AI_REVIEWER.model}`, i + 1);
        if (stageTicker) clearInterval(stageTicker);
        stageTicker = setInterval(() => {
          setDiagStage(`Batch ${i + 1}/${batches.length}: sending ${batchSizeLabel} (${batchPrompt.length} chars) to ${AI_REVIEWER.model}`, i + 1);
        }, 1000);
        const diagnosticsPrompt = AI_REVIEWER.getDiagnosticsPrompt(customPrompt);
        const preferGenerate = AI_REVIEWER.isQwenModel();

        if (preferGenerate) {
          try {
            responseText = await AI_REVIEWER._tryGenerate(batchPrompt, diagnosticsPrompt, llmOptions);
          } catch (genErr) {
            AI_REVIEWER.addLog('error', `Batch ${i + 1} generate failed: ${genErr.message}`);
            responseText = '';  // will trigger fallback below
          }
        } else {
          try {
            responseText = await AI_REVIEWER._tryChat(batchPrompt, diagnosticsPrompt, llmOptions);
          } catch (chatErr) {
            try {
              responseText = await AI_REVIEWER._tryGenerate(batchPrompt, diagnosticsPrompt, llmOptions);
            } catch (genErr) {
              AI_REVIEWER.addLog('error', `Batch ${i + 1} failed. Chat: ${chatErr.message}. Generate: ${genErr.message}`);
              responseText = '';  // will trigger fallback below
            }
          }
        }

        const parsed = parseDiagnosticsBatchResponse(responseText);
        let completedRows;
        if (!parsed.length) {
          // Batch returned no parseable JSON — log raw response for debugging, then continue
          AI_REVIEWER.addLog('warn', `Batch ${i + 1} returned no parseable JSON — using fallback for ${batch.length} entries`);
          AI_REVIEWER.addLog('warn', `Batch ${i + 1} raw response (first 500 chars): ${(responseText || '(empty)').slice(0, 500)}`);
          completedRows = batch.map(entry => buildFallbackDiagnosticsRow(entry));
        } else {
          const parsedById = new Map(parsed.map(item => [String(item.id), item]));
          completedRows = batch.map(entry => parsedById.get(String(entry.ticket_id)) || buildFallbackDiagnosticsRow(entry));
        }

        completedRows.forEach(item => {
          processed++;
          if (item.has_solution) withSolution++;
          if (item.has_clear_problem) withClearProblem++;
          if (item.has_technical_signals) withTechSignals++;
          if (item.estimated_noise) withNoise++;

          const bucket = ['troubleshooting','configuration','installation','compatibility','workflow','software_behavior'].includes(item.knowledge_bucket)
            ? item.knowledge_bucket
            : 'troubleshooting';
          counts.buckets.set(bucket, (counts.buckets.get(bucket) || 0) + 1);

          (Array.isArray(item.normalized_signals) ? item.normalized_signals : [])
            .map(canonicalSignal)
            .filter(Boolean)
            .forEach(sig => counts.signals.set(sig, (counts.signals.get(sig) || 0) + 1));

          const cause = canonicalPattern(item.root_cause_pattern);
          if (cause) counts.causes.set(cause, (counts.causes.get(cause) || 0) + 1);

          (Array.isArray(item.noise_patterns) ? item.noise_patterns : [])
            .map(canonicalNoisePattern)
            .filter(Boolean)
            .forEach(p => counts.noise.set(p, (counts.noise.get(p) || 0) + 1));

          (Array.isArray(item.weak_patterns) ? item.weak_patterns : [])
            .map(canonicalWeakPattern)
            .filter(Boolean)
            .forEach(p => counts.weak.set(p, (counts.weak.get(p) || 0) + 1));
        });

        if (parsed.length < batch.length) {
          AI_REVIEWER.addLog('warn', `Batch ${i + 1}: ${batch.length - parsed.length} entries used local fallback normalization`);
        }

        completedBatchCount++;
        const batchDurationMs = Date.now() - batchStartedAt;
        if (stageTicker) {
          clearInterval(stageTicker);
          stageTicker = null;
        }
        const progress = Math.round(((i + 1) / batches.length) * 100);
        fill.style.width = `${progress}%`;
        pct.textContent = `${progress}%`;
        setDiagStage(`Batch ${i + 1}/${batches.length} complete — ${processed}/${entries.length} entries aggregated`, i + 1);
        AI_REVIEWER.addLog('info', `Diagnostics batch ${i + 1}/${batches.length} aggregated (${completedRows.length} rows, ${formatDiagDuration(batchDurationMs)})`);
      }

      if (AI_REVIEWER.aborted) {
        if (stageTicker) clearInterval(stageTicker);
        stage.textContent = `Stopped after ${processed}/${entries.length} entries.`;
        // Save partial progress so cached count persists
        if (processed > 0) {
          _diagCachedCount = processed;
          saveDiagCache(_diagReportJson, _diagReportText, processed);
          refreshRunStatusBar();
        }
        showToast('Diagnostics stopped.');
        return;
      }

      const totalEntries = entries.length;
      const report = buildDiagnosticsReport({
        dataset_summary: {
          total_entries: totalEntries,
          entries_with_solution: withSolution,
          entries_missing_solution: totalEntries - withSolution,
          entries_with_clear_problem: withClearProblem,
          entries_with_vague_problem: totalEntries - withClearProblem,
          technical_signal_ratio: totalEntries ? withTechSignals / totalEntries : 0,
          estimated_noise_ratio: totalEntries ? withNoise / totalEntries : 0
        },
        technical_signals: aggregateCount(counts.signals).map(item => ({ signal: item.label, count: item.count })),
        root_cause_patterns: aggregateCount(counts.causes).map(item => ({ pattern: item.label, count: item.count })),
        noise_patterns: aggregateCount(counts.noise).map(item => ({ pattern: item.label, count: item.count })),
        weak_patterns: aggregateCount(counts.weak).map(item => ({ pattern: item.label, count: item.count })),
        knowledge_distribution: Object.fromEntries(counts.buckets.entries()),
        suggested_cleaning_targets: {
          remove_candidates: aggregateCount(counts.noise, 5).map(item => item.label),
          flag_candidates: aggregateCount(counts.weak, 5).map(item => item.label)
        }
      });

      fill.style.width = '100%'; pct.textContent = '100%';
      if (stageTicker) clearInterval(stageTicker);
      stage.textContent = `Diagnostics complete — ${entries.length} entries processed in ${batches.length} batches · Total ${formatDiagDuration(Date.now() - diagStartedAt)}.`;
      AI_REVIEWER.addLog('info', `Diagnostics complete: ${entries.length} entries processed in ${batches.length} batches (${formatDiagDuration(Date.now() - diagStartedAt)})`);

      _diagReportJson = report;
      _diagReportText = formatDiagnosticsReport(report);

      // Persist to localStorage so it survives page refresh
      saveDiagCache(report, _diagReportText, entries.length);
      refreshRunStatusBar();

      const reportEl = document.getElementById('aiDiagReport');
      renderDiagMarkdown(_diagReportText);
      reportEl.style.display = '';
    } catch(e) {
      if (stageTicker) clearInterval(stageTicker);
      showToast(`Diagnostics failed: ${e.message}`);
      stage.textContent = `Error: ${e.message}`;
      AI_REVIEWER.addLog('error', e.message || 'Diagnostics failed');
    } finally {
      if (stageTicker) clearInterval(stageTicker);
      AI_REVIEWER.onLog = null;
      setAiRunning(false, 'Run AI Diagnostics');
    }
  }

  function renderDiagMarkdown(text) {
    const panels = document.getElementById('aiDiagPanels');
    const scoreBar = document.getElementById('diagScoreBar');

    // Try to extract quality score from text
    const scoreMatch = text.match(/quality\s*score[:\s]*(\d+)/i) || text.match(/(\d+)\s*(?:\/\s*100|out of 100)/i);
    if (scoreMatch) {
      const score = parseInt(scoreMatch[1]);
      scoreBar.style.display = 'flex';
      const scoreColor = score >= 70 ? '#34a853' : score >= 40 ? '#f4a900' : '#c33';
      document.getElementById('diagScoreFill').style.width = score + '%';
      document.getElementById('diagScoreFill').style.background = scoreColor;
      document.getElementById('diagScoreVal').textContent = score;
      document.getElementById('diagScoreVal').style.color = scoreColor;
    } else {
      scoreBar.style.display = 'none';
    }

    // Parse markdown into sections by headers (## or ** or numbered top-level)
    const sections = [];
    let currentSection = null;
    const lines = text.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      // Detect headers: ##, **, or lines that are ALL CAPS with 3+ chars
      const h2Match = trimmed.match(/^#{1,3}\s+(.+)/);
      const boldHeader = trimmed.match(/^\*\*([^*]+)\*\*\s*$/);
      const capsHeader = trimmed.match(/^([A-Z][A-Z _\-&]{2,})$/);
      const numberedHeader = trimmed.match(/^(\d+)\.\s+\*\*([^*]+)\*\*/);

      if (h2Match || boldHeader || capsHeader) {
        const title = (h2Match ? h2Match[1] : boldHeader ? boldHeader[1] : capsHeader[1]).replace(/\*\*/g, '').trim();
        currentSection = { title, lines: [] };
        sections.push(currentSection);
      } else if (numberedHeader) {
        currentSection = { title: numberedHeader[2].trim(), lines: [] };
        sections.push(currentSection);
        // Check if there's content after the header on the same line
        const rest = trimmed.substring(trimmed.indexOf('**', trimmed.indexOf('**') + 2) + 2).replace(/^[:\s]+/, '').trim();
        if (rest) currentSection.lines.push(rest);
      } else if (currentSection) {
        currentSection.lines.push(line);
      } else {
        // Content before first header — create an "Overview" section
        if (trimmed) {
          if (!sections.length || sections[0].title !== 'Overview') {
            currentSection = { title: 'Overview', lines: [] };
            sections.unshift(currentSection);
          }
          currentSection.lines.push(line);
        }
      }
    }

    // Render sections as styled cards
    let html = '';
    const sectionColors = ['var(--text)', '#1a73e8', '#c33', '#f4a900', '#34a853', '#7b61ff', '#e67700'];

    sections.forEach((sec, si) => {
      const borderColor = sectionColors[si % sectionColors.length];
      const body = sec.lines.join('\n').trim();
      if (!body && !sec.title) return;

      html += `<div style="background:var(--bg2); border-radius:8px; padding:14px 16px; border-left:3px solid ${borderColor};">`;
      html += `<div style="font-size:13px; font-weight:600; margin-bottom:8px; color:var(--text);">${escHtml(sec.title)}</div>`;

      // Render body: convert markdown-ish content to HTML
      const bodyHtml = renderDiagBody(body);
      html += `<div style="font-size:12px; line-height:1.7; color:var(--text2);">${bodyHtml}</div>`;
      html += `</div>`;
    });

    if (!sections.length) {
      // No sections parsed, show as formatted text
      html = `<div style="background:var(--bg2); border-radius:8px; padding:14px 16px; font-size:12px; line-height:1.7; color:var(--text2); white-space:pre-wrap;">${escHtml(text)}</div>`;
    }

    panels.innerHTML = html;
  }

  /* escHtml provided by shared.js */

  function renderDiagBody(text) {
    const lines = text.split('\n');
    let html = '';
    let inList = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        if (inList) { html += '</div>'; inList = false; }
        continue;
      }

      // Numbered items: "1. **Title**: detail" or "1. text"
      const numItem = trimmed.match(/^(\d+)\.\s+(.+)/);
      // Bullet items: "- text" or "* text" or "• text"
      const bulletItem = trimmed.match(/^[-*•]\s+(.+)/);
      // Sub-bullet: "  - text" or tab-indented
      const subBullet = line.match(/^\s{2,}[-*•]\s+(.+)/);

      if (numItem || bulletItem || subBullet) {
        if (!inList) { html += '<div style="margin:4px 0;">'; inList = true; }
        const content = numItem ? numItem[2] : bulletItem ? bulletItem[1] : subBullet[1];
        const indent = subBullet ? 'padding-left:16px;' : '';
        const prefix = numItem ? `<span style="color:var(--text3); margin-right:4px;">${numItem[1]}.</span>` : '<span style="color:var(--text3); margin-right:4px;">·</span>';
        // Bold parts: **text**
        const rendered = content.replace(/\*\*([^*]+)\*\*/g, '<b style="color:var(--text);">$1</b>');
        html += `<div style="font-size:11px; padding:3px 8px; margin-bottom:2px; background:var(--bg); border-radius:4px; ${indent}">${prefix}${rendered}</div>`;
      } else {
        if (inList) { html += '</div>'; inList = false; }
        // Regular paragraph — render bold
        const rendered = escHtml(trimmed).replace(/\*\*([^*]+)\*\*/g, '<b style="color:var(--text);">$1</b>');
        html += `<div style="margin-bottom:6px;">${rendered}</div>`;
      }
    }
    if (inList) html += '</div>';
    return html;
  }

  function downloadDiagReport(fmt) {
    if (!_diagReportText) { showToast('No report to download.'); return; }
    const date = new Date().toISOString().split('T')[0];
    const isJson = fmt === 'json';
    const payload = isJson && _diagReportJson ? JSON.stringify(_diagReportJson, null, 2) : _diagReportText;
    const blob = new Blob([payload], { type: isJson ? 'application/json' : 'text/plain' });
    const filename = `diagnostics_report_${date}.${isJson ? 'json' : 'txt'}`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click(); URL.revokeObjectURL(a.href);
    showToast('Diagnostics report downloaded.');
  }

  async function startTextNormalize() {
    if (!_aiReviewInput.cleaned && (DEEP_CLEAN.cleanedData?.length || QA_PIPELINE.cleanedData?.length)) aiReviewFromQa();
    if (!_aiReviewInput.cleaned || !_aiReviewInput.cleaned.length) {
      showToast('No data loaded. Upload a file or run QA Clean first.'); return;
    }

    AI_REVIEWER.aborted = false;
    setAiRunning(true);

    const connMode = document.getElementById('aiConnMode').value;
    AI_REVIEWER.useProxy = (connMode === 'proxy');
    AI_REVIEWER.proxyBase = window.location.origin;
    AI_REVIEWER.apiUrl = document.getElementById('aiApiUrl').value.trim();
    AI_REVIEWER.model = document.getElementById('aiModel').value;
    const batchSize = parseInt(document.getElementById('aiBatchSize').value) || 8;

    const progPanel = document.getElementById('aiRevProgress');
    const fill = document.getElementById('aiRevProgressFill');
    const stage = document.getElementById('aiRevStage');
    const pct = document.getElementById('aiRevPct');
    const logEl = document.getElementById('aiRevLog');

    progPanel.style.display = '';
    document.getElementById('aiDiagReport').style.display = 'none';
    logEl.innerHTML = '';
    fill.style.width = '0%';
    pct.textContent = '0%';

    const _isNormTest = document.querySelector('input[name="aiRunScope"][value="test"]')?.checked;
    const normTestSize = Math.max(1, parseInt(document.getElementById('aiTestSize')?.value) || 30);

    let dataset = [..._aiReviewInput.cleaned];
    if (_isNormTest && dataset.length > normTestSize) {
      dataset = dataset.slice(0, normTestSize);
    }

    // ── Phase indicator helpers ──
    const phaseRow = document.getElementById('normPhaseRow');
    if (phaseRow) phaseRow.style.display = 'flex';
    const setNormPhase = (active) => {
      const phases = ['problem', 'solution'];
      const activeIdx = phases.indexOf(active);
      phases.forEach((p, i) => {
        const el = document.getElementById('normPhase_' + p);
        if (!el) return;
        el.className = 'norm-phase-step' + (i < activeIdx ? ' done' : i === activeIdx ? ' active' : '');
      });
    };

    const PARALLEL = Math.max(1, parseInt(document.getElementById('aiNormalizeParallel').value) || 5);

    // ── Cache setup ──
    _normalizeCacheKey = normalizeFingerprint(_aiReviewInput.source, dataset);
    const _cache = _isNormTest ? { problems: new Map(), solutions: new Map(), qaValid: new Map() } : loadNormalizeProgress();
    let cacheHits = 0, solutionCacheHits = 0, qaValidCacheHits = 0;
    // Apply all cached fields to dataset upfront
    const needsProcessing = [];
    for (const e of dataset) {
      const tid = String(e.ticket_id);
      const cachedProblem  = _cache.problems.get(tid);
      const cachedSolution = _cache.solutions.get(tid);
      const cachedQaValid  = _cache.qaValid.get(tid);
      if (cachedProblem)             { e.problem   = cachedProblem;  cacheHits++; }
      if (cachedSolution)            { e.solution  = cachedSolution; solutionCacheHits++; }
      if (cachedQaValid !== undefined) { e.qa_valid = cachedQaValid; qaValidCacheHits++; }
      if (!cachedProblem) needsProcessing.push(e);
    }
    const addLog = (tag, msg) => {
      const t = new Date().toLocaleTimeString('en-US', { hour12: false });
      const tagClass = tag === 'error' ? 'remove' : tag === 'edit' ? 'rescue' : 'info';
      logEl.innerHTML += `<div class="qa-log-entry"><span class="qa-log-time">${t}</span><span class="qa-log-tag ${tagClass}">${tag}</span><span class="qa-log-msg">${msg}</span></div>`;
      logEl.scrollTop = logEl.scrollHeight;
    };

    if (cacheHits > 0)        addLog('info', `Problem cache restored: ${cacheHits} entries skipped`);
    if (solutionCacheHits > 0) addLog('info', `Solution cache restored: ${solutionCacheHits} entries skipped`);
    if (qaValidCacheHits > 0)  addLog('info', `QA validation cache restored: ${qaValidCacheHits} entries skipped`);

    const normTarget = document.getElementById('aiNormalizeTarget')?.value || 'problem';
    const countWords = str => (str || '').trim().split(/\s+/).filter(Boolean).length;
    const t0 = Date.now();
    let totalChanged = 0, totalErrors = 0;

    // ── Generic pass runner ──────────────────────────────────────────────
    const runPass = async (entries, field, systemPrompt, passLabel, useCache) => {
      let totalInputWords = 0, totalOutputWords = 0;
      entries.forEach(e => { totalInputWords += countWords(e[field] || ''); });

      const pendingBatches = [];
      for (let i = 0; i < entries.length; i += batchSize) {
        pendingBatches.push(entries.slice(i, i + batchSize));
      }

      // Reset progress bar at the start of each pass
      fill.style.width = '0%';
      pct.textContent = '0%';
      stage.textContent = `[${passLabel}] Processing ${entries.length} entries in ${pendingBatches.length} batches (parallel=${PARALLEL})...`;
      document.getElementById('aiRunStatCachedN').textContent = cacheHits.toLocaleString();

      let changed = 0, errors = 0, batchesDone = 0;

      const updateProgress = () => {
        const total = pendingBatches.length || 1;
        const p = Math.round((batchesDone / total) * 100);
        fill.style.width = p + '%';
        pct.textContent = p + '%';
        stage.textContent = `[${passLabel}] ${batchesDone}/${pendingBatches.length} batches — ${changed} cleaned`;
        const comprEl = document.getElementById('aiRunStatCompressionN');
        if (comprEl && totalInputWords > 0 && field === 'problem')
          comprEl.textContent = `-${Math.round((1 - totalOutputWords / totalInputWords) * 100)}%`;
      };

      let batchIdx = 0;
      const processBatch = async () => {
        while (batchIdx < pendingBatches.length && !AI_REVIEWER.aborted) {
          const bi = batchIdx++;
          const batch = pendingBatches[bi];
          // Build JSON-keyed prompt so results map back by ticket_id, not array index
          const fieldInstruction = field === 'problem'
            ? `Extract a clean RAG search query for each problem below.\nReturn ONLY a valid JSON object mapping each ticket_id (string key) to its cleaned query. No markdown, no extra text.\nExample input: {"100038":"User asks about X","100110":"Error Y on Z"}\nExample output: {"100038":"X configuration issue","100110":"Y error on Z"}`
            : `Clean each solution below.\nReturn ONLY a valid JSON object mapping each ticket_id (string key) to its cleaned solution. No markdown, no extra text.\nExample input: {"100038":"Hi John, I fixed the server name typo. Let me know!","100110":"We remoted in and changed the setting."}\nExample output: {"100038":"Correct the server name typo in the configuration.","100110":"Change the setting in [location]."}`;
          const inputObj = {};
          batch.forEach(e => { inputObj[String(e.ticket_id)] = (e[field] || '').substring(0, 600); });
          const userPrompt = fieldInstruction + '\n\n' + JSON.stringify(inputObj, null, 2);
          try {
            let responseText = '';
            try { responseText = await AI_REVIEWER._tryChat(userPrompt, systemPrompt); }
            catch (_) { responseText = await AI_REVIEWER._tryGenerate(userPrompt, systemPrompt); }

            // Parse JSON — strip think tags and markdown fences if present
            let jsonText = responseText.trim();
            jsonText = jsonText.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<\/?think>/g, '').trim();
            const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (fenceMatch) jsonText = fenceMatch[1].trim();
            // Fallback: grab first {...} block
            if (!jsonText.startsWith('{')) {
              const objMatch = jsonText.match(/\{[\s\S]*\}/);
              if (objMatch) jsonText = objMatch[0];
            }
            let resultMap;
            try { resultMap = JSON.parse(jsonText); }
            catch (parseErr) {
              // Repair truncated JSON object: cut at last top-level comma, close with }
              let repaired = null;
              try {
                let depth = 0, inStr = false, lastTopComma = -1;
                for (let _i = 0; _i < jsonText.length; _i++) {
                  const _c = jsonText[_i];
                  if (_c === '\\' && inStr) { _i++; continue; }
                  if (_c === '"') inStr = !inStr;
                  if (!inStr) {
                    if (_c === '{' || _c === '[') depth++;
                    else if (_c === '}' || _c === ']') depth--;
                    else if (_c === ',' && depth === 1) lastTopComma = _i;
                  }
                }
                if (lastTopComma > 0) repaired = JSON.parse(jsonText.substring(0, lastTopComma) + '}');
              } catch (_) {}
              if (repaired) {
                resultMap = repaired;
                addLog('warn', `[${passLabel}] Batch ${bi + 1} JSON truncated — recovered ${Object.keys(repaired).length} of ${batch.length} entries`);
              } else {
                addLog('error', `[${passLabel}] Batch ${bi + 1} JSON parse failed: ${parseErr.message}`);
                errors += batch.length;
                batchesDone++; updateProgress(); continue;
              }
            }

            // Fallback: if LLM returned sequential keys {"1":…,"2":…} instead of ticket_ids, remap by order
            const rmKeys = Object.keys(resultMap);
            const isSeqKeys = rmKeys.length > 0 && rmKeys.every((k, i) => String(parseInt(k)) === k && parseInt(k) === i + 1);
            if (isSeqKeys) {
              const remapped = {};
              rmKeys.forEach((k, i) => { if (batch[i]) remapped[String(batch[i].ticket_id)] = resultMap[k]; });
              Object.assign(resultMap, remapped);
              addLog('warn', `[${passLabel}] Batch ${bi + 1} returned sequential keys — remapped by position`);
            }

            let matched = 0;
            for (const entry of batch) {
              const tid = String(entry.ticket_id);
              const result = (resultMap[tid] || resultMap[parseInt(tid)] || '').trim();
              if (!result) continue;
              const idx = dataset.findIndex(e => String(e.ticket_id) === tid);
              if (idx < 0) continue;
              if (result !== (dataset[idx][field] || '')) {
                dataset[idx][field] = result;
                changed++;
                const preview = result.length > 80 ? result.substring(0, 80) + '\u2026' : result;
                addLog('edit', `[${tid}][${field}] \u2192 ${preview}`);
              }
              totalOutputWords += countWords(result);
              matched++;
            }
            if (matched < batch.length) {
              errors += batch.length - matched;
              addLog('warn', `[${passLabel}] Batch ${bi + 1}: ${batch.length - matched} entries got no response`);
            }
          } catch (e) {
            addLog('error', `[${passLabel}] Batch ${bi + 1} failed: ${e.message}`);
            errors += batch.length;
          }
          batchesDone++;
          updateProgress();
          if (useCache && !_isNormTest && batchesDone % 5 === 0) saveNormalizeProgress(dataset);
        }
      };

      if (pendingBatches.length > 0) {
        await Promise.all(Array.from({ length: Math.min(PARALLEL, pendingBatches.length) }, () => processBatch()));
      }
      if (useCache && !_isNormTest) saveNormalizeProgress(dataset);
      totalChanged += changed;
      totalErrors += errors;
      return { changed, errors };
    };

    // ── Run pass(es) based on target ─────────────────────────────────────
    const problemPrompt    = AI_REVIEWER.getNormalizePrompt();
    const solutionPrompt   = AI_REVIEWER.getSolutionCleanPrompt();
    const validationPrompt = AI_REVIEWER.getValidationPrompt();

    // ── Validation pass — runs after clean, checks problem↔solution alignment ──
    let qaInvalidCount = null;  // null = not yet run
    const runValidation = async (entries) => {
      if (!entries.length) return;
      // Skip entries already validated from cache
      const toValidate = entries.filter(e => e.qa_valid === undefined);
      // Count pre-cached invalids
      const preCachedInvalid = entries.filter(e => e.qa_valid === false).length;
      if (toValidate.length < entries.length)
        addLog('info', `QA validation cache: ${entries.length - toValidate.length} entries skipped`);
      if (!toValidate.length) { qaInvalidCount = preCachedInvalid; return; }

      const validBatches = [];
      for (let i = 0; i < toValidate.length; i += batchSize) validBatches.push(toValidate.slice(i, i + batchSize));

      fill.style.width = '0%'; pct.textContent = '0%';
      stage.textContent = `[Validate] Checking ${toValidate.length} QA pairs in ${validBatches.length} batches...`;
      let vDone = 0, vInvalid = preCachedInvalid;

      for (const batch of validBatches) {
        if (AI_REVIEWER.aborted) break;
        const inputObj = {};
        batch.forEach(e => {
          inputObj[String(e.ticket_id)] = {
            issue_type: e.issue_type || '',
            problem: (e.problem || '').substring(0, 500),
            solution: (e.solution || '').substring(0, 500)
          };
        });
        try {
          let responseText = '';
          try { responseText = await AI_REVIEWER._tryChat(JSON.stringify(inputObj, null, 2), validationPrompt); }
          catch (_) { responseText = await AI_REVIEWER._tryGenerate(JSON.stringify(inputObj, null, 2), validationPrompt); }

          let jsonText = responseText.trim();
          const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
          if (fenceMatch) jsonText = fenceMatch[1].trim();
          if (!jsonText.startsWith('{')) { const m = jsonText.match(/\{[\s\S]*\}/); if (m) jsonText = m[0]; }

          let resultMap;
          try { resultMap = JSON.parse(jsonText); } catch (_) { vDone++; continue; }

          for (const entry of batch) {
            const tid = String(entry.ticket_id);
            const verdict = resultMap[tid] ?? resultMap[parseInt(tid)];
            const idx = dataset.findIndex(e => String(e.ticket_id) === tid);
            if (idx < 0) continue;
            const isValid = typeof verdict === 'object' && verdict !== null
              ? verdict.valid !== false
              : verdict !== false;
            const qaReason = typeof verdict === 'object' && verdict !== null
              ? String(verdict.reason || '').trim()
              : '';
            dataset[idx].qa_valid = isValid;
            if (qaReason) dataset[idx].qa_reason = qaReason;
            else delete dataset[idx].qa_reason;
            if (isValid === false) {
              vInvalid++;
              addLog('warn', `[${tid}] QA mismatch${qaReason ? ` — ${qaReason}` : ' — solution may not match problem'}`);
            }
          }
        } catch (e) {
          addLog('error', `[Validate] Batch failed: ${e.message}`);
        }
        vDone++;
        const vp = Math.round((vDone / validBatches.length) * 100);
        fill.style.width = vp + '%'; pct.textContent = vp + '%';
        stage.textContent = `[Validate] ${vDone}/${validBatches.length} batches — ${vInvalid} mismatches`;
        if (!_isNormTest && vDone % 5 === 0) saveNormalizeProgress(dataset);
      }
      if (!_isNormTest) saveNormalizeProgress(dataset);
      qaInvalidCount = vInvalid;
    };

    let _probChanged = null, _solChanged = null;
    try {
      if (normTarget === 'problem' || normTarget === 'both') {
        setNormPhase('problem');
        const r = await runPass(needsProcessing, 'problem', problemPrompt, 'Problem', true);
        _probChanged = r.changed;
      }
      if (!AI_REVIEWER.aborted && (normTarget === 'solution' || normTarget === 'both')) {
        setNormPhase('solution');
        // Skip entries whose solution was restored from cache
        const solutionNeedsProcessing = dataset.filter(e => !_cache.solutions.has(String(e.ticket_id)));
        const r = await runPass(solutionNeedsProcessing, 'solution', solutionPrompt, 'Solution', true);
        _solChanged = r.changed;
      }
      if (!AI_REVIEWER.aborted) {
        let removedGarbage = 0;
        dataset = dataset.filter(entry => {
          const cleanProblem = String(entry.problem || '').trim();
          const cleanSolution = String(entry.solution || '').trim();
          if (QA_PIPELINE.isProblemGarbage(cleanProblem)) {
            removedGarbage++;
            addLog('remove', `[${entry.ticket_id}] Removed normalize output with HTML/form garbage problem`);
            return false;
          }
          if (window.KB_SHARED_RULES && window.KB_SHARED_RULES.isSupportRequestNoise && window.KB_SHARED_RULES.isSupportRequestNoise(cleanProblem, cleanSolution)) {
            removedGarbage++;
            addLog('remove', `[${entry.ticket_id}] Removed normalize output with support-request/non-knowledge problem`);
            return false;
          }
          entry.issue_type = QA_PIPELINE.classifyIssueTypeFromEntry({
            ...entry,
            problem: cleanProblem,
            solution: cleanSolution
          });
          return true;
        });
        if (removedGarbage > 0) addLog('info', `[Normalize] Removed ${removedGarbage} garbage/non-knowledge entries before validation`);
      }
      if (!AI_REVIEWER.aborted) {
        setNormPhase('qa');
        await runValidation(dataset);
      }

      refreshRunStatusBar();

      const seconds = ((Date.now() - t0) / 1000).toFixed(1);
      const passDesc = normTarget === 'both' ? 'Problem + Solution' : normTarget === 'solution' ? 'Solution' : 'Problem';
      window._normalizeOutput = _toKbFormat(dataset);
      const stageMsg = AI_REVIEWER.aborted
        ? `Stopped — ${passDesc}: ${totalChanged} cleaned, ${totalErrors} errors`
        : `Complete in ${seconds}s — ${passDesc}: ${totalChanged} cleaned, ${qaInvalidCount !== null ? qaInvalidCount + ' QA invalid, ' : ''}${totalErrors} errors`;
      stage.textContent = stageMsg;

      // Show summary panel
      const summaryEl = document.getElementById('aiNormalizeSummary');
      if (summaryEl) {
        document.getElementById('normStatTotal').textContent = dataset.length.toLocaleString();
        document.getElementById('normStatProbChanged').textContent = _probChanged !== null ? _probChanged.toLocaleString() : '—';
        document.getElementById('normStatSolChanged').textContent = _solChanged !== null ? _solChanged.toLocaleString() : '—';
        document.getElementById('normStatCached').textContent = cacheHits.toLocaleString();
        document.getElementById('normStatCompression').textContent = document.getElementById('aiRunStatCompressionN')?.textContent || '—';
        const invalidEl = document.getElementById('normStatInvalid');
        if (invalidEl) invalidEl.textContent = qaInvalidCount !== null ? qaInvalidCount.toLocaleString() : '—';
        summaryEl.style.display = '';
      }
    } catch(err) {
      stage.textContent = `Error: ${err.message}`;
      addLog('error', `Unexpected error: ${err.message}`);
    } finally {
      setAiRunning(false, 'Run AI Normalize');
      if (phaseRow) phaseRow.style.display = 'none';
    }
  }

  function _downloadNormalizeResult() {
    if (!window._normalizeOutput) return;
    const date = new Date().toISOString().split('T')[0];
    const reviewMode = document.getElementById('aiReviewMode')?.value || 'normalize';
    const prefix = reviewMode === 'extraction'
      ? 'extracted'
      : reviewMode === 'generalize'
        ? 'generalized'
      : reviewMode === 'validation'
        ? 'validated'
        : 'normalized';
    const blob = new Blob([JSON.stringify(window._normalizeOutput, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${prefix}_${date}.json`;
    a.click(); URL.revokeObjectURL(a.href);
    showToast(`Downloaded ${window._normalizeOutput.length} entries → ${prefix}_${date}.json`);
  }

  function _downloadValidationResult(type) {
    if (!window._normalizeOutput) return;
    const date = new Date().toISOString().split('T')[0];
    let output = window._normalizeOutput;
    let filename = `validated_${date}.json`;
    if (type === 'kept') {
      output = _toValidatedKeepFormat(output.filter((e) => (
        e.qa_disposition === 'KEEP' &&
        !!String(e.generalization_version || '').trim() &&
        !!String(e.extraction_version || '').trim() &&
        !!String(e.problem_summary || '').trim() &&
        !!String(e.solution_summary || '').trim() &&
        Array.isArray(e.action_steps) && e.action_steps.length > 0 &&
        Array.isArray(e.keywords) && e.keywords.length > 0
      )));
      filename = `validated_keep_${date}.json`;
    }
    const blob = new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click(); URL.revokeObjectURL(a.href);
    showToast(`Downloaded ${output.length} entries → ${filename}`);
  }

  // ═══════════════════════════════════════════════════════
  // Scoring Cache — persist per-ticket scores in localStorage
  // Allows skipping already-scored tickets & resuming after interruption
  // ═══════════════════════════════════════════════════════
  const SCORING_CACHE_KEY = 'scoringCache';
  var _scoringCacheKey = '';   // fingerprint of current dataset
  var _scoringIsTest = false;  // true when running in test mode (no cache saves)

  function scoringFingerprint(source, entries) {
    if (!entries || !entries.length) return '';
    const sampleIds = entries.slice(0, 5).map(e => e.ticket_id || '').join(',');
    return `scoring|${source || 'unknown'}|${entries.length}|${sampleIds}`;
  }

  function loadScoringCache() {
    try {
      const raw = localStorage.getItem(SCORING_CACHE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (_) { return {}; }
  }

  function saveScoringCache(cacheData) {
    try { localStorage.setItem(SCORING_CACHE_KEY, JSON.stringify(cacheData)); } catch (_) {}
  }

  /**
   * Save per-ticket scoring results for the current dataset.
   * @param {Array} dataset - the full dataset with ai_scoring fields
   */
  function saveScoringProgress(dataset) {
    if (!_scoringCacheKey) return;
    const allCache = loadScoringCache();
    const ticketScores = {};
    for (const e of dataset) {
      if (e.ai_scoring && e.ticket_id) {
        ticketScores[String(e.ticket_id)] = e.ai_scoring;
      }
    }
    allCache[_scoringCacheKey] = {
      scores: ticketScores,
      ts: Date.now(),
      source: _aiReviewInput.source || 'unknown'
    };
    // Keep max 5 dataset caches
    const keys = Object.keys(allCache);
    if (keys.length > 5) {
      const sorted = keys.sort((a, b) => (allCache[a].ts || 0) - (allCache[b].ts || 0));
      for (let i = 0; i < sorted.length - 5; i++) delete allCache[sorted[i]];
    }
    saveScoringCache(allCache);
  }

  /**
   * Load cached per-ticket scores for the current dataset.
   * Returns a Map of ticket_id → ai_scoring object, or empty Map.
   */
  function loadScoringProgress() {
    if (!_scoringCacheKey) return new Map();
    const allCache = loadScoringCache();
    const entry = allCache[_scoringCacheKey];
    if (!entry || !entry.scores) return new Map();
    const map = new Map();
    for (const [tid, scoring] of Object.entries(entry.scores)) {
      map.set(tid, scoring);
    }
    return map;
  }

  function clearScoringCacheForKey(key) {
    if (!key) return;
    const allCache = loadScoringCache();
    delete allCache[key];
    saveScoringCache(allCache);
  }

  function clearScoringCache(silent = false) {
    localStorage.removeItem(SCORING_CACHE_KEY);
    _scoringCacheKey = '';
    // Clear in-memory scores too
    if (_aiReviewInput.cleaned) {
      for (const e of _aiReviewInput.cleaned) delete e.ai_scoring;
    }
    refreshScoringStatusBar();
    if (!silent) showToast('Filter cache cleared');
  }

  // ─── Normalize Cache ───────────────────────────────────────────────────────
  const NORMALIZE_CACHE_KEY = 'normalizeCache';
  var _normalizeCacheKey = '';

  function normalizeFingerprint(source, entries) {
    // Key on DATA content only (first 5 + last 2 ticket IDs + total count)
    // Intentionally ignores filename so renamed/duplicate downloads still hit the same cache
    if (!entries || !entries.length) return '';
    const headIds = entries.slice(0, 5).map(e => e.ticket_id || '').join(',');
    const tailIds = entries.slice(-2).map(e => e.ticket_id || '').join(',');
    return `normalize|${entries.length}|${headIds}|${tailIds}`;
  }

  function _loadNormalizeCacheRaw() {
    try { const raw = localStorage.getItem(NORMALIZE_CACHE_KEY); return raw ? JSON.parse(raw) : {}; }
    catch (_) { return {}; }
  }

  function _saveNormalizeCacheRaw(data) {
    try { localStorage.setItem(NORMALIZE_CACHE_KEY, JSON.stringify(data)); } catch (_) {}
  }

  function saveNormalizeProgress(dataset) {
    if (!_normalizeCacheKey) return;
    const allCache = _loadNormalizeCacheRaw();
    const queries = {}, solutions = {}, qaValid = {};
    for (const e of dataset) {
      if (!e.ticket_id) continue;
      const tid = String(e.ticket_id);
      if (e.problem)              queries[tid]   = e.problem;
      if (e.solution)             solutions[tid] = e.solution;
      if (e.qa_valid !== undefined) qaValid[tid] = e.qa_valid;
    }
    allCache[_normalizeCacheKey] = { queries, solutions, qaValid, ts: Date.now(), source: _aiReviewInput.source || 'unknown' };
    const keys = Object.keys(allCache);
    if (keys.length > 5) {
      const sorted = keys.sort((a, b) => (allCache[a].ts || 0) - (allCache[b].ts || 0));
      for (let i = 0; i < sorted.length - 5; i++) delete allCache[sorted[i]];
    }
    _saveNormalizeCacheRaw(allCache);
  }

  // Returns { problems: Map, solutions: Map, qaValid: Map }
  function loadNormalizeProgress() {
    if (!_normalizeCacheKey) return { problems: new Map(), solutions: new Map(), qaValid: new Map() };
    const allCache = _loadNormalizeCacheRaw();
    let entry = allCache[_normalizeCacheKey];

    // Backward-compat: also try old filename-based fingerprint format
    // (caches saved before fingerprint was changed to content-based)
    if (!entry && _aiReviewInput.source) {
      const dataset = _aiReviewInput.cleaned || [];
      if (dataset.length) {
        const sampleIds = dataset.slice(0, 5).map(e => e.ticket_id || '').join(',');
        const oldKey = `normalize|${_aiReviewInput.source}|${dataset.length}|${sampleIds}`;
        entry = allCache[oldKey];
        if (entry) {
          // Migrate to new key so future saves use new format
          allCache[_normalizeCacheKey] = { ...entry, ts: entry.ts };
          _saveNormalizeCacheRaw(allCache);
        }
      }
    }

    if (!entry) return { problems: new Map(), solutions: new Map(), qaValid: new Map() };
    const problems  = new Map(Object.entries(entry.queries   || {}));
    const solutions = new Map(Object.entries(entry.solutions || {}));
    const qaValid   = new Map(Object.entries(entry.qaValid   || {}));
    return { problems, solutions, qaValid };
  }

  function getNormalizeCachedCount() {
    if (!_normalizeCacheKey) return 0;
    const allCache = _loadNormalizeCacheRaw();
    const entry = allCache[_normalizeCacheKey];
    return entry && entry.queries ? Object.keys(entry.queries).length : 0;
  }

  function clearNormalizeCache(silent = false) {
    localStorage.removeItem(NORMALIZE_CACHE_KEY);
    _normalizeCacheKey = '';
    refreshRunStatusBar();
    if (!silent) showToast('Normalize cache cleared');
  }

  function resetAiReviewPanels(options = {}) {
    const preserveModeStates = options.preserveModeStates !== false;
    const preserveOutput = !!options.preserveOutput;
    const progressEl = document.getElementById('aiRevProgress');
    const fillEl = document.getElementById('aiRevProgressFill');
    const stageEl = document.getElementById('aiRevStage');
    const pctEl = document.getElementById('aiRevPct');
    const logEl = document.getElementById('aiRevLog');
    const normSummaryEl = document.getElementById('aiNormalizeSummary');
    const scoringSummaryEl = document.getElementById('aiScoringSummary');
    const diagReportEl = document.getElementById('aiDiagReport');
    if (progressEl) progressEl.style.display = 'none';
    if (fillEl) fillEl.style.width = '0%';
    if (stageEl) stageEl.textContent = 'Initializing...';
    if (pctEl) pctEl.textContent = '0%';
    if (logEl) logEl.innerHTML = '';
    if (normSummaryEl) normSummaryEl.style.display = 'none';
    if (scoringSummaryEl) scoringSummaryEl.style.display = 'none';
    if (diagReportEl) diagReportEl.style.display = 'none';
    if (!preserveOutput && window._normalizeOutput) delete window._normalizeOutput;
    if (!preserveModeStates) _clearModeStates();
    setAiRunning(false, getAiModeLabel(document.getElementById('aiReviewMode')?.value));
  }

  function getAiModeDisplayName(mode) {
    if (mode === 'diagnostics') return 'Diagnostics';
    if (mode === 'scoring') return 'Filter';
    if (mode === 'normalize') return 'Normalize';
    if (mode === 'generalize') return 'Generalize';
    if (mode === 'extraction') return 'Extraction';
    if (mode === 'validation') return 'Validation';
    return 'AI Review';
  }

  function getAiClearAffectedModes(mode) {
    if (mode === 'diagnostics') return ['diagnostics'];
    if (mode === 'scoring') return ['scoring', 'normalize', 'generalize', 'extraction', 'validation'];
    const idx = AI_PIPELINE_ORDER.indexOf(mode);
    return idx === -1 ? [mode] : AI_PIPELINE_ORDER.slice(idx);
  }

  async function clearAiBackendCache(mode) {
    const sourceDataset = _aiReviewInput.cleaned || [];
    if (!sourceDataset.length) return false;
    let dataset = [...sourceDataset];
    const runScope = document.querySelector('input[name="aiRunScope"]:checked')?.value || 'total';
    if ((mode === 'normalize' || mode === 'generalize' || mode === 'extraction' || mode === 'validation' || mode === 'diagnostics') && runScope === 'test') {
      const testSize = Math.max(1, parseInt(document.getElementById('aiTestSize')?.value || '30', 10));
      if (dataset.length > testSize) dataset = dataset.slice(0, testSize);
    }
    if ((mode === 'normalize' || mode === 'generalize' || mode === 'extraction' || mode === 'validation' || mode === 'diagnostics') && runScope === 'ids') {
      const wanted = new Set(parseAiTicketIds(document.getElementById('aiTicketIds')?.value || '').map(String));
      if (wanted.size) {
        dataset = dataset.filter(entry => wanted.has(String(entry?.ticket_id ?? '')));
      }
    }
    if (mode === 'scoring' && document.querySelector('input[name="aiScoreScope"]:checked')?.value === 'test') {
      const testSize = Math.max(1, parseInt(document.getElementById('aiScoreTestSize')?.value || '300', 10));
      if (dataset.length > testSize) dataset = dataset.slice(0, testSize);
    }
    try {
      const res = await fetch(`${KB_BASE}/ai-jobs/clear-cache`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          dataset,
          source: _aiReviewInput.source || 'uploaded dataset'
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to clear backend cache');
      return true;
    } catch (err) {
      showToast(err.message || 'Failed to clear backend cache');
      return false;
    }
  }

  async function clearAiReviewCache() {
    const mode = document.getElementById('aiReviewMode')?.value;
    detachActiveAiPipelineJob(true);
    if (mode === 'diagnostics') {
      clearDiagHistory(true);
      await clearAiBackendCache('diagnostics');
      _clearModeStates(getAiClearAffectedModes(mode));
      resetAiReviewPanels({ preserveModeStates: true });
      showToast('Diagnostics cache cleared');
      return;
    }
    if (mode === 'scoring') {
      clearScoringCache(true);
      await clearAiBackendCache('scoring');
      _clearModeStates(getAiClearAffectedModes(mode));
      resetAiReviewPanels({ preserveModeStates: true });
      showToast('Filter cache cleared');
      return;
    }
    if (mode === 'normalize' || mode === 'generalize' || mode === 'extraction' || mode === 'validation') {
      if (mode === 'normalize') clearNormalizeCache(true);
      await clearAiBackendCache(mode);
      _clearModeStates(getAiClearAffectedModes(mode));
      resetAiReviewPanels({ preserveModeStates: true });
      showToast(`${getAiModeDisplayName(mode)} cache cleared`);
      return;
    }
    showToast('No cache for this mode');
  }
  // ───────────────────────────────────────────────────────────────────────────

  // Quick-start scoring from QA Clean or Deep Clean output
  function quickStartScoring(source) {
    if (source === 'qa') {
      const src = DEEP_CLEAN.cleanedData?.length ? DEEP_CLEAN : QA_PIPELINE;
      if (!src.cleanedData || !src.cleanedData.length) {
        showToast('No pipeline output available.'); return;
      }
      _aiReviewInput.cleaned = src.cleanedData;
      _aiReviewInput.removed = src.removedEntries || [];
      _aiReviewInput.source = DEEP_CLEAN.cleanedData?.length ? 'Deep Clean output' : 'QA Clean output';
    } else if (source === 'deep') {
      if (!DEEP_CLEAN.cleanedData || !DEEP_CLEAN.cleanedData.length) {
        showToast('No Deep Clean output available.'); return;
      }
      _aiReviewInput.cleaned = DEEP_CLEAN.cleanedData;
      _aiReviewInput.removed = [];
      _aiReviewInput.source = 'Deep Clean output';
    }
    // Switch to AI Review page and set scoring mode
    switchKbView('ai-review');
    const modeSelect = document.getElementById('aiReviewMode');
    if (modeSelect) { modeSelect.value = 'scoring'; toggleAiReviewMode(); }
    // Update source status
    const statusEl = document.getElementById('aiSourceStatus');
    if (statusEl) {
      statusEl.textContent = `Loaded ${_aiReviewInput.cleaned.length} entries from ${_aiReviewInput.source}`;
      statusEl.style.color = 'var(--text2)';
    }
    refreshScoringStatusBar();
    // Auto-start scoring after a short delay (let UI settle)
    setTimeout(() => startAiBackendJob('scoring'), 300);
  }

  // ═══════════════════════════════════════════════════════
  // AI Filter — 4-dimension classification and keep/drop filtering
  // Writes scores directly into the source dataset entries
  // ═══════════════════════════════════════════════════════
  async function startScoring() {
    if (!_aiReviewInput.cleaned && (DEEP_CLEAN.cleanedData?.length || QA_PIPELINE.cleanedData?.length)) aiReviewFromQa();
    if (!_aiReviewInput.cleaned || !_aiReviewInput.cleaned.length) {
      showToast('No data loaded. Upload a file or run QA Clean first.'); return;
    }

    _scoringImportedState = null;
    AI_REVIEWER.aborted = false;
    setAiRunning(true);

    const connMode = document.getElementById('aiConnMode').value;
    AI_REVIEWER.useProxy = (connMode === 'proxy');
    AI_REVIEWER.proxyBase = window.location.origin;
    AI_REVIEWER.apiUrl = document.getElementById('aiApiUrl').value.trim();
    AI_REVIEWER.model = document.getElementById('aiModel').value;

    // Read scoring parameters from scoring preset (not current UI tab)
    const scoringPresetVals = (typeof getPresetValues === 'function' ? getPresetValues('scoring') : {});
    const BATCH_SIZE = parseInt(scoringPresetVals.batch_size) || 50;
    const PARALLEL_REQUESTS = parseInt(document.getElementById('aiScoringParallel').value) || 10;
    const MAX_RETRIES = 3;
    var _scoringRetryMode = false;  // flipped to true during retry rounds → bumps num_predict

    // Total vs Test scope
    const scoreScope = document.querySelector('input[name="aiScoreScope"]:checked')?.value || 'total';
    const scoreTestSize = parseInt(document.getElementById('aiScoreTestSize').value) || 100;
    _scoringIsTest = (scoreScope === 'test');

    const progPanel = document.getElementById('aiRevProgress');
    const fill = document.getElementById('aiRevProgressFill');
    const stage = document.getElementById('aiRevStage');
    const pct = document.getElementById('aiRevPct');
    const logEl = document.getElementById('aiRevLog');

    progPanel.style.display = '';
    document.getElementById('aiDiagReport').style.display = 'none';
    const scoringSummaryEl = document.getElementById('aiScoringSummary');
    if (scoringSummaryEl) scoringSummaryEl.style.display = 'none';
    document.getElementById('pipelineReport').style.display = 'none';
    logEl.innerHTML = '';
    fill.style.width = '0%';
    pct.textContent = '0%';

    let scored = 0, errors = 0, kept = 0, dropped = 0, batchesDone = 0, cachedCount = 0;
    const scoringPrompt = AI_REVIEWER.getScoringPrompt();
    const t0 = Date.now();

    const addLog = (tag, msg) => {
      const t = new Date().toLocaleTimeString('en-US', { hour12: false });
      const tagClass = tag === 'error' ? 'remove' : tag === 'keep' ? 'info' : tag === 'drop' ? 'remove' : tag === 'warn' ? 'rescue' : 'info';
      logEl.innerHTML += `<div class="qa-log-entry"><span class="qa-log-time">${t}</span><span class="qa-log-tag ${tagClass}">${tag}</span><span class="qa-log-msg">${msg}</span></div>`;
      logEl.scrollTop = logEl.scrollHeight;
    };

    // Work directly on the source dataset — scores are written in-place
    const dataset = _aiReviewInput.cleaned;

    // Set cache key for this dataset
    _scoringCacheKey = scoringFingerprint(_aiReviewInput.source, dataset);

    // O(1) lookup map: ticket_id → entry reference (avoids O(n²) .find())
    const ticketMap = new Map();
    for (const e of dataset) ticketMap.set(String(e.ticket_id), e);

    // ── Restore cached scores from previous run / interruption (skip in test mode) ──
    const cachedScores = _scoringIsTest ? new Map() : loadScoringProgress();
    if (cachedScores.size > 0) {
      for (const [tid, scoring] of cachedScores) {
        const entry = ticketMap.get(tid);
        if (entry && !entry.ai_scoring) {
          entry.ai_scoring = scoring;
          cachedCount++;
          scored++;
          if (scoring.keep) kept++; else dropped++;
        }
      }
      if (cachedCount > 0) {
        addLog('info', `Restored ${cachedCount} cached scores from previous run`);
      }
    }

    // In test mode, strip any existing ai_scoring so we start completely fresh
    if (_scoringIsTest) {
      for (const e of dataset) delete e.ai_scoring;
    }

    // Only batch entries that still need scoring (apply test scope limit)
    let unscoredEntries = dataset.filter(e => !e.ai_scoring);
    if (scoreScope === 'test' && unscoredEntries.length > scoreTestSize) {
      unscoredEntries = unscoredEntries.slice(0, scoreTestSize);
      addLog('info', `Test mode: limited to ${scoreTestSize} entries`);
    }
    const batches = [];
    for (let i = 0; i < unscoredEntries.length; i += BATCH_SIZE) {
      batches.push({ idx: batches.length, entries: unscoredEntries.slice(i, i + BATCH_SIZE) });
    }

    // Update cached count in status bar
    const cachedEl = document.getElementById('aiScoreStatCachedN');
    if (cachedEl) cachedEl.textContent = cachedCount.toLocaleString();

    if (unscoredEntries.length === 0) {
      addLog('info', `All ${dataset.length} tickets already scored (${cachedCount} from cache). Nothing to do.`);
      stage.textContent = `All ${dataset.length} tickets already scored from cache.`;
      fill.style.width = '100%'; pct.textContent = '100%';
      // Still render report and update UI
      window._scoringOutput = dataset;
      renderScoringReport({ total: dataset.length, scored, kept, dropped, errors, seconds: '0.0' });
      refreshScoringStatusBar();
      setAiRunning(false, 'Run AI Filter');
      return;
    }

      stage.textContent = `Filtering ${unscoredEntries.length} entries (${cachedCount} cached) in ${batches.length} batches (parallel=${PARALLEL_REQUESTS}, retries=${MAX_RETRIES})...`;
    addLog('info', `Config: batch_size=${BATCH_SIZE}, parallel=${PARALLEL_REQUESTS}, max_retries=${MAX_RETRIES}, unscored=${unscoredEntries.length}, cached=${cachedCount}`);

    AI_REVIEWER.aborted = false;

    // Buffered log — flush to DOM in batches to avoid 10K reflows
    let _logBuf = [];
    function addLogBuffered(tag, msg) {
      const t = new Date().toLocaleTimeString('en-US', { hour12: false });
      const tagClass = tag === 'error' ? 'remove' : tag === 'keep' ? 'info' : tag === 'drop' ? 'remove' : tag === 'warn' ? 'rescue' : 'info';
      _logBuf.push(`<div class="qa-log-entry"><span class="qa-log-time">${t}</span><span class="qa-log-tag ${tagClass}">${tag}</span><span class="qa-log-msg">${msg}</span></div>`);
    }
    function flushLog() {
      if (_logBuf.length === 0) return;
      logEl.insertAdjacentHTML('beforeend', _logBuf.join(''));
      _logBuf = [];
      logEl.scrollTop = logEl.scrollHeight;
    }

    // Helper: update progress bar — uses counters directly (no full dataset scan)
    function updateProgress() {
      const p = Math.round((batchesDone / batches.length) * 100);
      fill.style.width = p + '%';
      pct.textContent = p + '%';
      stage.textContent = `${batchesDone}/${batches.length} batches done — ${kept} kept, ${dropped} dropped` + (cachedCount > 0 ? ` (${cachedCount} cached)` : '');
      // Update scoring status bar from counters (no filter scan)
      const el = (id) => document.getElementById(id);
      if (el('aiScoreStatTicketsN')) el('aiScoreStatTicketsN').textContent = dataset.length.toLocaleString();
      if (el('aiScoreStatCachedN')) el('aiScoreStatCachedN').textContent = cachedCount.toLocaleString();
      if (el('aiScoreStatScoredN')) el('aiScoreStatScoredN').textContent = scored.toLocaleString();
      if (el('aiScoreStatKeepN')) el('aiScoreStatKeepN').textContent = kept.toLocaleString();
      if (el('aiScoreStatRemoveN')) el('aiScoreStatRemoveN').textContent = dropped.toLocaleString();
      const rate = scored > 0 ? Math.round((kept / scored) * 100) : 0;
      if (el('aiScoreStatRateN')) el('aiScoreStatRateN').textContent = scored > 0 ? rate + '%' : '—';
      flushLog();
      // Save progress to cache every 5 batches (skip in test mode)
      if (!_scoringIsTest && batchesDone % 5 === 0) saveScoringProgress(dataset);
    }

    // Helper: process a single batch result — O(1) per entry via Map
    function processBatchResults(results, batch) {
      for (const r of results) {
        const entry = ticketMap.get(String(r.ticket_id));
        if (!entry) continue;
        entry.ai_scoring = {
          noise_score: r.noise_score ?? null,
          solution_score: r.solution_score ?? null,
          reusability_score: r.reusability_score ?? null,
          quality_score: r.quality_score ?? null,
          keep: !!r.keep,
          reason: r.reason || ''
        };
        const dim = `N:${r.noise_score??'?'} S:${r.solution_score??'?'} R:${r.reusability_score??'?'} Q:${r.quality_score??'?'}`;
        const reason = entry.ai_scoring.reason || (entry.problem || '').substring(0, 60).trim();
        if (entry.ai_scoring.keep) {
          kept++;
          addLogBuffered('keep', `[${r.ticket_id}] KEEP (${dim}) — ${reason}`);
        } else {
          dropped++;
          addLogBuffered('drop', `[${r.ticket_id}] DROP (${dim}) — ${reason}`);
        }
      }
      // Mark unscored entries in batch
      const scoredIds = new Set(results.map(r => String(r.ticket_id)));
      let missed = 0;
      for (const e of batch) {
        if (!scoredIds.has(String(e.ticket_id)) && !e.ai_scoring) {
          e.ai_scoring = { noise_score:0, solution_score:0, reusability_score:0, quality_score:0, keep: false, reason: 'no AI response' };
          dropped++;
          missed++;
        }
      }
      scored += results.length + missed;
      if (missed > 0) errors += missed;
    }

    // Helper: mark entire batch as failed
    function markBatchFailed(batch, reason) {
      let failCount = 0;
      for (const entry of batch) {
        if (!entry.ai_scoring) {
          entry.ai_scoring = { noise_score:0, solution_score:0, reusability_score:0, quality_score:0, keep: false, reason };
          dropped++;
          failCount++;
        }
      }
      scored += failCount;
      errors += failCount;
    }

    // Helper: send one batch with retries
    async function sendBatch(batchObj) {
      if (!batchObj) return;
      const { idx, entries } = batchObj;
      const bi = idx + 1;
      const batch = entries;
      addLogBuffered('info', `Batch ${bi}/${batches.length} started (${batch.length} entries)...`);

      const ticketLines = [];
      batch.forEach((e, i) => {
        ticketLines.push(`--- TICKET ${i + 1} ---`);
        ticketLines.push(`ticket_id: ${e.ticket_id}`);
        ticketLines.push(`Problem: ${(e.problem || '').substring(0, 600)}`);
        ticketLines.push(`Solution: ${(e.solution || '').substring(0, 600)}`);
        if (e.root_cause) ticketLines.push(`Root Cause: ${(e.root_cause || '').substring(0, 200)}`);
        ticketLines.push('');
      });
      const userPrompt = `Evaluate these ${batch.length} tickets:\n\n${ticketLines.join('\n')}\n\nReturn a JSON array with ${batch.length} elements.`;

      const presetOpts = typeof getOllamaOptions === 'function' ? getOllamaOptions() : {};
      const defaultNumPredict = presetOpts.num_predict || 4096;
      // On retry rounds, double num_predict to handle truncated JSON issues
      const llmOptions = { num_predict: _scoringRetryMode ? Math.max(defaultNumPredict * 2, 8192) : defaultNumPredict };

      const BATCH_TIMEOUT = 120000; // 2 min per batch
      let responseText = '';
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        if (AI_REVIEWER.aborted) return;
        responseText = '';
        try {
          const _withTimeout = (p) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('Batch timeout (120s)')), BATCH_TIMEOUT))]);
          try {
            responseText = await _withTimeout(AI_REVIEWER._tryChat(userPrompt, scoringPrompt, llmOptions));
          } catch (chatErr) {
            addLogBuffered('warn', `Batch ${bi} chat failed: ${chatErr.message}, trying generate...`);
            responseText = await _withTimeout(AI_REVIEWER._tryGenerate(userPrompt, scoringPrompt, llmOptions));
          }
          const results = parseScoringBatchResponse(responseText, batch);
          if (results.length === 0 && attempt < MAX_RETRIES) {
            const respLen = (responseText || '').length;
            const preview = (responseText || '(empty)').substring(0, 400).replace(/\n/g, '↵');
            addLogBuffered('warn', `Batch ${bi} attempt ${attempt}/${MAX_RETRIES}: 0 parsed results (response ${respLen} chars), retrying...`);
            addLogBuffered('warn', `  ↳ preview: ${preview}`);
            flushLog();
            continue;
          }
          processBatchResults(results, batch);
          batchesDone++;
          updateProgress();
          return;
        } catch (e) {
          if (attempt < MAX_RETRIES) {
            addLogBuffered('warn', `Batch ${bi} attempt ${attempt}/${MAX_RETRIES} error: ${e.message}, retrying...`);
            addLogBuffered('warn', `  ↳ responseText was: ${(responseText||'(empty)').substring(0,300).replace(/\n/g,'↵')}`);
            flushLog();
          } else {
            addLogBuffered('error', `Batch ${bi} failed after ${MAX_RETRIES} attempts: ${e.message}`);
            markBatchFailed(batch, `failed after ${MAX_RETRIES} retries`);
            batchesDone++;
            updateProgress();
          }
        }
      }
    }

    // Execute batches in parallel with concurrency limit
    let batchIdx = 0;
    async function runParallel() {
      const workers = [];
      for (let w = 0; w < PARALLEL_REQUESTS; w++) {
        workers.push((async () => {
          while (batchIdx < batches.length && !AI_REVIEWER.aborted) {
            const myBatch = batches[batchIdx++];
            await sendBatch(myBatch);
          }
        })());
      }
      await Promise.all(workers);
    }
    await runParallel();
    flushLog();

    // ── Auto-retry failed entries (reason contains 'no AI response' or 'failed') ──
    _scoringRetryMode = true;  // bump num_predict for retry batches
    const MAX_RETRY_ROUNDS = 2;
    for (let retryRound = 1; retryRound <= MAX_RETRY_ROUNDS && !AI_REVIEWER.aborted; retryRound++) {
      const failedEntries = dataset.filter(e =>
        e.ai_scoring && (e.ai_scoring.reason === 'no AI response' || (e.ai_scoring.reason && e.ai_scoring.reason.startsWith('failed')))
      );
      if (failedEntries.length === 0) break;

      const retryPreset = typeof getOllamaOptions === 'function' ? getOllamaOptions() : {};
      const retryNumPredict = Math.max((retryPreset.num_predict || 4096) * 2, 8192);
      addLog('info', `Retry round ${retryRound}/${MAX_RETRY_ROUNDS}: ${failedEntries.length} failed entries to re-score (num_predict: ${retryNumPredict})`);
      stage.textContent = `Retry ${retryRound}: re-scoring ${failedEntries.length} failed entries (num_predict↑)...`;

      // Clear failed scores so they can be re-scored
      for (const e of failedEntries) {
        if (e.ai_scoring.keep === false) dropped--;
        scored--;
        errors--;
        delete e.ai_scoring;
      }

      // Re-batch with smaller batch size for retries
      const retryBatchSize = Math.max(5, Math.floor(BATCH_SIZE / 2));
      const retryBatches = [];
      for (let i = 0; i < failedEntries.length; i += retryBatchSize) {
        retryBatches.push({ idx: retryBatches.length, entries: failedEntries.slice(i, i + retryBatchSize) });
      }

      batchIdx = 0;
      batches.length = 0;
      batches.push(...retryBatches);
      batchesDone = 0;

      await runParallel();
      flushLog();

      const stillFailed = failedEntries.filter(e =>
        e.ai_scoring && (e.ai_scoring.reason === 'no AI response' || (e.ai_scoring.reason && e.ai_scoring.reason.startsWith('failed')))
      ).length;
      addLog('info', `Retry ${retryRound} complete: ${failedEntries.length - stillFailed} recovered, ${stillFailed} still failed`);
    }
    _scoringRetryMode = false;  // reset back to normal

    const seconds = ((Date.now() - t0) / 1000).toFixed(1);

    // Store output reference (the dataset itself is already modified in-place)
    window._scoringOutput = dataset;

    // Save progress to cache (for resume on next run — skip in test mode)
    if (!_scoringIsTest) saveScoringProgress(dataset);

    if (AI_REVIEWER.aborted) {
      // ── Stopped / Paused ──
      const remaining = dataset.filter(e => !e.ai_scoring).length;
      addLog('info', `Stopped — ${scored} scored, ${remaining} remaining. Progress saved to cache.`);
      stage.textContent = `Stopped after ${seconds}s — ${scored} scored, ${remaining} remaining (cached for resume)`;
      fill.style.width = '100%';
      pct.textContent = `${scored}/${dataset.length}`;
      setAiRunning(false, 'Run AI Filter');
      // Still render partial report if we have results
      if (scored > 0) {
        renderScoringReport({ total: dataset.length, scored, kept, dropped, errors, seconds });
      }
      refreshScoringStatusBar();
      return;
    }

    addLog('info', `Filter complete — ${scored} entries cached for resume`);

    // Show completion in progress bar
    const keepRate = scored > 0 ? Math.round((kept / scored) * 100) : 0;
    const cacheNote = cachedCount > 0 ? `, ${cachedCount} from cache` : '';
    stage.textContent = `Complete in ${seconds}s — ${scored} scored, ${kept} kept, ${dropped} dropped (${keepRate}% keep rate${cacheNote})`;

    // Render scoring report
    renderScoringReport({ total: dataset.length, scored, kept, dropped, errors, seconds });

    refreshScoringStatusBar();
    setAiRunning(false, 'Run AI Filter');

    // Auto-run post-scoring pipeline: Audit1 → Refine → Audit2 → Finalize
    addLog('info', 'Starting post-scoring pipeline...');
    setTimeout(() => runPostScoringPipeline(), 500);
  }

  function renderScoringReport(stats) {
    const summaryEl = document.getElementById('aiScoringSummary');
    if (summaryEl) summaryEl.style.display = '';
    const { total, scored, kept, dropped } = stats;
    const el = (id) => document.getElementById(id);
    if (el('scoringStatTotal')) el('scoringStatTotal').textContent = (total || 0).toLocaleString();
    if (el('scoringStatScored')) el('scoringStatScored').textContent = (scored || 0).toLocaleString();
    if (el('scoringStatKeep')) el('scoringStatKeep').textContent = (kept || 0).toLocaleString();
    if (el('scoringStatDrop')) el('scoringStatDrop').textContent = (dropped || 0).toLocaleString();
  }

  // ══════════════════════════════════════════════════════════════
  // POST-SCORING PIPELINE (OpenClaw-style multi-pass verification)
  //   Step 1: Scoring (already done by startScoring)
  //   Step 2: Audit Pass 1 — find obvious errors in KEEP entries
  //   Step 3: Refine Pass — re-score only flagged entries with feedback
  //   Step 4: Audit Pass 2 — verify refinements are correct
  //   Step 5: Finalize — lock results, update UI
  // ══════════════════════════════════════════════════════════════

  function _getDatasetStats(dataset) {
    const scored = dataset.filter(e => e.ai_scoring);
    const kept = scored.filter(e => e.ai_scoring.keep);
    const dropped = scored.filter(e => !e.ai_scoring.keep);
    const noResp = scored.filter(e => e.ai_scoring.reason === 'no AI response' || (e.ai_scoring.reason && e.ai_scoring.reason.startsWith('failed')));
    return { total: dataset.length, scored: scored.length, kept: kept.length, dropped: dropped.length, failed: noResp.length };
  }

  // ── Global log for pipeline (writes to scoring log panel) ──
  function _pipelineLog(tag, msg) {
    const logEl = document.getElementById('aiRevLog');
    if (!logEl) return;
    const t = new Date().toLocaleTimeString('en-US', { hour12: false });
    const tagClass = tag === 'error' ? 'remove' : tag === 'warn' ? 'rescue' : tag === 'pipe' ? 'pipe' : 'info';
    logEl.insertAdjacentHTML('beforeend', `<div class="qa-log-entry"><span class="qa-log-time">${t}</span><span class="qa-log-tag ${tagClass}">${tag}</span><span class="qa-log-msg">${msg}</span></div>`);
    logEl.scrollTop = logEl.scrollHeight;
  }
  function _pipelineSep() {
    const logEl = document.getElementById('aiRevLog');
    if (logEl) logEl.insertAdjacentHTML('beforeend', `<hr class="qa-log-sep">`);
  }

  // ── Shared: LLM call helper for pipeline steps ──
  async function _pipelineLLMCall(userPrompt, systemPrompt, llmOptions) {
    const connMode = document.getElementById('aiConnMode').value;
    AI_REVIEWER.useProxy = (connMode === 'proxy');
    AI_REVIEWER.proxyBase = window.location.origin;
    AI_REVIEWER.apiUrl = document.getElementById('aiApiUrl').value.trim();
    AI_REVIEWER.model = document.getElementById('aiModel').value;
    try {
      return await AI_REVIEWER._tryChat(userPrompt, systemPrompt, llmOptions);
    } catch (_) {
      return await AI_REVIEWER._tryGenerate(userPrompt, systemPrompt, llmOptions);
    }
  }

  function _normalizeKeys(obj) {
    // Convert camelCase to snake_case for known fields
    const map = { ticketId:'ticket_id', ticket_id:'ticket_id', errorType:'error_type', error_type:'error_type',
      noiseScore:'noise_score', noise_score:'noise_score', solutionScore:'solution_score', solution_score:'solution_score',
      reusabilityScore:'reusability_score', reusability_score:'reusability_score', qualityScore:'quality_score', quality_score:'quality_score' };
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      out[map[k] || k] = v;
    }
    return out;
  }

  function _parseJSONArray(text) {
    let cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<\/?think>/g, '').trim();
    // Strip markdown code fences
    cleaned = cleaned.replace(/```(?:json|JSON)?\s*\n?([\s\S]*?)```/g, '$1').trim();
    // Strip leading reasoning text before JSON (find first [ or {)
    const firstBracket = cleaned.search(/[\[{]/);
    if (firstBracket > 0) cleaned = cleaned.substring(firstBracket);

    // Try 1: Parse complete array
    const arrStart = cleaned.indexOf('[');
    const arrEnd = cleaned.lastIndexOf(']');
    if (arrStart !== -1 && arrEnd > arrStart) {
      try {
        const arr = JSON.parse(cleaned.substring(arrStart, arrEnd + 1));
        return arr.map(_normalizeKeys);
      } catch (_) {}
    }

    // Try 2: Truncated array — find last complete "}" and close the array
    if (arrStart !== -1) {
      let lastBrace = cleaned.lastIndexOf('}');
      while (lastBrace > arrStart) {
        try {
          const repaired = cleaned.substring(arrStart, lastBrace + 1) + ']';
          const arr = JSON.parse(repaired);
          _pipelineLog('warn', `[Parse] Recovered ${arr.length} items from truncated JSON`);
          return arr.map(_normalizeKeys);
        } catch (_) {
          // Try previous closing brace
          lastBrace = cleaned.lastIndexOf('}', lastBrace - 1);
        }
      }
    }

    // Try 3: Single object
    const objStart = cleaned.indexOf('{');
    const objEnd = cleaned.lastIndexOf('}');
    if (objStart !== -1 && objEnd > objStart) {
      try {
        return [_normalizeKeys(JSON.parse(cleaned.substring(objStart, objEnd + 1)))];
      } catch (_) {}
    }

    _pipelineLog('warn', `[Parse] All parse attempts failed (${cleaned.length} chars) — preview: ${cleaned.substring(0, 200).replace(/\n/g, '⏎')}...`);
    return [];
  }

  // ── Pipeline UI helpers (tabbed) ──
  const PIPELINE_STEPS = [
    { id: 'audit1', label: 'Audit 1' },
    { id: 'refine', label: 'Refine' },
    { id: 'audit2', label: 'Audit 2' },
    { id: 'finalize', label: 'Finalize' }
  ];

  // Pipeline renders linearly into pipelineContent
  function _getPipelineContent() {
    return document.getElementById('pipelineContent');
  }

  function _pipelineStepHeader(label) {
    const el = _getPipelineContent();
    if (el) el.insertAdjacentHTML('beforeend', `<div style="font-size:10px; font-weight:700; color:var(--text3); text-transform:uppercase; letter-spacing:.5px; margin:12px 0 6px; padding-top:10px; border-top:1px solid var(--border);">${label}</div>`);
  }

  function _updatePipelineProgress(done, total, msg) {
    const fill = document.getElementById('aiRevProgressFill');
    const stage = document.getElementById('aiRevStage');
    const pctEl = document.getElementById('aiRevPct');
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    if (fill) fill.style.width = pct + '%';
    if (stage) stage.textContent = msg || `${done}/${total}`;
    if (pctEl) pctEl.textContent = pct + '%';
  }

  // ══════════════════════════════════════════════════════════
  // PIPELINE ORCHESTRATOR
  // ══════════════════════════════════════════════════════════
  async function runPostScoringPipeline() {
    const dataset = _aiReviewInput.cleaned || [];
    const scored = dataset.filter(e => e.ai_scoring);
    if (!scored.length) { showToast('No scored entries to evaluate.'); return; }

    const reportEl = document.getElementById('pipelineReport');
    const contentEl = _getPipelineContent();
    document.getElementById('aiRevProgress').style.display = '';
    reportEl.style.display = 'none';
    contentEl.innerHTML = '';

    const presetOpts = typeof getOllamaOptions === 'function' ? getOllamaOptions() : {};
    const AUDIT_BATCH = 10;
    const PARALLEL = Math.min(parseInt(document.getElementById('aiScoringParallel').value) || 5, 8);
    const TIMEOUT = 120000;
    const ticketMap = new Map();
    for (const e of dataset) ticketMap.set(String(e.ticket_id), e);

    const keeps = scored.filter(e => e.ai_scoring.keep);
    _pipelineSep();
    _pipelineLog('pipe', `Pipeline started — ${scored.length} scored, ${keeps.length} KEEP entries to audit`);

    try {
      // ════ AUDIT PASS 1 ════
      _pipelineStepHeader('Audit 1');
      _pipelineLog('pipe', `[Audit 1] Checking ${keeps.length} KEEP entries against hard rules...`);
      const audit1Result = await _runAuditPass1(scored, ticketMap, presetOpts, AUDIT_BATCH, PARALLEL, TIMEOUT, contentEl);
      _pipelineLog('pipe', `[Audit 1] Done — ${audit1Result.flagged.length} flagged, ${audit1Result.clean} clean`);

      // ════ REFINE PASS (deterministic, backend) ════
      _pipelineStepHeader('Refine');
      _pipelineLog('pipe', `[Refine] Running deterministic rules on ${keeps.length} KEEP entries...`);
      const refineResult = await _runRefinePassBackend(dataset, contentEl);
      const refineDroppedDetail = Object.entries(refineResult.dropped || {})
        .filter(([, count]) => count > 0)
        .map(([key, count]) => `${count} ${key.replace(/_/g, '-')}`)
        .join(', ');
      _pipelineLog('pipe', `[Refine] Done — ${refineResult.totalDropped} dropped${refineDroppedDetail ? ` (${refineDroppedDetail})` : ''}, ${refineResult.kept} kept`);

      // ════ AUDIT PASS 2 ════
      _pipelineStepHeader('Audit 2');
      const refinedEntries = audit1Result.flagged.filter(e => e.ai_scoring);
      if (refinedEntries.length > 0) {
        const stillKeep = refinedEntries.filter(e => e.ai_scoring.keep);
        _pipelineLog('pipe', `[Audit 2] Verifying ${stillKeep.length} entries that survived refine...`);
        const a2Result = await _runAuditPass2(refinedEntries, ticketMap, presetOpts, TIMEOUT, contentEl);
        _pipelineLog('pipe', `[Audit 2] Done — ${a2Result.verified} verified, ${a2Result.forcedDrop} force-dropped`);
      } else {
        contentEl.innerHTML += `<div style="font-size:12px; color:var(--text3);">Skipped — nothing to verify.</div>`;
        _pipelineLog('pipe', '[Audit 2] Skipped — nothing to verify');
      }

      // ════ FINALIZE ════
      _pipelineStepHeader('Finalize');
      _finalizePipeline(dataset, contentEl);
      const finalStats = _getDatasetStats(dataset);
      _pipelineLog('pipe', `[Finalize] Pipeline complete — Keep: ${finalStats.kept}, Drop: ${finalStats.dropped}, Rate: ${finalStats.scored > 0 ? Math.round(finalStats.kept/finalStats.scored*100) : 0}%`);

      // Reveal pipeline report only after all steps complete
      reportEl.style.display = '';

    } catch (err) {
      _pipelineLog('error', `Pipeline error: ${err.message}`);
      contentEl.innerHTML += `<div style="font-size:12px; color:var(--text2);">Error: ${err.message}</div>`;
    }
  }

  // ══════════════════════════════════════════════════════════
  // AUDIT PASS 1 — Identify errors in KEEP entries
  // ══════════════════════════════════════════════════════════
  const _AUDIT_SYSTEM_PROMPT = `You are a JSON API.

Return ONLY a valid JSON array.
No explanation. No reasoning. No extra text.

If you output anything outside JSON, it is INVALID.

-------------------------

TASK:
Audit existing scoring results.

Flag = true if ANY rule is violated.

-------------------------
RULES
-------------------------

Flag if:
- no actionable solution
- not reusable
- only suggestion/investigation
- quality_score < 6 AND keep = true
- noise content

-------------------------
ERROR TYPES (ONLY USE THESE)
-------------------------

- "no_solution"
- "not_reusable"
- "non_actionable"
- "low_quality"
- "noise"
- null

-------------------------
OUTPUT FORMAT
-------------------------

[
  {
    "ticket_id": 123,
    "flagged": true,
    "error_type": "not_reusable",
    "reason": "admin action"
  }
]`;

  async function _runAuditPass1(scored, ticketMap, presetOpts, BATCH_SIZE, PARALLEL, TIMEOUT, contentEl) {
    const keeps = scored.filter(e => e.ai_scoring && e.ai_scoring.keep === true);
    const t0 = Date.now();

    if (!keeps.length) {
      contentEl.innerHTML = `<div style="font-size:12px; color:var(--text3);">No KEEP entries to audit.</div>`;
      return { flagged: [], clean: 0, total: 0 };
    }



    // Build batches
    const batches = [];
    for (let i = 0; i < keeps.length; i += BATCH_SIZE) batches.push(keeps.slice(i, i + BATCH_SIZE));

    const flaggedEntries = [];
    let audited = 0, cleanCount = 0, errors = 0, batchesDone = 0;
    const errorTypes = {};

    async function processBatch(batch) {
      const ticketLines = batch.map((e, i) => {
        const s = e.ai_scoring;
        return `--- TICKET ${i + 1} ---\nticket_id: ${e.ticket_id}\nScores: N:${s.noise_score} S:${s.solution_score} R:${s.reusability_score} Q:${s.quality_score} keep:${s.keep}\nReason: ${s.reason || '(none)'}\nProblem: ${(e.problem || '').substring(0, 500)}\nSolution: ${(e.solution || '').substring(0, 500)}`;
      }).join('\n\n');

      const userPrompt = `Audit these ${batch.length} KEEP entries:\n\n${ticketLines}\n\nReturn a JSON array with ${batch.length} elements.`;
      const llmOpts = { num_predict: Math.max(presetOpts.num_predict || 4096, 4096) };

      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const _wt = (p) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), TIMEOUT))]);
          const response = await _wt(_pipelineLLMCall(userPrompt, _AUDIT_SYSTEM_PROMPT, llmOpts));
          let results = _parseJSONArray(response);
          if (results.length === 0 && attempt < 2) {
            _pipelineLog('warn', `[Audit 1] Batch ${batchesDone+1}: 0 parsed (${(response||'').length} chars), retrying... Preview: ${(response||'').substring(0, 200).replace(/\n/g, '⏎')}`);
            continue;
          }

          // Map results to entries
          const resultMap = new Map();
          for (const r of results) { if (r.ticket_id !== undefined) resultMap.set(String(r.ticket_id), r); }
          if (resultMap.size === 0 && results.length === batch.length) {
            for (let i = 0; i < results.length; i++) { results[i].ticket_id = batch[i].ticket_id; resultMap.set(String(batch[i].ticket_id), results[i]); }
          }

          let batchFlagged = 0, batchClean = 0, batchErr = 0;
          for (const entry of batch) {
            const ar = resultMap.get(String(entry.ticket_id));
            if (!ar) { errors++; batchErr++; continue; }
            audited++;
            if (ar.flagged) {
              entry._audit1 = { flagged: true, error_type: ar.error_type || 'unknown', reason: ar.reason || '' };
              flaggedEntries.push(entry);
              batchFlagged++;
              if (ar.error_type) errorTypes[ar.error_type] = (errorTypes[ar.error_type] || 0) + 1;
            } else {
              cleanCount++;
              batchClean++;
              entry._audit1 = { flagged: false };
            }
          }
          _pipelineLog('pipe', `[Audit 1] Batch ${batchesDone+1}/${batches.length}: ${batchFlagged} flagged, ${batchClean} clean${batchErr ? ', '+batchErr+' errors' : ''}`);
          return;
        } catch (e) {
          _pipelineLog('warn', `[Audit 1] Batch ${batchesDone+1} attempt ${attempt}/2 error: ${e.message}`);
          if (attempt >= 2) errors += batch.length;
        }
      }
    }

    // Run batches in parallel
    let batchIdx = 0;
    const workers = [];
    for (let w = 0; w < Math.min(PARALLEL, batches.length); w++) {
      workers.push((async () => {
        while (batchIdx < batches.length && !AI_REVIEWER.aborted) {
          const myIdx = batchIdx++;
          if (myIdx >= batches.length) break;
          await processBatch(batches[myIdx]);
          batchesDone++;
          _updatePipelineProgress(batchesDone, batches.length, `Audit 1: ${batchesDone}/${batches.length} batches — ${flaggedEntries.length} flagged`);
        }
      })());
    }
    await Promise.all(workers);

    const sec = ((Date.now() - t0) / 1000).toFixed(1);

    // Render results
    let html = `<div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">
      <span style="font-size:11px; font-weight:600; padding:2px 8px; border-radius:3px; color:#fff; background:var(--text);">${flaggedEntries.length} flagged</span>
      <span style="font-size:11px; color:var(--text3);">${audited} audited · ${cleanCount} clean · ${errors} errors · ${sec}s</span>
    </div>`;

    // Error type breakdown
    const etKeys = Object.keys(errorTypes);
    if (etKeys.length > 0) {
      html += `<div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:12px;">`;
      for (const [type, count] of Object.entries(errorTypes).sort((a, b) => b[1] - a[1])) {
        html += `<span style="font-size:11px; padding:2px 8px; background:var(--bg2); border-radius:3px; border:1px solid var(--border);"><span style="color:var(--text); font-weight:600;">${count}</span> <span style="color:var(--text3);">${type.replace(/_/g, ' ')}</span></span>`;
      }
      html += `</div>`;
    }

    contentEl.innerHTML += html;
    return { flagged: flaggedEntries, clean: cleanCount, total: audited, errorTypes };
  }

  // ══════════════════════════════════════════════════════════
  // REFINE PASS — Re-score only flagged entries with feedback
  // ══════════════════════════════════════════════════════════
  // ── Deterministic Refine via backend ──
  async function _runRefinePassBackend(dataset, contentEl) {
    const t0 = Date.now();
    try {
      const resp = await fetch('/kb/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dataset),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
      const result = await resp.json();
      const stats = result.stats;
      const sec = ((Date.now() - t0) / 1000).toFixed(1);

      // Sync backend mutations back into local dataset
      if (result.dataset) {
        for (let i = 0; i < result.dataset.length; i++) {
          dataset[i].ai_scoring = result.dataset[i].ai_scoring;
        }
      }

      const droppedParts = Object.entries(stats.dropped || {})
        .filter(([, count]) => count > 0)
        .map(([key, count]) => `${count} ${key.replace(/_/g, '-')}`);

      contentEl.innerHTML += `<div style="display:flex; align-items:center; gap:10px; margin-bottom:12px; flex-wrap:wrap;">
        <span style="font-size:11px; color:var(--text3);">${stats.processed} checked — </span>
        <span style="font-size:11px; font-weight:600; color:var(--text);">${stats.totalDropped} dropped</span>
        <span style="font-size:11px; font-weight:600; color:var(--text3);">${stats.kept} kept</span>
        ${droppedParts.length ? `<span style="font-size:11px; color:var(--text3);">${droppedParts.join(' · ')}</span>` : ''}
        <span style="font-size:11px; color:var(--text3);">${sec}s</span>
      </div>`;

      return stats;
    } catch (err) {
      _pipelineLog('error', `[Refine] Backend error: ${err.message}`);
      contentEl.innerHTML += `<div style="font-size:12px; color:var(--text2);">Refine error: ${err.message}</div>`;
      return { kept: 0, totalDropped: 0, dropped: {} };
    }
  }

  // ── Legacy LLM Refine (kept for reference) ──
  async function _runRefinePass(flaggedEntries, ticketMap, presetOpts, BATCH_SIZE, PARALLEL, TIMEOUT, contentEl) {
    const t0 = Date.now();
    // Tab already shows label — no header needed


    const refineSystemPrompt = `You are a JSON API.
You NEVER output natural language.
You NEVER explain.
You NEVER think out loud.
You are Refine Pass.
Your ONLY job:
Fix tickets that were flagged.
-------------------------
RULES
-------------------------
- If flagged = false → return original unchanged
- If flagged = true:
  Apply correction based on error_type
-------------------------
CORRECTION LOGIC
-------------------------
- "no_solution" → solution_score = 0, keep = false
- "not_reusable" → reusability_score = 0, keep = false
- "non_actionable" → solution_score = 0, keep = false
- "low_quality" → quality_score < 6, keep = false
- "noise" → noise_score = 0, keep = false
- If ANY score becomes 0 → quality_score MUST be 0
-------------------------
OUTPUT (STRICT JSON ARRAY)
-------------------------
Each item:
{
  "ticket_id": number,
  "noise_score": 0 or 1,
  "solution_score": 0 or 1,
  "reusability_score": 0 or 1,
  "quality_score": number,
  "keep": true or false,
  "reason": "corrected"
}
-------------------------
STRICT RULES
-------------------------
- DO NOT re-evaluate from scratch
- DO NOT add new reasoning
- ONLY apply corrections
- ONLY JSON
- No explanation, no extra text, no markdown
- If output is not valid JSON, it is invalid`;

    const batches = [];
    for (let i = 0; i < flaggedEntries.length; i += BATCH_SIZE) batches.push(flaggedEntries.slice(i, i + BATCH_SIZE));

    let refined = 0, keptAfter = 0, droppedAfter = 0, errors = 0, batchesDone = 0;

    async function processBatch(batch) {
      const ticketLines = batch.map((e, i) => {
        const s = e.ai_scoring;
        const a = e._audit1 || {};
        return `--- TICKET ${i + 1} ---\nticket_id: ${e.ticket_id}\nAUDIT FLAG: ${a.error_type || 'unknown'} — ${a.reason || ''}\nOriginal scores: N:${s.noise_score} S:${s.solution_score} R:${s.reusability_score} Q:${s.quality_score} keep:${s.keep}\nProblem: ${(e.problem || '').substring(0, 500)}\nSolution: ${(e.solution || '').substring(0, 500)}`;
      }).join('\n\n');

      const userPrompt = `Re-evaluate these ${batch.length} flagged tickets:\n\n${ticketLines}\n\nReturn a JSON array with ${batch.length} elements.`;
      const llmOpts = { num_predict: Math.max(presetOpts.num_predict || 4096, 4096) };

      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const _wt = (p) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), TIMEOUT))]);
          const response = await _wt(_pipelineLLMCall(userPrompt, refineSystemPrompt, llmOpts));
          let results = _parseJSONArray(response);
          if (results.length === 0 && attempt < 2) {
            _pipelineLog('warn', `[Refine] Batch ${batchesDone+1}: 0 parsed (${(response||'').length} chars), retrying... Preview: ${(response||'').substring(0, 200).replace(/\n/g, '⏎')}`);
            continue;
          }

          const resultMap = new Map();
          for (const r of results) { if (r.ticket_id !== undefined) resultMap.set(String(r.ticket_id), r); }
          if (resultMap.size === 0 && results.length === batch.length) {
            for (let i = 0; i < results.length; i++) { results[i].ticket_id = batch[i].ticket_id; resultMap.set(String(batch[i].ticket_id), results[i]); }
          }

          let batchKept = 0, batchDropped = 0;
          for (const entry of batch) {
            const rr = resultMap.get(String(entry.ticket_id));
            if (!rr) { errors++; continue; }
            refined++;
            entry.ai_scoring.noise_score = rr.noise_score ?? entry.ai_scoring.noise_score;
            entry.ai_scoring.solution_score = rr.solution_score ?? entry.ai_scoring.solution_score;
            entry.ai_scoring.reusability_score = rr.reusability_score ?? entry.ai_scoring.reusability_score;
            entry.ai_scoring.quality_score = rr.quality_score ?? entry.ai_scoring.quality_score;
            entry.ai_scoring.keep = !!rr.keep;
            entry.ai_scoring.reason = rr.reason || entry.ai_scoring.reason;
            entry.ai_scoring.refined = true;
            if (entry.ai_scoring.keep) { keptAfter++; batchKept++; } else { droppedAfter++; batchDropped++; }
          }
          _pipelineLog('pipe', `[Refine] Batch ${batchesDone+1}/${batches.length}: ${batchDropped} dropped, ${batchKept} kept`);
          return;
        } catch (e) {
          _pipelineLog('warn', `[Refine] Batch ${batchesDone+1} attempt ${attempt}/2 error: ${e.message}`);
          if (attempt >= 2) errors += batch.length;
        }
      }
    }

    let batchIdx = 0;
    const workers = [];
    for (let w = 0; w < Math.min(PARALLEL, batches.length); w++) {
      workers.push((async () => {
        while (batchIdx < batches.length && !AI_REVIEWER.aborted) {
          const myIdx = batchIdx++;
          if (myIdx >= batches.length) break;
          await processBatch(batches[myIdx]);
          batchesDone++;
          _updatePipelineProgress(batchesDone, batches.length, `Refine: ${batchesDone}/${batches.length} batches — ${droppedAfter} → DROP, ${keptAfter} still KEEP`);
        }
      })());
    }
    await Promise.all(workers);

    const sec = ((Date.now() - t0) / 1000).toFixed(1);
    contentEl.innerHTML += `<div style="display:flex; align-items:center; gap:10px; margin-bottom:12px;">
      <span style="font-size:11px; color:var(--text3);">${refined} re-scored — </span>
      <span style="font-size:11px; font-weight:600; color:var(--text);">${droppedAfter} dropped</span>
      <span style="font-size:11px; font-weight:600; color:var(--text3);">${keptAfter} kept</span>
      <span style="font-size:11px; color:var(--text3);">${errors > 0 ? errors + ' errors' : ''} ${sec}s</span>
    </div>`;

    return { refined, keptAfter, droppedAfter, errors };
  }

  // ══════════════════════════════════════════════════════════
  // AUDIT PASS 2 — Verify refinements (final safety net)
  // ══════════════════════════════════════════════════════════
  async function _runAuditPass2(refinedEntries, ticketMap, presetOpts, TIMEOUT, contentEl) {
    const t0 = Date.now();
    // Tab already shows label — no header needed

    // Only check entries that Refine kept as KEEP (these need verification)
    const stillKeep = refinedEntries.filter(e => e.ai_scoring && e.ai_scoring.keep === true);
    if (!stillKeep.length) {
      contentEl.innerHTML = `<div style="font-size:12px; color:var(--text3);">All flagged entries dropped by refine. Nothing to verify.</div>`;
      return { verified: 0, forcedDrop: 0 };
    }


    _updatePipelineProgress(0, 1, `Audit 2: verifying ${stillKeep.length} entries...`);

    // Use same audit prompt but in a single batch (these are the survivors — usually small count)
    const ticketLines = stillKeep.map((e, i) => {
      const s = e.ai_scoring;
      const a = e._audit1 || {};
      return `--- TICKET ${i + 1} ---\nticket_id: ${e.ticket_id}\nOriginal audit flag: ${a.error_type || '?'} — ${a.reason || '?'}\nRefine result: N:${s.noise_score} S:${s.solution_score} R:${s.reusability_score} Q:${s.quality_score} keep:${s.keep}\nReason: ${s.reason}\nProblem: ${(e.problem || '').substring(0, 500)}\nSolution: ${(e.solution || '').substring(0, 500)}`;
    }).join('\n\n');

    const audit2Prompt = `You are a JSON API.
You NEVER output natural language.
You NEVER explain.
You NEVER think out loud.
You are Final Audit Pass.
Your ONLY job:
Enforce rules strictly.
-------------------------
RULES
-------------------------
keep = true ONLY IF:
- noise_score = 1
- solution_score = 1
- reusability_score = 1
- quality_score >= 6
If ANY condition fails → force keep = false
-------------------------
OUTPUT
-------------------------
{
  "ticket_id": number,
  "noise_score": 0 or 1,
  "solution_score": 0 or 1,
  "reusability_score": 0 or 1,
  "quality_score": number,
  "keep": true or false,
  "reason": "final validated"
}
-------------------------
STRICT RULES
-------------------------
- DO NOT explain
- DO NOT reinterpret
- ONLY enforce rules
- ONLY JSON`;

    const userPrompt = `Final audit of ${stillKeep.length} entries:\n\n${ticketLines}\n\nReturn a JSON array with ${stillKeep.length} elements.`;
    const llmOpts = { num_predict: presetOpts.num_predict || 4096 };

    let verified = 0, forcedDrop = 0;
    try {
      const _wt = (p) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), TIMEOUT))]);
      const response = await _wt(_pipelineLLMCall(userPrompt, audit2Prompt, llmOpts));
      const results = _parseJSONArray(response);

      const resultMap = new Map();
      for (const r of results) { if (r.ticket_id !== undefined) resultMap.set(String(r.ticket_id), r); }
      if (resultMap.size === 0 && results.length === stillKeep.length) {
        for (let i = 0; i < results.length; i++) { results[i].ticket_id = stillKeep[i].ticket_id; resultMap.set(String(stillKeep[i].ticket_id), results[i]); }
      }

      for (const entry of stillKeep) {
        const ar = resultMap.get(String(entry.ticket_id));
        if (!ar) continue;
        verified++;
        // Apply LLM's final scores
        entry.ai_scoring.noise_score = ar.noise_score ?? entry.ai_scoring.noise_score;
        entry.ai_scoring.solution_score = ar.solution_score ?? entry.ai_scoring.solution_score;
        entry.ai_scoring.reusability_score = ar.reusability_score ?? entry.ai_scoring.reusability_score;
        entry.ai_scoring.quality_score = ar.quality_score ?? entry.ai_scoring.quality_score;
        entry.ai_scoring.keep = !!ar.keep;
        if (ar.reason) entry.ai_scoring.reason = ar.reason;
        if (!entry.ai_scoring.keep) {
          entry.ai_scoring.audit2_forced = true;
          forcedDrop++;
        }
      }
    } catch (err) {
      contentEl.innerHTML += `<div style="padding:6px 12px; background:var(--bg2); border-radius:6px; border-left:3px solid var(--text3); margin-bottom:8px; font-size:11px; color:var(--text2);">Audit 2 error: ${err.message}</div>`;
    }

    _updatePipelineProgress(1, 1, 'Audit 2 complete');
    const sec = ((Date.now() - t0) / 1000).toFixed(1);
    contentEl.innerHTML += `<div style="display:flex; align-items:center; gap:10px; margin-bottom:12px;">
      <span style="font-size:11px; color:var(--text3);">${verified} verified —</span>
      ${forcedDrop > 0
        ? `<span style="font-size:11px; font-weight:600; color:var(--text);">${forcedDrop} force-dropped</span>`
        : `<span style="font-size:11px; font-weight:600; color:var(--text3);">all clean</span>`}
      <span style="font-size:11px; color:var(--text3);">${sec}s</span>
    </div>`;

    return { verified, forcedDrop };
  }

  // ══════════════════════════════════════════════════════════
  // FINALIZE — Lock results, update UI, save
  // ══════════════════════════════════════════════════════════
  function _finalizePipeline(dataset, contentEl) {
    // Tab already shows label — no header needed

    // ── Non-LLM hard logic: enforce keep rules deterministically ──
    let hardLogicFixed = 0;
    const allScored = dataset.filter(e => e.ai_scoring);
    for (const entry of allScored) {
      const s = entry.ai_scoring;
      const shouldKeep = (s.noise_score <= 1 && s.solution_score === 1 && s.reusability_score === 1 && s.quality_score >= 6);
      if (s.keep && !shouldKeep) {
        s.keep = false;
        s.reason = `[Finalize] scores inconsistent: N:${s.noise_score} S:${s.solution_score} R:${s.reusability_score} Q:${s.quality_score}`;
        s.finalize_forced = true;
        hardLogicFixed++;
      } else if (!s.keep && shouldKeep) {
        // Don't force keep — if pipeline dropped it, respect that decision
      }
    }
    if (hardLogicFixed > 0) _pipelineLog('warn', `[Finalize] Hard logic fixed ${hardLogicFixed} inconsistent entries (keep=true but scores say DROP)`);

    const stats = _getDatasetStats(dataset);
    const rate = stats.scored > 0 ? Math.round(stats.kept / stats.scored * 100) : 0;
    const audit1Flagged = allScored.filter(e => e._audit1 && e._audit1.flagged).length;
    const refinedDropped = allScored.filter(e => e.ai_scoring.refined && !e.ai_scoring.keep).length;
    const audit2Forced = allScored.filter(e => e.ai_scoring.audit2_forced).length;
    const finalizeForced = allScored.filter(e => e.ai_scoring.finalize_forced).length;
    const totalCorrected = refinedDropped + audit2Forced + finalizeForced;

    let html = `<div style="display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin-bottom:14px;">
      <div style="text-align:center; padding:8px 0; background:var(--bg2); border-radius:6px;">
        <div style="font-size:10px; color:var(--text3); text-transform:uppercase; letter-spacing:.3px;">Total</div>
        <div style="font-size:16px; font-weight:600; color:var(--text);">${stats.scored}</div>
      </div>
      <div style="text-align:center; padding:8px 0; background:var(--bg2); border-radius:6px;">
        <div style="font-size:10px; color:var(--text3); text-transform:uppercase; letter-spacing:.3px;">Keep</div>
        <div style="font-size:16px; font-weight:600; color:var(--text);">${stats.kept}</div>
      </div>
      <div style="text-align:center; padding:8px 0; background:var(--bg2); border-radius:6px;">
        <div style="font-size:10px; color:var(--text3); text-transform:uppercase; letter-spacing:.3px;">Drop</div>
        <div style="font-size:16px; font-weight:600; color:var(--text);">${stats.dropped}</div>
      </div>
      <div style="text-align:center; padding:8px 0; background:var(--bg2); border-radius:6px;">
        <div style="font-size:10px; color:var(--text3); text-transform:uppercase; letter-spacing:.3px;">Rate</div>
        <div style="font-size:16px; font-weight:600; color:var(--text);">${rate}%</div>
      </div>
    </div>`;

    // Pipeline summary
    html += `<div style="padding:8px 12px; background:var(--bg2); border-radius:6px; border-left:3px solid var(--text);">
      <div style="font-size:10px; color:var(--text3); text-transform:uppercase; margin-bottom:6px;">Pipeline Summary</div>
      <div style="display:flex; gap:16px; font-size:12px; flex-wrap:wrap;">
        <span style="color:var(--text);">Flagged: <b>${audit1Flagged}</b></span>
        <span style="color:var(--text);">Corrected: <b>${totalCorrected}</b></span>
        <span style="color:var(--text3);">Survived: <b>${audit1Flagged - totalCorrected}</b></span>
        ${audit2Forced > 0 ? `<span style="color:var(--text);">Force-dropped: <b>${audit2Forced}</b></span>` : ''}
        ${finalizeForced > 0 ? `<span style="color:var(--text);">Finalize-fixed: <b>${finalizeForced}</b></span>` : ''}
      </div>
    </div>`;

    contentEl.innerHTML += html;

    // Update scoring report + status bar
    renderScoringReport({ total: stats.total, scored: stats.scored, kept: stats.kept, dropped: stats.dropped });
    refreshScoringStatusBar();

    // Save to cache
    if (!_scoringIsTest) saveScoringProgress(dataset);

    // Clean up temp audit markers
    for (const e of dataset) { delete e._audit1; }
  }


  function parseScoringBatchResponse(text, batch) {
    const results = [];
    const _valid = (obj) => {
      if (obj.ticket_id === undefined) return false;
      // Accept new 4-dimension format or legacy keep-only format
      if (typeof obj.keep === 'boolean') return true;
      if (typeof obj.noise_score === 'number' && typeof obj.final_decision === 'string') {
        // Derive keep from final_decision
        obj.keep = obj.final_decision === 'keep';
        return true;
      }
      if (typeof obj.noise_score === 'number') {
        // Derive keep from dimension scores
        obj.keep = obj.noise_score <= 1 && obj.solution_score === 1 && obj.reusability_score === 1 && (obj.quality_score || 0) >= 6;
        return true;
      }
      return false;
    };

    // Pre-clean: strip think tags and code blocks
    let cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<\/?think>/g, '').trim();
    cleaned = cleaned.replace(/^```json\s*/gm, '').replace(/^```\s*$/gm, '').trim();

    // Strategy 1: Try parsing as a JSON array first (prompt asks for JSON array)
    try {
      const arrStart = cleaned.indexOf('[');
      const arrEnd = cleaned.lastIndexOf(']');
      if (arrStart >= 0 && arrEnd > arrStart) {
        const arr = JSON.parse(cleaned.substring(arrStart, arrEnd + 1));
        if (Array.isArray(arr)) {
          for (const obj of arr) {
            if (_valid(obj)) results.push(obj);
          }
          if (results.length > 0) return results;
        }
      }
    } catch (_) {}

    // Strategy 1b: Fix truncated JSON array — find last complete "}" and close the array
    if (results.length === 0) {
      const arrStart = cleaned.indexOf('[');
      if (arrStart >= 0) {
        let fragment = cleaned.substring(arrStart);
        // Find last complete object by finding last "}"
        const lastBrace = fragment.lastIndexOf('}');
        if (lastBrace > 0) {
          fragment = fragment.substring(0, lastBrace + 1) + ']';
          // Strip any trailing comma before the added "]"
          fragment = fragment.replace(/,\s*\]$/, ']');
          try {
            const arr = JSON.parse(fragment);
            if (Array.isArray(arr)) {
              for (const obj of arr) {
                if (_valid(obj)) results.push(obj);
              }
              if (results.length > 0) return results;
            }
          } catch (_) {}
        }
      }
    }

    // Strategy 2: line-by-line JSON extraction
    cleaned.split('\n').forEach(line => {
      let trimmed = line.trim();
      trimmed = trimmed.replace(/^\d+[\.\)]\s*/, '');  // strip numbering
      trimmed = trimmed.replace(/,\s*$/, '');           // strip trailing comma
      if (!trimmed.startsWith('{')) return;
      try {
        const obj = JSON.parse(trimmed);
        if (_valid(obj)) results.push(obj);
      } catch (_) {
        const start = trimmed.indexOf('{');
        const end = trimmed.lastIndexOf('}');
        if (start >= 0 && end > start) {
          try {
            const obj = JSON.parse(trimmed.substring(start, end + 1));
            if (_valid(obj)) results.push(obj);
          } catch (_) {}
        }
      }
    });

    if (results.length >= batch.length) return results;

    // Strategy 3: brace-depth extraction for multi-line JSON objects
    const existing = new Set(results.map(r => String(r.ticket_id)));
    let depth = 0, buf = '';
    for (let i = 0; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (ch === '{') { if (depth === 0) buf = ''; depth++; }
      if (depth > 0) buf += ch;
      if (ch === '}') {
        depth--;
        if (depth === 0 && buf) {
          try {
            const obj = JSON.parse(buf);
            if (_valid(obj) && !existing.has(String(obj.ticket_id))) {
              results.push(obj);
              existing.add(String(obj.ticket_id));
            }
          } catch (_) {}
          buf = '';
        }
      }
    }

    return results;
  }

  function _toKbFormat(entries) {
    return entries.map(e => {
      const out = {
        ticket_id:         e.ticket_id         ?? null,
        issue_type:        e.issue_type        ?? null,
        problem:           e.problem           ?? '',
        solution:          e.solution          ?? '',
        technical_signals: e.technical_signals ?? {},
        created_at:        e.created_at        ?? null,
        source_date:       e.source_date       ?? null,
        content_age_days:  e.content_age_days  ?? null,
        recency_band:      e.recency_band      ?? null,
        staleness_risk:    e.staleness_risk    ?? null,
        recency_weight:    e.recency_weight    ?? null,
        ai_scoring:        e.ai_scoring        ?? null,
      };
      if (e.qa_valid !== undefined) out.qa_valid = e.qa_valid;
      if (e.qa_reason !== undefined) out.qa_reason = e.qa_reason;
      return out;
    });
  }

  function _toValidatedKeepFormat(entries) {
    return entries.map(e => ({
      ticket_id:         e.ticket_id         ?? null,
      issue_type:        e.issue_type        ?? null,
      problem:           e.problem           ?? '',
      solution:          e.solution          ?? '',
      problem_summary:   e.problem_summary   ?? '',
      solution_summary:  e.solution_summary  ?? '',
      action_steps:      Array.isArray(e.action_steps) ? e.action_steps : [],
      likely_cause:      e.likely_cause      ?? '',
      keywords:          Array.isArray(e.keywords) ? e.keywords : [],
      technical_signals: e.technical_signals ?? {},
      created_at:        e.created_at        ?? null,
      source_date:       e.source_date       ?? null,
      content_age_days:  e.content_age_days  ?? null,
      recency_band:      e.recency_band      ?? null,
      staleness_risk:    e.staleness_risk    ?? null,
      recency_weight:    e.recency_weight    ?? null,
      classification_version: e.classification_version ?? null,
      generalization_version: e.generalization_version ?? null,
      extraction_version: e.extraction_version ?? null
    }));
  }

    function _downloadScoringResult(type) {
    if (!window._scoringOutput) return;
    const dataset = window._scoringOutput;
    let data, filename;
    const date = new Date().toISOString().split('T')[0];

    if (type === 'kept') {
      // Keep only: strip to 6-field RAG format, plain array
      const kept = dataset.filter(e => e.ai_scoring && e.ai_scoring.keep);
      data = _toKbFormat(kept);
      filename = `kb_keep_${date}.json`;
    } else {
      // All scored: include ai_scoring for reference
      data = dataset.filter(e => e.ai_scoring);
      filename = `scored_all_${date}.json`;
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click(); URL.revokeObjectURL(a.href);
    showToast(type === 'kept' ? `Downloaded ${data.length} entries → ${filename}` : `Downloaded ${data.length} entries with scores.`);
  }

  async function startAiReview() {
    // Route based on mode
    const reviewMode = document.getElementById('aiReviewMode').value;
    if (reviewMode === 'diagnostics' || reviewMode === 'scoring' || reviewMode === 'normalize' || reviewMode === 'generalize' || reviewMode === 'extraction' || reviewMode === 'validation') {
      return startAiBackendJob(reviewMode);
    }
    // Unknown mode
    showToast('Unknown AI mode: ' + reviewMode);
  }

  var _aiRunning = false;
  async function toggleAiRun() {
    try {
      if (_aiRunning) {
        stopAiReview();
      } else {
        await startAiReview();
      }
    } catch (err) {
      console.error('AI review run failed', err);
      setAiRunning(false, getAiModeLabel(document.getElementById('aiReviewMode')?.value));
      showToast(err?.message || 'Failed to start AI Review');
    }
  }
  function setAiRunning(running, label) {
    const btn = document.getElementById('btnRunAiReview');
    _aiRunning = running;
    if (running) {
      btn.disabled = false;
      btn.textContent = 'Stop';
      btn.className = 'btn';
      btn.style.background = '#000';
      btn.style.color = '#fff';
    } else {
      btn.disabled = false;
      btn.textContent = label || 'Run AI Diagnostics';
      btn.className = 'btn btn-go';
      btn.style.background = '';
      btn.style.color = '';
    }
  }

  function setAiStopping(label) {
    const btn = document.getElementById('btnRunAiReview');
    _aiRunning = true;
    if (!btn) return;
    btn.disabled = true;
    btn.textContent = label || 'Stopping...';
    btn.className = 'btn';
    btn.style.background = '#d9d9d9';
    btn.style.color = '#666';
  }

  function stopAiReview() {
    AI_REVIEWER.aborted = true;
    if (activeAiPipelineJobId) {
      fetch(`${KB_BASE}/ai-jobs/${activeAiPipelineJobId}/stop`, { method: 'POST' }).catch(() => {});
      const stage = document.getElementById('aiRevStage');
      if (stage) stage.textContent = `Stopping ${activeAiPipelineMode || 'AI'} job...`;
      setAiStopping();
      return;
    }
    // Save partial scoring progress on abort so it can be resumed (skip in test mode)
    if (!_scoringIsTest && _scoringCacheKey && _aiReviewInput.cleaned) {
      saveScoringProgress(_aiReviewInput.cleaned);
    }
  }

  function buildAiRevCard(entry, review, mode) {
    const tid = entry.ticket_id;
    const v = review.verdict;
    const p = (entry.problem || '').substring(0, 250);
    const s = (entry.solution || '').substring(0, 250);
    const ep = typeof review.edits?.problem === 'string' ? review.edits.problem : '';
    const es = typeof review.edits?.solution === 'string' ? review.edits.solution : '';

    // Mode class for left-border color
    const modeClass = mode === 'flagged' ? 'mode-flagged' : mode === 'rescue' ? 'mode-rescue' : mode === 'edit' ? 'mode-edit' : 'mode-browse';

    // Verdict badge — rescue mode gets special badge
    const badgeClass = mode === 'rescue' ? 'rescue' : v;
    const badgeLabel = mode === 'rescue' ? 'rescue' : v;

    // Source tag for rescued entries
    const removalReason = entry._removal_reason ? `<span class="ai-rev-removal-tag">removed by: ${escHtml(entry._removal_reason)}</span>` : '';

    // Content section — different per mode
    let contentHtml = '';

    if (mode === 'flagged') {
      // Flagged: show problem + solution (muted), emphasize reason
      contentHtml = `
        <div class="ai-rev-reason">${escHtml(review.reason || '')}</div>
        <div class="ai-rev-text"><strong>Problem:</strong> ${escHtml(p)}</div>
        <div class="ai-rev-text"><strong>Solution:</strong> ${escHtml(s)}</div>`;

    } else if (mode === 'rescue') {
      // Rescue: show why AI thinks it should be kept, original removal reason
      contentHtml = `
        <div class="ai-rev-reason">${escHtml(review.reason || '')}</div>
        ${removalReason ? `<div style="margin-bottom:6px;">${removalReason}</div>` : ''}
        <div class="ai-rev-text"><strong>Problem:</strong> ${escHtml(p)}</div>
        <div class="ai-rev-text"><strong>Solution:</strong> ${escHtml(s)}</div>`;

    } else if (mode === 'edit') {
      // Edit: show original → suggested side by side
      contentHtml = `<div class="ai-rev-reason">${escHtml(review.reason || '')}</div>`;
      if (ep) {
        contentHtml += `<div class="ai-rev-diff">
          <div class="ai-diff-label">Problem</div>
          <div class="ai-diff-old">${escHtml(p)}</div>
          <div class="ai-diff-new">${escHtml(ep.substring(0,300))}</div>
        </div>`;
      }
      if (es) {
        contentHtml += `<div class="ai-rev-diff">
          <div class="ai-diff-label">Solution</div>
          <div class="ai-diff-old">${escHtml(s)}</div>
          <div class="ai-diff-new">${escHtml(es.substring(0,300))}</div>
        </div>`;
      }
      if (!ep && !es) {
        contentHtml += `<div class="ai-rev-text"><strong>Problem:</strong> ${escHtml(p)}</div>
          <div class="ai-rev-text"><strong>Solution:</strong> ${escHtml(s)}</div>`;
      }

    } else {
      // Browse: compact, show verdict + reason + brief content
      contentHtml = `
        <div class="ai-rev-reason">${escHtml(review.reason || '')}</div>
        <div class="ai-rev-text"><strong>P:</strong> ${escHtml(p.substring(0,120))}${p.length>120?'…':''}</div>
        <div class="ai-rev-text"><strong>S:</strong> ${escHtml(s.substring(0,120))}${s.length>120?'…':''}</div>`;
    }

    // Actions — not for browse mode
    const actionsHtml = mode !== 'browse' ? `
      <div class="ai-rev-actions">
        <button onclick="acceptAiSuggestion('${tid}','${v}')">Accept</button>
        <button onclick="rejectAiSuggestion('${tid}')">Reject</button>
      </div>` : '';

    // Signals tags
    const signals = Array.isArray(review.signals) && review.signals.length
      ? `<div class="ai-rev-signals">${review.signals.map(s => `<span class="ai-rev-signal">${escHtml(s)}</span>`).join('')}</div>` : '';

    const ktype = review.knowledge_type && review.verdict !== 'remove' ? `<span class="ai-rev-ktype">${escHtml(review.knowledge_type)}</span>` : '';

    return `<div class="ai-rev-card ${modeClass}" data-ai-tid="${tid}">
      <div class="ai-rev-head">
        <span class="ai-rev-tid">#${tid}</span>
        <span class="ai-rev-verdict ${badgeClass}">${badgeLabel}</span>
        ${ktype}
        <span class="ai-rev-conf">${review.confidence || ''}</span>
      </div>
      ${contentHtml}
      ${signals}
      ${actionsHtml}
    </div>`;
  }

  /* escHtml provided by shared.js */

  // ── AI Review: Export functions ──
  function applyAiReviewAndExport() {
    if (!AI_REVIEWER.results) { showToast('No AI review results yet — run AI Review first'); return; }
    const dataset = [...(_aiReviewInput.cleaned || DEEP_CLEAN.cleanedData || QA_PIPELINE.cleanedData || [])];

    // Apply accepted edits
    AI_REVIEWER.results.edits.forEach(item => {
      const state = _aiSuggestions[item.entry.ticket_id];
      if (state?.accepted && item.review.edits) {
        const idx = dataset.findIndex(e => String(e.ticket_id) === String(item.entry.ticket_id));
        if (idx >= 0) {
          if (item.review.edits.problem) dataset[idx].problem = item.review.edits.problem;
          if (item.review.edits.solution) dataset[idx].solution = item.review.edits.solution;
        }
      }
    });

    // Remove accepted flagged entries
    const flaggedAccepted = new Set();
    AI_REVIEWER.results.flagged.forEach(item => {
      if (_aiSuggestions[item.entry.ticket_id]?.accepted) flaggedAccepted.add(String(item.entry.ticket_id));
    });
    const filtered = dataset.filter(e => !flaggedAccepted.has(String(e.ticket_id)));

    // Add accepted rescue entries
    AI_REVIEWER.results.rescue.forEach(item => {
      if (_aiSuggestions[item.entry.ticket_id]?.accepted) {
        const exists = filtered.find(e => String(e.ticket_id) === String(item.entry.ticket_id));
        if (!exists) {
          const rescued = {...item.entry};
          delete rescued._source;
          if (item.review.edits?.problem) rescued.problem = item.review.edits.problem;
          if (item.review.edits?.solution) rescued.solution = item.review.edits.solution;
          filtered.push(rescued);
        }
      }
    });

    const output = _toKbFormat(filtered);

    const date = new Date().toISOString().split('T')[0];
    const blob = new Blob([JSON.stringify(output, null, 2)], {type:'application/json'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `ai_filtered_${date}.json`;
    a.click(); URL.revokeObjectURL(a.href);
    showToast(`Downloaded ${output.length} entries → ai_filtered_${date}.json`);
  }

  function exportAiReviewReport() {
    if (!AI_REVIEWER.results) { showToast('No AI review results yet'); return; }
    const S = AI_REVIEWER.stats;
    const lines = [
      '# AI Review Report',
      `Date: ${new Date().toISOString()}`,
      `Model: ${AI_REVIEWER.model}`,
      '',
      '## Summary',
      `Total Reviewed: ${S.processed}/${S.total}`,
      `Errors: ${S.errors}`,
      `Verdicts: keep=${S.verdicts.keep} remove=${S.verdicts.remove} edit=${S.verdicts.edit}`,
      '',
      `## Flagged for Removal (${S.flagged})`,
    ];
    AI_REVIEWER.results.flagged.forEach(i => {
      lines.push(`- [${i.entry.ticket_id}] ${i.review.reason} (${i.review.confidence})`);
    });
    lines.push('', `## Rescue from Removal (${S.rescue})`);
    AI_REVIEWER.results.rescue.forEach(i => {
      lines.push(`- [${i.entry.ticket_id}] ${i.review.reason} (${i.review.confidence})`);
    });
    lines.push('', `## Suggested Edits (${S.edits})`);
    AI_REVIEWER.results.edits.forEach(i => {
      lines.push(`- [${i.entry.ticket_id}] ${i.review.reason}`);
    });
    lines.push('', '## Processing Log');
    AI_REVIEWER.log.forEach(l => lines.push(`[${l.t}] ${l.tag}: ${l.msg}`));

    const blob = new Blob([lines.join('\n')], {type:'text/markdown'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `ai_review_report_${new Date().toISOString().split('T')[0]}.md`;
    a.click(); URL.revokeObjectURL(a.href);
  }

  function aiReviewToRag() {
    if (!AI_REVIEWER.results) { showToast('No AI review results yet'); return; }
    // Build merged dataset and pass to RAG
    const dataset = [...(_aiReviewInput.cleaned || DEEP_CLEAN.cleanedData || QA_PIPELINE.cleanedData || [])];
    const flaggedAccepted = new Set();
    AI_REVIEWER.results.flagged.forEach(i => { if (_aiSuggestions[i.entry.ticket_id]?.accepted) flaggedAccepted.add(String(i.entry.ticket_id)); });
    const filtered = dataset.filter(e => !flaggedAccepted.has(String(e.ticket_id)));
    AI_REVIEWER.results.rescue.forEach(i => {
      if (_aiSuggestions[i.entry.ticket_id]?.accepted && !filtered.find(e => String(e.ticket_id) === String(i.entry.ticket_id))) {
        const r = {...i.entry}; delete r._source; filtered.push(r);
      }
    });
    // Apply edits
    AI_REVIEWER.results.edits.forEach(i => {
      if (_aiSuggestions[i.entry.ticket_id]?.accepted && i.review.edits) {
        const idx = filtered.findIndex(e => String(e.ticket_id) === String(i.entry.ticket_id));
        if (idx >= 0) {
          if (i.review.edits.problem) filtered[idx].problem = i.review.edits.problem;
          if (i.review.edits.solution) filtered[idx].solution = i.review.edits.solution;
        }
      }
    });

    const data = { VALID_KNOWLEDGE_DATASET: filtered };
    switchKbView('rag-format');
    setTimeout(() => runRagCore(data), 200);
    showToast(`Sending ${filtered.length} AI-reviewed entries to RAG Formatting`);
  }

  // AI Review tab switching
  document.querySelectorAll('[data-airevtab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.dataset.airevtab;
      btn.closest('.qa-tabs').querySelectorAll('.qa-tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      const panel = document.getElementById('aiReviewPanel');
      panel.querySelectorAll('.qa-tab-content').forEach(c => c.classList.remove('active'));
      document.getElementById(tabId).classList.add('active');
    });
  });

  // ─── Overview dashboard ───
  function saveProfileSnapshot(result) {
    try {
      localStorage.setItem(PROFILE_SNAPSHOT_KEY, JSON.stringify({
        ...result,
        timestamp: new Date().toISOString()
      }));
    } catch(_e) {}
  }

  function getProfileSnapshot() {
    try {
      const raw = localStorage.getItem(PROFILE_SNAPSHOT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch(_e) {
      return null;
    }
  }

  function getLatestCompletedJob(jobs) {
    const completed = (jobs || []).filter(j => j.status === 'completed');
    if (!completed.length) return null;
    return completed.sort((a,b) => {
      const ta = Date.parse(a.completedAt || a.startedAt || 0) || 0;
      const tb = Date.parse(b.completedAt || b.startedAt || 0) || 0;
      return tb - ta;
    })[0];
  }

  function formatTimestamp(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '—';
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}`;
  }

  function computeVectorHealth(latestJob) {
    return {
      indexedTickets: latestJob?.processedTickets || 0,
      embeddedVectors: latestJob?.storedChunks || latestJob?.embeddedChunks || 0,
      lastIngestTimestamp: latestJob?.completedAt || latestJob?.startedAt || null,
      embeddingModel: latestJob?.embedModel || 'nomic-embed-text',
    };
  }

  function renderOverviewDashboard() {
    const latestJob = getLatestCompletedJob(jobsCache);
    const vector = computeVectorHealth(latestJob);
    const profileSnapshot = getProfileSnapshot();
    const qaData = DEEP_CLEAN.cleanedData || QA_PIPELINE.cleanedData;
    const qaStats = DEEP_CLEAN.cleanedData ? DEEP_CLEAN.stats : QA_PIPELINE.stats;
    const ragData = RAG_ENGINE.ragDataset;

    // ── Pipeline tracker dots ──
    const setDot = (id, done, detail) => {
      const dot = document.getElementById('ovDot' + id);
      const name = document.getElementById('ovName' + id);
      const det = document.getElementById('ovDet' + id);
      if (dot) dot.className = done ? 'pipe-dot done' : 'pipe-dot';
      if (name) name.className = done ? 'pipe-name done' : 'pipe-name';
      if (det) det.textContent = detail || '—';
    };
    const setLine = (id, done) => {
      const line = document.getElementById('ovLine' + id);
      if (line) line.className = done ? 'pipe-line done' : 'pipe-line';
    };

    // Upload: check if data has been uploaded
    const uploadDone = !!latestJob || !!profileSnapshot;
    setDot('Upload', uploadDone, uploadDone ? 'Done' : '—');
    setLine('Upload', uploadDone);

    // Profiling
    const profileDone = !!profileSnapshot;
    setDot('Profile', profileDone, profileDone ? (profileSnapshot.total_tickets || '') + ' tickets' : '—');
    setLine('Profile', profileDone);

    // QA Clean
    const qaDone = qaData && qaData.length > 0;
    setDot('Qa', qaDone, qaDone ? qaData.length + ' entries' : '—');
    setLine('Qa', qaDone);

    // RAG Format
    const ragDone = ragData && ragData.length > 0;
    setDot('Rag', ragDone, ragDone ? ragData.length + ' docs' : '—');
    setLine('Rag', ragDone);

    // Ingestion
    const ingestDone = vector.embeddedVectors > 0;
    setDot('Ingest', ingestDone, ingestDone ? vector.embeddedVectors + ' vectors' : '—');

    // ── Dataset metrics — prefer RAG output, fallback to QA ──
    const docs = ragDone ? ragData : (qaDone ? qaData : null);
    const ragStats = RAG_ENGINE.stats;
    const usingRag = ragDone && ragData;

    // Update section label to show data source
    document.getElementById('ovDatasetLabel').textContent = usingRag ? 'RAG Dataset' : (qaDone ? 'QA Cleaned Dataset' : 'Dataset');
    document.getElementById('ovTechSignalsLbl').textContent = usingRag ? 'Components' : 'Tech Signals';
    document.getElementById('ovAvgSolLenLbl').textContent = usingRag ? 'Avg Embed Len' : 'Avg Solution Len';

    if (docs && docs.length) {
      const n = docs.length;

      // Total entries
      document.getElementById('ovTotalEntries').textContent = String(n);

      // RAG score (from QA pipeline if available)
      document.getElementById('ovRagScore').textContent = qaStats && qaStats.ragScore ? qaStats.ragScore.toFixed(1) : '—';

      // High confidence
      const conf = { high: 0, medium: 0, low: 0 };
      docs.forEach(d => { conf[d.confidence || 'medium']++; });
      document.getElementById('ovHighConf').textContent = String(conf.high);

      // Removed (from QA stats)
      document.getElementById('ovRemoved').textContent = qaStats ? String(qaStats.removed || 0) : '—';

      // Root causes
      const rcCount = ragDone && ragStats ? ragStats.with_root_cause : docs.filter(d => d.root_cause).length;
      document.getElementById('ovRootCauses').textContent = String(rcCount);

      // Tech signals / components
      if (ragDone && ragStats) {
        document.getElementById('ovTechSignals').textContent = String(ragStats.with_components);
      } else {
        const tsStat = docs.filter(e => {
          const ts = e.technical_signals;
          if (!ts) return false;
          if (typeof ts === 'object' && !Array.isArray(ts)) return Object.values(ts).some(v => !!v);
          return Array.isArray(ts) && ts.length > 0;
        }).length;
        document.getElementById('ovTechSignals').textContent = String(tsStat);
      }

      // Issue categories
      const types = new Set(docs.map(d => d.issue_type).filter(Boolean));
      document.getElementById('ovIssueTypes').textContent = String(types.size);

      // Avg embedding length (RAG) or avg solution length (QA)
      if (ragDone && ragStats) {
        document.getElementById('ovAvgSolLen').textContent = ragStats.avg_embedding_length + ' chars';
      } else {
        const avgSol = Math.round(docs.reduce((s, e) => s + (e.solution || '').length, 0) / n);
        document.getElementById('ovAvgSolLen').textContent = avgSol + ' chars';
      }

      // Confidence bar
      document.getElementById('ovConfHigh').style.width = (conf.high / n * 100) + '%';
      document.getElementById('ovConfMed').style.width = (conf.medium / n * 100) + '%';
      document.getElementById('ovConfLow').style.width = (conf.low / n * 100) + '%';
      document.getElementById('ovConfHighN').textContent = conf.high;
      document.getElementById('ovConfMedN').textContent = conf.medium;
      document.getElementById('ovConfLowN').textContent = conf.low;

      // Issue type chart (top 5)
      const typeDist = {};
      docs.forEach(d => { const t = d.issue_type || 'unknown'; typeDist[t] = (typeDist[t] || 0) + 1; });
      const sorted = Object.entries(typeDist).sort((a, b) => b[1] - a[1]).slice(0, 5);
      const maxCount = sorted.length ? sorted[0][1] : 1;
      const chartEl = document.getElementById('ovIssueChart');
      if (sorted.length) {
        chartEl.innerHTML = sorted.map(([type, count]) => {
          const pct = (count / maxCount * 100).toFixed(0);
          const label = type.replace(/_/g, ' ');
          return `<div class="ov-bar-row">
            <div class="ov-bar-label">${esc(label)}</div>
            <div class="ov-bar-track"><div class="ov-bar-fill" style="width:${pct}%"></div></div>
            <div class="ov-bar-val">${count}</div>
          </div>`;
        }).join('');
      }
    }

    // ── Vector health ──
    document.getElementById('ovIndexedTickets').textContent = String(vector.indexedTickets);
    document.getElementById('ovEmbeddedVectors').textContent = String(vector.embeddedVectors);
    document.getElementById('ovEmbedModel').textContent = vector.embeddingModel;
    document.getElementById('ovLastIngest').textContent = formatTimestamp(vector.lastIngestTimestamp);

    // ── Warnings ──
    const warnings = [];
    if (!qaDone) warnings.push('No QA Clean data. Run QA Clean pipeline first.');
    if (!ragDone && qaDone) warnings.push('QA Clean done but RAG formatting not yet run.');
    if (vector.embeddedVectors === 0) warnings.push('No vectors embedded. Run Ingestion after RAG formatting.');
    const warningsEl = document.getElementById('ovWarnings');
    if (!warnings.length) {
      warningsEl.innerHTML = '<div class="warn-item ok">No warnings.</div>';
    } else {
      warningsEl.innerHTML = warnings.map(w => `<div class="warn-item">${esc(w)}</div>`).join('');
    }

    // ── Next action ──
    let nextAction = 'Run the pipeline to populate this dashboard.';
    if (!qaDone) nextAction = 'Upload scraped tickets and run QA Clean to start.';
    else if (!ragDone) nextAction = 'Run RAG Formatting to prepare data for embedding.';
    else if (vector.embeddedVectors === 0) nextAction = 'Run Ingestion & Embedding to create vectors.';
    else nextAction = 'Pipeline complete. Monitor quality and re-run as needed.';
    document.getElementById('ovNextAction').textContent = nextAction;
  }

  // ─── Ingestion ───
  async function startIngestion(mode = 'replace') {
    if(activeJobId) {
      showToast('An ingestion job is already running');
      return;
    }
    const appendMode = mode === 'append';
    try {
      refreshIngestActionButtons();
      const r = await fetch(`${KB_BASE}/ingest-last?mode=${appendMode ? 'append' : 'replace'}`,{method:'POST'});
      const d = await r.json();
      if(!r.ok) throw new Error(d.error);
      activeJobId = d.jobId;
      rememberUploadedFile(d.fileName, d.mode || mode);
      refreshIngestActionButtons();
      showToast(`${appendMode ? 'Add' : 'Ingestion'} started (job ${d.jobId})`);
      appendLog('info',`Started ${appendMode ? 'append' : 'replace'}: ${d.fileName} (${(d.fileSize/1024).toFixed(1)} KB)`);
      startPolling();
    } catch(e) {
      showToast(e.message);
      refreshIngestActionButtons();
    }
  }

  // ─── Polling (Web Worker — immune to background-tab throttling) ───
  function createPollWorker() {
    const code = `let t=null;self.onmessage=function(e){if(e.data==='start'){if(t)clearInterval(t);t=setInterval(()=>self.postMessage('tick'),1500)}else if(e.data==='stop'){if(t){clearInterval(t);t=null}}};`;
    const w = new Worker(URL.createObjectURL(new Blob([code],{type:'application/javascript'})));
    w.onmessage = () => pollStatus();
    return w;
  }
  function startPolling() {
    knownLogCount = 0;
    document.getElementById('liveIndicator').className = 'live on';
    if(pollWorker) pollWorker.postMessage('stop');
    else pollWorker = createPollWorker();
    pollWorker.postMessage('start');
  }
  function stopPolling() {
    if(pollWorker) pollWorker.postMessage('stop');
    document.getElementById('liveIndicator').className = 'live';
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && activeJobId) pollStatus();
    if (!document.hidden && activeAiPipelineJobId) pollAiPipelineJob();
  });

  async function pollStatus() {
    if(!activeJobId) return;
    try {
      const r = await fetch(`${KB_BASE}/status/${activeJobId}`);
      const d = await r.json();
      if(!r.ok) { stopPolling(); return; }
      updateUI(d);
      if(['completed','error'].includes(d.status)) {
        activeJobId = null;
        stopPolling(); loadJobs();
        refreshIngestActionButtons();
        if(d.status==='completed') showToast(`Done: ${d.storedChunks} vectors stored (${d.mode === 'append' ? 'add mode' : 'replace mode'})`);
        else showToast('Ingestion failed. Check logs.');
      }
    } catch(e) { appendLog('warn',`Poll error: ${e.message}`); }
  }

  function updateUI(d) {
    document.getElementById('statTickets').textContent = d.processedTickets || 0;
    document.getElementById('statChunks').textContent = d.totalChunks || 0;
    document.getElementById('statEmbedded').textContent = d.embeddedChunks || 0;
    document.getElementById('statErrors').textContent = (d.errors||[]).length;
    const pct = Math.min(d.progress||0,100);
    document.getElementById('progressPct').textContent = `${pct}%`;
    document.getElementById('progressFill').style.width = `${pct}%`;
    const pm = {starting:'Starting...',parsing:'Parsing JSON',cleaning:'Cleaning Data',checking_infra:'Checking Infra',embedding:'Embedding',storing:'Storing',completed:'Complete',error:'Failed'};
    document.getElementById('phaseLabel').textContent = pm[d.status] || d.status;
    if(d.logs && d.logs.length > knownLogCount) {
      d.logs.slice(knownLogCount).forEach(l => appendLog(l.level, l.message, l.time));
      knownLogCount = d.logs.length;
    }
  }

  // ─── Jobs ───
  async function loadJobs() {
    if (typeof KB_DEMO_MODE !== 'undefined' && KB_DEMO_MODE) return;
    try {
      const r = await fetch(`${KB_BASE}/jobs?_=${Date.now()}`, { cache: 'no-store' });
      const jobs = await r.json();
      jobsCache = Array.isArray(jobs) ? jobs : [];
      renderIngestFileHistory(mergeIngestFileHistory(jobsCache.map(j => ({
        fileName: j.fileName,
        mode: j.mode || 'replace',
        startedAt: j.startedAt || null
      }))));
      loadIngestedSources();
      renderOverviewDashboard();
      const el = document.getElementById('jobsList');
      if(!jobs.length) { el.innerHTML='<div class="jobs-empty">No jobs yet</div>'; return; }
      el.innerHTML = jobs.reverse().map(j=>`
        <div class="job-row" onclick="viewJob('${j.id}')">
          <span class="job-id">${j.id}</span>
          <span class="job-file">${esc(j.fileName||'?')} ${j.mode === 'append' ? '· add' : ''}</span>
          <span class="job-st ${j.status==='completed'?'completed':j.status==='error'?'error':'running'}">${j.status}</span>
        </div>`).join('');
    } catch(e){}
  }
  function viewJob(id) { activeJobId=id; knownLogCount=0; clearLogs(); pollStatus(); }

  // ─── Logging ───
  function appendLog(level, message, time) {
    const lb = document.getElementById('logBody');
    const row = document.createElement('div');
    row.className = 'log-row';
    const t = time ? new Date(time).toLocaleTimeString() : new Date().toLocaleTimeString();
    row.innerHTML = `<span class="log-t">${t}</span><span class="log-lv ${level}">${level.toUpperCase()}</span><span class="log-m">${esc(message)}</span>`;
    lb.appendChild(row); lb.scrollTop = lb.scrollHeight;
  }
  function clearLogs() { document.getElementById('logBody').innerHTML=''; knownLogCount=0; }

  /* showToast, esc provided by shared.js */

  function bootGuard(label, fn) {
    try {
      return typeof fn === 'function' ? fn() : undefined;
    } catch (e) {
      console.warn(`[kb boot] ${label} failed:`, e);
      return undefined;
    }
  }

  const kbUiMemory = getKbUiMemory();
  activeKbView = kbUiMemory.activeView;
  if (kbUiMemory.collapsed) bootGuard('collapse layout', () => document.querySelector('.layout').classList.add('kb-collapsed'));
  qdrantSourceFiles = getIngestSourceCache();
  renderIngestFileHistory();
  bootGuard('load sources', () => loadIngestedSources());
  refreshIngestedSourcesSoon(500);
  refreshIngestedSourcesSoon(2500);
  bootGuard('load server profile', () => loadServerProfile());
  bootGuard('populate profiling prompts', () => pmPopulate('profiling'));
  bootGuard('populate cleaning prompts', () => pmPopulate('cleaning'));
  bootGuard('refresh ingest buttons', () => refreshIngestActionButtons());
  bootGuard('set ai connection defaults', () => {
    const connModeEl = document.getElementById('aiConnMode');
    const apiUrlEl = document.getElementById('aiApiUrl');
    if (connModeEl) connModeEl.value = 'direct';
    if (apiUrlEl) apiUrlEl.value = 'http://localhost:11434';
    if (connModeEl || apiUrlEl) toggleAiApiUrl();
  });
  bootGuard('restore kb view', () => restoreKbViewState(true));
  bootGuard('update kb toggle', () => updateKbToggle());
  bootGuard('schedule connection test', () => scheduleOllamaConnectionTest(50));
  bootGuard('load jobs', () => loadJobs().finally(() => bootGuard('restore kb view after jobs', () => restoreKbViewState(true))));
  bootGuard('restore ai pipeline job', () => restoreActiveAiPipelineJob().finally(() => bootGuard('restore kb view after ai job', () => restoreKbViewState(true))));
  window.addEventListener('load', () => bootGuard('restore kb view on load', () => restoreKbViewState(true)));
  setTimeout(() => bootGuard('restore kb view timeout 0', () => restoreKbViewState(true)), 0);
  setTimeout(() => bootGuard('restore kb view timeout 150', () => restoreKbViewState(true)), 150);
  window.addEventListener('pageshow', () => {
    bootGuard('restore kb view on pageshow', () => restoreKbViewState(false));
    bootGuard('load sources on pageshow', () => loadIngestedSources());
  });
  window.addEventListener('focus', () => bootGuard('load sources on focus', () => loadIngestedSources()));
  window.addEventListener('hashchange', () => bootGuard('restore kb view on hashchange', () => restoreKbViewState(true)));

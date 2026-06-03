  // ─── Profile file upload handling ───
  let selectedProfileFile = null;
  const profileFileInput = document.getElementById('profileFileInput');
  const profileUploadZone = document.getElementById('profileUploadZone');

  profileFileInput.addEventListener('change', e => { if(e.target.files.length) selectProfileFile(e.target.files[0]); });
  profileUploadZone.addEventListener('dragover', e => { e.preventDefault(); profileUploadZone.classList.add('dragover'); });
  profileUploadZone.addEventListener('dragleave', () => profileUploadZone.classList.remove('dragover'));
  profileUploadZone.addEventListener('drop', e => {
    e.preventDefault(); profileUploadZone.classList.remove('dragover');
    if(e.dataTransfer.files.length) selectProfileFile(e.dataTransfer.files[0]);
  });

  function selectProfileFile(file) {
    if(!file.name.endsWith('.json')) { showToast('Only JSON files'); return; }
    selectedProfileFile = file;
    document.getElementById('profileFileName').textContent = file.name;
    document.getElementById('profileFileSize').textContent = fmtSize(file.size);
    document.getElementById('profileFileInfo').className = 'file-info on';
    document.getElementById('btnServerProfile').disabled = false;
  }
  function clearProfileFile() {
    selectedProfileFile = null; profileFileInput.value = '';
    document.getElementById('profileFileInfo').className = 'file-info';
    document.getElementById('btnServerProfile').disabled = true;
  }

  // ─── Client-side profiling for cleaned KB format ───
  function profileCleanedKB(data) {
    const entries = data.VALID_KNOWLEDGE_DATASET || [];
    const removed = data.REMOVED_POISON_ENTRIES || [];
    const meta = data._metadata || {};
    const summary = data.DATASET_SUMMARY || {};
    const total = entries.length;

    // --- Evaluation Score ---
    const confDist = { high: 0, medium: 0, low: 0 };
    entries.forEach(e => { confDist[e.confidence || 'medium']++; });
    const highPct = total ? confDist.high / total : 0;
    const lowPct = total ? confDist.low / total : 0;
    const ragGood = entries.filter(e => e.rag_quality === 'good').length;
    const ragGoodPct = total ? ragGood / total : 0;
    const hasRootCause = entries.filter(e => e.root_cause).length;
    const rcPct = total ? hasRootCause / total : 0;
    const hasTechSig = entries.filter(e => {
      const ts = e.technical_signals;
      if (!ts) return false;
      if (typeof ts === 'object' && !Array.isArray(ts)) return Object.values(ts).some(v => !!v);
      if (Array.isArray(ts)) return ts.length > 0;
      return false;
    }).length;
    const tsPct = total ? hasTechSig / total : 0;

    // Score components (out of 100)
    // Confidence: reward high%, penalize low% (max 25)
    const scoreConf = Math.round(Math.min(((highPct + 0.5) * 25 + (1 - lowPct) * 10) / 1.5, 25));
    // RAG quality: % of entries rated "good" (max 25)
    const scoreRag = Math.round(ragGoodPct * 25);
    // Noise removal: reward having cleaned data — if format is cleaned_kb, base 15 + proportional bonus (max 20)
    const scoreClean = Math.round(Math.min(15 + (removed.length / Math.max(total, 1)) * 40, 20));
    // Technical signals coverage (max 20)
    const scoreSignals = Math.round(tsPct * 20);
    // Root cause coverage (max 10)
    const scoreRC = Math.round(Math.min(rcPct * 15, 10));
    const evalTotal = Math.min(scoreConf + scoreRag + scoreClean + scoreSignals + scoreRC, 100);
    const grade = evalTotal >= 90 ? 'A+' : evalTotal >= 80 ? 'A' : evalTotal >= 70 ? 'B+' : evalTotal >= 60 ? 'B' : evalTotal >= 50 ? 'C' : 'D';

    // --- Issue type distribution (semantic) ---
    const issueTypes = {};
    entries.forEach(e => { const t = e.issue_type || 'unknown'; issueTypes[t] = (issueTypes[t] || 0) + 1; });
    const sortedTypes = Object.entries(issueTypes).sort((a, b) => b[1] - a[1]);
    const topThemes = sortedTypes.slice(0, 12).map(([theme, count]) => ({
      theme, ticket_count: count, ratio: count / total
    }));
    const dominantRatio = sortedTypes.length ? sortedTypes[0][1] / total : 0;
    const concentration = sortedTypes.length <= 3 ? 'High' : sortedTypes.length <= 7 ? 'Medium' : 'Low (well-distributed)';

    // --- Solution length analysis ---
    const solLengths = entries.map(e => (e.solution || '').length).sort((a, b) => a - b);
    const medianSol = solLengths[Math.floor(solLengths.length / 2)] || 0;
    const avgSol = total ? Math.round(solLengths.reduce((a, b) => a + b, 0) / total) : 0;

    // --- Noise analysis (from removed entries) ---
    const totalOrig = total + removed.length;
    const removalRatio = totalOrig ? removed.length / totalOrig : 0;
    // Check for remaining artifacts in the cleaned data
    const emailArtifactCount = entries.filter(e => {
      const t = (e.problem || '') + ' ' + (e.solution || '');
      return /\bFrom:\s|Sent:\s|_{5,}|-{5,}\s*Original/i.test(t);
    }).length;
    const encodingArtifactCount = entries.filter(e => {
      const t = (e.problem || '') + ' ' + (e.solution || '');
      return /â€™|Ã¢|Â|┬|&amp;|&lt;|&gt;|&nbsp;/i.test(t);
    }).length;

    // --- Resolution structure ---
    const withRC = entries.filter(e => e.root_cause).length;
    const confirmedCount = confDist.high;
    const ambiguousCount = confDist.low;

    // --- Consolidated entries ---
    const consolidated = entries.filter(e => e.consolidated_from && e.consolidated_from > 1).length;

    return {
      evaluation_score: {
        total: evalTotal,
        grade: grade,
        breakdown: {
          confidence_quality: { score: scoreConf, max: 25, detail: `high:${confDist.high} medium:${confDist.medium} low:${confDist.low}` },
          rag_quality: { score: scoreRag, max: 25, detail: `${ragGood}/${total} entries good (${(ragGoodPct*100).toFixed(1)}%)` },
          noise_removal: { score: scoreClean, max: 20, detail: `${removed.length} entries removed from ${totalOrig}` },
          technical_signals: { score: scoreSignals, max: 20, detail: `${hasTechSig}/${total} entries (${(tsPct*100).toFixed(1)}%)` },
          root_cause_coverage: { score: scoreRC, max: 10, detail: `${hasRootCause}/${total} entries (${(rcPct*100).toFixed(1)}%)` },
        }
      },
      dataset_scale: {
        total_tickets: total,
        total_messages: consolidated ? total + consolidated : total,
        format: 'cleaned_kb',
        removed_entries: removed.length,
      },
      conversation_structure: {
        median_thread_length: consolidated ? 2 : 1,
        single_issue_ratio: total ? (total - consolidated) / total : 1,
        multi_issue_presence: consolidated > 0 ? `${consolidated} consolidated` : 'None detected',
      },
      noise_analysis: {
        quoted_reply_ratio: totalOrig ? emailArtifactCount / total : 0,
        encoding_artifact_ratio: total ? encodingArtifactCount / total : 0,
        cleaning_required: emailArtifactCount > 5 || encodingArtifactCount > 5,
        removal_ratio: removalRatio,
        removed_breakdown: (() => {
          const reasons = {};
          removed.forEach(r => { (r.reasons || []).forEach(reason => { reasons[reason] = (reasons[reason] || 0) + 1; }); });
          return reasons;
        })(),
      },
      semantic_distribution: {
        problem_concentration_level: concentration,
        dominant_theme_ratio: dominantRatio,
        top_issue_themes: topThemes,
        unique_issue_types: sortedTypes.length,
      },
      resolution_structure_sample: {
        sample_size: total,
        none_ratio: total ? (total - withRC) / total : 1,
        confirmed_ratio: total ? confirmedCount / total : 0,
        ambiguous_ratio: total ? ambiguousCount / total : 0,
        resolution_typically_in_last_message: true,
        avg_solution_length: avgSol,
        median_solution_length: medianSol,
      },
      embedding_implications: {
        recommended_unit: 'knowledge_entry (problem + solution pair)',
        chunk_granularity: medianSol > 500 ? 'fine (split long solutions)' : 'entry-level',
        metadata_required: ['issue_type', 'confidence', 'technical_signals', 'ticket_id'],
        cleaning_required: emailArtifactCount > 5 || encodingArtifactCount > 5,
        risk_if_wrong_strategy: lowPct > 0.1 ? 'High — many low-confidence entries may dilute retrieval' :
          dominantRatio > 0.3 ? 'Medium — topic concentration may bias retrieval' : 'Low — dataset is well-distributed',
      },
      _source: {
        format: 'cleaned_kb',
        version: meta.pipeline_version || meta.version || 'unknown',
        generated_at: meta.generated_at || new Date().toISOString(),
        original_count: totalOrig,
        cleaned_count: total,
      }
    };
  }

  // ─── Server-side full profiling (with cleaned KB format support) ───
  async function runServerProfile() {
    const btn = document.getElementById('btnServerProfile');
    btn.disabled = true;
    btn.textContent = 'Analyzing...';
    try {
      // If a file is selected, check if it's a cleaned KB format
      if (selectedProfileFile) {
        const text = await selectedProfileFile.text();
        const parsed = JSON.parse(text);

        // Detect cleaned KB format (has VALID_KNOWLEDGE_DATASET)
        if (parsed.VALID_KNOWLEDGE_DATASET && Array.isArray(parsed.VALID_KNOWLEDGE_DATASET)) {
          const profile = profileCleanedKB(parsed);
          renderServerProfile(profile);
          showToast(`Client-side profiling complete — ${parsed.VALID_KNOWLEDGE_DATASET.length} entries analyzed`);
          return;
        }

        // Otherwise fall through to server-side profiling for raw exports
        const promptContent = pmGetContent('profiling');
        const fd = new FormData();
        fd.append('file', selectedProfileFile);
        const params = promptContent ? `?prompt=${encodeURIComponent(promptContent)}` : '';
        const r = await fetch(`${KB_BASE}/profile-upload${params}`, { method: 'POST', body: fd });
        if (!r.ok) throw new Error(`Server returned ${r.status}`);
        const profile = await r.json();
        renderServerProfile(profile);
        showToast('Full profiling complete');
      } else {
        const promptContent = pmGetContent('profiling');
        let r = await fetch(`${KB_BASE}/profile`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: promptContent })
        });
        if (!r.ok) r = await fetch(`${KB_BASE}/profile`);
        if (!r.ok) throw new Error(`Server returned ${r.status}`);
        const profile = await r.json();
        renderServerProfile(profile);
        showToast('Full profiling complete');
      }
    } catch (e) {
      showToast(`Profile failed: ${e.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Run Analysis';
    }
  }

  async function loadServerProfile() {
    if (typeof KB_DEMO_MODE !== 'undefined' && KB_DEMO_MODE) return;
    try {
      const r = await fetch(`${KB_BASE}/profile`);
      if (!r.ok) return;
      const profile = await r.json();
      renderServerProfile(profile);
    } catch (_) {}
  }

  // ─── Profile JSON data (kept in memory for download) ───
  let _profileJsonCache = null;

  function renderServerProfile(p) {
    _profileJsonCache = p;
    document.getElementById('profileResultsCard').style.display = '';
    document.getElementById('profileEmpty').style.display = 'none';
    document.getElementById('btnDownloadProfile').style.display = '';

    // ─── Score ───
    const ev = p.evaluation_score;
    if (ev) {
      document.getElementById('dpScoreSection').style.display = '';
      document.getElementById('scoreNum').textContent = ev.total;
      document.getElementById('scoreGrade').textContent = ev.grade;
      const barsEl = document.getElementById('scoreBars');
      if (ev.breakdown) {
        barsEl.innerHTML = Object.entries(ev.breakdown).map(([key, d]) => {
          const pct = Math.round((d.score / d.max) * 100);
          const label = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          return `<div class="score-bar-row">
            <span class="score-bar-label">${esc(label)}</span>
            <div class="score-bar-track"><div class="score-bar-fill" style="width:${pct}%"></div></div>
            <span class="score-bar-val">${d.score}/${d.max}</span>
            <span class="score-bar-detail">${esc(d.detail || '')}</span>
          </div>`;
        }).join('');
      }
    }

    // ─── Key Numbers ───
    const ds = p.dataset_scale;
    const cs = p.conversation_structure;
    if (ds || cs) {
      document.getElementById('dpOverviewGrid').style.display = 'flex';
      if (ds) {
        document.getElementById('dpTotalTickets').textContent = Number(ds.total_tickets || 0).toLocaleString();
        document.getElementById('dpTotalMessages').textContent = Number(ds.total_messages || 0).toLocaleString();
      }
      if (cs) {
        document.getElementById('dpMedianThread').textContent = String(cs.median_thread_length || 0);
      }
    }

    // ─── Top Issues ───
    const sd = p.semantic_distribution;
    if (sd) {
      document.getElementById('dpSemanticSection').style.display = '';
      const summary = document.getElementById('dpThemeSummary');
      const themes = sd.top_issue_themes || [];
      if (summary) summary.textContent = themes.length ? `${themes.length} categories found` : '';
      const themeRows = themes.map(t =>
        `<tr><td>${esc(t.theme.replace(/[/_]/g, ' '))}</td><td style="text-align:right;">${t.ticket_count}</td><td style="text-align:right;">${(t.ratio * 100).toFixed(1)}%</td></tr>`
      ).join('') || '<tr><td colspan="3">No data</td></tr>';
      document.getElementById('dpThemeRows').innerHTML = themeRows;
    }

    // Save to overview dashboard
    const na = p.noise_analysis;
    if (ds) {
      saveProfileSnapshot({
        total_tickets: ds.total_tickets,
        total_messages: ds.total_messages,
        median_thread_length: cs?.median_thread_length || 0,
        single_issue_ratio: cs?.single_issue_ratio || 0,
        cleaning_required: na?.cleaning_required || false,
        timestamp: new Date().toISOString()
      });
      renderOverviewDashboard();
    }
  }

  function downloadProfileJson() {
    if (!_profileJsonCache) return;
    const blob = new Blob([JSON.stringify(_profileJsonCache, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'ticket_data_profile.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ═══════════════════════════════════════════════════════════
  // CLEANING PAGE — Data-State Control Console
  // ═══════════════════════════════════════════════════════════

  let _cleanRules = [];
  let _cleanInitialized = false;
  let _cleanImportFile = null;

  function initCleaningPage() {
    if (!_cleanInitialized) {
      _cleanInitialized = true;
      setupCleanImport();
      loadCleanRules().then(() => renderPipelineSteps());
    }
    // Always reload profile summary when switching to cleaning tab
    loadCleanProfileSummary();
  }

  // ─── Panel 1: Profile Summary ───
  async function loadCleanProfileSummary() {
    if (typeof KB_DEMO_MODE !== 'undefined' && KB_DEMO_MODE) return;
    try {
      const r = await fetch(`${KB_BASE}/profile`);
      if (!r.ok) {
        document.getElementById('cpCleaningFlag').textContent = 'No profile data — run profiling first';
        return;
      }
      const p = await r.json();
      const ds = p.dataset_scale || {};
      const na = p.noise_analysis || {};
      document.getElementById('cpTotalTickets').textContent = ds.total_tickets != null ? ds.total_tickets.toLocaleString() : '—';
      document.getElementById('cpTotalMessages').textContent = ds.total_messages != null ? ds.total_messages.toLocaleString() : '—';
      if (na.cleaning_required != null) {
        const flag = document.getElementById('cpCleaningFlag');
        flag.textContent = na.cleaning_required ? 'Cleaning recommended based on noise analysis' : 'Data is relatively clean';
        flag.style.color = na.cleaning_required ? 'var(--orange)' : 'var(--green)';
      }
    } catch (e) {
      document.getElementById('cpCleaningFlag').textContent = 'Failed to load profile';
    }
  }

  // ─── Panel 2: Active Cleaning Rules ───
  async function loadCleanRules() {
    if (typeof KB_DEMO_MODE !== 'undefined' && KB_DEMO_MODE) return;
    try {
      const r = await fetch(`${KB_BASE}/clean-rules`);
      if (!r.ok) throw new Error('Failed to load rules');
      _cleanRules = await r.json();
      renderCleanRules();
    } catch (e) {
      document.getElementById('ruleGrid').innerHTML = '<div style="color:var(--text3); font-size:12px;">Failed to load rules</div>';
    }
  }

  function renderCleanRules() {
    const grid = document.getElementById('ruleGrid');
    grid.innerHTML = _cleanRules.map((rule, i) => `
      <div class="rule-row" id="ruleRow_${rule.id}">
        <input type="checkbox" checked id="ruleCheck_${rule.id}" style="display:none;">
        <div style="flex:1;">
          <span class="rule-label">${esc(rule.label)}</span>
          <span class="rule-desc" style="margin-left:6px;">${esc(rule.desc)}</span>
        </div>
      </div>
    `).join('');
    updateRulesActiveCount();
  }

  function onRuleToggle(ruleId, checked) {
    const row = document.getElementById('ruleRow_' + ruleId);
    if (row) {
      if (checked) row.classList.remove('disabled');
      else row.classList.add('disabled');
    }
    updateRulesActiveCount();
  }

  function updateRulesActiveCount() {
    const total = _cleanRules.length;
    const active = _cleanRules.filter(r => {
      const cb = document.getElementById('ruleCheck_' + r.id);
      return cb && cb.checked;
    }).length;
    document.getElementById('rulesActiveCount').textContent = `${active}/${total} active`;
  }

  function getDisabledRules() {
    // First check hidden checkboxes (legacy UI)
    const fromCheckboxes = _cleanRules
      .filter(r => {
        const cb = document.getElementById('ruleCheck_' + r.id);
        return cb && !cb.checked;
      })
      .map(r => r.id);
    if (fromCheckboxes.length) return fromCheckboxes;

    // Parse cleaning prompt keywords to determine disabled rules
    const prompt = pmGetContent('cleaning').toLowerCase();
    if (!prompt) return [];
    const disabled = [];
    // "keep signatures" / "preserve signatures" → disable sig rules
    if (/(?:keep|preserve|retain|skip)\s+(?:signature|sign-?off)/i.test(prompt)) {
      disabled.push('sig_delimiter', 'corporate_signoff');
    }
    // "keep quotes" / "preserve quoted" → disable quote rules
    if (/(?:keep|preserve|retain|skip)\s+(?:quote|quoted|reply chain)/i.test(prompt)) {
      disabled.push('outlook_chain', 'gmail_on_wrote', 'quote_prefix');
    }
    // "disable <rule_id>" explicit control
    for (const r of _cleanRules) {
      if (prompt.includes('disable ' + r.id) || prompt.includes('skip ' + r.id)) {
        if (!disabled.includes(r.id)) disabled.push(r.id);
      }
    }
    return disabled;
  }

  // ─── File Import for Cleaning ───
  function setupCleanImport() {
    const zone = document.getElementById('cleanImportZone');
    const input = document.getElementById('cleanImportInput');
    if (!zone || !input) return;
    input.addEventListener('change', e => { if (e.target.files.length) selectCleanImport(e.target.files[0]); });
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', e => {
      e.preventDefault(); zone.classList.remove('dragover');
      if (e.dataTransfer.files.length) selectCleanImport(e.dataTransfer.files[0]);
    });
  }

  function selectCleanImport(file) {
    if (!file.name.endsWith('.json')) { showToast('Only JSON files'); return; }
    _cleanImportFile = file;
    document.getElementById('cleanImportFileName').textContent = file.name;
    document.getElementById('cleanImportFileSize').textContent = fmtSize(file.size);
    document.getElementById('cleanImportFileInfo').className = 'file-info on';
    document.getElementById('cleanImportLabel').innerHTML = `<strong>${esc(file.name)}</strong> selected`;
    document.getElementById('btnRunPipeline').disabled = false;
  }

  function clearCleanImport() {
    _cleanImportFile = null;
    document.getElementById('cleanImportInput').value = '';
    document.getElementById('cleanImportFileInfo').className = 'file-info';
    document.getElementById('cleanImportLabel').innerHTML = 'Drop export JSON here or <strong>browse</strong>';
    document.getElementById('btnRunPipeline').disabled = true;
    resetPipelineUI();
  }

  // ─── Panel 5: Version Safety ───
  async function loadCleanVersionInfo() {
    if (typeof KB_DEMO_MODE !== 'undefined' && KB_DEMO_MODE) return;
    try {
      const r = await fetch(`${KB_BASE}/clean-version-info`);
      if (!r.ok) throw new Error('Failed');
      const info = await r.json();
      const dot = document.getElementById('versionDot');
      const label = document.getElementById('versionLabel');
      const detail = document.getElementById('versionDetail');
      if (!info.exportExists) {
        dot.className = 'version-dot warn';
        label.textContent = 'No export found';
        detail.textContent = 'Upload a dataset first';
      } else if (info.hasRawBackup) {
        dot.className = 'version-dot safe';
        label.textContent = 'Raw text backup available';
        const mod = info.exportModified ? new Date(info.exportModified).toLocaleString() : '';
        detail.textContent = `${info.cleanVersion || ''} · Export: ${fmtSize(info.exportSize || 0)}${mod ? ' · ' + mod : ''}`;
      } else {
        dot.className = 'version-dot warn';
        label.textContent = 'No raw text backup detected';
        detail.textContent = info.cleanVersion || '';
      }
    } catch (e) {
      document.getElementById('versionLabel').textContent = 'Unable to check';
      document.getElementById('versionDot').className = 'version-dot warn';
    }
  }

  // ─── Run Cleaning Preview (main action) ───
  async function runCleaningPreview() {
    if (!_cleanImportFile) { showToast('Import an export JSON file first'); return; }
    const btn = document.getElementById('btnRunPipeline');
    btn.disabled = true;
    btn.textContent = 'Cleaning...';
    document.getElementById('cleaningStatus').textContent = 'Uploading & processing...';
    try {
      const disabledRules = getDisabledRules();
      const cleanPrompt = pmGetContent('cleaning');
      const params = new URLSearchParams();
      if (disabledRules.length) params.set('disabledRules', JSON.stringify(disabledRules));
      if (cleanPrompt) params.set('prompt', cleanPrompt);
      params.set('sampleLimit', '20');
      const fd = new FormData();
      fd.append('file', _cleanImportFile);
      const r = await fetch(`${KB_BASE}/clean-preview?${params}`, { method: 'POST', body: fd });
      if (!r.ok) {
        const body = await r.json().catch(() => null);
        throw new Error(body?.error || `Server returned ${r.status}`);
      }
      const { stats, samples, noiseComparison } = await r.json();
      renderCleaningImpact(stats, noiseComparison);
      renderCleaningPreview(samples || []);
      document.getElementById('cleaningStatus').textContent =
        `Done — ${stats.changed_messages} of ${stats.total_messages} changed`;
      showToast('Cleaning complete');
    } catch (e) {
      showToast(`Cleaning failed: ${e.message}`);
      document.getElementById('cleaningStatus').textContent = '';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Run All Steps';
    }
  }

  // ─── Panel 4: Aggregate Impact (merged into Profile Summary) ───
  function renderCleaningImpact(stats, noiseComparison) {
    // Update Profile Summary cleaning stats
    document.getElementById('cpCleaningStats').style.display = 'block';
    document.getElementById('cpChangedMsgs').textContent = stats.changed_messages.toLocaleString();
    document.getElementById('cpUnchangedMsgs').textContent = stats.unchanged_messages.toLocaleString();
    document.getElementById('cpReductionPct').textContent = `${stats.total_reduction_pct}%`;

    // Before/after noise comparison
    if (noiseComparison) {
      document.getElementById('cpQuotedBefore').textContent = `${(noiseComparison.before_quoted_ratio * 100).toFixed(1)}%`;
      document.getElementById('cpQuotedAfter').textContent = `${(noiseComparison.after_quoted_ratio * 100).toFixed(1)}%`;
      document.getElementById('cpEncodingBefore').textContent = `${(noiseComparison.before_encoding_ratio * 100).toFixed(1)}%`;
      document.getElementById('cpEncodingAfter').textContent = `${(noiseComparison.after_encoding_ratio * 100).toFixed(1)}%`;
    }
  }

  // ─── Panel 3: Cleaning Preview Table ───
  function renderCleaningPreview(samples) {
    const panel = document.getElementById('cleanPreviewPanel');
    const body = document.getElementById('previewBody');
    const countEl = document.getElementById('previewSampleCount');
    if (!samples.length) {
      panel.style.display = 'none';
      return;
    }
    panel.style.display = 'block';
    countEl.textContent = `(showing ${samples.length} changed messages)`;
    body.innerHTML = samples.map((s, i) => {
      const rulesHtml = (s.appliedRules || []).map(r =>
        `<span class="rule-tag">${esc(r.label)}<span class="delta">${r.charDelta}</span></span>`
      ).join('');
      return `<tr>
        <td style="font-size:10px; color:var(--text3);">${i + 1}</td>
        <td style="font-size:10px; font-weight:600; color:var(--blue);">${esc(s.ticket)}</td>
        <td><div class="cell-text">${esc(s.original)}</div></td>
        <td><div class="cell-text">${esc(s.cleaned)}</div></td>
        <td><div class="rules-applied">${rulesHtml}</div></td>
      </tr>`;
    }).join('');
  }

  // ─── Download full results ───
  function downloadCleanResults() {
    const a = document.createElement('a');
    a.href = `${KB_BASE}/clean-results`;
    a.download = 'cleaning_results.json';
    a.click();
  }

  // ═══════════════════════════════════════════════════════════

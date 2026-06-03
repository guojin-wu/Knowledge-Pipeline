  // ═══════════════════════════════════════════════════════════
  // PIPELINE — Step-by-step cleaning with per-step stats & downloads
  // ═══════════════════════════════════════════════════════════

  let _pipelineResults = null;
  let _pipelineRunning = false;
  let _pipelineAllSteps = null;

  /** Build vertical step list from loaded rules + structural extraction */
  function renderPipelineSteps() {
    const list = document.getElementById('pipelineStepList');
    if (!list) return;
    document.getElementById('pipelinePanel').style.display = 'block';
    const allSteps = [
      ..._cleanRules.map((r, i) => ({ step: i + 1, id: r.id, label: r.label, desc: r.desc })),
      { step: 10, id: 'structural_extraction', label: 'Structural Extraction', desc: 'Filter system messages, restructure to AI-ready format' },
    ];
    _pipelineAllSteps = allSteps;
    list.innerHTML = allSteps.map(s => `
      <div class="pipeline-step-row" id="plRow_${s.step}">
        <div class="step-header">
          <span class="step-num">${s.step}</span>
          <div class="step-info">
            <div class="step-name">${esc(s.label)}</div>
            <div class="step-desc">${esc(s.desc)}</div>
          </div>
          <div class="step-actions">
            <button class="btn-sm" onclick="runSingleStep(${s.step})">Run</button>
            ${s.step <= 10 ? `<button class="btn-sm diff" onclick="showStepDiff(${s.step})" disabled>Diff</button>` : ''}
            <button class="btn-sm download" onclick="downloadPipelineStep(${s.step})" disabled>↓</button>
          </div>
        </div>
        <div class="step-stats" id="plStats_${s.step}" style="display:none;"></div>
      </div>
    `).join('');
  }

  /** Populate step rows with results from backend */
  function updatePipelineUI(result) {
    _pipelineResults = result;
    document.getElementById('pipelinePanel').style.display = 'block';
    document.getElementById('pipelineBaseline').style.display = 'block';
    document.getElementById('plBaseTickets').textContent = result.baseline.totalTickets.toLocaleString();
    document.getElementById('plBaseMessages').textContent = result.baseline.totalMessages.toLocaleString();
    document.getElementById('plBaseChars').textContent = fmtSize(result.baseline.totalChars);

    for (const s of result.steps) {
      const row = document.getElementById(`plRow_${s.step}`);
      if (!row) continue;
      row.classList.remove('running');
      row.classList.add(s.skipped ? 'skipped' : 'completed');
      const dlBtn = row.querySelector('.btn-sm.download');
      if (dlBtn) dlBtn.disabled = false;
      const diffBtn = row.querySelector('.btn-sm.diff');
      if (diffBtn) diffBtn.disabled = false;

      const statsEl = document.getElementById(`plStats_${s.step}`);
      if (statsEl) {
        statsEl.style.display = 'flex';
        if (s.skipped) {
          statsEl.innerHTML = '<span style="font-style:italic; color:var(--text3);">skipped</span>';
        } else if (s.step <= 10) {
          statsEl.innerHTML = `
            <span>${s.messagesAffected.toLocaleString()} msgs cleaned</span>
            <span class="green">${fmtSize(result.baseline.totalChars)} → ${fmtSize(s.totalCharsAfter)}</span>`;
        } else {
          statsEl.innerHTML = `
            <span>${(s.ticketsAfter||0).toLocaleString()} of ${(s.ticketsBefore||0).toLocaleString()} tickets kept</span>
            <span class="green">${fmtSize(result.baseline.totalChars)} → ${fmtSize(s.totalCharsAfter)}</span>`;
        }
      }
    }
  }

  /** Reset all step row states */
  function resetPipelineUI() {
    _pipelineResults = null;
    document.getElementById('pipelineBaseline').style.display = 'none';
    if (_pipelineAllSteps) {
      for (const s of _pipelineAllSteps) {
        const row = document.getElementById(`plRow_${s.step}`);
        if (!row) continue;
        row.classList.remove('completed', 'running', 'skipped');
        const dlBtn = row.querySelector('.btn-sm.download');
        if (dlBtn) dlBtn.disabled = true;
        const statsEl = document.getElementById(`plStats_${s.step}`);
        if (statsEl) { statsEl.style.display = 'none'; statsEl.innerHTML = ''; }
      }
    }
  }

  /** Run pipeline (all steps or up to maxStep) */
  async function runPipeline(maxStep) {
    if (!_cleanImportFile) { showToast('Import an export JSON file first'); return; }
    if (_pipelineRunning) return;
    _pipelineRunning = true;

    const btn = document.getElementById('btnRunPipeline');
    btn.disabled = true;
    btn.textContent = 'Processing...';
    const status = document.getElementById('cleaningStatus');
    status.textContent = maxStep ? `Running step ${maxStep}...` : 'Running all steps...';
    resetPipelineUI();
    document.getElementById('pipelinePanel').style.display = 'block';

    // Mark target steps as running
    const limit = maxStep || (_pipelineAllSteps ? _pipelineAllSteps.length : 10);
    for (let i = 1; i <= limit; i++) {
      const row = document.getElementById(`plRow_${i}`);
      if (row) row.classList.add('running');
    }

    try {
      const disabledRules = getDisabledRules();
      const params = new URLSearchParams();
      if (disabledRules.length) params.set('disabledRules', JSON.stringify(disabledRules));
      if (maxStep) params.set('maxStep', maxStep);

      const fd = new FormData();
      fd.append('file', _cleanImportFile);

      const r = await fetch(`${KB_BASE}/pipeline?${params}`, { method: 'POST', body: fd });
      if (!r.ok) {
        const body = await r.json().catch(() => null);
        throw new Error(body?.error || `Server returned ${r.status}`);
      }

      const result = await r.json();
      updatePipelineUI(result);

      const lastStep = result.steps[result.steps.length - 1];
      if (lastStep) {
        renderCleaningImpact({
          changed_messages: result.steps.reduce((sum, s) => sum + (s.messagesAffected || 0), 0),
          unchanged_messages: result.baseline.totalMessages - result.steps.reduce((sum, s) => sum + (s.messagesAffected || 0), 0),
          total_messages: result.baseline.totalMessages,
          total_reduction_pct: lastStep.cumulativeReductionPct,
        }, null);
      }

      status.textContent = maxStep
        ? `Step ${maxStep} done \u2014 cum ${lastStep ? lastStep.cumulativeReductionPct : 0}% reduction`
        : `Done \u2014 ${result.steps.length} steps, ${lastStep ? lastStep.cumulativeReductionPct : 0}% reduction`;
      showToast(maxStep ? `Step ${maxStep} complete` : 'Pipeline complete');
    } catch (e) {
      showToast(`Pipeline failed: ${e.message}`);
      status.textContent = `Error: ${e.message}`;
      if (_pipelineAllSteps) {
        for (const s of _pipelineAllSteps) {
          const row = document.getElementById(`plRow_${s.step}`);
          if (row) row.classList.remove('running');
        }
      }
    } finally {
      _pipelineRunning = false;
      btn.disabled = !_cleanImportFile;
      btn.textContent = 'Run All Steps';
    }
  }

  /** Run a single step */
  function runSingleStep(step) {
    runPipeline(step);
  }

  /** Download intermediate result at a specific step */
  function downloadPipelineStep(step) {
    const a = document.createElement('a');
    a.href = `${KB_BASE}/pipeline/download/${step}`;
    a.download = step === 10 ? 'tickets_cleaned_export.json' : `tickets_after_step${step}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  /** Show per-message before/after diff for a step */
  async function showStepDiff(step) {
    const panel = document.getElementById('stepDiffPanel');
    const content = document.getElementById('diffContent');
    panel.style.display = 'block';
    document.getElementById('diffStepNum').textContent = step;
    document.getElementById('diffCount').textContent = 'loading...';
    content.innerHTML = '<div style="padding:20px; color:var(--text3); font-size:11px;">Loading diffs...</div>';
    panel.scrollIntoView({ behavior: 'smooth' });

    try {
      const resp = await fetch(`${KB_BASE}/pipeline/step-diff/${step}`);
      const data = await resp.json();
      if (data.error) throw new Error(data.error);

      document.getElementById('diffCount').textContent =
        `— ${data.changes.length}${data.total > data.changes.length ? ' of ' + data.total : ''} msgs changed`;

      if (data.changes.length === 0) {
        content.innerHTML = '<div style="padding:20px; color:var(--text3); font-size:11px;">No messages changed at this step.</div>';
        return;
      }

      content.innerHTML = data.changes.map(c => `
        <div class="diff-card">
          <div class="diff-meta">
            msg${esc(c.messageId)} · ${esc(c.poster)} · ticket ${esc(c.ticketId)} · ${esc(c.subject)}
            · <strong>${c.charDelta > 0 ? '+' : ''}${c.charDelta} chars</strong>
          </div>
          <div class="diff-cols">
            <div>
              <div class="diff-label">Before</div>
              <div class="diff-col before">${esc(c.before)}</div>
            </div>
            <div>
              <div class="diff-label">After</div>
              <div class="diff-col after">${esc(c.after)}</div>
            </div>
          </div>
        </div>
      `).join('');
    } catch (err) {
      content.innerHTML = `<div style="padding:20px; color:var(--red); font-size:11px;">Error: ${esc(err.message)}</div>`;
    }
  }

  /** Close the diff panel */
  function closeStepDiff() {
    document.getElementById('stepDiffPanel').style.display = 'none';
  }

  // ═══════════════════════════════════════════════════════
  // QA CLEAN — Data Quality Validation
  // ═══════════════════════════════════════════════════════
  let _qaImportFile = null;
  let _qaInitialized = false;
  let _qaRunning = false;

  // ═══════════════════════════════════════════════════════════════
  // Deterministic Text Cleaner — ported from backend textCleaner.js
  // All rules are regex-based, order-preserving, no AI/LLM logic.
  // ═══════════════════════════════════════════════════════════════
  const TEXT_CLEANER = (() => {
    // ── REGEX PATTERNS ──
    const RE_OUTLOOK_CHAIN = /(?:^|\n)\s*-{2,}\s*(?:Original Message|Forwarded Message|Reply message)\s*-{2,}\s*[\s\S]*/im;
    const RE_LOTUS_NOTES_CHAIN = /(?:^|\n)\s*-{3,}\s*\S[\s\S]*?\s+wrote:\s*-{3,}[\s\S]*/im;
    const RE_BEGIN_FWD = /(?:^|\n)\s*Begin forwarded message:\s*[\s\S]*/im;
    const RE_FROM_SENT_TO = /(?:^|\n)From:\s*.+\n\s*(?:Sent|Date):\s*.+\n\s*To:\s*.+(?:\n\s*Cc:\s*.+)?(?:\n\s*Subject:\s*.+)?(?:\n[\s\S]*)?$/im;
    const RE_FROM_TO_SUBJECT = /(?:^|\n)From:\s*.+\n\s*To:\s*.+\n\s*(?:Cc:\s*.+\n\s*)?Subject:\s*.+(?:\n[\s\S]*)?$/im;
    const RE_FROM_TO_DATE = /(?:^|\n)From:\s*.+\n\s*To:\s*.+(?:\n\s*Cc:\s*.+)?\n\s*Date:\s*.+(?:\n\s*Subject:\s*.+)?(?:\n[\s\S]*)?$/im;
    const RE_ON_WROTE = /(?:^|\n)On\s+.{10,120}\s+wrote:\s*(?:\n[\s\S]*)?$/im;
    const RE_SIG_DELIM = /\n-- ?\n[\s\S]{0,800}$/m;
    const RE_SIG_PHONE_LINE = /(?:\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]*\d{3}[\s.\-]\d{4}/;
    const RE_SIG_EMAIL_LINE = /[\w.-]+@[\w.-]+\.\w{2,}/;
    const RE_SIG_DOMAIN_LINE = /\b[\w-]+\.(?:com|org|net|io|us|edu|gov|co)\b/i;
    const RE_SIG_JOB_TITLE = /\b(?:CEO|CFO|CTO|COO|CIO|CMO|Founder|Co-?Founder|Director|Manager|VP|Vice\s+President|President|Engineer|Specialist|Coordinator|Administrator|Analyst|Consultant|Integrator|Architect|Designer|Developer|Supervisor|Technician|Representative)\b/i;
    const RE_SIG_COMPANY_SUFFIX = /\b(?:Inc|LLC|Corp|Ltd|L\.L\.C|Incorporated|Corporation)\b/i;
    const RE_SIG_CONTACT_LABEL = /^(?:E-?mail|Phone|Tel|Fax|Cell|Mobile|Office|Direct|Web|Website)\s*:/i;
    const RE_SIG_ADDRESS = /\d+\s+\w+\s+(?:St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Rd|Road|Ln|Lane|Way|Ct|Court|Pkwy|Hwy)\b|(?:Suite|Ste|Floor|Fl)\.?\s*#?\s*\d|\b[A-Z]{2}\s+\d{5}\b/i;
    const RE_SIGNOFF = /\n(?:[Bb]est [Rr]egards|[Kk]ind [Rr]egards|[Tt]hanks|[Tt]hank [Yy]ou|[Rr]egards|[Ss]incerely|[Cc]heers|[Rr]espectfully|[Bb]est|[Ww]arm [Rr]egards)[,.!]?\s*\n\p{Lu}\p{L}+ \p{Lu}\p{L}+.*(?:\n.{0,120}){0,8}$/mu;
    const RE_SIGNOFF_INLINE = /\s+(?:[Bb]est [Rr]egards|[Kk]ind [Rr]egards|[Tt]hanks|[Tt]hank [Yy]ou|[Rr]egards|[Ss]incerely|[Cc]heers|[Rr]espectfully|[Ww]arm [Rr]egards)[,.!]?\s+\p{Lu}\p{L}+ \p{Lu}\p{L}+[\s\S]{0,500}$/mu;
    const ENCODING_FIXES = [
      [/┬á/g,' '],[/Â /g,' '],[/Â/g,''],[/â€™/g,"'"],[/â€˜/g,"'"],[/â€œ/g,'"'],
      [/â€\u009d/g,'"'],[/â€\u201D/g,'—'],[/â€\u201C/g,'–'],[/â€"/g,'—'],
      [/â€¦/g,'...'],[/â€‹/g,''],[/â€/g,'"'],[/ï»¿/g,''],[/∩╗┐/g,''],[/\uFFFD/g,''],
      [/ΓÇÖ/g,"'"],[/ΓÇö/g,"'"],[/ΓÇ£/g,'"'],[/ΓÇ¥/g,'"'],[/ΓÇô/g,'–'],
      [/ΓÇÜ/g,'—'],[/ΓÇª/g,'…'],[/ΓÇ¿/g,''],[/ΓÇó/g,'•'],[/ΓÇÿ/g,"'"],[/ΓÇï/g,''],[/ΓÇÄ/g,'─'],
    ];
    const RE_HTML_TAGS = /<\/?([a-z][a-z0-9]*)\b[^>]*\/?>/gi;
    const KNOWN_HTML_TAGS = new Set([
      'a','abbr','address','article','aside','b','bdi','bdo','blockquote','body','br',
      'button','caption','center','cite','code','col','colgroup','dd','del','details',
      'dfn','div','dl','dt','em','fieldset','figcaption','figure','font','footer','form',
      'h1','h2','h3','h4','h5','h6','head','header','hr','html','i','iframe','img',
      'input','ins','kbd','label','legend','li','link','main','mark','meta','nav',
      'nobr','noscript','ol','option','p','pre','q','rp','rt','ruby','s','samp',
      'script','section','select','small','span','strike','strong','style','sub',
      'summary','sup','svg','table','tbody','td','textarea','tfoot','th','thead',
      'title','tr','u','ul','var','video','wbr',
    ]);
    const HTML_ENTITIES = [
      [/&nbsp;/gi,' '],[/&amp;/gi,'&'],[/&lt;/gi,'<'],[/&gt;/gi,'>'],
      [/&quot;/gi,'"'],[/&#0?39;/gi,"'"],[/&#x27;/gi,"'"],[/&apos;/gi,"'"],
    ];
    const RE_TICKET_PREFIX = /^\s*\[#[A-Z0-9-]+\]\s*/gm;
    const RE_SYSTEM_BOILERPLATE = /^(?:This is an automated response|This ticket has been|If you wish to provide additional|You can view this ticket)/gm;
    const RE_RECEIVED_FROM = /^Received\s+From:\s+\S+\s*/im;
    const RE_VIA_EMAIL = /(?:[\w\s.-]+<[\w.@+-]+>|'[^']+'\s*)\s*via\s+Email\s*\((?:to|cc)\)\s*/gi;
    const RE_SYSTEM_STATUS = /(?:^|\n)\s*(?:Status changed from\s+\S+\s+to\s+\S+(?:\s+by\s+.+)?|Ticket (?:flagged as overdue|reopened|closed|resolved|assigned|created)\s+(?:by\s+.+)?|SYSTEMReopened|Ticket created by agent\s*[-–—]\s*.+|.+changed ticket ownership to\s+.+)\s*$/gim;
    const RE_COLLABORATOR = /[\w\s.-]+<[\w.@+-]+>\s*added as a collaborator\s*/gi;
    const RE_QUOTED_NAMES_ONLY = /^(?:\s*'[^']+'\s*)+$/gm;
    const RE_MULTI_SPACES = /[ \t]+/g;
    const RE_MULTI_NEWLINES = /\n{3,}/g;

    // ── RULES REGISTRY (order matters) ──
    const RULES = [
      { id:'outlook_chain', label:'Outlook/Exchange Chains',
        apply: (t) => {
          let r = t.replace(RE_OUTLOOK_CHAIN,'').replace(RE_LOTUS_NOTES_CHAIN,'').replace(RE_BEGIN_FWD,'').replace(RE_FROM_SENT_TO,'').replace(RE_FROM_TO_SUBJECT,'').replace(RE_FROM_TO_DATE,'');
          const hasFwdMarker = /Begin forwarded message:/i.test(r);
          r = r.replace(/\s*Begin forwarded message:\s*/gi,' ');
          for (let pass=0; pass<3; pass++) {
            const m = r.match(/\bFrom:\s+\S.{3,200}?(?:Sent|Date):\s+\S.{3,120}?(?:To|Subject):\s+\S/im);
            if (!m) break;
            const pre = r.substring(0,m.index).trim();
            const pipeCount = (pre.match(/\|/g)||[]).length;
            const preIsNoise = m.index<50 || pre.length===0 || /^(?:--|—)/.test(pre) ||
              (pre.length<120 && /\d{3}[.\-)\s]\d{3}/.test(pre)) ||
              (pipeCount>=2 && /\d{3}[.\-)\s]\d{3}/.test(pre) && pre.length<350 && !/[.!?]\s+[A-Z][a-z]/.test(pre)) ||
              hasFwdMarker;
            if (preIsNoise) {
              const af = r.substring(m.index);
              const si = af.search(/\bSubject:\s/i);
              if (si>=0) {
                const as = af.substring(si);
                const sm = as.match(/^Subject:\s+.{1,120}?(?=\s{2,}[A-Za-z])/i);
                if (sm) { r = as.substring(sm[0].length).trim(); }
                else { r = as.replace(/^Subject:\s*/i,'').trim(); }
              } else {
                const bm = af.match(/(?:To|Cc):\s+\S[^]*?\s{2,}(.+)/i);
                if (bm) { r = bm[1].trim(); } else { r=''; break; }
              }
            } else { r = r.substring(0,m.index).trim(); break; }
          }
          return r;
        }
      },
      { id:'gmail_on_wrote', label:'Gmail "On…wrote:"',
        apply: (t) => {
          let r = t.replace(RE_ON_WROTE,'');
          const m = r.match(/\bOn\s+(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|\d{1,2}[\/\-]).{5,110}\s+wrote:\s*/im);
          if (m) r = r.substring(0,m.index).trim();
          return r;
        }
      },
      { id:'quote_prefix', label:'> Quote Lines',
        apply: (t) => {
          const lines = t.split('\n');
          const isQ = lines.map(l => /^>+\s?/.test(l));
          return lines.filter((_,i) => {
            if (!isQ[i]) return true;
            const prevQ = i>0 && isQ[i-1];
            const nextQ = i<lines.length-1 && isQ[i+1];
            return !prevQ && !nextQ;
          }).join('\n');
        }
      },
      { id:'sig_delimiter', label:'Signature Removal',
        apply: (t) => {
          let r = t.replace(/[ \t\u00A0]{2,}(?=[A-Z])/g,'\n');
          r = r.replace(/^\s*image\d+\.\w+\s+Download\s*$/gmi,'');
          r = r.replace(/\n{3,}/g,'\n\n');
          r = r.replace(RE_SIG_DELIM,'');
          // Phase 2: inline --Name with contact info
          const inlineDash = r.match(/\s*(?:--|—)[ \t]*\p{Lu}\p{L}[\s\S]{0,500}$/u);
          if (inlineDash) {
            const block = inlineDash[0];
            const hasPhone = /\d{3}[.\-)\s]\d{3}[.\-\s]\d{4}/.test(block);
            const hasContact = /[\w.-]+@[\w.-]+\.\w{2,}|\b[\w-]+\.(?:com|org|net|io|us|edu)\b/i.test(block);
            if ((hasPhone||hasContact) && inlineDash.index>0) r = r.substring(0,inlineDash.index).trim();
          }
          // Phase 3: bare corporate signature block
          const lines = r.split('\n');
          const tailStart = Math.max(0,lines.length-8);
          const countInd = (from,to) => {
            let s=0;
            for (let j=from;j<to;j++) {
              const ln = lines[j].trim(); if (!ln.length) continue;
              if (RE_SIG_PHONE_LINE.test(ln)) s++;
              if (RE_SIG_EMAIL_LINE.test(ln)) s++;
              if (RE_SIG_DOMAIN_LINE.test(ln) && !RE_SIG_EMAIL_LINE.test(ln) && !/https?:\/\//i.test(ln)) s++;
              if (RE_SIG_JOB_TITLE.test(ln) && ln.length<80) s++;
              if (RE_SIG_COMPANY_SUFFIX.test(ln)) s++;
              if (RE_SIG_CONTACT_LABEL.test(ln)) s++;
              if (RE_SIG_ADDRESS.test(ln)) s++;
            }
            return s;
          };
          const score = countInd(tailStart,lines.length);
          if (score>=2) {
            let cutAt=-1;
            const floor = Math.max(0,tailStart-2);
            for (let i=lines.length-1;i>=floor;i--) {
              if (lines[i].trim().length===0 && countInd(i+1,lines.length)>=2) { cutAt=i; break; }
            }
            if (cutAt>=0) {
              while (true) {
                let pe=-1;
                for (let i=cutAt-1;i>=0;i--) { if (lines[i].trim().length===0){pe=i;break;} }
                if (pe<0) break;
                if (countInd(pe+1,cutAt)>=2) { cutAt=pe; } else break;
              }
            }
            if (cutAt<0) {
              for (let i=tailStart;i<lines.length;i++) {
                const ln=lines[i].trim();
                if (/[.!?]$/.test(ln) && ln.length>5 && !/\b(?:Inc|LLC|Corp|Ltd)\.\s*$/i.test(ln) && countInd(i+1,lines.length)>=2) cutAt=i+1;
              }
            }
            if (cutAt>0 && cutAt<lines.length) {
              let adj=cutAt;
              while (adj>0) {
                const prev=lines[adj-1].trim();
                if (!prev.length){adj--;continue;}
                if (/^(?:Sincerely|Best regards|Kind regards|Thanks|Thank you|Regards|Cheers|Respectfully|Best|Warm regards)[,.!]?\s*$/i.test(prev)){adj--;continue;}
                break;
              }
              const rem=lines.slice(0,adj).join('\n').trim();
              if (rem.length>0) r=rem;
            }
          }
          // Phase 3b: inline pipe-delimited contact
          const pipeInline = r.match(/([\w.-]+@[\w.-]+\.\w{2,})\s*\|[\s\S]{10,500}$/);
          if (pipeInline) {
            const pc = r.substring(pipeInline.index);
            if (/\|[^|]*(?:\b(?:Mobile|Phone|Cell|Office|Direct|Fax|Tel)\b[^|]*\d{3})/i.test(pc)) {
              const before = r.substring(0,pipeInline.index);
              const ls = before.match(/(.*[.!?])\s*/s);
              if (ls && ls[1].trim().length>0) r = ls[1].trim();
            }
          }
          // Phase 4-7: mobile footers, trailing delimiters, confidentiality, antivirus
          r = r.replace(/\n?\s*Sent from my\s.{1,60}$/i,'').trim();
          if (r.length>5) {
            r = r.replace(/\s*-{2,}\s*$/,'').trim();
            r = r.replace(/\n?\s*Sent from my\s.{1,60}(?:\s*\n\s*-{3,}\s*Reply message[\s\S]*)?$/i,'').trim();
          }
          const cm = r.match(/\n\s*(?:CONFIDENTIAL(?:ITY)?\s*(?:NOTICE)?\s*:|DISCLAIMER\s*:)\s*(?:This|The|Any)\s[\s\S]{20,}$/i)
            || r.match(/\n\s*(?:Privileged or |This )(?:e-?mail|message|communication|email|correspondence|information)[\s\S]{10,120}?(?:confidential|intended|proprietary|authorized|recipient)[\s\S]{0,800}$/i)
            || r.match(/\n\s*(?:If you are not the intended|This email is solely intended)[\s\S]{20,}$/i);
          if (cm && cm.index>r.length*0.2) r = r.substring(0,cm.index).trim();
          r = r.replace(/\n?\s*This (?:e-?mail|message) has been (?:checked|scanned) for viruses[\s\S]{0,200}$/i,'').trim();
          return r;
        }
      },
      { id:'corporate_signoff', label:'Corporate Sign-off',
        apply: (t) => {
          let r = t.replace(RE_SIGNOFF,'').replace(RE_SIGNOFF_INLINE,'');
          // Pipe-delimited contact block
          const pb = r.match(/(?:[^|\n]*\|){2,}[^|]*(?:\d{3}[.\-)\s]\d{3}|[\w.-]+@[\w.-]+)[\s\S]{0,200}$/);
          if (pb && pb.index>r.length*0.4) {
            const pre = r.substring(Math.max(0,pb.index-150),pb.index);
            const nm = pre.match(/\p{Lu}\p{L}+(?:\s\p{Lu}[\p{L}.'-]+){1,3}\s*$/u);
            if (nm) r = r.substring(0,pb.index-pre.length+nm.index).trim();
          }
          // Inline signature: Name + role + phone + email
          const t300s = r.length>300?r.length-300:0;
          const tail = r.substring(t300s);
          const sm = tail.match(/(\p{Lu}\p{L}+(?:\s\p{Lu}[\p{L}.'-]+){1,3})\s+[\s\S]*?\d{3}[.\-)\s]\d{3}[.\-\s]\d{4}[\s\S]*$/u);
          if (sm) {
            const block = sm[0];
            const hasRole = /(?:Director|Manager|VP|President|Engineer|Specialist|Coordinator|Administrator|Analyst|Consultant|Integrator|Architect|Designer|Developer|Lead|Chief|Officer|Associate|Assistant|Senior|Junior|Head|Supervisor|Technician|Representative|Support|Marketing|Operations|Digital|Sales|Inc\b|LLC\b|Corp|Ltd\b|University|College|Group|Associates|Services|Solutions|Systems)\b/i.test(block);
            const hasCon = /[\w.-]+@[\w.-]+\.\w{2,}|\b[\w-]+\.(?:com|org|net|io|us|edu)\b/i.test(block);
            if ((hasRole&&hasCon)||(block.length<150&&hasCon)) r = r.substring(0,t300s+sm.index).trim();
          }
          return r;
        }
      },
      { id:'encoding_fix', label:'Encoding Artifacts',
        apply: (t) => { let r=t; for (const [p,v] of ENCODING_FIXES) r=r.replace(p,v); return r; }
      },
      { id:'html_strip', label:'HTML Tags & Entities',
        apply: (t) => {
          let r = t.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'');
          r = r.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
          r = r.replace(RE_HTML_TAGS, (match,tagName) => KNOWN_HTML_TAGS.has(tagName.toLowerCase())?'':match);
          for (const [p,v] of HTML_ENTITIES) r=r.replace(p,v);
          return r;
        }
      },
      { id:'supportdesk_noise', label:'SupportDesk System Noise',
        apply: (t) => {
          let r = t.replace(RE_TICKET_PREFIX,'').replace(RE_SYSTEM_BOILERPLATE,'').replace(RE_RECEIVED_FROM,'').replace(RE_VIA_EMAIL,'').replace(RE_SYSTEM_STATUS,'').replace(RE_COLLABORATOR,'').replace(RE_QUOTED_NAMES_ONLY,'');
          r = r.replace(/\s*image\d*\.\w{2,4}\s*Download/gi,'');
          r = r.replace(/\s*(?:attachment|image|file)\.php\?[^\s)}\]]+/gi,'');
          r = r.replace(/\s*Please consider our environment before printing this e-?mail\.?\s*/gi,'');
          r = r.replace(/\s*This (?:e-?mail|message) is intended (?:only |solely )?for .{20,500}?(?:prohibited|unauthorized|confidential|delete|destroy|disregard|notify)[^.]*\.?\s*/gi,'');
          r = r.replace(/\n?\s*Note:\s*This is an automated response[\s\S]*$/i,'').trim();
          // OOO auto-reply detection
          let ooo = r;
          ooo = ooo.replace(/^(?:(?:Hello|Hi|Hey|Dear\s+\w+)[,.]?\s*\n?\s*)*(?:(?:(?:Thanks|Thank\s+you)\s+for\s+[\s\S]{0,80}?\.\s*\n?\s*)*)?(?:I(?:'m| am| will be) (?:currently )?(?:out of (?:the )?office|away from (?:the )?office|on (?:vacation|leave|holiday|military training|PTO)))[\s\S]*$/i,'');
          if (ooo===r) ooo = ooo.replace(/^\s*\*+\s*OUT OF OFFICE[\s\S]*$/i,'');
          if (ooo===r) ooo = ooo.replace(/^(?:Hello|Hi)[,.]?\s+(?:you're |you are )?(?:the )?(?:lucky )?recipient\s+of\s+[\s\S]*(?:out of (?:the )?office|auto[- ]?reply)[\s\S]*$/i,'');
          if (ooo.trim().length < r.trim().length*0.2) r='';
          // Trailing company footer
          const RE_CA = /(?:[\w.-]+@[\w.-]+\.(?:com|org|net|io|us|edu)|\b[\w-]+\.(?:com|org|net|io|us|edu)(?=[\d\s|,;)$]))/i;
          const fm = r.match(new RegExp(RE_CA.source+'.{0,50}?\\d{3}[.\\-)\\s]\\d{3}[.\\-\\s]\\d{4}[\\s\\S]{0,300}$','i'));
          if (fm && fm[0].length<400) {
            const cre = /(?:[\w.-]+@[\w.-]+\.(?:com|org|net|io|us|edu)|\b[\w-]+\.(?:com|org|net|io|us|edu))/gi;
            const cms = fm[0].match(cre);
            if (cms && cms.length>=2) r = r.substring(0,fm.index).trim();
          }
          return r;
        }
      },
      { id:'pii_removal', label:'PII & Credential Removal',
        apply: (t) => {
          let r = t;
          r = r.replace(/\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g,'[EMAIL]');
          r = r.replace(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]\d{4}/g,'[PHONE]');
          r = r.replace(/\b\d{3}-\d{2}-\d{4}\b/g,'[SSN]');
          r = r.replace(/\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,'[IP]');
          r = r.replace(/(?:password|passwd|pwd|pass|pw|pssw)\s*[:=]\s*\S+/gi,'[REDACTED]');
          r = r.replace(/^(\s*)(?:Password|Passwd|Pass|PW|Pwd|Pssw)\s+(\S+)\s*$/gim,'$1[REDACTED]');
          r = r.replace(/\b\d{3}\s+\d{3}\s+\d{3,4}\b/g,'[REMOTE_ID]');
          r = r.replace(/\b[A-Z0-9]{4,5}-[A-Z0-9]{4,5}-[A-Z0-9]{4,5}(?:-[A-Z0-9]{4,5})*\b/g,'[LICENSE_KEY]');
          r = r.replace(/(?:Hardware ID|Device ID|Machine ID)\s*[:=]\s*\S+/gi,'[REDACTED]');
          r = r.replace(/(?:Kiosk Tag|Device Tag)\s*[:=]\s*\S+/gi,'[REDACTED]');
          r = r.replace(/(?:api[_-]?key|token|secret)\s*[:=]\s*['"]?\S{8,}/gi,'[REDACTED]');
          return r;
        }
      },
      { id:'whitespace_norm', label:'Whitespace Normalize',
        apply: (t) => t.replace(RE_MULTI_SPACES,' ').replace(RE_MULTI_NEWLINES,'\n\n').trim()
      },
    ];

    function cleanMessage(rawText) {
      if (!rawText || typeof rawText !== 'string') return '';
      let text = rawText;
      for (const rule of RULES) text = rule.apply(text);
      text = text.trim();
      // Smart overcleaning guard
      if (text.length===0 && rawText.trim().length>500) {
        text = rawText.trim();
        for (const rid of ['encoding_fix','html_strip','pii_removal','whitespace_norm']) {
          const rule = RULES.find(r=>r.id===rid); if (rule) text = rule.apply(text);
        }
        let check = text;
        for (const rid of ['outlook_chain','gmail_on_wrote','quote_prefix','sig_delimiter','corporate_signoff','supportdesk_noise']) {
          const rule = RULES.find(r=>r.id===rid); if (rule) check = rule.apply(check);
        }
        if (check.trim().length===0) text = '';
      }
      return text;
    }

    function htmlToCleanText(html) {
      if (!html) return '';
      let t = html;
      t = t.replace(/<br\s*\/?>/gi,'\n');
      t = t.replace(/<\/(?:p|div|h[1-6]|li|tr|blockquote|section|article|header|footer)>/gi,'\n');
      t = t.replace(/<[^>]+>/g,'');
      t = t.replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'"').replace(/&#0?39;/gi,"'").replace(/&apos;/gi,"'");
      t = t.replace(/[ \t]+/g,' ').replace(/\n[ \t]+/g,'\n').replace(/\n{3,}/g,'\n\n');
      return t.trim();
    }

    return { cleanMessage, htmlToCleanText, RULES };
  })();

  // ─── QA Clean Pipeline Engine ───
  const QA_PIPELINE = {
    originalData: null,
    cleanedData: null,
    lastRawTickets: [],
    log: [],
    issues: {},
    scores: {},
    stats: {},

    techRe: new RegExp(
      '(install|update|upgrade|download|restart|reboot|click|navigate|go to|' +
      'open|select|check|enable|disable|change|set|configure|enter|type|' +
      'run|execute|delete|remove|add|create|replace|' +
      'https?://|\\.exe|\\.msi|\\.dll|\\.fxg|\\.xml|version|v\\d+[.\\d]*|' +
      'registry|regedit|cmd|powershell|C:\\\\|Program Files|' +
      'settings|preferences|menu|script|function|' +
      'UAC|admin|privilege|firewall|DNS|IP\\b|port\\b|proxy|VPN|' +
      'license|ucode|activation|player|kiosk|TouchDirectory|Publisher|DataSync|' +
      'TCMS|secureview|fxg|swf|data\\s*list|calendar|feed|API|REST|JSON|XML|' +
      'artboard|ground layer|mask|zone|layout|template|component)', 'i'),

    greetingRe: /^(hi|hello|hey|dear|good morning|good afternoon)\b/i,
    sigRe: /(best regards|sincerely|thanks,?\s*$|thank you,?\s*$|kind regards|regards,?\s*$)/i,
    schedRe: /^(ticket (has been |was )?(assigned|created|escalated|forwarded|transferred))/i,
    noiseRe: /^(thanks|thank you|let me know|i will|we will|ok|okay|sure|got it|no problem|sounds good)\b/i,
    convStepRe: /(I have (forwarded|escalated|assigned|created)|will (follow up|get back|look into|check)|have (received|noted|logged)|apologize for|sorry for the (delay|inconvenience))/i,

    // ─── Issue Type Classifier ───
    // Order matters: more specific patterns first, broader ones later.
    issueTypeRules: [
      { type: 'screen_flickering', re: /\b(flicker|flickering|flashing|flash(?:ing)? on and off|blinking screen|welcome screen keeps flashing)\b/i },
      { type: 'display_connection_issue', re: /\b(blank screen|black screen|screen connected|connect a screen|display not detected|screen not recognized|windows os .*screen|no screens? being recogni[sz]ed|hdmi|monitor not detected)\b/i },
      { type: 'display_configuration_issue', re: /\b(anti[- ]alias|anti alias|portrait screen|orientation|rotate|resolution|player settings|display settings|graphics settings|layout display issue)\b/i },
      { type: 'software_version_compatibility', re: /\b(version conflict|compatible|compatibility|incompatible|upgrade|downgrade|framework|v\d+(\.\d+)?|content manager 2015|dataset .* compatible)\b/i },
      { type: 'license_activation_issue', re: /\b(license|ucode|activation\s*(code|key)|hardware\s*ID|machine\s*ID|registration\s*key|license\s*key|transfer\s*license|lost\s*license|license\s*renew|subscription|trial\s*(license|version|period)|license\s*expire|license\s*transfer|publisher\s*pro\s*license)\b/i },
      { type: 'account_access_issue', re: /\b(login|log\s*in|sign\s*in|password reset|credential|account access|user account|permission|access control|role|admin panel)\b/i },
      { type: 'remote_access_support', re: /\b(teamviewer|logmein|remote assistance|remote in|remote onto|remote access)\b/i },
      { type: 'calendar_integration', re: /\b(calendar|exchange\s*calendar|google\s*calendar|ical|ews|calendar\s*feed|event\s*feed|schedule\s*feed|outlook\s*calendar|room\s*calendar|meeting\s*room|room\s*book|event\s*list)\b/i },
      { type: 'api_integration', re: /\b(API|REST\s*API|JSON\s*feed|XML\s*feed|RSS\s*feed|webhook|endpoint|API\s*key|API\s*call|embed\s*code|iframe|API\s*integrat)\b/i },
      { type: 'data_sync_issue', re: /\b(DataSync|DataSynchroni[sz]|data\s*synchroni[sz]|sync\s*(issue|error|fail|problem|not)|not\s*sync|synchroni[sz]ation|data\s*feed|sync\s*password|publisher\s*version|datasync\s*password)\b/i },
      { type: 'player_offline', re: /\b(player\s*(offline|down|not\s*respond|disconnect|not\s*connect|not\s*running|restart|crash)|offline\s*player|loop\s*(indefinitely|continuously|forever)|demo\s*version|player\s*mode|player\s*service|player\s*not|player\s*is|player\s*keep|player\s*stop|reboot\s*(kiosk|player|device)|kiosk\s*(offline|down|restart|reboot|not\s*respond))\b/i },
      { type: 'license_issue', re: /\b(license|ucode|activation\s*(code|key)|hardware\s*ID|machine\s*ID|registration\s*key|license\s*key|transfer\s*license|lost\s*license|license\s*cost|license\s*renew|subscription|trial\s*(license|version|period)|license\s*expire|license\s*transfer|PP\s*license|publisher\s*pro\s*license)\b/i },
      { type: 'software_crash', re: /\b(crash|error\s*message|exception|not\s*working|freeze|frozen|hang(s|ing)?|stopped\s*working|blue\s*screen|BSOD|application\s*error|mailbox\s*full|bug|corrupt|broken\s*file)\b/i },
      { type: 'map_rendering', re: /\b(wayfind|artboard|ground\s*layer|floor\s*plan|3[dD]\s*map|building\s*map|interactive\s*map|directory\s*map|kiosk\s*map|map\s*render|map\s*display|map\s*edit|map\s*not|search\s*tool|you\s*are\s*here|pin\s*on\s*map|POI|point\s*of\s*interest|restroom|suite\s*number|tenant|store\s*list|directory\s*search|zone\s*(mask|layer)|mask\s*layer|map\s*layout)\b/i },
      { type: 'installation_issue', re: /\b(install|uninstall|reinstall|deploy|download\s*link|PP\s*link|getting\s*started|first\s*time|initial\s*setup|setup\s*wizard|setup\s*guide)\b/i },
      { type: 'display_issue', re: /\b(display|preview|screen|monitor|showing|not\s*appear|visible|not\s*loading|not\s*display|blank\s*screen|resolution|touch\s*screen|kiosk\s*display|ad\s*space|rotate|orientation|layout\s*display|photo\s*album|slide\s*show|popup|rendering)\b/i },
      { type: 'system_configuration', re: /\b(configur|settings|login|log\s*in|account|CMS|admin\s*panel|user\s*guide|tutorial|permission|password\s*reset|credential|profile|preference|manage\s*account|user\s*account|sign\s*in|access\s*control|role|training|back\s*end|backend|panel)\b/i },
      { type: 'content_issue', re: /\b(content\s*(update|manage|edit|change|modify|issue|problem)|RSS|app\s*switch|upload\s*image|image\s*size|video\s*content|media\s*file|font\s*(size|change|issue)|branding|logo\s*(change|update|add)|custom\s*design|template\s*design)\b/i },
      { type: 'monitoring_issue', re: /\b(monitor(ing)?|chart|graph|dashboard\s*view|coordinates|analytics|report\s*(view|generate)|metric|bar\s*(chart|graph)|data\s*visual)\b/i },
      { type: 'network_issue', re: /\b(network|IP\s*address|static\s*IP|remote\s*access|TeamViewer|LogMeIn|VPN|firewall|proxy|port\s*forward|DNS|bandwidth|internet\s*connect)\b/i },
      { type: 'hardware_issue', re: /\b(hardware\s*(recommend|issue|problem|spec)|tablet\s*recommend|physical\s*device|touchscreen\s*hardware|TV\s*input|HDMI|USB\s*device|mount|bracket|enclosure|kiosk\s*hardware)\b/i },
      // Broader catch-alls (checked last)
      { type: 'map_rendering', re: /\b(map|zone|mask|layout|floor|directory)\b.*\b(edit|update|change|render|show|display|add|remove|fix)/i },
      { type: 'display_issue', re: /\b(screen|display|preview|showing|appear|load|kiosk)\b.*\b(issue|problem|not|error|wrong|blank|black)/i },
      { type: 'system_configuration', re: /\b(setup|config|access|log\s*in|account|setting|permission)\b/i },
      { type: 'installation_issue', re: /\b(setup|set\s*up|download|new\s*(user|install|device|kiosk))\b/i },
    ],

    classifyIssueType(text) {
      return (window.KB_SHARED_RULES && window.KB_SHARED_RULES.classifyIssueType)
        ? window.KB_SHARED_RULES.classifyIssueType(text)
        : 'technical_support';
    },

    classifyIssueTypeFromEntry(entry) {
      return (window.KB_SHARED_RULES && window.KB_SHARED_RULES.classifyIssueTypeFromEntry)
        ? window.KB_SHARED_RULES.classifyIssueTypeFromEntry(entry)
        : this.classifyIssueType(`${entry?.source_subject || ''} ${entry?.problem || ''} ${entry?.solution || ''}`);
    },

    addLog(tag, msg) {
      const time = new Date().toLocaleTimeString('en-US', {hour12:false, hour:'2-digit', minute:'2-digit', second:'2-digit'});
      this.log.push({time, tag, msg});
    },

    // ─── Format Adapter: raw scraper export → knowledge base format ───
    // v3: QA Clean only does date filter + preserve all messages individually.
    //     No problem/solution extraction — that is the job of AI Distill.
    convertSingleTicketLight(ticket) {
      const tid      = ticket.ticket_header?.ticket_number || '';
      const subject  = ticket.ticket_header?.subject || '';
      const msgs     = ticket.ticket_thread_section?.messages || [];
      const createdAt = ticket.ticket_summary_left_panel?.create_date || null;
      const status   = ticket.ticket_summary_left_panel?.status || '';

      // ── Date filter: last 4 years only ──
      if (createdAt) {
        const cutoff = new Date();
        cutoff.setFullYear(cutoff.getFullYear() - 4);
        if (new Date(createdAt) < cutoff) return null;
      }

      // ── Keep every client + staff message individually ──
      const messages = [];
      for (const m of msgs) {
        const role = m.poster_role || '';
        if (role !== 'client' && role !== 'staff') continue;
        const text = (m.message_body_clean_text || '').trim();
        if (text.length < 5) continue;
        messages.push({ role, ts: m.posted_at || '', text: text.slice(0, 2000) });
      }

      if (messages.length === 0) return null;
      if (!messages.some(m => m.role === 'staff')) return null;

      return {
        ticket_id:     tid,
        subject,
        created_at:    createdAt,
        status,
        messages,                         // full conversation, one entry per message
        message_count: messages.length,
        // placeholder fields — will be replaced by AI Distill
        problem:       subject.replace(/^(FW|RE|Fwd):\s*/i, '').trim() || tid,
        solution:      '(pending AI Distill)',
        issue_type:    'unknown',
        confidence:    'low',
        root_cause:    null,
        technical_signals: {},
        source_subject: subject,
      };
    },

    // Full single-ticket converter with TEXT_CLEANER (used for small datasets)
    // v3: date filter (4 years) + preserve ALL messages individually — no extraction (AI Distill handles that)
    convertSingleTicket(ticket) {
      const tid = ticket.ticket_header?.ticket_number || '';
      const subject = ticket.ticket_header?.subject || '';
      const msgs = ticket.ticket_thread_section?.messages || [];
      const createdAt = ticket.ticket_summary_left_panel?.create_date || null;
      const status = ticket.ticket_summary_left_panel?.status || '';

      // ── Date filter: last 4 years only ──
      if (createdAt) {
        const cutoff = new Date();
        cutoff.setFullYear(cutoff.getFullYear() - 4);
        if (new Date(createdAt) < cutoff) return null;
      }

      // Keep every client + staff message individually (TEXT_CLEANER applied)
      const messages = [];
      for (const m of msgs) {
        const role = m.poster_role || '';
        if (role !== 'client' && role !== 'staff') continue;
        let rawText = m.message_body_clean_text || '';
        if ((!rawText || rawText.length < 10) && m.message_body_html) {
          rawText = TEXT_CLEANER.htmlToCleanText(m.message_body_html);
        }
        if (!rawText || rawText.trim().length < 5) continue;
        const cleaned = TEXT_CLEANER.cleanMessage(rawText);
        if (!cleaned || cleaned.trim().length < 5) continue;
        messages.push({ role, ts: m.posted_at || '', text: cleaned.slice(0, 2000) });
      }

      if (messages.length === 0) return null;
      if (!messages.some(m => m.role === 'staff')) return null;

      return {
        ticket_id:     tid,
        subject,
        created_at:    createdAt,
        status,
        messages,                         // full conversation, one entry per message
        message_count: messages.length,
        // placeholder fields — will be replaced by AI Distill
        problem:       subject.replace(/^(FW|RE|Fwd):\s*/i, '').trim() || tid,
        solution:      '(pending AI Distill)',
        issue_type:    'unknown',
        confidence:    'low',
        root_cause:    null,
        technical_signals: {},
        source_subject: subject,
      };
    },

    convertRawExport(rawTickets) {
      this.addLog('info', `Detected raw scraper export format (${rawTickets.length} tickets). Converting with full text cleaning...`);
      const entries = [];
      for (const ticket of rawTickets) {
        const entry = this.convertSingleTicket(ticket);
        if (entry) entries.push(entry);
      }
      this.addLog('info', `Converted ${rawTickets.length} raw tickets → ${entries.length} knowledge entries`);
      return entries;
    },

    // ─── Detect format and return normalized entries ───
    validateInput(data) {
      this.addLog('info', 'Validating input structure...');

      // Format 1: Knowledge base format {VALID_KNOWLEDGE_DATASET: [...]}
      if (data.VALID_KNOWLEDGE_DATASET) {
        const entries = data.VALID_KNOWLEDGE_DATASET;
        this.addLog('info', `Format: Knowledge Base (${entries.length} entries)`);
        return entries;
      }

      // Format 2: Raw scraper export (array of tickets with ticket_header)
      if (Array.isArray(data) && data.length > 0 && data[0].ticket_header) {
        return this.convertRawExport(data);
      }

      // Format 3: Plain array of knowledge entries
      if (Array.isArray(data) && data.length > 0 && (data[0].problem || data[0].solution)) {
        this.addLog('info', `Format: Plain array (${data.length} entries)`);
        return data;
      }

      // Format 4: {entries: [...]}
      if (data.entries && Array.isArray(data.entries)) {
        this.addLog('info', `Format: Wrapped entries (${data.entries.length} entries)`);
        return data.entries;
      }

      throw new Error('Unrecognized JSON format. Expected: knowledge base JSON, raw scraper export, or array of entries.');
    },

    // ─── Stage 1b: Apply text cleaning to existing KB entries ───
    // For KB-format input, the problem/solution fields may still contain
    // HTML residue, email chains, signatures, encoding artifacts, etc.
    // --- URL Fix: separate URLs merged with adjacent text ---
    fixUrls(text) {
      let t = text;
      // Fix URLs appended without space after file extensions: ".exeUcode:" → ".exe\nUcode:"
      t = t.replace(/(\.(?:exe|msi|zip|dll|fxg|xml|php|json))\s*([A-Z][a-z])/g, '$1\n$2');
      // Fix ")http://" → ")\nhttp://" — closing paren merged with URL
      t = t.replace(/(\))(https?:\/\/)/g, '$1\n$2');
      // Fix "label:URL" patterns like "V4.1:http://" → "V4.1: http://"
      t = t.replace(/(\w):(https?:\/\/)/g, '$1: $2');
      // Fix "computer.http://" → "computer.\nhttp://"
      t = t.replace(/(\w)\.(https?:\/\/)/g, '$1.\n$2');
      return t;
    },

    // --- Component Normalization: standardize product names ---
    COMPONENT_MAP: {
      'touchdirectory': 'TouchDirectory',
      'touch directory': 'TouchDirectory',
      'touch\ndirectory': 'TouchDirectory',
      'content manager': 'Content Manager',
      'publisherpro': 'Content Manager',
      'pulisherpro': 'Content Manager',
      'datasync': 'DataSync',
      'data sync': 'DataSync',
      'data synchronization': 'DataSync',
      'secureview': 'SecureView',
      'secureview': 'SecureView',
      'tcms': 'TCMS',
    },
    normalizeComponents(text) {
      let t = text;
      // Normalize product names (case-insensitive replacements)
      t = t.replace(/\btouch\s*directory\b/gi, 'TouchDirectory');
      t = t.replace(/\bpulisher\s*pro\b/gi, 'Content Manager');    // typo fix
      t = t.replace(/\bpublisher\s*pro\b/gi, 'Content Manager');
      t = t.replace(/\bdata\s*sync(?:hroni[sz](?:ation|e)?)?\b/gi, (m) => {
        if (/synchroni/i.test(m)) return 'DataSync (data synchronization)';
        return 'DataSync';
      });
      t = t.replace(/\b22\s+miles\b/gi, 'SecureView');
      // Don't normalize "secureview" in URLs
      t = t.replace(/(?<![\w\/\.])secureview(?![\w\/\.])/gi, 'SecureView');
      return t;
    },

    // --- Email artifact cleaner ---
    cleanEmailArtifacts(text) {
      let t = text;
      // Remove "---------- Original Message" marker only (keep content after it)
      t = t.replace(/-{5,}\s*Original Message\s*-{5,}/gi, '');
      // Remove email header blocks (consecutive From/To/Sent/Subject/CC lines)
      t = t.replace(/^(?:From|To|Sent|Date|Subject|CC|BCC):\s+.+$/gim, '');
      // Remove "On ... wrote:" patterns
      t = t.replace(/\n*On .{10,80} wrote:\s*/gi, '\n');
      // Remove underscores dividers (_____)
      t = t.replace(/_{5,}/g, '');
      // Remove "to: Name (email" patterns  (lowercase "to:" is artifact, not content)
      t = t.replace(/^to:\s+\w[\w\s,]+\(.*$/gim, '');
      // Remove "from: " artifact lines
      t = t.replace(/^from:\s+.*$/gim, '');
      // Remove "Replied by email" solutions
      t = t.replace(/^Replied by email\.?\s*$/gim, '');
      // Remove "Sent by email" solutions
      t = t.replace(/^Sent by email\.?\s*$/gim, '');
      // Collapse excessive blank lines left over
      t = t.replace(/\n{3,}/g, '\n\n');
      return t.trim();
    },

    isProblemGarbage(text) {
      return !!(window.KB_SHARED_RULES && window.KB_SHARED_RULES.isProblemGarbage && window.KB_SHARED_RULES.isProblemGarbage(text));
    },

    deepCleanTexts(entries) {
      this.addLog('info', 'Stage 1b: Deep-cleaning text fields + classifying issue types...');
      let cleaned = 0, charsRemoved = 0, classified = 0, garbageProblems = 0;
      entries.forEach(e => {
        // Clean problem field
        const origP = (e.problem || '');
        let cleanP = TEXT_CLEANER.cleanMessage(origP);
        cleanP = this.cleanEmailArtifacts(cleanP);          // Fix 4: email artifacts
        cleanP = this.fixUrls(cleanP);                       // Fix 1: URL bugs
        cleanP = this.normalizeComponents(cleanP);           // Fix 2: component normalization
        if (this.isProblemGarbage(cleanP)) {
          e._problem_garbage = true;
          garbageProblems++;
        }
        if (cleanP !== origP && cleanP.length >= 5) {
          charsRemoved += origP.length - cleanP.length;
          e.problem = cleanP;
          cleaned++;
        }
        // Clean solution field
        const origS = (e.solution || '');
        let cleanS = TEXT_CLEANER.cleanMessage(origS);
        cleanS = this.cleanEmailArtifacts(cleanS);           // Fix 4: email artifacts
        cleanS = this.fixUrls(cleanS);                        // Fix 1: URL bugs
        cleanS = this.normalizeComponents(cleanS);            // Fix 2: component normalization
        if (cleanS !== origS && cleanS.length >= 5) {
          charsRemoved += origS.length - cleanS.length;
          e.solution = cleanS;
          cleaned++;
        }
        // Always re-classify locally after cleaning. Do not depend on imported issue_type.
        const prevType = e.issue_type;
        e.issue_type = this.classifyIssueTypeFromEntry(e);
        if (e.issue_type !== prevType) classified++;
        // Extract technical signals if empty (e.g. from light converter)
        if (!e.technical_signals || Object.keys(e.technical_signals).length === 0) {
          const allText = (e.problem||'') + ' ' + (e.solution||'');
          const sig = {};
          const u = allText.match(/https?:\/\/[^\s<>"]+/g); if (u) sig.urls = [...new Set(u)];
          const v = allText.match(/v\d+[\.\d]*/gi); if (v) sig.versions = [...new Set(v)];
          const f = allText.match(/[\w\-]+\.(exe|msi|dll|fxg|xml|json|csv|swf|html|zip|pdf)/gi); if (f) sig.files = [...new Set(f)];
          const c = allText.match(/(TouchDirectory|Publisher|DataSync|TCMS|secureview|Kiosk|Player)\w*/gi); if (c) sig.software_components = [...new Set(c)];
          e.technical_signals = sig;
        }
      });
      this.addLog('info', `Deep-cleaned ${cleaned} fields, removed ${(charsRemoved/1024).toFixed(0)}KB noise, classified ${classified} issue types, flagged ${garbageProblems} problem-form artifacts`);
      return entries;
    },

    removeJunk(entries) {
      this.addLog('info', 'Stage 2: Removing junk entries...');
      let removed = 0;
      const spamRe = /\b(USPS|FedEx|DHL|package\s*(pickup|delivery|tracking)|out\s*of\s*office|auto[\s-]*reply|automatic\s*reply|maternity\s*leave|I\s*am\s*currently\s*(out|away|unavailable)|undeliverable|delivery\s*(status|notification|failure)|mailer[\s-]*daemon|postmaster|noreply|do[\s-]*not[\s-]*reply)\b/i;
      const oooRe = /^(I\s*(am|will be)\s*(out|away|on\s*vacation|unavailable)|out\s*of\s*office|auto[\s-]*reply|automatic\s*reply)/i;
      const result = entries.filter(e => {
        const p = (e.problem || '').trim();
        const s = (e.solution || '').trim();
        if (!p || p.length < 5 || !s || s.length < 5) { removed++; this.addLog('remove', `[${e.ticket_id}] Empty problem or solution`); return false; }
        if (e._problem_garbage || this.isProblemGarbage(p)) { removed++; this.addLog('remove', `[${e.ticket_id}] Problem is HTML/form garbage`); return false; }
        if (window.KB_SHARED_RULES && window.KB_SHARED_RULES.isSupportRequestNoise && window.KB_SHARED_RULES.isSupportRequestNoise(p, s)) { removed++; this.addLog('remove', `[${e.ticket_id}] Support-request/admin inquiry is not KB knowledge`); return false; }
        if (this.greetingRe.test(p) && p.length < 30 && !this.techRe.test(p)) { removed++; this.addLog('remove', `[${e.ticket_id}] Greeting-only problem`); return false; }
        if (this.schedRe.test(s) && !this.techRe.test(s)) { removed++; this.addLog('remove', `[${e.ticket_id}] Ticket assignment, no tech`); return false; }
        // Spam/non-ticket detection: shipping notifications, auto-replies
        if (spamRe.test(p) && !this.techRe.test(s)) { removed++; this.addLog('remove', `[${e.ticket_id}] Spam/non-ticket: "${p.slice(0,60)}"`); return false; }
        // Out-of-office: must START with OOO pattern (not just mention "vacation" in passing)
        if (oooRe.test(p) && !this.techRe.test(s)) { removed++; this.addLog('remove', `[${e.ticket_id}] Out-of-office: "${p.slice(0,60)}"`); return false; }
        if (spamRe.test(e.source_subject||'') && (/^\(empty\)$/i.test(s) || s.length < 20) && !this.techRe.test(s)) { removed++; this.addLog('remove', `[${e.ticket_id}] Spam subject + empty solution`); return false; }
        // Empty/placeholder solutions like "(empty)"
        if (/^\(empty\)$/i.test(s)) { removed++; this.addLog('remove', `[${e.ticket_id}] Empty placeholder solution`); return false; }
        return true;
      });
      this.issues['junk_entries'] = {count: removed, action:'removed'};
      this.addLog('info', `Removed ${removed} junk entries (${entries.length} → ${result.length})`);
      return result;
    },

    removeFragments(entries) {
      this.addLog('info', 'Stage 3: Removing fragments, questions, and noise...');
      let removed = 0;
      const counts = { solution_is_question: 0, scheduling_solution: 0, ack_problem: 0, time_proposal: 0, weak_solution: 0, conversational: 0, fragment: 0 };
      const result = entries.filter(e => {
        const s = (e.solution || '').trim();
        const p = (e.problem || '').trim();

        // V9 removal: solution_is_question — solution ends with "?" and has no actionable content
        if (s.endsWith('?') && !this.techRe.test(s)) {
          removed++; counts.solution_is_question++;
          this.addLog('remove', `[${e.ticket_id}] Solution is question: "${s.slice(0,60)}"`);
          return false;
        }
        // V9 removal: solution ends with "?" even with some tech — if mostly questions
        if (s.endsWith('?')) {
          const sentences = s.split(/[.!?]+/).filter(x => x.trim().length > 5);
          const questionSentences = s.split(/(?<=[?])\s+/).filter(x => x.trim().endsWith('?'));
          if (questionSentences.length > sentences.length * 0.6) {
            removed++; counts.solution_is_question++;
            this.addLog('remove', `[${e.ticket_id}] Solution mostly questions`);
            return false;
          }
        }

        // V9 removal: scheduling_solution — solution is about scheduling, not technical
        if (/\b(schedule|remote\s*session|TeamViewer|time\s*slot|connect\s*to|set\s*up\s*a\s*(call|meeting|session)|available\s*(at|on|for)|what\s*time|when\s*(can|would|is)|calendar\s*invite)\b/i.test(s) && !this.techRe.test(s)) {
          removed++; counts.scheduling_solution++;
          this.addLog('remove', `[${e.ticket_id}] Scheduling solution: "${s.slice(0,60)}"`);
          return false;
        }
        // Also catch: solution is purely about remote access setup without substance
        if (/\b(remote\s*in|TeamViewer|LogMeIn|screen\s*share|remote\s*access)\b/i.test(s) && s.length < 120 && !this.techRe.test(s.replace(/TeamViewer|LogMeIn|remote/gi, ''))) {
          removed++; counts.scheduling_solution++;
          this.addLog('remove', `[${e.ticket_id}] Remote access only: "${s.slice(0,60)}"`);
          return false;
        }

        // V9 removal: ack_problem — problem is just acknowledgment/noise/greeting
        // Safety: keep if the solution has actionable tech content
        if (/^(thanks|thank you|ok |okay|got it|sure|sounds good|great|perfect|that works|will do|noted|understood|awesome|wonderful|excellent|dears?[,.]?\s)/i.test(p) && p.length < 80 && !this.techRe.test(p) && !this.techRe.test(s)) {
          removed++; counts.ack_problem++;
          this.addLog('remove', `[${e.ticket_id}] Ack problem: "${p.slice(0,60)}"`);
          return false;
        }
        // Problem is just internal note: "Test - Level 1 Support", "test ticket id"
        if (/^(test\b|Test\s*-\s*Level|NON-BINDING NOTICE)/i.test(p) && !this.techRe.test(s)) {
          removed++; counts.ack_problem++;
          this.addLog('remove', `[${e.ticket_id}] Test/noise problem: "${p.slice(0,60)}"`);
          return false;
        }
        // Problem is billing/payment/invoice with no tech in solution
        if (/\b(invoice|payment|billing|check\s*payment|purchase\s*order|accounts?\s*payable|wire\s*transfer)\b/i.test(p) && !this.techRe.test(p) && !this.techRe.test(s)) {
          removed++; counts.ack_problem++;
          this.addLog('remove', `[${e.ticket_id}] Billing (non-tech): "${p.slice(0,60)}"`);
          return false;
        }

        // V9 removal: time_proposal — solution is just time proposals
        if (/\b(how about|let'?s (try|do|schedule)|does .{0,20} work|I'?m available|available (at|on|from))\b/i.test(s) && s.length < 150 && !this.techRe.test(s)) {
          removed++; counts.time_proposal++;
          this.addLog('remove', `[${e.ticket_id}] Time proposal: "${s.slice(0,60)}"`);
          return false;
        }

        // Fix 3+: Weak solutions — filter non-actionable, placeholder, terse, and system artifact solutions
        // System artifacts: "replied by email", "sent by email", "ticket assignment", "ticket claimed by X", "posted on pm"
        if (/^(replied\s*(by|in)\s*email|sent\s*(by|in)\s*email|ticket\s*(assignment|claimed\s*by\s*\w+)|posted\s*on\s*pm|component\s*id|myooh|\(empty\)|see\s*ticket|refer\s*to\s*ticket)\.?\s*$/i.test(s)) {
          removed++; counts.weak_solution++;
          this.addLog('remove', `[${e.ticket_id}] Weak solution (system artifact): "${s.slice(0,60)}"`);
          return false;
        }
        // Terse one-word resolutions: "Fixed." / "Done." / "Resolved." / "answered" / "All set." / "resovled" etc.
        if (/^(fixed|done|resolved|resovled|answered|completed|working\s*now|it'?s?\s*(good\s*now|working|fixed)|all\s*set|this\s*one\s*is\s*fixed|this\s*is\s*simp|directed\s*to\s*\w+)\.?\s*$/i.test(s)) {
          removed++; counts.weak_solution++;
          this.addLog('remove', `[${e.ticket_id}] Weak solution (terse resolution): "${s.slice(0,60)}"`);
          return false;
        }
        if (s.length < 30 && !this.techRe.test(s)) {
          removed++; counts.weak_solution++;
          this.addLog('remove', `[${e.ticket_id}] Weak solution (too short, no tech): "${s.slice(0,60)}"`);
          return false;
        }
        // Cross-reference or "see attached" only (no actual instructions)
        if (/^(please refer to|please see|see attached|see ticket|refer to|per attached|here is the documentation|please see the attached|please refer to the attached)\b/i.test(s) && s.length < 100 && !this.techRe.test(s)) {
          removed++; counts.weak_solution++;
          this.addLog('remove', `[${e.ticket_id}] Weak solution (cross-ref only): "${s.slice(0,60)}"`);
          return false;
        }
        // Solutions that are just "please/we will/I'll" promises without tech content
        if (/^(please|kindly|we will|I will|let me|I am going to|we'll|I'll|going to)\b/i.test(s) && s.length < 100 && !this.techRe.test(s)) {
          removed++; counts.weak_solution++;
          this.addLog('remove', `[${e.ticket_id}] Weak solution (promise only): "${s.slice(0,60)}"`);
          return false;
        }
        // Solutions that end with question and are very short
        if (s.endsWith('?') && s.length < 100 && !this.techRe.test(s)) {
          removed++; counts.weak_solution++;
          this.addLog('remove', `[${e.ticket_id}] Weak solution (short question): "${s.slice(0,60)}"`);
          return false;
        }
        // "Please post on PM" / "Please post." type internal routing
        if (/^(please\s*(post|check|take\s*a\s*look)|you'?re\s*welcome)\b/i.test(s) && s.length < 80 && !this.techRe.test(s)) {
          removed++; counts.weak_solution++;
          this.addLog('remove', `[${e.ticket_id}] Weak solution (internal routing): "${s.slice(0,60)}"`);
          return false;
        }
        // "We don't at the moment." / non-actionable short negative
        if (/^(we\s*don'?t|no,?\s*we|not\s*(at\s*this\s*time|currently|yet))\b/i.test(s) && s.length < 60 && !this.techRe.test(s)) {
          removed++; counts.weak_solution++;
          this.addLog('remove', `[${e.ticket_id}] Weak solution (negative/no-answer): "${s.slice(0,60)}"`);
          return false;
        }

        // Original noise checks
        if (this.noiseRe.test(s) && s.length < 60 && !this.techRe.test(s)) { removed++; counts.conversational++; this.addLog('remove', `[${e.ticket_id}] Conversational: "${s.slice(0,50)}"`); return false; }
        if (this.convStepRe.test(s) && !this.techRe.test(s) && s.length < 120) { removed++; counts.conversational++; this.addLog('remove', `[${e.ticket_id}] Conv step: "${s.slice(0,50)}"`); return false; }
        if (p.length < 15 && !this.techRe.test(p)) { removed++; counts.fragment++; this.addLog('remove', `[${e.ticket_id}] Fragment: "${p}"`); return false; }
        return true;
      });
      this.issues['solution_is_question'] = {count: counts.solution_is_question, action:'removed'};
      this.issues['scheduling_solution'] = {count: counts.scheduling_solution, action:'removed'};
      this.issues['ack_problem'] = {count: counts.ack_problem, action:'removed'};
      this.issues['time_proposal'] = {count: counts.time_proposal, action:'removed'};
      this.issues['weak_solution'] = {count: counts.weak_solution, action:'removed'};
      this.issues['fragments'] = {count: counts.conversational + counts.fragment, action:'removed'};
      this.addLog('info', `Removed ${removed} entries (questions:${counts.solution_is_question} sched:${counts.scheduling_solution} ack:${counts.ack_problem} time:${counts.time_proposal} weak:${counts.weak_solution} conv:${counts.conversational} frag:${counts.fragment})`);
      return result;
    },

    mergeTickets(entries) {
      this.addLog('info', 'Stage 4: Merging multi-entry tickets...');
      const byTicket = {};
      entries.forEach(e => { const t = e.ticket_id||''; if (!byTicket[t]) byTicket[t]=[]; byTicket[t].push(e); });
      let merged = 0;
      const result = [];
      for (const [tid, group] of Object.entries(byTicket)) {
        if (group.length === 1) { result.push(group[0]); continue; }
        let best = group[0], bestScore = -1;
        for (const e of group) {
          let sc = 0; const s = (e.solution||'').trim();
          if (e.confidence === 'high') sc += 3;
          if (e.confidence === 'medium') sc += 1;
          if (this.techRe.test(s)) sc += 3;
          sc += Math.min(s.length/100, 3);
          if (sc > bestScore) { bestScore = sc; best = e; }
        }
        const allSig = {};
        let bestRC = best.root_cause;
        for (const e of group) {
          const ts = e.technical_signals || {};
          if (typeof ts === 'object' && !Array.isArray(ts)) {
            for (const [k,v] of Object.entries(ts)) { if (v && (!allSig[k] || (Array.isArray(v) && v.length > (allSig[k]||[]).length))) allSig[k] = v; }
          }
          if (!bestRC && e.root_cause) bestRC = e.root_cause;
        }
        result.push({...best, technical_signals: allSig, root_cause: bestRC, consolidated_from: group.length});
        merged += group.length - 1;
      }
      this.issues['merged'] = {count: merged, action:'merged'};
      this.addLog('info', `Merged ${merged} duplicates (${entries.length} → ${result.length})`);
      return result;
    },

    cleanProblems(entries) {
      this.addLog('info', 'Stage 5: Cleaning problems...');
      let cleaned = 0;
      entries.forEach(e => {
        let p = (e.problem||'').trim(); const orig = p;
        // Email artifact cleanup (Fix 4)
        p = p.replace(/-{5,}\s*Original Message\s*-{5,}/gi, '');
        p = p.replace(/^(?:From|To|Sent|Date|Subject|CC|BCC):\s+.+$/gim, '');
        p = p.replace(/_{5,}/g, '');
        // URL separation fix (Fix 1) - but preserve URLs themselves
        p = p.replace(/(\.(?:exe|msi|zip|dll|fxg|xml|php))\s*([A-Z][a-z])/g, '$1\n$2');
        // Standard cleaning
        p = p.replace(/^(hi|hello|hey|dear\s+\w+),?\s*/i, '');
        p = p.replace(/^(good\s+(morning|afternoon|evening)),?\s*/i, '');
        p = p.replace(/\n*Best regards,?.*$/is, '');
        p = p.replace(/\n*Kind regards,?.*$/is, '');
        p = p.replace(/\n*Sincerely,?.*$/is, '');
        p = p.replace(/\n*Regards,?.*$/is, '');
        p = p.replace(/\n*NON-BINDING NOTICE:.*$/is, '');
        // Fix: don't aggressively strip URLs — only remove trailing bare www if after newline and not part of solution
        p = p.replace(/\n+www\.\w+\.\w+\s*$/i, '');
        p = p.replace(/\n*\[EMAIL\].*$/is, '');
        p = p.replace(/\n*(Cel|Telf):.*$/is, '');
        p = p.replace(/^[!?.:;\-'"]\s*/, '');
        // Credential standardization
        p = p.replace(/\[REDACTED\]/gi, '[CREDENTIALS]');
        p = p.replace(/\b(username|user|login)\s*[:=]\s*\S+/gi, '[CREDENTIALS]');
        p = p.replace(/\b(password|pass|pwd)\s*[:=]\s*\S+/gi, '[CREDENTIALS]');
        // Component normalization (Fix 2)
        p = this.normalizeComponents(p);
        p = p.trim();
        if (p !== orig && p.length > 5) { e.problem = p; cleaned++; }
      });
      this.issues['problem_cleaning'] = {count: cleaned, action:'fixed'};
      this.addLog('clean', `Cleaned ${cleaned} problems`);
      return entries;
    },

    cleanSolutions(entries) {
      this.addLog('info', 'Stage 6: Cleaning solutions...');
      let cleaned = 0;
      entries.forEach(e => {
        let s = (e.solution||'').trim(); const orig = s;
        // Email artifact cleanup (Fix 4)
        s = s.replace(/-{5,}\s*Original Message\s*-{5,}/gi, '');
        s = s.replace(/^(?:From|To|Sent|Date|Subject|CC|BCC):\s+.+$/gim, '');
        s = s.replace(/_{5,}/g, '');
        // URL separation fix (Fix 1)
        s = s.replace(/(\.(?:exe|msi|zip|dll|fxg|xml|php))\s*([A-Z][a-z])/g, '$1\n$2');
        s = s.replace(/(\w):(https?:\/\/)/g, '$1: $2');
        // Standard cleaning
        s = s.replace(/^Ticket (has been |was )?(assigned|created|escalated|forwarded|transferred)\s*(to|by)\s*[^.]+\.\s*/i, '');
        s = s.replace(/^(hi|hello|hey|dear)\s+\w+,?\s*/i, '');
        s = s.replace(/^(good\s+(morning|afternoon|evening))\s*\w*,?\s*/i, '');
        s = s.replace(/^(thanks for (contacting|reaching out|your (email|message|patience)))[^.]*\.\s*/i, '');
        s = s.replace(/\s*(Sorry for the late reply,?\s*(and\s*)?)?[Ff]eel free to .*$/i, '');
        s = s.replace(/\s*[Pp]lease (let (me|us) know|don't hesitate).*$/i, '');
        s = s.replace(/\s*Thanks\.?\s*$/i, '');
        s = s.replace(/\s*Thank you\.?\s*$/i, '');
        s = s.replace(/\s*Best regards,?.*$/is, '');
        s = s.replace(/\s*Kind regards,?.*$/is, '');
        s = s.replace(/\s*Regards,?.*$/is, '');
        // Remove "Replied by email" type placeholders
        s = s.replace(/^Replied by email\.?\s*$/gim, '');
        s = s.replace(/^Sent by email\.?\s*$/gim, '');
        if (s.endsWith('?')) {
          const sentences = s.split(/(?<=[.!])\s+/);
          const nonQ = sentences.filter(x => !x.trim().endsWith('?'));
          const nonQText = nonQ.join(' ').trim();
          if (this.techRe.test(nonQText) && nonQText.length > 30) s = nonQText;
        }
        s = s.replace(/TeamViewer\s*(ID|password|access)\s*[:=]\s*\S+/gi, '[REMOTE_ACCESS]');
        // Credential standardization: [REDACTED] → [CREDENTIALS], clean exposed user/pass lines
        s = s.replace(/\[REDACTED\]/gi, '[CREDENTIALS]');
        s = s.replace(/\b(username|user|login)\s*[:=]\s*\S+/gi, '[CREDENTIALS]');
        s = s.replace(/\b(password|pass|pwd)\s*[:=]\s*\S+/gi, '[CREDENTIALS]');
        s = s.replace(/\b(api[\s_-]?key|token|secret)\s*[:=]\s*\S+/gi, '[CREDENTIALS]');
        // Component normalization in solutions (Fix 2)
        s = this.normalizeComponents(s);
        s = s.trim();
        if (s !== orig && s.length > 10) { e.solution = s; cleaned++; }
      });
      this.issues['solution_cleaning'] = {count: cleaned, action:'fixed'};
      this.addLog('clean', `Cleaned ${cleaned} solutions`);
      return entries;
    },

    validateRootCauses(entries) {
      this.addLog('info', 'Stage 7: Validating root causes...');
      let nullified = 0;
      entries.forEach(e => {
        const rc = (e.root_cause||'').trim(); if (!rc) return;
        if (/unknown|unclear|not determined|needs investigation/i.test(rc)) { e.root_cause = null; nullified++; }
      });
      this.issues['root_cause_validation'] = {count: nullified, action:'fixed'};
      this.addLog('clean', `Nullified ${nullified} unsupported root causes`);
      return entries;
    },

    adjustConfidence(entries) {
      this.addLog('info', 'Stage 8: Adjusting confidence scores (V9-calibrated)...');
      let adjusted = 0;
      entries.forEach(e => {
        const s = (e.solution||'').trim();
        const hasTech = this.techRe.test(s);
        const origConf = e.confidence;
        // V9 calibration: high ~29% (avg 505 chars), medium ~66%, low ~5%
        if (e.confidence === 'high' && (s.length < 250 || !hasTech)) { e.confidence = 'medium'; }
        if (e.confidence === 'low' && hasTech && s.length > 80) { e.confidence = 'medium'; }
        if (e.confidence === 'medium' && hasTech && s.length > 400) { e.confidence = 'high'; }
        if (e.confidence !== origConf) adjusted++;
      });
      this.issues['confidence_adjustment'] = {count: adjusted, action:'fixed'};
      this.addLog('clean', `Adjusted ${adjusted} confidence scores`);
      return entries;
    },

    computeScore(entries) {
      const n = entries.length; if (n === 0) return 0;
      const selfContained = entries.filter(e => (e.problem||'').trim().length >= 15 && (e.solution||'').trim().length >= 20).length;
      const goodSize = entries.filter(e => { const l = ((e.problem||'') + ' ' + (e.solution||'')).trim().length; return l >= 50 && l <= 2000; }).length;
      const actionable = entries.filter(e => this.techRe.test(e.solution||'')).length;
      let poison=0, dilution=0, good=0;
      entries.forEach(e => { const s=(e.solution||'').trim(), p=(e.problem||'').trim(); if(s.length<15||p.length<10) poison++; else if(!this.techRe.test(s)&&s.length<50) dilution++; else good++; });
      const noisy = entries.filter(e => /^(thanks|thank you|let me know|hi |hello |dear |best regards|sincerely)/i.test((e.solution||'').slice(0,50))).length;
      const metaGood = entries.filter(e => {
        const ts = e.technical_signals||{};
        const hasSig = typeof ts==='object'&&!Array.isArray(ts) ? Object.values(ts).some(v=>!!v) : Array.isArray(ts)&&ts.length>0;
        return [!!e.issue_type, !!e.confidence, hasSig].filter(Boolean).length >= 2;
      }).length;
      this.scores = {
        self_containedness: {value:selfContained/n*100, weight:0.20, label:'Self-Contained'},
        chunk_size: {value:goodSize/n*100, weight:0.10, label:'Chunk Size'},
        actionability: {value:actionable/n*100, weight:0.25, label:'Actionability'},
        rag_readiness: {value:good/n*100, weight:0.20, label:'RAG Readiness'},
        noise_free: {value:(1-noisy/n)*100, weight:0.15, label:'Noise-Free'},
        metadata: {value:metaGood/n*100, weight:0.10, label:'Metadata'},
      };
      let composite = 0;
      for (const s of Object.values(this.scores)) composite += s.value * s.weight;
      this.scores.composite = composite;
      return composite;
    },

    // Stage 9: Tag entries with RAG quality + retrieval priority (V9 compatible)
    tagRagQuality(entries) {
      this.addLog('info', 'Stage 9: Tagging RAG quality & retrieval priority...');
      let good = 0, dilution = 0;
      entries.forEach(e => {
        const s = (e.solution||'').trim();
        const p = (e.problem||'').trim();
        const hasTech = this.techRe.test(s);
        // V9 ratio: ~92.6% good, ~7.4% dilution
        // Good: has tech content, OR solution is substantive (>=50 chars), OR problem is substantive + has some solution
        if (hasTech || s.length >= 50 || (p.length >= 30 && s.length >= 30)) {
          e.rag_quality = 'good';
          e.retrieval_priority = 'normal';
          good++;
        } else {
          e.rag_quality = 'dilution';
          e.retrieval_priority = 'low';
          dilution++;
        }
      });
      this.addLog('info', `Tagged: ${good} good, ${dilution} dilution`);
      return entries;
    },

    async run(rawData, onProgress) {
      this.log = []; this.issues = {}; this.scores = {};
      this.removedEntries = [];
      // For large datasets, skip deep-clone to avoid V8 string limit (>512MB)
      const isLarge = Array.isArray(rawData) && rawData.length > 5000;
      this.originalData = isLarge ? null : JSON.parse(JSON.stringify(rawData));
      const origEntries = this.validateInput(rawData);
      // Free rawData reference so GC can reclaim memory
      rawData = null;
      let entries = isLarge ? origEntries : JSON.parse(JSON.stringify(origEntries));
      const _s = ms => new Promise(r => setTimeout(r, ms));

      // Track removals (keep full entry for AI review)
      const trackRemovals = (before, after, reason) => {
        const afterIds = new Set(after.map(e => JSON.stringify({t:e.ticket_id,p:(e.problem||'').slice(0,50)})));
        before.forEach(e => {
          const key = JSON.stringify({t:e.ticket_id,p:(e.problem||'').slice(0,50)});
          if (!afterIds.has(key)) {
            this.removedEntries.push({...e, _removal_reason: reason});
          }
        });
      };

      onProgress(8, 'Validating input & format detection...'); await _s(150);

      // Stage 1b: Deep-clean text fields (applies 10-rule text cleaner to problem/solution)
      onProgress(15, 'Deep-cleaning text (HTML, email chains, signatures, encoding, PII)...'); entries = this.deepCleanTexts(entries); await _s(150);

      let before = [...entries];
      onProgress(25, 'Removing junk entries...'); entries = this.removeJunk(entries); trackRemovals(before, entries, 'junk_entry'); await _s(150);

      before = [...entries];
      onProgress(37, 'Removing fragments...'); entries = this.removeFragments(entries); trackRemovals(before, entries, 'fragment_or_conversation_step'); await _s(150);

      before = [...entries];
      onProgress(48, 'Merging multi-entry tickets...'); entries = this.mergeTickets(entries); await _s(150);

      onProgress(58, 'Cleaning problems...'); entries = this.cleanProblems(entries); await _s(150);
      onProgress(68, 'Cleaning solutions...'); entries = this.cleanSolutions(entries); await _s(150);
      onProgress(78, 'Validating root causes...'); entries = this.validateRootCauses(entries); await _s(100);
      onProgress(85, 'Adjusting confidence...'); entries = this.adjustConfidence(entries); await _s(100);
      onProgress(91, 'Tagging RAG quality...'); entries = this.tagRagQuality(entries); await _s(100);
      onProgress(96, 'Computing RAG quality score...'); this.computeScore(entries); await _s(150);

      // Build issue_type distribution
      const issueTypeDist = {};
      entries.forEach(e => { const t = e.issue_type||'unknown'; issueTypeDist[t] = (issueTypeDist[t]||0) + 1; });

      const confDist = {high:0,medium:0,low:0};
      entries.forEach(e => { const c = e.confidence||'medium'; confDist[c] = (confDist[c]||0) + 1; });

      const goodForRag = entries.filter(e => e.rag_quality === 'good').length;
      const sigCoverage = entries.filter(e => {
        const ts = e.technical_signals||{};
        return typeof ts==='object'&&!Array.isArray(ts) ? Object.values(ts).some(v=>!!v) : Array.isArray(ts)&&ts.length>0;
      }).length;

      this.stats = {
        original: origEntries.length,
        cleaned: entries.length,
        removed: origEntries.length - entries.length,
        removedPct: ((origEntries.length - entries.length) / origEntries.length * 100).toFixed(1),
        highConf: confDist.high,
        medConf: confDist.medium,
        lowConf: confDist.low,
        actionable: entries.filter(e => this.techRe.test(e.solution||'')).length,
        goodForRag,
        issueTypeDist,
        confDist,
        sigCoverage: `${sigCoverage}/${entries.length} (${(sigCoverage/entries.length*100).toFixed(1)}%)`,
      };
      this.cleanedData = entries;
      this.addLog('info', `Pipeline complete! ${entries.length} entries, RAG score: ${this.scores.composite.toFixed(1)}/100`);
      onProgress(100, 'Complete!');
      return entries;
    },

    exportJSON() {
      return {
        _metadata: {
          version: 'v9.0',
          source: 'qa-clean-pipeline',
          pipeline: 'RAG optimization pass',
          timestamp: new Date().toISOString(),
          changes: {
            ...Object.fromEntries(Object.entries(this.issues).map(([k,v]) => [k, v.count])),
            entries_before: this.stats.original,
            entries_after: this.stats.cleaned,
          },
        },
        DATASET_SUMMARY: {
          total_entries: this.stats.cleaned,
          good_for_rag: this.stats.goodForRag,
          confidence_distribution: this.stats.confDist,
          issue_type_distribution: this.stats.issueTypeDist,
          technical_signal_coverage: this.stats.sigCoverage,
          rag_quality_score: this.scores.composite?.toFixed(1),
        },
        VALID_KNOWLEDGE_DATASET: this.cleanedData,
        REMOVED_POISON_ENTRIES: this.removedEntries.map(e => ({ticket_id:e.ticket_id, reason:e._removal_reason, problem:(e.problem||'').slice(0,200), solution:(e.solution||'').slice(0,200)})),
      };
    },

    exportReport() {
      let md = `# QA Pipeline Report\n\nGenerated: ${new Date().toISOString()}\n\n`;
      md += `## Dataset Statistics\n\n| Metric | Value |\n|--------|-------|\n`;
      md += `| Original entries | ${this.stats.original} |\n| Cleaned entries | ${this.stats.cleaned} |\n| Removed | ${this.stats.removed} (${this.stats.removedPct}%) |\n| High confidence | ${this.stats.highConf} |\n| Good for RAG | ${this.stats.goodForRag} |\n| Actionable | ${this.stats.actionable} |\n\n`;
      md += `## RAG Quality Score: ${this.scores.composite?.toFixed(1)}/100\n\n`;
      for (const [k,v] of Object.entries(this.scores)) { if (k !== 'composite') md += `- ${v.label}: ${v.value.toFixed(1)}% (weight: ${v.weight})\n`; }
      md += `\n## Issues Fixed\n\n`;
      for (const [cat, info] of Object.entries(this.issues)) { md += `- **${cat}**: ${info.count} entries ${info.action}\n`; }
      md += `\n## Processing Log\n\n`;
      this.log.forEach(l => md += `[${l.time}] [${l.tag.toUpperCase()}] ${l.msg}\n`);
      return md;
    }
  };

  // ─── QA Clean Page UI Functions ───
  function initQaCleanPage() {
    if (_qaInitialized) return;
    _qaInitialized = true;
    setupQaImport();
    // Setup tabs
    document.querySelectorAll('.qa-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.qa-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.qa-tab-content').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const target = document.getElementById(tab.dataset.qatab);
        if (target) target.classList.add('active');
      });
    });
    // Setup search
    const searchBox = document.getElementById('qaSearchBox');
    if (searchBox) searchBox.addEventListener('input', e => {
      const q = e.target.value.toLowerCase();
      const activeData = DEEP_CLEAN.cleanedData || QA_PIPELINE.cleanedData;
      if (!activeData) return;
      const filtered = q ? activeData.filter(en => (en.ticket_id||'').toLowerCase().includes(q) || (en.problem||'').toLowerCase().includes(q) || (en.solution||'').toLowerCase().includes(q)) : activeData;
      renderQaBrowser(filtered);
    });
  }

  function setupQaImport() {
    const zone = document.getElementById('qaImportZone');
    const input = document.getElementById('qaImportInput');
    if (!zone || !input) return;
    input.addEventListener('change', e => { if (e.target.files.length) selectQaImport(e.target.files[0]); });
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('dragover'); if (e.dataTransfer.files.length) selectQaImport(e.dataTransfer.files[0]); });
  }

  function selectQaImport(file) {
    if (!file.name.endsWith('.json')) { showToast('Only JSON files'); return; }
    _qaImportFile = file;
    document.getElementById('qaImportFileName').textContent = file.name;
    document.getElementById('qaImportFileSize').textContent = fmtSize(file.size);
    document.getElementById('qaImportFileInfo').className = 'file-info on';
    document.getElementById('qaImportLabel').innerHTML = `<strong>${esc(file.name)}</strong> selected`;
    document.getElementById('btnRunQa').style.display = '';
  }

  function clearQaImport() {
    _qaImportFile = null;
    document.getElementById('qaImportInput').value = '';
    document.getElementById('qaImportFileInfo').className = 'file-info';
    document.getElementById('qaImportLabel').innerHTML = 'Upload custom JSON';
    document.getElementById('btnRunQa').style.display = 'none';
  }

  function updateQaPipelineUI(pct, stage) {
    document.getElementById('qaProgressFill').style.width = pct + '%';
    document.getElementById('qaProgressPct').textContent = pct + '%';
    document.getElementById('qaProgressStage').textContent = stage;
    const logEl = document.getElementById('qaPipelineLog');
    logEl.innerHTML = DEEP_CLEAN.log.map(l =>
      `<div class="qa-log-entry"><span class="qa-log-time">${l.time}</span><span class="qa-log-tag ${l.tag}">${l.tag}</span><span class="qa-log-msg">${esc(l.msg)}</span></div>`
    ).join('');
    logEl.scrollTop = logEl.scrollHeight;
  }

  function renderQaResults() {
    const P = DEEP_CLEAN;
    // Score panel — not available from Deep Clean pipeline; keep hidden
    document.getElementById('qaScorePanel').style.display = 'none';

    // Stats
    const s = P.stats;
    document.getElementById('qaStatsGrid').innerHTML = `
      <div class="qa-stat-card"><div class="qa-stat-val blue">${s.original}</div><div class="qa-stat-lbl">Original</div></div>
      <div class="qa-stat-card"><div class="qa-stat-val green">${s.cleaned}</div><div class="qa-stat-lbl">Cleaned</div></div>
      <div class="qa-stat-card"><div class="qa-stat-val red">${s.removed}</div><div class="qa-stat-lbl">Removed (${s.removedPct}%)</div></div>
      <div class="qa-stat-card"><div class="qa-stat-val green">${s.sigCoverage||0}</div><div class="qa-stat-lbl">With Technical Signals (${s.sigCoveragePct||0}%)</div></div>
    `;
    document.getElementById('qaStatsPanel').style.display = 'block';

    // Issues table — not tracked by Deep Clean; clear it
    document.getElementById('qaIssuesBody').innerHTML = '';

    // Full log
    document.getElementById('qaResultsLog').innerHTML = P.log.map(l =>
      `<div class="qa-log-entry"><span class="qa-log-time">${l.time}</span><span class="qa-log-tag ${l.tag}">${l.tag}</span><span class="qa-log-msg">${esc(l.msg)}</span></div>`
    ).join('');

    // Browser
    renderQaBrowser(P.cleanedData);

    document.getElementById('qaResultsTabs').style.display = 'block';
    document.getElementById('qaExportPanel').style.display = 'block';
  }

  function renderQaBrowser(entries) {
    const container = document.getElementById('qaEntryBrowser');
    const html = entries.slice(0, 100).map((e, i) => {
      const conf = e.confidence||'unknown';
      const confColor = conf==='high'?'var(--green)':conf==='medium'?'var(--orange)':'var(--text3)';
      return `<div class="qa-entry-item"><div class="qa-entry-tid">${esc(e.ticket_id||'N/A')} <span style="color:${confColor};font-size:10px;">${conf}</span></div><div class="qa-entry-problem">${esc((e.problem||'').slice(0,200))}</div><div class="qa-entry-meta"><span>${e.issue_type||'—'}</span><span>Sol: ${(e.solution||'').length} chars</span></div></div>`;
    }).join('');
    container.innerHTML = html + (entries.length > 100 ? `<div style="padding:10px;text-align:center;color:var(--text3);font-size:11px;">Showing 100 of ${entries.length}. Use search to filter.</div>` : '');
  }

  async function runQaPipelineCore(data) {
    if (_qaRunning) return;
    _qaRunning = true;

    // Reset UI
    document.getElementById('qaPipelineProgress').style.display = 'block';
    document.getElementById('qaScorePanel').style.display = 'none';
    document.getElementById('qaStatsPanel').style.display = 'none';
    document.getElementById('qaResultsTabs').style.display = 'none';
    document.getElementById('qaExportPanel').style.display = 'none';
    document.getElementById('qaPipelineLog').innerHTML = '';
    document.getElementById('qaStatus').textContent = 'Running full pipeline: text cleaning → knowledge extraction → QA validation...';

    try {
      await DEEP_CLEAN.run(data, updateQaPipelineUI);
      renderQaResults();
      document.getElementById('qaStatus').textContent = `Done — ${DEEP_CLEAN.cleanedData.length} entries`;
      showToast(`Deep Clean pipeline complete! ${DEEP_CLEAN.cleanedData.length} entries`);
      renderOverviewDashboard();
    } catch(e) {
      showToast(`Pipeline failed: ${e.message}`);
      document.getElementById('qaStatus').textContent = `Error: ${e.message}`;
    } finally {
      _qaRunning = false;
    }
  }

  async function runQaFromPipeline() {
    const btn = document.getElementById('btnRunQaPipeline');
    btn.disabled = true; btn.textContent = 'Processing...';
    try {
      const r = await fetch(`${KB_BASE}/qa-validate`);
      if (!r.ok) { const b = await r.json().catch(()=>null); throw new Error(b?.error||`Server ${r.status}`); }
      const data = await r.json();
      // If server returns raw data, run pipeline on it; if it returns processed results, use them
      if (data.VALID_KNOWLEDGE_DATASET || Array.isArray(data)) {
        await runQaPipelineCore(data);
      } else if (data.summary) {
        // Legacy server-side validation result — still show it
        document.getElementById('qaStatus').textContent = `Done — Health Score: ${data.summary.healthScore}/100`;
        showToast('QA validation complete');
      }
    } catch(e) {
      showToast(`Failed: ${e.message}`);
      document.getElementById('qaStatus').textContent = `Error: ${e.message}`;
    } finally {
      btn.disabled = false; btn.textContent = 'Validate Pipeline Output';
    }
  }

  /**
   * Stream-parse a large JSON array file (supports 500MB+).
   * Uses File.stream() + brace-depth tracking to extract objects one-by-one
   * without loading the entire file into memory as a single string.
   * @param {File} file - The file to parse
   * @param {Function} onProgress - Progress callback(pct, count, bytes)
   * @param {Function} [transform] - Optional transform applied to each parsed object.
   *   If it returns null/undefined, the object is skipped. This allows converting
   *   raw tickets to compact entries during streaming to save memory.
   */
  async function streamParseJsonArray(file, onProgress, transform) {
    const stream = file.stream();
    const reader = stream.getReader();
    const decoder = new TextDecoder('utf-8');
    const totalSize = file.size;
    let bytesRead = 0;

    const results = [];
    let depth = 0;
    let inString = false;
    let escape = false;
    // Use string concatenation instead of char array for better memory efficiency
    let objBuf = '';
    let collecting = false;
    let objStartInChunk = -1;  // track start position within current chunk for slicing

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      const chunk = decoder.decode(value, { stream: true });

      // If we were collecting from a previous chunk, start fresh buffer tracking
      objStartInChunk = collecting ? 0 : -1;

      for (let i = 0; i < chunk.length; i++) {
        const ch = chunk[i];
        if (escape) { escape = false; continue; }
        if (ch === '\\' && inString) { escape = true; continue; }
        if (ch === '"' && !escape) { inString = !inString; continue; }
        if (inString) continue;

        if (ch === '{') {
          if (depth === 0) {
            collecting = true;
            objBuf = '';
            objStartInChunk = i;
          }
          depth++;
        } else if (ch === '}') {
          depth--;
          if (depth === 0 && collecting) {
            collecting = false;
            // Extract the complete object string using chunk slice
            const objStr = objBuf + chunk.slice(objStartInChunk, i + 1);
            objBuf = '';
            objStartInChunk = -1;
            try {
              let obj = JSON.parse(objStr);
              if (transform) {
                obj = transform(obj);
                if (obj) results.push(obj);
              } else {
                results.push(obj);
              }
            } catch(_) {}
          }
        }
      }

      // If still collecting at end of chunk, save what we have so far
      if (collecting && objStartInChunk >= 0) {
        objBuf += chunk.slice(objStartInChunk);
        objStartInChunk = 0; // next chunk starts at 0
      } else if (collecting && objStartInChunk === -1) {
        // Entire chunk is inside the object (objStartInChunk was 0 from top)
        objBuf += chunk;
      }

      if (onProgress) {
        const pct = Math.round((bytesRead / totalSize) * 100);
        onProgress(pct, results.length, bytesRead);
      }

      // Yield to UI thread so progress updates render
      // Use setTimeout(0) to allow browser to repaint
      await new Promise(r => setTimeout(r, 0));
    }
    return results;
  }

  async function runQaCleanPipeline() {
    if (!_qaImportFile) return;
    const btn = document.getElementById('btnRunQa');
    const statusEl = document.getElementById('qaStatus');
    btn.disabled = true; btn.textContent = 'Processing...';
    try {
      let data;
      // For files > 200MB, use streaming parser to avoid V8 string limit
      if (_qaImportFile.size > 200 * 1024 * 1024) {
        statusEl.textContent = 'Reading large file (streaming)...';
        // Phase 1: Stream-parse raw objects (no heavy transform — keep UI responsive)
        const rawObjects = await streamParseJsonArray(_qaImportFile, (pct, count, bytes) => {
          statusEl.textContent = `Reading: ${pct}% — ${count.toLocaleString()} objects (${fmtSize(bytes)})`;
        });
        statusEl.textContent = `Parsed ${rawObjects.length.toLocaleString()} objects. Converting...`;
        await new Promise(r => setTimeout(r, 50));

        // Phase 2: Convert raw tickets → compact knowledge entries in batches
        // Process 100 at a time, yielding to UI between batches to prevent freeze
        const isRaw = rawObjects.length > 0 && rawObjects[0].ticket_header;
        if (isRaw) {
          data = [];
          const BATCH = 100;
          for (let i = 0; i < rawObjects.length; i += BATCH) {
            const end = Math.min(i + BATCH, rawObjects.length);
            for (let j = i; j < end; j++) {
              const entry = QA_PIPELINE.convertSingleTicketLight(rawObjects[j]);
              if (entry) data.push(entry);
              rawObjects[j] = null; // free raw object immediately
            }
            statusEl.textContent = `Converting: ${end.toLocaleString()} / ${rawObjects.length.toLocaleString()} (${data.length.toLocaleString()} entries)`;
            await new Promise(r => setTimeout(r, 0)); // yield to UI
          }
          QA_PIPELINE.addLog('info', `Stream-converted ${data.length.toLocaleString()} entries from large file (${fmtSize(_qaImportFile.size)})`);
        } else {
          data = rawObjects;
        }
        statusEl.textContent = `${data.length.toLocaleString()} entries ready, running QA pipeline...`;
        await new Promise(r => setTimeout(r, 50));
      } else {
        const text = await _qaImportFile.text();
        data = JSON.parse(text);
      }
      await runQaPipelineCore(data);
    } catch(e) {
      showToast(`Failed: ${e.message}`);
      document.getElementById('qaStatus').textContent = `Error: ${e.message}`;
    } finally {
      btn.disabled = false; btn.textContent = 'Run QA Clean';
    }
  }

  // ── Full Conversation AI Review (FCR) UI ─────────────────────────────

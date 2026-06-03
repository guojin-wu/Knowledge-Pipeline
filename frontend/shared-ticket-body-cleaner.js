/* Shared ticket body cleaner API */

function cleanTicketBody(text, mode, opts) {
  if (!text) return '';
  text = text.replace(/~~/g, '').trim();   // strip markdown strikethrough markers (formatting artifacts)

  // Strip forwarded-email header blocks (From/Sent/To/Subject) but preserve
  // the body content after each Subject: line. Each section is cleaned
  // independently so that one section's footer doesn't consume the next.
  // Always run for section splitting; toggle only controls header visibility.
  if (typeof stripForwardedHeaderBlocks === 'function') {
    var hdr = stripForwardedHeaderBlocks(text);
    if (hdr.headersFound && hdr.sections && hdr.sections.length) {
      var _showHeaders = (typeof window !== 'undefined' && window.__simCleaningConfig && window.__simCleaningConfig.stripForwardedHeaders === false) ? true : false;
      var cleanedSections = hdr.sections.map(function(section) {
        return cleanTicketBody(section, mode);  // clean each section independently
      });
      var parts = [];
      for (var _i = 0; _i < cleanedSections.length; _i++) {
        if (cleanedSections[_i]) parts.push(cleanedSections[_i]);
        // Reinsert header AFTER its preceding section (matches original text order:
        // Section0 → Header0 → Section1 → Header1 → …)
        if (_showHeaders && hdr.headers && hdr.headers[_i]) {
          parts.push(hdr.headers[_i]);
        }
      }
      text = parts.join('\n');
      return text;
    }
  }

  // Fallback (legacy): aggressive full-chain removal for thread messages
  if (opts && opts.aggressiveQuotedCut && typeof stripQuotedChainPrefix === 'function') {
    var pre = stripQuotedChainPrefix(text);
    if (pre && pre.removed) text = pre.cleaned;
  }

  // ── Generic form-dump detection ──────────────────────────────────────────
  // Instead of hardcoding field names, detect any text that has 3+ "Label:"
  // patterns (capitalized words followed by colon). This handles SecureView
  // web forms, Zoho CRM leads, and any other form system.

  // PII / metadata field names to EXCLUDE from issue content
  var PII_FIELDS = /^(?:first\s*name|last\s*name|name|email|e-?mail|phone|mobile|cell|fax|company(?:\s+login\s+name\/email)?|priority|subject|from|sent|to|cc|bcc|date|address|city|state|zip|country|website|url|title|department|organization|how.?d you hear|source|lead\s+source|see\s+lead|view\s+lead)$/i;

  // Detect form dump: look for 3+ "CapitalizedLabel:" patterns
  var formFieldPattern = /(?:^|[\s,])([A-Z][A-Za-z' ]{1,35})\s*:/g;
  var detectedFields = [];
  var fieldMatch;
  var sample = text.slice(0, 800);
  while ((fieldMatch = formFieldPattern.exec(sample)) !== null) {
    var label = fieldMatch[1].trim();
    // Skip very common English sentence starts that happen to match
    if (/^(?:I|We|It|He|She|They|The|This|That|Our|My|Your|But|And|Or|So|If|As|In|On|At|For|From|Hi|Hello|Dear|Please|IMPORTANT|Importance|Note|Disclaimer|Confidential)$/i.test(label)) continue;
    // Skip email header labels (EN + Nordic variants) — forwarded-chain metadata, not form fields
    if (/^(?:From|Fra|Sent|Sendt|To|Til|Cc|Bcc|Subject|Emne|Re|Date|Received)$/i.test(label)) continue;
    // Skip labels that end with "wrote" (quoted reply markers like "Nickkole Lui' wrote:")
    if (/wrote$/i.test(label)) continue;
    // Skip labels that look like natural language phrases (contain 3+ words with common
    // verbs/pronouns — these are questions or statements ending with ":", not form labels)
    if (/\b(?:we|you|can|may|please|could|would|should|do|did|have|has|are|is|was|were|will|let|need)\b/i.test(label) && label.split(/\s+/).length >= 3) continue;
    // Skip "Get Outlook for Android From" and similar mobile signature fragments
    if (/^Get\s/i.test(label)) continue;
    detectedFields.push(label);
  }

  var isFormDump = detectedFields.length >= 3;

  if (!isFormDump) return mode === 'ai' ? stripObviousFooter(text) : text;

  // ── Form dump cleaning ────────────────────────────────────────────────
  // Keep the entire form content — all fields are useful context for AI.
  // Only strip the forwarded email header prefix (From/Sent/To/Subject block)
  // that wraps the form submission notification.
  var formBody = text;
  // Find Subject: in the text — the forwarded header ends after "Subject: ...\n"
  // Handle both newline-separated and inline-spaced headers (e.g. "From: x  Sent: y  To: z  Subject: w")
  var subjectIdx = text.search(/\bSubject\s*:/i);
  if (subjectIdx >= 0) {
    var beforeSubject = text.slice(0, subjectIdx);
    // Check if From/Fra + Sent/Sendt appears before Subject/Emne (confirms forwarded header)
    // but do NOT strip when protected forwarded-header triplet is present.
    var hasForwardHeaderBeforeSubject = /\b(?:From|Fra|Sent|Sendt)\s*:/i.test(beforeSubject);
    var protectedForwardHeader = (typeof findProtectedForwardHeaderStart === 'function')
      ? findProtectedForwardHeaderStart(text)
      : null;
    if (hasForwardHeaderBeforeSubject && !protectedForwardHeader) {
      // Find where the Subject: value ends — look for the start of form content
      // Form content typically starts with patterns like "New lead", "Name:", etc.
      var afterSubject = text.slice(subjectIdx);
      // Skip past "Subject: <value>" — find where form content begins
      var formStartMatch = afterSubject.match(/\bSubject\s*:[^\n]*?(?:\s{2,}|\n)((?:New\s|Name\s*:|Dear\s|Hi\s|Hello\s|Thank\s|Form\s|Lead\s)[\s\S]*)/i);
      if (formStartMatch) {
        formBody = formStartMatch[1].trim();
      } else {
        // Fallback: cut at Subject: value end (after first double-space or newline)
        var subjectEnd = afterSubject.match(/\bSubject\s*:[^\n]*?(?:\s{2,}|\n)/i);
        if (subjectEnd) {
          formBody = text.slice(subjectIdx + subjectEnd[0].length).trim();
        }
      }
    }
  }

  if (mode === 'ai') {
    // Insert newlines before field labels for readability, then return
    // Use \s+ (not \s{2,}) — form fields are often separated by single spaces
    var aiText = formBody;
    for (var d = 0; d < detectedFields.length; d++) {
      var escapedLabel = detectedFields[d].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      var labelBoundary = new RegExp('\\s+(?=' + escapedLabel + '\\s*:)', 'g');
      aiText = aiText.replace(labelBoundary, '\n');
    }
    return aiText.trim();
  }

  // display mode: insert newlines before each detected field label
  var displayText = formBody;
  for (var d = 0; d < detectedFields.length; d++) {
    var escapedLabel = detectedFields[d].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var labelBoundary = new RegExp('\\s+(?=' + escapedLabel + '\\s*:)', 'g');
    displayText = displayText.replace(labelBoundary, '\n');
  }
  return displayText.trim();
}

/**
 * Extract all "Label: value" pairs from form-dump text.
 * Returns array of { label, value, start, end }.
 */
function extractFormFields(text) {
  // Find all positions where a capitalized label followed by ":" appears
  var positions = [];
  var re = /(?:^|[\s,])([A-Z][A-Za-z' ]{1,35})\s*:/g;
  var m;
  while ((m = re.exec(text)) !== null) {
    var label = m[1].trim();
    if (/^(?:I|We|It|He|She|They|The|This|That|Our|My|Your|But|And|Or|So|If|As|In|On|At|For|From|Hi|Hello|Dear|Please|IMPORTANT|Importance|Note|Disclaimer|Confidential)$/i.test(label)) continue;
    var valueStart = m.index + m[0].length;
    positions.push({ label: label, valueStart: valueStart, matchStart: m.index });
  }

  // Extract value for each field (from colon to next field label)
  var fields = [];
  for (var i = 0; i < positions.length; i++) {
    var start = positions[i].valueStart;
    var end = (i + 1 < positions.length) ? positions[i + 1].matchStart : text.length;
    var value = text.slice(start, end).trim();
    // Clean trailing whitespace and common separators
    value = value.replace(/[\s,|]+$/, '').trim();
    fields.push({
      label: positions[i].label,
      value: value,
      start: start,
      end: end
    });
  }

  return fields;
}

function inspectTicketBodyCleaning(text, mode, opts) {
  var raw = String(text || '').trim();
  if (!raw) return { raw: '', cleaned: '', removals: [], rules: [] };

  var preRules = [];
  var preRemovals = [];

  // Strip ~~ markers first (same as cleanTicketBody does)
  // Use rawNoMarkers everywhere so ~~ doesn't pollute diff coordinates
  var rawNoMarkers = raw.replace(/~~/g, '').trim();
  var working = rawNoMarkers;

  // Always run forwarded-header detection for section splitting.
  // Toggle only controls whether header lines are visible (reference) or stripped.
  if (typeof stripForwardedHeaderBlocks === 'function') {
    var hdr = stripForwardedHeaderBlocks(rawNoMarkers);
    if (hdr.headersFound && hdr.sections && hdr.sections.length && hdr.ranges) {
      var _inspShowHeaders = (typeof window !== 'undefined' && window.__simCleaningConfig && window.__simCleaningConfig.stripForwardedHeaders === false) ? true : false;

      // Provide explicit removal ranges for header blocks so the UI diff renderer
      // shows clean contiguous strikethroughs instead of fragmentary LCS artefacts.
      // Per-section footer removals are handled by each section's own cleaning and
      // will be diffed locally (small diffs = no fragmentation issues).
      if (!_inspShowHeaders && hdr.ranges) {
        hdr.ranges.forEach(function(rng) {
          preRemovals.push({
            start: rng.start,
            end: rng.end,
            ruleId: 'forwarded_header_block',
            note: 'Forwarded email header (From/Sent/To/Subject)'
          });
        });
      }

      // Compute where each section sits in rawNoMarkers so we can map
      // per-section removal ranges back to the original coordinate space.
      // sections[0] starts at char 0, sections[i] starts at ranges[i-1].end.
      var sectionOrigins = [0];
      for (var _si = 0; _si < hdr.ranges.length; _si++) {
        sectionOrigins.push(hdr.ranges[_si].end);
      }

      // Clean each section independently (footer/signature removal etc.)
      var subNotes = [];
      var sectionResults = hdr.sections.map(function(section, idx) {
        var res = typeof inspectTicketBodyCleaning === 'function'
          ? inspectTicketBodyCleaning(section, mode)
          : { raw: section, cleaned: section, removals: [], rules: [] };

        // Map sub-removals back to rawNoMarkers coordinate space.
        // The section text was trimmed when extracted, so find its actual
        // start offset within the untrimmed slice of rawNoMarkers.
        var secRaw = res.raw || section;
        if (secRaw && res.cleaned && secRaw !== res.cleaned) {
          var origin = sectionOrigins[idx];
          var sliceEnd = idx < hdr.ranges.length ? hdr.ranges[idx].start : rawNoMarkers.length;
          var untrimmed = rawNoMarkers.slice(origin, sliceEnd);
          var trimStart = untrimmed.indexOf(secRaw.slice(0, 30));
          var trimOffset = origin + (trimStart >= 0 ? trimStart : 0);

          // Use explicit sub-removals if available, otherwise infer from
          // the section's raw vs cleaned text (tail trim = footer removal).
          if (res.removals && res.removals.length) {
            res.removals.forEach(function(rem) {
              if (rem && Number.isFinite(rem.start) && Number.isFinite(rem.end)) {
                preRemovals.push({
                  start: trimOffset + rem.start,
                  end: trimOffset + rem.end,
                  ruleId: rem.ruleId || 'section_cleanup',
                  note: rem.note || ''
                });
              }
            });
          } else {
            // Infer: cleaned is a shortened version of raw — mark the tail as removed.
            var tailStart = secRaw.lastIndexOf(res.cleaned);
            if (tailStart < 0) tailStart = 0;
            var footerStart = tailStart + res.cleaned.length;
            if (footerStart < secRaw.length) {
              preRemovals.push({
                start: trimOffset + footerStart,
                end: trimOffset + secRaw.length,
                ruleId: 'section_footer_cleanup',
                note: 'Per-section footer/signature removal'
              });
            }
          }
        }

        if (res.rules && res.rules.length) {
          res.rules.forEach(function(rule) {
            subNotes.push('S' + (idx + 1) + ': ' + (rule.ruleId || ''));
          });
        }
        return res;
      });

      // Reassemble: use per-section CLEANED text, interleave headers if shown.
      // Headers go AFTER their preceding section to match original text order
      // (Section0 → Header0 → Section1 → …). Placing headers before sections
      // would reorder the text and cause the LCS diff to misfire.
      var parts = [];
      for (var _j = 0; _j < sectionResults.length; _j++) {
        if (sectionResults[_j].cleaned) parts.push(sectionResults[_j].cleaned);
        if (_inspShowHeaders && hdr.headers && hdr.headers[_j]) {
          parts.push(hdr.headers[_j]);
        }
      }
      working = parts.join('\n');
      preRules.push({
        ruleId: 'forwarded_headers_stripped',
        note: (_inspShowHeaders ? 'Kept ' : 'Removed ') + hdr.headersFound + ' forwarded-email header block(s) (From:/Sent:/To:/Subject:), preserved ' + hdr.sections.length + ' message bodies.' + (subNotes.length ? ' Per-section cleanup: ' + subNotes.join(', ') + '.' : '')
      });
      // Return rawNoMarkers as raw so header removal positions align with displayed text.
      return { raw: rawNoMarkers, cleaned: working, removals: preRemovals, rules: preRules };
    }
  }

  // Fallback (legacy): aggressive full-chain removal for thread messages
  if (opts && opts.aggressiveQuotedCut && typeof stripQuotedChainPrefix === 'function') {
    var pre = stripQuotedChainPrefix(rawNoMarkers);
    if (pre && pre.removed) {
      working = pre.cleaned;
      preRules.push({
        ruleId: 'thread_quoted_chain_stripped',
        note: 'Removed the quoted email chain (From:/Sent:/Subject: header and everything after) because those messages are already preserved as separate entries in this ticket thread.'
      });
      preRemovals.push({
        start: raw.length - pre.removed.length,
        end: raw.length,
        label: 'quoted_chain'
      });
    }
  }

  // Use the same generic form detection as cleanTicketBody
  var formFieldPattern = /(?:^|[\s,])([A-Z][A-Za-z' ]{1,35})\s*:/g;
  var detectedFields = [];
  var fieldMatch;
  var sample = working.slice(0, 800);
  while ((fieldMatch = formFieldPattern.exec(sample)) !== null) {
    var label = fieldMatch[1].trim();
    if (/^(?:I|We|It|He|She|They|The|This|That|Our|My|Your|But|And|Or|So|If|As|In|On|At|For|From|Hi|Hello|Dear|Please|IMPORTANT|Importance|Note|Disclaimer|Confidential)$/i.test(label)) continue;
    if (/^(?:From|Fra|Sent|Sendt|To|Til|Cc|Bcc|Subject|Emne|Re|Date|Received)$/i.test(label)) continue;
    if (/wrote$/i.test(label)) continue;
    if (/\b(?:we|you|can|may|please|could|would|should|do|did|have|has|are|is|was|were|will|let|need)\b/i.test(label) && label.split(/\s+/).length >= 3) continue;
    if (/^Get\s/i.test(label)) continue;
    detectedFields.push(label);
  }
  var isFormDump = detectedFields.length >= 3;

  function mergeResult(r) {
    return {
      raw: rawNoMarkers,
      cleaned: r.cleaned,
      removals: preRemovals.concat(r.removals || []),
      rules: preRules.concat(r.rules || [])
    };
  }

  if (isFormDump) {
    var formCleaned = cleanTicketBody(working, mode || 'ai');
    // Find the forwarded header that was stripped (From/Sent/To/Subject block)
    var formRemovals = [];
    var formRules = [];
    var _subIdx = working.search(/\bSubject\s*:/i);
    var _hasForwardHeaderBeforeSubject = _subIdx >= 0 && /\b(?:From|Fra|Sent|Sendt)\s*:/i.test(working.slice(0, _subIdx));
    var _protectedForwardHeader = (typeof findProtectedForwardHeaderStart === 'function')
      ? findProtectedForwardHeaderStart(working)
      : null;
    if (_hasForwardHeaderBeforeSubject && !_protectedForwardHeader) {
      // Find where form content starts (same logic as cleanTicketBody)
      var _afterSub = working.slice(_subIdx);
      var _fmStart = _afterSub.match(/\bSubject\s*:[^\n]*?(?:\s{2,}|\n)((?:New\s|Name\s*:|Dear\s|Hi\s|Hello\s|Thank\s|Form\s|Lead\s)[\s\S]*)/i);
      var headerEnd = 0;
      if (_fmStart) {
        headerEnd = _subIdx + _afterSub.indexOf(_fmStart[1]);
      } else {
        var _subEnd = _afterSub.match(/\bSubject\s*:[^\n]*?(?:\s{2,}|\n)/i);
        headerEnd = _subEnd ? _subIdx + _subEnd[0].length : 0;
      }
      if (headerEnd > 0) {
        formRemovals.push({ start: 0, end: headerEnd, ruleId: 'form_forwarded_header', note: 'Stripped forwarded email header wrapping the form submission.' });
        formRules.push({ ruleId: 'form_forwarded_header', note: 'Detected a form submission wrapped in a forwarded email. Stripped the From/Sent/To/Subject header; kept all form content.' });
      }
    }
    return mergeResult({
      cleaned: formCleaned,
      removals: formRemovals,
      rules: formRules
    });
  }
  if (mode === 'ai') return mergeResult(stripObviousFooterDetailed(working));
  return mergeResult({ cleaned: working, removals: [], rules: [] });
}

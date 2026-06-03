/* Shared cleaner engine (footer/signature stripping pipeline) */

/**
 * Strip corporate email boilerplate (disclaimers, confidentiality notices, security warnings).
 * Safe to apply in ALL modes (display + AI) — only removes legal/compliance noise, not signatures.
 */
function stripEmailBoilerplate(text) {
  if (!text) return text;
  // "e-mail message", "e-mail", "email", "message" — all variants
  var EM = '(?:e-?mail\\s+)?(?:message|communication)';
  return text
    .replace(new RegExp('\\bIMPORTANT\\s*:\\s*This ' + EM + '[\\s\\S]*?(?:original (?:e-?mail |message)?\\.?|proprietary information\\.?)\\s*', 'gi'), '')
    .replace(/\bif you are not the intended recipient[^.]*\.\s*/gi, '')
    .replace(/\bor this e-?mail was addressed to you in error[^.]*\.\s*/gi, '')
    .replace(new RegExp('\\bthis ' + EM + ',?\\s*including attachments?,?\\s*is for[^.]*\\.\\s*', 'gi'), '')
    .replace(new RegExp('\\bthis ' + EM + '\\s+is\\s+intended\\s+(?:solely |only )?for[^.]*\\.\\s*', 'gi'), '')
    .replace(new RegExp('\\bthis ' + EM + '\\s+is\\s+(?:for\\s+the\\s+sole\\s+use|solely\\s+for)[^.]*\\.\\s*', 'gi'), '')
    .replace(/\bmay contain (?:confidential|privileged)[^.]*\.\s*/gi, '')
    .replace(/\byou (?:should|must) delete this[^.]*\.\s*/gi, '')
    .replace(/\byou are notified that[^.]*\.\s*/gi, '')
    .replace(/\bdisclosing,?\s*copying[^.]*\.\s*/gi, '')
    .replace(/\b(?:NONCONFIDENTIAL|CONFIDENTIAL)\s*\/\/\s*(?:EXTERNAL|INTERNAL)\b/g, '')
    .replace(/\bPLEASE NOTE\s*:\s*This (?:e-?mail\s+)?(?:message\s+)?is not from[^.]*\.\s*(?:Do not[^.]*\.\s*)*/gi, '')
    .replace(/\bImportance\s*:\s*(?:High|Low|Normal)\b/gi, '');
}

function stripObviousFooterDetailed(text) {
  if (!text) return { raw: '', cleaned: '', removals: [], rules: [] };
  var forwardingAnalysis = analyzeSecureViewForwardedIntro(text);
  var acceptedRules = Array.isArray(forwardingAnalysis.rules) ? forwardingAnalysis.rules.slice() : [];
  var normalized = stripEmailBoilerplate(
    String(forwardingAnalysis.cleaned || '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/~~/g, '')                                                          // strip markdown strikethrough markers — they are formatting artifacts, not content delimiters
  )
    .replace(/\s+\|\s+(?=(?:Phone|Email|E-mail|Mobile|Cell|Fax|Office)\s*:)/gi, '\n')
    .replace(/\s+(?=(?:Phone|E-mail|Mobile|Cell|Fax|Office|From|Fra|Sent|Sendt|Date|To|Til|Cc|Bcc|Subject|Emne)\s*:)/gi, '\n')
    .replace(/\bReceived\s*\nFrom:/gi, 'Received From:')
    .trim();

  var debug = {
    triggered_rules: [],
    rollback_rules: [],
    rule_events: []
  };

  function getProtectedHeaderStartForCurrentText(currentText) {
    if (typeof findProtectedForwardHeaderStart !== 'function') return -1;
    var guard = findProtectedForwardHeaderStart(currentText);
    if (!guard || typeof guard.start !== 'number' || guard.start < 0) return -1;
    return guard.start;
  }

  function shouldBlockProtectedHeaderCut(ruleId, currentText, candidateText) {
    if (!/^(?:forwarded_header_body_extract|contact_footer_marker|forwarded_header_tail|signature_block_score|dense_contact_tail|inline_signoff_contact_tail|signoff_line|confidentiality_disclaimer)$/.test(String(ruleId || ''))) {
      return false;
    }
    var protectedStart = getProtectedHeaderStartForCurrentText(currentText);
    if (protectedStart < 0) return false;
    var current = String(currentText || '');
    var candidate = String(candidateText || '');
    if (!candidate || candidate.length >= current.length) return false;

    // Block if candidate drops the protected header slice.
    var protectedSlice = current.slice(protectedStart, Math.min(current.length, protectedStart + 140)).trim();
    if (protectedSlice && candidate.indexOf(protectedSlice) === -1) return true;

    // Prefix truncation that starts before/around protected header is also unsafe.
    if (current.indexOf(candidate) === 0 && candidate.length <= (protectedStart + 20)) return true;
    return false;
  }

  function tryHighRiskCandidate(ruleId, note, candidateText, sourceTextOverride) {
    var currentText = String(sourceTextOverride == null ? normalized : sourceTextOverride);
    var candidate = String(candidateText || '').trim();
    if (!candidate || candidate === currentText) return false;
    if (shouldBlockProtectedHeaderCut(ruleId, currentText, candidate)) return false;

    // ── Preserve signoff phrases: if candidate drops a trailing "Thank you" etc., extend it ──
    // Find the LAST signoff match in original text (not the first — body may contain "Thank you for...")
    var _soReG = /\b(many thanks|thank you so much|thank you|thanks|best regards|kind regards|warm regards|regards|sincerely|cheers|respectfully|cordially)\b[,!.:]*/gi;
    var _soLastMatch = null, _soM;
    while ((_soM = _soReG.exec(currentText)) !== null) _soLastMatch = _soM;
    if (_soLastMatch && _soLastMatch.index >= candidate.length) {
      // The last signoff is beyond candidate's end — extend candidate to include it
      var _soEnd = _soLastMatch.index + _soLastMatch[0].length;
      if (_soEnd <= currentText.length) {
        candidate = currentText.slice(0, _soEnd).trim();
      }
    }

    debug.triggered_rules.push(ruleId);

    var evaluation = evaluateHighRiskCandidate(currentText, candidate);
    debug.rule_events.push({
      rule_id: ruleId,
      accepted: !evaluation.rollback,
      rollback_applied: evaluation.rollback,
      note: evaluation.rollback
        ? 'Rollback applied because this truncation would leave header/signature noise or lose meaningful latest-message content.'
        : note,
      quality_flags: evaluation.quality_flags,
      validation: evaluation.validation
    });

    if (evaluation.rollback) {
      debug.rollback_rules.push(ruleId);
      return false;
    }

    normalized = candidate;
    acceptedRules.push({ ruleId: ruleId, note: note });
    return true;
  }

  // Save normalized text BEFORE any cleaning rules run (for signoff preservation safety net)
  var _preRulesNormalized = normalized;

  var leadingBanner = stripLeadingExternalBanner(normalized);
  if (leadingBanner.rule) {
    normalized = leadingBanner.cleaned;
    acceptedRules.push(leadingBanner.rule);
  }

  // Detect: "ack + signature" prefix sitting on top of a forwarded/quoted chain.
  // In that case the real ticket content lives inside the quoted chain, so we
  // must NOT let any of the cut rules below discard it.
  var ackOnlyPreservesChain = (function() {
    var idx = normalized.search(/(?:^|\n)(?:From|Sent|Subject)\s*:/i);
    if (idx <= 0) return false;
    var prefix = normalized.slice(0, idx).trim();
    if (!prefix) return false;
    if (!footerIsAckPlusSignatureOnly(prefix)) return false;
    return normalized.slice(idx).length > 80;
  })();

  var forwardedHeaderIdx = normalized.search(/(?:^|\n)From\s*:/i);
  var forwardedBodyMatch = normalized.match(/(?:^|\n)From\s*:[\s\S]*?(?:^|\n)Subject\s*:[^\n]*\n+([\s\S]+)/i);
  var prefixBeforeForward = forwardedHeaderIdx > 0 ? normalized.slice(0, forwardedHeaderIdx).trim() : '';
  var prefixLooksLikeRealBody = prefixBeforeForward.length > 240
    || /\?/.test(prefixBeforeForward)
    || /\b(?:hello|hi|dear|however|unable|issue|problem|please|help|screen|player|content|error|version|install|installed|reboot|black|offline|showing|thank you|thanks)\b/i.test(prefixBeforeForward);
  if (!ackOnlyPreservesChain && forwardedBodyMatch && forwardedBodyMatch[1] && forwardedHeaderIdx >= 0 && (forwardedHeaderIdx <= 220 || !prefixLooksLikeRealBody)) {
    var headerTripletGuardStart = getProtectedHeaderStartForCurrentText(normalized);
    if (headerTripletGuardStart >= 0) {
      // Guard: when From/Sent/To or Sent/To/Subject block is present, do not
      // drop content starting at this header block via forwarded-body extract.
      forwardedBodyMatch = null;
    }
  }
  if (!ackOnlyPreservesChain && forwardedBodyMatch && forwardedBodyMatch[1] && forwardedHeaderIdx >= 0 && (forwardedHeaderIdx <= 220 || !prefixLooksLikeRealBody)) {
    var forwardedCandidate = forwardedBodyMatch[1].trim();
    if (!footerWouldDropCurrentMessagePrefix(prefixBeforeForward, forwardedCandidate)
      && !footerWouldOvercleanToWeakResidual(normalized, forwardedCandidate)
      && !footerTextContainsProtectedEmailMicroBlock(prefixBeforeForward)) {
      tryHighRiskCandidate(
        'forwarded_header_body_extract',
        'Detected a forwarded email header and kept only the forwarded message body after Subject: because validation preserved the newest real message.',
        forwardedCandidate
      );
    }
  }

  var quotedReplyCandidate = findQuotedReplyDedupCandidate(normalized);
  if (quotedReplyCandidate && quotedReplyCandidate.idx > 0) {
    var quotedCandidate = normalized.slice(0, quotedReplyCandidate.idx).trim();
    if (!ackOnlyPreservesChain
        && !footerWouldOvercleanToWeakResidual(normalized, quotedCandidate)
        && !footerIsAckPlusSignatureOnly(quotedCandidate)) {
      var obviousQuotedRule = quotedReplyCandidate.ruleId === 'quoted_reply_mobile_chain'
        || quotedReplyCandidate.ruleId === 'quoted_reply_obvious_boundary';
      if (obviousQuotedRule && (footerHasMeaningfulLatestReplyContent(quotedCandidate) || looksLikeRealMessage(quotedCandidate))) {
        normalized = quotedCandidate;
        acceptedRules.push({ ruleId: quotedReplyCandidate.ruleId, note: quotedReplyCandidate.note });
      } else {
      tryHighRiskCandidate(
        quotedReplyCandidate.ruleId,
        quotedReplyCandidate.note,
        quotedCandidate
      );
      }
    }
  }

  var disclaimerCut = normalized.search(/\b(?:confidentiality notice|this email and any attachments|intended only for the person|please consider the environment|privileged and confidential)\b/i);
  if (disclaimerCut > 0) {
    tryHighRiskCandidate(
      'confidentiality_disclaimer',
      'Removed the confidentiality/disclaimer block at the end of the message.',
      normalized.slice(0, disclaimerCut).trim()
    );
  }

  var greetingStart = normalized.search(/(?:^|\n)(?:hi|hello|dear|good morning|good afternoon|good evening)\b/i);
  if (greetingStart > 0) {
    tryHighRiskCandidate(
      'leading_greeting_extract',
      'Dropped text before the first greeting because the remaining text validated as the latest real message.',
      normalized.slice(greetingStart).trim()
    );
  }

  var sentenceStart = normalized.search(/(?:^|\n)(?:i\s|we\s|can\s|could\s|please\s|our\s|the\s|is\s|are\s)/i);
  if (sentenceStart > 0) {
    var lead = normalized.slice(0, sentenceStart).trim();
    if (lead && lead.split('\n').length <= 4 && /(?:@|\b(?:team lead|manager|director|specialist|engineer|consultant|phone|mobile|email)\b|(?:\b\d{2,5}\s+(?:road|street|avenue|suite|bldg|drive|lane|court|way)\b)|\b(?:spain|midland)\b)/i.test(lead)) {
      tryHighRiskCandidate(
        'leading_sentence_extract',
        'Dropped leading contact-style preamble before the first sentence-like body line.',
        normalized.slice(sentenceStart).trim()
      );
    }
  }

  var signoffMatch = normalized.match(
    /((?:many thanks|thank you|thanks|best regards|kind regards|regards|sincerely|cheers)[,!.]*)\s*\n([\s\S]*)$/i
  );
  var signoffTrimmed = signoffMatch
    ? normalized.slice(0, signoffMatch.index + signoffMatch[1].length).trim()   // keep the signoff phrase itself (e.g. "Thank you,")
    : normalized;
  // Guard: if text AFTER the signoff word contains real body content
  // (complete sentences, error messages, technical terms), do NOT cut.
  var signoffTailHasBody = false;
  if (signoffMatch && signoffMatch[2]) {
    var signoffTailText = signoffMatch[2].trim();
    if (signoffTailText && (
      /[.!?]\s/.test(signoffTailText) ||
      /\b(?:error|privilege|license|permission|administrator|cannot|can't|unable|failed|issue|problem|not working|offline|black screen|white screen|please contact)\b/i.test(signoffTailText)
    )) {
      signoffTailHasBody = true;
    }
  }
  if (!signoffTailHasBody && !ackOnlyPreservesChain && signoffTrimmed !== normalized && !footerWouldOvercleanToGreeting(normalized, signoffTrimmed)) {
    tryHighRiskCandidate(
      'signoff_line',
      'Removed a trailing sign-off block while preserving the main body content.',
      signoffTrimmed
    );
  }

  var signoffQuotedReplyTrimmed = normalized.replace(
    /\n(?:[^\n]*?(?:many thanks|thank you|thanks|best regards|kind regards|warm regards|with regards|regards|sincerely|cheers)[^\n]*)\n+(?=(?:On\s.+wrote:|From:|Sent:|To:|Cc:|Subject:))[\s\S]*$/i,
    ''
  ).trim();
  if (!ackOnlyPreservesChain && signoffQuotedReplyTrimmed && signoffQuotedReplyTrimmed !== normalized) {
    tryHighRiskCandidate(
      'signoff_line',
      'Removed a sign-off plus quoted thread tail while preserving the newest reply.',
      signoffQuotedReplyTrimmed
    );
  }

  // ── dense_contact_tail: detect tail lines where phone + email + address
  //    all appear together (single-line or 2-3 line compact signatures).
  //    Runs BEFORE inline_signature_contact_block to prevent partial cuts. ──
  if (!ackOnlyPreservesChain) {
    var dcLines = normalized.split('\n').map(function(l) { return l.trim(); }).filter(Boolean);
    // scan from the end: collect up to 3 trailing lines and check density
    var dcMaxScan = Math.min(3, dcLines.length - 1); // keep at least 1 line of body
    for (var dcCount = 1; dcCount <= dcMaxScan; dcCount++) {
      var dcStartIdx = dcLines.length - dcCount;
      var dcTail = dcLines.slice(dcStartIdx).join(' ');
      var dcScore = 0;
      if (/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/.test(dcTail)) dcScore += 2;                        // email
      if (/(?:\+?\d[\d\s().-]{6,}\d)/.test(dcTail)) dcScore += 2;                              // phone
      if (/\b[A-Z][a-z]+(?:,\s*[A-Z]{2})?\s*(?:,\s*)?\b\d{5}(?:-\d{4})?\b/.test(dcTail)       // City, ST 00000
          || /\b\d+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Way|St|Street|Rd|Road|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Ln|Lane|Ct|Court|Plaza|Suite|Ste)\b/i.test(dcTail)) {
        dcScore += 2;                                                                           // street address
      }
      if (dcScore >= 6) {
        var dcCandidate = dcLines.slice(0, dcStartIdx).join('\n').trim();
        if (dcCandidate.length >= 20) {
          tryHighRiskCandidate(
            'dense_contact_tail',
            'Removed trailing dense contact line(s) containing phone, email, and address.',
            dcCandidate
          );
        }
        break;
      }
    }
  }

  var inlineSignatureMatch = normalized.match(
    /(?:\b(?:many thanks|thank you|thanks|respectfully)\b,?\s+)?([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3}\s+(?:IT\s+Supervisor|Customer\s+Success\s+Manager|Administrative\s+Assistant|Digital\s+Signage\s+Technology\s+Specialist|Team\s+Lead|Director|Manager|Engineer|Specialist|Assistant|Consultant|Coordinator|Lead|Operations|Infrastructure|Front\s+Desk|Analyst|Administrator|Liaison|Project\s+Manager|Program\s+Manager|General\s+Manager|Marketing|Support|Facilities\s+Coordinator|Customer\s+Experience)\b[\s\S]{0,500}?(?:\+?\d[\d\s().-]{6,}\d|[\w.+-]+@[\w.-]+\.\w+|\b\d{5}(?:-\d{4})?\b|Have an IT Issue\?|Support Hotline))/i
  );
  // Guard: avoid false positives like "display manager" in body text.
  // Require the matched block to begin with a person-like name (2-4 capitalized tokens).
  if (inlineSignatureMatch && inlineSignatureMatch[1]) {
    var inlineSigHead = String(inlineSignatureMatch[1]).replace(/\s+/g, ' ').trim();
    var personLikeNameAtStart = /^[A-Z][A-Za-z.'-]+(?:\s+\([^)]+\))?(?:\s+[A-Z][A-Za-z.'-]+){1,3}\b/.test(inlineSigHead);
    if (!personLikeNameAtStart) inlineSignatureMatch = null;
  }
  if (!ackOnlyPreservesChain && inlineSignatureMatch && inlineSignatureMatch.index > 0) {
    // Keep signoff phrase (e.g. "Thank you,") — only remove name/contact block after it
    var _sigPrefixMatch = normalized.slice(inlineSignatureMatch.index).match(/^(?:many thanks|thank you|thanks|respectfully)\b[,!.:]*/i);
    var _sigPrefixLen = _sigPrefixMatch ? _sigPrefixMatch[0].length : 0;
    var beforeInlineSignature = normalized.slice(0, inlineSignatureMatch.index + _sigPrefixLen).trim();
    if (/[.!?]$/.test(beforeInlineSignature) || /\b(?:help|appreciated|thanks|thank you|please)\b/i.test(beforeInlineSignature)) {
      var tailAfterInlineSig = normalized.slice(inlineSignatureMatch.index);
      var tailHasCorporateDisclaimer = /\b(?:ALL SALES are subject|standard terms and conditions|confidential and intended for the use of the individual|intended only for the person|privileged and confidential|click here to unsubscribe)\b/i.test(tailAfterInlineSig);
      var appliedInlineSig = tryHighRiskCandidate(
        'inline_signature_contact_block',
        'Removed the inline signature/contact block with job title, phones, address, or support hotline details.',
        beforeInlineSignature
      );
      if (!appliedInlineSig && tailHasCorporateDisclaimer && footerHasMeaningfulLatestReplyContent(beforeInlineSignature)) {
        normalized = beforeInlineSignature;
        acceptedRules.push({
          ruleId: 'inline_signature_contact_block',
          note: 'Removed the inline signature/contact block and trailing corporate disclaimer while preserving the issue description.'
        });
      }
    }
  }

  if (!ackOnlyPreservesChain && typeof stripInlineSignoffContactTail === 'function') {
    var inlineSignoffCandidate = stripInlineSignoffContactTail(normalized);
    if (inlineSignoffCandidate && inlineSignoffCandidate !== normalized) {
      tryHighRiskCandidate(
        'inline_signoff_contact_tail',
        'Removed an inline sign-off (Thanks/Best/Regards) followed by name and contact details (email/phone/address/title) on the same line.',
        inlineSignoffCandidate
      );
    }
  }

  var footerMarker = normalized.search(/\n?(?:Phone|Email|E-mail|Mobile|Cell|Fax|Office)\s*:|(?:^|\n)(?:From|Sent|To|Cc|Subject)\s*:/i);
  if (!ackOnlyPreservesChain && footerMarker > 0) {
    var truncateStart = footerMarker;
    var inlineContactStart = findInlineContactTailStart(normalized, footerMarker);
    if (inlineContactStart > 0 && footerHasMeaningfulLatestReplyContent(normalized.slice(0, inlineContactStart).trim())) {
      truncateStart = inlineContactStart;
    }
    var protectedHeaderStartForMarker = getProtectedHeaderStartForCurrentText(normalized);
    if (protectedHeaderStartForMarker >= 0 && truncateStart >= Math.max(0, protectedHeaderStartForMarker - 2)) {
      truncateStart = -1;
    }
    if (truncateStart > 0) {
      var footerMarkerCandidate = normalized.slice(truncateStart).replace(/^\n+/, '');
      var footerMarkerLines = footerMarkerCandidate.split('\n').map(function(line) { return line.trim(); }).filter(Boolean);
      if (!footerTailContainsProtectedStructuredLines(footerMarkerLines, 0)
        && !footerTailContainsProtectedTechnicalKeyValueBlock(footerMarkerLines, 0)
        && !footerWouldOvercleanToWeakResidual(normalized, normalized.slice(0, truncateStart).trim())
        && !footerTailContainsProtectedEmailMicroBlock(footerMarkerLines, 0)) {
        tryHighRiskCandidate(
          'contact_footer_marker',
          'Removed trailing contact/footer content after a phone, email, website, or forwarded-header marker.',
          normalized.slice(0, truncateStart).trim()
        );
      }
    }
  }

  var beforeTailTruncation = normalized;
  var linePassRuleStart = acceptedRules.length;
  var lines = normalized.split('\n').map(function(line) { return line.trim(); }).filter(Boolean);
  var protectedHeaderStartForTailRules = getProtectedHeaderStartForCurrentText(normalized);
  var hasStructuredListProtection = footerStructuredListRunLength(lines) >= 3
    || footerTechnicalKeyValueRunLength(lines) >= 4;
  for (var startIdx = 1; startIdx < lines.length; startIdx++) {
    if (hasStructuredListProtection) break;
    if (ackOnlyPreservesChain) break;
    var candidateLine = lines[startIdx];
    if (footerTailContainsProtectedStructuredLines(lines, startIdx)) continue;
    if (footerTailContainsProtectedTechnicalKeyValueBlock(lines, startIdx)) continue;
    if (footerTailContainsProtectedEmailMicroBlock(lines, startIdx)) continue;
    var candidateScore = footerTailScore(lines, startIdx);
    var candidateTailLength = lines.length - startIdx;
    var candidateIsSignoff = footerIsSignoffLine(candidateLine);
    var candidateHasStrongContact = footerTailHasStrongContactSignal(lines, startIdx + 1);
    var candidateHasQuotedReply = footerTailHasQuotedReplySignal(lines, startIdx + 1);
    var candidateHasEmail = /[\w.+-]+@[\w.-]+\.\w+/.test(candidateLine) && !/https?:\/\/|www\./i.test(candidateLine);
    var candidateHasPhone = /\+?\d[\d\s().-]{6,}\d/.test(candidateLine) && !/https?:\/\/|www\./i.test(candidateLine);
    var candidateLooksPlausible = footerIsSignoffLine(candidateLine)
      || footerLooksLikeNameLine(candidateLine)
      || candidateHasEmail
      || candidateHasPhone
      || /\b(?:manager|director|engineer|specialist|assistant|consultant|coordinator|lead|operations|support|sales|technology|business|administrative|front desk)\b/i.test(candidateLine);
    if (footerTailStartsWithNameBeforeQuotedBoundary(lines, startIdx)) continue;
    if (!candidateIsSignoff && !footerLooksLikeNameLine(candidateLine) && !candidateHasEmail && footerLooksLikeBodyLine(candidateLine)) continue;
    if (candidateIsSignoff && candidateTailLength > 4) continue;
    if (candidateIsSignoff && !candidateHasStrongContact && !candidateHasQuotedReply) continue;
    if (candidateLooksPlausible && candidateScore >= 4) {
      var candidateCleaned = lines.slice(0, startIdx).join('\n').trim();
      if (protectedHeaderStartForTailRules >= 0 && candidateCleaned.length <= (protectedHeaderStartForTailRules + 6)) continue;
      if (footerWouldOvercleanToGreeting(normalized, candidateCleaned)) continue;
      if (footerWouldOvercleanToWeakResidual(normalized, candidateCleaned)) continue;
      if (footerIsGreetingOnly(candidateCleaned) && footerTailLooksLikeShortContactOnly(lines, startIdx)) continue;
      var previous = normalized;
      if (tryHighRiskCandidate(
        'signature_block_score',
        'Removed the trailing signature/footer block based on contact-info and signature scoring.',
        candidateCleaned
      )) {
        lines = normalized.split('\n').map(function(line) { return line.trim(); }).filter(Boolean);
        beforeTailTruncation = normalized;
        break;
      }
      normalized = previous;
    }
  }

  lines = normalized.split('\n').map(function(line) { return line.trim(); }).filter(Boolean);
  var kept = [];
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (hasStructuredListProtection || ackOnlyPreservesChain) {
      kept.push(line);
      continue;
    }
    if (kept.length && footerIsSignoffWithNameLine(line) && ((i === lines.length - 1) || footerTailLooksLikeContactOnly(lines, i + 1))) {
      if (footerTailContainsProtectedStructuredLines(lines, i + 1)) {
        kept.push(line);
        continue;
      }
      if (footerTailContainsProtectedEmailMicroBlock(lines, i + 1)) {
        kept.push(line);
        continue;
      }
      // Keep the signoff line itself (e.g. "Thank you, Name") — only drop contact tail after it
      var _signoffWordMatch = line.match(/^((?:many thanks|thank you so much|thank you|thanks|best regards|kind regards|warm regards|regards|sincerely|cheers|respectfully|cordially|best)\b[,!.:]*)/i);
      var signoffWithNameCandidate = (_signoffWordMatch
        ? kept.concat(_signoffWordMatch[1]).join('\n').trim()
        : kept.join('\n').trim());
      if (tryHighRiskCandidate(
        'signoff_line',
        'Stopped at a closing/sign-off line with name and dropped the remaining contact tail.',
        signoffWithNameCandidate,
        normalized
      )) {
        break;
      }
      kept.push(line);
      continue;
    }
    if (footerIsSignoffLine(line) && kept.length && (lines.length - i) <= 4) {
      if (footerTailContainsProtectedStructuredLines(lines, i + 1)) {
        kept.push(line);
        continue;
      }
      if (footerTailContainsProtectedEmailMicroBlock(lines, i + 1)) {
        kept.push(line);
        continue;
      }
      if (/[\/|]/.test(line) && !footerTailHasStrongContactSignal(lines, i + 1) && !footerTailHasQuotedReplySignal(lines, i + 1)) {
        kept.push(line);
        continue;
      }
      // Keep the signoff line itself — only drop name/contact after it
      var signoffCandidate = kept.concat(line).join('\n').trim();
      if (footerWouldOvercleanToGreeting(normalized, signoffCandidate)) {
        kept.push(line);
        continue;
      }
      if (footerWouldOvercleanToWeakResidual(normalized, signoffCandidate)) {
        kept.push(line);
        continue;
      }
      // A standalone closing like "Kind Regards," is still footer noise even when
      // there is no explicit phone/email tail after it. We keep the cleaner conservative
      // by only allowing this cut after the surviving prefix validates as a real message.
      if (tryHighRiskCandidate(
        'signoff_line',
        'Stopped at a closing/sign-off line and dropped the rest as footer.',
        signoffCandidate,
        normalized
      )) {
        break;
      }
      kept.push(line);
      continue;
    }
    if (/^(?:From|Sent|To|Cc|Subject)\s*:/i.test(line)) {
      if (protectedHeaderStartForTailRules >= 0) {
        kept.push(line);
        continue;
      }
      var forwardedTailCandidate = kept.join('\n').trim();
      if (tryHighRiskCandidate(
        'forwarded_header_tail',
        'Stopped at a forwarded/reply header block and dropped the remaining footer/thread text.',
        forwardedTailCandidate,
        normalized
      )) {
        break;
      }
      kept.push(line);
      continue;
    }
    if (/\b(?:confidentiality notice|this email and any attachments|intended only for the person|privileged and confidential)\b/i.test(line)) {
      var disclaimerCandidate = kept.join('\n').trim();
      if (tryHighRiskCandidate(
        'confidentiality_disclaimer',
        'Stopped at a confidentiality/disclaimer line and dropped the remaining footer.',
        disclaimerCandidate,
        normalized
      )) {
        break;
      }
      kept.push(line);
      continue;
    }
    if (kept.length && footerIsMobileDeviceSignature(line)) {
      var mobileCandidate = kept.join('\n').trim();
      if (tryHighRiskCandidate(
        'mobile_signature',
        'Stopped at a mobile-device signature line and dropped the remaining footer.',
        mobileCandidate,
        normalized
      )) {
        break;
      }
      kept.push(line);
      continue;
    }
    if (kept.length && /\b(?:Phone|Email|E-mail|Mobile|Cell|Fax|Office)\s*:/i.test(line)) {
      if (footerTailContainsProtectedStructuredLines(lines, i)) {
        kept.push(line);
        continue;
      }
      if (footerTailContainsProtectedEmailMicroBlock(lines, i)) {
        kept.push(line);
        continue;
      }
      var contactTailCandidate = kept.join('\n').trim();
      if (tryHighRiskCandidate(
        'contact_footer_marker',
        'Stopped when contact/footer markers appeared after the main message.',
        contactTailCandidate,
        normalized
      )) {
        break;
      }
      kept.push(line);
      continue;
    }
    kept.push(line);
  }

  var finalCleaned = normalized;
  if (kept.length && kept.join('\n').trim() !== normalized) {
    finalCleaned = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  if (footerWouldOvercleanToGreeting(beforeTailTruncation, finalCleaned)) {
    finalCleaned = beforeTailTruncation;
    acceptedRules = acceptedRules.slice(0, linePassRuleStart);
    debug.rollback_rules.push('post_truncation_greeting_only');
    debug.rule_events.push({
      rule_id: 'post_truncation_greeting_only',
      accepted: false,
      rollback_applied: true,
      note: 'Rollback applied because the cleaned result became greeting-only after tail truncation.',
      quality_flags: ['greeting_only'],
      validation: buildValidationSnapshot(beforeTailTruncation, finalCleaned)
    });
  }
  if (footerWouldOvercleanToWeakResidual(beforeTailTruncation, finalCleaned)) {
    finalCleaned = beforeTailTruncation;
    acceptedRules = acceptedRules.slice(0, linePassRuleStart);
    debug.rollback_rules.push('post_truncation_weak_residual');
    debug.rule_events.push({
      rule_id: 'post_truncation_weak_residual',
      accepted: false,
      rollback_applied: true,
      note: 'Rollback applied because the cleaned result became too weak to represent the latest real message.',
      quality_flags: ['weak_residual'],
      validation: buildValidationSnapshot(beforeTailTruncation, finalCleaned)
    });
  }

  var finalLines = finalCleaned.split('\n').map(function(line) { return line.trim(); }).filter(Boolean);
  if (finalLines.length >= 2) {
    var lastLine = finalLines[finalLines.length - 1];
    var prevLine = finalLines[finalLines.length - 2];
    if (footerLooksLikeNameLine(lastLine) && (footerIsSignoffLine(prevLine) || footerIsSignoffWithNameLine(prevLine))) {
      finalLines.pop();
      finalCleaned = finalLines.join('\n').trim();
      acceptedRules.push({
        ruleId: 'signoff_name_tail',
        note: 'Removed the standalone name line left behind after a closing/sign-off.'
      });
    }
  }
  finalLines = finalCleaned.split('\n').map(function(line) { return line.trim(); }).filter(Boolean);
  if (finalLines.length >= 2) {
    var trailingLine = finalLines[finalLines.length - 1];
    // Keep bilingual/light signoffs like "Mit freundlichen Grüßen / Best regards"
    // when we are being conservative, but still drop plain standalone closings.
    // Keep signoff lines (Thank you, Thanks, etc.) — they are part of the message
    if (false && footerIsSignoffLine(trailingLine) && !/[\/|]/.test(trailingLine)) {
      finalLines.pop();
      finalCleaned = finalLines.join('\n').trim();
      acceptedRules.push({
        ruleId: 'signoff_line',
        note: 'Removed the trailing standalone sign-off line after preserving the latest message body.'
      });
    }
  }

  // Round 1: block-level dedup (repeated signature/address/disclaimer blocks)
  // Pure additive post-processing: finds blocks that appear 2+ times after
  // whitespace/punctuation normalization, keeps the first, drops the rest.
  try {
    var dedupResult = dedupRepeatedSignatureBlocks(finalCleaned);
    if (dedupResult && dedupResult.removed && dedupResult.removed.length) {
      finalCleaned = dedupResult.cleaned;
      acceptedRules.push({
        ruleId: 'block_dedup',
        note: 'Collapsed ' + dedupResult.removed.length + ' repeated signature/disclaimer block(s) — kept the first occurrence and dropped later duplicates.'
      });
    }
  } catch (dedupErr) {
    // Never break cleaning if dedup has a bug; log and continue
    try { console && console.warn && console.warn('block_dedup failed:', dedupErr); } catch (_) {}
  }

  // Round 2: orphan email header cleanup.
  // After Round 1 removes repeated signature/disclaimer blocks, any remaining
  // From:/Sent:/To:/Cc:/Bcc:/Subject: header block whose body is now empty
  // is removed.
  try {
    var orphanResult = removeOrphanEmailHeaders(finalCleaned);
    if (orphanResult && orphanResult.removed && orphanResult.removed.length) {
      finalCleaned = orphanResult.cleaned;
      acceptedRules.push({
        ruleId: 'orphan_email_headers',
        note: 'Removed ' + orphanResult.removed.length + ' orphan email header block(s) whose body content was already empty.'
      });
    }
  } catch (orphanErr) {
    try { console && console.warn && console.warn('orphan_email_headers failed:', orphanErr); } catch (_) {}
  }

  // ── Final safety net: restore trailing signoff phrase if it was removed ──
  // After ALL cleaning rules, dedup, and orphan removal, check if the original
  // text had a trailing signoff phrase (like "Thank you,") that got dropped.
  // If so, extend finalCleaned to include it. This catches cases where multiple
  // interacting rules or post-processing steps accidentally remove the signoff.
  (function preserveTrailingSignoff() {
    var _sfRe = /\b(many thanks|thank you so much|thank you|thanks|best regards|kind regards|warm regards|regards|sincerely|cheers|respectfully|cordially)\b[,!.:]*/gi;
    var _sfLast = null, _sfM;
    while ((_sfM = _sfRe.exec(_preRulesNormalized)) !== null) _sfLast = _sfM;
    if (!_sfLast) return;

    var _sfPhrase = _sfLast[1].toLowerCase();
    var _sfEnd = _sfLast.index + _sfLast[0].length;

    // Check if finalCleaned already ends with (or near) this signoff
    var _fcLower = finalCleaned.toLowerCase();
    var _lastPos = _fcLower.lastIndexOf(_sfPhrase);
    // "near end" = within 5 chars of the end (allows trailing punctuation/whitespace)
    if (_lastPos >= 0 && _lastPos + _sfPhrase.length >= finalCleaned.length - 5) return;

    // Signoff was removed. Only restore if:
    // 1. finalCleaned is a prefix of the pre-rules text (tail was trimmed)
    // 2. The signoff position is BEYOND finalCleaned's end
    // 3. The gap between finalCleaned and the signoff is small (< 200 chars)
    //    to avoid pulling in large chunks of footer text
    if (_sfEnd <= finalCleaned.length) return; // signoff is within cleaned range (shouldn't happen if check above passed)
    var _prefixMatch = _preRulesNormalized.indexOf(finalCleaned) === 0
      || _preRulesNormalized.replace(/\s+/g, ' ').indexOf(finalCleaned.replace(/\s+/g, ' ').slice(0, 80)) === 0;
    if (!_prefixMatch) return;
    var _gapSize = _sfEnd - finalCleaned.length;
    if (_gapSize > 200) return; // too much text between cleaned end and signoff — not just a signoff

    var _extended = _preRulesNormalized.slice(0, _sfEnd).trim();
    if (_extended.length > finalCleaned.length) {
      finalCleaned = _extended;
      acceptedRules.push({ ruleId: 'signoff_preserved', note: 'Restored trailing signoff phrase that was removed by earlier rules.' });
    }
  })();

  var finalValidation = buildValidationSnapshot(forwardingAnalysis.raw, finalCleaned);
  var finalQualityFlags = collectValidationFlags(finalValidation);
  var dedupedRules = [];
  var seenRuleKeys = {};
  acceptedRules.forEach(function(rule) {
    if (!rule || !rule.ruleId) return;
    var key = rule.ruleId + '|' + String(rule.note || '');
    if (seenRuleKeys[key]) return;
    seenRuleKeys[key] = true;
    dedupedRules.push(rule);
  });

  return {
    raw: forwardingAnalysis.raw,
    cleaned: finalCleaned,
    removals: forwardingAnalysis.removals || [],
    rules: dedupedRules,
    debug: {
      cleaned_text: finalCleaned,
      high_risk_rule_triggered: debug.triggered_rules.length > 0,
      rollback_applied: debug.rollback_rules.length > 0,
      quality_flags: finalQualityFlags,
      validation: finalValidation,
      high_risk_rules: debug.triggered_rules,
      rollback_rules: debug.rollback_rules,
      rule_events: debug.rule_events
    }
  };
}

function stripObviousFooter(text) {
  return stripObviousFooterDetailed(text).cleaned;
}

/**
 * Clean / normalize a ticket body that arrived as a web-form dump.
 *
 * Some tickets come in as a single line of concatenated field labels:
 *   "First Name: Cara Last Name: Wozniak Email: … Notes for Issue Type: <actual issue>"
 *
 * mode 'display' — inserts line breaks between fields for human readability
 * mode 'ai'      — extracts only the issue description and strips PII noise
 *
 * If the text does NOT look like a form dump, it is returned as-is.
 */

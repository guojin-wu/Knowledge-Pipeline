/**
 * shared-cleaner-helpers.js — Main orchestration and shared utility functions
 *
 * DEPENDENCIES: This file expects the following to be loaded BEFORE it:
 * - cleaner-header-strip.js (header stripping and deduplication)
 * - cleaner-footer-analysis.js (footer analysis predicates)
 * - cleaner-boundary-detect.js (boundary detection and contact tail functions)
 *
 * This file provides:
 * - Remaining shared utility functions
 * - Meaning extraction and message analysis
 * - High-risk candidate evaluation
 * - Quoted reply detection and orchestration
 * - Email signature and contact line detection
 * - Main orchestration functions for cleanup
 *
 * Include this on every page that needs email message cleaning.
 * Usage: <script src="cleaner-header-strip.js"></script>
 *        <script src="cleaner-footer-analysis.js"></script>
 *        <script src="cleaner-boundary-detect.js"></script>
 *        <script src="shared-cleaner-helpers.js"></script>
 */

// ─── HELPER UTILITIES ────────────────────────────────────────────────────

function isHeaderLine(line) {
  var text = String(line || '').trim();
  if (!text) return false;
  return /^(?:From|Fra|Sent|Sendt|Date|To|Til|Cc|Bcc|Subject|Emne|Importance)\s*:/i.test(text)
    || /^(?:NONCONFIDENTIAL\s*\/\/\s*EXTERNAL|PLEASE NOTE:|NOTICE:|CAUTION:|\[EXTERNAL(?:\s+SENDER)?[^\]]*\])/i.test(text)
    || /\bexternal sender\b/i.test(text)
    || /^On\s.+wrote:$/i.test(text);
}

function isQuotedReplyLine(line) {
  return /^(?:On\s.+wrote:|From|Fra|Sent|Sendt|Date|To|Til|Cc|Bcc|Subject|Emne)\b/i.test(String(line || '').trim());
}

function isSignatureLine(line) {
  var text = String(line || '').trim();
  if (!text) return false;
  return footerIsSignoffLine(text)
    || footerIsSignoffWithNameLine(text)
    || footerIsMobileDeviceSignature(text)
    || footerLooksLikeNameLine(text)
    || footerLineHasEmail(text)
    || (footerLineLooksLikeContactInfo(text) && !footerLooksLikeBodyLine(text) && text.length <= 140)
    || /^(?:regards|best regards|kind regards|respectfully|thanks)\b/i.test(text);
}

function normalizeMeaningSpan(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9:/#._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function lineLooksLikeTechnicalContent(line) {
  var text = String(line || '').trim();
  if (!text) return false;
  return footerLineIsStandaloneUrl(text)
    || footerLineLooksProtectedStructured(text)
    || /\b(?:url|version|player|device|shortcode|mac|license|hardware id|lan id|serial|firmware|ipk|installer|deploy|portal|api|vpn|ip address)\b/i.test(text)
    || /https?:\/\/\S+/i.test(text);
}

function lineLooksLikeActionContent(line) {
  var text = String(line || '').trim();
  if (!text) return false;
  return /\b(?:can|could|please|worked|error|issue|update|confirm|try|reset|install|installed|provide|help|support|schedule|reply|send|forward|add|include|contact|reach|advise|let me know|resolved|working|incorrect|offline|screen|thread)\b/i.test(text)
    || /\?/.test(text);
}

function stripInlineSignoffTailForAnalysis(line) {
  var text = String(line || '').trim();
  if (!text) return text;
  var match = text.match(/\s+(?:many thanks|thank you|thanks|best regards|kind regards|warm regards|with regards|regards|sincerely|cheers|cordially|warmly|respectfully)(?:[,:]|\b)/i);
  if (!match || typeof match.index !== 'number') return text;
  var prefix = text.slice(0, match.index).trim();
  if (!prefix) return text;
  if (!footerHasMeaningfulBodyContent(prefix)) return text;
  return prefix;
}

function splitMeaningfulLineSpans(line) {
  var text = stripInlineSignoffTailForAnalysis(line);
  if (!text) return [];
  if (footerIsGreetingOrAckOnly(text)) return [];
  if (lineLooksLikeTechnicalContent(text)) return [text];
  var parts = text.split(/(?<=[.!?])\s+/).map(function(part) { return part.trim(); }).filter(Boolean);
  if (!parts.length) parts = [text];
  return parts.filter(function(part) {
    if (footerIsGreetingOrAckOnly(part)) return false;
    return part.length >= 18 || lineLooksLikeActionContent(part) || lineLooksLikeTechnicalContent(part);
  });
}

function extractMeaningfulSpans(text) {
  var lines = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  var spans = [];
  var started = false;
  for (var i = 0; i < lines.length; i++) {
    var line = String(lines[i] || '').trim();
    if (!line) continue;

    if (!started && isHeaderLine(line)) continue;
    if (started && isQuotedReplyLine(line)) break;
    if (started && isHeaderLine(line) && spans.length) break;
    if (started && isSignatureLine(line)) break;

    started = true;
    splitMeaningfulLineSpans(line).forEach(function(span) {
      spans.push(span);
    });
  }

  var seen = {};
  return spans.filter(function(span) {
    var key = normalizeMeaningSpan(span);
    if (!key || seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

function looksLikeRealMessage(text) {
  var spans = extractMeaningfulSpans(text);
  if (!spans.length) {
    var lines = String(text || '').split('\n').map(function(line) { return line.trim(); }).filter(Boolean);
    if (lines.length >= 1 && lines.length <= 2) {
      var joined = lines.join(' ').replace(/\s+/g, ' ').trim();
      if (joined
        && /[.!?]$/.test(joined)
        && !footerIsGreetingOrAckOnly(joined)
        && !isHeaderLine(joined)
        && !isSignatureLine(joined)) {
        return true;
      }
    }
    return false;
  }
  var normalized = normalizeMeaningSpan(spans.join(' '));
  if (!normalized) return false;
  return /\b(?:can|please|worked|error|issue|update|confirm|try|reset|install|player|device|shortcode|mac|license|url|version|screen|thread|training|support|resolved|working|incorrect|offline)\b/i.test(normalized)
    || /[.?!]/.test(String(text || ''))
    || spans.length >= 2;
}

function isMostlyHeader(text) {
  var lines = String(text || '').split('\n').map(function(line) { return line.trim(); }).filter(Boolean);
  if (!lines.length) return false;
  var headerCount = lines.filter(isHeaderLine).length;
  var meaningfulCount = extractMeaningfulSpans(text).length;
  return (headerCount > 0 && meaningfulCount === 0) || (headerCount >= Math.max(2, Math.ceil(lines.length / 2)) && meaningfulCount === 0);
}

function isMostlySignature(text) {
  var lines = String(text || '').split('\n').map(function(line) { return line.trim(); }).filter(Boolean);
  if (!lines.length) return false;
  var signatureCount = lines.filter(isSignatureLine).length;
  var meaningfulCount = extractMeaningfulSpans(text).length;
  return (signatureCount > 0 && meaningfulCount === 0) || (signatureCount >= Math.max(2, Math.ceil(lines.length / 2)) && meaningfulCount === 0);
}

function preservesEnoughMeaning(raw, cleaned) {
  var rawSpans = extractMeaningfulSpans(raw);
  if (!rawSpans.length) return looksLikeRealMessage(cleaned);
  var cleanedNorm = normalizeMeaningSpan(cleaned);
  var preserved = rawSpans.filter(function(span) {
    return cleanedNorm.indexOf(normalizeMeaningSpan(span)) !== -1;
  });
  var required = rawSpans.length >= 2 ? 2 : 1;
  return preserved.length >= required;
}

function buildValidationSnapshot(raw, cleaned) {
  return {
    looks_like_real_message: looksLikeRealMessage(cleaned),
    mostly_header: isMostlyHeader(cleaned),
    mostly_signature: isMostlySignature(cleaned),
    preserves_enough_meaning: preservesEnoughMeaning(raw, cleaned)
  };
}

function collectValidationFlags(validation) {
  var flags = [];
  if (!validation.looks_like_real_message) flags.push('no_real_message');
  if (validation.mostly_header) flags.push('mostly_header');
  if (validation.mostly_signature) flags.push('mostly_signature');
  if (!validation.preserves_enough_meaning) flags.push('meaning_loss');
  return flags;
}

function evaluateHighRiskCandidate(previousText, candidateText) {
  var validation = buildValidationSnapshot(previousText, candidateText);
  var qualityFlags = collectValidationFlags(validation);
  var previousMeaningfulSpans = extractMeaningfulSpans(previousText);
  var candidateTrimmed = String(candidateText || '').trim();

  if (!previousMeaningfulSpans.length
    && candidateTrimmed
    && !isMostlyHeader(candidateTrimmed)
    && !isMostlySignature(candidateTrimmed)) {
    qualityFlags = qualityFlags.filter(function(flag) {
      return flag !== 'no_real_message' && flag !== 'meaning_loss';
    });
    validation.looks_like_real_message = true;
    validation.preserves_enough_meaning = true;
  }

  return {
    rollback: qualityFlags.length > 0,
    quality_flags: qualityFlags,
    validation: validation
  };
}

// ─── QUOTED REPLY DETECTION ─────────────────────────────────────────────

function findQuotedReplyBoundaryWide(text) {
  var normalized = String(text || '');
  if (!normalized) return -1;
  var match = normalized.match(/(^|\n|>|\s)[> \t]*On\s.+?\bwrote:\s*[\s\S]*$/i);
  if (!match || typeof match.index !== 'number') return -1;
  var prefix = normalized.slice(0, match.index).trim();
  if (!prefix || !looksLikeRealMessage(prefix)) return -1;
  return match.index;
}

function findObviousQuotedBoundary(text) {
  var normalized = String(text || '');
  if (!normalized) return -1;
  var candidates = [];
  var protectedHeader = findProtectedForwardHeaderStart(normalized);

  var onWrote = normalized.match(/(?:^|\n)(On\s.+\bwrote:\s*)/i);
  if (onWrote && typeof onWrote.index === 'number') {
    candidates.push(onWrote.index + (onWrote[0].startsWith('\n') ? 1 : 0));
  }

  var originalMessage = normalized.match(/(?:^|\n)([- ]{2,}Original Message[- ]{2,})/i);
  if (originalMessage && typeof originalMessage.index === 'number') {
    candidates.push(originalMessage.index + (originalMessage[0].startsWith('\n') ? 1 : 0));
  }

  var fromSent = normalized.match(/(?:^|\n)(From\s*:[^\n]*\n(?:[^\n]*\n){0,4}?\s*Sent\s*:)/i);
  if (fromSent && typeof fromSent.index === 'number') {
    var fromSentIdx = fromSent.index + (fromSent[0].startsWith('\n') ? 1 : 0);
    var isProtectedFromSentHeader = protectedHeader
      && typeof protectedHeader.start === 'number'
      && Math.abs(fromSentIdx - protectedHeader.start) <= 4;
    if (!isProtectedFromSentHeader) {
      candidates.push(fromSentIdx);
    }
  }

  if (!candidates.length) return -1;
  var idx = Math.min.apply(null, candidates);
  var prefix = normalized.slice(0, idx).trim();
  if (!quotedPrefixLooksMeaningful(prefix)) return -1;
  return idx;
}

function quotedTailLooksRepeatedOldContent(prefix, tail) {
  var prefixText = String(prefix || '').trim();
  var tailText = String(tail || '').trim();
  if (!prefixText || !tailText) return false;

  var nestedBoundaryCount = (tailText.match(/(?:^|\n)(?:On\s.+wrote:|From\s*:|Sent\s*:|To\s*:|Cc\s*:|Subject\s*:)/gim) || []).length;
  if (nestedBoundaryCount >= 2) return true;

  var prefixSpans = extractMeaningfulSpans(prefixText).map(normalizeMeaningSpan).filter(Boolean);
  if (!prefixSpans.length) return false;
  var prefixSet = {};
  prefixSpans.forEach(function(span) { prefixSet[span] = true; });

  var tailSpans = extractMeaningfulSpans(tailText)
    .map(normalizeMeaningSpan)
    .filter(function(span) { return !!span && span.length >= 16; });
  for (var i = 0; i < tailSpans.length; i++) {
    if (prefixSet[tailSpans[i]]) return true;
  }

  var prefixLines = prefixText.split('\n').map(function(line) { return String(line || '').trim(); }).filter(function(line) {
    return line.length >= 24;
  });
  var prefixLineSet = {};
  prefixLines.forEach(function(line) {
    prefixLineSet[normalizeMeaningSpan(line)] = true;
  });

  var tailLines = tailText.split('\n').map(function(line) { return String(line || '').trim(); }).filter(function(line) {
    return line.length >= 24;
  });
  for (var j = 0; j < tailLines.length; j++) {
    if (prefixLineSet[normalizeMeaningSpan(tailLines[j])]) return true;
  }

  return false;
}

function findQuotedReplyDedupCandidate(text) {
  var normalized = String(text || '');
  if (!normalized) return null;

  var mobileIdx = findMobileSignatureQuotedBoundary(normalized);
  if (mobileIdx > 0) {
    return {
      idx: mobileIdx,
      ruleId: 'quoted_reply_mobile_chain',
      note: 'Removed a mobile-signature quoted chain and kept only the latest reply above it.'
    };
  }

  var obviousIdx = findObviousQuotedBoundary(normalized);
  if (obviousIdx > 0) {
    return {
      idx: obviousIdx,
      ruleId: 'quoted_reply_obvious_boundary',
      note: 'Removed an obvious quoted thread boundary and kept only the latest reply before it.'
    };
  }

  var strictIdx = findQuotedReplyBoundary(normalized);
  if (strictIdx > 0) {
    var strictPrefix = normalized.slice(0, strictIdx).trim();
    var strictTail = normalized.slice(strictIdx).trim();
    if (quotedPrefixLooksMeaningful(strictPrefix) && quotedTailLooksRepeatedOldContent(strictPrefix, strictTail)) {
      return {
        idx: strictIdx,
        ruleId: 'quoted_reply_dedupe',
        note: 'Removed the repeated quoted email thread and kept only the latest reply above the On ... wrote: boundary.'
      };
    }
  }

  var wideIdx = findQuotedReplyBoundaryWide(normalized);
  if (wideIdx > 0) {
    var widePrefix = normalized.slice(0, wideIdx).trim();
    var wideTail = normalized.slice(wideIdx).trim();
    if (quotedPrefixLooksMeaningful(widePrefix) && quotedTailLooksRepeatedOldContent(widePrefix, wideTail)) {
      return {
        idx: wideIdx,
        ruleId: 'quoted_reply_dedupe_fallback',
        note: 'Detected a repeated inline/flattened quoted reply block and kept only the latest message before it.'
      };
    }
  }

  return null;
}

// ─── SecureView FORWARDED INTRO DETECTION ───────────────────────────────────

function analyzeSecureViewForwardedIntro(text) {
  var normalized = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  var fromIdx = normalized.search(/(?:^|\n)From\s*:/i);
  if (fromIdx <= 0) {
    return {
      raw: normalized,
      cleaned: normalized,
      removals: [],
      rules: []
    };
  }
  var prefix = normalized.slice(0, fromIdx).trim();
  if (!prefix || !/@[\w.+-]*secureview\.com\b/i.test(prefix)) {
    return {
      raw: normalized,
      cleaned: normalized,
      removals: [],
      rules: []
    };
  }
  return {
    raw: normalized,
    cleaned: normalized.slice(fromIdx).replace(/^\n+/, '').trim(),
    removals: [{
      start: 0,
      end: fromIdx,
      text: normalized.slice(0, fromIdx),
      ruleId: 'secureview_forwarded_intro',
      note: 'Removed the SecureView employee forwarding intro and used the forwarded thread starting at From:.'
    }],
    rules: [{
      ruleId: 'secureview_forwarded_intro',
      note: 'Top-of-email SecureView forwarding intro detected; pipeline input starts from the first From: block.'
    }]
  };
}

// ─── LEADING EXTERNAL BANNER DETECTION ───────────────────────────────────

function stripLeadingExternalBanner(text) {
  var normalized = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!normalized) return { cleaned: normalized, rule: null };
  var lines = normalized.split('\n');
  var idx = 0;
  var removedAny = false;
  function isBannerLine(line) {
    var trimmed = String(line || '').trim();
    if (!trimmed) return false;
    return /^(?:NONCONFIDENTIAL\s*\/\/\s*EXTERNAL|PLEASE NOTE:\s*This email is not from|NOTICE:\s*This email originated from outside|CAUTION:\s*This (?:e-?mail|email) originated from outside|\[EXTERNAL(?:\s+SENDER)?[^\]]*\])/i.test(trimmed);
  }
  while (idx < lines.length) {
    if (isBannerLine(lines[idx])) {
      removedAny = true;
      idx += 1;
      while (idx < lines.length && !String(lines[idx] || '').trim()) idx += 1;
      continue;
    }
    break;
  }
  if (!removedAny) return { cleaned: normalized, rule: null };
  var cleaned = lines.slice(idx).join('\n').trim();
  var bodyCandidate = cleaned.split(/\nFrom\s*:/i)[0].trim();
  if (!cleaned || !footerHasMeaningfulLatestReplyContent(bodyCandidate || cleaned)) {
    return { cleaned: normalized, rule: null };
  }
  return {
    cleaned: cleaned,
    rule: {
      ruleId: 'leading_external_banner',
      note: 'Removed a leading external/confidentiality banner so the latest message body remains intact.'
    }
  };
}

// ─── INLINE CONTACT TAIL START DETECTION ─────────────────────────────────

function findInlineContactTailStart(text, markerIdx) {
  var normalized = String(text || '');
  markerIdx = Number(markerIdx);
  if (!normalized || !isFinite(markerIdx) || markerIdx <= 0) return -1;
  var windowStart = Math.max(0, markerIdx - 260);
  var snippet = normalized.slice(windowStart, markerIdx);
  if (!snippet) return -1;
  var titleKeywords = /\b(?:analyst|manager|director|engineer|specialist|assistant|consultant|coordinator|lead|operations|infrastructure|front desk|administrator|liaison|project manager|program manager|general manager|marketing|support|customer experience|facilities coordinator|office of)\b/i;
  if (!titleKeywords.test(snippet)) return -1;
  var candidateStart = windowStart;
  var boundary = Math.max(snippet.lastIndexOf('\n'), snippet.lastIndexOf('. '), snippet.lastIndexOf('? '), snippet.lastIndexOf('! '), snippet.lastIndexOf(': '));
  if (boundary >= 0) candidateStart = windowStart + boundary + 1;
  var candidateSlice = normalized.slice(candidateStart, markerIdx);
  var nameMatches = Array.from(candidateSlice.matchAll(/[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,3}/g));
  if (!nameMatches.length) return -1;
  for (var i = 0; i < nameMatches.length; i++) {
    var start = candidateStart + nameMatches[i].index;
    var tail = normalized.slice(start, Math.min(normalized.length, markerIdx + 200));
    if (titleKeywords.test(tail)) return start;
  }
  return -1;
}

// ─── EXPOSE ALL FUNCTIONS GLOBALLY ──────────────────────────────────────

// Header & message analysis
window.isHeaderLine = isHeaderLine;
window.isQuotedReplyLine = isQuotedReplyLine;
window.isSignatureLine = isSignatureLine;
window.normalizeMeaningSpan = normalizeMeaningSpan;
window.lineLooksLikeTechnicalContent = lineLooksLikeTechnicalContent;
window.lineLooksLikeActionContent = lineLooksLikeActionContent;
window.stripInlineSignoffTailForAnalysis = stripInlineSignoffTailForAnalysis;
window.splitMeaningfulLineSpans = splitMeaningfulLineSpans;
window.extractMeaningfulSpans = extractMeaningfulSpans;
window.looksLikeRealMessage = looksLikeRealMessage;
window.isMostlyHeader = isMostlyHeader;
window.isMostlySignature = isMostlySignature;
window.preservesEnoughMeaning = preservesEnoughMeaning;
window.buildValidationSnapshot = buildValidationSnapshot;
window.collectValidationFlags = collectValidationFlags;
window.evaluateHighRiskCandidate = evaluateHighRiskCandidate;

// Quoted reply detection
window.findQuotedReplyBoundaryWide = findQuotedReplyBoundaryWide;
window.findObviousQuotedBoundary = findObviousQuotedBoundary;
window.quotedTailLooksRepeatedOldContent = quotedTailLooksRepeatedOldContent;
window.findQuotedReplyDedupCandidate = findQuotedReplyDedupCandidate;

// Other pattern detection
window.analyzeSecureViewForwardedIntro = analyzeSecureViewForwardedIntro;
window.stripLeadingExternalBanner = stripLeadingExternalBanner;
window.findInlineContactTailStart = findInlineContactTailStart;

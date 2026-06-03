/**
 * cleaner-footer-analysis.js — Footer analysis predicates (30+ footer* functions)
 * Analyzes email footers to detect signatures, contact info, and other footer patterns
 * Exposed on global scope: all functions available as window.functionName()
 */

function footerLooksLikeNameLine(line) {
  return /^[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,4}(?:\s+\([^)]+\))?$/.test(String(line || '').trim());
}

function footerLooksLikeSimpleSignatureName(line) {
  var text = String(line || '').trim();
  if (!text || /\s/.test(text)) return false;
  return /^[A-Z][A-Za-z.'-]{1,39}[,.]?$/.test(text);
}

function footerLineIsStandaloneUrl(line) {
  var text = String(line || '').trim();
  return /^(?:https?:\/\/|www\.)\S+$/i.test(text);
}

function footerIsSignoffLine(line) {
  var text = String(line || '').trim();
  if (!text || text.length > 120) return false;
  return /^(?:many thanks|thank you|thanks|best regards|kind regards|warm regards|with regards|regards|sincerely|cheers|cordially|warmly|respectfully|respectfully yours|best),?$/i.test(text)
    || /(?:\/|\||-)\s*(?:best regards|kind regards|regards|many thanks|thank you|thanks|sincerely|cheers|respectfully)\s*$/i.test(text);
}

function footerTailHasRequestSignal(lines) {
  var head = (lines || []).slice(0, 2).join('\n');
  if (!head) return false;
  if (/\b(?:hotline|support hotline|email us|call us|for emergent|for password issues|notify us immediately)\b/i.test(head)) {
    return false;
  }
  return /\?|\b(?:can you|could you|please|help|problem|not working|offline|showing|unable|error|fix)\b/i.test(head);
}

function footerIsGreetingOnly(text) {
  var lines = String(text || '').split('\n').map(function(line) { return line.trim(); }).filter(Boolean);
  if (!lines.length || lines.length > 2) return false;
  var joined = lines.join(' ').trim();
  if (/\b(?:please|can|could|would|need|issue|problem|error|update|confirm|try|reset|help|support|working|incorrect|offline|screen|player|device|license|portal|thread|training)\b/i.test(joined)) {
    return false;
  }
  if (/^(?:dear|hi|hello|greetings)\s+[@'A-Z0-9][^.!?\n]{0,60}[,.]?$/i.test(joined)) {
    return joined.split(/\s+/).length <= 5;
  }
  return /^[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,2}[,.]?$/i.test(joined);
}

function footerIsAcknowledgmentOnly(text) {
  var lines = String(text || '').split('\n').map(function(line) { return line.trim(); }).filter(Boolean);
  if (!lines.length || lines.length > 2) return false;
  var joined = lines.join(' ').replace(/\s+/g, ' ').trim();
  return /^(?:thanks!?|thank you[.!]?|okay[,.]?\s+thanks[.!]?|ok[,.]?\s+thanks[.!]?|sounds good[.!]?|will do[.!]?|great[,.]?\s+thanks[.!]?|great[,.]?\s+thank you[.!]?|okay[.!]?|ok[.!]?|noted[.!]?|understood[.!]?)$/i.test(joined);
}

function footerIsGreetingOrAckOnly(text) {
  var lines = String(text || '').split('\n').map(function(line) { return line.trim(); }).filter(Boolean);
  if (!lines.length || lines.length > 2) return false;
  if (footerIsGreetingOnly(text) || footerIsAcknowledgmentOnly(text)) return true;
  if (lines.length === 2) {
    return (footerIsGreetingOnly(lines[0]) && footerIsAcknowledgmentOnly(lines[1]))
      || (footerIsAcknowledgmentOnly(lines[0]) && footerIsGreetingOnly(lines[1]));
  }
  return false;
}

function footerIsAckPlusSignatureOnly(text) {
  var raw = String(text || '').trim();
  if (!raw) return false;

  var rawLines = raw.replace(/\r\n?/g, '\n').split('\n')
    .map(function(line) { return line.trim(); })
    .filter(Boolean);
  if (!rawLines.length) return false;

  var contentLines = rawLines.filter(function(line) {
    if (/^[_=\-*·•~]{3,}$/.test(line)) return false;
    if (footerIsSignoffLine(line)) return false;
    if (footerLooksLikeNameLine(line)) return false;
    if (/^[\w.+-]+@[\w.-]+\.\w+\s*$/.test(line)) return false;
    if (/^\+?\d[\d\s().-]{6,}\d\s*$/.test(line)) return false;
    if (/^(?:phone|mobile|cell|fax|office|email|e-mail|website|web|tel|m|t|p|w|f|addr|address)\s*:/i.test(line)) return false;
    if (/\b(?:engineer|manager|director|specialist|assistant|consultant|coordinator|analyst|administrator|supervisor|lead|operations|infrastructure|support|sales|marketing|architect|developer|technician)\b/i.test(line)
        && line.length < 120
        && !/[.?!]/.test(line)) return false;
    if (/\b(?:\d{1,4}\s+(?:floor|tower|street|st\.?|avenue|ave\.?|road|rd\.?|suite|ste\.?|bldg|building|drive|dr\.?|lane|ln\.?|court|ct\.?|way|boulevard|blvd\.?))\b/i.test(line)) return false;
    if (/^[A-Z][A-Za-z&.\-\s]*,\s*[A-Z][A-Za-z&.\-\s]*,?\s*[A-Z]{2,}[\d\-\s]*$/.test(line)) return false;
    if (/\b(?:hybrid operations|operations$|support team$|corporate office|headquarters|HQ)\b/i.test(line)) return false;
    return true;
  });

  if (!contentLines.length) return true;

  var contentText = contentLines.join(' ').replace(/\s+/g, ' ').trim();
  if (!contentText) return true;

  var stripped = contentText
    .replace(/^(?:thanks(?:\s*[.!,])?|thank you(?:\s*[.!,])?|many thanks(?:\s*[.!,])?|ok(?:ay)?(?:\s*[.!,])?|noted(?:\s*[.!,])?|understood(?:\s*[.!,])?|sure(?:\s*[.!,])?|got it(?:\s*[.!,])?|will do(?:\s*[.!,])?|sounds good(?:\s*[.!,])?|great(?:\s*[.!,])?)\s*/i, '')
    .replace(/^(?:hi|hello|dear)\s+[@'A-Za-z0-9.\-]+[,.]?\s*/i, '')
    .replace(/^(?:@[\w.+\-]+(?:@[\w.\-]+)?[,.\s]*)+/i, '')
    .replace(/\s+(?:best regards|kind regards|warm regards|with regards|regards|many thanks|thank you|thanks|sincerely|cheers|respectfully)\b[\s\S]*$/i, '')
    .trim();

  if (!stripped) return true;
  if (stripped.length <= 60
      && /^(?:let me (?:check|look|investigate|verify|confirm|review)|i(?:'|')?ll (?:check|look|verify|review|investigate|get back|revert|come back|circle back)|will (?:check|look|verify|get back|revert|come back|circle back|investigate|review)|i(?:'|')?m on it|on it|checking|looking|come back to you|get back to you|revert back|circle back|one moment|give me a moment|noted|understood)\b[\s\S]*$/i.test(stripped)) {
    return true;
  }

  return false;
}

function footerHasMeaningfulBodyContent(text) {
  var normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return false;
  if (footerIsGreetingOrAckOnly(normalized)) return false;
  if (normalized.length >= 80) return true;
  return /\?/.test(normalized)
    || /\b(?:please|can|could|would|will|need|issue|problem|unable|error|fix|confirm|provide|install|update|reply|arrange|discuss|schedule|training|support|renewal|invoice|look into|let me know|available|resolved|working|incorrect|screen|player|license|link)\b/i.test(normalized)
    || /[.!?].+[.!?]/.test(normalized);
}

function footerWouldOvercleanToWeakResidual(originalText, candidateText) {
  var candidate = String(candidateText || '').trim();
  var original = String(originalText || '').trim();
  if (!footerIsGreetingOrAckOnly(candidate)) return false;
  if (!original || original === candidate) return false;
  if (original.length <= candidate.length + 20) return false;
  if (extractMeaningfulSpans(original).length) return true;
  return footerHasMeaningfulBodyBeyondGreeting(original);
}

function footerHasMeaningfulBodyBeyondGreeting(text) {
  var lines = String(text || '').split('\n').map(function(line) { return line.trim(); }).filter(Boolean);
  if (lines.length < 2) return false;
  var tailLines = lines.slice(1);
  var tail = tailLines.join(' ').replace(/\s+/g, ' ').trim();
  if (tail.length < 25) return false;
  var bodyLikeLines = tailLines.filter(function(line) {
    var text = String(line || '').trim();
    if (!text) return false;
    if (footerIsSignoffLine(text) || footerLooksLikeNameLine(text)) return false;
    if (/[\w.+-]+@[\w.-]+\.\w+/.test(text)) return false;
    if (/\+?\d[\d\s().-]{6,}\d/.test(text)) return false;
    if (/\b(?:phone|mobile|cell|fax|office|email|website|web)\b\s*:?/i.test(text)) return false;
    return true;
  });
  if (!bodyLikeLines.length) return false;
  var bodyLikeText = bodyLikeLines.join(' ').replace(/\s+/g, ' ').trim();
  return /[.!?]/.test(bodyLikeText)
    || bodyLikeText.length >= 60
    || /\b(?:please|help|issue|problem|unable|find|information|document|shared|images|support|appreciated|regarding|custom map|confirm|availability|meeting|question|reply|updated|provide|install|screen|player|offline|display|ticket|look)\b/i.test(bodyLikeText);
}

function footerWouldOvercleanToGreeting(originalText, candidateText) {
  return footerIsGreetingOnly(candidateText) && footerHasMeaningfulBodyBeyondGreeting(originalText);
}

function footerLooksLikeBodyLine(line) {
  var text = String(line || '').trim();
  if (!text) return false;
  if (footerLineIsStandaloneUrl(text)) return true;
  if (/^\d+\.\s+/.test(text)) return true;
  if (text.length >= 80) return true;
  return /[.!?]/.test(text)
    && /\b(?:please|can|could|would|will|need|added|provide|confirm|look|help|update|question|issue|arrange|discuss|reply|renewal|invoice|template|availability|meeting)\b/i.test(text);
}

function footerIsSignoffWithNameLine(line) {
  var text = String(line || '').trim();
  if (!text || text.length > 120) return false;
  return /^(?:many thanks|thank you|thanks|best regards|kind regards|warm regards|with regards|regards|sincerely|cheers|cordially|warmly|respectfully|respectfully yours|best),?\s+[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,2}$/i.test(text);
}

function footerIsMobileDeviceSignature(line) {
  var text = String(line || '').trim();
  return /^(?:sent from my [^\n]{0,120}?|get outlook for (?:ios|android))(?:\s+get outlook for (?:ios|android))?\.?$/i.test(text)
    || /^sent from my [^\n]{0,120}?\s+get outlook for (?:ios|android)\.?$/i.test(text);
}

function footerHasMeaningfulLatestReplyContent(text) {
  var normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized || normalized.length < 20) return false;
  if (footerIsGreetingOnly(normalized)) return false;
  if (/^(?:importance|nonconfidential|please note:|caution:|this message is from|you don't often get email)/i.test(normalized)) return false;
  if (/^(?:#\d+\b|sent from my\b|get outlook for (?:ios|android)\b)/i.test(normalized)) return false;
  if ((normalized.match(/\b(?:Sent|To|Cc|Subject)\s*:/g) || []).length >= 2) return false;
  if (/\b(?:please|can|could|would|need|issue|resolved|thank|advise|confirm|let me know|help|attached|screen|player|offline|link|training|schedule|thread|support|error|updated|fixed)\b/i.test(normalized)) {
    return true;
  }
  return /[.!?]/.test(normalized) || normalized.length >= 80;
}

function footerHasMeaningfulPrefixBeforeForward(prefix) {
  var normalized = String(prefix || '').replace(/\s+/g, ' ').trim();
  if (!normalized || normalized.length < 20) return false;
  return /[.!?]/.test(normalized)
    || /\b(?:please|can|could|would|need|issue|resolved|thank|advise|confirm|let me know|help|attached|screen|player|offline|link|training|schedule|thread|support|error|updated|fixed)\b/i.test(normalized);
}

function footerWouldDropCurrentMessagePrefix(prefix, candidateCleaned) {
  return footerHasMeaningfulPrefixBeforeForward(prefix) && !footerHasMeaningfulLatestReplyContent(candidateCleaned);
}

function footerTailLooksLikeContactOnly(lines, startIdx) {
  var tailLines = (lines || []).slice(startIdx).map(function(line) { return String(line || '').trim(); }).filter(Boolean);
  if (!tailLines.length || tailLines.length > 4) return false;
  if (tailLines.some(function(line) { return footerLooksLikeBodyLine(line); })) return false;
  return tailLines.every(function(line) {
    return footerLooksLikeNameLine(line)
      || /[\w.+-]+@[\w.-]+\.\w+/.test(line)
      || /\+?\d[\d\s().-]{6,}\d/.test(line)
      || /\b(?:phone|mobile|cell|fax|office|tel|p|email|website|web|ext|extension)\b\s*:?/i.test(line)
      || /\b(?:street|st\.?|road|rd\.?|avenue|ave\.?|boulevard|blvd|suite|ste|drive|dr\.?|lane|ln\.?|court|ct\.?|way|plaza|floor|building|bldg|zip|zipcode|postal code)\b/i.test(line)
      || /\b\d{5}(?:-\d{4})?\b/.test(line);
  });
}

function footerTailLooksLikeShortContactOnly(lines, startIdx) {
  var tailLines = (lines || []).slice(startIdx).map(function(line) { return String(line || '').trim(); }).filter(Boolean);
  if (!tailLines.length || tailLines.length > 2) return false;
  return footerTailLooksLikeContactOnly(lines, startIdx);
}

function footerTailHasStrongContactSignal(lines, startIdx) {
  var tailLines = (lines || []).slice(startIdx).map(function(line) { return String(line || '').trim(); }).filter(Boolean);
  if (!tailLines.length) return false;
  return tailLines.some(function(line) {
    return /[\w.+-]+@[\w.-]+\.\w+/.test(line)
      || /\+?\d[\d\s().-]{6,}\d/.test(line)
      || /\b(?:phone|mobile|cell|fax|office|tel|p|email|website|web|ext|extension|hotline)\b\s*:?/i.test(line)
      || /\b(?:street|st\.?|road|rd\.?|avenue|ave\.?|boulevard|blvd|suite|ste|drive|dr\.?|lane|ln\.?|court|ct\.?|way|plaza|floor|building|bldg|zip|zipcode|postal code)\b/i.test(line)
      || /\b\d{5}(?:-\d{4})?\b/.test(line);
  });
}

function footerTailHasQuotedReplySignal(lines, startIdx) {
  var tailLines = (lines || []).slice(startIdx).map(function(line) { return String(line || '').trim(); }).filter(Boolean);
  if (!tailLines.length) return false;
  return tailLines.some(function(line) {
    return /^(?:On\s.+wrote:|From|Sent|To|Cc|Subject)\b/i.test(line);
  });
}

function footerTailStartsWithNameBeforeQuotedBoundary(lines, startIdx) {
  var tailLines = (lines || []).slice(startIdx).map(function(line) { return String(line || '').trim(); }).filter(Boolean);
  if (tailLines.length < 2) return false;
  return (footerLooksLikeNameLine(tailLines[0]) || footerLooksLikeSimpleSignatureName(tailLines[0]))
    && /^(?:On\s.+wrote:|From|Sent|To|Cc|Subject)\b/i.test(tailLines[1]);
}

function footerTailScore(lines, startIdx) {
  var tailLines = lines.slice(startIdx).map(function(line) { return String(line || '').trim(); }).filter(Boolean);
  if (!tailLines.length) return -999;
  var text = tailLines.join('\n');
  var score = 0;

  if (tailLines.length <= 6) score += 1;
  if (text.length <= 320) score += 1;
  if (footerIsSignoffLine(tailLines[0])) score += 2;
  if (tailLines.some(function(line) { return /[\w.+-]+@[\w.-]+\.\w+/.test(line); })) score += 2;
  if (tailLines.some(function(line) { return /\+?\d[\d\s().-]{6,}\d/.test(line) || /\b(?:phone|mobile|cell|fax|office|tel|p)\b\s*:?/i.test(line); })) score += 2;
  if (tailLines.some(function(line) { return /\b(?:website|web)\b\s*:?/i.test(line); })) score += 1;
  if (tailLines.some(function(line) { return /\b(?:street|st\.?|road|rd\.?|avenue|ave\.?|boulevard|blvd|suite|ste|bldg|building|floor|way|drive|dr\.?|lane|ln\.?|court|ct\.?|plaza|po box|zip|zipcode|postal code|united states|spain|mexico|minneapolis|midland)\b/i.test(line) || (/\b\d{5}(?:-\d{4})?\b/.test(line) && !/\b\d{5}-[A-Z]/.test(line)); })) score += 2;
  if (tailLines.some(function(line) { return /\b(?:manager|director|engineer|specialist|assistant|consultant|coordinator|lead|operations|support|sales|technology|business|administrative|front desk|hybrid operations|team lead|product)\b/i.test(line); })) score += 1;
  if (tailLines.some(function(line) { return /\b(?:inc|llc|ltd|corp|corporation|company|americas|operations|center|centre)\b/i.test(line); })) score += 1;
  if (tailLines.some(function(line) { return footerLooksLikeNameLine(line); })) score += 1;
  if (/[|_]{3,}/.test(text)) score += 1;
  if (footerTailHasRequestSignal(tailLines)) score -= 1;
  var tailHasQuestion = tailLines.some(function(line) { return /\?/.test(line); });
  if (tailHasQuestion) score -= 2;

  return score;
}

// Expose all footer analysis functions globally
window.footerLooksLikeNameLine = footerLooksLikeNameLine;
window.footerLooksLikeSimpleSignatureName = footerLooksLikeSimpleSignatureName;
window.footerLineIsStandaloneUrl = footerLineIsStandaloneUrl;
window.footerIsSignoffLine = footerIsSignoffLine;
window.footerTailHasRequestSignal = footerTailHasRequestSignal;
window.footerIsGreetingOnly = footerIsGreetingOnly;
window.footerIsAcknowledgmentOnly = footerIsAcknowledgmentOnly;
window.footerIsGreetingOrAckOnly = footerIsGreetingOrAckOnly;
window.footerIsAckPlusSignatureOnly = footerIsAckPlusSignatureOnly;
window.footerHasMeaningfulBodyContent = footerHasMeaningfulBodyContent;
window.footerWouldOvercleanToWeakResidual = footerWouldOvercleanToWeakResidual;
window.footerHasMeaningfulBodyBeyondGreeting = footerHasMeaningfulBodyBeyondGreeting;
window.footerWouldOvercleanToGreeting = footerWouldOvercleanToGreeting;
window.footerLooksLikeBodyLine = footerLooksLikeBodyLine;
window.footerIsSignoffWithNameLine = footerIsSignoffWithNameLine;
window.footerIsMobileDeviceSignature = footerIsMobileDeviceSignature;
window.footerHasMeaningfulLatestReplyContent = footerHasMeaningfulLatestReplyContent;
window.footerHasMeaningfulPrefixBeforeForward = footerHasMeaningfulPrefixBeforeForward;
window.footerWouldDropCurrentMessagePrefix = footerWouldDropCurrentMessagePrefix;
window.footerTailLooksLikeContactOnly = footerTailLooksLikeContactOnly;
window.footerTailLooksLikeShortContactOnly = footerTailLooksLikeShortContactOnly;
window.footerTailHasStrongContactSignal = footerTailHasStrongContactSignal;
window.footerTailHasQuotedReplySignal = footerTailHasQuotedReplySignal;
window.footerTailStartsWithNameBeforeQuotedBoundary = footerTailStartsWithNameBeforeQuotedBoundary;
window.footerTailScore = footerTailScore;

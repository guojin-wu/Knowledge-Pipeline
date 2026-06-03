/**
 * cleaner-boundary-detect.js — Boundary detection and contact tail functions
 * Handles finding quoted reply boundaries and analyzing contact sections
 * Exposed on global scope: all functions available as window.functionName()
 */

function findQuotedReplyBoundary(text) {
  var normalized = String(text || '');
  if (!normalized) return -1;
  var match = normalized.match(/(?:^|\n)(On\s.+wrote:)/i);
  if (!match || typeof match.index !== 'number') return -1;
  var idx = match.index + (match[0].startsWith('\n') ? 1 : 0);
  var prefix = normalized.slice(0, idx).trim();
  if (!prefix) return -1;
  if (prefix.length < 40 && !/[.!?]/.test(prefix)) return -1;
  return idx;
}

function quotedPrefixLooksMeaningful(prefixText) {
  var prefix = String(prefixText || '').trim();
  if (!prefix) return false;
  return footerHasMeaningfulLatestReplyContent(prefix) || looksLikeRealMessage(prefix);
}

function findMobileSignatureQuotedBoundary(text) {
  var normalized = String(text || '');
  if (!normalized) return -1;
  var lines = normalized.split('\n');
  var offsets = [];
  var offset = 0;
  for (var i = 0; i < lines.length; i++) {
    offsets.push(offset);
    offset += lines[i].length + 1;
  }

  function isMobileSignatureLine(line) {
    var value = String(line || '').trim().replace(/^[>\-\*\u2022]+\s*/, '');
    return /^(?:sent from my [^\n]{0,120}?|get outlook for (?:ios|android))(?:\s+get outlook for (?:ios|android))?\.?$/i.test(value)
      || /^sent from my [^\n]{0,120}?\s+get outlook for (?:ios|android)\.?$/i.test(value);
  }

  function isOnWroteBoundaryLine(line) {
    var value = String(line || '').trim().replace(/^[>\-\*\u2022]+\s*/, '');
    return /^On\s.+\bwrote:\s*$/i.test(value);
  }

  for (var idx = 0; idx < lines.length; idx++) {
    if (!isMobileSignatureLine(lines[idx])) continue;
    var next = idx + 1;
    var step = 0;
    while (next < lines.length && step < 5) {
      var candidate = String(lines[next] || '').trim();
      if (!candidate) {
        next += 1;
        step += 1;
        continue;
      }
      if (isOnWroteBoundaryLine(candidate)) {
        var boundary = offsets[idx];
        var prefix = normalized.slice(0, boundary).trim();
        if (quotedPrefixLooksMeaningful(prefix)) return boundary;
        break;
      }
      if (!isMobileSignatureLine(candidate)) break;
      next += 1;
      step += 1;
    }
  }
  return -1;
}

function footerStructuredListRunLength(lines) {
  var list = (lines || []).map(function(line) { return String(line || '').trim(); });
  var best = 0;
  var current = 0;
  function looksStructured(line) {
    if (!line) return false;
    var numbered = /^\d+\.\s*/.test(line);
    var macLike = /\b(?:[0-9A-F]{2}:){5}[0-9A-F]{2}\b/i.test(line);
    var codeLike = /\b(?:LAN\s*ID|SHORTCODE|MAC|SERIAL|PLAYER\s*ID|DEVICE\s*ID|HARDWARE\s*ID)\b/i.test(line);
    var repeatedDelimiters = (line.match(/\s[-|:]\s/g) || []).length >= 2;
    return (numbered && (macLike || codeLike || repeatedDelimiters)) || macLike || codeLike;
  }
  for (var i = 0; i < list.length; i++) {
    if (looksStructured(list[i])) {
      current += 1;
      if (current > best) best = current;
    } else {
      current = 0;
    }
  }
  return best;
}

function footerLineLooksProtectedStructured(line) {
  var text = String(line || '').trim();
  if (!text) return false;
  var numbered = /^\d+\.\s*/.test(text);
  var macLike = /\b(?:[0-9A-F]{2}[-:]){5}[0-9A-F]{2}\b/i.test(text);
  var codeLike = /\b(?:LAN\s*ID|SHORTCODE|MAC|SERIAL|PLAYER\s*ID|DEVICE\s*ID|HARDWARE\s*ID)\b/i.test(text);
  var repeatedDelimiters = (text.match(/\s[-|:]\s/g) || []).length >= 2;
  return (numbered && (macLike || codeLike || repeatedDelimiters)) || macLike || codeLike;
}

function footerTailContainsProtectedStructuredLines(lines, startIdx) {
  return (lines || []).slice(startIdx).some(footerLineLooksProtectedStructured);
}

function footerLineLooksLikeTechnicalKeyValue(line) {
  var text = String(line || '').trim();
  if (!text) return false;
  var m = text.match(/^([A-Z][A-Za-z][A-Za-z /()-]{1,40})\s*:\s*(.+)$/);
  if (!m) return false;
  var value = m[2].trim();
  if (!value) return false;
  var hasTechSignal = /\b0x[0-9A-Fa-f]+\b/.test(value)
    || /[A-Za-z]:\\/.test(value)
    || /\.(?:exe|dll|sys|ocx|log|bat|ini|cfg)\b/i.test(value)
    || /\b[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\b/.test(value)
    || /\b\d+\.\d+\.\d+(?:\.\d+)?\b/.test(value);
  return hasTechSignal;
}

function footerTechnicalKeyValueRunLength(lines) {
  var list = (lines || []).map(function(line) { return String(line || '').trim(); });
  var best = 0;
  var current = 0;
  for (var i = 0; i < list.length; i++) {
    if (footerLineLooksLikeTechnicalKeyValue(list[i])) {
      current += 1;
      if (current > best) best = current;
    } else if (list[i] === '') {
      continue;
    } else {
      current = 0;
    }
  }
  return best;
}

function footerTailContainsProtectedTechnicalKeyValueBlock(lines, startIdx) {
  return footerTechnicalKeyValueRunLength((lines || []).slice(startIdx)) >= 2;
}

/* Inline signoff cut: detect a sign-off word followed on the same line or blob by
 * clear signature noise (name + 2+ strong contact signals). Returns the cleaned prefix
 * or null. Conservative — requires two signals. */
function stripInlineSignoffContactTail(text) {
  if (!text) return null;
  var re = /(^|[^A-Za-z])((?:Thank you so much|Thank you|Best regards|Kind regards|Warm regards|Thanks|Regards|Sincerely|Cheers|Cordially|Best(?=\s*[,!.\n])))\b[!,.:]*/gi;
  var m;
  while ((m = re.exec(text)) !== null) {
    var afterSignoff = m.index + m[0].length;
    var tail = text.slice(afterSignoff).replace(/^[\s\u00A0]+/, '');
    if (!tail) continue;
    var windowText = tail.slice(0, 450);
    var firstSentence = windowText.split(/[.!?\n]/)[0] || '';
    if (/\?/.test(windowText.slice(0, 200))) continue;
    if (/^(?:can|could|can you|could you|would|will|shall|should|please|let me|try|reset|install|send|provide|help|forward|contact|tell|here'?s|here is|there is|see|check|i\b|we\b|you\b|they\b|he\b|she\b|it\b|for|so much|a lot|again)\b/i.test(firstSentence.trim())) continue;
    var hasEmail   = /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/.test(windowText);
    var hasPhone   = /(?:\+?\d[\d\s().-]{7,}\d)/.test(windowText);
    var hasZip     = /\b\d{5}(?:-\d{4})?\b/.test(windowText);
    var hasAddress = /\b(?:street|st\.?|road|rd\.?|avenue|ave\.?|boulevard|blvd|suite|ste|drive|dr\.?|lane|ln\.?|court|ct\.?|way|plaza|floor|building|bldg)\b/i.test(windowText);
    var hasCompany = /\b(?:LLC|LLP|Inc\.?|Corp\.?|Corporation|Ltd\.?|GmbH|Company|Pvt|PMS)\b/.test(windowText);
    var hasTitle   = /\b(?:Manager|Director|Engineer|Specialist|Assistant|Consultant|Coordinator|Lead|Operations|Support|Sales|CEO|CTO|CFO|VP|President|Designer|Architect|Analyst|Officer)\b/.test(windowText);
    var signals = [hasEmail, hasPhone, hasZip, hasAddress, hasCompany, hasTitle].filter(Boolean).length;
    if (signals < 2) continue;
    // Keep the signoff phrase itself (e.g. "Thank you,"), only remove name/contact after it
    var before = text.slice(0, afterSignoff).replace(/[\s\u00A0]+$/, '');
    if (before.length < 20) continue;
    return before;
  }
  return null;
}

function footerLineHasEmail(line) {
  var text = String(line || '').trim();
  return /[\w.+-]+@[\w.-]+\.\w+/.test(text) && !/https?:\/\/|www\./i.test(text);
}

function footerLineLooksLikeContactInfo(line) {
  var text = String(line || '').trim();
  if (!text) return false;
  return /\+?\d[\d\s().-]{6,}\d/.test(text)
    || /\b(?:phone|mobile|cell|fax|office|tel|ext|extension)\b\s*:?/i.test(text)
    || /\b(?:street|st\.?|road|rd\.?|avenue|ave\.?|boulevard|blvd|suite|ste|drive|dr\.?|lane|ln\.?|court|ct\.?|way|plaza|floor|building|bldg|zip|zipcode|postal code)\b/i.test(text)
    || /\b\d{5}(?:-\d{4})?\b/.test(text)
    || (
      /\b(?:manager|director|engineer|specialist|assistant|consultant|coordinator|lead|operations|support|sales|technology|business|administrative|front desk|company|corp|corporation|llc|ltd|inc)\b/i.test(text)
      && text.length <= 100
      && !/[.!?]/.test(text)
      && !lineLooksLikeActionContent(text)
    )
    || /\b(?:website|web)\b\s*:?/i.test(text);
}

function footerTextContainsProtectedEmailMicroBlock(text) {
  var lines = String(text || '').split('\n').map(function(line) { return String(line || '').trim(); }).filter(Boolean);
  if (!lines.length) return false;
  for (var i = 0; i < lines.length; i++) {
    if (!footerLineHasEmail(lines[i])) continue;
    var start = Math.max(0, i - 2);
    var end = Math.min(lines.length, i + 3);
    var block = lines.slice(start, end);
    var localIdx = i - start;
    var emailLine = block[localIdx] || '';
    if (block.some(function(line) { return /^(?:On\s.+wrote:|From|Sent|To|Cc|Subject)\b/i.test(line); })) {
      continue;
    }
    var otherLines = block.filter(function(_, idx) { return idx !== localIdx; });
    var sameLineBodySignal = /\b(?:please|add|forward|send|contact|reach|email|invite|cc|loop in|thread|following email|following user|include)\b/i.test(emailLine)
      || /[.!?]/.test(emailLine.replace(/[\w.+-]+@[\w.-]+\.\w+/g, '').trim())
      || emailLine.replace(/[\w.+-]+@[\w.-]+\.\w+/g, '').trim().length >= 20;
    var adjacentBodySignal = otherLines.some(function(line) {
      return /\b(?:please|add|forward|send|contact|reach|email|invite|cc|loop in|thread|following email|following user|include)\b/i.test(line)
        || footerLooksLikeBodyLine(line)
        || line.length >= 20;
    });
    var nameEmailOnly = otherLines.length <= 1 && otherLines.some(footerLooksLikeNameLine);
    var footerSignals = otherLines.filter(footerLineLooksLikeContactInfo).length;
    if (nameEmailOnly || footerSignals >= 1) continue;
    if (sameLineBodySignal || adjacentBodySignal || otherLines.length) return true;
  }
  return false;
}

function footerTailContainsProtectedEmailMicroBlock(lines, startIdx) {
  return footerTextContainsProtectedEmailMicroBlock((lines || []).slice(startIdx).join('\n'));
}

/**
 * Detect a protected email-header triplet block.
 * Rule: protect when we see either:
 *   1) From + Sent + To (in order), or
 *   2) Sent + To + Subject (in order)
 * If From exists in the matched chain, protect from From:
 * Otherwise protect from Sent:
 */
function findProtectedForwardHeaderStart(text) {
  var raw = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!raw) return null;

  function normalizeForwardHeaderKey(key) {
    var k = String(key || '').toLowerCase();
    if (k === 'from' || k === 'fra') return 'from';
    if (k === 'sent' || k === 'sendt' || k === 'date') return 'sent';
    if (k === 'to' || k === 'til') return 'to';
    if (k === 'subject' || k === 'emne') return 'subject';
    return '';
  }

  var inlineFromSentTo = /\b(?:From|Fra)\s*:\s*[^\n]{1,500}?\b(?:Sent|Sendt|Date)\s*:\s*[^\n]{1,500}?\b(?:To|Til)\s*:\s*/i.exec(raw);
  if (inlineFromSentTo && typeof inlineFromSentTo.index === 'number') {
    return { start: inlineFromSentTo.index, reason: 'from_sent_to_inline' };
  }
  var inlineSentToSubject = /\b(?:Sent|Sendt|Date)\s*:\s*[^\n]{1,500}?\b(?:To|Til)\s*:\s*[^\n]{1,500}?\b(?:Subject|Emne)\s*:\s*/i.exec(raw);
  if (inlineSentToSubject && typeof inlineSentToSubject.index === 'number') {
    return { start: inlineSentToSubject.index, reason: 'sent_to_subject_inline' };
  }

  var lines = raw.split('\n');
  var headerLines = [];
  var charPos = 0;

  for (var i = 0; i < lines.length; i++) {
    var line = String(lines[i] || '');
    var m = line.match(/^\s*(From|Fra|Sent|Sendt|Date|To|Til|Subject|Emne)\s*:/i);
    if (m) {
      var normalizedKey = normalizeForwardHeaderKey(m[1]);
      if (!normalizedKey) {
        charPos += line.length + 1;
        continue;
      }
      headerLines.push({
        key: normalizedKey,
        lineIndex: i,
        charIndex: charPos
      });
    }
    charPos += line.length + 1;
  }

  if (headerLines.length < 3) return null;

  function findOrdered(keys) {
    var pos = -1;
    var picked = [];
    for (var k = 0; k < keys.length; k++) {
      var want = keys[k];
      var found = null;
      for (var h = 0; h < headerLines.length; h++) {
        var item = headerLines[h];
        if (item.key !== want) continue;
        if (item.lineIndex <= pos) continue;
        found = item;
        break;
      }
      if (!found) return null;
      picked.push(found);
      pos = found.lineIndex;
    }
    if (picked[picked.length - 1].lineIndex - picked[0].lineIndex > 12) return null;
    return picked;
  }

  var fromSentTo = findOrdered(['from', 'sent', 'to']);
  if (fromSentTo) {
    return { start: fromSentTo[0].charIndex, reason: 'from_sent_to' };
  }

  var sentToSubject = findOrdered(['sent', 'to', 'subject']);
  if (sentToSubject) {
    return { start: sentToSubject[0].charIndex, reason: 'sent_to_subject' };
  }

  function looksLikeHeaderLabel(label) {
    var t = String(label || '').trim();
    if (!t || t.length > 28) return false;
    if (/[.!?]/.test(t)) return false;
    if (/^\d+$/.test(t)) return false;
    var words = t.split(/\s+/).filter(Boolean);
    if (!words.length || words.length > 4) return false;
    return true;
  }
  function parseHeaderLikeLine(line) {
    var m = String(line || '').match(/^\s*([^:\n]{1,40})\s*:\s*(.+?)\s*$/);
    if (!m) return null;
    var label = String(m[1] || '').trim();
    var value = String(m[2] || '').trim();
    if (!looksLikeHeaderLabel(label)) return null;
    if (!value || value.length > 500) return null;
    return { label: label.toLowerCase(), value: value };
  }
  var parsed = lines.map(function(line) { return parseHeaderLikeLine(line); });
  for (var s = 0; s < parsed.length; s++) {
    if (!parsed[s]) continue;
    var found = 0;
    var distinct = {};
    for (var e = s; e < Math.min(parsed.length, s + 8); e++) {
      if (!parsed[e]) continue;
      found += 1;
      distinct[parsed[e].label] = true;
      if (found >= 3 && Object.keys(distinct).length >= 3) {
        var charPos2 = 0;
        for (var li = 0; li < s; li++) charPos2 += String(lines[li] || '').length + 1;
        return { start: charPos2, reason: 'generic_header_cluster' };
      }
    }
  }

  return null;
}

// Expose all boundary detection functions globally
window.findQuotedReplyBoundary = findQuotedReplyBoundary;
window.quotedPrefixLooksMeaningful = quotedPrefixLooksMeaningful;
window.findMobileSignatureQuotedBoundary = findMobileSignatureQuotedBoundary;
window.footerStructuredListRunLength = footerStructuredListRunLength;
window.footerLineLooksProtectedStructured = footerLineLooksProtectedStructured;
window.footerTailContainsProtectedStructuredLines = footerTailContainsProtectedStructuredLines;
window.footerLineLooksLikeTechnicalKeyValue = footerLineLooksLikeTechnicalKeyValue;
window.footerTechnicalKeyValueRunLength = footerTechnicalKeyValueRunLength;
window.footerTailContainsProtectedTechnicalKeyValueBlock = footerTailContainsProtectedTechnicalKeyValueBlock;
window.stripInlineSignoffContactTail = stripInlineSignoffContactTail;
window.footerLineHasEmail = footerLineHasEmail;
window.footerLineLooksLikeContactInfo = footerLineLooksLikeContactInfo;
window.footerTextContainsProtectedEmailMicroBlock = footerTextContainsProtectedEmailMicroBlock;
window.footerTailContainsProtectedEmailMicroBlock = footerTailContainsProtectedEmailMicroBlock;
window.findProtectedForwardHeaderStart = findProtectedForwardHeaderStart;

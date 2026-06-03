/**
 * cleaner-header-strip.js — Header stripping and deduplication functions
 * Handles removal of quoted email chains, forwarded headers, and signature deduplication
 * Exposed on global scope: all functions available as window.functionName()
 */

/**
 * Aggressive quoted-chain prefix strip.
 * For messages that are NOT the first message in a ticket thread, the body usually contains
 * the entire previous thread re-quoted. Those previous replies are already preserved as
 * independent entries, so we can safely strip everything from the first quoted header block onward.
 *
 * Returns { cleaned, removed }
 */
function stripQuotedChainPrefix(text) {
  var raw = String(text || '');
  if (!raw) return { cleaned: raw, removed: '' };
  var re = /(?:^|\n|\s{2,})From\s*:\s*[^\n]+?(?:\n|\s{2,})\s*(?:Sent|Date)\s*:\s*[^\n]+?(?:(?:\n|\s{2,})\s*(?:To|Cc|Bcc|Reply-To)\s*:\s*[^\n]+?)*(?:\n|\s{2,})\s*Subject\s*:/i;
  var m = re.exec(raw);

  if (!m) {
    var fromRe = /\bFrom\s*:/ig;
    var fm;
    while ((fm = fromRe.exec(raw)) !== null) {
      var afterFrom = raw.slice(fm.index + fm[0].length, fm.index + fm[0].length + 300);
      var sentMatch = afterFrom.match(/\b(?:Sent|Date)\s*:\s*/i);
      if (!sentMatch) continue;
      var sentValStart = sentMatch.index + sentMatch[0].length;
      var sentVal = afterFrom.slice(sentValStart, sentValStart + 40);
      if (!/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|\d)/i.test(sentVal)) continue;
      var sentEnd = fm.index + fm[0].length + sentMatch.index + sentMatch[0].length;
      var afterSent = raw.slice(sentEnd, sentEnd + 300);
      var toMatch = afterSent.match(/\bTo\s*:/i);
      if (!toMatch) continue;
      var toEnd = sentEnd + toMatch.index + toMatch[0].length;
      var afterTo = raw.slice(toEnd, toEnd + 300);
      var subjMatch = afterTo.match(/\bSubject\s*:/i);
      if (!subjMatch) continue;
      m = { index: fm.index };
      break;
    }
  }

  if (!m) return { cleaned: raw, removed: '' };
  var cutIndex = m.index;
  var cleaned = raw.slice(0, cutIndex).replace(/\s+$/, '');
  var removed = raw.slice(cutIndex);
  return { cleaned: cleaned, removed: removed };
}

/**
 * stripForwardedHeaderBlocks(text)
 * Finds all forwarded-email header blocks and removes ONLY the header lines,
 * preserving the message body that follows each Subject: value.
 * Returns { cleaned, headersFound: number }
 */
function stripForwardedHeaderBlocks(text) {
  var raw = String(text || '');
  if (!raw) return { cleaned: raw, headersFound: 0 };

  var FROM_KW  = '(?:From|Fra|Von)';
  var SENT_KW  = '(?:Sent|Date|Sendt|Gesendet)';
  var TO_KW    = '(?:To|Til|An|Cc|Bcc|Reply-To)';
  var SUBJ_KW  = '(?:Subject|Emne|Ämne|Betreff)';

  var fromRe = new RegExp('\\b' + FROM_KW + '\\s*:', 'ig');
  var ranges = [];
  var fm;

  while ((fm = fromRe.exec(raw)) !== null) {
    var fromStart = fm.index;
    var searchEnd = Math.min(raw.length, fromStart + 900);
    var chunk = raw.slice(fromStart, searchEnd);

    var sentRe = new RegExp('\\b' + SENT_KW + '\\s*:\\s*', 'i');
    var sentM = chunk.match(sentRe);
    if (!sentM || sentM.index > 300) continue;

    var sentValPos = sentM.index + sentM[0].length;
    var sentVal = chunk.slice(sentValPos, sentValPos + 50);
    if (!/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|man|tir|ons|tor|fre|lør|søn|torsdag|fredag|onsdag|tirsdag|mandag|lørdag|søndag|\d)/i.test(sentVal)) continue;

    var afterSentChunk = chunk.slice(sentValPos);
    var toRe = new RegExp('\\b' + TO_KW + '\\s*:', 'i');
    var toM = afterSentChunk.match(toRe);
    if (!toM || toM.index > 300) continue;

    var toPos = sentValPos + toM.index + toM[0].length;
    var afterToChunk = chunk.slice(toPos);
    var subjRe = new RegExp('\\b' + SUBJ_KW + '\\s*:\\s*', 'i');
    var subjM = afterToChunk.match(subjRe);
    if (!subjM || subjM.index > 300) continue;

    var subjValueStart = toPos + subjM.index + subjM[0].length;
    var afterSubj = chunk.slice(subjValueStart);

    var bodyOffset = -1;
    var nlIdx = afterSubj.indexOf('\n');
    if (nlIdx >= 0 && nlIdx < 250) {
      bodyOffset = nlIdx;
      while (bodyOffset < afterSubj.length && /[\n\r\s]/.test(afterSubj[bodyOffset])) bodyOffset++;
    }
    if (bodyOffset < 0) {
      var dsM = afterSubj.match(/^.{3,250}?\s{2,}/);
      if (dsM) {
        bodyOffset = dsM[0].length;
      }
    }
    if (bodyOffset < 0) {
      bodyOffset = Math.min(200, afterSubj.length);
    }

    var headerEnd = fromStart + subjValueStart + bodyOffset;
    ranges.push({ start: fromStart, end: headerEnd });
  }

  if (!ranges.length) return { cleaned: raw, headersFound: 0, sections: null, headers: null };

  var sections = [];
  var headers = [];
  var prevEnd = 0;
  for (var i = 0; i < ranges.length; i++) {
    var sectionText = raw.slice(prevEnd, ranges[i].start).replace(/^\s+|\s+$/g, '');
    sections.push(sectionText);
    headers.push(raw.slice(ranges[i].start, ranges[i].end).replace(/^\s+|\s+$/g, ''));
    prevEnd = ranges[i].end;
  }
  var trailing = raw.slice(prevEnd).replace(/^\s+|\s+$/g, '');
  sections.push(trailing);

  var cleaned = sections.filter(Boolean).join('\n');

  return { cleaned: cleaned, headersFound: ranges.length, sections: sections, headers: headers, ranges: ranges };
}

/**
 * Round 1: Block-level dedup.
 * Finds repeated signature / address / disclaimer blocks and removes 2nd+ occurrences.
 * Normalizes whitespace + punctuation for canonical comparison.
 */
function dedupRepeatedSignatureBlocks(text) {
  var raw = String(text || '');
  if (!raw) return { cleaned: raw, removed: [] };

  function canon(s) {
    return String(s || '').toLowerCase().replace(/[\s\W_]+/g, '');
  }

  var BOUNDARY_LOOKAHEAD =
    '(?=' +
      '(?:\\n\\s*(?:From|Sent|To|Cc|Bcc|Subject)\\s*:)' +
      '|(?:\\n\\s*(?:Regards|Best\\s+regards|Kind\\s+regards|Best|Many\\s+thanks|Thank\\s+you|Thanks|Sincerely|Cheers|Respectfully|Mit\\s+freundlichen)\\b[,\\s])' +
      '|(?:\\n\\s*Confidentiality\\s+Notice\\b)' +
      '|(?:\\n\\s*This\\s+(?:email|message)\\s+(?:and\\s+any\\s+attachments|is\\s+private))' +
      '|$' +
    ')';

  var patterns = [
    {
      name: 'signature_block',
      re: new RegExp(
        '(?:^|\\n|\\s)' +
        '(Regards|Best\\s+regards|Kind\\s+regards|Best|Many\\s+thanks|Thank\\s+you|Thanks|Sincerely|Cheers|Respectfully|Mit\\s+freundlichen(?:\\s+Gr[üu]ßen)?)' +
        '\\s*,[\\s\\S]+?' + BOUNDARY_LOOKAHEAD,
        'gi'
      )
    },
    {
      name: 'disclaimer_block',
      re: new RegExp(
        '(?:^|\\n|\\s)' +
        '(Confidentiality\\s+Notice\\b[\\s\\S]+?|This\\s+(?:email|message)\\s+(?:and\\s+any\\s+attachments|is\\s+private)[\\s\\S]+?)' +
        BOUNDARY_LOOKAHEAD,
        'gi'
      )
    }
  ];

  var occurrencesByCanon = {};
  patterns.forEach(function(p) {
    var m;
    p.re.lastIndex = 0;
    while ((m = p.re.exec(raw)) !== null) {
      var full = m[0];
      var leadTrim = full.match(/^\s*/);
      var start = m.index + (leadTrim ? leadTrim[0].length : 0);
      var end = m.index + full.length;
      var body = raw.slice(start, end).replace(/\s+$/, '');
      end = start + body.length;
      var c = canon(body);
      if (c.length < 30) continue;
      if (!occurrencesByCanon[c]) occurrencesByCanon[c] = [];
      occurrencesByCanon[c].push({
        start: start,
        end: end,
        text: body,
        pattern: p.name,
        canon: c
      });
      if (m.index === p.re.lastIndex) p.re.lastIndex++;
    }
  });

  var toDelete = [];
  Object.keys(occurrencesByCanon).forEach(function(c) {
    var occs = occurrencesByCanon[c];
    if (occs.length < 2) return;
    occs.sort(function(a, b) { return a.start - b.start; });
    for (var i = 1; i < occs.length; i++) toDelete.push(occs[i]);
  });

  if (!toDelete.length) return { cleaned: raw, removed: [] };

  toDelete.sort(function(a, b) { return a.start - b.start; });
  var merged = [];
  toDelete.forEach(function(d) {
    var last = merged[merged.length - 1];
    if (last && d.start <= last.end) {
      last.end = Math.max(last.end, d.end);
      last.patterns = (last.patterns || [last.pattern]).concat(d.pattern);
    } else {
      merged.push({ start: d.start, end: d.end, pattern: d.pattern, patterns: [d.pattern] });
    }
  });

  merged.sort(function(a, b) { return b.start - a.start; });
  var cleaned = raw;
  merged.forEach(function(d) {
    cleaned = cleaned.slice(0, d.start) + cleaned.slice(d.end);
  });

  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trim();

  return { cleaned: cleaned, removed: merged };
}

/**
 * Round 2: Orphan email header cleanup.
 * After Round 1 removes repeated signature/disclaimer blocks, sometimes what remains
 * is an email header block whose body was already deleted. Detect and remove those.
 */
function removeOrphanEmailHeaders(text) {
  var raw = String(text || '');
  if (!raw) return { cleaned: raw, removed: [] };
  if (typeof findProtectedForwardHeaderStart === 'function') {
    var protectedHeader = findProtectedForwardHeaderStart(raw);
    if (protectedHeader && typeof protectedHeader.start === 'number' && protectedHeader.start >= 0) {
      return { cleaned: raw, removed: [] };
    }
  }

  var HEADER_RE = /^\s*(?:From|Sent|To|Cc|Bcc|Subject)\s*:/i;
  var lines = raw.split('\n');
  var removed = [];
  var keep = new Array(lines.length).fill(true);

  var i = 0;
  while (i < lines.length) {
    if (!HEADER_RE.test(lines[i])) { i++; continue; }
    var headerStart = i;
    while (i < lines.length && (HEADER_RE.test(lines[i]) || /^\s*$/.test(lines[i]) === false && /^\s+\S/.test(lines[i]) && i > headerStart)) {
      if (!HEADER_RE.test(lines[i])) break;
      i++;
    }
    var headerEnd = i;

    var bodyStart = headerEnd;
    var bodyEnd = bodyStart;
    while (bodyEnd < lines.length && !HEADER_RE.test(lines[bodyEnd])) {
      bodyEnd++;
    }

    var bodyText = lines.slice(bodyStart, bodyEnd).join('\n');
    if (/^\s*$/.test(bodyText)) {
      for (var k = headerStart; k < headerEnd; k++) keep[k] = false;
      removed.push(lines.slice(headerStart, headerEnd).join('\n'));
    }
    i = bodyEnd;
  }

  if (!removed.length) return { cleaned: raw, removed: [] };
  var cleaned = lines.filter(function(_, idx){ return keep[idx]; }).join('\n');
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trim();
  return { cleaned: cleaned, removed: removed };
}

// Expose all functions globally
window.stripQuotedChainPrefix = stripQuotedChainPrefix;
window.stripForwardedHeaderBlocks = stripForwardedHeaderBlocks;
window.dedupRepeatedSignatureBlocks = dedupRepeatedSignatureBlocks;
window.removeOrphanEmailHeaders = removeOrphanEmailHeaders;

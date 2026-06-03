(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.KB_SHARED_RULES = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const ACTION_WORDS = [
    'install', 're-install', 'update', 'upgrade', 'downgrade',
    'change', 'set', 'reset', 'restart', 'reboot',
    'verify', 'check', 'configure', 'remove', 'add',
    'log in', 'login', 'open', 'go to', 'select', 'choose',
    'click', 'copy', 'paste', 'move', 'download', 'unzip',
    'replace', 'stop', 'start', 'run', 'deploy', 'enable', 'disable',
    'delete', 'clear', 'save', 'launch', 'connect'
  ];

  const INSTRUCTION_RE = /1\.|2\.|step|first|then|next|finally|->|\n/i;
  const UI_PATH_RE = /(tab|menu|setting|field|page|screen|device manager|publisher admin|program data|license file|player settings|display settings|control panel|admin panel)/i;
  const COORDINATION_RE = /\b(we will|we can|let me know|please confirm|please advise|reach out|follow up|keep you posted)\b/i;
  const MANUAL_ACTION_RE = /\b(reset done|updated for you|we fixed|manually changed|fixed for you|fixed it for you|fixed on our end|we reset it|we changed it|we did it|we updated it|we have updated your|i have reset your|i reset your|i updated your|i fixed your|we fixed your|has been reset|has been updated for you|done on our end|taken care of|we went ahead and)\b/i;
  const SUPPORT_REQUEST_RE = /\b(contact support|support contact|how do i contact|how to contact|reach support|contact information|email support|submit (a )?ticket|open (a )?ticket|create (a )?ticket|ticket creation|follow up with support|request support|need support|support request|send (an )?email|email communication)\b/i;
  const GARBAGE_HTML_RE = /<!doctype html>|<html|<body|<form|<input/i;
  const GARBAGE_FORM_RE = /\bfirst name\s*:|\blast name\s*:|\bemail\s*:|\bphone\s*:|\bsubmit\b/i;
  const GARBAGE_SHORT_FIELD_RE = /^(name|email|phone)\s*[:|]/i;
  const CLASSIFICATION_VERSION = '2026-03-19-c';
  const QA_POLICY_VERSION = '2026-03-19-c';
  const QA_HIGH_RISK_TYPES = new Set([
    'technical_support',
    'display_issue',
    'installation_issue',
    'license_activation_issue',
    'software_version_compatibility',
    'account_access_issue',
    'software_update_request'
  ]);
  const QA_MULTI_ISSUE_RE = /\b(both|also|another|second|multiple|two players|two screens|follow-up|previous ticket|previous issue|one screen|other screen|bar-[a-z0-9-]+)\b/i;
  const LOGIN_ACCESS_RE = /\b(login|log\s*in|sign\s*in|password|password reset|credential|activation email|access denied|permission denied|cannot login|can't login|unable to login|cannot sign in|can't sign in|unable to sign in|locked out|grant admin permission|grant permissions|admin permissions|admin access|user access|cannot access|can't access|unable to access|access to (the )?(account|site|portal|cms|content site))\b/i;
  const SOFTWARE_UPDATE_REQUEST_RE = /\b(newest version|latest version|updated version|current version|most updated software|send (me )?(the )?(latest|newest|updated) (software|version|installer|install link)|obtain (the )?(latest|newest) (software|version)|software update request|install link|installer link|apk(s)?|download link)\b/i;
  const SOFTWARE_COMPATIBILITY_RE = /\b(compatible|compatibility|incompatible|version conflict|version mismatch|requires version|required version|supported on|works with|not supported on|older version|old version|upgrade from\s+\S+\s+to\s+\S+|downgrade from\s+\S+\s+to\s+\S+|content manager 2015|framework\s+\d|\.net\s+\d|dataset .* compatible)\b/i;
  const LICENSE_ACTIVATION_RE = /\b(ucode|activation\s*(code|key)|activate|registration\s*(code|key)|register( the software)?|license\s*key|machine\s*id|hardware\s*id|transfer\s*license|license\s*transfer|reset\s*shortcode|short\s*code|registration code|activation email for license|license expired)\b/i;

  const ISSUE_TYPE_RULES = [
    { type: 'screen_flickering', re: /\b(flicker|flickering|flashing|blinking|screen\s*flicker|logo\s*flashing)\b/i },
    { type: 'display_connection_issue', re: /\b(blank screen|black screen|screen connected|display not detected|not recognize[sd]? by windows|monitor not detected|no signal|display connection|hdmi|screen connected)\b/i },
    { type: 'display_configuration_issue', re: /\b(anti[- ]alias|anti alias|portrait screen|orientation|rotate|resolution|player settings|display settings|graphics settings|layout display issue)\b/i },
    { type: 'software_update_request', re: SOFTWARE_UPDATE_REQUEST_RE },
    { type: 'software_version_compatibility', re: SOFTWARE_COMPATIBILITY_RE },
    { type: 'license_activation_issue', re: LICENSE_ACTIVATION_RE },
    { type: 'account_access_issue', re: LOGIN_ACCESS_RE },
    { type: 'remote_access_support', re: /\b(teamviewer|logmein|remote assistance|remote in|remote onto|remote access)\b/i },
    { type: 'content_issue', re: /\b(readerboard|reader board|room sign|event board|playlist|speaker timing|speaker.*session|happening now|session id|event_id|datalist|roomfilter|dataset|content not updating|content issue|publish|publishing|logo change|company name|popup photo list|pop desc|description column)\b/i },
    { type: 'calendar_integration', re: /\b(calendar|exchange\s*calendar|google\s*calendar|ical|ews|calendar\s*feed|event\s*feed|schedule\s*feed|outlook\s*calendar|room\s*calendar|meeting room|room\s*book|event\s*list)\b/i },
    { type: 'api_integration', re: /\b(api|rest\s*api|json\s*feed|xml\s*feed|rss\s*feed|webhook|endpoint|api\s*key|api\s*call|embed\s*code|iframe|api\s*integrat)\b/i },
    { type: 'data_sync_issue', re: /\b(datasync|datasynchroni[sz]|data\s*synchroni[sz]|sync\s*(issue|error|fail|problem|not)|not\s*sync|synchroni[sz]ation|data\s*feed|sync\s*password|publisher\s*version|datasync\s*password)\b/i },
    { type: 'player_offline', re: /\b(player\s*(offline|down|not\s*respond|disconnect|not\s*connect|not\s*running|restart|crash|boots?|booting|fully boots?)|offline\s*player|loop\s*(indefinitely|continuously|forever)|demo\s*version|player\s*mode|player\s*service|player\s*not|player\s*is|player\s*keep|player\s*stop|reboot\s*(kiosk|player|device)|kiosk\s*(offline|down|restart|reboot|not\s*respond)|fails?\s*to\s*boot|rma process)\b/i },
    { type: 'license_issue', re: /\b(license\s*renew|subscription|trial\s*(license|version|period)|license\s*cost|designer license|add .* license|license count|license quantity|license addition|extra license|pp\s*license|publisher\s*pro\s*license)\b/i },
    { type: 'software_crash', re: /\b(crash|error\s*message|exception|not\s*working|freeze|frozen|hang(s|ing)?|stopped\s*working|blue\s*screen|bsod|application\s*error|mailbox\s*full|bug|corrupt|broken\s*file)\b/i },
    { type: 'map_rendering', re: /\b(wayfind|routing|route|elevator pairing|restricted area|artboard|ground\s*layer|floor\s*plan|3[dD]\s*map|building\s*map|interactive\s*map|directory\s*map|kiosk\s*map|map\s*render|map\s*display|map\s*edit|map\s*not|search\s*tool|you\s*are\s*here|pin\s*on\s*map|poi|point\s*of\s*interest|restroom|suite\s*number|tenant|store\s*list|directory\s*search|zone\s*(mask|layer)|mask\s*layer|map\s*layout)\b/i },
    { type: 'installation_issue', re: /\b(install|uninstall|reinstall|deploy|getting\s*started|first\s*time|initial\s*setup|setup\s*wizard|setup\s*guide|replacement\s*nuc|replacement player|install custom fonts)\b/i },
    { type: 'display_issue', re: /\b(display|preview|screen|monitor|showing|not\s*appear|visible|not\s*loading|not\s*display|blank\s*screen|resolution|touch\s*screen|kiosk\s*display|ad\s*space|rotate|orientation|layout\s*display|photo\s*album|slide\s*show|popup|rendering)\b/i },
    { type: 'system_configuration', re: /\b(configur|settings|kiosk tag|devices tab|maintenance tab|user\s*guide|tutorial|profile|preference|manage\s*account|training|back\s*end|backend|panel|server:|webmanager)\b/i },
    { type: 'content_issue', re: /\b(content\s*(update|manage|edit|change|modify|issue|problem)|rss|app\s*switch|upload\s*image|image\s*size|video\s*content|media\s*file|font\s*(size|change|issue)|branding|logo\s*(change|update|add)|custom\s*design|template\s*design)\b/i },
    { type: 'monitoring_issue', re: /\b(monitor(ing)?|chart|graph|dashboard\s*view|coordinates|analytics|report\s*(view|generate)|metric|bar\s*(chart|graph)|data\s*visual)\b/i },
    { type: 'network_issue', re: /\b(network|ip\s*address|static\s*ip|remote\s*access|teamviewer|logmein|vpn|firewall|proxy|port\s*forward|dns|bandwidth|internet\s*connect)\b/i },
    { type: 'hardware_issue', re: /\b(hardware\s*(recommend|issue|problem|spec)|tablet\s*recommend|physical\s*device|touchscreen\s*hardware|tv\s*input|hdmi|usb\s*device|mount|bracket|enclosure|kiosk\s*hardware)\b/i },
    { type: 'map_rendering', re: /\b(map|zone|mask|layout|floor|directory)\b.*\b(edit|update|change|render|show|display|add|remove|fix)/i },
    { type: 'display_issue', re: /\b(screen|display|preview|showing|appear|load|kiosk)\b.*\b(issue|problem|not|error|wrong|blank|black)/i },
    { type: 'system_configuration', re: /\b(setup|config|access|setting|permission|shortcode|kiosk tag)\b/i },
    { type: 'installation_issue', re: /\b(setup|set\s*up|new\s*(install|device|kiosk))\b/i }
  ];

  function compactText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function deriveRecencyMetadata(entry, nowDate) {
    const rawDate = entry && (entry.source_date || entry.created_at || entry.updated_at || entry.posted_at || null);
    const parsed = rawDate ? new Date(rawDate) : null;
    if (!parsed || Number.isNaN(parsed.getTime())) {
      return {
        source_date: rawDate || null,
        content_age_days: null,
        recency_band: 'unknown',
        staleness_risk: 'unknown',
        recency_weight: 0.85
      };
    }

    const now = nowDate instanceof Date ? nowDate : new Date();
    const ageDays = Math.max(0, Math.floor((now.getTime() - parsed.getTime()) / 86400000));
    let recencyBand = 'current';
    let stalenessRisk = 'low';
    let recencyWeight = 1.0;

    if (ageDays > 3650) {
      recencyBand = 'legacy';
      stalenessRisk = 'high';
      recencyWeight = 0.45;
    } else if (ageDays > 2190) {
      recencyBand = 'aging';
      stalenessRisk = 'medium';
      recencyWeight = 0.65;
    } else if (ageDays > 730) {
      recencyBand = 'recent';
      stalenessRisk = 'medium';
      recencyWeight = 0.82;
    }

    return {
      source_date: parsed.toISOString(),
      content_age_days: ageDays,
      recency_band: recencyBand,
      staleness_risk: stalenessRisk,
      recency_weight: recencyWeight
    };
  }

  function classifyIssueType(text) {
    const combined = compactText(text).toLowerCase();
    for (const rule of ISSUE_TYPE_RULES) {
      if (rule.re.test(combined)) return rule.type;
    }
    return 'technical_support';
  }

  function isSupportProcessProblem(problem) {
    const p = compactText(problem).toLowerCase();
    return /\b(process to create a ticket|how do i create a ticket|how to create a ticket|submit a ticket|open a ticket|contact support|how to contact support|how do i contact support|support request)\b/i.test(p);
  }

  function classifyIssueTypeFromEntry(entry) {
    const subject = compactText(entry && entry.source_subject);
    const problem = compactText(entry && entry.problem);
    const solution = compactText(entry && entry.solution);
    const primaryText = `${subject} ${problem}`.trim();
    const primaryType = classifyIssueType(primaryText);
    if (primaryType !== 'technical_support' || isSupportProcessProblem(problem)) return primaryType;
    return classifyIssueType(`${primaryText} ${solution}`.trim());
  }

  function isProblemGarbage(text) {
    const compact = compactText(text);
    if (!compact) return false;
    const lower = compact.toLowerCase();
    if (GARBAGE_HTML_RE.test(compact)) return true;
    if (GARBAGE_FORM_RE.test(compact)) return true;
    if (/^(first name|last name|email|phone|company)\s*:/i.test(compact)) return true;
    if (/<!doctype html>|first name:|last name:|email:/i.test(lower)) return true;
    if (GARBAGE_SHORT_FIELD_RE.test(lower) && compact.length < 120) return true;
    return false;
  }

  function hasActionWord(text) {
    const lower = compactText(text).toLowerCase();
    return ACTION_WORDS.some(w => lower.includes(w));
  }

  function hasInstructionStructure(text) {
    const raw = String(text || '');
    return hasActionWord(raw) || INSTRUCTION_RE.test(raw) || UI_PATH_RE.test(raw);
  }

  function isCoordinationOnly(text) {
    const raw = String(text || '');
    return COORDINATION_RE.test(raw) && !hasInstructionStructure(raw);
  }

  function hasOneTimeLink(text) {
    const lower = compactText(text).toLowerCase();
    const hasUrl = /https?:\/\//.test(lower);
    if (!hasUrl) return false;
    return (
      /\breset\b.{0,40}\blink\b/.test(lower) ||
      /\bpassword\b.{0,40}\breset\b/.test(lower) ||
      /[?&](token|code)=/.test(lower) ||
      /\bone[- ]time\b/.test(lower) ||
      /\bauth(?:orization)?\s*code\b/.test(lower)
    );
  }

  function isManualResolutionOnly(text) {
    const lower = compactText(text).toLowerCase();
    return MANUAL_ACTION_RE.test(lower) && !hasInstructionStructure(lower);
  }

  function isSupportRequestNoise(problem, solution) {
    const p = compactText(problem).toLowerCase();
    const s = compactText(solution).toLowerCase();
    const explicitSupportProcess = isSupportProcessProblem(p);
    if (!SUPPORT_REQUEST_RE.test(p) && !/\b(copying in support|reach(ing)? out to support|please have support|support team)\b/i.test(p) && !explicitSupportProcess) return false;
    if (!s) return true;
    if (hasInstructionStructure(s)) return false;
    if (explicitSupportProcess && !/\b(ticket|support|contact|email us|reach out|portal|submit)\b/i.test(s)) return true;
    if (/\b(error|issue|crash|offline|blank screen|license|activation|api|calendar|network)\b/i.test(s)) return false;
    return true;
  }

  function getQaRisk(entry) {
    const subject = compactText(entry && entry.source_subject);
    const problem = compactText(entry && entry.problem);
    const solution = compactText(entry && entry.solution);
    const issueType = String((entry && entry.issue_type) || classifyIssueTypeFromEntry(entry));
    const combined = `${subject} ${problem} ${solution}`.trim();
    const reasons = [];
    let score = 0;

    const matches = ISSUE_TYPE_RULES.filter(rule => rule.re.test(combined)).map(rule => rule.type);
    const uniqueMatches = [...new Set(matches)];

    if (isSupportProcessProblem(problem)) {
      return {
        run: false,
        score: 0,
        reasons: ['support-process-auto-skip'],
        issueType,
        matchedTypes: uniqueMatches
      };
    }

    if (
      problem.length >= 90 &&
      solution.length >= 120 &&
      hasInstructionStructure(solution) &&
      uniqueMatches.length <= 1 &&
      !QA_HIGH_RISK_TYPES.has(issueType) &&
      !isSupportRequestNoise(problem, solution)
    ) {
      return {
        run: false,
        score: 0,
        reasons: ['stable-direct-solution'],
        issueType,
        matchedTypes: uniqueMatches
      };
    }

    if (QA_HIGH_RISK_TYPES.has(issueType)) {
      score += 2;
      reasons.push(`high-risk-type:${issueType}`);
    }
    if (problem.length < 90) {
      score += 2;
      reasons.push('short-problem');
    }
    if (solution.length < 120) {
      score += 1;
      reasons.push('short-solution');
    }
    if (!hasInstructionStructure(solution)) {
      score += 2;
      reasons.push('no-instruction-structure');
    }
    if (QA_MULTI_ISSUE_RE.test(combined)) {
      score += 2;
      reasons.push('multi-issue-context');
    }
    if (uniqueMatches.length >= 2) {
      score += 3;
      reasons.push(`multi-signal:${uniqueMatches.slice(0, 3).join('|')}`);
    }
    if (isSupportRequestNoise(problem, solution)) {
      if (isSupportProcessProblem(problem)) {
        return {
          run: false,
          score: 0,
          reasons: ['support-process-auto-skip'],
          issueType,
          matchedTypes: uniqueMatches
        };
      }
      score += 3;
      reasons.push('support-request-noise');
    }

    return {
      run: score >= 3,
      score,
      reasons,
      issueType,
      matchedTypes: uniqueMatches
    };
  }

  function shouldRunQa(entry) {
    return getQaRisk(entry).run;
  }

  return {
    CLASSIFICATION_VERSION,
    QA_POLICY_VERSION,
    ACTION_WORDS,
    ISSUE_TYPE_RULES,
    classifyIssueType,
    classifyIssueTypeFromEntry,
    deriveRecencyMetadata,
    compactText,
    isProblemGarbage,
    hasActionWord,
    hasInstructionStructure,
    isCoordinationOnly,
    hasOneTimeLink,
    isManualResolutionOnly,
    isSupportRequestNoise,
    isSupportProcessProblem,
    getQaRisk,
    shouldRunQa
  };
}));

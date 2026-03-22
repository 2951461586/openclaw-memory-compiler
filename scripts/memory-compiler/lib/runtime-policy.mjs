// runtime-policy.mjs — scene inference + injection policy

const PRECISE_INTENT_PATTERNS = [
  /\b(exact|precise|source-first)\b/i,
  /(精确回答|准确回答|精确|准确|回源|源码)/i,
];
const PRECISE_ARTIFACT_PATTERNS = [
  /\b(path|paths|sha|commit|timestamp|stack|stacktrace|root cause|root-cause|config|command|commands|which file|file path|line number|traceback|log line)\b/i,
  /(路径|命令|配置|时间戳|堆栈|报错|根因|哪个文件|哪一行|哪行|日志)/i,
];
const PRECISE_QUESTION_PATTERNS = [
  /[?？]/,
  /\b(which|what|where|why|how)\b/i,
  /(哪个|哪一|哪行|哪一个|到底|为何|为什么|怎么|原因)/i,
];
const PRECISE_REQUEST_PATTERNS = [
  /\b(show|tell|give|locate|find|confirm|verify|answer)\b/i,
  /(回答|给我|告诉我|定位|确认|核实|查一下|找出)/i,
];
const PRECISE_DEBUG_PATTERNS = [
  /\b(traceback|stack|stacktrace|root cause|root-cause|log line|line number|which file)\b/i,
  /(堆栈|报错|根因|哪个文件|哪一行|哪行|日志)/i,
];
const HEARTBEAT_PATTERNS = [
  /\bheartbeat(_ok)?\b/i,
  /HEARTBEAT\.md/i,
  /(心跳|巡检|定时提醒|定时检查|静默回复)/i,
];
const CONTINUATION_PATTERNS = [
  /^(继续|接着|接上|续上|继续推进|继续收口|继续处理|往下做)/i,
  /^(continue|resume|pick up|follow up|carry on)\b/i,
];

export function normalizeSceneHint(hint) {
  const raw = String(hint || '').trim().toLowerCase();
  if (!raw) return null;
  if (['precise', 'query', 'precise-query', 'exact', 'source-first'].includes(raw)) return 'precise';
  if (['session', 'resume', 'handoff', 'continuation', 'continue'].includes(raw)) return 'session';
  if (['heartbeat', 'daily', 'weekly', 'cron', 'maintenance'].includes(raw)) return 'heartbeat';
  if (['task', 'work'].includes(raw)) return 'task';
  if (['chat', 'conversation'].includes(raw)) return 'chat';
  if (['narrative', 'story'].includes(raw)) return 'narrative';
  return raw;
}

function matchedPattern(patterns, text) {
  for (const re of patterns) {
    if (re.test(text)) return re.toString();
  }
  return null;
}

export function inferSceneDetailed({ prompt, hint, currentPack, handoff }) {
  const p = String(prompt || '').trim();
  const hinted = normalizeSceneHint(hint);
  const preciseIntentMatch = matchedPattern(PRECISE_INTENT_PATTERNS, p);
  const preciseArtifactMatch = matchedPattern(PRECISE_ARTIFACT_PATTERNS, p);
  const preciseQuestionMatch = matchedPattern(PRECISE_QUESTION_PATTERNS, p);
  const preciseRequestMatch = matchedPattern(PRECISE_REQUEST_PATTERNS, p);
  const preciseDebugMatch = matchedPattern(PRECISE_DEBUG_PATTERNS, p);
  const heartbeatMatch = matchedPattern(HEARTBEAT_PATTERNS, p);
  const continuationMatch = matchedPattern(CONTINUATION_PATTERNS, p);

  const preciseSignals = {
    intent: preciseIntentMatch,
    artifact: preciseArtifactMatch,
    question: preciseQuestionMatch,
    request: preciseRequestMatch,
    debug: preciseDebugMatch,
  };
  const preciseSignalCount = Object.values(preciseSignals).filter(Boolean).length;
  const preciseQualified = !!(
    (preciseSignals.intent && (preciseSignals.artifact || preciseSignals.question || preciseSignals.request))
    || (preciseSignals.artifact && preciseSignals.question)
    || (preciseSignals.debug && (preciseSignals.question || preciseSignals.request || preciseSignals.intent))
  );
  const continuationShort = !!(continuationMatch && p.length <= 48);
  const hasSessionContext = !!(currentPack || handoff);
  const weakPreciseInSession = !!(hasSessionContext && preciseSignalCount > 0 && !preciseQualified);
  const preciseOverridesSession = !!(preciseQualified && (hasSessionContext || continuationShort));

  const diagnostics = {
    promptPreview: p.slice(0, 120),
    hint: hint || null,
    normalizedHint: hinted,
    matched: {
      precise: preciseQualified ? (preciseSignals.intent || preciseSignals.artifact || preciseSignals.debug || preciseSignals.question || preciseSignals.request) : null,
      preciseIntent: preciseIntentMatch,
      preciseArtifact: preciseArtifactMatch,
      preciseQuestion: preciseQuestionMatch,
      preciseRequest: preciseRequestMatch,
      preciseDebug: preciseDebugMatch,
      heartbeat: heartbeatMatch,
      continuation: continuationMatch,
    },
    signals: {
      hasCurrentPack: !!currentPack,
      hasHandoff: !!handoff,
      shortPrompt: p.length <= 48,
      hasQuestion: /[?？]/.test(p),
      preciseSignalCount,
      preciseQualified,
      continuationShort,
      hasSessionContext,
      weakPreciseInSession,
      preciseOverridesSession,
    },
    reason: null,
  };

  if (hinted) {
    diagnostics.reason = `hint:${hinted}`;
    return { scene: hinted, diagnostics };
  }
  if (heartbeatMatch) {
    diagnostics.reason = `pattern:heartbeat:${heartbeatMatch}`;
    return { scene: 'heartbeat', diagnostics };
  }
  if (preciseQualified) {
    diagnostics.reason = preciseOverridesSession
      ? `pattern:precise:override-session:${preciseSignals.intent || preciseSignals.artifact || preciseSignals.debug || preciseSignals.question || preciseSignals.request}`
      : `pattern:precise:${preciseSignals.intent || preciseSignals.artifact || preciseSignals.debug || preciseSignals.question || preciseSignals.request}`;
    return { scene: 'precise', diagnostics };
  }
  if (currentPack) {
    diagnostics.reason = weakPreciseInSession ? 'active-pack-with-weak-precise-signals' : 'active-pack';
    return { scene: 'session', diagnostics };
  }
  if (handoff) {
    diagnostics.reason = weakPreciseInSession ? 'latest-handoff-with-weak-precise-signals' : 'latest-handoff';
    return { scene: 'session', diagnostics };
  }
  if (continuationShort) {
    diagnostics.reason = preciseSignalCount > 0
      ? `pattern:continuation-with-weak-precise-signals:${continuationMatch}`
      : `pattern:continuation:${continuationMatch}`;
    return { scene: 'session', diagnostics };
  }
  if (p.length <= 40 && !/[?？]/.test(p)) {
    diagnostics.reason = 'short-chat-default';
    return { scene: 'chat', diagnostics };
  }
  diagnostics.reason = preciseSignalCount > 0 ? 'task-default-precise-signals-insufficient' : 'task-default';
  return { scene: 'task', diagnostics };
}

export function inferScene(args) {
  return inferSceneDetailed(args).scene;
}

export function shouldIncludeReviewTriage(scene) {
  return scene === 'task' || scene === 'session' || scene === 'heartbeat';
}

export function shouldIncludeResumeHandoff({ scene, selectedHasPackId }) {
  if (selectedHasPackId) return false;
  return scene === 'session' || scene === 'task';
}

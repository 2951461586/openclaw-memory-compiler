import fs from 'fs';
import path from 'path';
import { inferSceneDetailed, shouldIncludeReviewTriage, shouldIncludeResumeHandoff } from './runtime-policy.mjs';
import { selectRuntimeContext } from './runtime-selector-core.mjs';
import { triageReviewQueue } from './review-triage-core.mjs';
import { compilerDirFrom } from './plugin-paths.mjs';

function readJsonIfExists(p) {
  try { return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; } catch { return null; }
}
function short(text, max) { return String(text || '').replace(/\n+/g, ' ').slice(0, max); }

function latestHandoff(root, sessionKey, paths = null) {
  const compilerDir = compilerDirFrom(root, paths);
  const handoffsDir = path.join(compilerDir, 'session-packs', 'handoffs');
  if (!fs.existsSync(handoffsDir)) return null;
  const files = fs.readdirSync(handoffsDir).filter(x => x.endsWith('.json')).sort().reverse();
  for (const f of files) {
    const rec = readJsonIfExists(path.join(handoffsDir, f));
    if (!rec) continue;
    if (!sessionKey || rec.sessionKey === sessionKey) return rec;
  }
  return null;
}

function buildResumeBlock(handoff) {
  if (!handoff) return '';
  const lines = [
    '<resume-handoff>',
    handoff.focus ? `Focus: ${handoff.focus}` : null,
    handoff.primaryThreadTitle ? `Primary thread: ${handoff.primaryThreadTitle}` : null,
    Array.isArray(handoff.decisions) && handoff.decisions.length ? `Decisions: ${handoff.decisions.join(' | ')}` : null,
    Array.isArray(handoff.unresolvedRisks) && handoff.unresolvedRisks.length ? `Open risks: ${handoff.unresolvedRisks.join(' | ')}` : null,
    Array.isArray(handoff.nextActions) && handoff.nextActions.length ? `Next actions: ${handoff.nextActions.join(' | ')}` : null,
    handoff.handoffSummary ? `Summary: ${short(handoff.handoffSummary, 500)}` : null,
    '</resume-handoff>',
  ].filter(Boolean);
  return lines.join('\n');
}

function wrapTaggedBlock(tag, title, lines) {
  const body = (lines || []).map(x => String(x || '').trim()).filter(Boolean);
  if (body.length === 0) return '';
  return [ `<${tag}>`, title ? title : null, ...body, `</${tag}>` ].filter(Boolean).join('\n');
}

function buildSourceActionPlan(selected, payload = {}) {
  const recallPlan = selected?.recallPlan;
  if (!recallPlan) return null;
  const prompt = String(payload?.prompt || payload?.query || '').trim();
  const query = recallPlan.queryTerms?.length ? recallPlan.queryTerms.join(' ') : prompt;
  const sumRefs = (recallPlan.candidateRefs || []).filter(ref => String(ref).startsWith('sum:')).map(ref => String(ref).slice(4));
  const fileRefs = (recallPlan.candidateRefs || []).filter(ref => String(ref).startsWith('file:')).map(ref => String(ref).slice(5));
  const memRefs = (recallPlan.candidateRefs || []).filter(ref => String(ref).startsWith('mem:'));
  const steps = [];

  if (sumRefs.length) {
    steps.push({
      priority: 1,
      tool: 'lcm_expand_query',
      reason: 'trusted-summary-candidates-available',
      params: {
        summaryIds: sumRefs.slice(0, 3),
        prompt: prompt || `Answer the precise question using source summaries: ${query}`,
      },
    });
  } else if (query) {
    steps.push({
      priority: 1,
      tool: 'lcm_grep',
      reason: 'no-summary-refs-find-relevant-summaries-first',
      params: {
        pattern: query,
        mode: 'full_text',
        scope: 'both',
        limit: 5,
      },
    });
  }

  if (fileRefs.length) {
    steps.push({
      priority: steps.length + 1,
      tool: 'read',
      reason: 'inspect-authoritative-files',
      params: {
        path: fileRefs[0],
      },
      extraPaths: fileRefs.slice(1, 3),
    });
  }

  if (query || memRefs.length) {
    steps.push({
      priority: steps.length + 1,
      tool: 'memory_recall',
      reason: memRefs.length ? 'cross-check-durable-memory' : 'fallback-durable-memory-search',
      params: {
        query: query || prompt,
        limit: 5,
      },
      memoryRefs: memRefs.slice(0, 5),
    });
  }

  if (steps.length === 0) return null;
  return {
    strategy: recallPlan.strategy,
    reason: recallPlan.reason,
    queryTerms: recallPlan.queryTerms || [],
    primary: steps[0],
    fallbacks: steps.slice(1),
    steps,
  };
}

function buildSourceDispatchContract(plan, selected) {
  if (!plan?.primary?.tool) return null;
  const normalizeStep = (step, index) => ({
    dispatchMode: 'tool-call-ready',
    priority: index + 1,
    tool: step.tool,
    reason: step.reason,
    params: step.params || {},
    extraPaths: step.extraPaths || [],
    memoryRefs: step.memoryRefs || [],
  });
  const reviewBlocking = Array.isArray(selected?.reviewTriage?.topItems)
    ? selected.reviewTriage.topItems.some(item => item?.sourceDispatchBlocking === true || item?.blockedState === 'source-discipline' || item?.sourceAssessment?.hasTrusted === false)
    : false;
  const blockingReason = reviewBlocking
    ? 'review-queue-has-source-discipline-blocking-items'
    : (plan.strategy === 'recover-source-before-answer' ? 'precise-scene-source-recovery-required' : null);
  return {
    contractVersion: 'source-dispatch.v1',
    shouldDispatch: true,
    blocking: plan.strategy === 'recover-source-before-answer' || reviewBlocking,
    blockingReason,
    strategy: plan.strategy,
    reason: plan.reason,
    queryTerms: plan.queryTerms || [],
    primary: normalizeStep(plan.primary, 0),
    fallbacks: (plan.fallbacks || []).map((step, index) => normalizeStep(step, index + 1)),
    consumers: ['derivedSessionBridge', 'operator-manual', 'review-flow'],
  };
}

function buildSourceActionPlanBlock(plan, dispatchContract) {
  if (!plan) return '';
  const lines = [
    `Strategy: ${plan.strategy}`,
    plan.reason ? `Reason: ${plan.reason}` : null,
    Array.isArray(plan.queryTerms) && plan.queryTerms.length ? `Query anchors: ${plan.queryTerms.join(', ')}` : null,
    plan.primary ? `Primary: ${plan.primary.tool} (${plan.primary.reason})` : null,
    dispatchContract?.primary ? `Dispatch-ready primary: ${dispatchContract.primary.tool} [${dispatchContract.primary.dispatchMode}]` : null,
    ...(plan.steps || []).map((step, i) => `${i + 1}. ${step.tool} -> ${step.reason}`),
  ].filter(Boolean);
  return wrapTaggedBlock('source-action-plan', 'Executable source-first action routing for this run.', lines);
}

function buildDerivedSessionContext(selected, sourceActionPlan, sourceDispatch) {
  const blocks = [];
  const factLines = (selected?.facts || []).slice(0, 6).map((fact, i) => `${i + 1}. ${fact.text}`);
  const threadLines = (selected?.threads || []).slice(0, 4).map((thread, i) => `${i + 1}. ${thread.title}: ${short(thread.summary || thread.nextStepHint || '', 220)}`);
  const continuityLines = [];
  for (const rec of (selected?.continuity || []).slice(0, 2)) {
    if (rec.focus) continuityLines.push(`Focus: ${rec.focus}`);
    if (Array.isArray(rec.decisions) && rec.decisions.length) continuityLines.push(`Decisions: ${rec.decisions.join(' | ')}`);
    if (Array.isArray(rec.risks) && rec.risks.length) continuityLines.push(`Risks: ${rec.risks.join(' | ')}`);
    if (Array.isArray(rec.nextActions) && rec.nextActions.length) continuityLines.push(`Next actions: ${rec.nextActions.join(' | ')}`);
  }
  const digestLines = (selected?.digests || []).slice(0, 2).map((digest, i) => `${i + 1}. [${digest.type}] ${short(digest.snippet || '', 420)}`);
  const stableFactsBlock = wrapTaggedBlock('derived-facts', 'Stable facts selected by the derived memory compiler. Use for continuity; go source-first when precision matters.', factLines);
  const threadBlock = wrapTaggedBlock('active-threads', 'Active threads likely relevant to this run.', threadLines);
  const continuityBlock = wrapTaggedBlock('working-continuity', 'Current working continuity stitched from recent derived records.', continuityLines);
  const digestBlock = wrapTaggedBlock('digest-snippets', 'Thin digest slices for continuity only; they are not authoritative evidence.', digestLines);
  const sourcePlanBlock = buildSourceActionPlanBlock(sourceActionPlan, sourceDispatch);
  if (stableFactsBlock) blocks.push(stableFactsBlock);
  if (threadBlock) blocks.push(threadBlock);
  if (continuityBlock) blocks.push(continuityBlock);
  if (digestBlock) blocks.push(digestBlock);
  if (sourcePlanBlock) blocks.push(sourcePlanBlock);
  if (blocks.length === 0) return '';
  return ['<derived-session-context>', ...blocks, '</derived-session-context>'].join('\n\n');
}

export function generateRuntimeBridgeContext({ root, payload, paths = null }) {
  const packsDir = paths?.dataDir ? path.join(paths.dataDir, 'session-packs') : path.join(root, 'memory', 'compiler', 'session-packs');
  const sessionKey = typeof payload?.sessionKey === 'string' ? payload.sessionKey : '';
  const currentPack = readJsonIfExists(path.join(packsDir, 'current.json'));
  const activePack = currentPack && (!sessionKey || currentPack.sessionKey === sessionKey) && (!currentPack.expiresAt || new Date(currentPack.expiresAt).getTime() > Date.now()) ? currentPack : null;
  const handoff = latestHandoff(root, sessionKey, paths);
  const inferred = inferSceneDetailed({ prompt: payload?.prompt, hint: payload?.sceneHint, currentPack: activePack, handoff });
  const scene = inferred.scene;
  const packVariant = payload?.packVariant || (scene === 'session' ? (activePack ? 'task' : 'handoff') : undefined);
  const selected = selectRuntimeContext({ root, payload: {
    scene,
    prompt: payload?.prompt,
    query: payload?.query,
    packVariant,
    date: payload?.date,
    week: payload?.week,
    maxPromptChars: payload?.maxPromptChars,
    maxPromptTokens: payload?.maxPromptTokens,
    preferredSourcePrefixes: payload?.preferredSourcePrefixes || ['sum:', 'file:', 'mem:'],
  }, paths }).selected;
  const triage = triageReviewQueue({ root, paths, limit: payload?.maxReviewItems || 3, status: 'open', query: payload?.reviewQuery || null });
  selected.reviewTriage = { total: triage.total, topItems: triage.topItems || [] };
  const sourceActionPlan = buildSourceActionPlan(selected, payload);
  if (sourceActionPlan && selected?.runtimeSourceMix?.coverageQuality === 'artifact-heavy') {
    sourceActionPlan.strategy = 'artifact-first-source-recovery';
    sourceActionPlan.reason = 'artifact-heavy-derived-context-needs-authoritative-source-recovery';
  } else if (sourceActionPlan && selected?.runtimeSourceMix?.coverageQuality === 'session-heavy') {
    sourceActionPlan.strategy = 'session-cross-check-before-answer';
    sourceActionPlan.reason = 'session-heavy-context-needs-cross-check-against-trusted-sources';
  }
  const sourceDispatch = buildSourceDispatchContract(sourceActionPlan, selected);
  const blocks = [];
  if (handoff && shouldIncludeResumeHandoff({ scene, selectedHasPackId: !!selected.packId })) blocks.push(buildResumeBlock(handoff));
  blocks.push(buildDerivedSessionContext(selected, sourceActionPlan, sourceDispatch));
  if (payload?.includeReviewTriage !== false && shouldIncludeReviewTriage(scene) && triage.topItems?.length) {
    blocks.push(['<review-triage>', triage.summaryText, '</review-triage>'].join('\n'));
  }
  const prependContext = blocks.filter(Boolean).join('\n\n');
  return {
    ok: true,
    scene,
    packVariant: packVariant || null,
    prependContext,
    prependChars: prependContext.length,
    selected,
    sourceActionPlan,
    sourceDispatch,
    sourceKindContract: selected?.sourceKindContract || null,
    runtimeSourceMix: selected?.runtimeSourceMix || null,
    selectedBudget: selected?.budgetProfile || null,
    sceneDiagnostics: inferred.diagnostics,
    handoff: handoff ? { id: handoff.id, reason: handoff.reason || null, packId: handoff.packId || null } : null,
    reviewTriage: { total: triage.total, topItems: triage.topItems || [] },
  };
}

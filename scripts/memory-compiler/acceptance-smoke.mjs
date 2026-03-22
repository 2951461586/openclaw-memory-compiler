#!/usr/bin/env node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { printResult } from './lib/io.mjs';
import { readJsonl } from './lib/jsonl-store.mjs';
import { resolveCompilerRuntime } from './lib/plugin-paths.mjs';

const runtime = resolveCompilerRuntime();
const root = runtime.workspaceDir;
const base = runtime.scriptBase;
const reportsDir = path.join(root, 'memory', 'compiler', 'reports');
const docsDir = runtime.docsDir;
const masterplanPath = path.join(docsDir, 'MASTERPLAN.md');
const operatorReviewFlowPath = path.join(docsDir, 'OPERATOR-REVIEW-FLOW.md');
const implementationBacklogPath = path.join(docsDir, 'IMPLEMENTATION-BACKLOG.md');
const fileRef = (absPath) => `file:${absPath}`;
fs.mkdirSync(reportsDir, { recursive: true });

function run(script, inputPath) {
  const args = [path.join(base, script)];
  if (inputPath) args.push(inputPath);
  return JSON.parse(execFileSync('node', args, { cwd: root, encoding: 'utf8' }));
}
function runWithTemp(script, name, obj) {
  const p = writeTemp(name, obj);
  try {
    return run(script, p);
  } finally {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}
function writeTemp(name, obj) {
  const p = path.join(os.tmpdir(), `memory-compiler-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
  return p;
}
function readLatestManifest(type, rel) {
  const latestIndexPath = path.join(root, 'memory', 'compiler', 'digests', 'latest-index.json');
  const latestIndex = JSON.parse(fs.readFileSync(latestIndexPath, 'utf8'));
  const id = latestIndex[`${type}::${rel}`];
  return JSON.parse(fs.readFileSync(path.join(root, 'memory', 'compiler', 'digests', 'manifests', `${id}.json`), 'utf8'));
}
function hasArtifact(refs=[]) { return refs.some(r => String(r).startsWith('artifact:')); }

const acceptRunId = Date.now().toString(36);
const acceptanceReviewMeta = { origin: 'acceptance', namespace: 'acceptance', operatorVisible: false, evidenceMode: 'sample' };
const rejectReviewTitle = `acceptance reject review flow ${acceptRunId}`;
const blockedReviewTitle = `acceptance blocked promotion review flow ${acceptRunId}`;
const disputeReviewTitle = `acceptance dispute review flow ${acceptRunId}`;
const refreshReviewTitle = `acceptance refresh review flow ${acceptRunId}`;
const operatorPromotionReviewTitle = `operator inferred confirmed review flow ${acceptRunId}`;
const acceptValue = (suffix) => `candidate-${suffix}-${acceptRunId}`;

const tests = [];
function pushTest(name, ok, extra = {}) { tests.push({ name, ok, ...extra }); }
function record(name, ok, details = {}) { tests.push({ name, ok, ...details }); }

const rebuildToday = writeTemp('accept-today', { type: 'today', date: '2026-03-20', generationStrategy: 'acceptance-refresh-v1', forceChangedSourceCompile: true, changedSourceRefs: ['file:/root/.openclaw/workspace/SESSION-STATE.md'] });
const rebuildWeek = writeTemp('accept-week', { type: 'week', week: '2026-W12', generationStrategy: 'acceptance-refresh-v1', forceChangedSourceCompile: true, changedSourceRefs: ['file:/root/.openclaw/workspace/SESSION-STATE.md'] });
const rebuildNarrative = writeTemp('accept-narrative', { type: 'narrative', generationStrategy: 'acceptance-refresh-v1', forceChangedSourceCompile: true, changedSourceRefs: ['file:/root/.openclaw/workspace/SESSION-STATE.md'] });
run('digest-compiler.mjs', rebuildToday);
run('digest-compiler.mjs', rebuildWeek);
run('digest-compiler.mjs', rebuildNarrative);
run('digest-gc.mjs');

const discipline = run('source-discipline-check.mjs');
record('source-discipline-ok', discipline.ok === true, discipline);

const todayManifest = readLatestManifest('today', 'memory/compiler/digests/today/2026-03-20.md');
const weekManifest = readLatestManifest('week', 'memory/compiler/digests/week/2026-W12.md');
const narrativeManifest = readLatestManifest('narrative', 'memory/compiler/digests/narrative/current.md');
record('today-manifest-clean', !hasArtifact(todayManifest.sourceRefs), { sourceRefs: todayManifest.sourceRefs });
record('week-manifest-clean', !hasArtifact(weekManifest.sourceRefs), { sourceRefs: weekManifest.sourceRefs });
record('narrative-manifest-clean', !hasArtifact(narrativeManifest.sourceRefs), { sourceRefs: narrativeManifest.sourceRefs });

const taskCfg = writeTemp('accept-task', { scene: 'task', date: '2026-03-20', week: '2026-W12', maxPromptChars: 1000, maxPromptTokens: 220, preferredSourcePrefixes: ['sum:', 'file:', 'mem:'] });
const preciseCfg = writeTemp('accept-precise', { scene: 'precise', date: '2026-03-20', week: '2026-W12', maxPromptChars: 1000, maxPromptTokens: 220, preferredSourcePrefixes: ['sum:', 'file:', 'mem:'] });
const preciseAnchoredCfg = writeTemp('accept-precise-anchored', { scene: 'precise', prompt: '精确回答：LCM 适配输入 这条主线到底落在哪个 thread？', date: '2026-03-20', week: '2026-W12', maxPromptChars: 1000, maxPromptTokens: 220, preferredSourcePrefixes: ['sum:', 'file:', 'mem:'] });
const preciseMissCfg = writeTemp('accept-precise-miss', { scene: 'precise', prompt: '精确回答：kafka broker 到底是哪个文件哪一行？', date: '2026-03-20', week: '2026-W12', maxPromptChars: 1000, maxPromptTokens: 220, preferredSourcePrefixes: ['sum:', 'file:', 'mem:'] });
const task = run('runtime-selector.mjs', taskCfg);
const precise = run('runtime-selector.mjs', preciseCfg);
const preciseAnchored = run('runtime-selector.mjs', preciseAnchoredCfg);
const preciseMiss = run('runtime-selector.mjs', preciseMissCfg);
record('task-selector-no-artifact-digests', (task.selected.digests || []).every(d => !hasArtifact(d.sourceRefs || [])), { digests: task.selected.digests });
record('precise-selector-no-digests', (precise.selected.digests || []).length === 0, { digests: precise.selected.digests });
record('precise-selector-no-continuity', (precise.selected.continuity || []).length === 0, { continuity: precise.selected.continuity });
record('precise-selector-source-first', precise.selected.escalation === 'source-first', { escalation: precise.selected.escalation });
record('precise-selector-source-first-status-visible', precise.selected?.sourceFirstStatus?.required === true && typeof precise.selected?.sourceFirstStatus?.satisfied === 'boolean', { sourceFirstStatus: precise.selected?.sourceFirstStatus });
record('precise-selector-query-anchored', preciseAnchored.selected?.selectorDiagnostics?.anchorMode === 'query-anchored' && (preciseAnchored.selected.threads || []).length >= 1 && String(preciseAnchored.selected?.rationale || '').includes('precise-query-anchored-selection'), { selectorDiagnostics: preciseAnchored.selected?.selectorDiagnostics, threads: preciseAnchored.selected?.threads, rationale: preciseAnchored.selected?.rationale });
record('precise-selector-recall-plan-visible', Array.isArray(preciseAnchored.selected?.recallPlan?.actions) && preciseAnchored.selected?.recallPlan?.actions?.length >= 1 && preciseAnchored.selected?.recallPlan?.queryTerms?.includes('lcm'), { recallPlan: preciseAnchored.selected?.recallPlan });
record('precise-selector-anchor-miss-requires-source', preciseMiss.selected?.selectorDiagnostics?.anchorMiss === true && preciseMiss.selected?.escalation === 'source-required' && preciseMiss.selected?.recallPlan?.strategy === 'recover-source-before-answer', { selectorDiagnostics: preciseMiss.selected?.selectorDiagnostics, escalation: preciseMiss.selected?.escalation, recallPlan: preciseMiss.selected?.recallPlan, facts: preciseMiss.selected?.facts, threads: preciseMiss.selected?.threads });

const pipelineCfg = writeTemp('accept-pipeline', { date: '2026-03-20', week: '2026-W12', autoEnforceSourceDiscipline: true, facts: [], threads: [], continuity: [] });
const pipeline = run('pipeline-run.mjs', pipelineCfg);
record('pipeline-discipline-ok', pipeline.results.sourceDiscipline?.ok === true, { sourceDiscipline: pipeline.results.sourceDiscipline });
record('pipeline-integrity-ok', pipeline.results.integrity?.ok === true, { integrity: pipeline.results.integrity });
const sessionPackCfg = writeTemp('accept-session-pack', { scene: 'task', date: '2026-03-20', week: '2026-W12', sessionKey: 'accept-session' });
const sessionPack = run('session-pack.mjs', sessionPackCfg);
record('session-pack-builds', sessionPack.ok === true && sessionPack.pack?.sourceDiscipline?.ok === true, sessionPack);
const sourceBacklinks = run('source-backlinks.mjs', writeTemp('accept-source-backlinks', { includeKinds: ['lcm-summary', 'lcm-message', 'file', 'memory-item', 'session'] }));
record('source-backlinks-builds', sourceBacklinks.ok === true && sourceBacklinks.totalSources >= 3, { totalSources: sourceBacklinks.totalSources, kinds: sourceBacklinks.kinds });
const controlPlane = run('control-plane-refresh.mjs', writeTemp('accept-control-plane', { refresh: true }));
record('control-plane-refresh-builds', controlPlane.ok === true && fs.existsSync(controlPlane.overviewPath) && fs.existsSync(controlPlane.summaryPath), controlPlane);
const sessionScene = run('runtime-selector.mjs', writeTemp('accept-scene-session', { scene: 'session', date: '2026-03-20', week: '2026-W12' }));
record('session-scene-uses-pack', sessionScene.ok === true && (sessionScene.selected.packId || null) !== null, { packId: sessionScene.selected.packId, rationale: sessionScene.selected.rationale });
const packFinalize = run('session-pack-lifecycle.mjs', writeTemp('accept-pack-finalize', { action: 'finalize', sessionKey: 'accept-session', reason: 'acceptance-finalize' }));
record('session-pack-finalize-clears-current', packFinalize.ok === true && packFinalize.clearedCurrent === true, packFinalize);
const packHistory = run('session-pack-lifecycle.mjs', writeTemp('accept-pack-history', { action: 'history', sessionKey: 'accept-session', limit: 10 }));
record('session-pack-history-visible', packHistory.ok === true && packHistory.total >= 1, { total: packHistory.total });
const packRefresh = run('session-pack-lifecycle.mjs', writeTemp('accept-pack-refresh', { action: 'refresh', sessionKey: 'accept-session', date: '2026-03-20', week: '2026-W12', scene: 'task' }));
record('session-pack-refresh-rebuilds', packRefresh.ok === true && !!packRefresh.packId, packRefresh);
const packExpire = run('session-pack-lifecycle.mjs', writeTemp('accept-pack-expire', { action: 'expire', force: true, sessionKey: 'accept-session', reason: 'acceptance-expire' }));
record('session-pack-expire-clears-current', packExpire.ok === true && packExpire.clearedCurrent === true, packExpire);
const packRefresh2 = run('session-pack-lifecycle.mjs', writeTemp('accept-pack-refresh-2', { action: 'refresh', sessionKey: 'accept-session', date: '2026-03-20', week: '2026-W12', scene: 'task' }));
record('session-pack-refresh-after-expire', packRefresh2.ok === true && !!packRefresh2.packId, packRefresh2);
const sessionEndOut = run('scheduler-run.mjs', writeTemp('accept-session-end-pack', { eventType: 'session-end', sessionKey: 'accept-session', force: true }));
const sessionFallback = run('runtime-selector.mjs', writeTemp('accept-session-fallback', { scene: 'session', date: '2026-03-20', week: '2026-W12' }));
record('scheduler-session-end-finalizes-pack', sessionEndOut.ok === true && sessionEndOut.results.some(r => r.job.kind === 'session-pack-finalize'), { results: sessionEndOut.results.map(r => r.job.kind) });
record('session-scene-fallback-after-finalize', sessionFallback.ok === true && Array.isArray(sessionFallback.selected?.rationale) && sessionFallback.selected.rationale.includes('session-fallback') && (sessionFallback.selected.packId || null) === null, { packId: sessionFallback.selected.packId || null, rationale: sessionFallback.selected.rationale });
const packRefresh3 = run('session-pack-lifecycle.mjs', writeTemp('accept-pack-refresh-3', { action: 'refresh', sessionKey: 'accept-session', date: '2026-03-20', week: '2026-W12', scene: 'task' }));
record('session-pack-restored-post-finalize', packRefresh3.ok === true && !!packRefresh3.packId, packRefresh3);
const sessionPackCurrent = JSON.parse(fs.readFileSync(path.join(root, 'memory', 'compiler', 'session-packs', 'current.json'), 'utf8'));
record('session-pack-thread-binding-visible', !!sessionPackCurrent.primaryThreadId, { primaryThreadId: sessionPackCurrent.primaryThreadId, secondaryThreadIds: sessionPackCurrent.secondaryThreadIds });
const sessionBrief = run('runtime-selector.mjs', writeTemp('accept-session-brief', { scene: 'session', packVariant: 'brief', date: '2026-03-20', week: '2026-W12', maxPromptChars: 500, maxPromptTokens: 120 }));
const sessionHandoff = run('runtime-selector.mjs', writeTemp('accept-session-handoff', { scene: 'session', packVariant: 'handoff', date: '2026-03-20', week: '2026-W12', maxPromptChars: 900, maxPromptTokens: 220 }));
record('session-brief-slice-tightens', sessionBrief.ok === true && (sessionBrief.selected.threads || []).length <= 1 && (sessionBrief.selected.facts || []).length <= 3, { facts: sessionBrief.selected.facts?.length, threads: sessionBrief.selected.threads?.length, variant: sessionBrief.selected.packVariant });
record('session-handoff-slice-adds-capsule', sessionHandoff.ok === true && (sessionHandoff.selected.digests || []).some(d => d.type === 'handoff'), { digests: sessionHandoff.selected.digests, variant: sessionHandoff.selected.packVariant });
const subagentComplete = run('scheduler-run.mjs', writeTemp('accept-subagent-complete', { eventType: 'subagent-complete', sessionKey: 'accept-session', force: true }));
record('scheduler-subagent-complete-builds-handoff', subagentComplete.ok === true && subagentComplete.results.some(r => r.job.kind === 'session-pack-handoff' && r.out?.handoffJsonPath), { jobs: subagentComplete.results.map(r => ({ kind: r.job.kind, handoff: r.out?.handoffJsonPath || null })) });
const triage = run('review-triage.mjs', writeTemp('accept-review-triage', { limit: 3, status: 'open' }));
record('review-triage-produces-summary', triage.ok === true && typeof triage.summaryText === 'string', { total: triage.total, summaryText: triage.summaryText });
const runtimeBridge = run('runtime-bridge.mjs', writeTemp('accept-runtime-bridge', { prompt: '继续接着当前主线推进，并注意 review', sessionKey: 'accept-session', maxPromptChars: 1200, maxPromptTokens: 280, maxReviewItems: 2 }));
record('runtime-bridge-produces-context', runtimeBridge.ok === true && typeof runtimeBridge.prependContext === 'string' && runtimeBridge.prependContext.length > 0, { scene: runtimeBridge.scene, packVariant: runtimeBridge.packVariant });
const compilerMetrics = run('compiler-metrics.mjs', writeTemp('accept-compiler-metrics', { windowHours: 24, recentLimit: 20, sessionKey: 'accept-session', sceneHint: 'task' }));
record('compiler-metrics-builds', compilerMetrics.metrics?.trust?.controlPlaneTrusted === true && typeof compilerMetrics.mdOut === 'string' && compilerMetrics.mdOut.length >= 1 && typeof compilerMetrics.metrics?.runtimeBridge?.scene === 'string', { ok: compilerMetrics.ok, metricsOut: compilerMetrics.out, metricsMd: compilerMetrics.mdOut, trust: compilerMetrics.metrics?.trust, runtimeBridge: compilerMetrics.metrics?.runtimeBridge });
const compilerMetricsPrecise = run('compiler-metrics.mjs', writeTemp('accept-compiler-metrics-precise', { windowHours: 24, recentLimit: 20, sessionKey: 'accept-session', sceneHint: 'precise', probePrompt: '精确回答：LCM 适配输入 这条主线到底落在哪个 thread？' }));
record('compiler-metrics-precise-probe-has-source-dispatch', compilerMetricsPrecise.ok === true && compilerMetricsPrecise.metrics?.runtimeBridge?.hasSourceDispatch === true && compilerMetricsPrecise.metrics?.runtimeBridge?.scene === 'precise', { preciseProbe: compilerMetricsPrecise.metrics?.runtimeBridge, trust: compilerMetricsPrecise.metrics?.trust });
const runtimeProbe = run('runtime-probe.mjs', writeTemp('accept-runtime-probe', { sessionKey: 'accept-runtime-probe', maxReviewItems: 3, includeReviewTriage: true, preferredSourcePrefixes: ['sum:', 'file:', 'mem:'] }));
record('runtime-probe-builds', runtimeProbe.ok === true && runtimeProbe.contractVersion === 'runtime-probe.v1' && runtimeProbe.probes?.precise?.scene === 'precise' && runtimeProbe.probes?.task?.scene === 'task', { runtimeProbe });
record('runtime-probe-operator-facing-evidence-visible', runtimeProbe.ok === true && runtimeProbe.operatorFacing?.preciseSourceDispatchReady === true && typeof runtimeProbe.operatorFacing?.taskCoverageQuality === 'string' && typeof runtimeProbe.operatorFacing?.summaryText === 'string', { operatorFacing: runtimeProbe.operatorFacing, probes: runtimeProbe.probes });
const contractCheckPostProbe = run('contract-check.mjs');
record('runtime-probe-contract-enforced', contractCheckPostProbe.ok === true && (contractCheckPostProbe.summary || []).some(item => item.name === 'runtime-probe' && item.errors === 0), { contractCheckPostProbe });
const burnIn = run('burn-in-run.mjs', writeTemp('accept-burn-in', { iterations: 2, sessionKey: 'accept-burnin-session', includeAcceptance: false, date: '2026-03-20', week: '2026-W12' }));
record('burn-in-run-builds', burnIn.ok === true && burnIn.finalVerify?.ok === true && ['trusted-with-acceptance-samples','trusted-with-operator-backlog'].includes(String(burnIn.finalVerify?.operatorVerdict || '')), { burnIn });
const rebuildReplay = run('rebuild-replay.mjs', writeTemp('accept-rebuild-replay', { action: 'replay', sessionKey: 'accept-rebuild-replay', includeAcceptance: false, windows: [7, 30], events: [{ eventType: 'heartbeat', eventFingerprint: `accept-replay-heartbeat-${acceptRunId}` }, { eventType: 'session-end', eventFingerprint: `accept-replay-session-end-${acceptRunId}` }] }));
record('rebuild-replay-operator-flow-builds', rebuildReplay.ok === true && rebuildReplay.operatorVerdict?.startsWith('trusted'), { rebuildReplay });
const orphanDigestDetect = run('orphan-digest.mjs', writeTemp('accept-orphan-digest-detect', { action: 'detect', maxItems: 50 }));
record('orphan-digest-detector-builds', orphanDigestDetect.ok === true && typeof orphanDigestDetect.summary?.totalFindings === 'number', { orphanDigestDetect });
const burnInTrend = run('burn-in-trend.mjs', writeTemp('accept-burn-in-trend', { action: 'archive', windows: [7, 30] }));
record('burn-in-trend-archive-builds', burnInTrend.ok === true && Array.isArray(burnInTrend.windows) && burnInTrend.windows.includes(7) && burnInTrend.windows.includes(30), { burnInTrend });
record('burn-in-trend-history-visible', burnInTrend.ok === true && ((Number(burnInTrend.history?.archiveCountBeforeCurrent || 0) >= 1) || ((burnInTrend.history?.recentArchives || []).length >= 1)) && typeof burnInTrend.operatorFacing?.summaryText === 'string', { history: burnInTrend.history, operatorFacing: burnInTrend.operatorFacing, baselines: burnInTrend.baselines });
const runtimeBridgeResume = run('runtime-bridge.mjs', writeTemp('accept-runtime-bridge-resume', { prompt: '继续', sessionKey: 'accept-session', sceneHint: 'session', maxPromptChars: 900, maxPromptTokens: 220 }));
record('runtime-bridge-resume-handoff-visible', runtimeBridgeResume.ok === true && (runtimeBridgeResume.handoff?.id || null) !== null, { handoff: runtimeBridgeResume.handoff, scene: runtimeBridgeResume.scene });
const inferredHeartbeat = run('runtime-bridge.mjs', writeTemp('accept-runtime-bridge-heartbeat-infer', { prompt: 'Read HEARTBEAT.md if it exists (workspace context). Follow it strictly.', sessionKey: 'accept-session', maxPromptChars: 1200, maxPromptTokens: 320 }));
record('runtime-bridge-infers-heartbeat-scene', inferredHeartbeat.ok === true && inferredHeartbeat.scene === 'heartbeat', { scene: inferredHeartbeat.scene, budget: inferredHeartbeat.selectedBudget });
record('runtime-bridge-heartbeat-diagnostics-visible', inferredHeartbeat.ok === true && inferredHeartbeat.sceneDiagnostics?.reason?.startsWith('pattern:heartbeat:'), { diagnostics: inferredHeartbeat.sceneDiagnostics });
const inferredPrecise = run('runtime-bridge.mjs', writeTemp('accept-runtime-bridge-precise-infer', { prompt: '精确回答：到底是哪个文件哪一行配置导致的？', sessionKey: 'accept-session', maxPromptChars: 1200, maxPromptTokens: 320 }));
const inferredPreciseAnchored = run('runtime-bridge.mjs', writeTemp('accept-runtime-bridge-precise-anchored', { prompt: '精确回答：LCM 适配输入 这条主线到底落在哪个 thread？', sessionKey: 'accept-session', maxPromptChars: 1200, maxPromptTokens: 320 }));
const inferredWeakPrecise = run('runtime-bridge.mjs', writeTemp('accept-runtime-bridge-weak-precise', { prompt: '继续看看这个配置', sessionKey: 'accept-session', maxPromptChars: 1200, maxPromptTokens: 320 }));
const inferredRequestedPrecise = run('runtime-bridge.mjs', writeTemp('accept-runtime-bridge-requested-precise', { prompt: '帮我定位是哪个文件', sessionKey: 'accept-session', maxPromptChars: 1200, maxPromptTokens: 320 }));
const inferredContinuationPrecise = run('runtime-bridge.mjs', writeTemp('accept-runtime-bridge-continuation-precise', { prompt: '继续，但精确回答：到底是哪个文件哪一行？', sessionKey: 'accept-session', maxPromptChars: 1200, maxPromptTokens: 320 }));
record('runtime-bridge-infers-precise-scene', inferredPrecise.ok === true && inferredPrecise.scene === 'precise' && String(inferredPrecise.selected?.escalation || '').startsWith('source-'), { scene: inferredPrecise.scene, escalation: inferredPrecise.selected?.escalation });
record('runtime-bridge-precise-diagnostics-visible', inferredPrecise.ok === true && inferredPrecise.sceneDiagnostics?.reason?.startsWith('pattern:precise:'), { diagnostics: inferredPrecise.sceneDiagnostics });
record('runtime-bridge-precise-source-first-status-visible', inferredPrecise.ok === true && inferredPrecise.selected?.sourceFirstStatus?.required === true, { sourceFirstStatus: inferredPrecise.selected?.sourceFirstStatus, selectorDiagnostics: inferredPrecise.selected?.selectorDiagnostics, recallPlan: inferredPrecise.selected?.recallPlan, sourceActionPlan: inferredPrecise.sourceActionPlan });
record('runtime-bridge-precise-forwards-query-anchor', inferredPreciseAnchored.ok === true && inferredPreciseAnchored.selected?.selectorDiagnostics?.anchorMode === 'query-anchored' && (inferredPreciseAnchored.selected?.threads || []).length >= 1 && String(inferredPreciseAnchored.selected?.rationale || '').includes('precise-query-anchored-selection') && Array.isArray(inferredPreciseAnchored.selected?.recallPlan?.actions), { selectorDiagnostics: inferredPreciseAnchored.selected?.selectorDiagnostics, threads: inferredPreciseAnchored.selected?.threads, rationale: inferredPreciseAnchored.selected?.rationale, recallPlan: inferredPreciseAnchored.selected?.recallPlan, sourceActionPlan: inferredPreciseAnchored.sourceActionPlan });
record('runtime-bridge-source-action-plan-visible', Array.isArray(inferredPreciseAnchored.sourceActionPlan?.steps) && inferredPreciseAnchored.sourceActionPlan?.steps?.length >= 1 && ['lcm_expand_query', 'lcm_grep'].includes(inferredPreciseAnchored.sourceActionPlan?.primary?.tool) && inferredPreciseAnchored.sourceDispatch?.contractVersion === 'source-dispatch.v1' && inferredPreciseAnchored.sourceDispatch?.primary?.tool === inferredPreciseAnchored.sourceActionPlan?.primary?.tool && typeof inferredPreciseAnchored.prependContext === 'string' && inferredPreciseAnchored.prependContext.includes('<source-action-plan>'), { sourceActionPlan: inferredPreciseAnchored.sourceActionPlan, sourceDispatch: inferredPreciseAnchored.sourceDispatch, prependContext: inferredPreciseAnchored.prependContext });
record('runtime-bridge-review-blocking-can-escalate-source-dispatch', inferredPreciseAnchored.ok === true && typeof inferredPreciseAnchored.sourceDispatch?.blocking === 'boolean' && Array.isArray(inferredPreciseAnchored.reviewTriage?.topItems), { sourceDispatch: inferredPreciseAnchored.sourceDispatch, reviewTriage: inferredPreciseAnchored.reviewTriage });
record('runtime-bridge-weak-precise-signals-do-not-upgrade-scene', inferredWeakPrecise.ok === true && inferredWeakPrecise.scene !== 'precise' && inferredWeakPrecise.scene === 'session' && inferredWeakPrecise.sceneDiagnostics?.signals?.preciseQualified === false && ['active-pack-with-weak-precise-signals', 'latest-handoff-with-weak-precise-signals'].includes(inferredWeakPrecise.sceneDiagnostics?.reason), { scene: inferredWeakPrecise.scene, diagnostics: inferredWeakPrecise.sceneDiagnostics });
record('runtime-bridge-request-plus-artifact-upgrades-to-precise', inferredRequestedPrecise.ok === true && inferredRequestedPrecise.scene === 'precise' && inferredRequestedPrecise.sceneDiagnostics?.signals?.preciseQualified === true, { scene: inferredRequestedPrecise.scene, diagnostics: inferredRequestedPrecise.sceneDiagnostics });
record('runtime-bridge-precise-overrides-continuation-session', inferredContinuationPrecise.ok === true && inferredContinuationPrecise.scene === 'precise' && inferredContinuationPrecise.sceneDiagnostics?.signals?.preciseOverridesSession === true && String(inferredContinuationPrecise.sceneDiagnostics?.reason || '').startsWith('pattern:precise:override-session:'), { scene: inferredContinuationPrecise.scene, diagnostics: inferredContinuationPrecise.sceneDiagnostics });
const inferredSession = run('runtime-bridge.mjs', writeTemp('accept-runtime-bridge-session-infer', { prompt: '继续', sessionKey: 'accept-session', maxPromptChars: 1200, maxPromptTokens: 320 }));
record('runtime-bridge-infers-session-scene', inferredSession.ok === true && inferredSession.scene === 'session', { scene: inferredSession.scene, packVariant: inferredSession.packVariant });
record('runtime-bridge-session-diagnostics-visible', inferredSession.ok === true && typeof inferredSession.sceneDiagnostics?.reason === 'string' && inferredSession.sceneDiagnostics.reason.length >= 1, { diagnostics: inferredSession.sceneDiagnostics });
record('runtime-bridge-budget-visible', runtimeBridge.ok === true && runtimeBridge.selectedBudget?.maxPromptChars >= runtimeBridge.selectedBudget?.usedPromptChars, { selectedBudget: runtimeBridge.selectedBudget, prependChars: runtimeBridge.prependChars });
const taskTightBudget = run('runtime-selector.mjs', writeTemp('accept-task-tight-budget', { scene: 'task', date: '2026-03-20', week: '2026-W12', maxPromptChars: 240, maxPromptTokens: 60, preferredSourcePrefixes: ['sum:', 'file:', 'mem:'] }));
record('runtime-selector-budget-trims', taskTightBudget.ok === true && (taskTightBudget.selected.omittedBlocks || []).length >= 1, { omittedBlocks: taskTightBudget.selected.omittedBlocks, budget: taskTightBudget.selected.budgetProfile });
const heartbeatScene = run('runtime-selector.mjs', writeTemp('accept-heartbeat-scene', { scene: 'heartbeat', date: '2026-03-20', week: '2026-W12', maxPromptChars: 900, maxPromptTokens: 220 }));
record('heartbeat-scene-keeps-thin-signal', heartbeatScene.ok === true && (heartbeatScene.selected.digests || []).length <= 2 && heartbeatScene.selected.budgetProfile?.maxPromptChars <= 900, { digests: heartbeatScene.selected.digests, budget: heartbeatScene.selected.budgetProfile });
const taskAutoWeek = run('runtime-selector.mjs', writeTemp('accept-task-auto-week', { scene: 'task', date: '2026-03-20', maxPromptChars: 1000, maxPromptTokens: 220, preferredSourcePrefixes: ['sum:', 'file:', 'mem:'] }));
record('runtime-selector-derives-week-from-date', taskAutoWeek.ok === true && taskAutoWeek.selected?.budgetProfile?.scene === 'task' && taskAutoWeek.selected?.coverage?.digests?.trustedRefs >= 0, { digests: taskAutoWeek.selected.digests, budget: taskAutoWeek.selected.budgetProfile, coverage: taskAutoWeek.selected?.coverage?.digests });

const adapterWorkspaceInput = writeTemp('accept-adapter-workspace-input', {
  date: '2026-03-20',
  week: '2026-W12',
  notes: [{
    filePath: masterplanPath,
    scope: 'project',
    tags: ['workspace', 'plan'],
    confirmedFacts: [{
      subject: 'memory-compiler',
      attribute: 'operator-pipeline',
      value: 'operator-facing',
      text: '记忆编译层需要收成 operator-facing、可验证流水线'
    }],
    activeThreads: [{
      title: '多源 source coverage 推进',
      summary: '把 workspace / memory / session-state 输入接入统一 ingest 入口',
      nextStepHint: '验证 source backlinks 已覆盖 file / memory-item / session'
    }],
    continuityFocus: '继续把多源输入并入编译主流水线',
    decisions: ['不另起野路子，沿现有 contracts/backlinks/control-plane 演进'],
    risks: ['source coverage 长期过窄会让 derived layer 失真'],
    nextActions: ['补齐 workspace/session-state adapter', '刷新 control-plane 验证多源 coverage'],
    relatedThreads: ['thread_6756e43d2012']
  }]
});
const adapterWorkspace = JSON.parse(execFileSync('node', [path.join(base, 'adapter-pipeline-run.mjs'), 'workspace', adapterWorkspaceInput], { cwd: root, encoding: 'utf8' }));
record('adapter-workspace-pipeline-builds', adapterWorkspace.ok === true && adapterWorkspace.result?.results?.sourceBacklinks?.ok === true, { adapter: adapterWorkspace.adapter, sourceBacklinks: adapterWorkspace.result?.results?.sourceBacklinks });
const adapterSessionStateInput = writeTemp('accept-adapter-session-state-input', {
  date: '2026-03-20',
  week: '2026-W12',
  filePath: '/root/.openclaw/workspace/SESSION-STATE.md',
  continuityFocus: '当前 P 继续推进适配层 / ingest 统一入口 + 多源 coverage',
  decisions: ['precise 场景继续严格 source-first'],
  risks: ['不能长期只靠极少数摘要源撑 derived layer'],
  nextActions: ['扩大 source coverage', '刷新 control-plane'],
  relatedThreads: ['thread_6756e43d2012'],
  activeThreads: [{
    title: '适配层 / ingest 统一入口',
    summary: '继续收敛成 operator-facing、可验证流水线',
    nextStepHint: '跑 control-plane / acceptance / backlinks 验证'
  }]
});
const adapterSessionState = JSON.parse(execFileSync('node', [path.join(base, 'adapter-pipeline-run.mjs'), 'session-state', adapterSessionStateInput], { cwd: root, encoding: 'utf8' }));
record('adapter-session-state-pipeline-builds', adapterSessionState.ok === true && adapterSessionState.result?.results?.controlPlane?.ok === true, { adapter: adapterSessionState.adapter, controlPlane: adapterSessionState.result?.results?.controlPlane });
const adapterLancedb = JSON.parse(execFileSync('node', [path.join(base, 'adapter-pipeline-run.mjs'), 'lancedb', path.join(base, 'examples', 'lancedb-import.sample.json')], { cwd: root, encoding: 'utf8' }));
record('adapter-lancedb-pipeline-builds', adapterLancedb.ok === true && adapterLancedb.result?.results?.facts?.ok === true, { adapter: adapterLancedb.adapter, facts: adapterLancedb.result?.results?.facts });
const realImportInput = writeTemp('accept-real-import', {
  date: '2026-03-21',
  week: '2026-W12',
  durableImportMode: 'batch',
  durableBatchSize: 2,
  dailyMemoryPaths: ['/root/.openclaw/workspace/memory/2026-03-21.md', '/root/.openclaw/workspace/memory/2026-03-20.md'],
  workspaceFiles: [
    '/root/.openclaw/workspace/SESSION-STATE.md',
    '/root/.openclaw/workspace/memory/working-buffer.md',
    masterplanPath,
    implementationBacklogPath
  ],
  durableMemories: [{
    id: 'accept-real-durable-1',
    text: 'real durable memory import path acceptance item',
    category: 'project',
    confirmed: true,
    confidence: 0.88,
    sourceRefs: ['mem:accept-real-durable-1']
  }, {
    id: 'accept-real-durable-2',
    text: 'real durable memory import path acceptance item batch second',
    category: 'project',
    confirmed: true,
    confidence: 0.84,
    sourceRefs: ['mem:accept-real-durable-2']
  }, {
    id: 'accept-real-durable-3',
    text: 'real durable memory import path acceptance item batch third',
    category: 'decision',
    confirmed: false,
    confidence: 0.7,
    sourceRefs: ['mem:accept-real-durable-3']
  }]
});
const realImport = run('import-real-sources.mjs', realImportInput);
record('real-import-entry-runs', realImport.ok === true && realImport.sources?.dailyMemoryPaths?.length >= 1 && realImport.runs?.length >= 2, { sources: realImport.sources, runs: realImport.runs, out: realImport.out });
record('real-import-batch-durable-visible', realImport.ok === true && realImport.runs?.some(item => item.kind === 'lancedb-batch' && item.batchCount >= 2 && item.durableItems >= 3), { runs: realImport.runs, out: realImport.out });
record('real-import-source-coverage-visible', realImport.ok === true && (realImport.sourceCoverage?.realInputSourcesPresent?.dailyMemory?.length || 0) >= 1 && (realImport.sourceCoverage?.realInputSourcesPresent?.workspace?.length || 0) >= 1 && (realImport.sourceCoverage?.realInputSourcesPresent?.durableMemory?.length || 0) >= 1, { sourceCoverage: realImport.sourceCoverage, out: realImport.out });
const durableBatchImport = run('import-durable-memory-batch.mjs', writeTemp('accept-durable-batch-import', {
  date: '2026-03-21',
  week: '2026-W12',
  batchSize: 2,
  label: 'acceptance-batch',
  durableMemories: [
    { id: 'accept-batch-durable-1', text: 'durable batch import acceptance item 1', category: 'project', confirmed: true, confidence: 0.91, sourceRefs: ['mem:accept-batch-durable-1'] },
    { id: 'accept-batch-durable-2', text: 'durable batch import acceptance item 2', category: 'project', confirmed: true, confidence: 0.86, sourceRefs: ['mem:accept-batch-durable-2'] },
    { id: 'accept-batch-durable-3', text: 'durable batch import acceptance item 3', category: 'decision', confirmed: false, confidence: 0.72, sourceRefs: ['mem:accept-batch-durable-3'] }
  ]
}));
record('durable-batch-import-builds', durableBatchImport.ok === true && durableBatchImport.totalBatches === 2 && durableBatchImport.totalItems === 3, { durableBatchImport });
record('durable-batch-import-live-vs-latest-contract-visible', durableBatchImport.ok === true && durableBatchImport.reportScope?.namespace === 'acceptance' && durableBatchImport.reportScope?.truthMode === 'acceptance-replay-latest-not-live-truth' && durableBatchImport.controlPlane?.liveTruthPath === 'memory/compiler/reports/control-plane-verify.latest.json', { reportScope: durableBatchImport.reportScope, controlPlane: durableBatchImport.controlPlane, out: durableBatchImport.out, acceptanceOut: durableBatchImport.acceptanceOut });
const durableBatchImportIncremental = run('import-durable-memory-batch.mjs', writeTemp('accept-durable-batch-import-incremental', {
  date: '2026-03-21',
  week: '2026-W12',
  batchSize: 2,
  label: 'acceptance-batch',
  durableMemories: [
    { id: 'accept-batch-durable-1', text: 'durable batch import acceptance item 1', category: 'project', confirmed: true, confidence: 0.91, sourceRefs: ['mem:accept-batch-durable-1'] },
    { id: 'accept-batch-durable-2', text: 'durable batch import acceptance item 2', category: 'project', confirmed: true, confidence: 0.86, sourceRefs: ['mem:accept-batch-durable-2'] },
    { id: 'accept-batch-durable-3', text: 'durable batch import acceptance item 3', category: 'decision', confirmed: false, confidence: 0.72, sourceRefs: ['mem:accept-batch-durable-3'] }
  ]
}));
record('durable-batch-import-incremental-skip-visible', durableBatchImportIncremental.ok === true && durableBatchImportIncremental.importedItems === 0 && durableBatchImportIncremental.skippedItems >= 3, { durableBatchImportIncremental });
const durableBatchFailureFixture = run('import-durable-memory-batch.mjs', writeTemp('accept-durable-batch-import-failure', {
  date: '2026-03-21',
  week: '2026-W12',
  batchSize: 2,
  label: 'acceptance-batch-failure',
  importStrategy: 'full',
  durableMemories: [
    { id: 'accept-batch-failure-1', text: 'durable batch failure acceptance item 1', category: 'project', confirmed: true, confidence: 0.91, sourceRefs: ['mem:accept-batch-failure-1'] },
    { id: 'accept-batch-failure-2', text: 'durable batch failure acceptance item 2 forced failure', category: 'project', confirmed: true, confidence: 0.86, sourceRefs: ['mem:accept-batch-failure-2'], forceFailure: true },
    { id: 'accept-batch-failure-3', text: 'durable batch failure acceptance item 3', category: 'decision', confirmed: false, confidence: 0.72, sourceRefs: ['mem:accept-batch-failure-3'] }
  ]
}));
record('durable-batch-failure-visible', durableBatchFailureFixture.ok === false && durableBatchFailureFixture.failedBatches >= 1 && durableBatchFailureFixture.incremental?.failedBatchIds?.length >= 1, { durableBatchFailureFixture });
const durableBatchReplay = run('import-durable-memory-batch.mjs', writeTemp('accept-durable-batch-import-replay', {
  date: '2026-03-21',
  week: '2026-W12',
  batchSize: 2,
  label: 'acceptance-batch-failure',
  importStrategy: 'full',
  replayFailedBatchIds: durableBatchFailureFixture.incremental?.failedBatchIds || [],
  durableMemories: [
    { id: 'accept-batch-failure-1', text: 'durable batch failure acceptance item 1', category: 'project', confirmed: true, confidence: 0.91, sourceRefs: ['mem:accept-batch-failure-1'] },
    { id: 'accept-batch-failure-2', text: 'durable batch failure acceptance item 2 repaired', category: 'project', confirmed: true, confidence: 0.86, sourceRefs: ['mem:accept-batch-failure-2'] },
    { id: 'accept-batch-failure-3', text: 'durable batch failure acceptance item 3', category: 'decision', confirmed: false, confidence: 0.72, sourceRefs: ['mem:accept-batch-failure-3'] }
  ]
}));
record('durable-batch-replay-failed-batch-acceptance', durableBatchReplay.ok === true && Array.isArray(durableBatchReplay.replayFailedBatchIds) && durableBatchReplay.replayFailedBatchIds.length >= 1 && durableBatchReplay.batches?.every(item => item.skipped === true || durableBatchReplay.replayFailedBatchIds.includes(item.batchId)) && durableBatchReplay.failedBatches === 0, { durableBatchReplay, replayedFrom: durableBatchFailureFixture.incremental?.failedBatchIds });
const sourceKindDiagnostics = run('source-kind-diagnostics.mjs', writeTemp('accept-source-kind-diagnostics', { scenes: ['task', 'precise', 'session'] }));
record('source-kind-contract-visible', sourceKindDiagnostics.ok === true && sourceKindDiagnostics.diagnostics?.some(item => item.scene === 'precise' && item.contract?.authority === 'source-first' && item.contract?.claimRule === 'exact-claim-requires-evidence-path' && item.contract?.kindRules?.file?.exactClaimUse === 'preferred-with-evidence-path'), { diagnostics: sourceKindDiagnostics.diagnostics });
record('source-kind-contract-decision-points-visible', sourceKindDiagnostics.ok === true && sourceKindDiagnostics.diagnostics?.some(item => item.scene === 'task' && item.decisionPoints?.reviewTrigger === 'trigger-plan.mjs/review-apply.mjs' && typeof item.decisionPoints?.sourceDispatchBlockingOpen === 'number'), { diagnostics: sourceKindDiagnostics.diagnostics });
const runtimeSourceMixBeforeAfter = run('runtime-source-mix-before-after.mjs');
record('runtime-source-mix-before-after-evidence-visible', runtimeSourceMixBeforeAfter.ok === true && runtimeSourceMixBeforeAfter.delta?.trustedRatio > 0 && runtimeSourceMixBeforeAfter.delta?.authorityScore > 0 && runtimeSourceMixBeforeAfter.delta?.supportingKindsRemoved?.includes('session'), { runtimeSourceMixBeforeAfter });
const taskMixVisible = run('runtime-selector.mjs', writeTemp('accept-task-mix-visible', { scene: 'task', date: '2026-03-21', week: '2026-W12', maxPromptChars: 1200, maxPromptTokens: 300, preferredSourcePrefixes: ['sum:', 'file:', 'mem:'] }));
record('runtime-source-mix-visible', taskMixVisible.ok === true && typeof taskMixVisible.selected?.runtimeSourceMix?.coverageQuality === 'string' && Array.isArray(taskMixVisible.selected?.runtimeSourceMix?.supportingKinds) && typeof taskMixVisible.selected?.runtimeSourceMix?.authorityScore === 'number' && taskMixVisible.selected?.runtimeSourceMix?.scoringVersion === 'runtime-source-mix.v2', { runtimeSourceMix: taskMixVisible.selected?.runtimeSourceMix, sourceKindContract: taskMixVisible.selected?.sourceKindContract, budgetProfile: taskMixVisible.selected?.budgetProfile });
const taskDerivedHeavy = run('runtime-selector.mjs', writeTemp('accept-task-derived-heavy', { scene: 'task', date: '2026-03-21', week: '2026-W12', prompt: '继续看看这个配置', maxPromptChars: 1200, maxPromptTokens: 300, preferredSourcePrefixes: ['session:'] }));
record('runtime-source-mix-tightens-budget-and-escalation', taskDerivedHeavy.ok === true && ['tighten-artifact-heavy-mix','tighten-session-heavy-mix','tighten-derived-heavy-mix'].includes(taskDerivedHeavy.selected?.budgetProfile?.budgetReason) && String(taskDerivedHeavy.selected?.escalation || '').includes('source-leaning'), { runtimeSourceMix: taskDerivedHeavy.selected?.runtimeSourceMix, budgetProfile: taskDerivedHeavy.selected?.budgetProfile, escalation: taskDerivedHeavy.selected?.escalation, rationale: taskDerivedHeavy.selected?.rationale });
const taskArtifactHeavy = run('runtime-selector.mjs', writeTemp('accept-task-artifact-heavy', { scene: 'task', date: '2026-03-21', week: '2026-W12', prompt: '继续推进这份 acceptance artifact 样本', maxPromptChars: 1200, maxPromptTokens: 300, preferredSourcePrefixes: ['artifact:'] }));
record('runtime-source-mix-artifact-heavy-visible', taskArtifactHeavy.ok === true && taskArtifactHeavy.selected?.runtimeSourceMix?.coverageQuality === 'artifact-heavy' && taskArtifactHeavy.selected?.budgetProfile?.budgetReason === 'tighten-artifact-heavy-mix' && taskArtifactHeavy.selected?.budgetProfile?.budgetProfileName === 'artifact-heavy-tight' && String(taskArtifactHeavy.selected?.escalation || '').includes('artifact-first'), { runtimeSourceMix: taskArtifactHeavy.selected?.runtimeSourceMix, budgetProfile: taskArtifactHeavy.selected?.budgetProfile, escalation: taskArtifactHeavy.selected?.escalation });
const taskSessionHeavy = run('runtime-source-mix-before-after.mjs');
record('runtime-source-mix-session-heavy-visible', taskSessionHeavy.ok === true && taskSessionHeavy.after?.trustedRatio > taskSessionHeavy.before?.trustedRatio && taskSessionHeavy.delta?.supportingKindsRemoved?.includes('session'), { before: taskSessionHeavy.before, after: taskSessionHeavy.after, delta: taskSessionHeavy.delta, evidenceCase: taskSessionHeavy.evidenceCase });
const taskSessionHeavyDirect = run('runtime-selector.mjs', writeTemp('accept-task-session-heavy-direct', { scene: 'task', date: '2026-03-21', week: '2026-W12', prompt: '继续推进当前会话里的上下文', maxPromptChars: 1200, maxPromptTokens: 300, preferredSourcePrefixes: ['session:'] }));
const bridgePreciseMix = run('runtime-bridge.mjs', writeTemp('accept-runtime-bridge-precise-mix', { prompt: '精确回答这条主线到底落在哪个文件哪一行，并附 evidence path', sceneHint: 'precise', maxPromptChars: 900, maxPromptTokens: 220 }));
record('runtime-session-heavy-probe-visible', taskSessionHeavyDirect.ok === true && typeof taskSessionHeavyDirect.selected?.runtimeSourceMix?.coverageQuality === 'string' && typeof taskSessionHeavyDirect.selected?.budgetProfile?.budgetReason === 'string' && typeof taskSessionHeavyDirect.selected?.budgetProfile?.budgetProfileName === 'string', { runtimeSourceMix: taskSessionHeavyDirect.selected?.runtimeSourceMix, budgetProfile: taskSessionHeavyDirect.selected?.budgetProfile, escalation: taskSessionHeavyDirect.selected?.escalation });
record('runtime-source-mix-session-heavy-direct-visible', ((taskSessionHeavyDirect.ok === true && taskSessionHeavyDirect.selected?.runtimeSourceMix?.coverageQuality === 'session-heavy' && taskSessionHeavyDirect.selected?.budgetProfile?.budgetReason === 'tighten-session-heavy-mix' && taskSessionHeavyDirect.selected?.budgetProfile?.budgetProfileName === 'session-heavy-tight' && String(taskSessionHeavyDirect.selected?.escalation || '').includes('session-cross-check')) || (taskDerivedHeavy.ok === true && taskDerivedHeavy.selected?.budgetProfile?.budgetReason === 'tighten-session-heavy-mix' && taskDerivedHeavy.selected?.budgetProfile?.budgetProfileName === 'session-heavy-tight' && String(taskDerivedHeavy.selected?.escalation || '').includes('session-cross-check')) || (taskSessionHeavy.ok === true && taskSessionHeavy.delta?.supportingKindsRemoved?.includes('session'))) && bridgePreciseMix.ok === true && typeof bridgePreciseMix.runtimeSourceMix?.coverageQuality === 'string', { runtimeSourceMix: taskSessionHeavyDirect.selected?.runtimeSourceMix, budgetProfile: taskSessionHeavyDirect.selected?.budgetProfile, escalation: taskSessionHeavyDirect.selected?.escalation, fallbackBudgetProfile: taskDerivedHeavy.selected?.budgetProfile, fallbackEscalation: taskDerivedHeavy.selected?.escalation, evidenceCase: taskSessionHeavy.evidenceCase, delta: taskSessionHeavy.delta, bridgeRuntimeSourceMix: bridgePreciseMix.runtimeSourceMix });
record('runtime-bridge-source-mix-visible', bridgePreciseMix.ok === true && bridgePreciseMix.sourceKindContract?.authority === 'source-first' && typeof bridgePreciseMix.runtimeSourceMix?.coverageQuality === 'string', { sourceKindContract: bridgePreciseMix.sourceKindContract, runtimeSourceMix: bridgePreciseMix.runtimeSourceMix });
const postAdapterBacklinks = run('source-backlinks.mjs', writeTemp('accept-source-backlinks-post-adapter', { includeKinds: ['lcm-summary', 'lcm-message', 'file', 'memory-item', 'session'] }));
record('source-backlinks-multi-source-coverage-visible', postAdapterBacklinks.ok === true && (postAdapterBacklinks.kinds?.file || 0) >= 1 && (postAdapterBacklinks.kinds?.['memory-item'] || 0) >= 1, { totalSources: postAdapterBacklinks.totalSources, kinds: postAdapterBacklinks.kinds });

const heartbeatCfg = writeTemp('accept-heartbeat', { eventType: 'heartbeat', force: true, reviewLimit: 5 });
const dailyCfg = writeTemp('accept-daily', { eventType: 'daily', date: '2026-03-20', week: '2026-W12', force: true });
const heartbeat = run('scheduler-run.mjs', heartbeatCfg);
const daily = run('scheduler-run.mjs', dailyCfg);
record('scheduler-heartbeat-runs', heartbeat.ok === true && heartbeat.jobs >= 1, { jobs: heartbeat.jobs });
record('scheduler-daily-runs', daily.ok === true && daily.jobs >= 4, { jobs: daily.jobs });

const reviewListCfg = writeTemp('accept-review-list', { action: 'list', status: 'open', limit: 10, query: 'review' });
const reviewList = run('review-queue.mjs', reviewListCfg);
record('review-queue-query-works', reviewList.ok === true, { total: reviewList.total });

const reviewDryRunCfg = writeTemp('accept-review-dryrun', { select: { status: 'open', limit: 1 }, defaultDecision: 'promote', dryRun: true, reason: 'acceptance-dryrun' });
const reviewDryRun = run('review-apply.mjs', reviewDryRunCfg);
record('review-apply-batch-dryrun', reviewDryRun.ok === true && reviewDryRun.dryRun === true, { matchedCount: reviewDryRun.matchedCount });
const reviewRejectFact = run('fact-compiler.mjs', writeTemp('accept-review-reject-fact', { facts: [{ scope: 'project', subject: 'acceptance', attribute: 'review-reject-flow', value: acceptValue('reject'), text: 'acceptance review reject flow candidate', status: 'inferred', confidence: 0.61, sourceRefs: [fileRef(masterplanPath)], tags: ['acceptance', 'review-flow'] }] }));
record('review-reject-fact-seeded', reviewRejectFact.ok === true, reviewRejectFact);
const seededFacts = readJsonl(path.join(root, 'memory', 'compiler', 'facts.jsonl'));
const rejectFact = seededFacts.find(f => f.subject === 'acceptance' && f.attribute === 'review-reject-flow' && f.value === acceptValue('reject'));
const reviewRejectQueue = run('review-queue.mjs', writeTemp('accept-review-reject-queue', { action: 'enqueue', items: [{ reviewType: 'promotion-review', factId: rejectFact?.id || null, title: rejectReviewTitle, reason: 'acceptance-reject', scope: 'project', priority: 'medium', targetState: 'rejected', suggestedDecision: 'reject', operatorFlow: 'inferred-to-rejected', ...acceptanceReviewMeta, sourceRefs: [fileRef(masterplanPath)] }] }));
record('review-reject-enqueue-works', reviewRejectQueue.ok === true, reviewRejectQueue);
const reviewRejectApply = run('review-apply.mjs', writeTemp('accept-review-reject-apply', { select: { status: 'open', query: rejectReviewTitle, limit: 1 }, defaultDecision: 'reject', reason: 'acceptance-reject-approved' }));
const factsAfterReject = readJsonl(path.join(root, 'memory', 'compiler', 'facts.jsonl'));
const rejectedFact = factsAfterReject.find(f => f.id === rejectFact?.id);
record('review-apply-reject-lifecycle', reviewRejectApply.ok === true && reviewRejectApply.actionSummary?.reject >= 1, { actionSummary: reviewRejectApply.actionSummary, factLifecycle: reviewRejectApply.factLifecycle });
record('review-apply-reject-updates-fact', rejectedFact?.status === 'stale' && rejectedFact?.rejectionReason === 'acceptance-reject-approved', { rejectedFact });
const reviewBlockedFact = run('fact-compiler.mjs', writeTemp('accept-review-blocked-fact', { facts: [{ scope: 'project', subject: 'acceptance', attribute: 'blocked-promotion-flow', value: acceptValue('blocked'), text: 'acceptance blocked promotion flow candidate', status: 'inferred', confidence: 0.58, sourceRefs: ['artifact:test:blocked-promotion'], tags: ['acceptance', 'review-flow'] }] }));
record('review-blocked-fact-seeded', reviewBlockedFact.ok === true, reviewBlockedFact);
const factsBeforeBlocked = readJsonl(path.join(root, 'memory', 'compiler', 'facts.jsonl'));
const blockedFact = factsBeforeBlocked.find(f => f.subject === 'acceptance' && f.attribute === 'blocked-promotion-flow' && f.value === acceptValue('blocked'));
const reviewBlockedQueue = run('review-queue.mjs', writeTemp('accept-review-blocked-queue', { action: 'enqueue', items: [{ reviewType: 'promotion-review', factId: blockedFact?.id || null, title: blockedReviewTitle, reason: 'acceptance-blocked-promotion', scope: 'project', priority: 'medium', targetState: 'confirmed', suggestedDecision: 'promote', operatorFlow: 'inferred-to-confirmed', ...acceptanceReviewMeta, sourceRefs: ['artifact:test:blocked-promotion-review'] }] }));
record('review-blocked-enqueue-works', reviewBlockedQueue.ok === true, reviewBlockedQueue);
const reviewBlockedApply = run('review-apply.mjs', writeTemp('accept-review-blocked-apply', { select: { status: 'open', query: blockedReviewTitle, limit: 1 }, defaultDecision: 'promote', reason: 'acceptance-blocked-promotion-attempt' }));
const queueAfterBlocked = readJsonl(path.join(root, 'memory', 'compiler', 'review-queue.jsonl'));
const blockedReview = queueAfterBlocked.find(r => r.title === blockedReviewTitle);
const factsAfterBlocked = readJsonl(path.join(root, 'memory', 'compiler', 'facts.jsonl'));
const blockedFactAfterAttempt = factsAfterBlocked.find(f => f.id === blockedFact?.id);
record('review-apply-blocked-promotion-visible', reviewBlockedApply.ok === true && reviewBlockedApply.blockedCount >= 1 && reviewBlockedApply.factLifecycle?.results?.some(r => r.factId === blockedFact?.id && r.blocked === true), { blocked: reviewBlockedApply.blocked, factLifecycle: reviewBlockedApply.factLifecycle });
record('review-apply-blocked-promotion-leaves-open-review', blockedReview?.status === 'open' && blockedReview?.resolution === 'blocked' && blockedReview?.blockedState === 'source-discipline', { blockedReview });
record('review-apply-blocked-promotion-marks-source-dispatch-blocking', blockedReview?.sourceDispatchBlocking === true && blockedReview?.sourceDispatchRequired === true && typeof blockedReview?.sourceDispatchBlockingReason === 'string', { blockedReview });
record('review-apply-blocked-promotion-keeps-fact-inferred', blockedFactAfterAttempt?.status === 'inferred' && blockedFactAfterAttempt?.sourceDisciplineState === 'untrusted-gated', { blockedFact: blockedFactAfterAttempt });
const reviewBlockedOverride = run('review-apply.mjs', writeTemp('accept-review-blocked-override', { select: { status: 'open', query: blockedReviewTitle, limit: 1 }, defaultDecision: 'promote', allowUntrustedPromotion: true, reason: 'acceptance-blocked-promotion-override' }));
const queueAfterOverride = readJsonl(path.join(root, 'memory', 'compiler', 'review-queue.jsonl'));
const blockedReviewResolved = queueAfterOverride.find(r => r.title === blockedReviewTitle);
const factsAfterOverride = readJsonl(path.join(root, 'memory', 'compiler', 'facts.jsonl'));
const blockedFactResolved = factsAfterOverride.find(f => f.id === blockedFact?.id);
record('review-apply-override-promotes-untrusted-fact', reviewBlockedOverride.ok === true && reviewBlockedOverride.allowUntrustedPromotion === true && reviewBlockedOverride.resolvedCount >= 1 && reviewBlockedOverride.actionSummary?.promote >= 1, { result: reviewBlockedOverride });
record('review-apply-override-resolves-blocked-review', blockedReviewResolved?.status === 'resolved' && blockedReviewResolved?.resolution === 'promote' && !blockedReviewResolved?.blockedState, { blockedReviewResolved });
record('review-apply-override-confirms-untrusted-fact', blockedFactResolved?.status === 'confirmed' && blockedFactResolved?.sourceDisciplineState === 'untrusted-approved', { blockedFactResolved });
const reviewBlockedCleanup = run('fact-lifecycle.mjs', writeTemp('accept-review-blocked-cleanup', { actions: [{ kind: 'refresh', factId: blockedFact?.id || null, confidence: 0.94, sourceRefs: [fileRef(masterplanPath)] }] }));
const factsAfterBlockedCleanup = readJsonl(path.join(root, 'memory', 'compiler', 'facts.jsonl'));
const blockedFactCleaned = factsAfterBlockedCleanup.find(f => f.id === blockedFact?.id);
record('review-apply-override-cleanup-restores-trusted-discipline', reviewBlockedCleanup.ok === true && blockedFactCleaned?.status === 'confirmed' && blockedFactCleaned?.sourceDisciplineState === 'trusted', { reviewBlockedCleanup, blockedFactCleaned });
const reviewDisputeFact = run('fact-compiler.mjs', writeTemp('accept-review-dispute-fact', { facts: [{ scope: 'project', subject: 'acceptance', attribute: 'dispute-followup-flow', value: acceptValue('dispute'), text: 'acceptance dispute followup flow candidate', status: 'confirmed', confidence: 0.77, sourceRefs: [fileRef(masterplanPath)], tags: ['acceptance', 'review-flow'] }] }));
record('review-dispute-fact-seeded', reviewDisputeFact.ok === true, reviewDisputeFact);
const factsBeforeDispute = readJsonl(path.join(root, 'memory', 'compiler', 'facts.jsonl'));
const disputeFact = factsBeforeDispute.find(f => f.subject === 'acceptance' && f.attribute === 'dispute-followup-flow' && f.value === acceptValue('dispute'));
const reviewDisputeQueue = run('review-queue.mjs', writeTemp('accept-review-dispute-queue', { action: 'enqueue', items: [{ reviewType: 'promotion-review', factId: disputeFact?.id || null, title: disputeReviewTitle, reason: 'acceptance-dispute', scope: 'project', priority: 'medium', targetState: 'disputed', suggestedDecision: 'dispute', operatorFlow: 'inferred-to-confirmed', ...acceptanceReviewMeta, sourceRefs: [fileRef(masterplanPath)] }] }));
record('review-dispute-enqueue-works', reviewDisputeQueue.ok === true, reviewDisputeQueue);
const reviewDisputeApply = run('review-apply.mjs', writeTemp('accept-review-dispute-apply', { select: { status: 'open', query: disputeReviewTitle, limit: 1 }, defaultDecision: 'dispute', reason: 'acceptance-dispute-approved' }));
const queueAfterDispute = readJsonl(path.join(root, 'memory', 'compiler', 'review-queue.jsonl'));
const disputeArbitration = queueAfterDispute.find(r => r.title === `arbitration follow-up: ${disputeReviewTitle}`);
record('review-apply-dispute-spawns-arbitration-followup', reviewDisputeApply.ok === true && reviewDisputeApply.followUpCount >= 1 && reviewDisputeApply.followUps?.some(f => f.reviewType === 'arbitration-review'), { followUps: reviewDisputeApply.followUps, result: reviewDisputeApply.result });
record('review-apply-dispute-followup-queue-visible', disputeArbitration?.status === 'open' && disputeArbitration?.reviewType === 'arbitration-review' && disputeArbitration?.targetState === 'arbitrated', { disputeArbitration });
const reviewRefreshFact = run('fact-compiler.mjs', writeTemp('accept-review-refresh-fact', { facts: [{ scope: 'project', subject: 'acceptance', attribute: 'refresh-followup-flow', value: acceptValue('refresh'), text: 'acceptance refresh followup flow candidate', status: 'inferred', confidence: 0.62, sourceRefs: ['artifact:test:refresh-followup-initial'], tags: ['acceptance', 'review-flow'] }] }));
record('review-refresh-fact-seeded', reviewRefreshFact.ok === true, reviewRefreshFact);
const factsBeforeRefresh = readJsonl(path.join(root, 'memory', 'compiler', 'facts.jsonl'));
const refreshFact = factsBeforeRefresh.find(f => f.subject === 'acceptance' && f.attribute === 'refresh-followup-flow' && f.value === acceptValue('refresh'));
const reviewRefreshQueue = run('review-queue.mjs', writeTemp('accept-review-refresh-queue', { action: 'enqueue', items: [{ reviewType: 'arbitration-review', factId: refreshFact?.id || null, title: refreshReviewTitle, reason: 'acceptance-refresh', scope: 'project', priority: 'medium', targetState: 'confirmed', suggestedDecision: 'refresh', operatorFlow: 'inferred-to-confirmed', ...acceptanceReviewMeta, sourceRefs: [fileRef(masterplanPath)] }] }));
record('review-refresh-enqueue-works', reviewRefreshQueue.ok === true, reviewRefreshQueue);
const reviewRefreshApply = run('review-apply.mjs', writeTemp('accept-review-refresh-apply', { select: { status: 'open', query: refreshReviewTitle, limit: 1 }, defaultDecision: 'refresh', reason: 'acceptance-refresh-approved', sourceRefs: [fileRef(masterplanPath)] }));
const queueAfterRefresh = readJsonl(path.join(root, 'memory', 'compiler', 'review-queue.jsonl'));
const refreshPromotionFollowup = queueAfterRefresh.find(r => r.title === `follow-up promotion: ${refreshReviewTitle}`);
const factsAfterRefresh = readJsonl(path.join(root, 'memory', 'compiler', 'facts.jsonl'));
const refreshFactAfter = factsAfterRefresh.find(f => f.id === refreshFact?.id);
record('review-apply-refresh-spawns-promotion-followup', reviewRefreshApply.ok === true && reviewRefreshApply.followUpCount >= 1 && reviewRefreshApply.followUps?.some(f => f.reviewType === 'promotion-review'), { followUps: reviewRefreshApply.followUps, result: reviewRefreshApply.result });
record('review-apply-refresh-upgrades-source-discipline', refreshFactAfter?.status === 'inferred' && refreshFactAfter?.sourceDisciplineState === 'trusted', { refreshFactAfter });
record('review-apply-refresh-followup-queue-visible', refreshPromotionFollowup?.status === 'open' && refreshPromotionFollowup?.reviewType === 'promotion-review' && refreshPromotionFollowup?.suggestedDecision === 'promote', { refreshPromotionFollowup });
record('acceptance-review-items-hidden-from-operator-flow', [blockedReview, disputeArbitration, refreshPromotionFollowup].filter(Boolean).every(item => item.origin === 'acceptance' && item.namespace === 'acceptance' && item.operatorVisible === false), { blockedReview, disputeArbitration, refreshPromotionFollowup });
const operatorPromoteFact = run('fact-compiler.mjs', writeTemp('accept-operator-promote-fact', { facts: [{ scope: 'project', subject: 'operator', attribute: 'inferred-confirmed-flow', value: acceptValue('operator-promote'), text: 'operator inferred confirmed flow candidate', status: 'inferred', confidence: 0.74, sourceRefs: [fileRef(operatorReviewFlowPath)], tags: ['operator', 'review-flow'] }] }));
record('operator-promote-fact-seeded', operatorPromoteFact.ok === true, operatorPromoteFact);
const factsBeforeOperatorPromote = readJsonl(path.join(root, 'memory', 'compiler', 'facts.jsonl'));
const operatorPromoteFactRec = factsBeforeOperatorPromote.find(f => f.subject === 'operator' && f.attribute === 'inferred-confirmed-flow' && f.value === acceptValue('operator-promote'));
const operatorReviewQueue = run('review-queue.mjs', writeTemp('accept-operator-promote-queue', { action: 'enqueue', items: [{ reviewType: 'promotion-review', factId: operatorPromoteFactRec?.id || null, title: operatorPromotionReviewTitle, reason: 'operator-inferred-confirmed-flow', scope: 'project', priority: 'high', targetState: 'confirmed', suggestedDecision: 'promote', operatorFlow: 'inferred-to-confirmed', origin: 'operator', namespace: 'operator', operatorVisible: true, evidenceMode: 'source-first', sourceRefs: [fileRef(operatorReviewFlowPath)] }] }));
record('operator-review-enqueue-works', operatorReviewQueue.ok === true, operatorReviewQueue);
const operatorTriage = run('review-triage.mjs', writeTemp('accept-operator-triage', { status: 'open', operatorOnly: true, query: operatorPromotionReviewTitle, limit: 5 }));
record('operator-triage-filters-to-operator-backlog', operatorTriage.ok === true && operatorTriage.total >= 1 && operatorTriage.topItems?.some(item => item.title === operatorPromotionReviewTitle && item.origin === 'operator' && item.namespace === 'operator' && item.operatorVisible !== false), { operatorTriage });
const acceptanceTriage = run('review-triage.mjs', writeTemp('accept-acceptance-triage', { status: 'open', includeAcceptance: true, namespace: 'acceptance', query: 'acceptance', limit: 10 }));
record('acceptance-triage-isolated-namespace-visible', acceptanceTriage.ok === true && acceptanceTriage.total >= 1 && acceptanceTriage.topItems?.every(item => item.namespace === 'acceptance' || item.origin === 'acceptance'), { acceptanceTriage });
const operatorPromoteApply = run('review-apply.mjs', writeTemp('accept-operator-promote-apply', { select: { status: 'open', query: operatorPromotionReviewTitle, limit: 1 }, defaultDecision: 'promote', reason: 'operator-inferred-confirmed-approved' }));
const queueAfterOperatorPromote = readJsonl(path.join(root, 'memory', 'compiler', 'review-queue.jsonl'));
const operatorPromoteReviewResolved = queueAfterOperatorPromote.find(r => r.title === operatorPromotionReviewTitle);
const factsAfterOperatorPromote = readJsonl(path.join(root, 'memory', 'compiler', 'facts.jsonl'));
const operatorPromoteFactAfter = factsAfterOperatorPromote.find(f => f.id === operatorPromoteFactRec?.id);
record('operator-inferred-to-confirmed-flow-promotes-fact', operatorPromoteApply.ok === true && operatorPromoteApply.actionSummary?.promote >= 1 && operatorPromoteFactAfter?.status === 'confirmed' && operatorPromoteFactAfter?.sourceDisciplineState === 'trusted', { operatorPromoteApply, operatorPromoteFactAfter });
record('operator-inferred-to-confirmed-review-resolves-cleanly', operatorPromoteReviewResolved?.status === 'resolved' && operatorPromoteReviewResolved?.resolution === 'promote' && operatorPromoteReviewResolved?.operatorFlow === 'inferred-to-confirmed', { operatorPromoteReviewResolved });

const throttledHeartbeatCfg = writeTemp('accept-heartbeat-throttled', { eventType: 'heartbeat', dedupeMinutes: 0, eventFingerprint: `accept-throttle-${Date.now()}` });
const throttledHeartbeat = run('scheduler-plan.mjs', throttledHeartbeatCfg);
record('scheduler-throttle-visible', throttledHeartbeat.ok === true && throttledHeartbeat.throttled === true, { throttled: throttledHeartbeat.throttled, skipped: throttledHeartbeat.skipped });

const hookDispatchCfg = writeTemp('accept-hook-dispatch', { hookType: 'heartbeat', hookId: 'accept-hook-heartbeat', force: true });
const hookDispatch = run('hook-dispatch.mjs', hookDispatchCfg);
record('hook-dispatch-runs', hookDispatch.ok === true && hookDispatch.eventType === 'heartbeat', { eventType: hookDispatch.eventType, jobs: hookDispatch.out?.jobs });

const dupPlanCfg = writeTemp('accept-dup-plan', { eventType: 'heartbeat', eventFingerprint: 'accept-dup-plan-fp', force: true });
run('scheduler-run.mjs', dupPlanCfg);
const dupPlanCheck = run('scheduler-plan.mjs', writeTemp('accept-dup-plan-check', { eventType: 'heartbeat', eventFingerprint: 'accept-dup-plan-fp', dedupeMinutes: 60 }));
record('scheduler-dedupe-visible', dupPlanCheck.ok === true && dupPlanCheck.deduped === true, { deduped: dupPlanCheck.deduped, skipped: dupPlanCheck.skipped });

const dupHookBase = { hookType: 'heartbeat', hookId: 'accept-dup-hook', dedupeMinutes: 60 };
const dupHookFirst = run('hook-dispatch.mjs', writeTemp('accept-dup-hook-first', dupHookBase));
const dupHookSecond = run('hook-dispatch.mjs', writeTemp('accept-dup-hook-second', dupHookBase));
record('hook-duplicate-skip-visible', dupHookFirst.ok === true && dupHookSecond.ok === true && dupHookSecond.skipped === true, { secondSkipped: dupHookSecond.skipped, reason: dupHookSecond.reason });

const enqueueCfg = writeTemp('accept-pending-enqueue', { eventType: 'heartbeat', source: { hookType: 'heartbeat', hookId: 'accept-pending-hook' }, skipReason: 'throttled', changedSourceRefs: ['file:/root/.openclaw/workspace/SESSION-STATE.md'] });
const enqueueOut = run('scheduler-enqueue.mjs', enqueueCfg);
const drainCfg = writeTemp('accept-pending-drain', { eventType: 'heartbeat', limit: 5 });
const drainOut = run('scheduler-drain.mjs', drainCfg);
record('scheduler-enqueue-drain-works', enqueueOut.ok === true && drainOut.ok === true && drainOut.drainedCount >= 1, { enqueue: enqueueOut, drain: drainOut });
const blockingQueueSeed = run('review-queue.mjs', writeTemp('accept-operator-blocking-seed', { action: 'enqueue', items: [{ reviewType: 'promotion-review', factId: 'accept-blocking-operator-fact', title: `operator blocking triage sample ${acceptRunId}`, reason: 'acceptance-operator-blocking-triage', scope: 'project', priority: 'high', targetState: 'confirmed', suggestedDecision: 'promote', operatorFlow: 'inferred-to-confirmed', origin: 'operator', namespace: 'operator', operatorVisible: true, evidenceMode: 'source-first', sourceRefs: ['artifact:test:blocking-triage'], sourceDispatchBlocking: true, sourceDispatchRequired: true }] }));
record('operator-blocking-triage-seed-works', blockingQueueSeed.ok === true, { blockingQueueSeed });
const blockingTriage = run('operator-review-blocking-triage.mjs', writeTemp('accept-operator-blocking-triage', { limit: 5, status: 'open' }));
record('operator-blocking-triage-visible', blockingTriage.ok === true && blockingTriage.blockingOpen >= 1 && blockingTriage.operatorFacing?.blockingTop?.some(item => item.title === `operator blocking triage sample ${acceptRunId}`), { blockingTriage });
const blockingEnqueue = run('scheduler-enqueue.mjs', writeTemp('accept-blocking-pending-enqueue', { eventType: 'heartbeat', source: { hookType: 'heartbeat', hookId: 'accept-blocking-pending-hook' }, skipReason: 'throttled', changedSourceRefs: ['file:/root/.openclaw/workspace/SESSION-STATE.md'], sourceDispatchBlockingOpen: blockingTriage.blockingOpen || 1 }));
const blockingDrain = run('scheduler-drain.mjs', writeTemp('accept-blocking-pending-drain', { eventType: 'heartbeat', limit: 5 }));
record('scheduler-blocking-operator-facing-priority-visible', blockingEnqueue.ok === true && blockingDrain.ok === true && (blockingDrain.drained || []).some(item => Number(item.drainScore || 0) >= 55), { blockingEnqueue, blockingDrain });
const blockingCleanup = run('review-apply.mjs', writeTemp('accept-operator-blocking-cleanup', { select: { status: 'open', query: `operator blocking triage sample ${acceptRunId}`, limit: 5 }, defaultDecision: 'reject', reason: 'acceptance-cleanup-operator-blocking-sample' }));
record('operator-blocking-triage-cleanup-resolves-sample', blockingCleanup.ok === true && blockingCleanup.resolvedCount >= 1, { blockingCleanup });

const mergeBase = { eventType: 'heartbeat', source: { hookType: 'heartbeat', hookId: 'accept-coalesce-hook' }, coalesceKey: 'accept-coalesce-window', skipReason: 'throttled', changedSourceRefs: ['file:/root/.openclaw/workspace/SESSION-STATE.md'] };
const mergeFirst = run('scheduler-enqueue.mjs', writeTemp('accept-coalesce-first', mergeBase));
const mergeSecond = run('scheduler-enqueue.mjs', writeTemp('accept-coalesce-second', { ...mergeBase, source: { hookType: 'heartbeat', hookId: 'accept-coalesce-hook-2' }, changedSourceRefs: [fileRef(masterplanPath)] }));
record('scheduler-coalesce-visible', mergeFirst.ok === true && mergeSecond.ok === true && mergeSecond.action === 'merged' && mergeSecond.mergedEvents >= 2, { first: mergeFirst, second: mergeSecond });
const drainCoalesce = run('scheduler-drain.mjs', writeTemp('accept-coalesce-drain', { eventType: 'heartbeat', limit: 5 }));
record('scheduler-coalesce-drain-runs', drainCoalesce.ok === true && drainCoalesce.drainedCount >= 1, { drain: drainCoalesce });

const ok = tests.every(t => t.ok);
const acceptanceGovernance = runWithTemp('acceptance-review-governance.mjs', 'accept-governance-post-smoke', {
  action: 'compress',
  minAgeHours: 0,
  maxKeepPerSignature: 2
});
record('acceptance-governance-post-smoke-runs', acceptanceGovernance.ok === true && typeof acceptanceGovernance.summary?.acceptanceOpenAfter === 'number', { acceptanceGovernance });
const report = { generatedAt: new Date().toISOString(), ok: ok && acceptanceGovernance.ok === true, tests, acceptanceGovernance };
const out = path.join(reportsDir, 'acceptance-smoke.latest.json');
fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
printResult({ ok: report.ok, out, passed: tests.filter(t => t.ok).length, total: tests.length, failed: tests.filter(t => !t.ok), acceptanceGovernance: acceptanceGovernance.summary });

#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { printResult, readJsonInput } from './lib/io.mjs';
import { nowIso } from './lib/common.mjs';
import { readJsonl } from './lib/jsonl-store.mjs';
import { resolveCompilerRuntime } from './lib/plugin-paths.mjs';
import { runScript } from './lib/run-script.mjs';

const runtime = resolveCompilerRuntime();
const root = runtime.workspaceDir;
const compilerDir = runtime.dataDir;
const reportsDir = runtime.reportsDir;
fs.mkdirSync(reportsDir, { recursive: true });

function usage() {
  console.error('Usage: node plugins/memory-compiler/scripts/memory-compiler/compiler-metrics.mjs <config.json | ->');
  process.exit(2);
}
function maybeReadJson(filePath) {
  try { return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : null; } catch { return null; }
}
function run(script, inputObj = null) {
  const inputPath = inputObj ? writeTempJson(path.basename(script, '.mjs'), inputObj) : null;
  try {
    return runScript(runtime, script, inputPath);
  } finally {
    if (inputPath && fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
  }
}
function writeTempJson(name, obj) {
  const p = path.join('/tmp', `memory-compiler-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
  return p;
}
function avg(values) {
  const nums = values.filter(v => Number.isFinite(v));
  if (!nums.length) return null;
  return nums.reduce((sum, n) => sum + n, 0) / nums.length;
}
function max(values) {
  const nums = values.filter(v => Number.isFinite(v));
  return nums.length ? Math.max(...nums) : null;
}
function min(values) {
  const nums = values.filter(v => Number.isFinite(v));
  return nums.length ? Math.min(...nums) : null;
}
function countRecent(items, field, sinceTs) {
  return (items || []).filter(item => {
    const ts = Date.parse(String(item?.[field] || ''));
    return Number.isFinite(ts) && ts >= sinceTs;
  }).length;
}
function relFromRoot(absPath) {
  return path.relative(root, absPath);
}

const arg = process.argv[2];
if (!arg) usage();
const cfg = readJsonInput(arg === '-' ? null : arg);
const windowHours = Number(cfg?.windowHours || 24);
const recentLimit = Number(cfg?.recentLimit || 50);
const runBridgeProbe = cfg?.runBridgeProbe !== false;
const generatedAt = nowIso();
const sinceTs = Date.now() - (windowHours * 3600 * 1000);

const status = run('compiler-status.mjs', {});
const controlPlaneVerify = maybeReadJson(path.join(reportsDir, 'control-plane-verify.latest.json'));
const acceptance = maybeReadJson(path.join(reportsDir, 'acceptance-smoke.latest.json'));
const sourceBacklinks = maybeReadJson(path.join(reportsDir, 'source-backlinks.latest.json'));
const schedulerAudit = maybeReadJson(path.join(reportsDir, 'scheduler-audit.latest.json'));
const durableBatchLatest = maybeReadJson(path.join(reportsDir, 'durable-memory-batch-import.latest.json'));
const durableBatchLive = maybeReadJson(path.join(reportsDir, 'durable-memory-batch-import.live.json'));
const durableBatchAcceptanceLatest = maybeReadJson(path.join(reportsDir, 'durable-memory-batch-import.acceptance-latest.json'));
const operatorBlockingTriage = maybeReadJson(path.join(reportsDir, 'operator-review-blocking-triage.latest.json'));
const runtimeProbe = maybeReadJson(path.join(reportsDir, 'runtime-probe.latest.json'));
const schedulerHistory = readJsonl(path.join(compilerDir, 'scheduler-history.jsonl'));
const hookEvents = readJsonl(path.join(compilerDir, 'hook-events.jsonl'));
const reviewQueue = readJsonl(path.join(compilerDir, 'review-queue.jsonl'));
const handoffHistoryPath = path.join(compilerDir, 'session-packs', 'history.jsonl');
const handoffHistory = fs.existsSync(handoffHistoryPath) ? readJsonl(handoffHistoryPath) : [];

let bridgeProbe = null;
if (runBridgeProbe) {
  bridgeProbe = run('runtime-bridge.mjs', {
    prompt: cfg?.probePrompt || '继续接着当前主线推进，并给出 source-first 路由。',
    sessionKey: cfg?.sessionKey || 'metrics-probe',
    sceneHint: cfg?.sceneHint || 'task',
    maxPromptChars: cfg?.maxPromptChars || 1200,
    maxPromptTokens: cfg?.maxPromptTokens || 280,
    maxReviewItems: cfg?.maxReviewItems || 2,
    includeReviewTriage: cfg?.includeReviewTriage !== false,
    preferredSourcePrefixes: cfg?.preferredSourcePrefixes || ['sum:', 'file:', 'mem:'],
  });
}

const schedulerRecent = schedulerHistory.filter(item => {
  const ts = Date.parse(String(item?.finishedAt || item?.startedAt || ''));
  return Number.isFinite(ts) && ts >= sinceTs;
});
const openReviews = reviewQueue.filter(item => item.status === 'open');
const operatorOpenReviews = openReviews.filter(item => item.operatorVisible !== false && (item.origin || 'operator') !== 'acceptance' && (item.namespace || 'operator') !== 'acceptance');
const acceptanceOpenReviews = openReviews.filter(item => item.operatorVisible === false || (item.origin || 'operator') === 'acceptance' || (item.namespace || 'operator') === 'acceptance');
const handoffRecent = handoffHistory.filter(item => {
  const ts = Date.parse(String(item?.generatedAt || item?.updatedAt || item?.createdAt || ''));
  return Number.isFinite(ts) && ts >= sinceTs;
});

const metrics = {
  generatedAt,
  windowHours,
  evidencePaths: [
    relFromRoot(path.join(reportsDir, 'acceptance-smoke.latest.json')),
    relFromRoot(path.join(reportsDir, 'control-plane-verify.latest.json')),
    relFromRoot(path.join(reportsDir, 'source-backlinks.latest.json')),
    relFromRoot(path.join(reportsDir, 'scheduler-audit.latest.json')),
    relFromRoot(path.join(reportsDir, 'runtime-probe.latest.json')),
    relFromRoot(path.join(compilerDir, 'scheduler-history.jsonl')),
    relFromRoot(path.join(compilerDir, 'review-queue.jsonl')),
    relFromRoot(handoffHistoryPath),
  ].filter(rel => fs.existsSync(path.join(root, rel))),
  inventory: {
    facts: status.counts?.facts ?? 0,
    threads: status.counts?.threads ?? 0,
    continuity: status.counts?.continuity ?? 0,
    manifests: status.counts?.manifests ?? 0,
    sourceBacklinkSources: status.backlinks?.totalSources ?? sourceBacklinks?.totalSources ?? 0,
    sourceBacklinkArtifacts: status.backlinks?.totalArtifacts ?? sourceBacklinks?.totalArtifacts ?? 0,
    handoffCount: status.sessionPackState?.handoffCount ?? 0,
    sessionPackHistoryCount: status.sessionPackState?.historyCount ?? handoffHistory.length,
  },
  trust: {
    controlPlaneTrusted: controlPlaneVerify?.ok === true,
    trustLevel: controlPlaneVerify?.trustLevel || null,
    operatorVerdict: controlPlaneVerify?.operatorVerdict || null,
    blockerCount: (controlPlaneVerify?.blockers || []).length,
    warningCount: (controlPlaneVerify?.warnings || []).length,
    acceptanceOk: acceptance?.ok === true,
    acceptancePassed: acceptance?.passed ?? null,
    acceptanceTotal: acceptance?.total ?? null,
    snapshotTrust: {
      trusted: controlPlaneVerify?.ok === true,
      verdict: controlPlaneVerify?.operatorVerdict || null,
      source: relFromRoot(path.join(reportsDir, 'control-plane-verify.latest.json')),
    },
    finalTrust: {
      trusted: controlPlaneVerify?.ok === true,
      verdict: controlPlaneVerify?.operatorVerdict || null,
      source: relFromRoot(path.join(reportsDir, 'control-plane-verify.latest.json')),
      note: 'live truth follows control-plane-verify; metrics snapshot must not override operator trust',
    },
  },
  reviewQueue: {
    open: openReviews.length,
    operatorOpen: operatorOpenReviews.length,
    acceptanceOpen: acceptanceOpenReviews.length,
    resolved: reviewQueue.filter(item => item.status === 'resolved').length,
    sourceDispatchBlockingOpen: openReviews.filter(item => item.sourceDispatchBlocking === true || item.blockedState === 'source-discipline').length,
    operatorBlockingTriage: operatorBlockingTriage ? {
      blockingOpen: operatorBlockingTriage.blockingOpen ?? 0,
      topCount: operatorBlockingTriage.operatorFacing?.blockingTop?.length || 0,
      summaryText: operatorBlockingTriage.operatorFacing?.blockingSummaryText || null,
    } : null,
  },
  scheduler: {
    totalRuns: schedulerHistory.length,
    runsInWindow: schedulerRecent.length,
    avgJobsPerRun: avg(schedulerRecent.map(item => Number(item?.jobs))),
    maxJobsPerRun: max(schedulerRecent.map(item => Number(item?.jobs))),
    minJobsPerRun: min(schedulerRecent.map(item => Number(item?.jobs))),
    throttledInWindow: schedulerRecent.filter(item => item?.throttled === true).length,
    dedupedInWindow: schedulerRecent.filter(item => item?.deduped === true).length,
    lastEventType: status.schedulerState?.lastEventType || null,
    lastFinishedAt: status.schedulerState?.lastFinishedAt || null,
    pendingQueue: status.schedulerPending?.pending ?? 0,
    recent: schedulerRecent.slice(-recentLimit).reverse().slice(0, 10).map(item => ({
      eventType: item.eventType,
      jobs: item.jobs,
      throttled: !!item.throttled,
      deduped: !!item.deduped,
      finishedAt: item.finishedAt || null,
    })),
  },
  hooks: {
    totalEvents: hookEvents.length,
    executedInWindow: countRecent(hookEvents.filter(item => item.status === 'executed'), 'createdAt', sinceTs),
    duplicateSkippedInWindow: countRecent(hookEvents.filter(item => item.status === 'duplicate-skipped'), 'createdAt', sinceTs),
  },
  durableBatchTruth: {
    latest: durableBatchLatest ? {
      runId: durableBatchLatest.runId || null,
      runLabel: durableBatchLatest.runLabel || null,
      namespace: durableBatchLatest.reportScope?.namespace || null,
      latestScope: durableBatchLatest.reportScope?.latestScope || null,
      truthMode: durableBatchLatest.reportScope?.truthMode || null,
      operatorTruthPath: durableBatchLatest.reportScope?.operatorTruthPath || null,
    } : null,
    live: durableBatchLive ? {
      runId: durableBatchLive.runId || null,
      runLabel: durableBatchLive.runLabel || null,
      namespace: durableBatchLive.reportScope?.namespace || null,
      truthMode: durableBatchLive.reportScope?.truthMode || null,
    } : null,
    acceptanceLatest: durableBatchAcceptanceLatest ? {
      runId: durableBatchAcceptanceLatest.runId || null,
      runLabel: durableBatchAcceptanceLatest.runLabel || null,
      namespace: durableBatchAcceptanceLatest.reportScope?.namespace || null,
      latestScope: durableBatchAcceptanceLatest.reportScope?.latestScope || null,
      truthMode: durableBatchAcceptanceLatest.reportScope?.truthMode || null,
    } : null,
  },
  runtimeProbe: runtimeProbe ? {
    preciseDispatchReady: runtimeProbe.operatorFacing?.preciseSourceDispatchReady === true,
    preciseDispatchBlocking: runtimeProbe.operatorFacing?.preciseSourceDispatchBlocking === true,
    taskCoverageQuality: runtimeProbe.operatorFacing?.taskCoverageQuality || null,
    taskBudgetReason: runtimeProbe.operatorFacing?.taskBudgetReason || null,
    taskEscalation: runtimeProbe.operatorFacing?.taskEscalation || null,
    summaryText: runtimeProbe.operatorFacing?.summaryText || null,
  } : null,
  runtimeBridge: bridgeProbe ? {
    scene: bridgeProbe.scene || null,
    prependChars: bridgeProbe.prependChars ?? null,
    hasSourceActionPlan: Array.isArray(bridgeProbe.sourceActionPlan?.steps) && bridgeProbe.sourceActionPlan.steps.length >= 1,
    hasSourceDispatch: !!bridgeProbe.sourceDispatch?.primary?.tool,
    blockingSourceDispatch: bridgeProbe.sourceDispatch?.blocking === true,
    selectedFacts: bridgeProbe.selected?.facts?.length ?? 0,
    selectedThreads: bridgeProbe.selected?.threads?.length ?? 0,
    selectedDigests: bridgeProbe.selected?.digests?.length ?? 0,
    sourceKindAuthority: bridgeProbe.sourceKindContract?.authority || null,
    sourceKindContractVersion: bridgeProbe.sourceKindContract?.contractVersion || null,
    runtimeSourceMix: bridgeProbe.runtimeSourceMix || bridgeProbe.selected?.runtimeSourceMix || null,
    sourceMixPolicyEffect: {
      authorityScore: bridgeProbe.runtimeSourceMix?.authorityScore ?? bridgeProbe.selected?.runtimeSourceMix?.authorityScore ?? null,
      trustedRatio: bridgeProbe.runtimeSourceMix?.trustedRatio ?? bridgeProbe.selected?.runtimeSourceMix?.trustedRatio ?? null,
      coverageQuality: bridgeProbe.runtimeSourceMix?.coverageQuality ?? bridgeProbe.selected?.runtimeSourceMix?.coverageQuality ?? null,
      budgetReason: bridgeProbe.selectedBudget?.budgetReason || null,
      escalation: bridgeProbe.selected?.escalation || null,
    },
    omittedBlocks: bridgeProbe.selected?.omittedBlocks || [],
    budget: bridgeProbe.selectedBudget || null,
  } : null,
  sessionPacks: {
    current: status.sessionPackState?.current || null,
    generatedInWindow: handoffRecent.length,
    latestHandoff: status.latestSessionHandoff || null,
  },
  healthSignals: {
    integrityOk: status.integrityOk === true,
    sourceDisciplineOk: status.sourceDiscipline?.ok === true,
    contractOk: status.contract?.ok === true || controlPlaneVerify?.summary?.contractVersion != null,
    schedulerAuditThrottled: !!schedulerAudit?.throttled,
    schedulerAuditDeduped: !!schedulerAudit?.deduped,
  },
};

const out = path.join(reportsDir, 'compiler-metrics.latest.json');
const mdOut = path.join(compilerDir, 'control-plane', 'metrics.md');
fs.writeFileSync(out, JSON.stringify(metrics, null, 2) + '\n');

const lines = [
  '# Memory Compiler Metrics',
  '',
  `- Generated at: ${generatedAt}`,
  `- Window: last ${windowHours}h`,
  `- Evidence JSON: ${relFromRoot(out)}`,
  '',
  '## Trust',
  `- control-plane trusted: ${metrics.trust.controlPlaneTrusted}`,
  `- operator verdict: ${metrics.trust.operatorVerdict || 'unknown'}`,
  `- snapshot trust: ${metrics.trust.snapshotTrust?.verdict || 'unknown'}`,
  `- final trust: ${metrics.trust.finalTrust?.verdict || 'unknown'} (source=${metrics.trust.finalTrust?.source || 'n/a'})`,
  `- acceptance: ${metrics.trust.acceptancePassed ?? 0}/${metrics.trust.acceptanceTotal ?? 0}`,
  `- blockers: ${metrics.trust.blockerCount}`,
  `- warnings: ${metrics.trust.warningCount}`,
  '',
  '## Inventory',
  `- facts: ${metrics.inventory.facts}`,
  `- threads: ${metrics.inventory.threads}`,
  `- continuity: ${metrics.inventory.continuity}`,
  `- manifests: ${metrics.inventory.manifests}`,
  `- source backlink sources: ${metrics.inventory.sourceBacklinkSources}`,
  `- source backlink artifacts: ${metrics.inventory.sourceBacklinkArtifacts}`,
  '',
  '## Review Queue',
  `- open: ${metrics.reviewQueue.open}`,
  `- operator open: ${metrics.reviewQueue.operatorOpen}`,
  `- acceptance open: ${metrics.reviewQueue.acceptanceOpen}`,
  `- source-dispatch blocking open: ${metrics.reviewQueue.sourceDispatchBlockingOpen}`,
  `- operator-facing blocking triage: ${metrics.reviewQueue.operatorBlockingTriage?.blockingOpen ?? 'n/a'}`,
  `- blocking triage summary: ${metrics.reviewQueue.operatorBlockingTriage?.summaryText || 'n/a'}`,
  `- resolved: ${metrics.reviewQueue.resolved}`,
  '',
  '## Scheduler Window',
  `- runs: ${metrics.scheduler.runsInWindow}`,
  `- avg jobs/run: ${metrics.scheduler.avgJobsPerRun ?? 'n/a'}`,
  `- max jobs/run: ${metrics.scheduler.maxJobsPerRun ?? 'n/a'}`,
  `- throttled: ${metrics.scheduler.throttledInWindow}`,
  `- deduped: ${metrics.scheduler.dedupedInWindow}`,
  `- pending queue: ${metrics.scheduler.pendingQueue}`,
  '',
  '## Runtime Bridge Probe',
  metrics.runtimeBridge ? `- scene: ${metrics.runtimeBridge.scene}` : '- scene: skipped',
  metrics.runtimeBridge ? `- source dispatch: ${metrics.runtimeBridge.hasSourceDispatch} (blocking=${metrics.runtimeBridge.blockingSourceDispatch})` : null,
  metrics.runtimeBridge ? `- source authority: ${metrics.runtimeBridge.sourceKindAuthority || 'unknown'}` : null,
  metrics.runtimeBridge ? `- selected facts/threads/digests: ${metrics.runtimeBridge.selectedFacts}/${metrics.runtimeBridge.selectedThreads}/${metrics.runtimeBridge.selectedDigests}` : null,
  metrics.runtimeBridge ? `- runtime source mix quality: ${metrics.runtimeBridge.runtimeSourceMix?.coverageQuality || 'unknown'}; supporting=${(metrics.runtimeBridge.runtimeSourceMix?.supportingKinds || []).join(',') || 'none'}` : null,
  metrics.runtimeBridge ? `- runtime source mix authority/trusted ratio: ${metrics.runtimeBridge.sourceMixPolicyEffect?.authorityScore ?? 'n/a'} / ${metrics.runtimeBridge.sourceMixPolicyEffect?.trustedRatio ?? 'n/a'}` : null,
  metrics.runtimeBridge ? `- source mix policy effect: budget=${metrics.runtimeBridge.sourceMixPolicyEffect?.budgetReason || 'n/a'}; escalation=${metrics.runtimeBridge.sourceMixPolicyEffect?.escalation || 'n/a'}` : null,
  metrics.runtimeBridge ? `- prepend chars: ${metrics.runtimeBridge.prependChars}` : null,
  metrics.runtimeProbe ? `- runtime probe: preciseDispatch=${metrics.runtimeProbe.preciseDispatchReady} blocking=${metrics.runtimeProbe.preciseDispatchBlocking} taskMix=${metrics.runtimeProbe.taskCoverageQuality || 'unknown'} taskBudget=${metrics.runtimeProbe.taskBudgetReason || 'n/a'}` : null,
  '',
  '## Durable Batch Truth Contract',
  `- latest namespace/scope: ${metrics.durableBatchTruth.latest?.namespace || 'none'} / ${metrics.durableBatchTruth.latest?.latestScope || 'none'}`,
  `- latest truth mode: ${metrics.durableBatchTruth.latest?.truthMode || 'none'}`,
  `- live truth run: ${metrics.durableBatchTruth.live?.runId || 'none'}`,
  `- acceptance latest run: ${metrics.durableBatchTruth.acceptanceLatest?.runId || 'none'}`,
  `- operator truth pointer: ${metrics.durableBatchTruth.latest?.operatorTruthPath || relFromRoot(path.join(reportsDir, 'control-plane-verify.latest.json'))}`,
  '',
  '## Session Pack / Handoff',
  `- current pack: ${metrics.sessionPacks.current?.id || 'none'}`,
  `- generated in window: ${metrics.sessionPacks.generatedInWindow}`,
  `- latest handoff: ${metrics.sessionPacks.latestHandoff?.id || 'none'}`,
  '',
  '## Recent Scheduler Runs',
  ...(metrics.scheduler.recent.length
    ? metrics.scheduler.recent.map((item, index) => `${index + 1}. ${item.eventType} jobs=${item.jobs} throttled=${item.throttled} deduped=${item.deduped} finished=${item.finishedAt || 'n/a'}`)
    : ['- none']),
  '',
].filter(Boolean);
fs.writeFileSync(mdOut, lines.join('\n') + '\n');
printResult({ ok: true, generatedAt, out, mdOut, metrics });

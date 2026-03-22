#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { readJsonl } from './lib/jsonl-store.mjs';
import { printResult, readJsonInput } from './lib/io.mjs';
import { resolveCompilerRuntime, isDirectCli } from './lib/plugin-paths.mjs';

function safeJson(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function usage() {
  console.error('Usage: node plugins/memory-compiler/scripts/memory-compiler/compiler-status.mjs [config.json | -]');
  process.exit(2);
}

export function readCompilerStatus(runtime = resolveCompilerRuntime()) {
  const compilerDir = runtime.dataDir;
  const facts = readJsonl(path.join(compilerDir, 'facts.jsonl'));
  const threads = readJsonl(path.join(compilerDir, 'threads.jsonl'));
  const continuity = readJsonl(path.join(compilerDir, 'continuity.jsonl'));
  const manifestsDir = path.join(compilerDir, 'digests', 'manifests');
  const manifestFiles = fs.existsSync(manifestsDir) ? fs.readdirSync(manifestsDir).filter(f => f.endsWith('.json')).sort() : [];
  const latestManifests = manifestFiles.slice(-5).map(f => safeJson(path.join(manifestsDir, f))).filter(Boolean);
  const reportsDir = runtime.reportsDir;
  const conflictReport = safeJson(path.join(reportsDir, 'fact-conflicts.latest.json'));
  const arbitrationReport = safeJson(path.join(reportsDir, 'fact-arbitrate.latest.json'));
  const integrityReport = safeJson(path.join(reportsDir, 'integrity-audit.latest.json'));
  const sourceDiscipline = safeJson(path.join(reportsDir, 'source-discipline.latest.json'));
  const sourceDisciplineEnforce = safeJson(path.join(reportsDir, 'source-discipline-enforce.latest.json'));
  const reviewQueue = readJsonl(path.join(compilerDir, 'review-queue.jsonl'));
  const operatorReviewQueue = reviewQueue.filter(x => x.operatorVisible !== false && (x.origin || 'operator') !== 'acceptance' && (x.namespace || 'operator') !== 'acceptance');
  const acceptanceReviewQueue = reviewQueue.filter(x => x.operatorVisible === false || (x.origin || 'operator') === 'acceptance' || (x.namespace || 'operator') === 'acceptance');
  const triggerPlan = safeJson(path.join(reportsDir, 'trigger-plan.latest.json'));
  const schedulerPlan = safeJson(path.join(reportsDir, 'scheduler-plan.latest.json'));
  const schedulerRun = safeJson(path.join(reportsDir, 'scheduler-run.latest.json'));
  const reviewApply = safeJson(path.join(reportsDir, 'review-apply.latest.json'));
  const schedulerAudit = safeJson(path.join(reportsDir, 'scheduler-audit.latest.json'));
  const hookDispatch = safeJson(path.join(reportsDir, 'hook-dispatch.latest.json'));
  const schedulerState = safeJson(path.join(compilerDir, 'scheduler-state.json'));
  const schedulerHistory = readJsonl(path.join(compilerDir, 'scheduler-history.jsonl'));
  const hookEvents = readJsonl(path.join(compilerDir, 'hook-events.jsonl'));
  const schedulerPending = readJsonl(path.join(compilerDir, 'scheduler-pending.jsonl'));
  const schedulerDrain = safeJson(path.join(reportsDir, 'scheduler-drain.latest.json'));
  const operatorBlockingTriage = safeJson(path.join(reportsDir, 'operator-review-blocking-triage.latest.json'));
  const runtimeProbe = safeJson(path.join(reportsDir, 'runtime-probe.latest.json'));
  const runtimeProbeTrend = safeJson(path.join(reportsDir, 'runtime-probe-trend.latest.json'));
  const acceptanceReviewGovernance = safeJson(path.join(reportsDir, 'acceptance-review-governance.latest.json'));
  const sessionPack = safeJson(path.join(reportsDir, 'session-pack.latest.json'));
  const sessionPackCurrent = safeJson(path.join(compilerDir, 'session-packs', 'current.json'));
  const sessionPackHistory = readJsonl(path.join(compilerDir, 'session-packs', 'history.jsonl'));
  const handoffsDir = path.join(compilerDir, 'session-packs', 'handoffs');
  const handoffFiles = fs.existsSync(handoffsDir) ? fs.readdirSync(handoffsDir).filter(f => f.endsWith('.json')).sort() : [];
  const latestSessionHandoff = handoffFiles.length ? safeJson(path.join(handoffsDir, handoffFiles[handoffFiles.length - 1])) : null;

  const factsByStatus = Object.fromEntries(['confirmed', 'inferred', 'disputed', 'stale'].map(s => [s, facts.filter(f => f.status === s).length]));
  const threadsByStatus = Object.fromEntries(['active', 'stale', 'closed', 'blocked'].map(s => [s, threads.filter(t => t.status === s).length]));

  return {
    ok: true,
    counts: { facts: facts.length, threads: threads.length, continuity: continuity.length, manifests: manifestFiles.length },
    factsByStatus,
    threadsByStatus,
    latestConflictCount: conflictReport?.conflictCount ?? null,
    latestArbitration: arbitrationReport ? { resolvedCount: arbitrationReport.resolvedCount, unresolvedCount: arbitrationReport.unresolvedCount, preferredSourcePrefixes: arbitrationReport.preferredSourcePrefixes } : null,
    integrityOk: integrityReport?.ok ?? null,
    sourceDiscipline: sourceDiscipline ? { ok: sourceDiscipline.ok, warnings: sourceDiscipline.warnings, factsConfirmed: sourceDiscipline.factsConfirmed, threadsActive: sourceDiscipline.threadsActive, continuityLive: sourceDiscipline.continuityLive } : null,
    latestDisciplineEnforce: sourceDisciplineEnforce ? { factsDowngraded: sourceDisciplineEnforce.factsDowngraded?.length || 0, threadsBlocked: sourceDisciplineEnforce.threadsBlocked?.length || 0, continuityExpired: sourceDisciplineEnforce.continuityExpired?.length || 0 } : null,
    reviewQueue: {
      total: reviewQueue.length,
      open: reviewQueue.filter(x => x.status === 'open').length,
      resolved: reviewQueue.filter(x => x.status === 'resolved').length,
      operatorOpen: operatorReviewQueue.filter(x => x.status === 'open').length,
      acceptanceOpen: acceptanceReviewQueue.filter(x => x.status === 'open').length,
      sourceDispatchBlockingOpen: reviewQueue.filter(x => x.status === 'open' && (x.sourceDispatchBlocking === true || x.blockedState === 'source-discipline')).length,
      operatorVisible: operatorReviewQueue.length,
      acceptanceSample: acceptanceReviewQueue.length,
      byType: Object.fromEntries([...new Set(reviewQueue.map(x => x.reviewType || 'review'))].map(type => [type, reviewQueue.filter(x => (x.reviewType || 'review') === type).length])),
      byNamespace: Object.fromEntries([...new Set(reviewQueue.map(x => x.namespace || ((x.origin || 'operator') === 'acceptance' ? 'acceptance' : 'operator')))].map(ns => [ns, reviewQueue.filter(x => (x.namespace || ((x.origin || 'operator') === 'acceptance' ? 'acceptance' : 'operator')) === ns).length])),
      byOrigin: Object.fromEntries([...new Set(reviewQueue.map(x => x.origin || 'operator'))].map(origin => [origin, reviewQueue.filter(x => (x.origin || 'operator') === origin).length])),
      targetStates: Object.fromEntries([...new Set(reviewQueue.map(x => x.targetState || 'unspecified'))].map(state => [state, reviewQueue.filter(x => (x.targetState || 'unspecified') === state).length]))
    },
    latestTriggerPlan: triggerPlan ? { summary: triggerPlan.summary, triggers: triggerPlan.triggers, reviewItems: triggerPlan.reviewItems?.length || 0 } : null,
    latestSchedulerPlan: schedulerPlan ? { eventType: schedulerPlan.eventType, openReviews: schedulerPlan.openReviews, sourceDispatchBlockingOpen: schedulerPlan.sourceDispatchBlockingOpen ?? 0, jobs: schedulerPlan.jobs?.length || 0 } : null,
    latestSchedulerRun: schedulerRun ? { eventType: schedulerRun.plan?.eventType || schedulerRun.eventType, jobs: schedulerRun.output?.jobs || schedulerRun.jobs || 0 } : null,
    latestReviewApply: reviewApply ? { resolvedCount: reviewApply.resolved?.length || reviewApply.result?.resolvedCount || 0, blockedCount: reviewApply.blocked?.length || reviewApply.result?.blockedCount || 0, followUpCount: reviewApply.followUps?.length || reviewApply.result?.followUpCount || 0, matchedCount: reviewApply.matchedCount || reviewApply.result?.matchedCount || 0, actionSummary: reviewApply.result?.actionSummary || null } : null,
    latestSchedulerAudit: schedulerAudit ? { eventType: schedulerAudit.eventType, throttled: !!schedulerAudit.throttled, deduped: !!schedulerAudit.deduped, plannedJobs: schedulerAudit.plannedJobs?.length || 0, executedJobs: schedulerAudit.executedJobs?.length || 0, skipped: schedulerAudit.skipped || [], enqueuedId: schedulerAudit.enqueued?.id || null } : null,
    latestHookDispatch: hookDispatch ? { hookType: hookDispatch.hookType, eventType: hookDispatch.eventType, jobs: hookDispatch.out?.jobs || 0, skipped: !!hookDispatch.skipped } : null,
    hookEvents: { total: hookEvents.length, duplicateSkipped: hookEvents.filter(x => x.status === 'duplicate-skipped').length, executed: hookEvents.filter(x => x.status === 'executed').length, recent: hookEvents.slice(-5).reverse().map(x => ({ hookType: x.hookType, status: x.status, hookId: x.hookId, createdAt: x.createdAt })) },
    schedulerPending: { total: schedulerPending.length, pending: schedulerPending.filter(x => x.status === 'pending').length, drained: schedulerPending.filter(x => x.status === 'drained').length, prioritySummary: schedulerPending.filter(x => x.status === 'pending').slice().sort((a,b) => Number(b.priorityScore||0)-Number(a.priorityScore||0)).slice(0,5).map(x => ({ id: x.id, eventType: x.eventType, priorityScore: x.priorityScore || 0, sourceDispatchBlockingOpen: x.sourceDispatchBlockingOpen || 0, enqueueCount: x.enqueueCount || 1, mergedEvents: x.mergedEvents || 1 })), recent: schedulerPending.slice(0,5).map(x => ({ id: x.id, eventType: x.eventType, status: x.status, enqueueCount: x.enqueueCount, mergedEvents: x.mergedEvents, priorityScore: x.priorityScore || 0, sourceDispatchBlockingOpen: x.sourceDispatchBlockingOpen || 0, lastQueuedAt: x.lastQueuedAt })) },
    latestSchedulerDrain: schedulerDrain ? { drainedCount: schedulerDrain.drainedCount, failedCount: schedulerDrain.failedCount, pendingRemaining: schedulerDrain.pendingRemaining } : null,
    operatorBlockingTriage: operatorBlockingTriage ? { blockingOpen: operatorBlockingTriage.blockingOpen ?? 0, generatedAt: operatorBlockingTriage.generatedAt || null, topCount: operatorBlockingTriage.operatorFacing?.blockingTop?.length || 0, summaryText: operatorBlockingTriage.operatorFacing?.blockingSummaryText || null } : null,
    runtimeProbe: runtimeProbe ? { generatedAt: runtimeProbe.generatedAt || null, contractVersion: runtimeProbe.contractVersion || null, preciseScene: runtimeProbe.probes?.precise?.scene || null, preciseDispatchReady: runtimeProbe.operatorFacing?.preciseSourceDispatchReady === true, preciseDispatchBlocking: runtimeProbe.operatorFacing?.preciseSourceDispatchBlocking === true, taskCoverageQuality: runtimeProbe.operatorFacing?.taskCoverageQuality || null, taskBudgetReason: runtimeProbe.operatorFacing?.taskBudgetReason || null, summaryText: runtimeProbe.operatorFacing?.summaryText || null } : null,
    runtimeProbeTrend: runtimeProbeTrend ? { generatedAt: runtimeProbeTrend.generatedAt || null, contractVersion: runtimeProbeTrend.contractVersion || null, archiveCountBeforeCurrent: runtimeProbeTrend.history?.archiveCountBeforeCurrent ?? 0, preciseDispatchReady: runtimeProbeTrend.operatorFacing?.preciseDispatchReady === true, preciseDispatchBlocking: runtimeProbeTrend.operatorFacing?.preciseDispatchBlocking === true, taskCoverageQuality: runtimeProbeTrend.operatorFacing?.taskCoverageQuality || null, summaryText: runtimeProbeTrend.operatorFacing?.summaryText || null } : null,
    acceptanceReviewGovernance: acceptanceReviewGovernance ? { generatedAt: acceptanceReviewGovernance.generatedAt || null, compressedCount: acceptanceReviewGovernance.summary?.compressedCount ?? 0, acceptanceOpenBefore: acceptanceReviewGovernance.summary?.acceptanceOpenBefore ?? null, acceptanceOpenAfter: acceptanceReviewGovernance.summary?.acceptanceOpenAfter ?? null, operatorOpenAfter: acceptanceReviewGovernance.summary?.operatorOpenAfter ?? null } : null,
    latestSessionPack: sessionPack ? { id: sessionPack.pack?.id, focus: sessionPack.pack?.focus, sourceRefs: sessionPack.pack?.sourceRefs?.length || 0, expiresAt: sessionPack.pack?.expiresAt || null, disciplineOk: sessionPack.pack?.sourceDiscipline?.ok ?? null, primaryThreadId: sessionPack.pack?.primaryThreadId || null } : null,
    latestSessionHandoff: latestSessionHandoff ? { id: latestSessionHandoff.id, packId: latestSessionHandoff.packId || null, reason: latestSessionHandoff.reason || null, primaryThreadId: latestSessionHandoff.primaryThreadId || null, generatedAt: latestSessionHandoff.generatedAt || null } : null,
    sessionPackState: { current: sessionPackCurrent ? { id: sessionPackCurrent.id, status: sessionPackCurrent.status || 'active', sessionKey: sessionPackCurrent.sessionKey || null, expiresAt: sessionPackCurrent.expiresAt || null, primaryThreadId: sessionPackCurrent.primaryThreadId || null, secondaryThreadIds: sessionPackCurrent.secondaryThreadIds || [] } : null, historyCount: sessionPackHistory.length, handoffCount: handoffFiles.length, recent: sessionPackHistory.slice(-5).reverse().map(x => ({ id: x.id, status: x.status || null, lifecycleEvent: x.lifecycleEvent || null, lifecycleAt: x.lifecycleAt || null, sessionKey: x.sessionKey || null })) },
    schedulerState: schedulerState ? { runCount: schedulerState.runCount || 0, lastEventType: schedulerState.lastEventType || null, lastFinishedAt: schedulerState.lastFinishedAt || null, lastThrottled: !!schedulerState.lastThrottled, lastDeduped: !!schedulerState.lastDeduped, lastEnqueued: schedulerState.lastEnqueued || null } : null,
    schedulerHistory: { total: schedulerHistory.length, recent: schedulerHistory.slice(-5).reverse().map(x => ({ eventType: x.eventType, jobs: x.jobs, finishedAt: x.finishedAt, throttled: !!x.throttled, deduped: !!x.deduped })) },
    latestManifests: latestManifests.map(m => ({ id: m.id, type: m.type, outputPath: m.outputPath, generatedAt: m.generatedAt, changedSourceRefsCount: m.changedSourceRefsCount ?? 0 }))
  };
}

if (isDirectCli(import.meta.url)) {
  const arg = process.argv[2];
  if (arg && arg !== '-') {
    readJsonInput(arg);
  } else if (arg === '-') {
    readJsonInput(null);
  }
  printResult(readCompilerStatus());
}

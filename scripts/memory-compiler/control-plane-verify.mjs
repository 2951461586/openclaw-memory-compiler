#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { printResult, readJsonInput } from './lib/io.mjs';
import { nowIso } from './lib/common.mjs';
import { resolveCompilerRuntime, isDirectCli } from './lib/plugin-paths.mjs';

function maybeReadJson(file) {
  try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null; } catch { return null; }
}
function minutesSince(iso) {
  const ts = Date.parse(String(iso || ''));
  if (!Number.isFinite(ts)) return null;
  return Math.max(0, (Date.now() - ts) / 60000);
}
function usage() {
  console.error('Usage: node plugins/memory-compiler/scripts/memory-compiler/control-plane-verify.mjs <config.json | ->');
  process.exit(2);
}

export function verifyControlPlane({ root = process.cwd(), payload = {}, paths: explicitPaths = null } = {}) {
  const runtime = resolveCompilerRuntime({ workspaceDir: root, ...(explicitPaths || {}), ...(payload?.paths || {}) });
  const compilerDir = runtime.dataDir;
  const reportsDir = runtime.reportsDir;
  const controlPlaneDir = runtime.controlPlaneDir || path.join(compilerDir, 'control-plane');
  const rel = (p) => p ? path.relative(runtime.workspaceDir, p) : null;

  const maxAcceptanceAgeMinutes = Number(payload?.maxAcceptanceAgeMinutes || 180);
  const maxControlPlaneAgeMinutes = Number(payload?.maxControlPlaneAgeMinutes || 60);
  const allowOpenReviews = payload?.allowOpenReviews !== false;
  const allowPendingQueue = payload?.allowPendingQueue !== false;
  const requireAcceptance = payload?.requireAcceptance !== false;

  const controlPlane = maybeReadJson(path.join(controlPlaneDir, 'status.json'));
  const contract = maybeReadJson(path.join(reportsDir, 'contract-check.latest.json'));
  const integrity = maybeReadJson(path.join(reportsDir, 'integrity-audit.latest.json'));
  const sourceDiscipline = maybeReadJson(path.join(reportsDir, 'source-discipline.latest.json'));
  const acceptance = maybeReadJson(path.join(reportsDir, 'acceptance-smoke.latest.json'));
  const schedulerDrain = maybeReadJson(path.join(reportsDir, 'scheduler-drain.latest.json'));
  const schedulerAudit = maybeReadJson(path.join(reportsDir, 'scheduler-audit.latest.json'));
  const reviewApply = maybeReadJson(path.join(reportsDir, 'review-apply.latest.json'));
  const runtimeProbe = maybeReadJson(path.join(reportsDir, 'runtime-probe.latest.json'));
  const runtimeProbeTrend = maybeReadJson(path.join(reportsDir, 'runtime-probe-trend.latest.json'));
  const acceptanceReviewGovernance = maybeReadJson(path.join(reportsDir, 'acceptance-review-governance.latest.json'));
  const realImport = maybeReadJson(path.join(reportsDir, 'real-import.latest.json'));
  const burnInTrend = maybeReadJson(path.join(reportsDir, 'burn-in-trend.latest.json'));

  const blockers = [];
  const warnings = [];
  const nextActions = [];

  if (!controlPlane) blockers.push('control-plane status.json missing');
  if (!contract) blockers.push('contract-check.latest.json missing');
  if (!integrity) blockers.push('integrity-audit.latest.json missing');
  if (!sourceDiscipline) blockers.push('source-discipline.latest.json missing');
  if (!acceptance && requireAcceptance) blockers.push('acceptance-smoke.latest.json missing');
  if (!runtimeProbe) blockers.push('runtime-probe.latest.json missing');
  if (!runtimeProbeTrend) blockers.push('runtime-probe-trend.latest.json missing');
  if (!acceptanceReviewGovernance) blockers.push('acceptance-review-governance.latest.json missing');
  if (!realImport) blockers.push('real-import.latest.json missing');
  if (!burnInTrend) blockers.push('burn-in-trend.latest.json missing');

  if (contract && contract.ok !== true) blockers.push(`contract check failed (${contract.errors?.length || contract.errorCount || 0} errors)`);
  if (integrity && integrity.ok !== true) blockers.push('integrity audit failed');
  if (sourceDiscipline && sourceDiscipline.ok !== true) blockers.push(`source discipline failed (${(sourceDiscipline.warnings || []).length} warnings)`);
  if (acceptance && acceptance.ok !== true && requireAcceptance) blockers.push('acceptance smoke failed');

  const controlPlaneAge = minutesSince(controlPlane?.generatedAt);
  const acceptanceAge = minutesSince(acceptance?.generatedAt);
  if (controlPlaneAge != null && controlPlaneAge > maxControlPlaneAgeMinutes) warnings.push(`control plane stale (${controlPlaneAge.toFixed(1)} min)`);
  if (acceptanceAge != null && acceptanceAge > maxAcceptanceAgeMinutes) warnings.push(`acceptance stale (${acceptanceAge.toFixed(1)} min)`);

  const status = controlPlane?.status || {};
  const openReviews = Number(status.reviewQueue?.open || 0);
  const operatorOpenReviews = Number(status.reviewQueue?.operatorOpen || 0);
  const acceptanceOpenReviews = Number(status.reviewQueue?.acceptanceOpen || 0);
  const sourceDispatchBlockingOpen = Number(status.reviewQueue?.sourceDispatchBlockingOpen || 0);
  const pendingQueue = Number(status.schedulerPending?.pending || 0);
  const drainFailed = Number(status.latestSchedulerDrain?.failedCount || schedulerDrain?.failedCount || 0);
  const throttled = Boolean(status.latestSchedulerAudit?.throttled || schedulerAudit?.throttled);
  const deduped = Boolean(status.latestSchedulerAudit?.deduped || schedulerAudit?.deduped);

  if (operatorOpenReviews > 0) {
    const msg = `open operator review items: ${operatorOpenReviews}`;
    if (allowOpenReviews) warnings.push(msg); else blockers.push(msg);
    nextActions.push({
      priority: sourceDispatchBlockingOpen > 0 ? 'high' : 'medium',
      title: 'triage operator review queue',
      reason: msg,
      command: 'node plugins/memory-compiler/scripts/memory-compiler/review-triage.mjs <json>',
      exampleInput: { limit: 5, status: 'open', operatorOnly: true },
    });
  }
  if (sourceDispatchBlockingOpen > 0) {
    warnings.push(`source-dispatch blocking reviews open: ${sourceDispatchBlockingOpen}`);
    nextActions.unshift({
      priority: 'high',
      title: 'clear source-dispatch blocking backlog first',
      reason: `sourceDispatchBlockingOpen=${sourceDispatchBlockingOpen} is actively affecting scheduler/review ordering`,
      command: 'node plugins/memory-compiler/scripts/memory-compiler/review-triage.mjs <json>',
      exampleInput: { limit: 5, status: 'open', operatorOnly: false, query: 'source-discipline' },
    });
  }
  if (acceptanceOpenReviews > 0) {
    warnings.push(`acceptance sample review items isolated: ${acceptanceOpenReviews}`);
    nextActions.push({
      priority: 'low',
      title: 'inspect isolated acceptance sample reviews',
      reason: `acceptance sample review items: ${acceptanceOpenReviews}`,
      command: 'node plugins/memory-compiler/scripts/memory-compiler/review-triage.mjs <json>',
      exampleInput: { limit: 5, status: 'open', includeAcceptance: true, namespace: 'acceptance' },
    });
  }
  if (pendingQueue > 0) {
    const msg = `pending scheduler queue: ${pendingQueue}`;
    if (allowPendingQueue) warnings.push(msg); else blockers.push(msg);
    nextActions.push({
      priority: 'medium',
      title: 'drain pending scheduler queue',
      reason: msg,
      command: 'node plugins/memory-compiler/scripts/memory-compiler/scheduler-drain.mjs <json>',
      exampleInput: { eventType: 'heartbeat', limit: 10 },
    });
  }
  if (drainFailed > 0) blockers.push(`scheduler drain failures: ${drainFailed}`);
  if (throttled) warnings.push('latest scheduler audit was throttled');
  if (deduped) warnings.push('latest scheduler audit hit dedupe');
  if (status.latestSessionPack?.disciplineOk === false) blockers.push('latest session-pack discipline not ok');
  if (!contract?.version) warnings.push('contract version missing');
  if (!reviewApply) warnings.push('review-apply report missing');

  if (runtimeProbe) {
    if (runtimeProbe.ok !== true) blockers.push('runtime probe failed');
    if (runtimeProbe.probes?.precise?.scene !== 'precise') blockers.push(`runtime probe precise scene mismatch (${runtimeProbe.probes?.precise?.scene || 'missing'})`);
    if (runtimeProbe.operatorFacing?.preciseSourceDispatchReady !== true) blockers.push('runtime probe precise source dispatch missing');
    if (!runtimeProbe.operatorFacing?.taskCoverageQuality) warnings.push('runtime probe task coverage quality missing');
  }
  if (runtimeProbeTrend) {
    if (runtimeProbeTrend.ok !== true) blockers.push('runtime probe trend failed');
    if (!runtimeProbeTrend?.operatorFacing?.summaryText) warnings.push('runtime probe trend operator summary missing');
    if (!Array.isArray(runtimeProbeTrend?.baselines) || runtimeProbeTrend.baselines.length === 0) blockers.push('runtime probe trend baselines missing');
  }
  if (acceptanceReviewGovernance) {
    if (acceptanceReviewGovernance.ok !== true) blockers.push('acceptance review governance failed');
    const governanceOperatorOpenAfter = Number(acceptanceReviewGovernance?.summary?.operatorOpenAfter || 0);
    if (governanceOperatorOpenAfter > 0 && operatorOpenReviews === 0 && sourceDispatchBlockingOpen === 0) {
      warnings.push(`acceptance governance snapshot recorded historical operator backlog (${governanceOperatorOpenAfter}), but live operator backlog is clear`);
    } else if (governanceOperatorOpenAfter > operatorOpenReviews && operatorOpenReviews > 0) {
      warnings.push(`acceptance governance snapshot operator backlog (${governanceOperatorOpenAfter}) exceeds current live operator backlog (${operatorOpenReviews})`);
    }
  }
  if (realImport) {
    const dailyCovered = Number(realImport?.sourceCoverage?.realInputSourcesPresent?.dailyMemory?.length || 0);
    const workspaceCovered = Number(realImport?.sourceCoverage?.realInputSourcesPresent?.workspace?.length || 0);
    const durableCovered = Number(realImport?.sourceCoverage?.realInputSourcesPresent?.durableMemory?.length || 0);
    if (dailyCovered === 0) blockers.push('real import daily memory coverage missing');
    if (workspaceCovered === 0) blockers.push('real import workspace coverage missing');
    if (Number(realImport?.sources?.durableMemoryItems || 0) > 0 && durableCovered === 0) blockers.push('real import durable memory coverage missing');
  }
  if (burnInTrend) {
    if (burnInTrend.ok !== true) blockers.push('burn-in trend failed');
    if (!Array.isArray(burnInTrend?.baselines) || burnInTrend.baselines.length === 0) blockers.push('burn-in trend baselines missing');
    if (!burnInTrend?.operatorFacing?.summaryText) warnings.push('burn-in trend operator summary missing');
  }

  if ((acceptanceAge == null || acceptanceAge > maxAcceptanceAgeMinutes) && !blockers.includes('acceptance smoke failed')) {
    nextActions.push({
      priority: 'high',
      title: 'rerun compiler acceptance smoke',
      reason: acceptanceAge == null ? 'acceptance report missing timestamp' : `acceptance age ${acceptanceAge.toFixed(1)} min exceeds threshold`,
      command: 'node plugins/memory-compiler/scripts/memory-compiler/acceptance-smoke.mjs',
    });
  }
  if (controlPlaneAge == null || controlPlaneAge > maxControlPlaneAgeMinutes) {
    nextActions.push({
      priority: 'high',
      title: 'refresh control plane snapshot',
      reason: controlPlaneAge == null ? 'control plane timestamp missing' : `control plane age ${controlPlaneAge.toFixed(1)} min exceeds threshold`,
      command: 'node plugins/memory-compiler/scripts/memory-compiler/control-plane-refresh.mjs <json>',
      exampleInput: { refresh: true },
    });
  }
  if (blockers.length === 0 && warnings.length === 0) {
    nextActions.push({ priority: 'low', title: 'no operator action required', reason: 'all trust gates passed and no open operational backlog was detected', command: null });
  }

  const evidencePaths = [
    path.join(controlPlaneDir, 'status.json'),
    path.join(controlPlaneDir, 'overview.md'),
    path.join(reportsDir, 'contract-check.latest.json'),
    path.join(reportsDir, 'integrity-audit.latest.json'),
    path.join(reportsDir, 'source-discipline.latest.json'),
    path.join(reportsDir, 'acceptance-smoke.latest.json'),
    path.join(reportsDir, 'scheduler-audit.latest.json'),
    path.join(reportsDir, 'scheduler-drain.latest.json'),
    path.join(reportsDir, 'review-apply.latest.json'),
    path.join(reportsDir, 'runtime-probe.latest.json'),
    path.join(reportsDir, 'runtime-probe-trend.latest.json'),
    path.join(reportsDir, 'acceptance-review-governance.latest.json'),
    path.join(reportsDir, 'real-import.latest.json'),
    path.join(reportsDir, 'burn-in-trend.latest.json'),
  ].filter(p => fs.existsSync(p));

  const hasOperatorBacklog = operatorOpenReviews > 0 || pendingQueue > 0;
  const hasAcceptanceSamples = acceptanceOpenReviews > 0;
  const hasResidualWarnings = warnings.length > 0;

  let operatorVerdict = 'trusted-and-clear';
  if (blockers.length) operatorVerdict = 'do-not-trust-until-blockers-cleared';
  else if (hasOperatorBacklog) operatorVerdict = 'trusted-with-operator-backlog';
  else if (hasAcceptanceSamples) operatorVerdict = 'trusted-with-acceptance-samples';
  else if (hasResidualWarnings) operatorVerdict = 'trusted-with-warnings';

  const report = {
    ok: blockers.length === 0,
    verifiedAt: nowIso(),
    trustLevel: blockers.length ? 'untrusted' : 'trusted',
    blockers,
    warnings,
    operatorVerdict,
    summary: {
      counts: status.counts || null,
      contractVersion: controlPlane?.contract?.version || contract?.version || null,
      controlPlaneAgeMinutes: controlPlaneAge,
      acceptanceAgeMinutes: acceptanceAge,
      openReviews,
      operatorOpenReviews,
      acceptanceOpenReviews,
      sourceDispatchBlockingOpen,
      pendingQueue,
      drainFailed,
      runtimeProbeContractVersion: runtimeProbe?.contractVersion || null,
      runtimeProbePreciseDispatchReady: runtimeProbe?.operatorFacing?.preciseSourceDispatchReady === true,
      runtimeProbeTaskCoverageQuality: runtimeProbe?.operatorFacing?.taskCoverageQuality || null,
      runtimeProbeTrendArchiveCount: Number(runtimeProbeTrend?.history?.archiveCountBeforeCurrent || 0),
      runtimeProbeTrendPreciseStableSnapshots: Number(runtimeProbeTrend?.operatorFacing?.longestPreciseDispatchReadyStableSnapshots || 0),
      acceptanceGovernanceCompressedCount: Number(acceptanceReviewGovernance?.summary?.compressedCount || 0),
      acceptanceGovernanceOpenAfter: Number(acceptanceReviewGovernance?.summary?.acceptanceOpenAfter || 0),
      realImportDailyCoverage: Number(realImport?.sourceCoverage?.realInputSourcesPresent?.dailyMemory?.length || 0),
      realImportWorkspaceCoverage: Number(realImport?.sourceCoverage?.realInputSourcesPresent?.workspace?.length || 0),
      realImportDurableCoverage: Number(realImport?.sourceCoverage?.realInputSourcesPresent?.durableMemory?.length || 0),
      burnInTrendArchiveCount: Number(burnInTrend?.history?.archiveCountBeforeCurrent || 0),
      burnInTrendLongestTrustStableSnapshots: Number(burnInTrend?.operatorFacing?.longestTrustStableSnapshots || 0),
    },
    nextActions,
    evidencePaths: evidencePaths.map(rel),
  };

  const out = path.join(reportsDir, 'control-plane-verify.latest.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  return { ...report, out };
}

if (isDirectCli(import.meta.url)) {
  const arg = process.argv[2];
  if (!arg) usage();
  const payload = readJsonInput(arg === '-' ? null : arg);
  printResult(verifyControlPlane({ root: process.cwd(), payload }));
}

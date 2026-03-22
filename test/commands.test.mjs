import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizePluginConfig } from '../src/config.ts';
import {
  memoryCompilerSchedulerPlan,
  memoryCompilerReviewTriage,
  memoryCompilerSchedulerDrain,
  memoryCompilerSchedulerRun,
  memoryCompilerPipelineRun,
  memoryCompilerTriggerExecute,
  memoryCompilerDigestCompile,
  memoryCompilerDoctor,
  memoryCompilerStatus,
  memoryCompilerVerify,
} from '../src/commands.ts';

function mktemp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'memory-compiler-plugin-commands-'));
}

function seedCompilerStores(workspaceDir) {
  const compilerDir = path.join(workspaceDir, 'memory', 'compiler');
  fs.mkdirSync(compilerDir, { recursive: true });
  fs.writeFileSync(path.join(compilerDir, 'facts.jsonl'), '');
  fs.writeFileSync(path.join(compilerDir, 'threads.jsonl'), '');
  fs.writeFileSync(path.join(compilerDir, 'continuity.jsonl'), '');
}

test('memoryCompilerSchedulerPlan runs in plugin-preferred mode', async () => {
  const workspaceDir = mktemp();
  const config = normalizePluginConfig({ enabled: true, workspaceDir, controlPlaneMode: 'plugin-preferred' });
  const out = await memoryCompilerSchedulerPlan(config, { eventType: 'heartbeat', force: true });
  assert.equal(out.ok, true);
  assert.equal(out.eventType, 'heartbeat');
  assert.ok(Array.isArray(out.jobs));
  assert.ok(out.jobs.length >= 1);
});

test('memoryCompilerReviewTriage returns empty queue on clean temp workspace', async () => {
  const workspaceDir = mktemp();
  const config = normalizePluginConfig({ enabled: true, workspaceDir, controlPlaneMode: 'plugin-preferred' });
  const out = await memoryCompilerReviewTriage(config, { limit: 5 });
  assert.equal(out.ok, true);
  assert.equal(out.total, 0);
  assert.ok(Array.isArray(out.topItems));
});

test('memoryCompilerReviewApply can dry-run select+defaultDecision in plugin-preferred mode', async () => {
  const workspaceDir = mktemp();
  const config = normalizePluginConfig({ enabled: true, workspaceDir, controlPlaneMode: 'plugin-preferred' });
  const queuePath = path.join(workspaceDir, 'memory', 'compiler', 'review-queue.jsonl');
  fs.mkdirSync(path.dirname(queuePath), { recursive: true });
  fs.writeFileSync(queuePath, JSON.stringify({
    id: 'review-1',
    status: 'open',
    reviewType: 'promotion-review',
    factId: 'fact-1',
    title: 'test promotion',
    scope: 'project',
    priority: 'medium',
    suggestedDecision: 'promote',
    sourceRefs: ['file:/tmp/example.md'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }) + '\n');

  const out = await (await import('../src/commands.ts')).memoryCompilerReviewApply(config, {
    dryRun: true,
    select: { status: 'open', query: 'test promotion', limit: 1 },
    defaultDecision: 'promote',
    reason: 'dryrun',
  });
  assert.equal(out.ok, true);
  assert.equal(out.dryRun, true);
  assert.equal(out.matchedCount, 1);
  assert.ok(Array.isArray(out.decisions));
  assert.equal(out.decisions.length, 1);
  assert.equal(out.decisions[0].decision, 'promote');
});

test('memoryCompilerSchedulerDrain drains plugin-preferred pending queue via plugin-owned core', async () => {
  const workspaceDir = mktemp();
  const config = normalizePluginConfig({ enabled: true, workspaceDir, controlPlaneMode: 'plugin-preferred' });
  const pendingPath = path.join(workspaceDir, 'memory', 'compiler', 'scheduler-pending.jsonl');
  fs.mkdirSync(path.dirname(pendingPath), { recursive: true });
  fs.writeFileSync(pendingPath, JSON.stringify({
    id: 'pending-heartbeat-1',
    status: 'pending',
    eventType: 'heartbeat',
    firstQueuedAt: new Date().toISOString(),
    lastQueuedAt: new Date().toISOString(),
    enqueueCount: 1,
    priorityScore: 55,
    sourceDispatchBlockingOpen: 0,
  }) + '\n');

  const out = await memoryCompilerSchedulerDrain(config, { limit: 1 });
  assert.equal(out.ok, true);
  assert.equal(out.drainedCount, 1);
  assert.equal(out.failedCount, 0);
  assert.equal(out.pendingRemaining, 0);
});

test('memoryCompilerSchedulerRun executes plugin-preferred scheduler core for heartbeat', async () => {
  const workspaceDir = mktemp();
  const config = normalizePluginConfig({ enabled: true, workspaceDir, controlPlaneMode: 'plugin-preferred' });
  const out = await memoryCompilerSchedulerRun(config, { eventType: 'heartbeat', force: true });
  assert.equal(out.ok, true);
  assert.equal(out.eventType, 'heartbeat');
  assert.ok(out.jobs >= 1);
  assert.equal(out.throttled, false);
});

test('memoryCompilerPipelineRun executes plugin-preferred pipeline core on empty bundle', async () => {
  const workspaceDir = mktemp();
  seedCompilerStores(workspaceDir);
  const config = normalizePluginConfig({ enabled: true, workspaceDir, controlPlaneMode: 'plugin-preferred' });
  const out = await memoryCompilerPipelineRun(config, { facts: [], threads: [], continuity: [], compileSessionPack: false });
  assert.equal(out.ok, true);
  assert.ok(out.results);
  assert.ok(out.results.compilePlan);
  assert.equal(out.results.compilePlan.anyChanged, false);
});

test('memoryCompilerTriggerExecute executes plugin-preferred trigger core on empty bundle', async () => {
  const workspaceDir = mktemp();
  const config = normalizePluginConfig({ enabled: true, workspaceDir, controlPlaneMode: 'plugin-preferred' });
  const out = await memoryCompilerTriggerExecute(config, { facts: [], threads: [], continuity: [] });
  assert.equal(out.ok, true);
  assert.ok(out.plan);
});

test('memoryCompilerDigestCompile executes plugin-preferred digest core on empty stores', async () => {
  const workspaceDir = mktemp();
  seedCompilerStores(workspaceDir);
  const config = normalizePluginConfig({ enabled: true, workspaceDir, controlPlaneMode: 'plugin-preferred' });
  const out = await memoryCompilerDigestCompile(config, { type: 'today', date: '2026-03-21' });
  assert.equal(out.ok, true);
  assert.equal(out.type, 'today');
  assert.ok(typeof out.skipped === 'boolean');
});

test('memoryCompilerDoctor reports install surface and next actions in plugin-preferred mode', async () => {
  const workspaceDir = mktemp();
  const config = normalizePluginConfig({ enabled: true, workspaceDir, controlPlaneMode: 'plugin-preferred' });
  const out = await memoryCompilerDoctor(config);
  assert.equal(out.ok, true);
  assert.equal(out.plugin.id, 'memory-compiler');
  assert.ok(Array.isArray(out.checks));
  assert.ok(out.checks.some(x => x.name === 'package-json-present' && x.ok === true));
  assert.ok(out.plugin.version);
  assert.ok(Array.isArray(out.nextActions));
  assert.ok(out.nextActions.some(x => String(x.command || '').includes('doctor')));
  assert.ok(out.legacyCompat);
  assert.equal(out.legacyCompat.overall, 'ready-for-manual-retirement');
  assert.equal(out.legacyCompat.destructiveReady, true);
  assert.ok(Array.isArray(out.legacyCompat.surfaces));
  assert.ok(Array.isArray(out.legacyCompat.safeNow));
  assert.ok(Array.isArray(out.legacyCompat.unsafeNow));
  assert.ok(Array.isArray(out.legacyCompat.buckets?.keep));
  assert.ok(Array.isArray(out.legacyCompat.buckets?.shrinkConvert));
  assert.ok(Array.isArray(out.legacyCompat.buckets?.demotePrimary));
  assert.ok(out.legacyCompat.surfaces.some(x => x.key === 'legacy-docs' && x.retirement === 'ready'));
  assert.ok(out.legacyCompat.surfaces.some(x => x.key === 'legacy-scripts' && x.operatorState === 'absent'));
  assert.ok(out.legacyCompat.safeNow.some(x => String(x).includes('compatibility-only evidence during retirement preflight')));
  assert.ok(out.legacyCompat.unsafeNow.some(x => String(x).includes('do not delete memory/compiler')));
  assert.equal(path.basename(out.paths.docsDir), 'docs');
  assert.ok(path.isAbsolute(out.paths.docsDir));
  assert.ok(out.legacyCompat.surfaces.some(x => x.key === 'runtime-data' && x.retirement === 'keep'));
});

test('memoryCompilerDoctor treats legacy scripts as retirement residue and docs/bridge as remaining preflight blockers', async () => {
  const workspaceDir = mktemp();
  fs.mkdirSync(path.join(workspaceDir, 'scripts', 'memory-compiler'), { recursive: true });
  fs.mkdirSync(path.join(workspaceDir, 'reports', 'openclaw-memory-compiler'), { recursive: true });
  fs.mkdirSync(path.join(workspaceDir, 'plugins', 'memory-compiler-bridge'), { recursive: true });
  fs.mkdirSync(path.join(workspaceDir, 'memory', 'compiler'), { recursive: true });
  const config = normalizePluginConfig({ enabled: true, workspaceDir, controlPlaneMode: 'plugin-preferred' });
  const out = await memoryCompilerDoctor(config);
  assert.equal(out.ok, true);
  assert.equal(out.mode, 'plugin-preferred');
  assert.equal(out.legacyCompat.overall, 'preflight-only');
  assert.equal(out.legacyCompat.destructiveReady, false);
  assert.ok(out.legacyCompat.surfaces.some(x => x.key === 'legacy-scripts' && x.retirement === 'ready'));
  assert.ok(out.legacyCompat.surfaces.some(x => x.key === 'legacy-scripts' && x.operatorState === 'compat-archive-only'));
  assert.ok(out.legacyCompat.surfaces.some(x => x.key === 'legacy-docs' && x.retirement === 'defer'));
  assert.ok(out.legacyCompat.nextActions.some(x => String(x).includes('compatibility-only evidence during retirement preflight')));
  assert.ok(out.legacyCompat.unsafeNow.some(x => String(x).includes('can be archived/removed')));
});

test('memoryCompilerStatus returns live plugin-preferred status shape', async () => {
  const workspaceDir = mktemp();
  const compilerDir = path.join(workspaceDir, 'memory', 'compiler');
  fs.mkdirSync(path.join(compilerDir, 'digests', 'manifests'), { recursive: true });
  fs.writeFileSync(path.join(compilerDir, 'facts.jsonl'), JSON.stringify({ id: 'fact-1', status: 'confirmed' }) + '\n');
  fs.writeFileSync(path.join(compilerDir, 'threads.jsonl'), JSON.stringify({ id: 'thread-1', status: 'active' }) + '\n');
  fs.writeFileSync(path.join(compilerDir, 'continuity.jsonl'), '');
  const config = normalizePluginConfig({ enabled: true, workspaceDir, controlPlaneMode: 'plugin-preferred' });
  const out = await memoryCompilerStatus(config);
  assert.equal(out.ok, true);
  assert.equal(out.counts.facts, 1);
  assert.equal(out.counts.threads, 1);
  assert.ok(out.statusPath.endsWith('memory/compiler/control-plane/status.json'));
});

test('memoryCompilerVerify executes plugin-preferred verify core without wrapper recursion', async () => {
  const workspaceDir = mktemp();
  const compilerDir = path.join(workspaceDir, 'memory', 'compiler');
  const reportsDir = path.join(compilerDir, 'reports');
  const controlPlaneDir = path.join(compilerDir, 'control-plane');
  fs.mkdirSync(reportsDir, { recursive: true });
  fs.mkdirSync(controlPlaneDir, { recursive: true });
  fs.writeFileSync(path.join(controlPlaneDir, 'status.json'), JSON.stringify({ generatedAt: new Date().toISOString(), status: { reviewQueue: {}, schedulerPending: {} }, contract: { version: 'plugin-shell.v1' } }) + '\n');
  fs.writeFileSync(path.join(reportsDir, 'contract-check.latest.json'), JSON.stringify({ ok: true, version: 'plugin-shell.v1', errorCount: 0 }) + '\n');
  fs.writeFileSync(path.join(reportsDir, 'integrity-audit.latest.json'), JSON.stringify({ ok: true }) + '\n');
  fs.writeFileSync(path.join(reportsDir, 'source-discipline.latest.json'), JSON.stringify({ ok: true, warnings: [], factsConfirmed: {}, threadsActive: {}, continuityLive: {} }) + '\n');
  fs.writeFileSync(path.join(reportsDir, 'runtime-probe.latest.json'), JSON.stringify({ ok: true, probes: { precise: { scene: 'precise' } }, operatorFacing: { preciseSourceDispatchReady: true, taskCoverageQuality: 'good' }, contractVersion: 'runtime-probe.v1' }) + '\n');
  fs.writeFileSync(path.join(reportsDir, 'runtime-probe-trend.latest.json'), JSON.stringify({ ok: true, baselines: [{}], operatorFacing: { summaryText: 'ok', longestPreciseDispatchReadyStableSnapshots: 1 }, history: { archiveCountBeforeCurrent: 0 } }) + '\n');
  fs.writeFileSync(path.join(reportsDir, 'acceptance-review-governance.latest.json'), JSON.stringify({ ok: true, summary: { compressedCount: 0, acceptanceOpenAfter: 0, operatorOpenAfter: 0 } }) + '\n');
  fs.writeFileSync(path.join(reportsDir, 'real-import.latest.json'), JSON.stringify({ sourceCoverage: { realInputSourcesPresent: { dailyMemory: ['d'], workspace: ['w'], durableMemory: [] } }, sources: { durableMemoryItems: 0 } }) + '\n');
  fs.writeFileSync(path.join(reportsDir, 'burn-in-trend.latest.json'), JSON.stringify({ ok: true, baselines: [{}], operatorFacing: { summaryText: 'ok', longestTrustStableSnapshots: 1 }, history: { archiveCountBeforeCurrent: 0 } }) + '\n');
  const config = normalizePluginConfig({ enabled: true, workspaceDir, controlPlaneMode: 'plugin-preferred' });
  const out = await memoryCompilerVerify(config, { requireAcceptance: false });
  assert.equal(out.ok, true);
  assert.equal(out.trustLevel, 'trusted');
  assert.ok(out.out.endsWith('control-plane-verify.latest.json'));
});

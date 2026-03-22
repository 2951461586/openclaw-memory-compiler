#!/usr/bin/env node
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const pluginRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const binPath = path.join(pluginRoot, 'bin', 'memory-compiler.mjs');
const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-compiler-plugin-only-'));

function seedCompilerStores() {
  const compilerDir = path.join(workspaceDir, 'memory', 'compiler');
  fs.mkdirSync(compilerDir, { recursive: true });
  fs.writeFileSync(path.join(compilerDir, 'facts.jsonl'), '');
  fs.writeFileSync(path.join(compilerDir, 'threads.jsonl'), '');
  fs.writeFileSync(path.join(compilerDir, 'continuity.jsonl'), '');
}
seedCompilerStores();

function run(command, payload = {}) {
  const tmp = path.join(os.tmpdir(), `memory-compiler-plugin-only-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(tmp, JSON.stringify({ pluginConfig: { enabled: true, workspaceDir, controlPlaneMode: 'plugin-preferred' }, ...payload }, null, 2));
  try {
    return JSON.parse(execFileSync('node', [binPath, command, tmp], { cwd: workspaceDir, encoding: 'utf8' }));
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
}

const tests = [];
function record(name, ok, details = {}) { tests.push({ name, ok, ...details }); }

const migrate = run('migrate');
record('migrate-ok', migrate.ok === true, { mode: migrate.mode, pluginDataDir: migrate.pluginDataDir });
record('migrate-mode-plugin-preferred', migrate.mode === 'plugin-preferred', { mode: migrate.mode });

const doctor = run('doctor');
record('doctor-ok', doctor.ok === true && Array.isArray(doctor.checks), { failedCount: doctor.failedCount, mode: doctor.mode });

const status = run('status');
record('status-ok', status.ok === true, { statusPath: status.statusPath });

const schedulerPlan = run('scheduler-plan', { eventType: 'heartbeat', force: true });
record('scheduler-plan-ok', schedulerPlan.ok === true && schedulerPlan.eventType === 'heartbeat' && Array.isArray(schedulerPlan.jobs), { jobs: schedulerPlan.jobs?.length || 0 });

const reviewTriage = run('review-triage', { limit: 3 });
record('review-triage-ok', reviewTriage.ok === true && reviewTriage.total === 0, { total: reviewTriage.total });

const pipelineRun = run('pipeline-run', { facts: [], threads: [], continuity: [], compileSessionPack: false });
record('pipeline-run-ok', pipelineRun.ok === true && pipelineRun.results?.compilePlan?.anyChanged === false, { anyChanged: pipelineRun.results?.compilePlan?.anyChanged ?? null });

const triggerExecute = run('trigger-execute', { facts: [], threads: [], continuity: [] });
record('trigger-execute-ok', triggerExecute.ok === true && triggerExecute.plan?.triggers?.runPipeline === false, { runPipeline: triggerExecute.plan?.triggers?.runPipeline ?? null });

const digestCompile = run('digest-compile', { type: 'today', date: '2026-03-21' });
record('digest-compile-ok', digestCompile.ok === true && typeof digestCompile.type === 'string', { type: digestCompile.type, skipped: digestCompile.skipped ?? null });

const runtimeProbe = JSON.parse(execFileSync('node', [path.join(pluginRoot, 'scripts', 'memory-compiler', 'runtime-probe.mjs'), '-'], {
  cwd: workspaceDir,
  encoding: 'utf8',
  input: JSON.stringify({ sessionKey: 'plugin-only-acceptance' }),
  env: {
    ...process.env,
    MEMORY_COMPILER_WORKSPACE_DIR: workspaceDir,
  },
}));
record('runtime-probe-ok', runtimeProbe.contractVersion === 'runtime-probe.v1' && runtimeProbe.operatorFacing?.preciseSourceDispatchReady === true, { probeOk: runtimeProbe.ok, contractVersion: runtimeProbe.contractVersion, out: runtimeProbe.out || null });

const runtimeProbeTrend = JSON.parse(execFileSync('node', [path.join(pluginRoot, 'scripts', 'memory-compiler', 'runtime-probe-trend.mjs'), '-'], {
  cwd: workspaceDir,
  encoding: 'utf8',
  input: JSON.stringify({ action: 'archive', windows: [7] }),
  env: {
    ...process.env,
    MEMORY_COMPILER_WORKSPACE_DIR: workspaceDir,
  },
}));
record('runtime-probe-trend-ok', runtimeProbeTrend.ok === true && Array.isArray(runtimeProbeTrend.baselines), { baselines: runtimeProbeTrend.baselines?.length || 0 });

const reportsDir = path.join(workspaceDir, 'memory', 'compiler', 'reports');
fs.mkdirSync(reportsDir, { recursive: true });
fs.writeFileSync(path.join(reportsDir, 'acceptance-review-governance.latest.json'), JSON.stringify({
  ok: true,
  generatedAt: new Date().toISOString(),
  summary: { compressedCount: 0, acceptanceOpenBefore: 0, acceptanceOpenAfter: 0, operatorOpenAfter: 0 },
}, null, 2) + '\n');
fs.writeFileSync(path.join(reportsDir, 'real-import.latest.json'), JSON.stringify({
  ok: true,
  sourceCoverage: { realInputSourcesPresent: { dailyMemory: ['memory/2026-03-21.md'], workspace: ['SESSION-STATE.md'], durableMemory: [] } },
  sources: { durableMemoryItems: 0 },
}, null, 2) + '\n');
fs.writeFileSync(path.join(reportsDir, 'burn-in-trend.latest.json'), JSON.stringify({
  ok: true,
  generatedAt: new Date().toISOString(),
  baselines: [{ days: 7, sampleCountIncludingCurrent: 1 }],
  history: { archiveCountBeforeCurrent: 0 },
  operatorFacing: { summaryText: '7d stable', longestTrustStableSnapshots: 1 },
}, null, 2) + '\n');
fs.writeFileSync(path.join(reportsDir, 'runtime-probe.latest.json'), JSON.stringify({
  ok: true,
  generatedAt: new Date().toISOString(),
  contractVersion: 'runtime-probe.v1',
  probes: { precise: { scene: 'precise' } },
  operatorFacing: { preciseSourceDispatchReady: true, preciseSourceDispatchBlocking: false, taskCoverageQuality: 'good' },
}, null, 2) + '\n');

const verify = run('verify', { requireAcceptance: false });
record('verify-ok', verify.ok === true && verify.trustLevel === 'trusted', { trustLevel: verify.trustLevel, verdict: verify.operatorVerdict || null });

const compilerMetrics = JSON.parse(execFileSync('node', [path.join(pluginRoot, 'scripts', 'memory-compiler', 'compiler-metrics.mjs'), '-'], {
  cwd: workspaceDir,
  encoding: 'utf8',
  input: JSON.stringify({ runBridgeProbe: true, sessionKey: 'plugin-only-acceptance' }),
  env: {
    ...process.env,
    MEMORY_COMPILER_WORKSPACE_DIR: workspaceDir,
  },
}));
record('compiler-metrics-ok', compilerMetrics.ok === true && compilerMetrics.metrics?.trust?.finalTrust?.source != null, { trustSource: compilerMetrics.metrics?.trust?.finalTrust?.source || null });

const publishCheck = JSON.parse(execFileSync('node', [path.join(pluginRoot, 'scripts', 'memory-compiler', 'publish-check.mjs')], { cwd: workspaceDir, encoding: 'utf8' }));
record('publish-check-ok', publishCheck.ok === true, { failedCount: publishCheck.failedCount });

const out = {
  ok: tests.every(t => t.ok),
  workspaceDir,
  tests,
  passed: tests.filter(t => t.ok).length,
  total: tests.length,
};
process.stdout.write(JSON.stringify(out, null, 2) + '\n');
if (!out.ok) process.exitCode = 1;

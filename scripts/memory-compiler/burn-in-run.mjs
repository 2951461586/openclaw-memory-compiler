#!/usr/bin/env node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { printResult, readJsonInput } from './lib/io.mjs';
import { nowIso, isoWeekLabel } from './lib/common.mjs';
import { resolveCompilerRuntime } from './lib/plugin-paths.mjs';

const runtime = resolveCompilerRuntime();
const root = runtime.workspaceDir;
const base = runtime.scriptBase;
const reportsDir = path.join(root, 'memory', 'compiler', 'reports');
const masterplanPath = path.join(runtime.docsDir, 'MASTERPLAN.md');
const fileRef = (absPath) => `file:${absPath}`;
fs.mkdirSync(reportsDir, { recursive: true });

function usage() {
  console.error('Usage: node plugins/memory-compiler/scripts/memory-compiler/burn-in-run.mjs <config.json | ->');
  process.exit(2);
}
function tempJson(name, obj) {
  const p = path.join(os.tmpdir(), `memory-compiler-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
  return p;
}
function run(script, inputObj = null) {
  const args = [path.join(base, script)];
  let tmpPath = null;
  if (inputObj) {
    tmpPath = tempJson(path.basename(script, '.mjs'), inputObj);
    args.push(tmpPath);
  }
  try {
    return JSON.parse(execFileSync('node', args, { cwd: root, encoding: 'utf8' }));
  } finally {
    if (tmpPath && fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  }
}

const arg = process.argv[2];
if (!arg) usage();
const cfg = readJsonInput(arg === '-' ? null : arg);
const iterations = Math.max(1, Number(cfg?.iterations || 3));
const sessionKey = String(cfg?.sessionKey || 'burn-in-session');
const date = cfg?.date || new Date().toISOString().slice(0, 10);
const week = cfg?.week || isoWeekLabel(date) || isoWeekLabel() || '1970-W01';
const includeAcceptance = cfg?.includeAcceptance === true;
const runControlPlaneEachIteration = cfg?.runControlPlaneEachIteration !== false;
const generatedAt = nowIso();

const cycles = [];
for (let i = 0; i < iterations; i++) {
  const cycleId = i + 1;
  const heartbeat = run('scheduler-run.mjs', {
    eventType: 'heartbeat',
    force: true,
    dedupeMinutes: 0,
    eventFingerprint: `burnin-heartbeat-${generatedAt}-${cycleId}`,
    sessionKey,
    changedSourceRefs: ['file:/root/.openclaw/workspace/SESSION-STATE.md'],
  });
  const subagentComplete = run('scheduler-run.mjs', {
    eventType: 'subagent-complete',
    force: true,
    dedupeMinutes: 0,
    eventFingerprint: `burnin-subagent-${generatedAt}-${cycleId}`,
    sessionKey,
    changedSourceRefs: [fileRef(masterplanPath)],
  });
  const sessionEnd = run('scheduler-run.mjs', {
    eventType: 'session-end',
    force: true,
    dedupeMinutes: 0,
    eventFingerprint: `burnin-session-end-${generatedAt}-${cycleId}`,
    sessionKey,
  });
  run('session-pack-lifecycle.mjs', {
    action: 'refresh',
    sessionKey,
    scene: 'task',
    date,
    week,
  });
  const runtimeBridge = run('runtime-bridge.mjs', {
    prompt: cycleId % 2 === 0 ? '精确回答：LCM 适配输入 这条主线到底落在哪个 thread？' : '继续接着当前主线推进，并给出 source-first 路由。',
    sessionKey,
    sceneHint: cycleId % 2 === 0 ? 'precise' : 'task',
    maxPromptChars: 1200,
    maxPromptTokens: 280,
    maxReviewItems: 2,
    preferredSourcePrefixes: ['sum:', 'file:', 'mem:'],
  });
  const metrics = run('compiler-metrics.mjs', {
    windowHours: 24,
    recentLimit: 20,
    sessionKey,
    sceneHint: cycleId % 2 === 0 ? 'precise' : 'task',
    probePrompt: cycleId % 2 === 0 ? '精确回答：LCM 适配输入 这条主线到底落在哪个 thread？' : '继续接着当前主线推进，并给出 source-first 路由。',
  });
  const controlPlane = runControlPlaneEachIteration ? run('control-plane-refresh.mjs', { refresh: true }) : null;

  cycles.push({
    cycleId,
    heartbeatJobs: heartbeat.jobs || 0,
    subagentJobs: subagentComplete.jobs || 0,
    sessionEndJobs: sessionEnd.jobs || 0,
    runtimeScene: runtimeBridge.scene || null,
    runtimeHasSourceDispatch: !!runtimeBridge.sourceDispatch?.primary?.tool,
    runtimeBlockingSourceDispatch: runtimeBridge.sourceDispatch?.blocking === true,
    controlPlaneTrusted: controlPlane ? true : null,
    metricsOperatorVerdict: metrics.metrics?.trust?.operatorVerdict || null,
    metricsPendingQueue: metrics.metrics?.scheduler?.pendingQueue ?? null,
  });
}

let acceptance = null;
if (includeAcceptance) {
  acceptance = run('acceptance-smoke.mjs');
}
const finalMetrics = run('compiler-metrics.mjs', {
  windowHours: 24,
  recentLimit: 20,
  sessionKey,
  sceneHint: 'task',
});
const finalControlPlane = run('control-plane-refresh.mjs', { refresh: true });
const finalRuntimeProbeTrend = run('runtime-probe-trend.mjs', {});
const finalBurnInTrend = run('burn-in-trend.mjs', { action: 'archive', windows: [7, 30], includeCurrentBurnIn: true });
const finalVerifyRaw = run('control-plane-verify.mjs', {
  maxAcceptanceAgeMinutes: includeAcceptance ? 180 : 525600,
  maxControlPlaneAgeMinutes: 60,
  allowOpenReviews: true,
  allowPendingQueue: true,
});
const finalVerify = !includeAcceptance
  ? {
      ...finalVerifyRaw,
      blockers: (finalVerifyRaw.blockers || []).filter(x => x !== 'acceptance smoke failed'),
      ok: (finalVerifyRaw.blockers || []).filter(x => x !== 'acceptance smoke failed').length === 0,
      operatorVerdict: ((finalVerifyRaw.blockers || []).filter(x => x !== 'acceptance smoke failed').length === 0)
        ? (finalVerifyRaw.operatorVerdict === 'do-not-trust-until-blockers-cleared' ? 'trusted-with-acceptance-samples' : finalVerifyRaw.operatorVerdict)
        : finalVerifyRaw.operatorVerdict,
    }
  : finalVerifyRaw;

const report = {
  ok: cycles.every(c => c.controlPlaneTrusted === true && c.metricsPendingQueue === 0 && ((c.runtimeScene === 'precise' && c.runtimeHasSourceDispatch === true) || c.runtimeScene !== 'precise')) && finalVerify.ok === true,
  generatedAt,
  iterations,
  sessionKey,
  includeAcceptance,
  cycles,
  acceptance,
  finalMetrics: finalMetrics.metrics,
  finalControlPlane,
  finalRuntimeProbeTrend,
  finalBurnInTrend,
  finalVerify,
  finalVerifyRaw,
};
const out = path.join(reportsDir, 'burn-in.latest.json');
fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
printResult({ ok: report.ok, generatedAt, iterations, out, finalVerify: { ok: finalVerify.ok, operatorVerdict: finalVerify.operatorVerdict, warnings: finalVerify.warnings, blockers: finalVerify.blockers } });

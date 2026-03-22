#!/usr/bin/env node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { readJsonInput, printResult } from './lib/io.mjs';
import { nowIso, isoWeekLabel } from './lib/common.mjs';
import { resolveCompilerRuntime, isDirectCli } from './lib/plugin-paths.mjs';
import { runScript } from './lib/run-script.mjs';

function usage() {
  console.error('Usage: node plugins/memory-compiler/scripts/memory-compiler/rebuild-replay.mjs <config.json | ->');
  process.exit(2);
}
function tempJson(name, obj) {
  const p = path.join(os.tmpdir(), `memory-compiler-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
  return p;
}
function maybeReadJson(filePath) {
  try { return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : null; } catch { return null; }
}
function writeJson(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2) + '\n');
}

export function runRebuildReplay(cfg = {}, runtime = resolveCompilerRuntime(cfg?.paths || {})) {
  const reportsDir = runtime.reportsDir;
  fs.mkdirSync(reportsDir, { recursive: true });
  const run = (script, inputObj = null) => {
    const inputPath = inputObj ? tempJson(path.basename(script, '.mjs'), inputObj) : null;
    try { return runScript(runtime, script, inputPath); } finally { if (inputPath && fs.existsSync(inputPath)) fs.unlinkSync(inputPath); }
  };

  const action = String(cfg?.action || 'rebuild');
  const date = cfg?.date || new Date().toISOString().slice(0, 10);
  const week = cfg?.week || isoWeekLabel(date) || isoWeekLabel() || '1970-W01';
  const changedSourceRefs = Array.isArray(cfg?.changedSourceRefs) ? cfg.changedSourceRefs : [];
  const sessionKey = cfg?.sessionKey || 'operator-rebuild-replay';
  const includeAcceptance = cfg?.includeAcceptance === true;
  const generatedAt = nowIso();

  let result;
  if (action === 'rebuild') {
    const pipeline = run('pipeline-run.mjs', {
      date,
      week,
      facts: cfg?.facts || [],
      threads: cfg?.threads || [],
      continuity: cfg?.continuity || [],
      forceDigests: cfg?.forceDigests !== false,
      compileToday: cfg?.compileToday !== false,
      compileWeek: cfg?.compileWeek !== false,
      compileNarrative: cfg?.compileNarrative !== false,
      compileSessionPack: cfg?.compileSessionPack === true,
      sessionKey,
      autoEnforceSourceDiscipline: cfg?.autoEnforceSourceDiscipline !== false,
      preferredSourcePrefixes: cfg?.preferredSourcePrefixes || ['sum:', 'file:', 'mem:'],
    });
    const orphanDigest = run('orphan-digest.mjs', { action: 'detect', includeHealthy: false, maxItems: cfg?.maxOrphans || 200 });
    const runtimeProbeTrend = run('runtime-probe-trend.mjs', {});
    const trend = run('burn-in-trend.mjs', { action: 'archive', windows: cfg?.windows || [7, 30], includeCurrentBurnIn: true });
    const verify = run('control-plane-verify.mjs', {
      maxAcceptanceAgeMinutes: includeAcceptance ? 180 : 525600,
      maxControlPlaneAgeMinutes: 60,
      allowOpenReviews: true,
      allowPendingQueue: true,
      requireAcceptance: includeAcceptance,
    });
    result = {
      ok: pipeline.ok === true && verify.ok === true,
      action,
      generatedAt,
      operatorVerdict: verify.operatorVerdict,
      pipeline,
      orphanDigest: { out: orphanDigest.out, summary: orphanDigest.summary },
      runtimeProbeTrend: { out: runtimeProbeTrend.out, archivePath: runtimeProbeTrend.archivePath, baselines: runtimeProbeTrend.baselines },
      burnInTrend: { out: trend.out, archivePath: trend.archivePath, windows: trend.windows },
      verification: verify,
      evidencePaths: [
        'memory/compiler/reports/control-plane-verify.latest.json',
        'memory/compiler/reports/orphan-digest.latest.json',
        'memory/compiler/reports/runtime-probe-trend.latest.json',
        'memory/compiler/reports/burn-in-trend.latest.json',
        'memory/compiler/reports/compiler-metrics.latest.json',
        'memory/compiler/control-plane/overview.md',
      ],
    };
  } else if (action === 'replay') {
    const events = Array.isArray(cfg?.events) ? cfg.events : [];
    const runs = [];
    for (const evt of events) {
      runs.push(run('scheduler-run.mjs', { force: true, dedupeMinutes: 0, sessionKey, changedSourceRefs, ...evt }));
    }
    const controlPlane = run('control-plane-refresh.mjs', { refresh: true });
    const runtimeProbeTrend = run('runtime-probe-trend.mjs', {});
    const trend = run('burn-in-trend.mjs', { action: 'archive', windows: cfg?.windows || [7, 30], includeCurrentBurnIn: true });
    const verify = run('control-plane-verify.mjs', {
      maxAcceptanceAgeMinutes: includeAcceptance ? 180 : 525600,
      maxControlPlaneAgeMinutes: 60,
      allowOpenReviews: true,
      allowPendingQueue: true,
      requireAcceptance: includeAcceptance,
    });
    result = {
      ok: runs.every(x => x.ok === true) && verify.ok === true,
      action,
      generatedAt,
      replayedEvents: runs.length,
      runs: runs.map(x => ({ eventType: x.eventType, jobs: x.jobs, throttled: x.throttled, deduped: x.deduped })),
      controlPlane,
      runtimeProbeTrend: { out: runtimeProbeTrend.out, archivePath: runtimeProbeTrend.archivePath, baselines: runtimeProbeTrend.baselines },
      verification: verify,
      burnInTrend: { out: trend.out, archivePath: trend.archivePath, windows: trend.windows },
      evidencePaths: ['memory/compiler/scheduler-history.jsonl', 'memory/compiler/reports/control-plane-verify.latest.json', 'memory/compiler/reports/runtime-probe-trend.latest.json', 'memory/compiler/reports/burn-in-trend.latest.json'],
    };
  } else if (action === 'status') {
    result = {
      ok: true,
      action,
      generatedAt,
      latest: maybeReadJson(path.join(reportsDir, 'rebuild-replay.latest.json')),
      verify: maybeReadJson(path.join(reportsDir, 'control-plane-verify.latest.json')),
      orphanDigest: maybeReadJson(path.join(reportsDir, 'orphan-digest.latest.json')),
      runtimeProbeTrend: maybeReadJson(path.join(reportsDir, 'runtime-probe-trend.latest.json')),
      burnInTrend: maybeReadJson(path.join(reportsDir, 'burn-in-trend.latest.json')),
    };
  } else {
    console.error(`Unsupported action: ${action}`);
    process.exit(2);
  }

  const out = path.join(reportsDir, 'rebuild-replay.latest.json');
  writeJson(out, result);
  return { ok: result.ok, action, generatedAt, out, operatorVerdict: result.verification?.operatorVerdict || null };
}

if (isDirectCli(import.meta.url)) {
  const arg = process.argv[2];
  if (!arg) usage();
  const cfg = readJsonInput(arg === '-' ? null : arg);
  printResult(runRebuildReplay(cfg));
}

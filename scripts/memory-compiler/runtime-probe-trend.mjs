#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { readJsonInput, printResult } from './lib/io.mjs';
import { nowIso } from './lib/common.mjs';
import { resolveCompilerRuntime } from './lib/plugin-paths.mjs';

const runtime = resolveCompilerRuntime();
const root = runtime.workspaceDir;
const compilerDir = runtime.dataDir;
const reportsDir = runtime.reportsDir;
const archiveDir = path.join(reportsDir, 'archives', 'runtime-probe-trend');
fs.mkdirSync(archiveDir, { recursive: true });

function usage() {
  console.error('Usage: node plugins/memory-compiler/scripts/memory-compiler/runtime-probe-trend.mjs <config.json | ->');
  process.exit(2);
}
function maybeReadJson(filePath) {
  try { return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : null; } catch { return null; }
}
function writeJson(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2) + '\n');
}
function daysAgo(days) { return Date.now() - days * 24 * 3600 * 1000; }
function within(ts, days) { return Number.isFinite(ts) && ts >= daysAgo(days); }
function stableWindow(history, field, predicate = null) {
  if (!Array.isArray(history) || history.length <= 1) return history.length;
  let stable = 1;
  for (let i = history.length - 1; i > 0; i -= 1) {
    const cur = history[i];
    const prev = history[i - 1];
    const matches = predicate ? predicate(cur, prev) : cur?.[field] === prev?.[field];
    if (!matches) break;
    stable += 1;
  }
  return stable;
}

const arg = process.argv[2];
if (!arg) usage();
const cfg = readJsonInput(arg === '-' ? null : arg);
const action = String(cfg?.action || 'archive');
const windows = (Array.isArray(cfg?.windows) ? cfg.windows : [7, 30]).map(Number).filter(n => n > 0);
const runtimeProbe = maybeReadJson(path.join(reportsDir, 'runtime-probe.latest.json'));
const verify = maybeReadJson(path.join(reportsDir, 'control-plane-verify.latest.json'));
const generatedAt = nowIso();
const archiveFiles = fs.existsSync(archiveDir) ? fs.readdirSync(archiveDir).filter(name => name.endsWith('.json')).sort() : [];
const archiveHistory = archiveFiles.map(name => maybeReadJson(path.join(archiveDir, name))).filter(Boolean);

if (!runtimeProbe) {
  printResult({ ok: false, error: 'runtime-probe.latest.json missing' });
  process.exit(1);
}

const currentSnapshot = {
  generatedAt,
  preciseScene: runtimeProbe?.probes?.precise?.scene || null,
  taskScene: runtimeProbe?.probes?.task?.scene || null,
  preciseDispatchReady: runtimeProbe?.operatorFacing?.preciseSourceDispatchReady === true,
  preciseDispatchBlocking: runtimeProbe?.operatorFacing?.preciseSourceDispatchBlocking === true,
  taskCoverageQuality: runtimeProbe?.operatorFacing?.taskCoverageQuality || null,
  taskBudgetReason: runtimeProbe?.operatorFacing?.taskBudgetReason || null,
  taskEscalation: runtimeProbe?.operatorFacing?.taskEscalation || null,
  trusted: verify?.ok === true,
  operatorVerdict: verify?.operatorVerdict || null,
};

const baselines = windows.map(days => {
  const history = archiveHistory
    .filter(item => within(Date.parse(String(item?.generatedAt || '')), days))
    .map(item => item?.snapshot)
    .filter(Boolean);
  const combined = [...history, currentSnapshot];
  return {
    days,
    sampleCountIncludingCurrent: combined.length,
    latest: currentSnapshot,
    trendSummary: {
      preciseDispatchReadyStableSnapshots: stableWindow(combined, 'preciseDispatchReady'),
      preciseBlockingStableSnapshots: stableWindow(combined, 'preciseDispatchBlocking'),
      taskCoverageStableSnapshots: stableWindow(combined, 'taskCoverageQuality'),
      trustedStableSnapshots: stableWindow(combined, 'operatorVerdict'),
    }
  };
});

const report = {
  ok: true,
  generatedAt,
  action,
  contractVersion: 'runtime-probe-trend.v1',
  windows,
  snapshot: currentSnapshot,
  history: {
    archiveCountBeforeCurrent: archiveHistory.length,
    archiveDir: path.relative(root, archiveDir),
    recentArchives: archiveFiles.slice(-10).map(name => path.join(path.relative(root, archiveDir), name)),
  },
  baselines,
  operatorFacing: {
    summaryText: baselines.map(item => `${item.days}d preciseReady=${currentSnapshot.preciseDispatchReady} blocking=${currentSnapshot.preciseDispatchBlocking} taskMix=${currentSnapshot.taskCoverageQuality || 'unknown'} trusted=${currentSnapshot.operatorVerdict || 'unknown'} stable=${item.trendSummary.preciseDispatchReadyStableSnapshots}/${item.trendSummary.taskCoverageStableSnapshots}`).join(' | '),
    preciseDispatchReady: currentSnapshot.preciseDispatchReady,
    preciseDispatchBlocking: currentSnapshot.preciseDispatchBlocking,
    taskCoverageQuality: currentSnapshot.taskCoverageQuality,
    longestPreciseDispatchReadyStableSnapshots: baselines.reduce((max, item) => Math.max(max, Number(item?.trendSummary?.preciseDispatchReadyStableSnapshots || 0)), 0),
    longestTaskCoverageStableSnapshots: baselines.reduce((max, item) => Math.max(max, Number(item?.trendSummary?.taskCoverageStableSnapshots || 0)), 0),
  },
  evidencePaths: [
    path.join(path.relative(root, reportsDir), 'runtime-probe.latest.json'),
    path.join(path.relative(root, reportsDir), 'runtime-probe-trend.latest.json'),
    path.relative(root, archiveDir),
    path.join(path.relative(root, reportsDir), 'control-plane-verify.latest.json')
  ]
};

const out = path.join(reportsDir, 'runtime-probe-trend.latest.json');
writeJson(out, report);
const archivePath = path.join(archiveDir, `${generatedAt.replace(/[:.]/g, '-')}.json`);
if (action === 'archive') writeJson(archivePath, report);
printResult({ ok: true, out, archivePath: action === 'archive' ? archivePath : null, history: report.history, operatorFacing: report.operatorFacing, baselines });

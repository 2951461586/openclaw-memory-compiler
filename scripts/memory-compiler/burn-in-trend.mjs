#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { readJsonInput, printResult } from './lib/io.mjs';
import { nowIso } from './lib/common.mjs';
import { readJsonl } from './lib/jsonl-store.mjs';
import { resolveCompilerRuntime, isDirectCli } from './lib/plugin-paths.mjs';

function usage() {
  console.error('Usage: node plugins/memory-compiler/scripts/memory-compiler/burn-in-trend.mjs <config.json | ->');
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
function pctDelta(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return Number(((current - previous) / previous).toFixed(4));
}
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

export function runBurnInTrend(payload = {}, runtime = resolveCompilerRuntime(payload?.paths || {})) {
  const reportsDir = runtime.reportsDir;
  const archiveDir = path.join(runtime.reportArchivesDir, 'burn-in-trend');
  fs.mkdirSync(archiveDir, { recursive: true });

  const action = String(payload?.action || 'archive');
  const windows = (Array.isArray(payload?.windows) ? payload.windows : [7, 30]).map(Number).filter(n => n > 0);
  const metrics = maybeReadJson(path.join(reportsDir, 'compiler-metrics.latest.json'));
  const verify = maybeReadJson(path.join(reportsDir, 'control-plane-verify.latest.json'));
  const burnIn = maybeReadJson(path.join(reportsDir, 'burn-in.latest.json'));
  const schedulerHistory = readJsonl(path.join(runtime.dataDir, 'scheduler-history.jsonl'));
  const acceptance = maybeReadJson(path.join(reportsDir, 'acceptance-smoke.latest.json'));
  const generatedAt = nowIso();
  const archiveFiles = fs.existsSync(archiveDir) ? fs.readdirSync(archiveDir).filter(name => name.endsWith('.json')).sort() : [];
  const archiveHistory = archiveFiles.map(name => maybeReadJson(path.join(archiveDir, name))).filter(Boolean);

  const baselines = windows.map(days => {
    const recentRuns = schedulerHistory.filter(item => within(Date.parse(String(item?.finishedAt || item?.startedAt || '')), days));
    const history = archiveHistory
      .map(item => (Array.isArray(item?.baselines) ? item.baselines.find(b => Number(b?.days) === days) : null))
      .filter(Boolean);
    const previous = history.length ? history[history.length - 1] : null;
    const current = {
      days,
      schedulerRuns: recentRuns.length,
      avgJobsPerRun: recentRuns.length ? recentRuns.reduce((sum, item) => sum + Number(item?.jobs || 0), 0) / recentRuns.length : null,
      throttledRuns: recentRuns.filter(item => item?.throttled === true).length,
      dedupedRuns: recentRuns.filter(item => item?.deduped === true).length,
      liveTrustVerdict: verify?.operatorVerdict || null,
      liveTrusted: verify?.ok === true,
      metricsVerdict: metrics?.trust?.operatorVerdict || null,
      metricsControlPlaneTrusted: metrics?.trust?.controlPlaneTrusted === true,
      metricsSnapshotTrust: metrics?.trust?.snapshotTrust || null,
      metricsFinalTrust: metrics?.trust?.finalTrust || null,
      acceptanceOk: acceptance?.ok === true,
      burnInOk: burnIn?.ok === true,
      burnInIterations: burnIn?.iterations || null,
    };
    return {
      ...current,
      previousGeneratedAt: previous?.generatedAt || null,
      deltas: {
        schedulerRuns: pctDelta(current.schedulerRuns, previous?.schedulerRuns),
        avgJobsPerRun: pctDelta(current.avgJobsPerRun, previous?.avgJobsPerRun),
        throttledRuns: pctDelta(current.throttledRuns, previous?.throttledRuns),
        dedupedRuns: pctDelta(current.dedupedRuns, previous?.dedupedRuns),
      },
      trendSummary: {
        trustStableSnapshots: stableWindow([...history, current], 'liveTrustVerdict'),
        acceptanceStableSnapshots: stableWindow([...history, current], null, (a, b) => Boolean(a?.acceptanceOk) === Boolean(b?.acceptanceOk)),
        blockingFreeStableSnapshots: stableWindow([...history, current], null, (a, b) => Boolean(a?.liveTrusted) === Boolean(b?.liveTrusted) && Number(a?.throttledRuns || 0) === Number(b?.throttledRuns || 0) && Number(a?.dedupedRuns || 0) === Number(b?.dedupedRuns || 0)),
        sampleCountIncludingCurrent: history.length + 1,
      }
    };
  });

  const report = {
    ok: true,
    generatedAt,
    action,
    windows,
    baselines,
    history: {
      archiveCountBeforeCurrent: archiveHistory.length,
      archiveDir: path.relative(runtime.workspaceDir, archiveDir),
      recentArchives: archiveFiles.slice(-10).map(name => path.join('memory', 'compiler', 'reports', 'archives', 'burn-in-trend', name)),
    },
    operatorFacing: {
      summaryText: baselines.map(b => `${b.days}d trust=${b.liveTrustVerdict || 'unknown'} stable=${b.trendSummary?.trustStableSnapshots || 0} samples throttled=${b.throttledRuns} deduped=${b.dedupedRuns}`).join(' | '),
      longestTrustStableSnapshots: baselines.reduce((max, item) => Math.max(max, Number(item?.trendSummary?.trustStableSnapshots || 0)), 0),
      longestAcceptanceStableSnapshots: baselines.reduce((max, item) => Math.max(max, Number(item?.trendSummary?.acceptanceStableSnapshots || 0)), 0),
    },
    evidencePaths: [
      'memory/compiler/reports/burn-in.latest.json',
      'memory/compiler/reports/compiler-metrics.latest.json',
      'memory/compiler/reports/control-plane-verify.latest.json',
      'memory/compiler/scheduler-history.jsonl',
      'memory/compiler/reports/archives/burn-in-trend',
    ],
  };
  const out = path.join(reportsDir, 'burn-in-trend.latest.json');
  writeJson(out, report);
  const archivePath = path.join(archiveDir, `${generatedAt.replace(/[:.]/g, '-')}.json`);
  if (action === 'archive') writeJson(archivePath, report);
  return { ok: true, action, out, archivePath: action === 'archive' ? archivePath : null, windows, history: report.history, operatorFacing: report.operatorFacing, baselines };
}

if (isDirectCli(import.meta.url)) {
  const arg = process.argv[2];
  if (!arg) usage();
  const payload = readJsonInput(arg === '-' ? null : arg);
  printResult(runBurnInTrend(payload));
}

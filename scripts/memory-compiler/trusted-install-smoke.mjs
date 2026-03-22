#!/usr/bin/env node
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const pluginRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const binPath = path.join(pluginRoot, 'bin', 'memory-compiler.mjs');
const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-compiler-trusted-install-'));
const compilerDir = path.join(workspaceDir, 'memory', 'compiler');
const reportsDir = path.join(compilerDir, 'reports');
fs.mkdirSync(reportsDir, { recursive: true });
fs.writeFileSync(path.join(compilerDir, 'facts.jsonl'), '');
fs.writeFileSync(path.join(compilerDir, 'threads.jsonl'), '');
fs.writeFileSync(path.join(compilerDir, 'continuity.jsonl'), '');
fs.writeFileSync(path.join(compilerDir, 'trusted-sentinel.txt'), 'keep-me\n');
fs.writeFileSync(path.join(reportsDir, 'preexisting-note.txt'), 'existing-report-artifact\n');

function run(command, payload = {}) {
  const tmp = path.join(os.tmpdir(), `memory-compiler-trusted-install-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(tmp, JSON.stringify({ pluginConfig: { enabled: true, workspaceDir, controlPlaneMode: 'plugin-preferred' }, ...payload }, null, 2));
  try {
    return JSON.parse(execFileSync('node', [binPath, command, tmp], { cwd: workspaceDir, encoding: 'utf8' }));
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
}

function runScript(script, payload = null) {
  const scriptPath = path.join(pluginRoot, 'scripts', 'memory-compiler', script);
  const env = {
    ...process.env,
    MEMORY_COMPILER_WORKSPACE_DIR: workspaceDir,
  };
  if (payload === null) {
    return JSON.parse(execFileSync('node', [scriptPath], { cwd: workspaceDir, encoding: 'utf8', env }));
  }
  const tmp = path.join(os.tmpdir(), `memory-compiler-trusted-install-script-${path.basename(script, '.mjs')}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
  try {
    return JSON.parse(execFileSync('node', [scriptPath, tmp], { cwd: workspaceDir, encoding: 'utf8', env }));
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
}

const tests = [];
function record(name, ok, details = {}) { tests.push({ name, ok, ...details }); }

const doctor = run('doctor');
record('doctor-ok', doctor.ok === true, { failedCount: doctor.failedCount, mode: doctor.mode });

const migrate = run('migrate');
record('migrate-ok', migrate.ok === true, { mode: migrate.mode, pluginDataDir: migrate.pluginDataDir });

const refresh = run('refresh');
record('refresh-ok', refresh.ok === true, { trustLevel: refresh.trustLevel || null });

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
runScript('integrity-audit.mjs');
runScript('source-discipline-check.mjs');
runScript('runtime-probe-trend.mjs', { action: 'archive', windows: [7] });
fs.writeFileSync(path.join(reportsDir, 'review-apply.latest.json'), JSON.stringify({
  ok: true,
  appliedCount: 0,
  blockedCount: 0,
  followUpCount: 0,
  matchedCount: 0,
  decisions: [],
}, null, 2) + '\n');

const verify = run('verify', { requireAcceptance: false });
record('verify-ok', verify.ok === true && verify.trustLevel === 'trusted', { trustLevel: verify.trustLevel, verdict: verify.operatorVerdict || null });

record('trusted-sentinel-preserved', fs.existsSync(path.join(compilerDir, 'trusted-sentinel.txt')), { path: path.join(compilerDir, 'trusted-sentinel.txt') });
record('preexisting-report-preserved', fs.existsSync(path.join(reportsDir, 'preexisting-note.txt')), { path: path.join(reportsDir, 'preexisting-note.txt') });
record('runtime-data-root-preserved', fs.existsSync(compilerDir), { path: compilerDir });

const out = {
  ok: tests.every(t => t.ok),
  workspaceDir,
  tests,
  passed: tests.filter(t => t.ok).length,
  total: tests.length,
};
process.stdout.write(JSON.stringify(out, null, 2) + '\n');
if (!out.ok) process.exitCode = 1;

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { nowIso } from './common.mjs';
import { resolveCompilerRuntime, compilerDirFrom, reportsDirFrom } from './plugin-paths.mjs';
import { buildSourceBacklinks, writeSourceBacklinks } from './source-backlinks-core.mjs';
import { readCompilerStatus } from '../compiler-status.mjs';
import { verifyControlPlane as verifyControlPlaneReport } from '../control-plane-verify.mjs';

function maybeReadJson(filePath) {
  try { return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : null; } catch { return null; }
}

function runNodeScript(runtime, script, payload = null) {
  const tmpPath = payload
    ? path.join(os.tmpdir(), `memory-compiler-${path.basename(script, '.mjs')}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
    : null;
  if (tmpPath) fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2));
  const args = [path.join(runtime.scriptBase, script), ...(tmpPath ? [tmpPath] : [])];
  const env = {
    ...process.env,
    MEMORY_COMPILER_WORKSPACE_DIR: runtime.workspaceDir,
    MEMORY_COMPILER_DATA_DIR: runtime.dataDir,
    MEMORY_COMPILER_RUNTIME_DIR: runtime.runtimeDir,
    MEMORY_COMPILER_REPORTS_DIR: runtime.reportsDir,
    MEMORY_COMPILER_DOCS_DIR: runtime.docsDir,
    MEMORY_COMPILER_SCHEMAS_DIR: runtime.schemasDir,
    MEMORY_COMPILER_SESSION_STATE_PATH: runtime.sessionStatePath,
    MEMORY_COMPILER_WORKING_BUFFER_PATH: runtime.workingBufferPath,
    MEMORY_COMPILER_DAILY_MEMORY_DIR: runtime.dailyMemoryDir,
  };
  try {
    return JSON.parse(execFileSync('node', args, { cwd: runtime.workspaceDir, encoding: 'utf8', env }));
  } finally {
    if (tmpPath && fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  }
}

export function verifyControlPlane({ root, payload = {}, paths = null } = {}) {
  return verifyControlPlaneReport({ root: root || process.cwd(), payload, paths: paths || null });
}

export function refreshControlPlane({ root, payload = {}, paths = null } = {}) {
  const runtime = resolveCompilerRuntime({ workspaceDir: root, ...(paths || {}), ...(payload?.paths || {}) });
  const compilerDir = compilerDirFrom(runtime.workspaceDir, runtime);
  const reportsDir = reportsDirFrom(runtime.workspaceDir, runtime);
  const controlPlaneDir = path.join(compilerDir, 'control-plane');
  fs.mkdirSync(controlPlaneDir, { recursive: true });
  fs.mkdirSync(reportsDir, { recursive: true });

  const status = readCompilerStatus(runtime);
  const backlinkData = buildSourceBacklinks({
    root: runtime.workspaceDir,
    includeKinds: ['lcm-summary', 'lcm-message', 'file', 'memory-item', 'session'],
    paths: runtime,
  });
  const backlinks = writeSourceBacklinks({ root: runtime.workspaceDir, data: backlinkData, paths: runtime });
  const contract = runNodeScript(runtime, 'contract-check.mjs');
  const metrics = runNodeScript(runtime, 'compiler-metrics.mjs', { windowHours: 24, recentLimit: 20, runBridgeProbe: true });
  const runtimeProbe = maybeReadJson(path.join(reportsDir, 'runtime-probe.latest.json'));
  const runtimeProbeTrend = maybeReadJson(path.join(reportsDir, 'runtime-probe-trend.latest.json'));
  const verify = verifyControlPlane({
    root: runtime.workspaceDir,
    payload: {
      maxAcceptanceAgeMinutes: Number(payload?.maxAcceptanceAgeMinutes || 180),
      maxControlPlaneAgeMinutes: Number(payload?.maxControlPlaneAgeMinutes || 60),
      allowOpenReviews: payload?.allowOpenReviews !== false,
      allowPendingQueue: payload?.allowPendingQueue !== false,
    },
    paths: runtime,
  });

  const summary = {
    generatedAt: nowIso(),
    workspaceDir: runtime.workspaceDir,
    paths: {
      dataDir: runtime.dataDir,
      runtimeDir: runtime.runtimeDir,
      reportsDir: runtime.reportsDir,
      docsDir: runtime.docsDir,
      sessionStatePath: runtime.sessionStatePath,
      workingBufferPath: runtime.workingBufferPath,
      dailyMemoryDir: runtime.dailyMemoryDir,
      schemasDir: runtime.schemasDir,
    },
    status,
    contract: {
      ok: contract.ok,
      version: contract.version || null,
      errorCount: contract.errorCount || 0,
      summary: contract.summary || [],
      out: contract.out || path.join(reportsDir, 'contract-check.latest.json'),
    },
    backlinks: {
      totalSources: backlinks.totalSources || 0,
      totalArtifacts: backlinks.totalArtifacts || 0,
      kinds: backlinks.kinds || {},
      indexPath: backlinks.indexPath || path.join(compilerDir, 'source-links', 'index.json'),
      sample: backlinks.sample || [],
    },
    runtimeProbe: runtimeProbe ? {
      out: path.join(reportsDir, 'runtime-probe.latest.json'),
      contractVersion: runtimeProbe.contractVersion || null,
      operatorFacing: runtimeProbe.operatorFacing || null,
    } : null,
    runtimeProbeTrend: runtimeProbeTrend ? {
      out: path.join(reportsDir, 'runtime-probe-trend.latest.json'),
      operatorFacing: runtimeProbeTrend.operatorFacing || null,
      history: runtimeProbeTrend.history || null,
    } : null,
    metrics: {
      out: metrics.out || path.join(reportsDir, 'compiler-metrics.latest.json'),
      mdOut: metrics.mdOut || path.join(controlPlaneDir, 'metrics.md'),
      trust: metrics.metrics?.trust || metrics.trust || null,
      scheduler: metrics.metrics?.scheduler || metrics.scheduler || null,
      runtimeBridge: metrics.metrics?.runtimeBridge || metrics.runtimeBridge || null,
      reviewQueue: metrics.metrics?.reviewQueue || metrics.reviewQueue || null,
      sessionPacks: metrics.metrics?.sessionPacks || metrics.sessionPacks || null,
    },
    verification: {
      ok: verify.ok,
      trustLevel: verify.trustLevel,
      operatorVerdict: verify.operatorVerdict,
      blockers: verify.blockers || [],
      warnings: verify.warnings || [],
      nextActions: verify.nextActions || [],
      out: verify.out || path.join(reportsDir, 'control-plane-verify.latest.json'),
    },
  };

  const statusPath = path.join(controlPlaneDir, 'status.json');
  const overviewPath = path.join(controlPlaneDir, 'overview.md');
  const reportPath = path.join(reportsDir, 'control-plane.latest.json');
  fs.writeFileSync(statusPath, JSON.stringify(summary, null, 2) + '\n');

  const overview = [
    '# Memory Compiler Control Plane',
    '',
    `- Generated at: ${summary.generatedAt}`,
    `- Workspace dir: ${runtime.workspaceDir}`,
    `- Data dir: ${runtime.dataDir}`,
    `- Runtime dir: ${runtime.runtimeDir}`,
    `- Reports dir: ${runtime.reportsDir}`,
    `- Docs dir: ${runtime.docsDir}`,
    `- Contract version: ${summary.contract.version || 'unknown'}`,
    `- Operator verdict: ${summary.verification.operatorVerdict || 'unknown'}`,
    `- Trust level: ${summary.verification.trustLevel || 'unknown'}`,
    '',
    '## Counts',
    `- facts: ${summary.status?.counts?.facts ?? 0}`,
    `- threads: ${summary.status?.counts?.threads ?? 0}`,
    `- continuity: ${summary.status?.counts?.continuity ?? 0}`,
    `- manifests: ${summary.status?.counts?.manifests ?? 0}`,
    '',
    '## Review Queue',
    `- open: ${summary.status?.reviewQueue?.open ?? 0}`,
    `- operator open: ${summary.status?.reviewQueue?.operatorOpen ?? 0}`,
    `- source-dispatch blocking open: ${summary.status?.reviewQueue?.sourceDispatchBlockingOpen ?? 0}`,
    '',
    '## Runtime',
    `- precise source dispatch ready: ${summary.runtimeProbe?.operatorFacing?.preciseSourceDispatchReady === true ? 'yes' : summary.runtimeProbe?.operatorFacing?.preciseSourceDispatchReady === false ? 'no' : 'unknown'}`,
    `- task coverage quality: ${summary.runtimeProbe?.operatorFacing?.taskCoverageQuality || 'unknown'}`,
    `- runtime probe trend: ${summary.runtimeProbeTrend?.operatorFacing?.summaryText || 'n/a'}`,
    '',
    '## Evidence',
    `- status json: ${path.relative(runtime.workspaceDir, statusPath)}`,
    `- verify report: ${path.relative(runtime.workspaceDir, summary.verification.out || path.join(reportsDir, 'control-plane-verify.latest.json'))}`,
    `- metrics json: ${path.relative(runtime.workspaceDir, summary.metrics.out || path.join(reportsDir, 'compiler-metrics.latest.json'))}`,
  ].join('\n') + '\n';
  fs.writeFileSync(overviewPath, overview);
  fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2) + '\n');

  return { ok: true, generatedAt: summary.generatedAt, statusPath, overviewPath, reportPath, summary };
}

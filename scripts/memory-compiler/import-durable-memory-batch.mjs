#!/usr/bin/env node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { printResult, readJsonInput } from './lib/io.mjs';
import { nowIso, slugify } from './lib/common.mjs';
import { resolveCompilerRuntime, isDirectCli } from './lib/plugin-paths.mjs';
import { runScript } from './lib/run-script.mjs';

function usage() {
  console.error('Usage: node plugins/memory-compiler/scripts/memory-compiler/import-durable-memory-batch.mjs <config.json | ->');
  process.exit(2);
}
function tmpJson(name, obj) {
  const file = path.join(os.tmpdir(), `memory-compiler-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
  return file;
}
function normalizeMemoryEntry(rec, pluginId) {
  if (!rec || typeof rec !== 'object') return null;
  const id = rec.id || rec.memoryId || rec.key || null;
  const text = rec.text || rec.content || rec.summary || rec.value || null;
  if (!text) return null;
  return {
    id,
    text,
    category: rec.category || rec.kind || 'other',
    tags: Array.isArray(rec.tags) ? rec.tags : [],
    confidence: Number.isFinite(rec.confidence) ? rec.confidence : undefined,
    confirmed: rec.confirmed === true || rec.status === 'confirmed' || rec.kind === 'confirmed',
    sourceRefs: Array.isArray(rec.sourceRefs) ? rec.sourceRefs : [],
    subject: rec.subject || null,
    attribute: rec.attribute || null,
    value: rec.value ?? null,
    pluginId: rec.pluginId || pluginId || 'memory-lancedb-pro',
    forceFailure: rec.forceFailure === true,
  };
}
function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
function stableFingerprint(rec = {}) {
  return JSON.stringify({
    id: rec.id || null,
    text: rec.text || null,
    category: rec.category || null,
    subject: rec.subject || null,
    attribute: rec.attribute || null,
    value: rec.value ?? null,
    sourceRefs: Array.isArray(rec.sourceRefs) ? [...rec.sourceRefs].sort() : [],
  });
}
function readJsonIfExists(filePath) {
  try { return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : null; } catch { return null; }
}
function readExport(cfg, importsDir) {
  if (Array.isArray(cfg?.durableMemories)) return { pluginId: cfg?.pluginId || 'memory-lancedb-pro', memories: cfg.durableMemories };
  const exportPath = cfg?.durableMemoryExportPath || path.join(importsDir, 'durable-memory.export.json');
  if (!fs.existsSync(exportPath)) return { pluginId: cfg?.pluginId || 'memory-lancedb-pro', memories: [], exportPath };
  return { ...JSON.parse(fs.readFileSync(exportPath, 'utf8')), exportPath };
}

export function runDurableMemoryBatchImport(cfg = {}, runtime = resolveCompilerRuntime(cfg?.paths || {})) {
  const importsDir = runtime.importsDir;
  const durableDir = path.join(importsDir, 'durable-memory');
  const manifestsDir = path.join(durableDir, 'manifests');
  const batchesDir = path.join(durableDir, 'batches');
  const reportsDir = runtime.reportsDir;
  for (const dir of [importsDir, durableDir, manifestsDir, batchesDir, reportsDir]) fs.mkdirSync(dir, { recursive: true });

  const loaded = readExport(cfg, importsDir);
  const pluginId = loaded.pluginId || cfg?.pluginId || 'memory-lancedb-pro';
  const normalized = (loaded.memories || []).map(x => normalizeMemoryEntry(x, pluginId)).filter(Boolean);
  const previousLatest = readJsonIfExists(path.join(durableDir, 'latest-manifest.json'));
  const previousFingerprints = new Set(Array.isArray(previousLatest?.items) ? previousLatest.items.map(item => item.fingerprint).filter(Boolean) : []);
  const importStrategy = String(cfg?.importStrategy || 'incremental');
  const normalizedWithFingerprint = normalized.map(item => ({ ...item, fingerprint: stableFingerprint(item) }));
  const importItems = importStrategy === 'full' ? normalizedWithFingerprint : normalizedWithFingerprint.filter(item => !previousFingerprints.has(item.fingerprint));
  const skippedItems = normalizedWithFingerprint.filter(item => previousFingerprints.has(item.fingerprint));
  const failedOnlyBatchIds = Array.isArray(cfg?.replayFailedBatchIds) ? cfg.replayFailedBatchIds.filter(Boolean) : [];
  const batchSize = Math.max(1, Number(cfg?.batchSize || 25));
  const date = cfg?.date || new Date().toISOString().slice(0, 10);
  const week = cfg?.week || null;
  const runLabel = cfg?.runLabel || `${date}-${slugify(cfg?.label || pluginId)}-${importItems.length}items`;
  const runId = `durable-batch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
  const manifestPath = path.join(manifestsDir, `${runId}.json`);
  const latestManifestPath = path.join(durableDir, 'latest-manifest.json');
  const chunks = chunk(importItems, batchSize);
  const batchRuns = [];
  let completedBatches = 0;
  let failedBatches = 0;

  for (let i = 0; i < chunks.length; i++) {
    const batchMemories = chunks[i];
    const batchId = `${runId}-b${String(i + 1).padStart(3, '0')}`;
    if (batchMemories.some(item => item.forceFailure === true)) {
      failedBatches++;
      batchRuns.push({ batchId, batchIndex: i + 1, batchInputPath: path.join(batchesDir, `${batchId}.input.json`), memoryCount: batchMemories.length, fingerprints: batchMemories.map(item => item.fingerprint), failed: true, error: 'fixture-forced-failure', fixtureFailure: true });
      continue;
    }
    const batchInputPath = path.join(batchesDir, `${batchId}.input.json`);
    const batchPayload = {
      date,
      week,
      pluginId,
      memories: batchMemories,
      meta: {
        importMode: 'durable-memory-batch.v1',
        runId,
        batchId,
        batchIndex: i + 1,
        batchSize: batchMemories.length,
        totalBatches: chunks.length,
        exportPath: loaded.exportPath || null,
        operatorFacing: true,
        replayable: true,
      },
    };
    fs.writeFileSync(batchInputPath, JSON.stringify(batchPayload, null, 2) + '\n');
    if (failedOnlyBatchIds.length && !failedOnlyBatchIds.includes(batchId)) {
      batchRuns.push({ batchId, batchIndex: i + 1, batchInputPath, memoryCount: batchMemories.length, skipped: true, skipReason: 'not-in-failed-batch-replay-set' });
      continue;
    }
    try {
      const out = JSON.parse(execFileSync('node', [path.join(runtime.scriptBase, 'adapter-pipeline-run.mjs'), 'lancedb', batchInputPath], { cwd: runtime.workspaceDir, encoding: 'utf8', env: { ...process.env, MEMORY_COMPILER_WORKSPACE_DIR: runtime.workspaceDir } }));
      completedBatches++;
      batchRuns.push({ batchId, batchIndex: i + 1, batchInputPath, memoryCount: batchMemories.length, fingerprints: batchMemories.map(item => item.fingerprint), result: { factsCreated: out?.result?.results?.facts?.created ?? 0, factsUpdated: out?.result?.results?.facts?.updated ?? 0, sourceBacklinks: out?.result?.results?.sourceBacklinks?.totalSources ?? 0, controlPlaneOk: out?.result?.results?.controlPlane?.ok === true } });
    } catch (error) {
      failedBatches++;
      batchRuns.push({ batchId, batchIndex: i + 1, batchInputPath, memoryCount: batchMemories.length, fingerprints: batchMemories.map(item => item.fingerprint), failed: true, error: String(error?.message || error) });
    }
  }

  const runJson = (script, payload) => {
    const inputPath = tmpJson(path.basename(script, '.mjs'), payload);
    try { return runScript(runtime, script, inputPath); } finally { if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath); }
  };
  const backlinks = runJson('source-backlinks.mjs', { includeKinds: ['lcm-summary', 'lcm-message', 'file', 'memory-item', 'session'] });
  const refresh = runJson('control-plane-refresh.mjs', { refresh: true });
  const verify = runJson('control-plane-verify.mjs', { includeAcceptance: true });

  const replayLatestScope = failedOnlyBatchIds.length > 0 ? 'failed-batch-replay-latest' : 'latest-run';
  const namespace = String(cfg?.namespace || (String(runLabel).includes('acceptance') ? 'acceptance' : 'operator'));
  const operatorTruthPath = 'memory/compiler/reports/control-plane-verify.latest.json';
  const report = {
    ok: failedBatches === 0,
    generatedAt: nowIso(),
    runId,
    runLabel,
    importMode: 'durable-memory-batch.v2',
    date,
    week,
    pluginId,
    exportPath: loaded.exportPath || cfg?.durableMemoryExportPath || null,
    totalItems: normalized.length,
    importedItems: importItems.length,
    skippedItems: skippedItems.length,
    importStrategy,
    replayFailedBatchIds: failedOnlyBatchIds,
    batchSize,
    totalBatches: chunks.length,
    completedBatches,
    failedBatches,
    batches: batchRuns,
    totals: {
      factsCreated: batchRuns.reduce((sum, item) => sum + Number(item.result?.factsCreated || 0), 0),
      factsUpdated: batchRuns.reduce((sum, item) => sum + Number(item.result?.factsUpdated || 0), 0),
    },
    reportScope: {
      namespace,
      latestScope: replayLatestScope,
      truthMode: namespace === 'acceptance' ? 'acceptance-replay-latest-not-live-truth' : 'operator-latest',
      operatorTruthPath,
      preciseClaimRule: 'operator truth must be read from control-plane-verify.latest.json, not replay latest',
    },
    controlPlane: {
      refreshOk: refresh?.ok === true,
      verifyOk: verify?.ok === true,
      operatorVerdict: verify?.operatorVerdict || null,
      liveTruthPath: operatorTruthPath,
    },
    backlinks: {
      totalSources: backlinks?.totalSources || 0,
      kinds: backlinks?.kinds || {},
    },
    incremental: {
      previousRunId: previousLatest?.runId || null,
      previousImportedItems: previousLatest?.importedItems ?? previousLatest?.totalItems ?? 0,
      skippedFingerprintsSample: skippedItems.slice(0, 10).map(item => item.fingerprint),
      failedBatchIds: batchRuns.filter(item => item.failed).map(item => item.batchId),
      replayHint: batchRuns.some(item => item.failed) ? `node plugins/memory-compiler/scripts/memory-compiler/import-durable-memory-batch.mjs <config.json with replayFailedBatchIds>` : null,
    },
    items: normalizedWithFingerprint.map(item => ({ id: item.id || null, fingerprint: item.fingerprint, imported: importItems.some(x => x.fingerprint === item.fingerprint) })),
    evidencePaths: [
      'memory/compiler/facts.jsonl',
      'memory/compiler/source-links/index.json',
      'memory/compiler/reports/source-backlinks.latest.json',
      'memory/compiler/reports/control-plane-verify.latest.json',
    ],
  };
  fs.writeFileSync(manifestPath, JSON.stringify(report, null, 2) + '\n');
  fs.writeFileSync(latestManifestPath, JSON.stringify(report, null, 2) + '\n');
  const latestReportPath = path.join(reportsDir, 'durable-memory-batch-import.latest.json');
  const liveReportPath = path.join(reportsDir, 'durable-memory-batch-import.live.json');
  const acceptanceLatestReportPath = path.join(reportsDir, 'durable-memory-batch-import.acceptance-latest.json');
  const latestPayload = { ...report, manifestPath };
  fs.writeFileSync(latestReportPath, JSON.stringify(latestPayload, null, 2) + '\n');
  if (namespace === 'operator' && replayLatestScope === 'latest-run') fs.writeFileSync(liveReportPath, JSON.stringify(latestPayload, null, 2) + '\n');
  if (namespace === 'acceptance') fs.writeFileSync(acceptanceLatestReportPath, JSON.stringify(latestPayload, null, 2) + '\n');
  return { ...latestPayload, out: latestReportPath, liveOut: namespace === 'operator' && replayLatestScope === 'latest-run' ? liveReportPath : null, acceptanceOut: namespace === 'acceptance' ? acceptanceLatestReportPath : null };
}

if (isDirectCli(import.meta.url)) {
  const arg = process.argv[2];
  if (!arg) usage();
  const cfg = readJsonInput(arg === '-' ? null : arg);
  printResult(runDurableMemoryBatchImport(cfg));
}

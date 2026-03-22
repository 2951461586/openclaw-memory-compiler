#!/usr/bin/env node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { printResult, readJsonInput } from './lib/io.mjs';
import { isoWeekLabel, nowIso } from './lib/common.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const scriptBase = path.resolve(__dirname);
const pluginRoot = path.resolve(scriptBase, '..', '..');
const root = process.cwd();
const reportsDir = path.join(root, 'memory', 'compiler', 'reports');
fs.mkdirSync(reportsDir, { recursive: true });

function usage() {
  console.error('Usage: node plugins/memory-compiler/scripts/memory-compiler/import-real-sources.mjs <config.json | ->');
  process.exit(2);
}
function readText(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
}
function tmpJson(name, obj) {
  const file = path.join(os.tmpdir(), `memory-compiler-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(file, JSON.stringify(obj, null, 2));
  return file;
}
function runJson(script, payload = null) {
  let p = null;
  const args = [path.join(scriptBase, script)];
  if (payload) {
    p = tmpJson(path.basename(script, '.mjs'), payload);
    args.push(p);
  }
  try {
    return JSON.parse(execFileSync('node', args, { cwd: root, encoding: 'utf8' }));
  } finally {
    if (p && fs.existsSync(p)) fs.unlinkSync(p);
  }
}
function runAdapter(adapter, payload) {
  const p = tmpJson(`adapter-${adapter}`, payload);
  try {
    return JSON.parse(execFileSync('node', [path.join(scriptBase, 'adapter-pipeline-run.mjs'), adapter, p], { cwd: root, encoding: 'utf8' }));
  } finally {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}
function normalizeMemoryEntry(rec) {
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
  };
}

const arg = process.argv[2];
if (!arg) usage();
const cfg = readJsonInput(arg === '-' ? null : arg);
const date = cfg?.date || new Date().toISOString().slice(0, 10);
const week = cfg?.week || isoWeekLabel(date) || isoWeekLabel() || '1970-W01';
const workspaceRoot = cfg?.workspaceRoot || root;
const generatedAt = nowIso();
const pluginDocsDir = path.join(pluginRoot, 'docs');

const dailyGlobs = Array.isArray(cfg?.dailyMemoryPaths) && cfg.dailyMemoryPaths.length
  ? cfg.dailyMemoryPaths
  : [path.join(workspaceRoot, 'memory', `${date}.md`)];
const workspaceFiles = Array.isArray(cfg?.workspaceFiles) && cfg.workspaceFiles.length
  ? cfg.workspaceFiles
  : [
      path.join(workspaceRoot, 'SESSION-STATE.md'),
      path.join(workspaceRoot, 'memory', 'working-buffer.md'),
      path.join(pluginDocsDir, 'MASTERPLAN.md'),
      path.join(pluginDocsDir, 'IMPLEMENTATION-BACKLOG.md'),
      path.join(pluginDocsDir, 'OPERATOR-REVIEW-FLOW.md'),
      path.join(workspaceRoot, 'reports', 'openclaw-memory-compiler', 'SOURCE-REFS.md'),
      path.join(workspaceRoot, 'reports', 'openclaw-memory-compiler', 'DURABLE-MEMORY-BATCH-IMPORT-V2.md'),
      path.join(workspaceRoot, 'reports', 'openclaw-memory-compiler', 'RUNTIME-SOURCE-MIX-V2.md'),
      path.join(workspaceRoot, 'memory', '2026-03-19.md'),
      path.join(workspaceRoot, 'memory', '2026-03-18.md'),
    ];
const durableMemoryPath = cfg?.durableMemoryExportPath || path.join(workspaceRoot, 'memory', 'compiler', 'imports', 'durable-memory.export.json');

const existingDaily = dailyGlobs.filter(p => fs.existsSync(p));
const existingWorkspace = workspaceFiles.filter(p => fs.existsSync(p));
let durableExport = null;
if (fs.existsSync(durableMemoryPath)) {
  try { durableExport = JSON.parse(fs.readFileSync(durableMemoryPath, 'utf8')); } catch {}
}

const workspaceNotes = {
  date,
  week,
  notes: [
    ...existingDaily.map(filePath => ({
      filePath,
      scope: 'project',
      tags: ['daily-memory', 'real-import'],
      confirmedFacts: [{ text: `Daily memory imported from ${path.basename(filePath)}`, tags: ['daily-memory-import'], confidence: 0.93 }],
      activeThreads: [{ title: `daily-memory:${path.basename(filePath)}`, summary: readText(filePath).split(/\n+/).filter(Boolean).slice(0, 3).join(' | ') || `Imported daily memory file ${filePath}`, sourceRefs: [`file:${filePath}`], priority: 40 }],
      continuityFocus: `Imported daily memory source ${path.basename(filePath)} for compiler replay coverage.`,
      nextActions: ['Use evidence path when making precise claims from daily memory.'],
      relatedThreads: ['memory-compiler-ingest-real-sources'],
    })),
    ...existingWorkspace.map(filePath => ({
      filePath,
      scope: 'project',
      tags: ['workspace-scan', 'real-import'],
      confirmedFacts: [{ text: `Workspace source scanned: ${path.relative(workspaceRoot, filePath)}`, tags: ['workspace-scan'], confidence: 0.91 }],
      activeThreads: [{ title: `workspace-scan:${path.basename(filePath)}`, summary: readText(filePath).split(/\n+/).filter(Boolean).slice(0, 3).join(' | ') || `Scanned workspace file ${filePath}`, sourceRefs: [`file:${filePath}`], priority: 35 }],
      continuityFocus: `Workspace scan imported ${path.basename(filePath)} for operator-facing replay.`,
      nextActions: ['Check source backlinks and runtime source mix after import.'],
      relatedThreads: ['memory-compiler-ingest-real-sources'],
    })),
  ],
};

const sessionState = {
  date,
  week,
  filePath: path.join(workspaceRoot, 'SESSION-STATE.md'),
  scope: 'project',
  confirmedFacts: existingWorkspace.some(p => p.endsWith('SESSION-STATE.md'))
    ? [{ text: 'SESSION-STATE real import available for runtime continuity and source-first verification.', tags: ['session-state', 'real-import'], confidence: 0.94 }]
    : [],
  activeThreads: existingWorkspace.some(p => p.endsWith('SESSION-STATE.md'))
    ? [{ title: 'session-state-import', summary: 'SESSION-STATE imported via operator-facing real source entry.', sourceRefs: [`file:${path.join(workspaceRoot, 'SESSION-STATE.md')}`], nextStepHint: 'Use as continuity support, not sole authority for precise claims.', priority: 60 }]
    : [],
  continuityFocus: existingWorkspace.some(p => p.endsWith('SESSION-STATE.md')) ? 'SESSION-STATE imported through real source entry.' : null,
  decisions: ['Precise scene remains source-first.'],
  risks: [],
  nextActions: ['Verify runtime selector source mix diagnostics.'],
  relatedThreads: ['memory-compiler-ingest-real-sources'],
};

const durableEntries = Array.isArray(cfg?.durableMemories)
  ? cfg.durableMemories.map(normalizeMemoryEntry).filter(Boolean)
  : Array.isArray(durableExport?.memories)
    ? durableExport.memories.map(normalizeMemoryEntry).filter(Boolean)
    : [];
const durablePayload = { date, week, pluginId: durableExport?.pluginId || cfg?.pluginId || 'memory-lancedb-pro', memories: durableEntries };

const runs = [];
if (workspaceNotes.notes.length) runs.push({ kind: 'workspace', out: runAdapter('workspace', workspaceNotes) });
if (sessionState.confirmedFacts.length || sessionState.activeThreads.length || sessionState.continuityFocus) runs.push({ kind: 'session-state', out: runAdapter('session-state', sessionState) });
if (durableEntries.length) {
  if (cfg?.durableImportMode === 'batch' || durableEntries.length > Number(cfg?.durableBatchThreshold || 1)) {
    runs.push({
      kind: 'lancedb-batch',
      out: runJson('import-durable-memory-batch.mjs', {
        date,
        week,
        pluginId: durablePayload.pluginId,
        durableMemories: durableEntries,
        durableMemoryExportPath: fs.existsSync(durableMemoryPath) ? durableMemoryPath : null,
        batchSize: cfg?.durableBatchSize || 25,
        label: cfg?.durableBatchLabel || 'real-import',
      })
    });
  } else {
    runs.push({ kind: 'lancedb', out: runAdapter('lancedb', durablePayload) });
  }
}

const controlPlane = runJson('control-plane-refresh.mjs', { refresh: true });
const verify = runJson('control-plane-verify.mjs', { includeAcceptance: true });

const sourceLinkIndex = JSON.parse(fs.readFileSync(path.join(root, 'memory', 'compiler', 'source-links', 'index.json'), 'utf8'));
const sourceCoverage = {
  totalSources: sourceLinkIndex?.totalSources || 0,
  totalArtifacts: sourceLinkIndex?.totalArtifacts || 0,
  kinds: sourceLinkIndex?.kinds || {},
  realInputSourcesPresent: {
    dailyMemory: existingDaily.map(filePath => `file:${filePath}`).filter(ref => (sourceLinkIndex?.sources || []).some(item => item.sourceRef === ref)),
    workspace: existingWorkspace.map(filePath => `file:${filePath}`).filter(ref => (sourceLinkIndex?.sources || []).some(item => item.sourceRef === ref)),
    durableMemory: durableEntries.map(item => `mem:${item.id}`).filter(ref => (sourceLinkIndex?.sources || []).some(entry => entry.sourceRef === ref)),
  },
};
const report = {
  ok: true,
  generatedAt,
  date,
  week,
  sources: {
    dailyMemoryPaths: existingDaily,
    workspaceFiles: existingWorkspace,
    durableMemoryExportPath: fs.existsSync(durableMemoryPath) ? durableMemoryPath : null,
    durableMemoryItems: durableEntries.length,
  },
  sourceCoverage,
  runs: runs.map(item => ({
    kind: item.kind,
    adapter: item.out?.adapter || item.out?.result?.adapter || item.out?.importMode || item.kind,
    inputPath: item.out?.inputPath || item.out?.manifestPath || null,
    factsCreated: item.out?.result?.results?.facts?.created ?? item.out?.totals?.factsCreated ?? null,
    factsUpdated: item.out?.result?.results?.facts?.updated ?? item.out?.totals?.factsUpdated ?? null,
    threadsCreated: item.out?.result?.results?.threads?.created ?? null,
    continuityCreated: item.out?.result?.results?.continuity?.created ?? null,
    sourceBacklinks: item.out?.result?.results?.sourceBacklinks?.totalSources ?? item.out?.backlinks?.totalSources ?? null,
    batchCount: item.out?.totalBatches ?? (Number(item.out?.totalItems || 0) > 0 ? Math.ceil(Number(item.out?.totalItems || 0) / Math.max(1, Number(item.out?.batchSize || 25))) : null),
    completedBatches: item.out?.completedBatches ?? null,
    failedBatches: item.out?.failedBatches ?? null,
    durableItems: item.out?.totalItems ?? null,
    importedDurableItems: item.out?.importedItems ?? null,
    skippedDurableItems: item.out?.skippedItems ?? null,
    importStrategy: item.out?.importStrategy ?? null,
    failedBatchIds: item.out?.incremental?.failedBatchIds ?? [],
    evidencePaths: [
      'memory/compiler/facts.jsonl',
      'memory/compiler/threads.jsonl',
      'memory/compiler/continuity.jsonl',
      'memory/compiler/source-links/index.json',
      'memory/compiler/reports/control-plane-verify.latest.json',
      'memory/compiler/reports/durable-memory-batch-import.latest.json',
    ],
  })),
  controlPlane: {
    refreshed: controlPlane?.ok === true,
    verifyOk: verify?.ok === true,
    operatorVerdict: verify?.operatorVerdict || null,
    evidencePaths: verify?.evidencePaths || [],
  },
};

const out = path.join(reportsDir, 'real-import.latest.json');
fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
printResult({ ...report, out });

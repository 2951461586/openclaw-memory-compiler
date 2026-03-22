#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { readJsonInput, printResult } from './lib/io.mjs';
import { nowIso } from './lib/common.mjs';
import { triageReviewQueue } from './lib/review-triage-core.mjs';
import { readJsonl } from './lib/jsonl-store.mjs';
import { resolveCompilerRuntime } from './lib/plugin-paths.mjs';

function usage() {
  console.error('Usage: node plugins/memory-compiler/scripts/memory-compiler/operator-review-blocking-triage.mjs <config.json | ->');
  process.exit(2);
}

const arg = process.argv[2];
if (!arg) usage();
const cfg = readJsonInput(arg === '-' ? null : arg);
const runtime = resolveCompilerRuntime();
const reportsDir = runtime.reportsDir;
fs.mkdirSync(reportsDir, { recursive: true });

const triage = triageReviewQueue({
  root: runtime.workspaceDir,
  paths: runtime,
  limit: Number(cfg?.limit || 5),
  status: String(cfg?.status || 'open'),
  operatorOnly: true,
  query: cfg?.query || '',
  priority: cfg?.priority,
  reviewType: cfg?.reviewType,
  namespace: 'operator',
  origin: 'operator',
});

const queue = readJsonl(path.join(runtime.dataDir, 'review-queue.jsonl'));
const acceptanceEvidenceItems = queue
  .filter(item => String(item?.reason || '') === 'acceptance-operator-blocking-triage')
  .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));

const report = {
  ok: true,
  generatedAt: nowIso(),
  blockingOpen: triage.operatorFacing?.blockingOpen || 0,
  total: triage.total,
  operatorFacing: triage.operatorFacing || null,
  acceptanceEvidence: {
    total: acceptanceEvidenceItems.length,
    openCount: acceptanceEvidenceItems.filter(item => item.status === 'open').length,
    resolvedCount: acceptanceEvidenceItems.filter(item => item.status === 'resolved').length,
    recent: acceptanceEvidenceItems.slice(0, Number(cfg?.limit || 5)).map(item => ({
      id: item.id,
      title: item.title || item.factId || 'untitled',
      status: item.status || 'open',
      resolution: item.resolution || null,
      origin: item.origin || 'operator',
      namespace: item.namespace || (item.origin === 'acceptance' ? 'acceptance' : 'operator'),
      operatorVisible: item.operatorVisible !== false,
      sourceDispatchBlocking: item.sourceDispatchBlocking === true || item.blockedState === 'source-discipline',
      sourceRefs: item.sourceRefs || [],
      updatedAt: item.updatedAt || item.createdAt || null,
    })),
  },
  summaryText: triage.summaryText,
  evidencePaths: [
    path.relative(runtime.workspaceDir, path.join(runtime.dataDir, 'review-queue.jsonl')),
    path.relative(runtime.workspaceDir, path.join(reportsDir, 'operator-review-blocking-triage.latest.json')),
  ],
};

const out = path.join(reportsDir, 'operator-review-blocking-triage.latest.json');
fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
printResult({ ...report, out });

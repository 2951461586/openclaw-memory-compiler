#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { readJsonInput, printResult } from './lib/io.mjs';
import { nowIso } from './lib/common.mjs';
import { readJsonl, writeJsonl } from './lib/jsonl-store.mjs';
import { resolveCompilerRuntime, isDirectCli } from './lib/plugin-paths.mjs';

function usage() {
  console.error('Usage: node plugins/memory-compiler/scripts/memory-compiler/acceptance-review-governance.mjs <config.json | ->');
  process.exit(2);
}
function baseTitle(title = '') {
  return String(title)
    .replace(/ mm[0-9a-z]+$/i, '')
    .replace(/ [0-9a-z]{8,}$/i, '')
    .trim();
}
function isAcceptance(item) {
  return item?.operatorVisible === false || (item?.origin || 'operator') === 'acceptance' || (item?.namespace || 'operator') === 'acceptance';
}
function ageHours(item) {
  const ts = Date.parse(String(item?.createdAt || item?.updatedAt || ''));
  return Number.isFinite(ts) ? Math.max(0, (Date.now() - ts) / 3600000) : null;
}

export function runAcceptanceReviewGovernance(payload = {}, runtime = resolveCompilerRuntime(payload?.paths || {})) {
  const queuePath = path.join(runtime.dataDir, 'review-queue.jsonl');
  const reportsDir = runtime.reportsDir;
  const archiveDir = path.join(runtime.reportArchivesDir, 'acceptance-review-governance');
  fs.mkdirSync(archiveDir, { recursive: true });

  const action = String(payload?.action || 'compress');
  const minAgeHours = Number(payload?.minAgeHours ?? 0.25);
  const maxKeepPerSignature = Math.max(1, Number(payload?.maxKeepPerSignature ?? 2));
  const now = nowIso();
  const records = readJsonl(queuePath);
  const acceptanceOpen = records.filter(item => item.status === 'open' && isAcceptance(item));
  const operatorOpenBefore = records.filter(item => item.status === 'open' && !isAcceptance(item)).length;

  const groups = new Map();
  for (const item of acceptanceOpen) {
    const signature = `${item.reviewType || 'review'}::${baseTitle(item.title)}::${item.targetState || ''}`;
    if (!groups.has(signature)) groups.set(signature, []);
    groups.get(signature).push(item);
  }

  const compressed = [];
  const kept = [];
  for (const [signature, items] of groups.entries()) {
    items.sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
    items.forEach((item, idx) => {
      const oldEnough = (ageHours(item) ?? 0) >= minAgeHours;
      if (idx < maxKeepPerSignature || !oldEnough || action === 'report-only') {
        kept.push(item.id);
        return;
      }
      item.status = 'resolved';
      item.resolvedAt = now;
      item.resolution = 'compressed';
      item.resolutionNote = `acceptance-aging-compressed:${baseTitle(item.title) || item.reviewType}`;
      item.updatedAt = now;
      compressed.push({ id: item.id, title: item.title || null, reviewType: item.reviewType || null, targetState: item.targetState || null, ageHours: ageHours(item), signature });
    });
  }

  if (action !== 'report-only' && compressed.length) {
    writeJsonl(queuePath, records.sort((a,b)=>String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))));
  }

  const refreshedRecords = readJsonl(queuePath);
  const acceptanceOpenAfter = refreshedRecords.filter(item => item.status === 'open' && isAcceptance(item));
  const report = {
    ok: true,
    generatedAt: now,
    action,
    contractVersion: 'acceptance-review-governance.v1',
    summary: {
      acceptanceOpenBefore: acceptanceOpen.length,
      acceptanceOpenAfter: acceptanceOpenAfter.length,
      compressedCount: compressed.length,
      keptOpenCount: acceptanceOpenAfter.length,
      operatorOpenBefore,
      operatorOpenAfter: refreshedRecords.filter(item => item.status === 'open' && !isAcceptance(item)).length,
      uniqueAcceptanceSignatures: groups.size,
    },
    governance: {
      minAgeHours,
      maxKeepPerSignature,
      compressionPolicy: 'compress aged duplicate acceptance follow-up samples; keep latest exemplars for audit and namespace isolation',
      signatures: Array.from(groups.entries()).map(([signature, items]) => ({ signature, openCountBefore: items.length, keptCount: Math.min(items.length, maxKeepPerSignature), compressedCount: Math.max(0, items.length - Math.min(items.length, maxKeepPerSignature)) })),
    },
    compressed,
    keptSampleIds: kept.slice(0, 20),
    evidencePaths: [
      'memory/compiler/review-queue.jsonl',
      'memory/compiler/reports/acceptance-review-governance.latest.json',
      'memory/compiler/reports/control-plane-verify.latest.json',
    ],
  };
  const out = path.join(reportsDir, 'acceptance-review-governance.latest.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  const archivePath = path.join(archiveDir, `${now.replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(archivePath, JSON.stringify(report, null, 2) + '\n');
  return { ok: true, out, archivePath, summary: report.summary, governance: report.governance };
}

if (isDirectCli(import.meta.url)) {
  const arg = process.argv[2];
  if (!arg) usage();
  const payload = readJsonInput(arg === '-' ? null : arg);
  printResult(runAcceptanceReviewGovernance(payload));
}

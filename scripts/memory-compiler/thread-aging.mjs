#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { readJsonInput, printResult } from './lib/io.mjs';
import { readJsonl, writeJsonl } from './lib/jsonl-store.mjs';
import { nowIso } from './lib/common.mjs';
import { resolveCompilerRuntime, isDirectCli } from './lib/plugin-paths.mjs';

function parseAgeHours(iso) {
  const ts = Date.parse(String(iso || ''));
  if (!ts) return null;
  return (Date.now() - ts) / 3600_000;
}
function parseAgeDays(iso) {
  const ts = Date.parse(String(iso || ''));
  if (!ts) return null;
  return (Date.now() - ts) / 86400_000;
}
function usage() {
  console.error('Usage: node plugins/memory-compiler/scripts/memory-compiler/thread-aging.mjs <input.json | ->');
  process.exit(2);
}

export function ageThreads(payload = {}, runtime = resolveCompilerRuntime()) {
  const compilerDir = runtime.dataDir;
  const threadsPath = path.join(compilerDir, 'threads.jsonl');
  const archivePath = path.join(compilerDir, 'threads.archive.jsonl');
  if (!fs.existsSync(threadsPath)) {
    return { ok: true, updated: 0, reason: 'threads.jsonl missing', archived: 0, stale: 0, closed: 0 };
  }

  const closeAfterHours = Number(payload?.closeAfterHours || 168);
  const archiveAfterDays = Number(payload?.archiveAfterDays || 30);
  const records = readJsonl(threadsPath);
  const archiveRecords = readJsonl(archivePath);
  const archiveById = new Map(archiveRecords.map(r => [r.id, r]));
  const now = nowIso();
  let stale = 0;
  let closed = 0;
  let archived = 0;
  const kept = [];

  for (const rec of records) {
    const updatedAgeHours = parseAgeHours(rec.updatedAt);
    if (rec.status === 'active') {
      const staleAfterHours = Number(rec.staleAfterHours || 0);
      if (updatedAgeHours != null && staleAfterHours > 0 && updatedAgeHours > staleAfterHours) {
        rec.status = 'stale';
        rec.staledAt = rec.staledAt || now;
        rec.updatedAt = now;
        stale++;
      }
    }

    if (rec.status === 'stale') {
      const staleAgeHours = parseAgeHours(rec.staledAt || rec.updatedAt);
      if (staleAgeHours != null && staleAgeHours > closeAfterHours) {
        rec.status = 'closed';
        rec.closedAt = rec.closedAt || now;
        rec.updatedAt = now;
        closed++;
      }
    }

    if (rec.status === 'closed') {
      const closedAgeDays = parseAgeDays(rec.closedAt || rec.updatedAt);
      if (closedAgeDays != null && closedAgeDays > archiveAfterDays) {
        const archivedRec = { ...rec, archivedAt: now, archiveReason: rec.archiveReason || 'aged-closed-thread' };
        if (!archiveById.has(rec.id)) {
          archiveRecords.push(archivedRec);
          archiveById.set(rec.id, archivedRec);
        }
        archived++;
        continue;
      }
    }

    kept.push(rec);
  }

  writeJsonl(threadsPath, kept.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))));
  writeJsonl(archivePath, archiveRecords.sort((a, b) => String(b.archivedAt || b.closedAt || b.updatedAt || '').localeCompare(String(a.archivedAt || a.closedAt || a.updatedAt || ''))));
  return { ok: true, updated: stale + closed + archived, stale, closed, archived, total: kept.length, archiveTotal: archiveRecords.length, closeAfterHours, archiveAfterDays, path: threadsPath, archivePath };
}

if (isDirectCli(import.meta.url)) {
  const payload = process.argv[2] ? readJsonInput(process.argv[2] === '-' ? null : process.argv[2]) : {};
  printResult(ageThreads(payload));
}

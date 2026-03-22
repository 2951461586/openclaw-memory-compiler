#!/usr/bin/env node
import path from 'path';
import { readJsonInput, printResult } from './lib/io.mjs';
import { readJsonl, writeJsonl } from './lib/jsonl-store.mjs';
import { nowIso, hashId, uniq } from './lib/common.mjs';
import { assessSourceRefs } from './lib/source-discipline.mjs';
import { resolveCompilerRuntime, isDirectCli } from './lib/plugin-paths.mjs';

function usage() {
  console.error('Usage: node plugins/memory-compiler/scripts/memory-compiler/continuity-compiler.mjs <input.json | ->');
  process.exit(2);
}

export function compileContinuity(payload = {}, runtime = resolveCompilerRuntime()) {
  const continuityPath = path.join(runtime.dataDir, 'continuity.jsonl');
  const items = Array.isArray(payload?.continuity) ? payload.continuity : [];
  if (items.length === 0) {
    return { ok: true, created: 0, updated: 0, total: readJsonl(continuityPath).length, note: 'no continuity candidates' };
  }

  const existing = readJsonl(continuityPath);
  const byId = new Map(existing.map(r => [r.id, r]));
  const records = [...existing];
  let created = 0;
  let updated = 0;
  let gated = 0;
  const now = nowIso();

  for (const raw of items) {
    const focus = String(raw?.focus || '').trim();
    if (!focus) continue;
    const id = raw?.id || hashId('continuity', [focus]);
    const sourceRefs = uniq(raw?.sourceRefs || []);
    const discipline = assessSourceRefs(sourceRefs);
    const existingRec = byId.get(id);
    const gatedExpiresAt = !discipline.hasTrusted ? now : (raw?.expiresAt ?? null);
    if (!discipline.hasTrusted) gated++;

    if (!existingRec) {
      const rec = {
        id,
        focus,
        decisions: uniq(raw?.decisions || []),
        risks: uniq(raw?.risks || []),
        nextActions: uniq(raw?.nextActions || []),
        relatedThreads: uniq(raw?.relatedThreads || []),
        sourceRefs,
        updatedAt: raw?.updatedAt || now,
        expiresAt: gatedExpiresAt,
        sourceDisciplineState: discipline.hasTrusted ? 'trusted' : 'untrusted-gated'
      };
      if (!discipline.hasTrusted) {
        rec.sourceDisciplineReason = 'live-continuity-expired-at-ingest';
        rec.sourceDisciplineGatedAt = now;
      }
      records.push(rec);
      byId.set(id, rec);
      created++;
      continue;
    }

    existingRec.focus = focus;
    existingRec.decisions = uniq([...(existingRec.decisions || []), ...(raw?.decisions || [])]);
    existingRec.risks = uniq([...(existingRec.risks || []), ...(raw?.risks || [])]);
    existingRec.nextActions = uniq([...(existingRec.nextActions || []), ...(raw?.nextActions || [])]);
    existingRec.relatedThreads = uniq([...(existingRec.relatedThreads || []), ...(raw?.relatedThreads || [])]);
    existingRec.sourceRefs = uniq([...(existingRec.sourceRefs || []), ...sourceRefs]);
    existingRec.updatedAt = raw?.updatedAt || now;
    existingRec.expiresAt = gatedExpiresAt;
    existingRec.sourceDisciplineState = discipline.hasTrusted ? 'trusted' : 'untrusted-gated';
    if (!discipline.hasTrusted) {
      existingRec.sourceDisciplineReason = 'live-continuity-expired-at-ingest';
      existingRec.sourceDisciplineGatedAt = now;
    }
    updated++;
  }

  records.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  writeJsonl(continuityPath, records);
  return { ok: true, created, updated, gated, total: records.length, path: continuityPath };
}

if (isDirectCli(import.meta.url)) {
  const arg = process.argv[2];
  if (!arg) usage();
  const payload = readJsonInput(arg === '-' ? null : arg);
  printResult(compileContinuity(payload));
}

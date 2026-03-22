#!/usr/bin/env node
import path from 'path';
import { readJsonInput, printResult } from './lib/io.mjs';
import { readJsonl, writeJsonl } from './lib/jsonl-store.mjs';
import { nowIso, hashId, uniq, normalizeText } from './lib/common.mjs';
import { assessSourceRefs } from './lib/source-discipline.mjs';
import { resolveCompilerRuntime, isDirectCli } from './lib/plugin-paths.mjs';

function usage() {
  console.error('Usage: node plugins/memory-compiler/scripts/memory-compiler/thread-compiler.mjs <input.json | ->');
  process.exit(2);
}

export function compileThreads(payload = {}, runtime = resolveCompilerRuntime()) {
  const threadsPath = path.join(runtime.dataDir, 'threads.jsonl');
  const candidates = Array.isArray(payload?.threads) ? payload.threads : [];
  if (candidates.length === 0) {
    return { ok: true, created: 0, updated: 0, total: readJsonl(threadsPath).length, note: 'no thread candidates' };
  }

  const existing = readJsonl(threadsPath);
  const byId = new Map(existing.map(r => [r.id, r]));
  const byTitle = new Map(existing.map(r => [`${r.scope}::${normalizeText(r.title)}`, r]));
  const records = [...existing];
  let created = 0;
  let updated = 0;
  let gated = 0;
  const now = nowIso();

  for (const raw of candidates) {
    const title = String(raw?.title || '').trim();
    if (!title) continue;
    const scope = String(raw?.scope || 'project');
    const id = raw?.id || hashId('thread', [scope, title]);
    const requestedStatus = String(raw?.status || 'active');
    const key = `${scope}::${normalizeText(title)}`;
    const existingRec = byId.get(id) || byTitle.get(key);
    const sourceRefs = uniq(raw?.sourceRefs || []);
    const discipline = assessSourceRefs(sourceRefs);
    const status = requestedStatus === 'active' && !discipline.hasTrusted ? 'blocked' : requestedStatus;
    if (status !== requestedStatus) gated++;
    const staleAfterHours = Number(raw?.staleAfterHours || 72);

    if (!existingRec) {
      const rec = {
        id,
        title,
        scope,
        status,
        summary: String(raw?.summary || title),
        sourceRefs,
        relatedFacts: uniq(raw?.relatedFacts || []),
        nextStepHint: raw?.nextStepHint || null,
        updatedAt: raw?.updatedAt || now,
        staleAfterHours,
        priority: raw?.priority ?? null,
        owner: raw?.owner || null,
        sourceDisciplineState: discipline.hasTrusted ? 'trusted' : 'untrusted-gated'
      };
      if (!discipline.hasTrusted && requestedStatus === 'active') {
        rec.blockedAt = now;
        rec.blockedReason = 'active-thread-blocked-at-ingest';
      }
      records.push(rec);
      byId.set(id, rec);
      byTitle.set(key, rec);
      created++;
      continue;
    }

    existingRec.title = title;
    existingRec.scope = scope;
    existingRec.status = status || existingRec.status;
    if (raw?.summary) existingRec.summary = String(raw.summary);
    existingRec.sourceRefs = uniq([...(existingRec.sourceRefs || []), ...sourceRefs]);
    existingRec.relatedFacts = uniq([...(existingRec.relatedFacts || []), ...(raw?.relatedFacts || [])]);
    if (raw?.nextStepHint !== undefined) existingRec.nextStepHint = raw.nextStepHint;
    existingRec.updatedAt = raw?.updatedAt || now;
    existingRec.staleAfterHours = staleAfterHours;
    if (raw?.priority !== undefined) existingRec.priority = raw.priority;
    if (raw?.owner !== undefined) existingRec.owner = raw.owner;
    existingRec.sourceDisciplineState = assessSourceRefs(existingRec.sourceRefs).hasTrusted ? 'trusted' : 'untrusted-gated';
    if (!discipline.hasTrusted && requestedStatus === 'active') {
      existingRec.blockedAt = now;
      existingRec.blockedReason = 'active-thread-blocked-at-ingest';
    }
    updated++;
  }

  records.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  writeJsonl(threadsPath, records);
  return { ok: true, created, updated, gated, total: records.length, path: threadsPath };
}

if (isDirectCli(import.meta.url)) {
  const arg = process.argv[2];
  if (!arg) usage();
  const payload = readJsonInput(arg === '-' ? null : arg);
  printResult(compileThreads(payload));
}

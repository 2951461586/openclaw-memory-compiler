#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { readJsonInput, printResult } from './lib/io.mjs';
import { normalizeText, uniq, nowIso } from './lib/common.mjs';
import { readJsonl, writeJsonl } from './lib/jsonl-store.mjs';
import { resolveCompilerRuntime, isDirectCli } from './lib/plugin-paths.mjs';

function usage() {
  console.error('Usage: node plugins/memory-compiler/scripts/memory-compiler/fact-conflicts.mjs <input.json | ->');
  process.exit(2);
}

export function detectFactConflicts(cfg = {}, runtime = resolveCompilerRuntime()) {
  const compilerDir = runtime.dataDir;
  const factsPath = path.join(compilerDir, 'facts.jsonl');
  const reportsDir = runtime.reportsDir;
  fs.mkdirSync(reportsDir, { recursive: true });

  const applyDispute = !!cfg.applyDispute;
  const disputeSourceRefs = uniq(cfg.sourceRefs || []);
  const disputeReason = cfg.reason || 'auto-disputed-from-conflict-detector';

  const facts = readJsonl(factsPath);
  const activeFacts = facts.filter(f => f.status !== 'stale');
  const groups = new Map();
  for (const fact of activeFacts) {
    if (!fact.subject || !fact.attribute) continue;
    const key = `${fact.scope}::${normalizeText(fact.subject)}::${normalizeText(fact.attribute)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(fact);
  }

  const conflicts = [];
  let applied = 0;
  const now = nowIso();
  for (const [key, list] of groups.entries()) {
    const confirmed = list.filter(x => x.status === 'confirmed');
    const uniqueValues = new Map();
    for (const item of confirmed) {
      const v = normalizeText(item.value ?? item.text);
      if (!uniqueValues.has(v)) uniqueValues.set(v, []);
      uniqueValues.get(v).push(item.id);
    }
    if (uniqueValues.size > 1) {
      const conflict = {
        key,
        scope: confirmed[0]?.scope ?? null,
        subject: confirmed[0]?.subject ?? null,
        attribute: confirmed[0]?.attribute ?? null,
        variants: [...uniqueValues.entries()].map(([valueNorm, ids]) => ({ valueNorm, ids })),
        factIds: confirmed.map(x => x.id)
      };
      conflicts.push(conflict);
      if (applyDispute) {
        for (const item of confirmed) {
          item.status = 'disputed';
          item.disputedAt = now;
          item.disputeReason = disputeReason;
          item.sourceRefs = uniq([...(item.sourceRefs || []), ...disputeSourceRefs]);
          applied++;
        }
      }
    }
  }

  if (applyDispute && applied) writeJsonl(factsPath, facts);
  const report = {
    generatedAt: now,
    factCount: activeFacts.length,
    conflictCount: conflicts.length,
    applyDispute,
    applied,
    conflicts
  };
  const out = path.join(reportsDir, 'fact-conflicts.latest.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  return { ok: true, out, conflictCount: conflicts.length, applied };
}

if (isDirectCli(import.meta.url)) {
  const arg = process.argv[2];
  const cfg = arg ? readJsonInput(arg === '-' ? null : arg) : {};
  printResult(detectFactConflicts(cfg));
}

#!/usr/bin/env node
import path from 'node:path';
import { readJsonInput, printResult } from './lib/io.mjs';
import { readJsonl, writeJsonl } from './lib/jsonl-store.mjs';
import { uniq, nowIso, mergeConfidence } from './lib/common.mjs';

const root = process.cwd();
const factsPath = path.join(root, 'memory', 'compiler', 'facts.jsonl');

function usage() {
  console.error('Usage: node plugins/memory-compiler/scripts/memory-compiler/fact-reconcile.mjs <actions.json | ->');
  process.exit(2);
}

const arg = process.argv[2];
if (!arg) usage();
const payload = readJsonInput(arg === '-' ? null : arg);
const actions = Array.isArray(payload?.actions) ? payload.actions : [];
const records = readJsonl(factsPath);
const byId = new Map(records.map(r => [r.id, r]));
const now = nowIso();
let changed = 0;

for (const action of actions) {
  const kind = String(action.kind || '').trim();
  if (kind === 'supersede') {
    const target = byId.get(action.targetFactId);
    if (!target) continue;
    const mergedIds = [];
    for (const oldId of action.supersededFactIds || []) {
      const old = byId.get(oldId);
      if (!old || old.id === target.id) continue;
      old.status = 'stale';
      old.supersededBy = target.id;
      old.expiresAt = action.expiresAt || now;
      old.sourceRefs = uniq([...(old.sourceRefs || []), ...(action.sourceRefs || [])]);
      target.sourceRefs = uniq([...(target.sourceRefs || []), ...(old.sourceRefs || []), ...(action.sourceRefs || [])]);
      target.tags = uniq([...(target.tags || []), ...(old.tags || [])]);
      target.confidence = mergeConfidence(target.confidence, old.confidence);
      mergedIds.push(old.id);
      changed++;
    }
    if (mergedIds.length) {
      target.mergedFactIds = uniq([...(target.mergedFactIds || []), ...mergedIds]);
      target.reconciledAt = now;
      if (action.note) target.reconcileNote = action.note;
      changed++;
    }
  } else if (kind === 'merge-into-target') {
    const target = byId.get(action.targetFactId);
    const source = byId.get(action.sourceFactId);
    if (!target || !source || target.id === source.id) continue;
    target.tags = uniq([...(target.tags || []), ...(source.tags || []), ...(action.tags || [])]);
    target.sourceRefs = uniq([...(target.sourceRefs || []), ...(source.sourceRefs || []), ...(action.sourceRefs || [])]);
    target.confidence = mergeConfidence(target.confidence, source.confidence);
    if (!target.subject && source.subject) target.subject = source.subject;
    if (!target.attribute && source.attribute) target.attribute = source.attribute;
    if (target.value == null && source.value != null) target.value = source.value;
    source.status = 'stale';
    source.supersededBy = target.id;
    source.expiresAt = now;
    target.mergedFactIds = uniq([...(target.mergedFactIds || []), source.id]);
    changed += 2;
  } else if (kind === 'mark-disputed-group') {
    for (const factId of action.factIds || []) {
      const fact = byId.get(factId);
      if (!fact) continue;
      fact.status = 'disputed';
      fact.disputedAt = now;
      fact.disputeReason = action.reason || null;
      fact.sourceRefs = uniq([...(fact.sourceRefs || []), ...(action.sourceRefs || [])]);
      changed++;
    }
  }
}

writeJsonl(factsPath, records);
printResult({ ok: true, changed, total: records.length, path: factsPath });

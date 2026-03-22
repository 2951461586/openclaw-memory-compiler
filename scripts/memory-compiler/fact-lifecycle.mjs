#!/usr/bin/env node
import path from 'path';
import { readJsonInput, printResult } from './lib/io.mjs';
import { readJsonl, writeJsonl } from './lib/jsonl-store.mjs';
import { uniq, nowIso, mergeConfidence } from './lib/common.mjs';
import { assessSourceRefs } from './lib/source-discipline.mjs';
import { resolveCompilerRuntime } from './lib/plugin-paths.mjs';

const runtime = resolveCompilerRuntime();
const factsPath = path.join(runtime.dataDir, 'facts.jsonl');

function usage() {
  console.error('Usage: node plugins/memory-compiler/scripts/memory-compiler/fact-lifecycle.mjs <actions.json | ->');
  process.exit(2);
}

const arg = process.argv[2];
if (!arg) usage();
const payload = readJsonInput(arg === '-' ? null : arg);
const actions = Array.isArray(payload?.actions) ? payload.actions : [];
const records = readJsonl(factsPath);
const byId = new Map(records.map(r => [r.id, r]));
let changed = 0;
const now = nowIso();
const results = [];

for (const action of actions) {
  const fact = byId.get(action.factId);
  if (!fact) {
    results.push({ factId: action.factId || null, kind: String(action.kind || '').trim(), ok: false, reason: 'fact-not-found' });
    continue;
  }
  const kind = String(action.kind || '').trim();
  if (kind === 'promote') {
    fact.sourceRefs = uniq([...(fact.sourceRefs || []), ...(action.sourceRefs || [])]);
    const discipline = assessSourceRefs(fact.sourceRefs || []);
    if (!discipline.hasTrusted && action.allowUntrustedPromotion !== true) {
      fact.status = 'inferred';
      fact.sourceDisciplineReason = action.sourceDisciplineReason || 'promotion-blocked-untrusted-sources';
      fact.sourceDisciplineBlockedAt = now;
      fact.sourceDisciplineState = 'untrusted-gated';
      changed++;
      results.push({ factId: fact.id, kind, ok: true, changed: true, status: fact.status, blocked: true, trustedRefs: discipline.trustedRefs, totalRefs: discipline.totalRefs, sourceDisciplineReason: fact.sourceDisciplineReason, sourceDisciplineState: fact.sourceDisciplineState, sourceDisciplineBlockedAt: fact.sourceDisciplineBlockedAt, reviewType: action.reviewType || null, operatorFlow: action.operatorFlow || null, evidenceMode: action.evidenceMode || null, sourceDispatchBlocking: action.reviewSourceBlocking === true });
      continue;
    }
    fact.status = 'confirmed';
    fact.lastConfirmedAt = now;
    fact.confidence = mergeConfidence(fact.confidence, action.confidence ?? 0.9);
    fact.sourceDisciplineState = discipline.hasTrusted ? 'trusted' : 'untrusted-approved';
    if (fact.sourceDisciplineReason && String(fact.sourceDisciplineReason).includes('promotion-blocked')) delete fact.sourceDisciplineReason;
    if (fact.sourceDisciplineBlockedAt) delete fact.sourceDisciplineBlockedAt;
    changed++;
    results.push({ factId: fact.id, kind, ok: true, changed: true, status: fact.status, blocked: false, trustedRefs: discipline.trustedRefs, totalRefs: discipline.totalRefs, sourceDisciplineState: fact.sourceDisciplineState, reviewType: action.reviewType || null, operatorFlow: action.operatorFlow || null, evidenceMode: action.evidenceMode || null, sourceDispatchBlocking: false });
  } else if (kind === 'dispute') {
    fact.status = 'disputed';
    fact.disputedAt = now;
    fact.disputeReason = action.reason || null;
    fact.sourceRefs = uniq([...(fact.sourceRefs || []), ...(action.sourceRefs || [])]);
    changed++;
    results.push({ factId: fact.id, kind, ok: true, changed: true, status: fact.status });
  } else if (kind === 'reject') {
    fact.status = 'stale';
    fact.expiresAt = action.expiresAt || now;
    fact.rejectedAt = now;
    fact.rejectionReason = action.reason || null;
    fact.sourceRefs = uniq([...(fact.sourceRefs || []), ...(action.sourceRefs || [])]);
    changed++;
    results.push({ factId: fact.id, kind, ok: true, changed: true, status: fact.status, lifecycleState: 'rejected', rejectionReason: fact.rejectionReason });
  } else if (kind === 'stale') {
    fact.status = 'stale';
    fact.expiresAt = action.expiresAt || now;
    fact.sourceRefs = uniq([...(fact.sourceRefs || []), ...(action.sourceRefs || [])]);
    changed++;
    results.push({ factId: fact.id, kind, ok: true, changed: true, status: fact.status });
  } else if (kind === 'refresh') {
    fact.confidence = mergeConfidence(fact.confidence, action.confidence ?? fact.confidence);
    fact.sourceRefs = uniq([...(fact.sourceRefs || []), ...(action.sourceRefs || [])]);
    const discipline = assessSourceRefs(fact.sourceRefs || []);
    fact.sourceDisciplineState = discipline.hasTrusted ? 'trusted' : 'untrusted-gated';
    if (discipline.hasTrusted) {
      if (fact.sourceDisciplineReason && String(fact.sourceDisciplineReason).includes('promotion-blocked')) delete fact.sourceDisciplineReason;
      if (fact.sourceDisciplineBlockedAt) delete fact.sourceDisciplineBlockedAt;
    }
    if (fact.status === 'confirmed') fact.lastConfirmedAt = now;
    changed++;
    results.push({ factId: fact.id, kind, ok: true, changed: true, status: fact.status, trustedRefs: discipline.trustedRefs, totalRefs: discipline.totalRefs, sourceDisciplineState: fact.sourceDisciplineState, sourceRefs: fact.sourceRefs });
  } else {
    results.push({ factId: fact.id, kind, ok: false, reason: 'unsupported-action' });
  }
}

writeJsonl(factsPath, records);
printResult({ ok: true, changed, total: records.length, path: factsPath, results });

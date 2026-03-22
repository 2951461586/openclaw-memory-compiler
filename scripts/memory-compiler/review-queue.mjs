#!/usr/bin/env node
import path from 'path';
import { readJsonInput, printResult } from './lib/io.mjs';
import { readJsonl, writeJsonl } from './lib/jsonl-store.mjs';
import { hashId, nowIso, uniq } from './lib/common.mjs';
import { resolveCompilerRuntime } from './lib/plugin-paths.mjs';

const runtime = resolveCompilerRuntime();
const queuePath = path.join(runtime.dataDir, 'review-queue.jsonl');

function usage() {
  console.error('Usage: node plugins/memory-compiler/scripts/memory-compiler/review-queue.mjs <actions.json | ->');
  process.exit(2);
}

const arg = process.argv[2];
if (!arg) usage();
const payload = readJsonInput(arg === '-' ? null : arg);
const action = String(payload?.action || 'list');
const records = readJsonl(queuePath);
const now = nowIso();

if (action === 'list') {
  let items = [...records];
  if (payload?.status) items = items.filter(x => x.status === payload.status);
  if (payload?.reviewType) items = items.filter(x => x.reviewType === payload.reviewType);
  if (payload?.scope) items = items.filter(x => x.scope === payload.scope);
  if (payload?.factId) items = items.filter(x => x.factId === payload.factId);
  if (payload?.priority) items = items.filter(x => x.priority === payload.priority);
  if (payload?.query) {
    const q = String(payload.query).toLowerCase();
    items = items.filter(x => [x.title, x.reason, x.factId, x.reviewType, x.scope].filter(Boolean).some(v => String(v).toLowerCase().includes(q)));
  }
  const limit = Number(payload?.limit || 0);
  if (limit > 0) items = items.slice(0, limit);
  printResult({ ok: true, total: items.length, items });
  process.exit(0);
}

if (action === 'enqueue') {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const byKey = new Map(records.map(r => [`${r.reviewType}::${r.factId || ''}::${r.title || ''}`, r]));
  let created = 0;
  let updated = 0;
  for (const raw of items) {
    const key = `${raw.reviewType || 'review'}::${raw.factId || ''}::${raw.title || ''}`;
    const existing = byKey.get(key);
    if (existing && existing.status !== 'resolved') {
      existing.updatedAt = now;
      existing.priority = raw.priority || existing.priority;
      existing.reason = raw.reason || existing.reason;
      existing.targetState = raw.targetState || existing.targetState;
      existing.suggestedDecision = raw.suggestedDecision || existing.suggestedDecision;
      existing.operatorFlow = raw.operatorFlow || existing.operatorFlow;
      if (typeof raw.operatorVisible === 'boolean') existing.operatorVisible = raw.operatorVisible;
      existing.origin = raw.origin || existing.origin || 'operator';
      existing.namespace = raw.namespace || existing.namespace || (existing.origin === 'acceptance' ? 'acceptance' : 'operator');
      existing.evidenceMode = raw.evidenceMode || existing.evidenceMode || (existing.origin === 'acceptance' ? 'sample' : 'source-first');
      existing.followUpOf = uniq([...(existing.followUpOf || []), ...(raw.followUpOf || [])]);
      existing.followUpReviewIds = uniq([...(existing.followUpReviewIds || []), ...(raw.followUpReviewIds || [])]);
      existing.sourceRefs = uniq([...(existing.sourceRefs || []), ...(raw.sourceRefs || [])]);
      if (typeof raw.sourceDispatchBlocking === 'boolean') existing.sourceDispatchBlocking = raw.sourceDispatchBlocking;
      if (typeof raw.sourceDispatchRequired === 'boolean') existing.sourceDispatchRequired = raw.sourceDispatchRequired;
      if (raw.blockedState) existing.blockedState = raw.blockedState;
      updated++;
      continue;
    }
    const rec = {
      id: raw.id || hashId('review', [raw.reviewType || 'review', raw.factId || '', raw.title || '', now, Math.random().toString(36).slice(2)]),
      status: 'open',
      reviewType: raw.reviewType || 'review',
      factId: raw.factId || null,
      title: raw.title || null,
      reason: raw.reason || null,
      scope: raw.scope || 'project',
      priority: raw.priority || 'medium',
      targetState: raw.targetState || null,
      suggestedDecision: raw.suggestedDecision || null,
      operatorFlow: raw.operatorFlow || null,
      operatorVisible: raw.operatorVisible === false ? false : true,
      origin: raw.origin || 'operator',
      namespace: raw.namespace || (raw.origin === 'acceptance' ? 'acceptance' : 'operator'),
      evidenceMode: raw.evidenceMode || (raw.origin === 'acceptance' ? 'sample' : 'source-first'),
      followUpOf: uniq(raw.followUpOf || []),
      followUpReviewIds: uniq(raw.followUpReviewIds || []),
      sourceRefs: uniq(raw.sourceRefs || []),
      sourceDispatchBlocking: raw.sourceDispatchBlocking === true,
      sourceDispatchRequired: raw.sourceDispatchRequired === true,
      blockedState: raw.blockedState || null,
      createdAt: now,
      updatedAt: now,
    };
    records.push(rec);
    byKey.set(key, rec);
    created++;
  }
  writeJsonl(queuePath, records.sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))));
  printResult({ ok: true, created, updated, total: records.length, path: queuePath });
  process.exit(0);
}

if (action === 'resolve') {
  const ids = new Set((payload?.ids || []).map(String));
  let changed = 0;
  for (const rec of records) {
    if (!ids.has(String(rec.id))) continue;
    rec.status = 'resolved';
    rec.resolvedAt = now;
    rec.resolution = payload?.resolution || null;
    rec.updatedAt = now;
    changed++;
  }
  writeJsonl(queuePath, records.sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))));
  printResult({ ok: true, changed, total: records.length, path: queuePath });
  process.exit(0);
}

console.error(`Unsupported action: ${action}`);
process.exit(2);

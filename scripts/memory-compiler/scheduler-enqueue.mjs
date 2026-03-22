#!/usr/bin/env node
import path from 'path';
import { readJsonInput, printResult } from './lib/io.mjs';
import { readJsonl, writeJsonl } from './lib/jsonl-store.mjs';
import { nowIso, hashId, uniq } from './lib/common.mjs';
import { resolveCompilerRuntime } from './lib/plugin-paths.mjs';

const runtime = resolveCompilerRuntime();
const queuePath = path.join(runtime.dataDir, 'scheduler-pending.jsonl');

function usage() {
  console.error('Usage: node plugins/memory-compiler/scripts/memory-compiler/scheduler-enqueue.mjs <event.json | ->');
  process.exit(2);
}
function normalizedBundle(bundle={}) {
  return {
    facts: Array.isArray(bundle?.facts) ? bundle.facts : [],
    threads: Array.isArray(bundle?.threads) ? bundle.threads : [],
    continuity: Array.isArray(bundle?.continuity) ? bundle.continuity : [],
  };
}
function mergeBundle(a={}, b={}) {
  return {
    facts: [...(a.facts || []), ...(b.facts || [])],
    threads: [...(a.threads || []), ...(b.threads || [])],
    continuity: [...(a.continuity || []), ...(b.continuity || [])],
  };
}
function coalesceKeyFor(evt) {
  if (evt?.coalesceKey) return String(evt.coalesceKey);
  const refs = uniq(evt?.changedSourceRefs || []).sort();
  const sourceHookType = evt?.source?.hookType || '';
  const bucket = evt?.coalesceWindow || evt?.eventBucket || '';
  return hashId('schedq', [String(evt?.eventType || 'manual'), sourceHookType, String(evt?.date || ''), String(evt?.week || ''), bucket, JSON.stringify(refs)]);
}
function scorePriority(evt, skipReasons=[]) {
  const eventType = String(evt?.eventType || 'manual');
  let score = { 'session-end': 90, 'subagent-complete': 85, 'daily': 70, 'weekly': 65, 'heartbeat': 55, 'manual': 40 }[eventType] || 50;
  if (skipReasons.includes('deduped')) score += 6;
  if (skipReasons.includes('throttled')) score += 3;
  if ((evt?.bundle?.facts || []).length) score += 4;
  if ((evt?.bundle?.threads || []).length) score += 2;
  if (Number(evt?.sourceDispatchBlockingOpen || 0) > 0) score += 30 + (Math.min(5, Number(evt?.sourceDispatchBlockingOpen || 0)) * 2);
  return score;
}

const arg = process.argv[2];
if (!arg) usage();
const payload = readJsonInput(arg === '-' ? null : arg);
const queue = readJsonl(queuePath);
const now = nowIso();
const itemEventType = String(payload?.eventType || 'manual');
const coalesceKey = coalesceKeyFor(payload);
const existing = queue.find(x => x.status === 'pending' && x.coalesceKey === coalesceKey);
const refs = uniq(payload?.changedSourceRefs || []);
const bundle = normalizedBundle(payload?.bundle || {});
const skipReasons = Array.isArray(payload?.skipReasons) ? payload.skipReasons : (payload?.skipReason ? [payload.skipReason] : []);
const priorityScore = scorePriority(payload, skipReasons);

if (existing) {
  existing.bundle = mergeBundle(existing.bundle || {}, bundle);
  existing.changedSourceRefs = uniq([...(existing.changedSourceRefs || []), ...refs]);
  existing.eventFingerprints = uniq([...(existing.eventFingerprints || []), ...(payload?.eventFingerprint ? [payload.eventFingerprint] : [])]);
  existing.hookIds = uniq([...(existing.hookIds || []), ...(payload?.source?.hookId ? [payload.source.hookId] : [])]);
  existing.skipReasons = uniq([...(existing.skipReasons || []), ...skipReasons]);
  existing.enqueueCount = Number(existing.enqueueCount || 1) + 1;
  existing.mergedEvents = Number(existing.mergedEvents || 1) + 1;
  existing.lastQueuedAt = now;
  existing.date = payload?.date || existing.date || null;
  existing.week = payload?.week || existing.week || null;
  existing.latestSkipReason = skipReasons[0] || existing.latestSkipReason || null;
  existing.priorityScore = Math.max(Number(existing.priorityScore || 0), priorityScore);
  existing.sourceDispatchBlockingOpen = Math.max(Number(existing.sourceDispatchBlockingOpen || 0), Number(payload?.sourceDispatchBlockingOpen || 0));
  existing.coalesceWindow = payload?.coalesceWindow || existing.coalesceWindow || null;
  queue.sort((a, b) => String(b.lastQueuedAt || b.firstQueuedAt).localeCompare(String(a.lastQueuedAt || a.firstQueuedAt)));
  writeJsonl(queuePath, queue);
  printResult({ ok: true, action: 'merged', id: existing.id, coalesceKey, enqueueCount: existing.enqueueCount, mergedEvents: existing.mergedEvents, changedSourceRefs: existing.changedSourceRefs.length });
  process.exit(0);
}

const rec = {
  id: payload?.id || hashId('pending', [itemEventType, coalesceKey, now]),
  status: 'pending',
  eventType: itemEventType,
  coalesceKey,
  source: payload?.source || null,
  date: payload?.date || null,
  week: payload?.week || null,
  bundle,
  changedSourceRefs: refs,
  eventFingerprints: payload?.eventFingerprint ? [payload.eventFingerprint] : [],
  hookIds: payload?.source?.hookId ? [payload.source.hookId] : [],
  skipReasons,
  latestSkipReason: skipReasons[0] || null,
  enqueueCount: 1,
  mergedEvents: 1,
  priorityScore,
  sourceDispatchBlockingOpen: Number(payload?.sourceDispatchBlockingOpen || 0),
  coalesceWindow: payload?.coalesceWindow || null,
  firstQueuedAt: now,
  lastQueuedAt: now,
};
queue.unshift(rec);
writeJsonl(queuePath, queue);
printResult({ ok: true, action: 'created', id: rec.id, coalesceKey, enqueueCount: 1, mergedEvents: 1, changedSourceRefs: rec.changedSourceRefs.length });

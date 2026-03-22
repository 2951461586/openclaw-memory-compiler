#!/usr/bin/env node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { readJsonInput, printResult } from './lib/io.mjs';
import { readJsonl, writeJsonl } from './lib/jsonl-store.mjs';
import { nowIso } from './lib/common.mjs';
import { resolveCompilerRuntime, isDirectCli } from './lib/plugin-paths.mjs';
import { runScript } from './lib/run-script.mjs';

function usage() {
  console.error('Usage: node plugins/memory-compiler/scripts/memory-compiler/scheduler-drain.mjs <config.json | ->');
  process.exit(2);
}
function tempJson(name, obj) {
  const p = path.join(os.tmpdir(), `memory-compiler-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
  return p;
}
function ageMinutes(item, nowMs) {
  const t = new Date(item.lastQueuedAt || item.firstQueuedAt || 0).getTime();
  return t ? (nowMs - t) / 60000 : 0;
}
export function schedulerDrainScore(item, nowMs = Date.now()) {
  return Number(item.priorityScore || 0)
    + Math.min(20, ageMinutes(item, nowMs) / 5)
    + Math.min(10, Number(item.enqueueCount || 1) - 1)
    + (Number(item.sourceDispatchBlockingOpen || 0) > 0 ? 25 + Math.min(10, Number(item.sourceDispatchBlockingOpen || 0) * 2) : 0);
}

export function drainSchedulerQueue(payload = {}, runtime = resolveCompilerRuntime()) {
  const compilerDir = runtime.dataDir;
  const queuePath = path.join(compilerDir, 'scheduler-pending.jsonl');
  const reportsDir = runtime.reportsDir;
  const reportPath = path.join(reportsDir, 'scheduler-drain.latest.json');
  fs.mkdirSync(reportsDir, { recursive: true });

  let queue = readJsonl(queuePath);
  let items = queue.filter(x => x.status === 'pending');
  if (payload?.eventType) items = items.filter(x => x.eventType === payload.eventType);
  const nowMs = Date.now();
  const limit = Number(payload?.limit || 10);
  items = items.sort((a, b) => schedulerDrainScore(b, nowMs) - schedulerDrainScore(a, nowMs)).slice(0, limit);
  const drained = [];
  const failed = [];

  for (const item of items) {
    try {
      item.drainSelectedAt = nowIso();
      item.drainScore = schedulerDrainScore(item, nowMs);
      const evt = {
        eventType: item.eventType,
        date: item.date,
        week: item.week,
        bundle: item.bundle,
        changedSourceRefs: item.changedSourceRefs || [],
        eventFingerprint: `drain:${item.id}:${Date.now()}`,
        force: true,
        dedupeMinutes: 0,
        enqueueOnSkip: false,
        source: { ...(item.source || {}), drainFrom: item.id },
        coalesceKey: item.coalesceKey,
        sourceDispatchBlockingOpen: Number(item.sourceDispatchBlockingOpen || 0),
      };
      const p = tempJson('scheduler-drain', evt);
      const out = runScript(runtime, 'scheduler-run.mjs', p);
      fs.unlinkSync(p);
      item.status = 'drained';
      item.drainedAt = nowIso();
      item.drainResult = { eventType: out.eventType, jobs: out.jobs, throttled: !!out.throttled, deduped: !!out.deduped, enqueued: out.enqueued || null };
      drained.push({ id: item.id, eventType: item.eventType, jobs: out.jobs, drainScore: item.drainScore });
    } catch (err) {
      item.status = 'failed';
      item.failedAt = nowIso();
      item.error = err.message;
      failed.push({ id: item.id, error: err.message });
    }
  }

  queue = queue.map(rec => items.find(x => x.id === rec.id) || rec)
    .sort((a, b) => String(b.lastQueuedAt || b.firstQueuedAt).localeCompare(String(a.lastQueuedAt || a.firstQueuedAt)));
  writeJsonl(queuePath, queue);
  const out = {
    ok: failed.length === 0,
    drainedCount: drained.length,
    failedCount: failed.length,
    drained,
    failed,
    pendingRemaining: queue.filter(x => x.status === 'pending').length,
    pendingTop: queue.filter(x => x.status === 'pending').sort((a, b) => schedulerDrainScore(b, nowMs) - schedulerDrainScore(a, nowMs)).slice(0, 5).map(x => ({ id: x.id, eventType: x.eventType, priorityScore: x.priorityScore || 0, effectiveScore: schedulerDrainScore(x, nowMs), enqueueCount: x.enqueueCount || 1 }))
  };
  fs.writeFileSync(reportPath, JSON.stringify({ generatedAt: nowIso(), ...out }, null, 2) + '\n');
  return out;
}

if (isDirectCli(import.meta.url)) {
  const arg = process.argv[2];
  const payload = arg ? readJsonInput(arg === '-' ? null : arg) : {};
  printResult(drainSchedulerQueue(payload));
}

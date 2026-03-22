#!/usr/bin/env node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { readJsonInput, printResult } from './lib/io.mjs';
import { nowIso, hashId } from './lib/common.mjs';
import { appendJsonl, readJsonl } from './lib/jsonl-store.mjs';
import { resolveCompilerRuntime } from './lib/plugin-paths.mjs';
import { runScript } from './lib/run-script.mjs';

const runtime = resolveCompilerRuntime();
const compilerDir = runtime.dataDir;
const reportsDir = runtime.reportsDir;
const hookEventsPath = path.join(compilerDir, 'hook-events.jsonl');
fs.mkdirSync(reportsDir, { recursive: true });
const reportPath = path.join(reportsDir, 'hook-dispatch.latest.json');

function usage() {
  console.error('Usage: node plugins/memory-compiler/scripts/memory-compiler/hook-dispatch.mjs <hook-event.json | ->');
  process.exit(2);
}
function run(script, inputPath) {
  return runScript(runtime, script, inputPath);
}
function tempJson(name, obj) {
  const p = path.join(os.tmpdir(), `memory-compiler-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
  return p;
}
function bundleShape(bundle={}) {
  return {
    facts: Array.isArray(bundle.facts) ? bundle.facts.length : 0,
    threads: Array.isArray(bundle.threads) ? bundle.threads.length : 0,
    continuity: Array.isArray(bundle.continuity) ? bundle.continuity.length : 0,
  };
}

const arg = process.argv[2];
if (!arg) usage();
const payload = readJsonInput(arg === '-' ? null : arg);
const hookType = String(payload?.hookType || payload?.eventType || 'manual');
const map = {
  'session-end': 'session-end',
  'subagent-complete': 'subagent-complete',
  'heartbeat': 'heartbeat',
  'daily': 'daily',
  'weekly': 'weekly',
  'cron-daily': 'daily',
  'cron-weekly': 'weekly',
  'manual': 'manual',
};
const eventType = map[hookType] || 'manual';
const hookId = String(payload?.hookId || hashId('hook', [hookType, JSON.stringify(bundleShape(payload?.bundle || {})), JSON.stringify((payload?.changedSourceRefs || []).slice().sort()), payload?.date || '', payload?.week || '']));
const hookEvents = readJsonl(hookEventsPath);
const prior = hookEvents.slice().reverse().find(x => x.hookId === hookId);
if (prior && payload?.force !== true && payload?.allowDuplicate !== true) {
  const duplicate = {
    id: hashId('hookevt', [hookId, nowIso(), 'duplicate']),
    hookId,
    hookType,
    eventType,
    status: 'duplicate-skipped',
    duplicateOf: prior.id,
    createdAt: nowIso(),
  };
  appendJsonl(hookEventsPath, duplicate);
  const report = { generatedAt: nowIso(), hookType, eventType, hookId, skipped: true, reason: 'duplicate-hook', duplicateOf: prior.id };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  printResult({ ok: true, hookType, eventType, hookId, skipped: true, reason: 'duplicate-hook', duplicateOf: prior.id });
  process.exit(0);
}

const eventFingerprint = String(payload?.eventFingerprint || hashId('schedfp', [eventType, hookId, JSON.stringify((payload?.changedSourceRefs || []).slice().sort()), payload?.date || '', payload?.week || '', JSON.stringify(bundleShape(payload?.bundle || {}))]));
const schedulerEvent = {
  eventType,
  date: payload.date,
  week: payload.week,
  bundle: payload.bundle,
  bundlePath: payload.bundlePath,
  changedSourceRefs: payload.changedSourceRefs || [],
  eventFingerprint,
  runAcceptance: payload.runAcceptance === true,
  force: payload.force === true,
  minIntervalMinutes: payload.minIntervalMinutes,
  dedupeMinutes: payload.dedupeMinutes,
  reviewLimit: payload.reviewLimit,
  sessionKey: payload.sessionKey,
  enqueueOnSkip: payload.enqueueOnSkip !== false,
  coalesceKey: payload.coalesceKey,
  source: {
    hookType,
    hookId,
  },
};
const startedAt = nowIso();
appendJsonl(hookEventsPath, {
  id: hashId('hookevt', [hookId, startedAt, 'dispatched']),
  hookId,
  hookType,
  eventType,
  eventFingerprint,
  status: 'dispatching',
  createdAt: startedAt,
});
const evtPath = tempJson('hook-dispatch', schedulerEvent);
const out = run('scheduler-run.mjs', evtPath);
fs.unlinkSync(evtPath);
appendJsonl(hookEventsPath, {
  id: hashId('hookevt', [hookId, nowIso(), out.throttled ? 'throttled' : out.jobs > 0 ? 'executed' : 'noop']),
  hookId,
  hookType,
  eventType,
  eventFingerprint,
  status: out.throttled ? 'throttled' : out.jobs > 0 ? 'executed' : 'noop',
  jobs: out.jobs,
  createdAt: nowIso(),
});
const report = { generatedAt: nowIso(), hookType, eventType, hookId, eventFingerprint, schedulerEvent, out };
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
printResult({ ok: true, hookType, eventType, hookId, eventFingerprint, out });

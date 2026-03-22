#!/usr/bin/env node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { readJsonInput, printResult } from './lib/io.mjs';
import { nowIso, hashId } from './lib/common.mjs';
import { appendJsonl } from './lib/jsonl-store.mjs';
import { resolveCompilerRuntime, isDirectCli } from './lib/plugin-paths.mjs';
import { runScript } from './lib/run-script.mjs';
import { planScheduler } from './scheduler-plan.mjs';

function usage() {
  console.error('Usage: node plugins/memory-compiler/scripts/memory-compiler/scheduler-run.mjs <event.json | ->');
  process.exit(2);
}
function tempJson(name, obj) {
  const p = path.join(os.tmpdir(), `memory-compiler-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
  return p;
}
function readJson(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return fallback; }
}
function writeJson(filePath, obj) {
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2) + '\n');
}
function isoWeekLabel(d) {
  const dt = d ? new Date(d) : new Date();
  const d2 = new Date(dt.valueOf() + (3 - (dt.getDay() + 6) % 7) * 864e5);
  const w = Math.ceil((((d2 - new Date(d2.getFullYear(), 0, 1)) / 864e5) + 1) / 7);
  return `${d2.getFullYear()}-W${String(w).padStart(2, '0')}`;
}
function maybeEnqueueSkipped(plan, evt, runtime) {
  if (evt?.enqueueOnSkip === false) return null;
  if (!(plan?.throttled || plan?.deduped)) return null;
  const shouldQueue = !['manual'].includes(String(plan?.eventType || evt?.eventType || ''));
  if (!shouldQueue) return null;
  const skipReasons = (plan?.skipped || []).map(x => x.reason).filter(Boolean);
  const payload = {
    eventType: plan?.eventType || evt?.eventType || 'manual',
    date: evt?.date,
    week: evt?.week,
    bundle: evt?.bundle,
    changedSourceRefs: evt?.changedSourceRefs || [],
    eventFingerprint: plan?.eventFingerprint || evt?.eventFingerprint || null,
    coalesceKey: evt?.coalesceKey,
    source: evt?.source || null,
    skipReasons,
    sourceDispatchBlockingOpen: Number(plan?.sourceDispatchBlockingOpen || 0),
  };
  const p = tempJson('scheduler-enqueue', payload);
  const out = runScript(runtime, 'scheduler-enqueue.mjs', p);
  fs.unlinkSync(p);
  return out;
}

export function runSchedulerEvent(evt = {}, runtime = resolveCompilerRuntime()) {
  const compilerDir = runtime.dataDir;
  const reportsDir = runtime.reportsDir;
  fs.mkdirSync(reportsDir, { recursive: true });
  const planReportPath = path.join(reportsDir, 'scheduler-plan.latest.json');
  const runReportPath = path.join(reportsDir, 'scheduler-run.latest.json');
  const auditReportPath = path.join(reportsDir, 'scheduler-audit.latest.json');
  const schedulerStatePath = path.join(compilerDir, 'scheduler-state.json');
  const schedulerHistoryPath = path.join(compilerDir, 'scheduler-history.jsonl');

  const startedAt = nowIso();
  const plan = planScheduler(evt, runtime);
  writeJson(planReportPath, { generatedAt: startedAt, ...plan });

  const results = [];
  const executedJobs = [];
  for (const job of plan.jobs) {
    if (job.kind === 'trigger-execute') {
      let bundlePath = evt.bundlePath;
      let tempBundle = null;
      if (!bundlePath && evt.bundle) {
        tempBundle = tempJson('scheduler-bundle', evt.bundle);
        bundlePath = tempBundle;
      }
      const out = runScript(runtime, 'trigger-execute.mjs', bundlePath);
      results.push({ job, out }); executedJobs.push(job.kind);
      if (tempBundle) fs.unlinkSync(tempBundle);
    } else if (job.kind === 'compile-today') {
      const p = tempJson('scheduler-today', { type: 'today', date: evt.date || new Date().toISOString().slice(0, 10), generationStrategy: 'scheduler-run-plugin-v2', forceChangedSourceCompile: true, changedSourceRefs: evt.changedSourceRefs || [] });
      results.push({ job, out: runScript(runtime, 'digest-compiler.mjs', p) }); executedJobs.push(job.kind); fs.unlinkSync(p);
    } else if (job.kind === 'compile-week') {
      const p = tempJson('scheduler-week', { type: 'week', week: evt.week || isoWeekLabel(evt.date) || isoWeekLabel() || '1970-W01', generationStrategy: 'scheduler-run-plugin-v2', forceChangedSourceCompile: true, changedSourceRefs: evt.changedSourceRefs || [] });
      results.push({ job, out: runScript(runtime, 'digest-compiler.mjs', p) }); executedJobs.push(job.kind); fs.unlinkSync(p);
    } else if (job.kind === 'compile-narrative') {
      const p = tempJson('scheduler-narrative', { type: 'narrative', generationStrategy: 'scheduler-run-plugin-v2', forceChangedSourceCompile: true, changedSourceRefs: evt.changedSourceRefs || [] });
      results.push({ job, out: runScript(runtime, 'digest-compiler.mjs', p) }); executedJobs.push(job.kind); fs.unlinkSync(p);
    } else if (job.kind === 'thread-aging') {
      results.push({ job, out: runScript(runtime, 'thread-aging.mjs') }); executedJobs.push(job.kind);
    } else if (job.kind === 'digest-gc') {
      results.push({ job, out: runScript(runtime, 'digest-gc.mjs') }); executedJobs.push(job.kind);
    } else if (job.kind === 'integrity-audit') {
      results.push({ job, out: runScript(runtime, 'integrity-audit.mjs') }); executedJobs.push(job.kind);
    } else if (job.kind === 'source-discipline-check') {
      results.push({ job, out: runScript(runtime, 'source-discipline-check.mjs') }); executedJobs.push(job.kind);
    } else if (job.kind === 'review-snapshot') {
      const p = tempJson('scheduler-review-list', { action: 'list', status: 'open', limit: evt.reviewLimit || 20 });
      const out = runScript(runtime, 'review-queue.mjs', p);
      results.push({ job, out }); executedJobs.push(job.kind); fs.unlinkSync(p);
      if (Number(job.sourceDispatchBlockingOpen || plan.sourceDispatchBlockingOpen || 0) > 0) {
        const triageCfg = tempJson('scheduler-operator-blocking-triage', { limit: evt.reviewLimit || 5, status: 'open' });
        results.push({ job: { kind: 'operator-review-blocking-triage', reason: 'source-dispatch-blocking-open' }, out: runScript(runtime, 'operator-review-blocking-triage.mjs', triageCfg) });
        executedJobs.push('operator-review-blocking-triage');
        fs.unlinkSync(triageCfg);
      }
    } else if (job.kind === 'session-pack-refresh') {
      const p = tempJson('scheduler-pack-refresh', { action: 'refresh', sessionKey: evt.sessionKey || null, date: evt.date, week: evt.week, scene: 'task' });
      results.push({ job, out: runScript(runtime, 'session-pack-lifecycle.mjs', p) }); executedJobs.push(job.kind); fs.unlinkSync(p);
    } else if (job.kind === 'session-pack-finalize') {
      const p = tempJson('scheduler-pack-finalize', { action: 'finalize', sessionKey: evt.sessionKey || null, eventType: evt.eventType, reason: 'scheduler-session-end' });
      results.push({ job, out: runScript(runtime, 'session-pack-lifecycle.mjs', p) }); executedJobs.push(job.kind); fs.unlinkSync(p);
    } else if (job.kind === 'session-pack-expire') {
      const p = tempJson('scheduler-pack-expire', { action: 'expire', sessionKey: evt.sessionKey || null, reason: 'scheduler-maintenance' });
      results.push({ job, out: runScript(runtime, 'session-pack-lifecycle.mjs', p) }); executedJobs.push(job.kind); fs.unlinkSync(p);
    } else if (job.kind === 'session-pack-handoff') {
      const p = tempJson('scheduler-pack-handoff', { action: 'handoff', sessionKey: evt.sessionKey || null, reason: 'scheduler-subagent-complete' });
      results.push({ job, out: runScript(runtime, 'session-pack-lifecycle.mjs', p) }); executedJobs.push(job.kind); fs.unlinkSync(p);
    } else if (job.kind === 'acceptance-smoke') {
      results.push({ job, out: runScript(runtime, 'acceptance-smoke.mjs') }); executedJobs.push(job.kind);
    }
  }

  const enqueued = maybeEnqueueSkipped(plan, evt, runtime);
  const finishedAt = nowIso();
  const output = { ok: true, eventType: plan.eventType, eventFingerprint: plan.eventFingerprint || null, throttled: !!plan.throttled, deduped: !!plan.deduped, jobs: results.length, enqueued, results };
  const audit = {
    generatedAt: finishedAt,
    eventType: plan.eventType,
    eventFingerprint: plan.eventFingerprint || null,
    throttled: !!plan.throttled,
    deduped: !!plan.deduped,
    plannedJobs: (plan.jobs || []).map(j => j.kind),
    executedJobs,
    skipped: plan.skipped || [],
    enqueued,
    openReviews: plan.openReviews || 0,
    minIntervalMinutes: plan.minIntervalMinutes || 0,
    lastRunAt: plan.lastRunAt || null,
  };
  writeJson(runReportPath, { generatedAt: finishedAt, plan, output });
  writeJson(auditReportPath, audit);
  const state = readJson(schedulerStatePath, { lastRuns: {}, lastAttempts: {}, runCount: 0, lastJobCount: 0 });
  state.lastRuns = state.lastRuns || {};
  state.lastAttempts = state.lastAttempts || {};
  state.lastAttempts[plan.eventType] = finishedAt;
  if (!plan.throttled) state.lastRuns[plan.eventType] = finishedAt;
  state.lastJobCount = results.length;
  state.runCount = Number(state.runCount || 0) + 1;
  state.lastEventType = plan.eventType;
  state.lastFinishedAt = finishedAt;
  state.lastThrottled = !!plan.throttled;
  state.lastDeduped = !!plan.deduped;
  state.lastEnqueued = enqueued?.id || null;
  writeJson(schedulerStatePath, state);
  appendJsonl(schedulerHistoryPath, {
    id: hashId('schedrun', [plan.eventType, finishedAt, String(results.length), String(!!plan.throttled)]),
    eventType: plan.eventType,
    eventFingerprint: plan.eventFingerprint || null,
    throttled: !!plan.throttled,
    deduped: !!plan.deduped,
    jobs: results.length,
    plannedJobs: (plan.jobs || []).map(j => j.kind),
    executedJobs,
    startedAt,
    finishedAt,
    skipped: plan.skipped || [],
    enqueuedId: enqueued?.id || null
  });
  const backlinksCfg = tempJson('scheduler-backlinks', { includeKinds: ['lcm-summary', 'lcm-message', 'file', 'memory-item', 'session'] });
  const sourceBacklinks = runScript(runtime, 'source-backlinks.mjs', backlinksCfg);
  fs.unlinkSync(backlinksCfg);
  const controlPlaneCfg = tempJson('scheduler-control-plane', { refresh: true });
  const controlPlane = runScript(runtime, 'control-plane-refresh.mjs', controlPlaneCfg);
  fs.unlinkSync(controlPlaneCfg);
  return { ...output, sourceBacklinks, controlPlane };
}

if (isDirectCli(import.meta.url)) {
  const arg = process.argv[2];
  if (!arg) usage();
  const evt = readJsonInput(arg === '-' ? null : arg);
  printResult(runSchedulerEvent(evt));
}

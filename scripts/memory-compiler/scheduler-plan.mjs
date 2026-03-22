#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { readJsonInput, printResult } from './lib/io.mjs';
import { readJsonl } from './lib/jsonl-store.mjs';
import { nowIso, hashId } from './lib/common.mjs';
import { resolveCompilerRuntime, isDirectCli } from './lib/plugin-paths.mjs';

function usage() {
  console.error('Usage: node plugins/memory-compiler/scripts/memory-compiler/scheduler-plan.mjs <event.json | ->');
  process.exit(2);
}
function readJson(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return fallback; }
}
function minutesSince(iso) {
  if (!iso) return Infinity;
  const diff = Date.now() - new Date(iso).getTime();
  return diff / 60000;
}
function eventShape(evt) {
  const bundle = evt?.bundle || {};
  return {
    source: evt?.source || null,
    changedSourceRefs: (evt?.changedSourceRefs || []).slice().sort(),
    date: evt?.date || null,
    week: evt?.week || null,
    bundleCounts: {
      facts: Array.isArray(bundle?.facts) ? bundle.facts.length : 0,
      threads: Array.isArray(bundle?.threads) ? bundle.threads.length : 0,
      continuity: Array.isArray(bundle?.continuity) ? bundle.continuity.length : 0,
    },
    bundlePath: evt?.bundlePath || null,
  };
}
function isoWeekLabel(d) {
  const dt = d ? new Date(d) : new Date();
  const d2 = new Date(dt.valueOf() + (3 - (dt.getDay() + 6) % 7) * 864e5);
  const w = Math.ceil((((d2 - new Date(d2.getFullYear(), 0, 1)) / 864e5) + 1) / 7);
  return `${d2.getFullYear()}-W${String(w).padStart(2, '0')}`;
}

export function planScheduler(evt = {}, runtime = resolveCompilerRuntime()) {
  const compilerDir = runtime.dataDir;
  const reviewQueuePath = path.join(compilerDir, 'review-queue.jsonl');
  const schedulerStatePath = path.join(compilerDir, 'scheduler-state.json');
  const schedulerHistoryPath = path.join(compilerDir, 'scheduler-history.jsonl');

  const eventType = String(evt?.eventType || 'manual');
  const reviews = readJsonl(reviewQueuePath);
  const history = readJsonl(schedulerHistoryPath);
  const openReviews = reviews.filter(x => x.status === 'open');
  const sourceDispatchBlockingOpen = openReviews.filter(x => x.sourceDispatchBlocking === true || x.blockedState === 'source-discipline').length;
  const hasBundle = !!evt?.bundle || !!evt?.bundlePath;
  const jobs = [];
  const skipped = [];
  const schedulerState = readJson(schedulerStatePath, { lastRuns: {} });
  const lastRunAt = schedulerState?.lastRuns?.[eventType] || null;
  const defaultMin = { heartbeat: 30, daily: 8 * 60, weekly: 6 * 24 * 60 };
  const defaultDedupe = { heartbeat: 10, daily: 60, weekly: 12 * 60, 'session-end': 30, 'subagent-complete': 15, manual: 0 };
  const minIntervalMinutes = Number(evt?.minIntervalMinutes ?? defaultMin[eventType] ?? 0);
  const dedupeMinutes = Number(evt?.dedupeMinutes ?? defaultDedupe[eventType] ?? 0);
  const eventFingerprint = String(evt?.eventFingerprint || hashId('schedfp', [eventType, JSON.stringify(eventShape(evt))]));
  const duplicateOf = history.slice().reverse().find(x => x.eventType === eventType && x.eventFingerprint === eventFingerprint && !x.throttled && !x.deduped && minutesSince(x.finishedAt) < dedupeMinutes);
  const deduped = !!duplicateOf;
  const throttled = minIntervalMinutes > 0 && minutesSince(lastRunAt) < minIntervalMinutes;

  if (deduped && evt?.force !== true) {
    skipped.push({ reason: 'duplicate-event', eventType, eventFingerprint, dedupeMinutes, duplicateOf: duplicateOf.id, duplicateFinishedAt: duplicateOf.finishedAt });
    return { ok: true, generatedAt: nowIso(), eventType, eventFingerprint, openReviews: openReviews.length, sourceDispatchBlockingOpen, deduped: true, dedupeMinutes, duplicateOf: duplicateOf.id, throttled: false, minIntervalMinutes, lastRunAt, jobs, skipped };
  }

  if (throttled && evt?.force !== true) {
    skipped.push({ reason: 'throttled', eventType, minIntervalMinutes, lastRunAt });
    return { ok: true, generatedAt: nowIso(), eventType, eventFingerprint, openReviews: openReviews.length, sourceDispatchBlockingOpen, deduped: false, throttled: true, dedupeMinutes, minIntervalMinutes, lastRunAt, jobs, skipped };
  }

  if (eventType === 'session-end' || eventType === 'subagent-complete' || eventType === 'manual') {
    if (hasBundle) jobs.push({ kind: 'trigger-execute', reason: eventType, priority: 'high' });
    else if (eventType === 'manual') skipped.push({ reason: 'no-bundle', eventType });
  }
  if (eventType === 'session-end') jobs.push({ kind: 'session-pack-finalize', reason: 'session-ended', priority: 'high' });
  if (eventType === 'subagent-complete') jobs.push({ kind: 'session-pack-refresh', reason: 'subagent-handoff-refresh', priority: 'medium' });
  if (eventType === 'subagent-complete') jobs.push({ kind: 'session-pack-handoff', reason: 'subagent-handoff-capsule', priority: 'medium' });
  if (eventType === 'heartbeat') {
    jobs.push({ kind: 'source-discipline-check', reason: 'heartbeat-health', priority: sourceDispatchBlockingOpen > 0 ? 'high' : 'medium' });
    if (sourceDispatchBlockingOpen > 0) jobs.push({ kind: 'review-snapshot', reason: 'source-dispatch-blocking-open', priority: 'high', count: sourceDispatchBlockingOpen, sourceDispatchBlockingOpen });
    else if (openReviews.length) jobs.push({ kind: 'review-snapshot', reason: 'open-reviews-present', priority: 'medium', count: openReviews.length });
    jobs.push({ kind: 'session-pack-expire', reason: 'heartbeat-pack-ttl-check', priority: 'low' });
    if (evt?.runAcceptance === true) jobs.push({ kind: 'acceptance-smoke', reason: 'heartbeat-explicit-acceptance', priority: 'low' });
  }
  if (eventType === 'daily') {
    jobs.push({ kind: 'compile-today', reason: 'daily-refresh', priority: 'high' });
    jobs.push({ kind: 'compile-narrative', reason: 'daily-refresh', priority: 'medium' });
    jobs.push({ kind: 'thread-aging', reason: 'daily-maintenance', priority: 'medium' });
    jobs.push({ kind: 'integrity-audit', reason: 'daily-maintenance', priority: 'medium' });
    jobs.push({ kind: 'source-discipline-check', reason: sourceDispatchBlockingOpen > 0 ? 'daily-source-dispatch-blocking' : 'daily-maintenance', priority: sourceDispatchBlockingOpen > 0 ? 'high' : 'medium' });
    jobs.push({ kind: 'session-pack-expire', reason: 'daily-pack-maintenance', priority: 'low' });
    if (sourceDispatchBlockingOpen > 0) jobs.push({ kind: 'review-snapshot', reason: 'daily-source-dispatch-blocking-open', priority: 'high', count: sourceDispatchBlockingOpen, sourceDispatchBlockingOpen });
    else if (openReviews.length) jobs.push({ kind: 'review-snapshot', reason: 'daily-open-review-check', priority: 'medium', count: openReviews.length });
  }
  if (eventType === 'weekly') {
    jobs.push({ kind: 'compile-week', reason: 'weekly-refresh', priority: 'high' });
    jobs.push({ kind: 'compile-narrative', reason: 'weekly-refresh', priority: 'medium' });
    jobs.push({ kind: 'digest-gc', reason: 'weekly-maintenance', priority: 'medium' });
    jobs.push({ kind: 'integrity-audit', reason: 'weekly-maintenance', priority: 'medium' });
    jobs.push({ kind: 'source-discipline-check', reason: sourceDispatchBlockingOpen > 0 ? 'weekly-source-dispatch-blocking' : 'weekly-maintenance', priority: sourceDispatchBlockingOpen > 0 ? 'high' : 'medium' });
    if (sourceDispatchBlockingOpen > 0) jobs.push({ kind: 'review-snapshot', reason: 'weekly-source-dispatch-blocking-open', priority: 'high', count: sourceDispatchBlockingOpen, sourceDispatchBlockingOpen });
  }
  if (evt?.runAcceptance === true && !jobs.some(j => j.kind === 'acceptance-smoke')) jobs.push({ kind: 'acceptance-smoke', reason: 'explicit-request', priority: 'medium' });

  return { ok: true, generatedAt: nowIso(), eventType, eventFingerprint, openReviews: openReviews.length, sourceDispatchBlockingOpen, deduped: false, dedupeMinutes, duplicateOf: null, throttled: false, minIntervalMinutes, lastRunAt, jobs, skipped, weekLabel: evt?.week || isoWeekLabel(evt?.date) || null };
}

if (isDirectCli(import.meta.url)) {
  const arg = process.argv[2];
  if (!arg) usage();
  const evt = readJsonInput(arg === '-' ? null : arg);
  printResult(planScheduler(evt));
}

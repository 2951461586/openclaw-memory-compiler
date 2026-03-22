#!/usr/bin/env node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { readJsonInput, printResult } from './lib/io.mjs';
import { readJsonl, writeJsonl } from './lib/jsonl-store.mjs';
import { nowIso, uniq, isoWeekLabel, hashId } from './lib/common.mjs';
import { resolveCompilerRuntime, isDirectCli } from './lib/plugin-paths.mjs';
import { runScript } from './lib/run-script.mjs';

function usage() {
  console.error('Usage: node plugins/memory-compiler/scripts/memory-compiler/review-apply.mjs <decisions.json | ->');
  process.exit(2);
}
function tempJson(name, obj) {
  const p = path.join(os.tmpdir(), `memory-compiler-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
  return p;
}
function filterQueue(records, sel = {}) {
  let items = records.filter(x => x.status === (sel.status || 'open'));
  if (sel.reviewType) items = items.filter(x => x.reviewType === sel.reviewType);
  if (sel.scope) items = items.filter(x => x.scope === sel.scope);
  if (sel.factId) items = items.filter(x => x.factId === sel.factId);
  if (sel.priority) items = items.filter(x => x.priority === sel.priority);
  if (sel.query) {
    const q = String(sel.query).toLowerCase();
    items = items.filter(x => [x.title, x.reason, x.factId, x.reviewType, x.scope].filter(Boolean).some(v => String(v).toLowerCase().includes(q)));
  }
  const limit = Number(sel.limit || 0);
  if (limit > 0) items = items.slice(0, limit);
  return items;
}

export function applyReviewDecisions(payload = {}, runtime = resolveCompilerRuntime()) {
  const queuePath = path.join(runtime.dataDir, 'review-queue.jsonl');
  const reportsDir = runtime.reportsDir;
  fs.mkdirSync(reportsDir, { recursive: true });
  const reportPath = path.join(reportsDir, 'review-apply.latest.json');
  const queue = readJsonl(queuePath);
  const byId = new Map(queue.map(x => [String(x.id), x]));
  const byFactId = new Map(queue.map(x => [String(x.factId || ''), x]));
  const now = nowIso();

  let decisions = Array.isArray(payload?.decisions) ? payload.decisions : [];
  let matched = [];
  if (!decisions.length && payload?.select) {
    matched = filterQueue(queue, payload.select);
    decisions = matched.map(rec => ({
      reviewId: rec.id,
      decision: payload.defaultDecision || rec.suggestedDecision || 'promote',
      confidence: payload.confidence,
      sourceRefs: payload.sourceRefs || [],
      reason: payload.reason || `batch-${payload.defaultDecision || rec.suggestedDecision || 'promote'}`,
    }));
  }

  if (payload?.dryRun) {
    return {
      ok: true,
      dryRun: true,
      matchedCount: matched.length,
      matched: matched.map(x => ({ id: x.id, reviewType: x.reviewType, factId: x.factId, title: x.title, priority: x.priority })),
      decisions,
    };
  }

  const actions = [];
  const pendingResolutions = [];
  const resolved = [];
  const blocked = [];
  const followUps = [];
  const autoClosed = [];
  const changedQueueIds = [];
  let missing = 0;
  const changedSourceRefs = new Set();
  const allowUntrustedPromotion = payload?.allowUntrustedPromotion === true;

  function autoCloseSatisfiedFollowUps({ factId, decisions = [], reason }) {
    if (!factId) return [];
    const closeKinds = new Set();
    if (decisions.includes('promote')) closeKinds.add('promotion-review');
    if (decisions.includes('refresh')) closeKinds.add('arbitration-review');
    if (closeKinds.size === 0) return [];
    const touched = [];
    for (const rec of queue) {
      if (rec.status !== 'open' || rec.factId !== factId) continue;
      if (!closeKinds.has(rec.reviewType)) continue;
      rec.status = 'resolved';
      rec.resolvedAt = now;
      rec.updatedAt = now;
      rec.resolution = rec.reviewType === 'promotion-review' ? 'promote' : 'refresh';
      rec.resolutionNote = reason || 'auto-closed-after-downstream-apply';
      touched.push({ reviewId: rec.id, reviewType: rec.reviewType, factId: rec.factId, resolution: rec.resolution, resolutionNote: rec.resolutionNote });
      changedQueueIds.push(rec.id);
    }
    return touched;
  }

  function upsertFollowUp(raw) {
    const title = raw.title || null;
    const key = `${raw.reviewType || 'review'}::${raw.factId || ''}::${title || ''}`;
    const existing = queue.find(r => `${r.reviewType || 'review'}::${r.factId || ''}::${r.title || ''}` === key && r.status !== 'resolved');
    if (existing) {
      existing.updatedAt = now;
      existing.reason = raw.reason || existing.reason;
      existing.priority = raw.priority || existing.priority;
      existing.targetState = raw.targetState || existing.targetState;
      existing.suggestedDecision = raw.suggestedDecision || existing.suggestedDecision;
      existing.operatorFlow = raw.operatorFlow || existing.operatorFlow;
      if (typeof raw.operatorVisible === 'boolean') existing.operatorVisible = raw.operatorVisible;
      existing.origin = raw.origin || existing.origin || 'operator';
      existing.namespace = raw.namespace || existing.namespace || (existing.origin === 'acceptance' ? 'acceptance' : 'operator');
      existing.evidenceMode = raw.evidenceMode || existing.evidenceMode || (existing.origin === 'acceptance' ? 'sample' : 'source-first');
      existing.sourceRefs = uniq([...(existing.sourceRefs || []), ...(raw.sourceRefs || [])]);
      existing.followUpOf = uniq([...(Array.isArray(existing.followUpOf) ? existing.followUpOf : []), ...(raw.followUpOf || [])]);
      existing.followUpReviewIds = uniq([...(Array.isArray(existing.followUpReviewIds) ? existing.followUpReviewIds : []), ...(raw.followUpReviewIds || [])]);
      return { reviewId: existing.id, created: false, reviewType: existing.reviewType, title: existing.title, factId: existing.factId, targetState: existing.targetState, suggestedDecision: existing.suggestedDecision };
    }
    const rec = {
      id: raw.id || hashId('review', [raw.reviewType || 'review', raw.factId || '', title || '', now, Math.random().toString(36).slice(2)]),
      status: 'open',
      reviewType: raw.reviewType || 'review',
      factId: raw.factId || null,
      title,
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
      sourceRefs: uniq(raw.sourceRefs || []),
      followUpOf: uniq(raw.followUpOf || []),
      followUpReviewIds: uniq(raw.followUpReviewIds || []),
      createdAt: now,
      updatedAt: now,
    };
    queue.push(rec);
    return { reviewId: rec.id, created: true, reviewType: rec.reviewType, title: rec.title, factId: rec.factId, targetState: rec.targetState, suggestedDecision: rec.suggestedDecision };
  }

  for (const item of decisions) {
    const rec = item.reviewId ? byId.get(String(item.reviewId)) : byFactId.get(String(item.factId || ''));
    if (!rec || rec.status === 'resolved') { missing++; continue; }
    const decision = String(item.decision || 'promote');
    const factId = item.factId || rec.factId;
    const sourceRefs = uniq([...(rec.sourceRefs || []), ...(item.sourceRefs || [])]);
    sourceRefs.forEach(r => changedSourceRefs.add(r));

    if (factId) {
      if (decision === 'promote') actions.push({ kind: 'promote', factId, confidence: item.confidence ?? 0.96, sourceRefs, allowUntrustedPromotion, sourceDisciplineReason: item.sourceDisciplineReason || 'review-promotion-blocked-untrusted-sources', reviewType: rec.reviewType || null, operatorFlow: rec.operatorFlow || null, evidenceMode: rec.evidenceMode || null, reviewSourceBlocking: rec.reviewType === 'promotion-review' });
      else if (decision === 'refresh') actions.push({ kind: 'refresh', factId, confidence: item.confidence ?? 0.9, sourceRefs, reviewType: rec.reviewType || null, operatorFlow: rec.operatorFlow || null, evidenceMode: rec.evidenceMode || null });
      else if (decision === 'dispute') actions.push({ kind: 'dispute', factId, reason: item.reason || rec.reason || 'manual-review-dispute', sourceRefs, reviewType: rec.reviewType || null, operatorFlow: rec.operatorFlow || null, evidenceMode: rec.evidenceMode || null });
      else if (decision === 'reject') actions.push({ kind: 'reject', factId, expiresAt: now, reason: item.reason || rec.reason || 'manual-review-reject', sourceRefs, reviewType: rec.reviewType || null, operatorFlow: rec.operatorFlow || null, evidenceMode: rec.evidenceMode || null });
      else if (decision === 'stale') actions.push({ kind: 'stale', factId, expiresAt: now, sourceRefs, reviewType: rec.reviewType || null, operatorFlow: rec.operatorFlow || null, evidenceMode: rec.evidenceMode || null });
    }

    pendingResolutions.push({ rec, factId, decision, note: item.reason || null, sourceRefs });
  }

  let factLifecycle = { ok: true, changed: 0, results: [] };
  if (actions.length) {
    const p = tempJson('review-actions', { actions });
    factLifecycle = runScript(runtime, 'fact-lifecycle.mjs', p);
    fs.unlinkSync(p);
  }
  const lifecycleByFactId = new Map((factLifecycle.results || []).filter(x => x?.factId).map(x => [String(x.factId), x]));

  for (const item of pendingResolutions) {
    const lifecycle = item.factId ? lifecycleByFactId.get(String(item.factId)) : null;
    const shouldBlock = item.decision === 'promote' && lifecycle && lifecycle.status !== 'confirmed';
    if (shouldBlock) {
      item.rec.updatedAt = now;
      item.rec.resolution = 'blocked';
      item.rec.resolutionNote = lifecycle.sourceDisciplineReason || item.note || 'promotion blocked by source discipline';
      item.rec.lastAttemptedResolutionAt = now;
      item.rec.lastAttemptedDecision = item.decision;
      item.rec.blockedAt = now;
      item.rec.blockedReason = item.rec.resolutionNote;
      item.rec.blockedState = 'source-discipline';
      item.rec.blockedFactStatus = lifecycle.status || null;
      item.rec.blockedSourceDisciplineState = lifecycle.sourceDisciplineState || null;
      item.rec.sourceDispatchBlocking = true;
      item.rec.sourceDispatchBlockingReason = lifecycle.sourceDisciplineReason || item.rec.resolutionNote;
      item.rec.sourceDispatchRequired = true;
      blocked.push({ reviewId: item.rec.id, factId: item.factId, decision: item.decision, reason: item.rec.resolutionNote, lifecycle, sourceDispatchBlocking: true });
      continue;
    }

    item.rec.status = 'resolved';
    item.rec.resolvedAt = now;
    item.rec.updatedAt = now;
    item.rec.resolution = item.decision;
    item.rec.resolutionNote = item.note;
    if (item.rec.blockedAt) delete item.rec.blockedAt;
    if (item.rec.blockedReason) delete item.rec.blockedReason;
    if (item.rec.blockedState) delete item.rec.blockedState;
    if (item.rec.blockedFactStatus) delete item.rec.blockedFactStatus;
    if (item.rec.blockedSourceDisciplineState) delete item.rec.blockedSourceDisciplineState;
    if (item.rec.sourceDispatchBlocking) delete item.rec.sourceDispatchBlocking;
    if (item.rec.sourceDispatchBlockingReason) delete item.rec.sourceDispatchBlockingReason;
    if (item.rec.sourceDispatchRequired) delete item.rec.sourceDispatchRequired;

    if (item.decision === 'dispute' && item.factId) {
      const follow = upsertFollowUp({
        reviewType: 'arbitration-review',
        factId: item.factId,
        title: `arbitration follow-up: ${item.rec.title || item.factId}`,
        reason: item.note || item.rec.reason || 'followup-dispute-needs-arbitration',
        scope: item.rec.scope || 'project',
        priority: item.rec.priority || 'medium',
        targetState: 'arbitrated',
        suggestedDecision: 'refresh',
        operatorFlow: item.rec.operatorFlow || null,
        operatorVisible: item.rec.operatorVisible !== false,
        origin: item.rec.origin || 'operator',
        namespace: item.rec.namespace || (item.rec.origin === 'acceptance' ? 'acceptance' : 'operator'),
        evidenceMode: item.rec.evidenceMode || (item.rec.origin === 'acceptance' ? 'sample' : 'source-first'),
        sourceRefs: uniq([...(item.rec.sourceRefs || []), ...(lifecycle?.sourceRefs || []), ...(item.sourceRefs || [])]),
        followUpOf: [item.rec.id],
      });
      item.rec.lastFollowUpAt = now;
      item.rec.followUpReviewIds = uniq([...(item.rec.followUpReviewIds || []), follow.reviewId]);
      followUps.push({ fromReviewId: item.rec.id, causeDecision: item.decision, ...follow });
    }

    if (item.decision === 'refresh' && item.factId && Number(lifecycle?.trustedRefs || 0) > 0 && lifecycle?.status !== 'confirmed') {
      const follow = upsertFollowUp({
        reviewType: 'promotion-review',
        factId: item.factId,
        title: `follow-up promotion: ${item.rec.title || item.factId}`,
        reason: 'followup-refresh-ready-for-promotion',
        scope: item.rec.scope || 'project',
        priority: item.rec.priority || 'medium',
        targetState: 'confirmed',
        suggestedDecision: 'promote',
        operatorFlow: item.rec.operatorFlow || 'inferred-to-confirmed',
        operatorVisible: item.rec.operatorVisible !== false,
        origin: item.rec.origin || 'operator',
        namespace: item.rec.namespace || (item.rec.origin === 'acceptance' ? 'acceptance' : 'operator'),
        evidenceMode: item.rec.evidenceMode || (item.rec.origin === 'acceptance' ? 'sample' : 'source-first'),
        sourceRefs: uniq([...(item.rec.sourceRefs || []), ...(lifecycle?.sourceRefs || []), ...(item.sourceRefs || []), ...(payload.sourceRefs || [])]),
        followUpOf: [item.rec.id],
      });
      item.rec.lastFollowUpAt = now;
      item.rec.followUpReviewIds = uniq([...(item.rec.followUpReviewIds || []), follow.reviewId]);
      followUps.push({ fromReviewId: item.rec.id, causeDecision: item.decision, ...follow });
    }

    const downstreamAutoClosed = autoCloseSatisfiedFollowUps({
      factId: item.factId,
      decisions: [item.decision],
      reason: item.decision === 'promote' ? 'auto-closed-follow-up-promotion-satisfied' : item.decision === 'refresh' ? 'auto-closed-follow-up-refresh-satisfied' : null,
    });
    if (downstreamAutoClosed.length) autoClosed.push(...downstreamAutoClosed);

    changedQueueIds.push(item.rec.id);
    resolved.push({ reviewId: item.rec.id, factId: item.factId, decision: item.decision, lifecycle, followUpReviewIds: item.rec.followUpReviewIds || [], autoClosedReviewIds: downstreamAutoClosed.map(x => x.reviewId) });
  }

  writeJsonl(queuePath, queue.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))));

  let rebuildIndexes = null;
  let today = null;
  let week = null;
  let narrative = null;
  let digestGc = null;
  if (actions.length) {
    rebuildIndexes = runScript(runtime, 'rebuild-indexes.mjs');
    const refs = [...changedSourceRefs];
    const todayCfg = tempJson('review-today', { type: 'today', date: payload.date || new Date().toISOString().slice(0, 10), generationStrategy: 'review-apply-v2', forceChangedSourceCompile: true, changedSourceRefs: refs });
    const weekCfg = tempJson('review-week', { type: 'week', week: payload.week || isoWeekLabel(payload.date) || isoWeekLabel() || '1970-W01', generationStrategy: 'review-apply-v2', forceChangedSourceCompile: true, changedSourceRefs: refs });
    const narrativeCfg = tempJson('review-narrative', { type: 'narrative', generationStrategy: 'review-apply-v2', forceChangedSourceCompile: true, changedSourceRefs: refs });
    today = runScript(runtime, 'digest-compiler.mjs', todayCfg);
    week = runScript(runtime, 'digest-compiler.mjs', weekCfg);
    narrative = runScript(runtime, 'digest-compiler.mjs', narrativeCfg);
    fs.unlinkSync(todayCfg);
    fs.unlinkSync(weekCfg);
    fs.unlinkSync(narrativeCfg);
    digestGc = runScript(runtime, 'digest-gc.mjs');
  }

  let sourceBacklinks = null;
  let controlPlane = null;
  if (actions.length) {
    const backlinksCfg = tempJson('review-backlinks', { includeKinds: ['lcm-summary', 'lcm-message', 'file', 'memory-item', 'session'] });
    sourceBacklinks = runScript(runtime, 'source-backlinks.mjs', backlinksCfg);
    fs.unlinkSync(backlinksCfg);
    const controlPlaneCfg = tempJson('review-control-plane', { refresh: true });
    controlPlane = runScript(runtime, 'control-plane-refresh.mjs', controlPlaneCfg);
    fs.unlinkSync(controlPlaneCfg);
  }

  const actionSummary = actions.reduce((acc, action) => {
    acc[action.kind] = (acc[action.kind] || 0) + 1;
    return acc;
  }, {});

  const result = {
    ok: true,
    resolvedCount: resolved.length,
    blockedCount: blocked.length,
    followUpCount: followUps.length,
    autoClosedCount: autoClosed.length,
    missing,
    matchedCount: matched.length,
    changedQueueIds,
    actionSummary,
    factLifecycle,
    rebuildIndexes,
    today,
    week,
    narrative,
    digestGc,
    sourceBacklinks,
    controlPlane,
    blocked,
    followUps,
    autoClosed,
    allowUntrustedPromotion,
  };

  fs.writeFileSync(reportPath, JSON.stringify({ generatedAt: now, matchedCount: matched.length, resolved, blocked, followUps, autoClosed, result }, null, 2) + '\n');
  return result;
}

if (isDirectCli(import.meta.url)) {
  const arg = process.argv[2];
  if (!arg) usage();
  const payload = readJsonInput(arg === '-' ? null : arg);
  printResult(applyReviewDecisions(payload));
}

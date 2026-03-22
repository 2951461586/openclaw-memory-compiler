#!/usr/bin/env node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { readJsonInput, printResult } from './lib/io.mjs';
import { isoWeekLabel } from './lib/common.mjs';
import { resolveCompilerRuntime, isDirectCli } from './lib/plugin-paths.mjs';
import { runScript } from './lib/run-script.mjs';
import { compileFacts } from './fact-compiler.mjs';
import { compileThreads } from './thread-compiler.mjs';
import { compileContinuity } from './continuity-compiler.mjs';
import { compileDigest } from './digest-compiler.mjs';
import { ageThreads } from './thread-aging.mjs';
import { detectFactConflicts } from './fact-conflicts.mjs';
import { rebuildIndexes } from './rebuild-indexes.mjs';
import { clusterThreads } from './thread-cluster.mjs';
import { checkSourceDiscipline } from './source-discipline-check.mjs';
import { refreshControlPlane } from './lib/control-plane-core.mjs';

function usage(){ console.error('Usage: node plugins/memory-compiler/scripts/memory-compiler/pipeline-run.mjs <bundle.json | ->'); process.exit(2); }
function tempJson(name, obj) {
  const p = path.join(os.tmpdir(), `memory-compiler-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
  return p;
}
function num(x){ return Number(x || 0); }
function collectRefs(payload){
  return [...new Set([
    ...(payload?.facts || []).flatMap(x => x.sourceRefs || []),
    ...(payload?.threads || []).flatMap(x => x.sourceRefs || []),
    ...(payload?.continuity || []).flatMap(x => x.sourceRefs || [])
  ])];
}
function prefixSummary(refs){
  const out = { sum: 0, file: 0, mem: 0, artifact: 0, other: 0 };
  for (const ref of refs) {
    if (String(ref).startsWith('sum:')) out.sum++;
    else if (String(ref).startsWith('file:')) out.file++;
    else if (String(ref).startsWith('mem:')) out.mem++;
    else if (String(ref).startsWith('artifact:')) out.artifact++;
    else out.other++;
  }
  return out;
}
function makeDigestCfg(type, payload, changedSourceRefs){
  return {
    type,
    date: payload.date,
    week: payload.week || isoWeekLabel(payload.date) || isoWeekLabel() || '1970-W01',
    generationStrategy: `pipeline-${type}-plugin-v1`,
    forceChangedSourceCompile: true,
    changedSourceRefs,
  };
}

export function runPipeline(payload = {}, runtime = resolveCompilerRuntime()) {
  const changedSourceRefs = collectRefs(payload);
  const results={};

  results.facts = compileFacts(payload, runtime);
  results.threads = compileThreads(payload, runtime);
  results.continuity = compileContinuity(payload, runtime);
  results.threadAging = ageThreads({}, runtime);

  if (payload.autoDisputeConflicts) {
    results.factConflicts = detectFactConflicts({ applyDispute: true, reason: payload.conflictReason || 'pipeline-auto-dispute', sourceRefs: payload.conflictSourceRefs || [] }, runtime);
  } else {
    results.factConflicts = detectFactConflicts({}, runtime);
  }

  if (payload.autoArbitrateDisputes) {
    const arbPath = tempJson('pipeline-arbitrate', { apply: true, preferredSourcePrefixes: payload.preferredSourcePrefixes || ['file:','sum:','mem:','artifact:'] });
    results.factArbitration = runScript(runtime, 'fact-arbitrate.mjs', arbPath);
    fs.unlinkSync(arbPath);
    results.factConflictsAfterArbitration = detectFactConflicts({}, runtime);
  }

  results.threadClusters = clusterThreads(runtime);
  results.rebuildIndexes = rebuildIndexes(runtime);

  const factChanged = num(results.facts.created) + num(results.facts.updated) + num(results.factConflicts.applied) + num(results.factArbitration?.changed) > 0;
  const threadChanged = num(results.threads.created) + num(results.threads.updated) + num(results.threadAging.updated) > 0;
  const continuityChanged = num(results.continuity.created) + num(results.continuity.updated) > 0;
  const anyChanged = factChanged || threadChanged || continuityChanged;
  results.compilePlan = {
    factChanged, threadChanged, continuityChanged, anyChanged,
    changedSourceRefsCount: changedSourceRefs.length,
    changedSourcePrefixes: prefixSummary(changedSourceRefs),
    today: !!(payload.compileToday !== false && (payload.forceDigests || anyChanged)),
    week: !!(payload.compileWeek !== false && (payload.forceDigests || factChanged || threadChanged)),
    narrative: !!(payload.compileNarrative !== false && (payload.forceDigests || anyChanged))
  };

  if(results.compilePlan.today){ results.today = compileDigest(makeDigestCfg('today', payload, changedSourceRefs), runtime); }
  if(results.compilePlan.week){ results.week = compileDigest(makeDigestCfg('week', payload, changedSourceRefs), runtime); }
  if(results.compilePlan.narrative){ results.narrative = compileDigest(makeDigestCfg('narrative', payload, changedSourceRefs), runtime); }

  if (payload.compileSessionPack !== false && (payload.forceSessionPack || anyChanged)) {
    const p = tempJson('pipeline-session-pack', { scene: payload.sessionPackScene || 'task', date: payload.date, week: payload.week || isoWeekLabel(payload.date) || isoWeekLabel() || '1970-W01', sessionKey: payload.sessionKey || null, preferredSourcePrefixes: payload.preferredSourcePrefixes || ['sum:','file:','mem:'] });
    results.sessionPack = runScript(runtime, 'session-pack.mjs', p);
    fs.unlinkSync(p);
  }

  results.digestGc = runScript(runtime, 'digest-gc.mjs');
  results.audit = runScript(runtime, 'source-audit.mjs');
  results.integrity = runScript(runtime, 'integrity-audit.mjs');
  results.sourceDiscipline = checkSourceDiscipline({}, runtime);

  const backlinkCfg = tempJson('pipeline-backlinks', { includeKinds: ['lcm-summary', 'lcm-message', 'file', 'memory-item', 'session'] });
  results.sourceBacklinks = runScript(runtime, 'source-backlinks.mjs', backlinkCfg);
  fs.unlinkSync(backlinkCfg);

  results.controlPlane = refreshControlPlane({ root: runtime.workspaceDir, payload: { refresh: true }, paths: runtime });

  if ((payload.autoEnforceSourceDiscipline ?? true) && results.sourceDiscipline.ok === false) {
    results.sourceDisciplineEnforce = runScript(runtime, 'source-discipline-enforce.mjs');
    if ((results.sourceDisciplineEnforce.factsDowngraded || 0) + (results.sourceDisciplineEnforce.threadsBlocked || 0) + (results.sourceDisciplineEnforce.continuityExpired || 0) > 0) {
      results.rebuildIndexesAfterDiscipline = rebuildIndexes(runtime);
    }
    results.sourceDisciplineAfterEnforce = checkSourceDiscipline({}, runtime);
  }

  return { ok:true, results };
}

if (isDirectCli(import.meta.url)) {
  const arg=process.argv[2]; if(!arg) usage();
  const payload=readJsonInput(arg==='-'?null:arg);
  printResult(runPipeline(payload));
}

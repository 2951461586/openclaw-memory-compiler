#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { readJsonInput, printResult } from './lib/io.mjs';
import { nowIso } from './lib/common.mjs';
import { readJsonl } from './lib/jsonl-store.mjs';
import { resolveCompilerRuntime, isDirectCli } from './lib/plugin-paths.mjs';

function usage() {
  console.error('Usage: node plugins/memory-compiler/scripts/memory-compiler/source-kind-diagnostics.mjs <config.json | ->');
  process.exit(2);
}
function kindFromRef(ref) {
  if (String(ref).startsWith('sum:')) return 'lcm-summary';
  if (String(ref).startsWith('msg:')) return 'lcm-message';
  if (String(ref).startsWith('session:')) return 'session';
  if (String(ref).startsWith('file:')) return 'file';
  if (String(ref).startsWith('mem:')) return 'memory-item';
  if (String(ref).startsWith('artifact:')) return 'artifact';
  return 'other';
}
function summarizeRecordMix(records = []) {
  const mix = {};
  for (const rec of records) {
    for (const ref of rec?.sourceRefs || []) {
      const kind = kindFromRef(ref);
      mix[kind] = (mix[kind] || 0) + 1;
    }
  }
  return mix;
}
function sceneContract(scene) {
  const base = {
    contractVersion: 'source-kind-contract.v2',
    trustedKinds: ['lcm-summary', 'file', 'memory-item'],
    kindRules: {
      'lcm-summary': { authorityWeight: 0.93, exactClaimUse: 'allowed-with-evidence-path' },
      'file': { authorityWeight: 0.96, exactClaimUse: 'preferred-with-evidence-path' },
      'memory-item': { authorityWeight: 0.84, exactClaimUse: 'allowed-for-stable-memory-with-evidence-path' },
      'session': { authorityWeight: 0.42, exactClaimUse: 'support-only' },
      'lcm-message': { authorityWeight: 0.72, exactClaimUse: 'allowed-when-expanded-to-source' },
      'artifact': { authorityWeight: 0.18, exactClaimUse: 'forbidden' },
      'other': { authorityWeight: 0.12, exactClaimUse: 'forbidden' },
    },
  };
  if (scene === 'precise') return { ...base, authority: 'source-first', digestAuthority: 'forbidden', continuityAuthority: 'forbidden', minimumTrustedRecords: 1, minAuthorityScore: 0.88, sceneRule: 'precise-source-first', claimRule: 'exact-claim-requires-evidence-path' };
  if (scene === 'task' || scene === 'session') return { ...base, authority: 'trusted-derived-with-source-backing', digestAuthority: 'support-only', continuityAuthority: 'allowed-with-trusted-sources', minimumTrustedRecords: 1, minAuthorityScore: 0.58, sceneRule: scene === 'task' ? 'execution-support' : 'resume-support', claimRule: 'precise-claim-still-needs-evidence-path' };
  return { ...base, authority: 'continuity-support', digestAuthority: 'support-only', continuityAuthority: 'allowed-with-trusted-sources', minimumTrustedRecords: 1, minAuthorityScore: 0.46, sceneRule: scene === 'heartbeat' ? 'thin-signal' : 'light-chat-support', claimRule: 'do-not-overstate-derived-context' };
}

export function runSourceKindDiagnostics(cfg = {}, runtime = resolveCompilerRuntime(cfg?.paths || {})) {
  const reportsDir = runtime.reportsDir;
  fs.mkdirSync(reportsDir, { recursive: true });
  const facts = readJsonl(path.join(runtime.dataDir, 'facts.jsonl'));
  const threads = readJsonl(path.join(runtime.dataDir, 'threads.jsonl'));
  const continuity = readJsonl(path.join(runtime.dataDir, 'continuity.jsonl'));
  const scenes = Array.isArray(cfg?.scenes) && cfg.scenes.length ? cfg.scenes : ['chat', 'task', 'precise', 'session', 'heartbeat'];
  const reviewQueue = readJsonl(path.join(runtime.dataDir, 'review-queue.jsonl'));
  const diagnostics = scenes.map(scene => {
    const contract = sceneContract(scene);
    const factSet = scene === 'precise' ? facts.filter(x => x.status === 'confirmed') : facts;
    const threadSet = scene === 'precise' ? threads.filter(x => x.status === 'active') : threads;
    const continuitySet = scene === 'precise' ? [] : continuity;
    const recordMix = { facts: summarizeRecordMix(factSet), threads: summarizeRecordMix(threadSet), continuity: summarizeRecordMix(continuitySet) };
    const trustedRecordCount = factSet.filter(x => (x.sourceRefs || []).some(ref => ['lcm-summary', 'file', 'memory-item'].includes(kindFromRef(ref)))).length + threadSet.filter(x => (x.sourceRefs || []).some(ref => ['lcm-summary', 'file', 'memory-item'].includes(kindFromRef(ref)))).length;
    const sourceDispatchBlockingOpen = reviewQueue.filter(item => item.status === 'open' && (item.sourceDispatchBlocking === true || item.blockedState === 'source-discipline')).length;
    return {
      scene,
      contract,
      trustedRecordCount,
      sourceMix: recordMix,
      decisionPoints: {
        selectorOrdering: 'runtime-selector-core.mjs',
        reviewTrigger: 'trigger-plan.mjs/review-apply.mjs',
        sourceDispatchBlockingOpen,
        sourceDispatchBlockingRule: 'promotion-review with untrusted sources blocks dispatch until trusted evidence or explicit override',
      },
      contractSatisfied: trustedRecordCount >= contract.minimumTrustedRecords,
      evidencePaths: ['memory/compiler/facts.jsonl', 'memory/compiler/threads.jsonl', 'memory/compiler/continuity.jsonl', 'memory/compiler/review-queue.jsonl'],
    };
  });

  const report = { ok: diagnostics.every(x => x.contractSatisfied), generatedAt: nowIso(), diagnostics };
  const out = path.join(reportsDir, 'source-kind-diagnostics.latest.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  return { ...report, out };
}

if (isDirectCli(import.meta.url)) {
  const arg = process.argv[2];
  if (!arg) usage();
  const cfg = readJsonInput(arg === '-' ? null : arg);
  printResult(runSourceKindDiagnostics(cfg));
}

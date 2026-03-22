#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { readJsonInput, printResult } from './lib/io.mjs';
import { nowIso } from './lib/common.mjs';
import { resolveCompilerRuntime } from './lib/plugin-paths.mjs';
import { runScript } from './lib/run-script.mjs';

const runtime = resolveCompilerRuntime();
const reportsDir = runtime.reportsDir;
fs.mkdirSync(reportsDir, { recursive: true });

function usage() {
  console.error('Usage: node plugins/memory-compiler/scripts/memory-compiler/runtime-probe.mjs <config.json | ->');
  process.exit(2);
}
function run(script, inputObj = null) {
  const inputPath = inputObj ? writeTempJson(path.basename(script, '.mjs'), inputObj) : null;
  try {
    return runScript(runtime, script, inputPath);
  } finally {
    if (inputPath && fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
  }
}
function writeTempJson(name, obj) {
  const p = path.join('/tmp', `memory-compiler-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
  return p;
}
function pickProbeSummary(name, probe) {
  return {
    name,
    ok: probe?.ok === true,
    scene: probe?.scene || null,
    prependChars: probe?.prependChars ?? null,
    hasSourceActionPlan: Array.isArray(probe?.sourceActionPlan?.steps) && probe.sourceActionPlan.steps.length >= 1,
    hasSourceDispatch: !!probe?.sourceDispatch?.primary?.tool,
    sourceDispatchTool: probe?.sourceDispatch?.primary?.tool || null,
    blockingSourceDispatch: probe?.sourceDispatch?.blocking === true,
    blockingReason: probe?.sourceDispatch?.blockingReason || null,
    sourceKindAuthority: probe?.sourceKindContract?.authority || null,
    sourceKindContractVersion: probe?.sourceKindContract?.contractVersion || null,
    runtimeSourceMix: probe?.runtimeSourceMix || probe?.selected?.runtimeSourceMix || null,
    sourceMixPolicyEffect: {
      authorityScore: probe?.runtimeSourceMix?.authorityScore ?? probe?.selected?.runtimeSourceMix?.authorityScore ?? null,
      trustedRatio: probe?.runtimeSourceMix?.trustedRatio ?? probe?.selected?.runtimeSourceMix?.trustedRatio ?? null,
      coverageQuality: probe?.runtimeSourceMix?.coverageQuality ?? probe?.selected?.runtimeSourceMix?.coverageQuality ?? null,
      budgetReason: probe?.selectedBudget?.budgetReason || null,
      budgetProfileName: probe?.selectedBudget?.budgetProfileName || null,
      escalation: probe?.selected?.escalation || null,
    },
    selectedCounts: {
      facts: probe?.selected?.facts?.length ?? 0,
      threads: probe?.selected?.threads?.length ?? 0,
      continuity: probe?.selected?.continuity?.length ?? 0,
      digests: probe?.selected?.digests?.length ?? 0,
    },
    reviewTriage: {
      total: probe?.reviewTriage?.total ?? 0,
      topCount: probe?.reviewTriage?.topItems?.length ?? 0,
    },
    selectorDiagnostics: probe?.selected?.selectorDiagnostics || null,
    sceneDiagnostics: probe?.sceneDiagnostics || null,
    recallPlan: probe?.selected?.recallPlan || null,
    sourceActionPlan: probe?.sourceActionPlan || null,
    sourceDispatch: probe?.sourceDispatch || null,
    selectedBudget: probe?.selectedBudget || null,
    evidencePaths: [
      'memory/compiler/reports/runtime-probe.latest.json',
      'memory/compiler/reports/control-plane-verify.latest.json',
      'memory/compiler/reports/acceptance-smoke.latest.json',
    ],
  };
}

const arg = process.argv[2];
if (!arg) usage();
const cfg = readJsonInput(arg === '-' ? null : arg);
const generatedAt = nowIso();
const sessionKey = String(cfg?.sessionKey || 'runtime-probe');
const preferredSourcePrefixes = cfg?.preferredSourcePrefixes || ['sum:', 'file:', 'mem:'];
const precisePrompt = cfg?.precisePrompt || '精确回答：LCM 适配输入 这条主线到底落在哪个 thread？';
const taskPrompt = cfg?.taskPrompt || '继续接着当前主线推进，并给出 source-first 路由。';
const taskSceneHint = cfg?.taskSceneHint || 'task';
const prompts = {
  precise: {
    prompt: precisePrompt,
    sceneHint: 'precise',
    maxPromptChars: Number(cfg?.preciseMaxPromptChars || 1200),
    maxPromptTokens: Number(cfg?.preciseMaxPromptTokens || 320),
  },
  task: {
    prompt: taskPrompt,
    sceneHint: taskSceneHint,
    maxPromptChars: Number(cfg?.taskMaxPromptChars || 1200),
    maxPromptTokens: Number(cfg?.taskMaxPromptTokens || 280),
  },
};

const precise = run('runtime-bridge.mjs', {
  ...prompts.precise,
  sessionKey,
  maxReviewItems: Number(cfg?.maxReviewItems || 3),
  includeReviewTriage: cfg?.includeReviewTriage !== false,
  preferredSourcePrefixes,
});
const task = run('runtime-bridge.mjs', {
  ...prompts.task,
  sessionKey,
  maxReviewItems: Number(cfg?.maxReviewItems || 3),
  includeReviewTriage: cfg?.includeReviewTriage !== false,
  preferredSourcePrefixes,
});

const report = {
  ok: precise?.ok === true && task?.ok === true,
  generatedAt,
  sessionKey,
  contractVersion: 'runtime-probe.v1',
  probes: {
    precise: pickProbeSummary('precise', precise),
    task: pickProbeSummary('task', task),
  },
  operatorFacing: {
    preciseSourceDispatchReady: !!precise?.sourceDispatch?.primary?.tool,
    preciseSourceDispatchBlocking: precise?.sourceDispatch?.blocking === true,
    preciseBlockingReason: precise?.sourceDispatch?.blockingReason || null,
    taskCoverageQuality: task?.runtimeSourceMix?.coverageQuality ?? task?.selected?.runtimeSourceMix?.coverageQuality ?? null,
    taskBudgetReason: task?.selectedBudget?.budgetReason || null,
    taskEscalation: task?.selected?.escalation || null,
    summaryText: [
      `precise=${precise?.scene || 'unknown'} dispatch=${precise?.sourceDispatch?.primary?.tool || 'none'} blocking=${precise?.sourceDispatch?.blocking === true}`,
      `task=${task?.scene || 'unknown'} mix=${task?.runtimeSourceMix?.coverageQuality ?? task?.selected?.runtimeSourceMix?.coverageQuality ?? 'unknown'} budget=${task?.selectedBudget?.budgetReason || 'n/a'}`,
    ].join(' | '),
  },
  evidencePaths: [
    'memory/compiler/reports/runtime-probe.latest.json',
    'memory/compiler/control-plane/status.json',
    'memory/compiler/control-plane/overview.md',
  ],
};

const out = path.join(reportsDir, 'runtime-probe.latest.json');
fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
printResult({ ...report, out });

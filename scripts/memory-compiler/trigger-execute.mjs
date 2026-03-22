#!/usr/bin/env node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { readJsonInput, printResult } from './lib/io.mjs';
import { resolveCompilerRuntime, isDirectCli } from './lib/plugin-paths.mjs';
import { runScript } from './lib/run-script.mjs';
import { runPipeline } from './pipeline-run.mjs';

function usage() {
  console.error('Usage: node plugins/memory-compiler/scripts/memory-compiler/trigger-execute.mjs <bundle.json | ->');
  process.exit(2);
}
function tempJson(name, obj) {
  const p = path.join(os.tmpdir(), `memory-compiler-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
  return p;
}

export function triggerExecute(payload = {}, runtime = resolveCompilerRuntime()) {
  const bundlePath = tempJson('stdin-bundle', payload);
  try {
    const plan = runScript(runtime, 'trigger-plan.mjs', bundlePath);

    let pipeline = null;
    if (plan.triggers.runPipeline) {
      const cfg = {
        ...payload,
        compileToday: plan.triggers.compileToday,
        compileWeek: plan.triggers.compileWeek,
        compileNarrative: plan.triggers.compileNarrative,
        autoDisputeConflicts: plan.triggers.autoDisputeConflicts,
        autoArbitrateDisputes: plan.triggers.autoArbitrateDisputes,
        autoEnforceSourceDiscipline: true,
        preferredSourcePrefixes: ['file:', 'sum:', 'mem:', 'artifact:'],
      };
      pipeline = runPipeline(cfg, runtime);
    }

    let reviewQueue = null;
    if (plan.reviewItems.length) {
      const reviewPath = tempJson('review-enqueue', { action: 'enqueue', items: plan.reviewItems });
      reviewQueue = runScript(runtime, 'review-queue.mjs', reviewPath);
      fs.unlinkSync(reviewPath);
    }

    return { ok: true, plan, pipeline, reviewQueue };
  } finally {
    if (fs.existsSync(bundlePath)) fs.unlinkSync(bundlePath);
  }
}

if (isDirectCli(import.meta.url)) {
  const arg = process.argv[2];
  if (!arg) usage();
  const payload = readJsonInput(arg === '-' ? null : arg);
  printResult(triggerExecute(payload));
}

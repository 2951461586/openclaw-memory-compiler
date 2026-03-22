#!/usr/bin/env node
import { readJsonInput, printResult } from './lib/io.mjs';
import { triageReviewQueue } from './lib/review-triage-core.mjs';
import { resolveCompilerRuntime } from './lib/plugin-paths.mjs';

function usage() {
  console.error('Usage: node plugins/memory-compiler/scripts/memory-compiler/review-triage.mjs <config.json | ->');
  process.exit(2);
}

const arg = process.argv[2];
if (!arg) usage();
const payload = readJsonInput(arg === '-' ? null : arg);
const runtime = resolveCompilerRuntime();
printResult(triageReviewQueue({
  root: runtime.workspaceDir,
  paths: runtime,
  limit: Number(payload?.limit || 5),
  status: String(payload?.status || 'open'),
  query: payload?.query || '',
  priority: payload?.priority,
  reviewType: payload?.reviewType,
  includeAcceptance: payload?.includeAcceptance === true,
  operatorOnly: payload?.operatorOnly === true,
  namespace: payload?.namespace,
  origin: payload?.origin,
}));

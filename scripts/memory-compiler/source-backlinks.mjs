#!/usr/bin/env node
import { readJsonInput, printResult } from './lib/io.mjs';
import { buildSourceBacklinks, writeSourceBacklinks } from './lib/source-backlinks-core.mjs';
import { resolveCompilerRuntime } from './lib/plugin-paths.mjs';

function usage() {
  console.error('Usage: node plugins/memory-compiler/scripts/memory-compiler/source-backlinks.mjs <config.json | ->');
  process.exit(2);
}

const arg = process.argv[2];
if (!arg) usage();
const payload = readJsonInput(arg === '-' ? null : arg);
const runtime = resolveCompilerRuntime();
const paths = runtime;
const includeKinds = Array.isArray(payload?.includeKinds) && payload.includeKinds.length ? payload.includeKinds : ['lcm-summary', 'lcm-message', 'file', 'memory-item', 'session'];
const data = buildSourceBacklinks({ root: runtime.workspaceDir, includeKinds, paths });
printResult(writeSourceBacklinks({ root: runtime.workspaceDir, data, paths }));

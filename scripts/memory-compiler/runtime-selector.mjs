#!/usr/bin/env node
import { readJsonInput, printResult } from './lib/io.mjs';
import { selectRuntimeContext } from './lib/runtime-selector-core.mjs';
import { resolveCompilerRuntime } from './lib/plugin-paths.mjs';

function usage(){ console.error('Usage: node plugins/memory-compiler/scripts/memory-compiler/runtime-selector.mjs <input.json | ->'); process.exit(2); }
const arg=process.argv[2]; if(!arg) usage();
const payload=readJsonInput(arg==='-'?null:arg);
const runtime = resolveCompilerRuntime();
printResult(selectRuntimeContext({ root: runtime.workspaceDir, payload, paths: runtime }));

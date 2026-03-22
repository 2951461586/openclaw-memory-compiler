#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { readJsonl } from './lib/jsonl-store.mjs';
import { printResult } from './lib/io.mjs';
import { resolveCompilerRuntime, isDirectCli } from './lib/plugin-paths.mjs';

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}
function usage() {
  console.error('Usage: node plugins/memory-compiler/scripts/memory-compiler/rebuild-indexes.mjs');
  process.exit(2);
}

export function rebuildIndexes(runtime = resolveCompilerRuntime()) {
  const compilerDir = runtime.dataDir;
  const indexesDir = path.join(compilerDir, 'indexes');
  const facts = readJsonl(path.join(compilerDir, 'facts.jsonl'));
  const threads = readJsonl(path.join(compilerDir, 'threads.jsonl'));

  const factsByScope = Object.fromEntries(
    ['user', 'project', 'system', 'agent'].map(scope => [scope, facts.filter(f => f.scope === scope).map(f => f.id)])
  );

  const threadsByStatus = Object.fromEntries(
    ['active', 'stale', 'closed', 'blocked'].map(status => [status, threads.filter(t => t.status === status).map(t => t.id)])
  );

  const activeThreadsDetailed = threads
    .filter(t => t.status === 'active')
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .map(t => ({
      id: t.id,
      title: t.title,
      updatedAt: t.updatedAt,
      nextStepHint: t.nextStepHint ?? null,
      priority: t.priority ?? null
    }));

  writeJson(path.join(indexesDir, 'facts.by-scope.json'), factsByScope);
  writeJson(path.join(indexesDir, 'threads.by-status.json'), threadsByStatus);
  writeJson(path.join(indexesDir, 'threads.active.json'), activeThreadsDetailed);

  return {
    ok: true,
    facts: facts.length,
    threads: threads.length,
    indexes: [
      'facts.by-scope.json',
      'threads.by-status.json',
      'threads.active.json'
    ]
  };
}

if (isDirectCli(import.meta.url)) {
  if (process.argv[2]) usage();
  printResult(rebuildIndexes());
}

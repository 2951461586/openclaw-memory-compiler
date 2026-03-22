#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { readJsonl } from './lib/jsonl-store.mjs';
import { printResult } from './lib/io.mjs';
import { resolveCompilerRuntime } from './lib/plugin-paths.mjs';

const runtime = resolveCompilerRuntime();
const compilerDir = runtime.dataDir;
const reportsDir = runtime.reportsDir;
fs.mkdirSync(reportsDir, { recursive: true });

function collectDupes(records, keyFn) {
  const map = new Map();
  for (const rec of records) {
    const key = keyFn(rec);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(rec);
  }
  return [...map.entries()].filter(([, list]) => list.length > 1).map(([key, list]) => ({ key, ids: list.map(x => x.id), count: list.length }));
}

const facts = readJsonl(path.join(compilerDir, 'facts.jsonl'));
const threads = readJsonl(path.join(compilerDir, 'threads.jsonl'));
const continuity = readJsonl(path.join(compilerDir, 'continuity.jsonl'));

const duplicateFactIds = collectDupes(facts, r => r.id || '');
const duplicateThreadIds = collectDupes(threads, r => r.id || '');
const duplicateContinuityIds = collectDupes(continuity, r => r.id || '');

const report = {
  generatedAt: new Date().toISOString(),
  duplicateFactIds,
  duplicateThreadIds,
  duplicateContinuityIds,
  ok: duplicateFactIds.length === 0 && duplicateThreadIds.length === 0 && duplicateContinuityIds.length === 0
};
const out = path.join(reportsDir, 'integrity-audit.latest.json');
fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
printResult({ ok: report.ok, out, duplicateFactIds: duplicateFactIds.length, duplicateThreadIds: duplicateThreadIds.length, duplicateContinuityIds: duplicateContinuityIds.length });

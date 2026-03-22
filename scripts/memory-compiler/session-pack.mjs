#!/usr/bin/env node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { readJsonInput, printResult } from './lib/io.mjs';
import { ensureParent, appendJsonl } from './lib/jsonl-store.mjs';
import { nowIso } from './lib/common.mjs';
import { buildSessionPack } from './lib/session-pack-core.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = process.cwd();
const base = path.resolve(__dirname);
const compilerDir = path.join(root, 'memory', 'compiler');
const packsDir = path.join(compilerDir, 'session-packs');
const currentPath = path.join(packsDir, 'current.json');
const historyPath = path.join(packsDir, 'history.jsonl');
const reportsDir = path.join(compilerDir, 'reports');
const reportPath = path.join(reportsDir, 'session-pack.latest.json');
fs.mkdirSync(reportsDir, { recursive: true });

function usage() {
  console.error('Usage: node plugins/memory-compiler/scripts/memory-compiler/session-pack.mjs <config.json | ->');
  process.exit(2);
}
function run(script, inputPath) {
  const args = [path.join(base, script)];
  if (inputPath) args.push(inputPath);
  return JSON.parse(execFileSync('node', args, { cwd: root, encoding: 'utf8' }));
}
function tempJson(name, obj) {
  const p = path.join(os.tmpdir(), `memory-compiler-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
  return p;
}

const arg = process.argv[2];
if (!arg) usage();
const payload = readJsonInput(arg === '-' ? null : arg);
const selectorCfg = tempJson('session-pack-selector', {
  scene: payload.scene || 'task',
  date: payload.date,
  week: payload.week,
  maxPromptChars: payload.maxPromptChars || 1200,
  maxPromptTokens: payload.maxPromptTokens || 300,
  maxFacts: payload.maxFacts || 6,
  maxThreads: payload.maxThreads || 3,
  maxContinuity: payload.maxContinuity || 3,
  preferredSourcePrefixes: payload.preferredSourcePrefixes || ['sum:', 'file:', 'mem:']
});
const selector = run('runtime-selector.mjs', selectorCfg);
fs.unlinkSync(selectorCfg);
const selected = selector.selected;
const generatedAt = nowIso();
const pack = buildSessionPack({ selected, payload, generatedAt });

ensureParent(currentPath);
fs.writeFileSync(currentPath, JSON.stringify(pack, null, 2) + '\n');
appendJsonl(historyPath, pack);
fs.writeFileSync(reportPath, JSON.stringify({ ok: true, generatedAt, currentPath, historyPath, pack }, null, 2) + '\n');
printResult({ ok: true, currentPath, historyPath, pack: { id: pack.id, focus: pack.focus, decisions: pack.decisions.length, risks: pack.risks.length, nextActions: pack.nextActions.length, sourceRefs: pack.sourceRefs.length, expiresAt: pack.expiresAt, sourceDiscipline: pack.sourceDiscipline, lifecycleState: pack.lifecycleState } });

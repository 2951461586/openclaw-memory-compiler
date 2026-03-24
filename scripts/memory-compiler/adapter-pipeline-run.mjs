#!/usr/bin/env node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { printResult } from './lib/io.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = process.cwd();
const base = path.resolve(__dirname);

function usage() {
  console.error('Usage: node plugins/memory-compiler/scripts/memory-compiler/adapter-pipeline-run.mjs <adapter> <input.json>');
  console.error('Adapters: raw | lcm | lancedb | workspace | session-state');
  process.exit(2);
}

const adapter = process.argv[2];
const inputPath = process.argv[3];
if (!adapter || !inputPath) usage();

const adapterMap = {
  raw: path.join(base, 'ingest-normalize.mjs'),
  lcm: path.join(base, 'adapters', 'lcm-summary-import.mjs'),
  'lcm-summary': path.join(base, 'adapters', 'lcm-summary-import.mjs'),
  lancedb: path.join(base, 'adapters', 'lancedb-memory-import.mjs'),
  'memory-lancedb': path.join(base, 'adapters', 'lancedb-memory-import.mjs'),
  workspace: path.join(base, 'adapters', 'workspace-note-import.mjs'),
  'session-state': path.join(base, 'adapters', 'session-state-import.mjs')
};

const adapterScript = adapterMap[adapter];
if (!adapterScript) usage();

const normalized = execFileSync('node', [adapterScript, inputPath], { cwd: root, encoding: 'utf8' });
const tmpPath = path.join(os.tmpdir(), `memory-compiler-${adapter}-${Date.now()}.json`);
fs.writeFileSync(tmpPath, normalized);
const result = JSON.parse(execFileSync('node', [path.join(base, 'pipeline-run.mjs'), tmpPath], { cwd: root, encoding: 'utf8' }));
if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
printResult({ ok: true, adapter, inputPath, result });

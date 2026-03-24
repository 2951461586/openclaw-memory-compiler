#!/usr/bin/env node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { printResult, readJsonInput } from './lib/io.mjs';
import { nowIso } from './lib/common.mjs';

function usage() {
  console.error('Usage: node plugins/memory-compiler/scripts/memory-compiler/export-durable-memory.mjs <config.json | ->');
  process.exit(2);
}

const arg = process.argv[2];
if (!arg) usage();
const cfg = readJsonInput(arg === '-' ? null : arg);
const tmp = path.join(os.tmpdir(), `memory-pro-export-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
const cmd = ['memory-pro', 'export', '--output', tmp];
if (cfg?.scope) cmd.push('--scope', String(cfg.scope));
if (cfg?.category) cmd.push('--category', String(cfg.category));
try {
  execFileSync('openclaw', cmd, { cwd: process.cwd(), encoding: 'utf8' });
  const exported = JSON.parse(fs.readFileSync(tmp, 'utf8'));
  printResult({
    ok: true,
    generatedAt: nowIso(),
    exportPath: tmp,
    scope: cfg?.scope ?? null,
    category: cfg?.category ?? null,
    version: exported?.version || null,
    exportedAt: exported?.exportedAt || null,
    count: exported?.count ?? (Array.isArray(exported?.memories) ? exported.memories.length : 0),
    memories: Array.isArray(exported?.memories) ? exported.memories : [],
  });
} finally {
  if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
}

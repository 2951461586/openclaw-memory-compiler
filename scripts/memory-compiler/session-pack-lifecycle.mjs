#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const pluginRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');

const { normalizePluginConfig } = await import(pathToFileURL(path.join(pluginRoot, 'src', 'config.ts')).href);
const { resolveMemoryCompilerPaths } = await import(pathToFileURL(path.join(pluginRoot, 'src', 'paths.ts')).href);
const { applySessionPackLifecycleEntry } = await import(pathToFileURL(path.join(pluginRoot, 'src', 'core', 'runtime-entry.ts')).href);

function usage() {
  console.error('Usage: node plugins/memory-compiler/scripts/memory-compiler/session-pack-lifecycle.mjs <config.json | ->');
  process.exit(2);
}
function readPayload(arg) {
  const raw = arg === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(arg, 'utf8');
  return raw.trim() ? JSON.parse(raw) : {};
}

const arg = process.argv[2];
if (!arg) usage();

const payload = readPayload(arg);
const config = normalizePluginConfig({ enabled: true, ...(payload.pluginConfig || {}) });
const paths = resolveMemoryCompilerPaths(config);

const result = await applySessionPackLifecycleEntry(config, paths, payload);
process.stdout.write(JSON.stringify(result, null, 2) + '\n');

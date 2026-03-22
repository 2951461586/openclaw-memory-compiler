import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizePluginConfig } from '../src/config.ts';
import { registerMemoryCompilerPlugin } from '../src/register.ts';

function mktemp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'memory-compiler-plugin-register-'));
}

function createHarness(config) {
  const eventHandlers = new Map();
  const logs = [];
  const api = {
    pluginConfig: config,
    logger: {
      info: (msg) => logs.push({ level: 'info', msg }),
      warn: (msg) => logs.push({ level: 'warn', msg }),
    },
    on: (event, handler, meta = {}) => {
      const list = eventHandlers.get(event) || [];
      list.push({ handler, meta });
      eventHandlers.set(event, list);
    },
  };
  return { api, eventHandlers, logs };
}

test('registerMemoryCompilerPlugin mounts before_prompt_build and session_end hooks', () => {
  const workspaceDir = mktemp();
  const config = normalizePluginConfig({ enabled: true, workspaceDir, controlPlaneMode: 'plugin-preferred' });
  const harness = createHarness(config);
  registerMemoryCompilerPlugin(harness.api, config);
  const before = harness.eventHandlers.get('before_prompt_build') || [];
  const sessionEnd = harness.eventHandlers.get('session_end') || [];
  assert.equal(before.length, 1);
  assert.equal(sessionEnd.length, 1);
  assert.ok(harness.logs.some(x => x.level === 'info' && /memory-compiler plugin enabled/.test(x.msg)));
});

test('registerMemoryCompilerPlugin does not mount hooks when disabled', () => {
  const workspaceDir = mktemp();
  const config = normalizePluginConfig({ enabled: false, workspaceDir });
  const harness = createHarness(config);
  registerMemoryCompilerPlugin(harness.api, config);
  assert.equal((harness.eventHandlers.get('before_prompt_build') || []).length, 0);
  assert.equal((harness.eventHandlers.get('session_end') || []).length, 0);
});

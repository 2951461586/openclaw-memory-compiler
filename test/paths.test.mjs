import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePluginConfig } from '../src/config.ts';
import { resolveMemoryCompilerPaths } from '../src/paths.ts';
import { initializeMemoryCompilerLayout } from '../src/init.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function mktemp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'memory-compiler-plugin-'));
}

test('resolveMemoryCompilerPaths honors configurable dirs', () => {
  const workspaceDir = mktemp();
  const config = normalizePluginConfig({
    enabled: true,
    workspaceDir,
    dataDir: 'var/mc-data',
    reportsDir: 'var/mc-reports',
    runtimeDir: 'var/mc-runtime',
    docsDir: 'docs/mc',
    sessionStatePath: 'state/session.md',
    workingBufferPath: 'state/working.md',
    dailyMemoryDir: 'journal',
  });
  const paths = resolveMemoryCompilerPaths(config);
  assert.equal(paths.dataDir, path.join(workspaceDir, 'var/mc-data'));
  assert.equal(paths.reportsDir, path.join(workspaceDir, 'var/mc-reports'));
  assert.equal(paths.runtimeDir, path.join(workspaceDir, 'var/mc-runtime'));
  assert.equal(paths.docsDir, path.join(workspaceDir, 'docs/mc'));
  assert.equal(paths.sessionStatePath, path.join(workspaceDir, 'state/session.md'));
  assert.equal(paths.workingBufferPath, path.join(workspaceDir, 'state/working.md'));
  assert.equal(paths.dailyMemoryDir, path.join(workspaceDir, 'journal'));
});

test('initializeMemoryCompilerLayout creates plugin-owned directories and metadata', () => {
  const workspaceDir = mktemp();
  const config = normalizePluginConfig({ enabled: true, workspaceDir });
  const result = initializeMemoryCompilerLayout(config);
  assert.equal(result.ok, true);
  assert.equal(fs.existsSync(path.join(workspaceDir, 'memory/compiler/control-plane')), true);
  assert.equal(fs.existsSync(path.join(workspaceDir, 'memory/compiler/session-packs/handoffs')), true);
  assert.equal(fs.existsSync(path.join(workspaceDir, 'memory/compiler/plugin-layout.json')), true);
  const meta = JSON.parse(fs.readFileSync(path.join(workspaceDir, 'memory/compiler/plugin-layout.json'), 'utf8'));
  assert.equal(meta.plugin, 'memory-compiler');
});

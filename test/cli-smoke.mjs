import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const pluginRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const binPath = path.join(pluginRoot, 'bin', 'memory-compiler.mjs');
const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-compiler-cli-smoke-'));

const payloadPath = path.join(workspaceDir, 'doctor.json');
fs.writeFileSync(payloadPath, JSON.stringify({
  pluginConfig: {
    enabled: true,
    workspaceDir,
    controlPlaneMode: 'plugin-preferred',
  },
}, null, 2));

const out = JSON.parse(execFileSync('node', [binPath, 'doctor', payloadPath], {
  cwd: workspaceDir,
  encoding: 'utf8',
}));

assert.equal(out.ok, true);
assert.equal(out.plugin.id, 'memory-compiler');
assert.ok(Array.isArray(out.checks));
assert.ok(out.checks.some((x) => x.name === 'cli-bin-present' && x.ok === true));

const sourceAudit = JSON.parse(execFileSync('node', [binPath, 'source-audit', payloadPath], {
  cwd: workspaceDir,
  encoding: 'utf8',
}));
assert.equal(sourceAudit.ok, true);

const orphanDigest = JSON.parse(execFileSync('node', [binPath, 'orphan-digest', payloadPath], {
  cwd: workspaceDir,
  encoding: 'utf8',
}));
assert.equal(orphanDigest.ok, true);
assert.equal(orphanDigest.action, 'detect');

const ingestNormalize = JSON.parse(execFileSync('node', [binPath, 'ingest-normalize', '-'], {
  cwd: workspaceDir,
  encoding: 'utf8',
  input: JSON.stringify({
    pluginConfig: {
      enabled: true,
      workspaceDir,
      controlPlaneMode: 'plugin-preferred',
    },
    sourceRefs: ['file:docs/test.md'],
    confirmedFacts: [{ text: 'plugin CLI covers ingest normalize', subject: 'plugin-cli', attribute: 'coverage', value: 'ingest-normalize' }],
  }),
}));
assert.equal(Array.isArray(ingestNormalize.facts), true);
assert.equal(ingestNormalize.facts.length, 1);
assert.equal(ingestNormalize.facts[0].sourceRefs.includes('file:docs/test.md'), true);

const mixBeforeAfter = JSON.parse(execFileSync('node', [binPath, 'runtime-source-mix-before-after', payloadPath], {
  cwd: workspaceDir,
  encoding: 'utf8',
}));
assert.equal(mixBeforeAfter.ok, true);
assert.ok(typeof mixBeforeAfter.after?.authorityScore === 'number');

process.stdout.write('cli smoke ok\n');

#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { readJsonl } from './lib/jsonl-store.mjs';
import { printResult } from './lib/io.mjs';
import { resolveCompilerRuntime } from './lib/plugin-paths.mjs';

const runtime = resolveCompilerRuntime();
const compilerDir = runtime.dataDir;
const digestsDir = path.join(compilerDir, 'digests');
const reportsDir = runtime.reportsDir;
fs.mkdirSync(reportsDir, { recursive: true });

function collectManifests() {
  const manifestsDir = path.join(digestsDir, 'manifests');
  if (!fs.existsSync(manifestsDir)) return [];
  const files = fs.readdirSync(manifestsDir).filter(f => f.endsWith('.json'));
  const manifests = [];
  for (const f of files) {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(manifestsDir, f), 'utf8'));
      manifests.push({ id: f.replace('.json', ''), ...m });
    } catch { /* skip */ }
  }
  return manifests;
}

function findLatestIndex() {
  const idxPath = path.join(digestsDir, 'latest-index.json');
  if (!fs.existsSync(idxPath)) return {};
  return JSON.parse(fs.readFileSync(idxPath, 'utf8'));
}

function ageDays(iso) {
  const ts = Date.parse(iso);
  return ts ? (Date.now() - ts) / 86400000 : null;
}

const manifests = collectManifests();
const latestIndex = findLatestIndex();
const latestIds = new Set(Object.values(latestIndex));
const now = new Date().toISOString();
const retentionDays = 30;
const toDelete = [];

for (const m of manifests) {
  if (latestIds.has(m.id)) continue;
  const age = ageDays(m.generatedAt);
  if (age !== null && age > retentionDays) {
    toDelete.push(m.id);
  }
}

let deletedManifests = 0;
let deletedDigests = 0;

for (const id of toDelete) {
  const manifestPath = path.join(digestsDir, 'manifests', `${id}.json`);
  if (fs.existsSync(manifestPath)) {
    fs.unlinkSync(manifestPath);
    deletedManifests++;
  }
  const type = id.split('::')[0];
  const dateKey = id.split('::')[1] || id;
  const digestDir = path.join(digestsDir, type);
  if (fs.existsSync(digestDir)) {
    const files = fs.readdirSync(digestDir).filter(f => f.includes(dateKey));
    for (const f of files) {
      fs.unlinkSync(path.join(digestDir, f));
      deletedDigests++;
    }
  }
}

const report = {
  generatedAt: now,
  retentionDays,
  totalManifests: manifests.length,
  latestCount: latestIds.size,
  candidateCount: toDelete.length,
  deletedManifests,
  deletedDigests,
  ok: deletedManifests === 0 || true,
};
const out = path.join(reportsDir, 'digest-gc.latest.json');
fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
printResult({ ok: true, out, ...report });

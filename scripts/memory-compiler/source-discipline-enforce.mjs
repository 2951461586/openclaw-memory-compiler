#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { readJsonl, writeJsonl } from './lib/jsonl-store.mjs';
import { printResult } from './lib/io.mjs';
import { nowIso, uniq } from './lib/common.mjs';

const root = process.cwd();
const compilerDir = path.join(root, 'memory', 'compiler');
const reportsDir = path.join(compilerDir, 'reports');
const TRUSTED_PREFIXES = ['sum:', 'file:', 'mem:'];
fs.mkdirSync(reportsDir, { recursive: true });

function isTrusted(ref){ return TRUSTED_PREFIXES.some(p => String(ref).startsWith(p)); }
function trustedCount(refs=[]){ return refs.filter(isTrusted).length; }
function artifactOnly(refs=[]){ return refs.length > 0 && trustedCount(refs) === 0; }

const now = nowIso();
const factsPath = path.join(compilerDir, 'facts.jsonl');
const threadsPath = path.join(compilerDir, 'threads.jsonl');
const continuityPath = path.join(compilerDir, 'continuity.jsonl');
const facts = readJsonl(factsPath);
const threads = readJsonl(threadsPath);
const continuity = readJsonl(continuityPath);

const changed = {
  factsDowngraded: [],
  threadsBlocked: [],
  continuityExpired: []
};

for (const fact of facts) {
  if (fact.status !== 'confirmed') continue;
  if (!artifactOnly(fact.sourceRefs || [])) continue;
  fact.status = 'inferred';
  fact.sourceDisciplineDowngradedAt = now;
  fact.sourceDisciplineReason = 'artifact-only-confirmed-downgraded';
  fact.tags = uniq([...(fact.tags || []), 'source-discipline-downgraded']);
  changed.factsDowngraded.push(fact.id);
}

for (const thread of threads) {
  if (thread.status !== 'active') continue;
  if (!artifactOnly(thread.sourceRefs || [])) continue;
  thread.status = 'blocked';
  thread.blockedAt = now;
  thread.blockedReason = 'artifact-only-active-thread';
  changed.threadsBlocked.push(thread.id);
}

for (const item of continuity) {
  if (item.expiresAt) continue;
  if (!artifactOnly(item.sourceRefs || [])) continue;
  item.expiresAt = now;
  item.sourceDisciplineExpiredAt = now;
  item.sourceDisciplineReason = 'artifact-only-live-continuity';
  changed.continuityExpired.push(item.id);
}

if (changed.factsDowngraded.length) writeJsonl(factsPath, facts);
if (changed.threadsBlocked.length) writeJsonl(threadsPath, threads);
if (changed.continuityExpired.length) writeJsonl(continuityPath, continuity);

const out = path.join(reportsDir, 'source-discipline-enforce.latest.json');
fs.writeFileSync(out, JSON.stringify({ generatedAt: now, ...changed }, null, 2) + '\n');
printResult({ ok: true, out, ...Object.fromEntries(Object.entries(changed).map(([k,v]) => [k, v.length])), changed });

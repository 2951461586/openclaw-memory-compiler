#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { readJsonInput, printResult } from './lib/io.mjs';
import { readJsonl, writeJsonl } from './lib/jsonl-store.mjs';
import { normalizeText, uniq, nowIso } from './lib/common.mjs';

const root = process.cwd();
const compilerDir = path.join(root, 'memory', 'compiler');
const factsPath = path.join(compilerDir, 'facts.jsonl');
const reportPath = path.join(compilerDir, 'reports', 'fact-dedupe.latest.json');
fs.mkdirSync(path.dirname(reportPath), { recursive: true });

const arg = process.argv[2];
const cfg = arg ? readJsonInput(arg === '-' ? null : arg) : {};
const apply = !!cfg.apply;

function semanticKey(f) {
  return [
    f.scope || '',
    normalizeText(f.subject || ''),
    normalizeText(f.attribute || ''),
    normalizeText(f.value ?? ''),
    normalizeText(f.text || '')
  ].join('::');
}

function rank(f) {
  let s = 0;
  if (f.status === 'confirmed') s += 30;
  else if (f.status === 'inferred') s += 10;
  s += Number(f.confidence || 0) * 10;
  s += Math.min((f.sourceRefs || []).length, 4);
  if (f.subject && f.attribute) s += 3;
  return s;
}

const facts = readJsonl(factsPath);
const groups = new Map();
for (const fact of facts) {
  if (['stale'].includes(fact.status)) continue;
  const key = semanticKey(fact);
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(fact);
}

const suggestions = [];
let changed = 0;
const now = nowIso();
for (const [key, list] of groups.entries()) {
  if (list.length < 2) continue;
  list.sort((a, b) => rank(b) - rank(a));
  const canonical = list[0];
  const duplicates = list.slice(1);
  suggestions.push({
    key,
    canonical: canonical.id,
    duplicates: duplicates.map(d => d.id),
    count: list.length
  });
  if (apply) {
    for (const dup of duplicates) {
      canonical.sourceRefs = uniq([...(canonical.sourceRefs || []), ...(dup.sourceRefs || [])]);
      canonical.tags = uniq([...(canonical.tags || []), ...(dup.tags || [])]);
      canonical.mergedFactIds = uniq([...(canonical.mergedFactIds || []), dup.id]);
      dup.status = 'stale';
      dup.supersededBy = canonical.id;
      dup.expiresAt = now;
      changed++;
    }
    canonical.reconciledAt = now;
  }
}

if (apply && changed) writeJsonl(factsPath, facts);
fs.writeFileSync(reportPath, JSON.stringify({ generatedAt: now, apply, changed, count: suggestions.length, suggestions }, null, 2) + '\n');
printResult({ ok: true, reportPath, count: suggestions.length, changed });

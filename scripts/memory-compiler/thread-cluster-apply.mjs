#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { readJsonInput, printResult } from './lib/io.mjs';
import { readJsonl, writeJsonl } from './lib/jsonl-store.mjs';
import { uniq, nowIso } from './lib/common.mjs';

const root = process.cwd();
const threadsPath = path.join(root, 'memory', 'compiler', 'threads.jsonl');
const reportPath = path.join(root, 'memory', 'compiler', 'reports', 'thread-clusters.latest.json');

const cfgPath = process.argv[2];
const cfg = cfgPath ? readJsonInput(cfgPath === '-' ? null : cfgPath) : {};
const minScore = Number(cfg.minScore ?? 0.5);
const apply = cfg.apply !== false;

const report = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : { suggestions: [] };
const threads = readJsonl(threadsPath);
const byId = new Map(threads.map(t => [t.id, t]));
let changed = 0;
const applied = [];
const now = nowIso();

for (const s of report.suggestions || []) {
  if (Number(s.score || 0) < minScore) continue;
  const a = byId.get(s.a);
  const b = byId.get(s.b);
  if (!a || !b) continue;
  if (a.status !== 'active' || b.status !== 'active') continue;
  const target = (String(a.updatedAt) >= String(b.updatedAt)) ? a : b;
  const source = target.id === a.id ? b : a;
  if (apply) {
    target.sourceRefs = uniq([...(target.sourceRefs || []), ...(source.sourceRefs || [])]);
    target.relatedFacts = uniq([...(target.relatedFacts || []), ...(source.relatedFacts || [])]);
    target.summary = uniq([target.summary, source.summary, `auto-cluster merged from ${source.id}`].filter(Boolean)).join(' | ');
    target.updatedAt = now;
    source.status = 'closed';
    source.closedAt = now;
    source.mergedInto = target.id;
    changed += 2;
  }
  applied.push({ source: source.id, target: target.id, score: s.score, reason: s.reason });
}

if (apply && changed) writeJsonl(threadsPath, threads);
printResult({ ok: true, changed, appliedCount: applied.length, applied });

#!/usr/bin/env node
import path from 'node:path';
import { readJsonInput, printResult } from './lib/io.mjs';
import { readJsonl, writeJsonl } from './lib/jsonl-store.mjs';
import { normalizeText, uniq, nowIso } from './lib/common.mjs';

const root = process.cwd();
const compilerDir = path.join(root, 'memory', 'compiler');
const factsPath = path.join(compilerDir, 'facts.jsonl');
const reportPath = path.join(compilerDir, 'reports', 'fact-arbitrate.latest.json');

const arg = process.argv[2];
const cfg = arg ? readJsonInput(arg === '-' ? null : arg) : {};
const preferred = Array.isArray(cfg.preferredSourcePrefixes) && cfg.preferredSourcePrefixes.length
  ? cfg.preferredSourcePrefixes
  : ['file:', 'sum:', 'mem:', 'artifact:'];
const apply = cfg.apply !== false;

function groupKey(f) {
  return `${f.scope || ''}::${normalizeText(f.subject || '')}::${normalizeText(f.attribute || '')}`;
}
function sourceRank(refs = []) {
  let score = 0;
  preferred.forEach((p, i) => {
    if (refs.some(r => String(r).startsWith(p))) score += (preferred.length - i) * 20;
  });
  score += Math.min(refs.length, 5);
  return score;
}
function factScore(f) {
  let score = sourceRank(f.sourceRefs || []);
  score += Number(f.confidence || 0) * 10;
  if (f.subject && f.attribute) score += 3;
  const valueNorm = normalizeText(f.value ?? '');
  const textNorm = normalizeText(f.text ?? '');
  if (valueNorm && textNorm) {
    if (textNorm.includes(valueNorm)) score += 8;
    else score -= 35;
  }
  return Number(score.toFixed(2));
}

const facts = readJsonl(factsPath);
const groups = new Map();
for (const fact of facts) {
  if (fact.status !== 'disputed') continue;
  if (!fact.subject || !fact.attribute) continue;
  const key = groupKey(fact);
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(fact);
}

const now = nowIso();
const resolved = [];
const unresolved = [];
let changed = 0;

for (const [key, list] of groups.entries()) {
  if (list.length < 2) {
    unresolved.push({ key, reason: 'single-disputed-fact', factIds: list.map(x => x.id) });
    continue;
  }
  const ranked = [...list].map(f => ({ fact: f, score: factScore(f) })).sort((a, b) => b.score - a.score);
  const top = ranked[0];
  const tied = ranked.filter(x => x.score === top.score);
  if (tied.length > 1) {
    unresolved.push({ key, reason: 'score-tie', candidates: ranked.map(x => ({ id: x.fact.id, score: x.score })) });
    continue;
  }

  const winner = top.fact;
  const losers = ranked.slice(1).map(x => x.fact);
  resolved.push({
    key,
    winner: winner.id,
    losers: losers.map(x => x.id),
    scores: ranked.map(x => ({ id: x.fact.id, score: x.score }))
  });

  if (apply) {
    winner.status = 'confirmed';
    winner.lastConfirmedAt = now;
    winner.arbitratedAt = now;
    winner.arbitrationReason = 'source-first-preference';
    for (const loser of losers) {
      loser.status = 'stale';
      loser.expiresAt = now;
      loser.supersededBy = winner.id;
      loser.arbitratedAt = now;
      loser.sourceRefs = uniq([...(loser.sourceRefs || []), `artifact:arbiter:${winner.id}`]);
      winner.mergedFactIds = uniq([...(winner.mergedFactIds || []), loser.id]);
      winner.sourceRefs = uniq([...(winner.sourceRefs || []), ...(loser.sourceRefs || [])]);
      changed++;
    }
    changed++;
  }
}

if (apply && changed) writeJsonl(factsPath, facts);
await import('node:fs').then(fs => fs.writeFileSync(reportPath, JSON.stringify({ generatedAt: now, apply, preferredSourcePrefixes: preferred, resolvedCount: resolved.length, unresolvedCount: unresolved.length, resolved, unresolved }, null, 2) + '\n'));
printResult({ ok: true, reportPath, resolvedCount: resolved.length, unresolvedCount: unresolved.length, changed });

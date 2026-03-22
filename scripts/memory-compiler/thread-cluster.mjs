#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { printResult } from './lib/io.mjs';
import { readJsonl } from './lib/jsonl-store.mjs';
import { normalizeText } from './lib/common.mjs';
import { resolveCompilerRuntime, isDirectCli } from './lib/plugin-paths.mjs';

function tokenSet(s) { return new Set(normalizeText(s).split(/[-\s]+/).filter(Boolean)); }
function jaccardSet(a, b) {
  const aa = a instanceof Set ? a : tokenSet(a);
  const bb = b instanceof Set ? b : tokenSet(b);
  const inter = [...aa].filter(x => bb.has(x)).length;
  const union = new Set([...aa, ...bb]).size;
  return union ? inter / union : 0;
}
function refsSet(arr = []) { return new Set(arr.map(x => String(x))); }
function usage() {
  console.error('Usage: node plugins/memory-compiler/scripts/memory-compiler/thread-cluster.mjs');
  process.exit(2);
}

export function clusterThreads(runtime = resolveCompilerRuntime()) {
  const compilerDir = runtime.dataDir;
  const threadsPath = path.join(compilerDir, 'threads.jsonl');
  const out = path.join(runtime.reportsDir, 'thread-clusters.latest.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });

  const threads = readJsonl(threadsPath).filter(t => ['active', 'blocked'].includes(t.status));
  const suggestions = [];
  for (let i = 0; i < threads.length; i++) {
    for (let j = i + 1; j < threads.length; j++) {
      const a = threads[i], b = threads[j];
      if (a.scope !== b.scope) continue;
      const titleScore = jaccardSet(a.title, b.title);
      const summaryScore = jaccardSet(a.summary || '', b.summary || '');
      const relatedFactsScore = jaccardSet(new Set(a.relatedFacts || []), new Set(b.relatedFacts || []));
      const sourceScore = jaccardSet(refsSet(a.sourceRefs || []), refsSet(b.sourceRefs || []));
      const titleA = normalizeText(a.title), titleB = normalizeText(b.title);
      const prefixHit = titleA.startsWith(titleB.slice(0, 8)) || titleB.startsWith(titleA.slice(0, 8));
      const score = Number((titleScore * 0.45 + summaryScore * 0.30 + relatedFactsScore * 0.15 + sourceScore * 0.10 + (prefixHit ? 0.15 : 0)).toFixed(3));
      const reasons = [];
      if (prefixHit) reasons.push('prefix-match');
      if (titleScore >= 0.3) reasons.push('title-overlap');
      if (summaryScore >= 0.3) reasons.push('summary-overlap');
      if (sourceScore > 0) reasons.push('shared-sources');
      if (relatedFactsScore > 0) reasons.push('shared-related-facts');
      if (score >= 0.42) {
        suggestions.push({
          a: a.id,
          b: b.id,
          score,
          reasons,
          titles: [a.title, b.title],
          components: { titleScore, summaryScore, relatedFactsScore, sourceScore, prefixHit }
        });
      }
    }
  }

  fs.writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), count: suggestions.length, suggestions }, null, 2) + '\n');
  return { ok: true, out, count: suggestions.length };
}

if (isDirectCli(import.meta.url)) {
  if (process.argv[2]) usage();
  printResult(clusterThreads());
}

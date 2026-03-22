#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { readJsonl } from './lib/jsonl-store.mjs';
import { printResult } from './lib/io.mjs';
import { resolveCompilerRuntime, isDirectCli } from './lib/plugin-paths.mjs';

const TRUSTED_PREFIXES = ['sum:', 'file:', 'mem:'];
function isTrusted(ref){ return TRUSTED_PREFIXES.some(p => String(ref).startsWith(p)); }
function summarize(list, predicate) {
  const target = list.filter(predicate);
  const trusted = target.filter(x => (x.sourceRefs || []).some(isTrusted)).length;
  const artifactOnly = target.filter(x => (x.sourceRefs || []).length > 0 && !(x.sourceRefs || []).some(isTrusted)).length;
  const noRefs = target.filter(x => (x.sourceRefs || []).length === 0).length;
  return { total: target.length, trusted, artifactOnly, noRefs, trustedRatio: target.length ? Number((trusted / target.length).toFixed(3)) : 0 };
}
function usage() {
  console.error('Usage: node plugins/memory-compiler/scripts/memory-compiler/source-discipline-check.mjs');
  process.exit(2);
}

export function checkSourceDiscipline(_payload = {}, runtime = resolveCompilerRuntime()) {
  const compilerDir = runtime.dataDir;
  const reportsDir = runtime.reportsDir;
  fs.mkdirSync(reportsDir, { recursive: true });

  const facts = readJsonl(path.join(compilerDir, 'facts.jsonl'));
  const threads = readJsonl(path.join(compilerDir, 'threads.jsonl'));
  const continuity = readJsonl(path.join(compilerDir, 'continuity.jsonl'));
  const report = {
    generatedAt: new Date().toISOString(),
    factsConfirmed: summarize(facts, x => x.status === 'confirmed'),
    threadsActive: summarize(threads, x => x.status === 'active'),
    continuityLive: summarize(continuity, x => !x.expiresAt),
  };
  report.ok = report.factsConfirmed.artifactOnly === 0 && report.threadsActive.artifactOnly === 0;
  report.warnings = [];
  if (report.factsConfirmed.artifactOnly > 0) report.warnings.push('confirmed facts contain artifact-only sources');
  if (report.threadsActive.artifactOnly > 0) report.warnings.push('active threads contain artifact-only sources');
  if (report.continuityLive.artifactOnly > 0) report.warnings.push('continuity contains artifact-only sources');
  const out = path.join(reportsDir, 'source-discipline.latest.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  return { ok: report.ok, out, warnings: report.warnings, factsConfirmed: report.factsConfirmed, threadsActive: report.threadsActive, continuityLive: report.continuityLive };
}

if (isDirectCli(import.meta.url)) {
  if (process.argv[2]) usage();
  printResult(checkSourceDiscipline());
}

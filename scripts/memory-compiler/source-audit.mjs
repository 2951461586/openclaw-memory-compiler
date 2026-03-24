#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { printResult } from './lib/io.mjs';
import { resolveCompilerRuntime, isDirectCli } from './lib/plugin-paths.mjs';
import { isAllowedSourceRef } from './lib/source-discipline.mjs';

export function runSourceAudit(runtime = resolveCompilerRuntime()) {
  const compilerDir = runtime.dataDir;
  const files = ['facts.jsonl', 'threads.jsonl', 'continuity.jsonl'].map(f => path.join(compilerDir, f));
  const issues = [];

  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    lines.forEach((line, idx) => {
      let rec;
      try { rec = JSON.parse(line); }
      catch (err) {
        issues.push({ file: path.basename(file), line: idx + 1, kind: 'json-parse', detail: err.message });
        return;
      }
      const refs = rec.sourceRefs;
      if (refs == null) return;
      if (!Array.isArray(refs) || refs.length === 0) {
        issues.push({ file: path.basename(file), line: idx + 1, id: rec.id ?? null, kind: 'sourceRefs-empty' });
        return;
      }
      refs.forEach((ref) => {
        if (!isAllowedSourceRef(ref)) {
          issues.push({ file: path.basename(file), line: idx + 1, id: rec.id ?? null, kind: 'sourceRef-format', ref });
        }
      });
    });
  }

  return { ok: issues.length === 0, issues };
}

if (isDirectCli(import.meta.url)) {
  const out = runSourceAudit();
  printResult(out);
  process.exit(out.ok ? 0 : 1);
}

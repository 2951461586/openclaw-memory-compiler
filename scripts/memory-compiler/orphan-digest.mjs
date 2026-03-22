#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { readJsonInput, printResult } from './lib/io.mjs';
import { nowIso } from './lib/common.mjs';
import { resolveCompilerRuntime, isDirectCli } from './lib/plugin-paths.mjs';

function usage() {
  console.error('Usage: node plugins/memory-compiler/scripts/memory-compiler/orphan-digest.mjs <config.json | ->');
  process.exit(2);
}
function maybeReadJson(filePath) {
  try { return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : null; } catch { return null; }
}
function writeJson(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2) + '\n');
}

export function runOrphanDigest(cfg = {}, runtime = resolveCompilerRuntime(cfg?.paths || {})) {
  const digestsDir = path.join(runtime.dataDir, 'digests');
  const manifestsDir = path.join(digestsDir, 'manifests');
  const latestIndexPath = path.join(digestsDir, 'latest-index.json');
  const reportsDir = runtime.reportsDir;
  fs.mkdirSync(reportsDir, { recursive: true });

  const action = String(cfg?.action || 'detect');
  const now = Date.now();
  const staleHours = Number(cfg?.staleHours || 48);
  const maxItems = Number(cfg?.maxItems || 200);
  const latestIndex = maybeReadJson(latestIndexPath) || {};
  const files = fs.existsSync(manifestsDir) ? fs.readdirSync(manifestsDir).filter(f => f.endsWith('.json')).sort() : [];
  const manifests = files.map(file => {
    const full = path.join(manifestsDir, file);
    const data = JSON.parse(fs.readFileSync(full, 'utf8'));
    return { file, path: full, data };
  });

  const staleCutoff = now - staleHours * 3600 * 1000;
  const findings = [];
  for (const entry of manifests) {
    const m = entry.data;
    const outputPath = path.join(runtime.workspaceDir, m.outputPath || '');
    const generatedTs = Date.parse(String(m.generatedAt || ''));
    const key = `${m.type}::${m.outputPath}`;
    const latestId = latestIndex[key] || null;
    const superseded = !!m.supersededBy || (latestId && latestId !== m.id);
    const outputExists = !!(m.outputPath && fs.existsSync(outputPath));
    const sourceRefs = Array.isArray(m.sourceRefs) ? m.sourceRefs : [];
    const trustedSources = sourceRefs.filter(ref => /^(sum:|file:|mem:)/.test(String(ref)));
    let kind = null;
    let reason = null;
    if (!outputExists) {
      kind = 'dangling-output';
      reason = 'manifest points to a missing digest artifact';
    } else if (!sourceRefs.length || !trustedSources.length) {
      kind = 'source-mismatch';
      reason = 'digest manifest is not anchored by trusted source refs';
    } else if (superseded && Number.isFinite(generatedTs) && generatedTs < staleCutoff) {
      kind = 'expired-superseded';
      reason = `superseded digest older than ${staleHours}h retention window`;
    }
    if (!kind) continue;
    findings.push({ id: m.id, type: m.type, title: m.title || null, outputPath: m.outputPath || null, manifestPath: path.relative(runtime.workspaceDir, entry.path), kind, reason, generatedAt: m.generatedAt || null, supersededBy: m.supersededBy || latestId || null, sourceRefsCount: sourceRefs.length, trustedSourceRefsCount: trustedSources.length, outputExists, latestIndexed: latestId === m.id });
  }

  const swept = [];
  if (action === 'sweep') {
    const sweepKinds = new Set(Array.isArray(cfg?.sweepKinds) && cfg.sweepKinds.length ? cfg.sweepKinds : ['expired-superseded', 'dangling-output']);
    for (const item of findings) {
      if (!sweepKinds.has(item.kind)) continue;
      const manifestFull = path.join(runtime.workspaceDir, item.manifestPath);
      if (fs.existsSync(manifestFull)) fs.renameSync(manifestFull, `${manifestFull}.swept`);
      if (item.kind === 'expired-superseded' && item.outputPath) {
        const outputFull = path.join(runtime.workspaceDir, item.outputPath);
        if (fs.existsSync(outputFull)) fs.renameSync(outputFull, `${outputFull}.swept`);
      }
      swept.push({ id: item.id, kind: item.kind, manifestPath: item.manifestPath, outputPath: item.outputPath || null });
    }
  }

  const summary = {
    totalFindings: findings.length,
    byKind: Object.fromEntries([...new Set(findings.map(x => x.kind))].map(kind => [kind, findings.filter(x => x.kind === kind).length])),
    swept: swept.length,
    sourceFirst: true,
    derivedNotAuthority: true,
  };
  const report = {
    ok: true,
    generatedAt: nowIso(),
    action,
    summary,
    findings: findings.slice(0, maxItems),
    evidencePaths: ['memory/compiler/digests/latest-index.json', 'memory/compiler/digests/manifests', 'memory/compiler/reports/orphan-digest.latest.json'],
  };
  const out = path.join(reportsDir, 'orphan-digest.latest.json');
  writeJson(out, report);
  return { ok: true, action, out, summary };
}

if (isDirectCli(import.meta.url)) {
  const arg = process.argv[2];
  if (!arg) usage();
  const cfg = readJsonInput(arg === '-' ? null : arg);
  printResult(runOrphanDigest(cfg));
}

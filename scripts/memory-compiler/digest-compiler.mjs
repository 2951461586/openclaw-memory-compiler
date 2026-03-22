#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { readJsonInput, printResult } from './lib/io.mjs';
import { readJsonl } from './lib/jsonl-store.mjs';
import { nowIso, uniq, hashId } from './lib/common.mjs';
import { assessSourceRefs } from './lib/source-discipline.mjs';
import { resolveCompilerRuntime, isDirectCli } from './lib/plugin-paths.mjs';

function usage() {
  console.error('Usage: node plugins/memory-compiler/scripts/memory-compiler/digest-compiler.mjs <input.json | ->');
  process.exit(2);
}

function ensureDir(p) { fs.mkdirSync(path.dirname(p), { recursive: true }); }
function writeFile(p, content) { ensureDir(p); fs.writeFileSync(p, content); }
function topN(arr, n) { return arr.slice(0, Math.max(0, n)); }
function fmtList(items) { return items.length ? items.map(x => `- ${x}`).join('\n') : '- （暂无）'; }
function sha1(s) { return crypto.createHash('sha1').update(s).digest('hex'); }
function intersects(a = [], b = []) { const bs = new Set(b); return a.some(x => bs.has(x)); }

const TRUSTED_PREFIXES = ['sum:', 'file:', 'mem:'];
function isTrustedRef(ref) { return TRUSTED_PREFIXES.some(p => String(ref).startsWith(p)); }
function trustedRefs(refs = []) { return uniq(refs.filter(isTrustedRef)); }

function hasTrustedSources(rec) { return assessSourceRefs(rec?.sourceRefs || []).hasTrusted; }
function liveContinuity(items) { return items.filter(x => !x.expiresAt && hasTrustedSources(x)); }
function activeThreads(items) { return items.filter(x => x.status === 'active' && hasTrustedSources(x)); }
function stableFacts(items) { return items.filter(x => x.status === 'confirmed' && hasTrustedSources(x)); }

export function loadDigestCompilerData(runtime = resolveCompilerRuntime()) {
  const compilerDir = runtime.dataDir;
  const factsPath = path.join(compilerDir, 'facts.jsonl');
  const threadsPath = path.join(compilerDir, 'threads.jsonl');
  const continuityPath = path.join(compilerDir, 'continuity.jsonl');
  return {
    facts: readJsonl(factsPath),
    threads: readJsonl(threadsPath),
    continuity: readJsonl(continuityPath),
  };
}

function sortFacts(facts) {
  return [...facts].sort((a, b) => {
    const sa = a.status === 'confirmed' ? 2 : a.status === 'inferred' ? 1 : 0;
    const sb = b.status === 'confirmed' ? 2 : b.status === 'inferred' ? 1 : 0;
    if (sb !== sa) return sb - sa;
    return Number(b.confidence || 0) - Number(a.confidence || 0);
  });
}
function sortThreads(threads) { return [...threads].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))); }
function sortContinuity(items) { return [...items].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))); }

export function compileTodayDigest({ facts, threads, continuity, payload, runtime = resolveCompilerRuntime() }) {
  const digestsDir = path.join(runtime.dataDir, 'digests');
  const date = payload.date || new Date().toISOString().slice(0, 10);
  const selectedFacts = topN(sortFacts(stableFacts(facts)), payload.maxFacts ?? 5);
  const selectedThreads = topN(sortThreads(activeThreads(threads)), payload.maxThreads ?? 5);
  const selectedContinuity = topN(sortContinuity(liveContinuity(continuity)), payload.maxContinuity ?? 2);
  const lines = [
    `# Today Digest — ${date}`,'',
    '## 当前主线', fmtList(selectedThreads.map(t => `${t.title}：${t.summary}`)),'',
    '## 当前连续状态', fmtList(selectedContinuity.map(c => `${c.focus}${c.nextActions?.length ? `；下一步：${c.nextActions.join('；')}` : ''}`)),'',
    '## 重要事实（薄片）', fmtList(selectedFacts.map(f => `${f.text} [${f.status}]`)),''];
  const refs = [...selectedFacts.flatMap(x=>x.sourceRefs||[]), ...selectedThreads.flatMap(x=>x.sourceRefs||[]), ...selectedContinuity.flatMap(x=>x.sourceRefs||[])];
  return { title:`Today Digest ${date}`, filename:path.join(digestsDir,'today',`${date}.md`), content:lines.join('\n'), sourceRefs:trustedRefs(refs), tokenEstimate:lines.join('\n').length/2 };
}
export function compileWeekDigest({ facts, threads, continuity, payload, runtime = resolveCompilerRuntime() }) {
  const digestsDir = path.join(runtime.dataDir, 'digests');
  const label = payload.week || `${new Date().getUTCFullYear()}-W${String(payload.weekNo || 0).padStart(2, '0')}`;
  const selectedFacts = topN(sortFacts(stableFacts(facts)), payload.maxFacts ?? 8);
  const selectedThreads = topN(sortThreads(activeThreads(threads)), payload.maxThreads ?? 8);
  const selectedContinuity = topN(sortContinuity(liveContinuity(continuity)), payload.maxContinuity ?? 3);
  const lines = [
    `# Week Digest — ${label}`,'',
    '## 本周活跃线程', fmtList(selectedThreads.map(t => `${t.title} [${t.status}]：${t.summary}`)),'',
    '## 本周关键连续状态', fmtList(selectedContinuity.map(c => `${c.focus}`)),'',
    '## 稳定事实', fmtList(selectedFacts.map(f => f.text)),''];
  const refs = [...selectedFacts.flatMap(x=>x.sourceRefs||[]), ...selectedThreads.flatMap(x=>x.sourceRefs||[]), ...selectedContinuity.flatMap(x=>x.sourceRefs||[])];
  return { title:`Week Digest ${label}`, filename:path.join(digestsDir,'week',`${label}.md`), content:lines.join('\n'), sourceRefs:trustedRefs(refs), tokenEstimate:lines.join('\n').length/2 };
}
export function compileNarrativeDigest({ facts, threads, continuity, payload, runtime = resolveCompilerRuntime() }) {
  const digestsDir = path.join(runtime.dataDir, 'digests');
  const selectedFacts = topN(sortFacts(stableFacts(facts)), payload.maxFacts ?? 10);
  const selectedThreads = topN(sortThreads(activeThreads(threads)), payload.maxThreads ?? 5);
  const selectedContinuity = topN(sortContinuity(liveContinuity(continuity)), payload.maxContinuity ?? 3);
  const lines = [
    '# Current Narrative','',
    '## 稳定背景', fmtList(selectedFacts.map(f => f.text)),'',
    '## 正在延续的主题', fmtList(selectedThreads.map(t => `${t.title}：${t.summary}`)),'',
    '## 当前工作连续性', fmtList(selectedContinuity.map(c => `${c.focus}${c.decisions?.length ? `；已定：${c.decisions.join('；')}` : ''}`)),''];
  const refs = [...selectedFacts.flatMap(x=>x.sourceRefs||[]), ...selectedThreads.flatMap(x=>x.sourceRefs||[]), ...selectedContinuity.flatMap(x=>x.sourceRefs||[])];
  return { title:'Current Narrative', filename:path.join(digestsDir,'narrative','current.md'), content:lines.join('\n'), sourceRefs:trustedRefs(refs), tokenEstimate:lines.join('\n').length/2 };
}

export function compileDigest(payload = {}, runtime = resolveCompilerRuntime()) {
  const root = runtime.workspaceDir;
  const digestsDir = path.join(runtime.dataDir, 'digests');
  const manifestsDir = path.join(digestsDir, 'manifests');
  const latestIndexPath = path.join(digestsDir, 'latest-index.json');
  const type = String(payload?.type || 'today');
  const generationStrategy = String(payload?.generationStrategy || `${type}-deterministic-v1`);
  const confidence = Number(payload?.confidence ?? 0.72);
  const changedSourceRefs = Array.isArray(payload?.changedSourceRefs) ? uniq(payload.changedSourceRefs) : [];
  const data = loadDigestCompilerData(runtime);

  let compiled;
  if (type === 'today') compiled = compileTodayDigest({ facts: data.facts, threads: data.threads, continuity: data.continuity, payload, runtime });
  else if (type === 'week') compiled = compileWeekDigest({ facts: data.facts, threads: data.threads, continuity: data.continuity, payload, runtime });
  else if (type === 'narrative') compiled = compileNarrativeDigest({ facts: data.facts, threads: data.threads, continuity: data.continuity, payload, runtime });
  else throw new Error(`Unsupported digest type: ${type}`);

  const contentHash = sha1(compiled.content);
  const sourceHash = sha1(JSON.stringify([...compiled.sourceRefs].sort()));
  let latestIndex = {};
  if (fs.existsSync(latestIndexPath)) latestIndex = JSON.parse(fs.readFileSync(latestIndexPath, 'utf8'));
  const latestKey = `${type}::${path.relative(root, compiled.filename)}`;
  const latestId = latestIndex[latestKey];
  let latest = null;
  if (latestId) {
    const latestPath = path.join(manifestsDir, `${latestId}.json`);
    if (fs.existsSync(latestPath)) latest = JSON.parse(fs.readFileSync(latestPath, 'utf8'));
  }

  if (latest && changedSourceRefs.length > 0 && !payload.forceChangedSourceCompile) {
    if (!intersects(changedSourceRefs, compiled.sourceRefs) && !intersects(changedSourceRefs, latest.sourceRefs || [])) {
      return { ok: true, type, skipped: true, reason: 'no-source-impact', latestManifestId: latest.id, outputPath: compiled.filename, changedSourceRefsCount: changedSourceRefs.length };
    }
  }

  if (latest && latest.contentHash === contentHash && latest.sourceHash === sourceHash) {
    return { ok: true, type, skipped: true, reason: 'unchanged-content', latestManifestId: latest.id, outputPath: compiled.filename };
  }

  writeFile(compiled.filename, compiled.content + '\n');
  const manifestId = hashId('digest', [type, compiled.filename, nowIso()]);
  const manifest = {
    id: manifestId,
    type,
    title: compiled.title,
    outputPath: path.relative(root, compiled.filename),
    sourceRefs: compiled.sourceRefs,
    generatedAt: nowIso(),
    generationStrategy,
    confidence,
    tokenEstimate: Math.round(compiled.tokenEstimate),
    contentHash,
    sourceHash,
    supersedes: latestId || null,
    changedSourceRefsCount: changedSourceRefs.length
  };
  const manifestPath = path.join(manifestsDir, `${manifestId}.json`);
  writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  latestIndex[latestKey] = manifestId;
  writeFile(latestIndexPath, JSON.stringify(latestIndex, null, 2) + '\n');
  return { ok: true, type, skipped: false, outputPath: compiled.filename, manifestPath, sourceRefs: compiled.sourceRefs.length, changedSourceRefsCount: changedSourceRefs.length, manifestId };
}

if (isDirectCli(import.meta.url)) {
  const arg = process.argv[2];
  if (!arg) usage();
  const payload = readJsonInput(arg === '-' ? null : arg);
  try {
    printResult(compileDigest(payload));
  } catch (err) {
    console.error(err.message || String(err));
    process.exit(2);
  }
}

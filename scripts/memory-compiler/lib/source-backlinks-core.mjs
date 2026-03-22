import fs from 'fs';
import path from 'path';
import { readJsonl, ensureParent } from './jsonl-store.mjs';
import { uniq, nowIso } from './common.mjs';

function readJsonIfExists(filePath) {
  try { return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : null; } catch { return null; }
}
function listJson(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath).filter(x => x.endsWith('.json')).sort().map(name => ({ name, abs: path.join(dirPath, name) }));
}
function normalizeArtifactEntry(kind, rec, meta = {}) {
  const sourceRefs = uniq(rec?.sourceRefs || meta.sourceRefs || []);
  if (!sourceRefs.length) return null;
  return {
    artifactKind: kind,
    artifactId: rec?.id || meta.id || null,
    title:
      meta.title
      || rec?.title
      || rec?.focus
      || rec?.text
      || rec?.summary
      || rec?.outputPath
      || rec?.factId
      || rec?.reason
      || kind,
    status: rec?.status || rec?.lifecycleState || meta.status || null,
    generatedAt:
      rec?.generatedAt
      || rec?.updatedAt
      || rec?.createdAt
      || rec?.lifecycleAt
      || rec?.resolvedAt
      || meta.generatedAt
      || null,
    outputPath: rec?.outputPath || meta.outputPath || null,
    sessionKey: rec?.sessionKey || meta.sessionKey || null,
    reviewType: rec?.reviewType || null,
    sourceRefs,
  };
}

export function collectCompilerArtifacts(root, paths = null) {
  const compilerDir = paths?.dataDir || path.join(root, 'memory', 'compiler');
  const digestsDir = path.join(compilerDir, 'digests');
  const manifestsDir = path.join(digestsDir, 'manifests');
  const packsDir = path.join(compilerDir, 'session-packs');
  const handoffsDir = path.join(packsDir, 'handoffs');
  const artifacts = [];

  for (const rec of readJsonl(path.join(compilerDir, 'facts.jsonl'))) {
    const item = normalizeArtifactEntry('fact', rec, { title: rec.text, status: rec.status });
    if (item) artifacts.push(item);
  }
  for (const rec of readJsonl(path.join(compilerDir, 'threads.jsonl'))) {
    const item = normalizeArtifactEntry('thread', rec, { title: rec.title, status: rec.status });
    if (item) artifacts.push(item);
  }
  for (const rec of readJsonl(path.join(compilerDir, 'continuity.jsonl'))) {
    const item = normalizeArtifactEntry('continuity', rec, { title: rec.focus, status: rec.status || 'live' });
    if (item) artifacts.push(item);
  }
  for (const rec of readJsonl(path.join(compilerDir, 'review-queue.jsonl'))) {
    const item = normalizeArtifactEntry('review-item', rec, { title: rec.title || rec.factId || rec.reviewType, status: rec.status });
    if (item) artifacts.push(item);
  }
  for (const rec of listJson(manifestsDir).map(x => readJsonIfExists(x.abs)).filter(Boolean)) {
    const item = normalizeArtifactEntry('digest-manifest', rec, { title: `${rec.type || 'digest'}:${rec.outputPath || rec.id || 'manifest'}`, outputPath: rec.outputPath || null, status: rec.type || 'digest' });
    if (item) artifacts.push(item);
  }
  const currentPack = readJsonIfExists(path.join(packsDir, 'current.json'));
  if (currentPack) {
    const item = normalizeArtifactEntry('session-pack', currentPack, { title: currentPack.focus || currentPack.id, status: currentPack.status || currentPack.lifecycleState || 'active', sessionKey: currentPack.sessionKey || null });
    if (item) artifacts.push(item);
  }
  for (const rec of readJsonl(path.join(packsDir, 'history.jsonl'))) {
    const item = normalizeArtifactEntry('session-pack-history', rec, { title: rec.focus || rec.id, status: rec.status || rec.lifecycleEvent || rec.lifecycleState || 'archived', sessionKey: rec.sessionKey || null });
    if (item) artifacts.push(item);
  }
  for (const rec of listJson(handoffsDir).map(x => readJsonIfExists(x.abs)).filter(Boolean)) {
    const item = normalizeArtifactEntry('session-handoff', rec, { title: rec.focus || rec.id, status: rec.status || rec.reason || 'handoff', sessionKey: rec.sessionKey || null });
    if (item) artifacts.push(item);
  }

  return artifacts;
}

function sourceKindFromRef(ref) {
  if (String(ref).startsWith('sum:')) return 'lcm-summary';
  if (String(ref).startsWith('msg:')) return 'lcm-message';
  if (String(ref).startsWith('session:')) return 'session';
  if (String(ref).startsWith('file:')) return 'file';
  if (String(ref).startsWith('mem:')) return 'memory-item';
  if (String(ref).startsWith('artifact:')) return 'artifact';
  return 'other';
}

export function buildSourceBacklinks({ root, includeKinds = ['lcm-summary', 'lcm-message', 'file', 'memory-item', 'session'], paths = null } = {}) {
  const artifacts = collectCompilerArtifacts(root, paths);
  const bySource = new Map();
  for (const art of artifacts) {
    for (const sourceRef of art.sourceRefs || []) {
      const sourceKind = sourceKindFromRef(sourceRef);
      if (includeKinds.length && !includeKinds.includes(sourceKind)) continue;
      if (!bySource.has(sourceRef)) bySource.set(sourceRef, []);
      bySource.get(sourceRef).push({
        artifactKind: art.artifactKind,
        artifactId: art.artifactId,
        title: art.title,
        status: art.status,
        generatedAt: art.generatedAt,
        outputPath: art.outputPath,
        sessionKey: art.sessionKey,
        reviewType: art.reviewType || null,
      });
    }
  }

  const sources = [...bySource.entries()].map(([sourceRef, backlinks]) => {
    const sourceKind = sourceKindFromRef(sourceRef);
    const sourceId = sourceRef.includes(':') ? sourceRef.slice(sourceRef.indexOf(':') + 1) : sourceRef;
    const sorted = backlinks.slice().sort((a, b) => String(b.generatedAt || '').localeCompare(String(a.generatedAt || '')) || String(a.artifactKind).localeCompare(String(b.artifactKind)));
    const byKind = sorted.reduce((acc, item) => {
      acc[item.artifactKind] = (acc[item.artifactKind] || 0) + 1;
      return acc;
    }, {});
    return {
      sourceRef,
      sourceKind,
      sourceId,
      totalBacklinks: sorted.length,
      byKind,
      latestGeneratedAt: sorted[0]?.generatedAt || null,
      backlinks: sorted,
    };
  }).sort((a, b) => String(b.latestGeneratedAt || '').localeCompare(String(a.latestGeneratedAt || '')) || String(a.sourceRef).localeCompare(String(b.sourceRef)));

  return {
    generatedAt: nowIso(),
    totalArtifacts: artifacts.length,
    totalSources: sources.length,
    kinds: Object.fromEntries(includeKinds.map(kind => [kind, sources.filter(x => x.sourceKind === kind).length])),
    sources,
  };
}

function sourceDirName(sourceKind) {
  if (sourceKind === 'lcm-summary') return 'lcm-summary';
  if (sourceKind === 'lcm-message') return 'lcm-message';
  return sourceKind;
}

function renderSourceMarkdown(entry) {
  const lines = [
    `# Source Backlinks — ${entry.sourceRef}`,
    '',
    `- Source kind: ${entry.sourceKind}`,
    `- Total backlinks: ${entry.totalBacklinks}`,
    entry.latestGeneratedAt ? `- Latest generatedAt: ${entry.latestGeneratedAt}` : null,
    '',
    '## Backlinks',
    ...entry.backlinks.map((item, idx) => {
      const meta = [
        item.status ? `status=${item.status}` : null,
        item.reviewType ? `reviewType=${item.reviewType}` : null,
        item.sessionKey ? `sessionKey=${item.sessionKey}` : null,
        item.outputPath ? `outputPath=${item.outputPath}` : null,
        item.generatedAt ? `generatedAt=${item.generatedAt}` : null,
      ].filter(Boolean).join(' | ');
      return `${idx + 1}. [${item.artifactKind}] ${item.title || item.artifactId || 'untitled'}${meta ? ` — ${meta}` : ''}`;
    }),
  ].filter(Boolean);
  return lines.join('\n') + '\n';
}

export function writeSourceBacklinks({ root, data, paths = null }) {
  const compilerDir = paths?.dataDir || path.join(root, 'memory', 'compiler');
  const baseDir = path.join(compilerDir, 'source-links');
  const reportDir = path.join(compilerDir, 'reports');
  fs.mkdirSync(baseDir, { recursive: true });
  fs.mkdirSync(reportDir, { recursive: true });
  const indexPath = path.join(baseDir, 'index.json');
  fs.writeFileSync(indexPath, JSON.stringify(data, null, 2) + '\n');

  const written = [];
  for (const entry of data.sources) {
    const dir = path.join(baseDir, sourceDirName(entry.sourceKind));
    const jsonPath = path.join(dir, `${entry.sourceId}.json`);
    const mdPath = path.join(dir, `${entry.sourceId}.md`);
    ensureParent(jsonPath);
    fs.writeFileSync(jsonPath, JSON.stringify(entry, null, 2) + '\n');
    fs.writeFileSync(mdPath, renderSourceMarkdown(entry));
    written.push({ sourceRef: entry.sourceRef, jsonPath, mdPath });
  }

  const latestReportPath = path.join(reportDir, 'source-backlinks.latest.json');
  const report = {
    ok: true,
    generatedAt: data.generatedAt,
    totalArtifacts: data.totalArtifacts,
    totalSources: data.totalSources,
    kinds: data.kinds,
    indexPath,
    sample: written.slice(0, 10),
  };
  fs.writeFileSync(latestReportPath, JSON.stringify(report, null, 2) + '\n');
  return { ...report, writtenCount: written.length };
}

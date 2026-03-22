#!/usr/bin/env node
import path from 'node:path';
import { readJsonInput, printResult } from './lib/io.mjs';
import { readJsonl, writeJsonl } from './lib/jsonl-store.mjs';
import { uniq, nowIso } from './lib/common.mjs';

const root = process.cwd();
const compilerDir = path.join(root, 'memory', 'compiler');
const threadsPath = path.join(compilerDir, 'threads.jsonl');
const archivePath = path.join(compilerDir, 'threads.archive.jsonl');

function usage() {
  console.error('Usage: node plugins/memory-compiler/scripts/memory-compiler/thread-lifecycle.mjs <actions.json | ->');
  process.exit(2);
}

const arg = process.argv[2];
if (!arg) usage();
const payload = readJsonInput(arg === '-' ? null : arg);
const actions = Array.isArray(payload?.actions) ? payload.actions : [];
const records = readJsonl(threadsPath);
const archiveRecords = readJsonl(archivePath);
const byId = new Map(records.map(r => [r.id, r]));
const archiveById = new Map(archiveRecords.map(r => [r.id, r]));
const now = nowIso();
let changed = 0;
const archivedIds = [];

for (const action of actions) {
  const kind = String(action.kind || '').trim();
  if (kind === 'close') {
    const t = byId.get(action.threadId);
    if (!t) continue;
    t.status = 'closed';
    t.closedAt = now;
    t.updatedAt = now;
    if (action.summarySuffix) t.summary = `${t.summary} ${action.summarySuffix}`.trim();
    changed++;
  } else if (kind === 'close-stale') {
    const minHours = Number(action.minStaleHours || action.closeAfterHours || 168);
    for (const t of records) {
      if (t.status !== 'stale') continue;
      const staledTs = Date.parse(String(t.staledAt || t.updatedAt || ''));
      if (!staledTs) continue;
      if ((Date.now() - staledTs) / 3600_000 < minHours) continue;
      t.status = 'closed';
      t.closedAt = now;
      t.updatedAt = now;
      changed++;
    }
  } else if (kind === 'archive') {
    const t = byId.get(action.threadId);
    if (!t) continue;
    if (!archiveById.has(t.id)) {
      archiveRecords.push({ ...t, archivedAt: now, archiveReason: action.reason || 'manual-archive' });
      archiveById.set(t.id, true);
    }
    archivedIds.push(t.id);
    changed++;
  } else if (kind === 'block') {
    const t = byId.get(action.threadId);
    if (!t) continue;
    t.status = 'blocked';
    t.blockedAt = now;
    t.blockReason = action.reason || null;
    t.updatedAt = now;
    changed++;
  } else if (kind === 'reopen') {
    const t = byId.get(action.threadId);
    if (!t) continue;
    t.status = 'active';
    t.reopenedAt = now;
    t.updatedAt = now;
    changed++;
  } else if (kind === 'merge-into-target') {
    const source = byId.get(action.sourceThreadId);
    const target = byId.get(action.targetThreadId);
    if (!source || !target || source.id === target.id) continue;
    target.sourceRefs = uniq([...(target.sourceRefs || []), ...(source.sourceRefs || []), ...(action.sourceRefs || [])]);
    target.relatedFacts = uniq([...(target.relatedFacts || []), ...(source.relatedFacts || [])]);
    target.summary = uniq([target.summary, source.summary, action.note].filter(Boolean)).join(' | ');
    target.updatedAt = now;
    source.status = 'closed';
    source.closedAt = now;
    source.updatedAt = now;
    source.mergedInto = target.id;
    changed += 2;
  }
}

const keptRecords = records.filter(r => !archivedIds.includes(r.id));
writeJsonl(threadsPath, keptRecords.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))));
writeJsonl(archivePath, archiveRecords.sort((a, b) => String(b.archivedAt || b.closedAt || b.updatedAt || '').localeCompare(String(a.archivedAt || a.closedAt || a.updatedAt || ''))));
printResult({ ok: true, changed, total: keptRecords.length, archived: archivedIds.length, archivedIds, path: threadsPath, archivePath });

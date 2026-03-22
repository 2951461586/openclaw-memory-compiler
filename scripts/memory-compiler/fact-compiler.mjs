#!/usr/bin/env node
import path from 'path';
import { readJsonInput, printResult } from './lib/io.mjs';
import { readJsonl, writeJsonl } from './lib/jsonl-store.mjs';
import { nowIso, hashId, uniq, normalizeText, mergeConfidence, chooseStatus } from './lib/common.mjs';
import { assessSourceRefs } from './lib/source-discipline.mjs';
import { resolveCompilerRuntime, isDirectCli } from './lib/plugin-paths.mjs';

function usage() {
  console.error('Usage: node plugins/memory-compiler/scripts/memory-compiler/fact-compiler.mjs <input.json | ->');
  process.exit(2);
}

function buildKey(scope, subject, attribute, value, text) {
  if (subject && attribute && value != null && String(value).trim() !== '') {
    return `${scope}::${normalizeText(subject)}::${normalizeText(attribute)}::${normalizeText(value)}`;
  }
  if (subject && attribute) return `${scope}::${normalizeText(subject)}::${normalizeText(attribute)}::${normalizeText(text)}`;
  return `${scope}::${normalizeText(text)}`;
}

export function compileFacts(payload = {}, runtime = resolveCompilerRuntime()) {
  const factsPath = path.join(runtime.dataDir, 'facts.jsonl');
  const candidates = Array.isArray(payload?.facts) ? payload.facts : [];
  if (candidates.length === 0) {
    return { ok: true, created: 0, updated: 0, total: readJsonl(factsPath).length, note: 'no fact candidates' };
  }

  const existing = readJsonl(factsPath);
  const byKey = new Map();
  const records = [...existing];
  for (const rec of existing) {
    const key = buildKey(rec.scope, rec.subject, rec.attribute, rec.value, rec.text);
    byKey.set(key, rec);
  }

  let created = 0;
  let updated = 0;
  let gated = 0;
  const now = nowIso();

  for (const raw of candidates) {
    const text = String(raw?.text || '').trim();
    const scope = String(raw?.scope || 'project');
    const subject = raw?.subject ? String(raw.subject).trim() : null;
    const attribute = raw?.attribute ? String(raw.attribute).trim() : null;
    const value = raw?.value != null ? String(raw.value) : null;
    if (!text) continue;
    const key = buildKey(scope, subject, attribute, value, text);
    const sourceRefs = uniq(raw?.sourceRefs || []);
    const requestedStatus = String(raw?.status || 'inferred');
    const discipline = assessSourceRefs(sourceRefs);
    const status = requestedStatus === 'confirmed' && !discipline.hasTrusted ? 'inferred' : requestedStatus;
    if (status !== requestedStatus) gated++;
    const confidence = Number(raw?.confidence ?? (status === 'confirmed' ? 0.9 : 0.6));
    const tags = uniq(raw?.tags || []);

    const existingRec = byKey.get(key);
    if (!existingRec) {
      const rec = {
        id: raw?.id || hashId('fact', [scope, subject || '', attribute || '', value ?? '', text]),
        scope,
        subject,
        attribute,
        value,
        text,
        status,
        tags,
        sourceRefs,
        firstSeenAt: raw?.firstSeenAt || now,
        lastConfirmedAt: status === 'confirmed' ? (raw?.lastConfirmedAt || now) : (raw?.lastConfirmedAt || null),
        expiresAt: raw?.expiresAt || null,
        confidence,
        supersedes: raw?.supersedes || null,
        sourceDisciplineState: discipline.hasTrusted ? 'trusted' : 'untrusted-gated'
      };
      if (!discipline.hasTrusted && requestedStatus === 'confirmed') {
        rec.sourceDisciplineReason = 'confirmed-downgraded-at-ingest';
        rec.sourceDisciplineGatedAt = now;
      }
      records.push(rec);
      byKey.set(key, rec);
      created++;
      continue;
    }

    existingRec.status = chooseStatus(existingRec.status, status);
    existingRec.tags = uniq([...(existingRec.tags || []), ...tags]);
    existingRec.sourceRefs = uniq([...(existingRec.sourceRefs || []), ...sourceRefs]);
    existingRec.confidence = mergeConfidence(existingRec.confidence, confidence);
    if (subject && !existingRec.subject) existingRec.subject = subject;
    if (attribute && !existingRec.attribute) existingRec.attribute = attribute;
    if (value != null) existingRec.value = value;
    if (status === 'confirmed') existingRec.lastConfirmedAt = now;
    if (raw?.expiresAt) existingRec.expiresAt = raw.expiresAt;
    if (raw?.supersedes) existingRec.supersedes = raw.supersedes;
    existingRec.sourceDisciplineState = assessSourceRefs(existingRec.sourceRefs).hasTrusted ? 'trusted' : 'untrusted-gated';
    if (!discipline.hasTrusted && requestedStatus === 'confirmed') {
      existingRec.sourceDisciplineReason = 'confirmed-downgraded-at-ingest';
      existingRec.sourceDisciplineGatedAt = now;
    }
    updated++;
  }

  records.sort((a, b) => String(b.lastConfirmedAt || b.firstSeenAt).localeCompare(String(a.lastConfirmedAt || a.firstSeenAt)));
  writeJsonl(factsPath, records);
  return { ok: true, created, updated, gated, total: records.length, path: factsPath };
}

if (isDirectCli(import.meta.url)) {
  const arg = process.argv[2];
  if (!arg) usage();
  const payload = readJsonInput(arg === '-' ? null : arg);
  printResult(compileFacts(payload));
}

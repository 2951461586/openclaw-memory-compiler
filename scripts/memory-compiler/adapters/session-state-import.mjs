#!/usr/bin/env node
import { readJsonInput, printResult } from '../lib/io.mjs';
import { uniq } from '../lib/common.mjs';

function usage() {
  console.error('Usage: node plugins/memory-compiler/scripts/memory-compiler/adapters/session-state-import.mjs <session-state.json | ->');
  process.exit(2);
}

const arg = process.argv[2];
if (!arg) usage();
const payload = readJsonInput(arg === '-' ? null : arg);
const sourceRef = payload?.filePath ? `file:${payload.filePath}` : 'file:/root/.openclaw/workspace/SESSION-STATE.md';
const scope = payload?.scope || 'project';
const facts = [];
const threads = [];
const continuity = [];

for (const item of payload?.confirmedFacts || []) {
  facts.push({
    scope: item.scope || scope,
    subject: item.subject || null,
    attribute: item.attribute || null,
    value: item.value ?? null,
    text: item.text,
    status: 'confirmed',
    tags: uniq(item.tags || []),
    sourceRefs: uniq([...(item.sourceRefs || []), sourceRef]),
    confidence: item.confidence ?? 0.92,
  });
}
for (const item of payload?.inferredFacts || []) {
  facts.push({
    scope: item.scope || scope,
    subject: item.subject || null,
    attribute: item.attribute || null,
    value: item.value ?? null,
    text: item.text,
    status: 'inferred',
    tags: uniq(item.tags || []),
    sourceRefs: uniq([...(item.sourceRefs || []), sourceRef]),
    confidence: item.confidence ?? 0.7,
  });
}
for (const item of payload?.activeThreads || []) {
  threads.push({
    title: item.title,
    scope: item.scope || scope,
    status: item.status || 'active',
    summary: item.summary || item.title,
    sourceRefs: uniq([...(item.sourceRefs || []), sourceRef]),
    relatedFacts: uniq(item.relatedFacts || []),
    nextStepHint: item.nextStepHint || null,
    priority: item.priority ?? null,
    owner: item.owner || null,
    staleAfterHours: item.staleAfterHours ?? 48,
  });
}
if (payload?.continuityFocus) {
  continuity.push({
    focus: payload.continuityFocus,
    decisions: uniq(payload?.decisions || []),
    risks: uniq(payload?.risks || []),
    nextActions: uniq(payload?.nextActions || []),
    relatedThreads: uniq(payload?.relatedThreads || []),
    sourceRefs: uniq([...(payload?.sourceRefs || []), sourceRef]),
  });
}

printResult({
  date: payload?.date || null,
  week: payload?.week || null,
  facts,
  threads,
  continuity,
  meta: {
    adapter: 'session-state-import',
    filePath: payload?.filePath || '/root/.openclaw/workspace/SESSION-STATE.md',
  },
});

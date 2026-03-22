#!/usr/bin/env node
import { readJsonInput, printResult } from './lib/io.mjs';
import { uniq } from './lib/common.mjs';

function usage() {
  console.error('Usage: node plugins/memory-compiler/scripts/memory-compiler/ingest-normalize.mjs <raw-input.json | ->');
  process.exit(2);
}

const arg = process.argv[2];
if (!arg) usage();
const payload = readJsonInput(arg === '-' ? null : arg);

const sourceRefs = uniq(payload?.sourceRefs || []);
const facts = [];
const threads = [];
const continuity = [];

for (const item of payload?.confirmedFacts || []) {
  facts.push({
    scope: item.scope || 'project',
    subject: item.subject || null,
    attribute: item.attribute || null,
    value: item.value ?? null,
    text: item.text,
    status: 'confirmed',
    tags: uniq(item.tags || []),
    sourceRefs: uniq([...(item.sourceRefs || []), ...sourceRefs]),
    confidence: item.confidence ?? 0.92
  });
}

for (const item of payload?.inferredFacts || []) {
  facts.push({
    scope: item.scope || 'project',
    subject: item.subject || null,
    attribute: item.attribute || null,
    value: item.value ?? null,
    text: item.text,
    status: 'inferred',
    tags: uniq(item.tags || []),
    sourceRefs: uniq([...(item.sourceRefs || []), ...sourceRefs]),
    confidence: item.confidence ?? 0.65
  });
}

for (const item of payload?.activeThreads || []) {
  threads.push({
    title: item.title,
    scope: item.scope || 'project',
    status: item.status || 'active',
    summary: item.summary || item.title,
    sourceRefs: uniq([...(item.sourceRefs || []), ...sourceRefs]),
    relatedFacts: uniq(item.relatedFacts || []),
    nextStepHint: item.nextStepHint || null,
    priority: item.priority ?? null,
    owner: item.owner || null,
    staleAfterHours: item.staleAfterHours ?? 72
  });
}

if (payload?.continuityFocus) {
  continuity.push({
    focus: payload.continuityFocus,
    decisions: uniq(payload?.decisions || []),
    risks: uniq(payload?.risks || []),
    nextActions: uniq(payload?.nextActions || []),
    relatedThreads: uniq(payload?.relatedThreads || []),
    sourceRefs
  });
}

printResult({
  date: payload?.date || null,
  week: payload?.week || null,
  facts,
  threads,
  continuity,
  meta: payload?.meta || {}
});

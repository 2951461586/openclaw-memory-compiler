#!/usr/bin/env node
import { readJsonInput, printResult } from '../lib/io.mjs';
import { uniq } from '../lib/common.mjs';

function usage() {
  console.error('Usage: node plugins/memory-compiler/scripts/memory-compiler/adapters/lancedb-memory-import.mjs <memory-export.json | ->');
  process.exit(2);
}

const arg = process.argv[2];
if (!arg) usage();
const payload = readJsonInput(arg === '-' ? null : arg);
const memories = Array.isArray(payload?.memories) ? payload.memories : [];
const facts = [];

for (const m of memories) {
  // Canonicalize durable memory refs to mem:<id> (plugin id stays in payload/plugin metadata)
  // This keeps runtime selection / source discipline simple and avoids plugin-scoped ref shapes.
  const sourceRef = m.id ? `mem:${m.id}` : null;
  const category = String(m.category || 'other');
  let scope = 'project';
  if (category === 'preference' || category === 'entity') scope = 'user';
  else if (category === 'fact') scope = 'system';
  else if (category === 'decision') scope = 'project';
  facts.push({
    scope,
    subject: m.subject || null,
    attribute: m.attribute || null,
    value: m.value ?? null,
    text: m.text,
    status: m.confirmed ? 'confirmed' : 'inferred',
    tags: uniq([category, ...(m.tags || [])]),
    sourceRefs: uniq([...(m.sourceRefs || []), ...(sourceRef ? [sourceRef] : [])]),
    confidence: m.confidence ?? (m.confirmed ? 0.85 : 0.62)
  });
}

printResult({ date: payload?.date || null, week: payload?.week || null, facts, threads: [], continuity: [], meta: { adapter: 'lancedb-memory-import' } });

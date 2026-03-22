#!/usr/bin/env node
import { readJsonInput, printResult } from '../lib/io.mjs';
import { uniq } from '../lib/common.mjs';

function usage() {
  console.error('Usage: node plugins/memory-compiler/scripts/memory-compiler/adapters/workspace-note-import.mjs <workspace-notes.json | ->');
  process.exit(2);
}

function fileRef(filePath) {
  return filePath ? `file:${filePath}` : null;
}

const arg = process.argv[2];
if (!arg) usage();
const payload = readJsonInput(arg === '-' ? null : arg);
const notes = Array.isArray(payload?.notes) ? payload.notes : [];

const facts = [];
const threads = [];
const continuity = [];

for (const note of notes) {
  const ref = fileRef(note.filePath || note.path || note.sourceFile);
  const noteRefs = uniq([...(note.sourceRefs || []), ...(ref ? [ref] : [])]);

  for (const f of note.confirmedFacts || []) {
    facts.push({
      scope: f.scope || note.scope || 'project',
      subject: f.subject || null,
      attribute: f.attribute || null,
      value: f.value ?? null,
      text: f.text,
      status: 'confirmed',
      tags: uniq([...(note.tags || []), ...(f.tags || [])]),
      sourceRefs: uniq([...(f.sourceRefs || []), ...noteRefs]),
      confidence: f.confidence ?? 0.9,
    });
  }

  for (const f of note.inferredFacts || []) {
    facts.push({
      scope: f.scope || note.scope || 'project',
      subject: f.subject || null,
      attribute: f.attribute || null,
      value: f.value ?? null,
      text: f.text,
      status: 'inferred',
      tags: uniq([...(note.tags || []), ...(f.tags || [])]),
      sourceRefs: uniq([...(f.sourceRefs || []), ...noteRefs]),
      confidence: f.confidence ?? 0.68,
    });
  }

  for (const t of note.activeThreads || []) {
    threads.push({
      title: t.title,
      scope: t.scope || note.scope || 'project',
      status: t.status || 'active',
      summary: t.summary || t.title,
      sourceRefs: uniq([...(t.sourceRefs || []), ...noteRefs]),
      relatedFacts: uniq(t.relatedFacts || []),
      nextStepHint: t.nextStepHint || null,
      priority: t.priority ?? null,
      owner: t.owner || null,
      staleAfterHours: t.staleAfterHours ?? 72,
    });
  }

  if (note.continuityFocus) {
    continuity.push({
      focus: note.continuityFocus,
      decisions: uniq(note.decisions || []),
      risks: uniq(note.risks || []),
      nextActions: uniq(note.nextActions || []),
      relatedThreads: uniq(note.relatedThreads || []),
      sourceRefs: noteRefs,
    });
  }
}

printResult({
  date: payload?.date || null,
  week: payload?.week || null,
  facts,
  threads,
  continuity,
  meta: {
    adapter: 'workspace-note-import',
    noteCount: notes.length,
  },
});

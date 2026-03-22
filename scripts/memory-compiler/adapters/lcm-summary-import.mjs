#!/usr/bin/env node
import { readJsonInput, printResult } from '../lib/io.mjs';
import { uniq } from '../lib/common.mjs';

function usage() {
  console.error('Usage: node plugins/memory-compiler/scripts/memory-compiler/adapters/lcm-summary-import.mjs <lcm-summaries.json | ->');
  process.exit(2);
}

const arg = process.argv[2];
if (!arg) usage();
const payload = readJsonInput(arg === '-' ? null : arg);
const summaries = Array.isArray(payload?.summaries) ? payload.summaries : [];

const facts = [];
const threads = [];
const continuity = [];

for (const s of summaries) {
  const ref = s.id ? `sum:${s.id}` : null;
  if (s.threadTitle) {
    threads.push({
      title: s.threadTitle,
      scope: s.scope || 'project',
      status: s.threadStatus || 'active',
      summary: s.threadSummary || s.summary || s.threadTitle,
      sourceRefs: uniq([...(s.sourceRefs || []), ...(ref ? [ref] : [])]),
      relatedFacts: uniq(s.relatedFacts || []),
      nextStepHint: s.nextStepHint || null,
      priority: s.priority ?? null,
      staleAfterHours: s.staleAfterHours ?? 72
    });
  }
  for (const f of s.confirmedFacts || []) {
    facts.push({
      scope: f.scope || s.scope || 'project',
      subject: f.subject || null,
      attribute: f.attribute || null,
      value: f.value ?? null,
      text: f.text,
      status: 'confirmed',
      tags: uniq(f.tags || []),
      sourceRefs: uniq([...(f.sourceRefs || []), ...(ref ? [ref] : [])]),
      confidence: f.confidence ?? 0.9
    });
  }
  if (s.focus) {
    continuity.push({
      focus: s.focus,
      decisions: uniq(s.decisions || []),
      risks: uniq(s.risks || []),
      nextActions: uniq(s.nextActions || []),
      relatedThreads: uniq(s.relatedThreads || []),
      sourceRefs: uniq([...(s.sourceRefs || []), ...(ref ? [ref] : [])])
    });
  }
}

printResult({ date: payload?.date || null, week: payload?.week || null, facts, threads, continuity, meta: { adapter: 'lcm-summary-import' } });

#!/usr/bin/env node
import { readJsonInput, printResult } from './lib/io.mjs';
import { uniq, hashId } from './lib/common.mjs';
import { assessSourceRefs } from './lib/source-discipline.mjs';

function usage() {
  console.error('Usage: node plugins/memory-compiler/scripts/memory-compiler/trigger-plan.mjs <bundle.json | ->');
  process.exit(2);
}

function yes(v) { return !!v; }
function tagsOf(x) { return Array.isArray(x?.tags) ? x.tags.map(String) : []; }
function hasAnyTag(x, tags) { const set = new Set(tagsOf(x)); return tags.some(t => set.has(t)); }
function trusted(x) { return assessSourceRefs(x?.sourceRefs || []).hasTrusted; }
function predictedFactId(fact) {
  return fact?.id || hashId('fact', [fact?.scope || 'project', fact?.subject || '', fact?.attribute || '', fact?.value ?? '', fact?.text || '']);
}

const arg = process.argv[2];
if (!arg) usage();
const payload = readJsonInput(arg === '-' ? null : arg);

const facts = Array.isArray(payload?.facts) ? payload.facts : [];
const threads = Array.isArray(payload?.threads) ? payload.threads : [];
const continuity = Array.isArray(payload?.continuity) ? payload.continuity : [];

const decisionFacts = facts.filter(f => hasAnyTag(f, ['decision', 'preference', 'policy']) || String(f?.status || '') === 'confirmed');
const riskyFacts = facts.filter(f => String(f?.status || '') === 'inferred' || String(f?.status || '') === 'disputed' || !trusted(f));
const milestoneThreads = threads.filter(t => hasAnyTag(t, ['milestone', 'release']) || /milestone|release|phase|阶段|里程碑/i.test(String(t?.title || '') + ' ' + String(t?.summary || '')));
const activeThreads = threads.filter(t => String(t?.status || 'active') === 'active');
const continuityHot = continuity.filter(c => (c?.nextActions || []).length > 0 || (c?.decisions || []).length > 0);

const changedSourceRefs = uniq([
  ...facts.flatMap(x => x.sourceRefs || []),
  ...threads.flatMap(x => x.sourceRefs || []),
  ...continuity.flatMap(x => x.sourceRefs || []),
]);

const compileToday = yes(decisionFacts.length || activeThreads.length || continuityHot.length);
const compileWeek = yes(decisionFacts.length || milestoneThreads.length);
const compileNarrative = yes(decisionFacts.length || activeThreads.length || continuityHot.length);
const runPipeline = yes(facts.length || threads.length || continuity.length);
const reviewNeeded = yes(riskyFacts.length || threads.some(t => !trusted(t) && String(t?.status || 'active') === 'active'));

const reviewItems = [];
for (const fact of riskyFacts) {
  const status = String(fact?.status || '');
  const untrusted = !trusted(fact);
  reviewItems.push({
    kind: 'fact',
    reviewType: status === 'disputed' ? 'dispute-review' : 'promotion-review',
    targetState: status === 'disputed' ? 'resolved' : 'confirmed',
    suggestedDecision: status === 'disputed' ? 'dispute' : 'promote',
    factId: predictedFactId(fact),
    title: fact.text || `${fact.subject || ''} ${fact.attribute || ''}`.trim(),
    reason: untrusted ? 'untrusted-source' : status || 'inferred',
    sourceRefs: fact.sourceRefs || [],
    scope: fact.scope || 'project',
    priority: status === 'disputed' ? 'high' : 'medium',
  });
}

const plan = {
  ok: true,
  summary: {
    facts: facts.length,
    threads: threads.length,
    continuity: continuity.length,
    decisionFacts: decisionFacts.length,
    riskyFacts: riskyFacts.length,
    activeThreads: activeThreads.length,
    continuityHot: continuityHot.length,
  },
  triggers: {
    runPipeline,
    compileToday,
    compileWeek,
    compileNarrative,
    reviewNeeded,
    autoDisputeConflicts: riskyFacts.some(f => String(f?.status || '') === 'disputed'),
    autoArbitrateDisputes: riskyFacts.some(f => String(f?.status || '') === 'disputed' && trusted(f)),
  },
  changedSourceRefs,
  reviewItems,
};

printResult(plan);

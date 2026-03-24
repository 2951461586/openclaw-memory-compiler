import fs from 'fs';
import path from 'path';
import { isoWeekLabel } from './common.mjs';
import { readJsonl } from './jsonl-store.mjs';
import { compilerDirFrom } from './plugin-paths.mjs';

import { isTrustedRef as isTrustedSourceRef } from './source-discipline.mjs';

function readTextIfExists(p){ return fs.existsSync(p) ? fs.readFileSync(p,'utf8') : null; }
function readJsonIfExists(p){ return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p,'utf8')) : null; }
function estTokens(text){ return Math.ceil(String(text || '').length / 4); }
function trustedRefCount(refs=[]){ return refs.filter(isTrustedSourceRef).length; }
function refBreakdown(refs=[]){
  const out = {
    totalRefs: refs.length,
    trustedRefs: 0,
    untrustedRefs: 0,
    sum: 0,
    sumTrusted: 0,
    sumUntrusted: 0,
    file: 0,
    mem: 0,
    session: 0,
    msg: 0,
    artifact: 0,
    other: 0,
  };
  for (const ref of refs) {
    const s = String(ref);
    if (s.startsWith('sum:')) {
      out.sum++;
      if (isTrustedSourceRef(ref)) { out.trustedRefs++; out.sumTrusted++; }
      else { out.untrustedRefs++; out.sumUntrusted++; }
    }
    else if (s.startsWith('file:')) { out.file++; out.trustedRefs++; }
    else if (s.startsWith('mem:')) { out.mem++; out.trustedRefs++; }
    else if (s.startsWith('session:')) out.session++;
    else if (s.startsWith('msg:')) out.msg++;
    else if (s.startsWith('artifact:')) out.artifact++;
    else out.other++;
  }
  return out;
}

function sceneSourceKindContract(scene) {
  const base = {
    contractVersion: 'source-kind-contract.v2',
    trustedSourceKinds: ['sum', 'file', 'mem'],
    sourceKinds: {
      sum: {
        label: 'lcm-summary',
        authorityWeight: 0.93,
        confidenceBias: 0.06,
        exactClaimUse: 'allowed-with-evidence-path',
      },
      file: {
        label: 'workspace-file',
        authorityWeight: 0.96,
        confidenceBias: 0.08,
        exactClaimUse: 'preferred-with-evidence-path',
      },
      mem: {
        label: 'durable-memory',
        authorityWeight: 0.84,
        confidenceBias: 0.03,
        exactClaimUse: 'allowed-for-stable-memory-with-evidence-path',
      },
      session: {
        label: 'session-derived',
        authorityWeight: 0.42,
        confidenceBias: -0.08,
        exactClaimUse: 'support-only',
      },
      msg: {
        label: 'lcm-message',
        authorityWeight: 0.72,
        confidenceBias: 0.01,
        exactClaimUse: 'allowed-when-expanded-to-source',
      },
      artifact: {
        label: 'derived-artifact',
        authorityWeight: 0.18,
        confidenceBias: -0.18,
        exactClaimUse: 'forbidden',
      },
      other: {
        label: 'other',
        authorityWeight: 0.12,
        confidenceBias: -0.2,
        exactClaimUse: 'forbidden',
      },
    },
  };
  if (scene === 'precise') {
    return {
      ...base,
      scene,
      authority: 'source-first',
      digestAuthority: 'forbidden',
      continuityAuthority: 'forbidden',
      sceneRule: 'precise-source-first',
      exactClaimRule: 'require-evidence-path',
      minAuthorityScore: 0.88,
      budgetBias: 'tight-source-first',
      escalationRule: 'source-required-when-trusted-coverage-thin',
      allowedKindsByBlock: {
        facts: ['sum', 'file', 'mem'],
        threads: ['sum', 'file', 'mem'],
        continuity: [],
        digests: [],
      },
    };
  }
  if (scene === 'task' || scene === 'session') {
    return {
      ...base,
      scene,
      authority: 'trusted-derived-with-source-backing',
      digestAuthority: 'support-only',
      continuityAuthority: 'trusted-only',
      sceneRule: scene === 'task' ? 'execution-support' : 'resume-support',
      exactClaimRule: 'precise-claims-still-source-first',
      minAuthorityScore: 0.58,
      budgetBias: 'mixed-trusted-support',
      escalationRule: 'tighten-when-derived-overweight',
      allowedKindsByBlock: {
        facts: ['sum', 'file', 'mem'],
        threads: ['sum', 'file', 'mem'],
        continuity: ['sum', 'file', 'mem', 'session'],
        digests: ['sum', 'file', 'mem'],
      },
    };
  }
  return {
    ...base,
    scene,
    authority: 'continuity-support',
    digestAuthority: 'support-only',
    continuityAuthority: 'trusted-only',
    sceneRule: scene === 'heartbeat' ? 'thin-signal' : 'light-chat-support',
    exactClaimRule: 'do-not-overstate-derived-context',
    minAuthorityScore: 0.46,
    budgetBias: 'light-continuity',
    escalationRule: 'escalate-precise-claims-only',
    allowedKindsByBlock: {
      facts: ['sum', 'file', 'mem'],
      threads: ['sum', 'file', 'mem'],
      continuity: ['sum', 'file', 'mem', 'session'],
      digests: ['sum', 'file', 'mem'],
    },
  };
}

function summarizeSourceMix(selected) {
  const contract = selected?.sourceKindContract || sceneSourceKindContract(selected?.scene || 'chat');
  const weights = Object.fromEntries(Object.entries(contract.sourceKinds || {}).map(([kind, meta]) => [kind, Number(meta.authorityWeight || 0)]));
  const kinds = {
    facts: coverageSummary(selected?.facts || []),
    threads: coverageSummary(selected?.threads || []),
    continuity: coverageSummary(selected?.continuity || []),
    digests: coverageSummary(selected?.digests || []),
  };
  const refKinds = ['sum', 'file', 'mem', 'session', 'msg', 'artifact', 'other'];
  const totals = ['facts', 'threads', 'continuity', 'digests'].reduce((acc, key) => {
    const part = kinds[key] || {};
    acc.totalRefs += Number(part.totalRefs || 0);
    acc.trustedRefs += Number(part.trustedRefs || 0);
    for (const kind of refKinds) acc[kind] += Number(part[kind] || 0);
    return acc;
  }, { totalRefs: 0, trustedRefs: 0, sum: 0, file: 0, mem: 0, session: 0, msg: 0, artifact: 0, other: 0 });
  const actualRefTotal = refKinds.reduce((sum, kind) => sum + Number(totals[kind] || 0), 0);
  const trustedSupport = Number(totals.sum || 0) + Number(totals.file || 0) + Number(totals.mem || 0);
  const supportingKinds = ['sum', 'file', 'mem'].filter(kind => Number(totals[kind] || 0) > 0);
  const weightedKinds = refKinds.reduce((sum, kind) => sum + (Number(totals[kind] || 0) * Number(weights[kind] || 0)), 0);
  const authorityScore = actualRefTotal > 0 ? Number((weightedKinds / actualRefTotal).toFixed(3)) : 0;
  const trustedRatio = actualRefTotal > 0 ? Number((trustedSupport / actualRefTotal).toFixed(3)) : 0;
  const derivedPressure = actualRefTotal > 0 ? Number((((Number(totals.session || 0) + Number(totals.msg || 0) + Number(totals.artifact || 0) + Number(totals.other || 0)) / actualRefTotal)).toFixed(3)) : 0;
  const artifactPressure = actualRefTotal > 0 ? Number((Number(totals.artifact || 0) / actualRefTotal).toFixed(3)) : 0;
  const dominantKind = Object.entries(Object.fromEntries(refKinds.map(kind => [kind, Number(totals[kind] || 0)]))).sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))[0]?.[0] || null;
  const sessionPressure = actualRefTotal > 0 ? Number(((Number(totals.session || 0) + Number(totals.msg || 0)) / actualRefTotal).toFixed(3)) : 0;
  const derivedHeavyKind = artifactPressure >= Math.max(0.18, sessionPressure) ? 'artifact-heavy' : (sessionPressure > 0 ? 'session-heavy' : 'mixed-derived');
  let coverageQuality = 'insufficient-trusted-support';
  if (trustedSupport > 0 && artifactPressure === 0 && authorityScore >= Number(contract.minAuthorityScore || 0)) coverageQuality = 'trusted-clean';
  else if (trustedSupport > 0 && authorityScore >= 0.55 && artifactPressure < 0.2) coverageQuality = 'trusted-mixed';
  else if (trustedSupport > 0) coverageQuality = derivedHeavyKind;
  return {
    byBlock: kinds,
    totals,
    supportingKinds,
    trustedSupport,
    trustedRatio,
    derivedPressure,
    artifactPressure,
    sessionPressure,
    derivedHeavyKind,
    authorityScore,
    dominantKind,
    coverageQuality,
    contractBias: contract.budgetBias || null,
    scoringVersion: 'runtime-source-mix.v2',
    scoringNotes: [
      'ratios now use actual source-kind refs only',
      'aggregate fields totalRefs/trustedRefs no longer dilute authority/trusted ratios',
      'supportingKinds remains trusted-source-only to reduce noisy conservative escalation',
      'derived-heavy is split into artifact-heavy vs session-heavy for finer runtime tightening',
    ],
  };
}
function loadLatestManifest(manifestsDir, latestIndexPath, type, outputPathRel){
  const latestIndex = readJsonIfExists(latestIndexPath) || {};
  const key = `${type}::${outputPathRel}`;
  const manifestId = latestIndex[key];
  if (!manifestId) return null;
  return readJsonIfExists(path.join(manifestsDir, `${manifestId}.json`));
}
function sourceScore(rec, preferred=[]){
  const refs = rec?.sourceRefs || [];
  let score = refs.length ? Math.min(refs.length, 4) : 0;
  preferred.forEach((p, i) => { if (refs.some(r => String(r).startsWith(p))) score += (preferred.length - i) * 10; });
  if (rec.subject && rec.attribute) score += 2;
  return score;
}
function qualityScore(rec, preferred=[]){
  let score = sourceScore(rec, preferred);
  score += Number(rec.confidence || 0) * 10;
  if (rec.status === 'confirmed') score += 8;
  else if (rec.status === 'inferred') score += 2;
  else if (rec.status === 'disputed') score -= 10;
  if ((rec.sourceRefs || []).some(r => String(r).startsWith('sum:'))) score += 5;
  if ((rec.sourceRefs || []).some(r => String(r).startsWith('file:'))) score += 4;
  if ((rec.sourceRefs || []).some(r => String(r).startsWith('mem:'))) score += 2;
  return Number(score.toFixed(2));
}
function attachQuality(list, preferred=[]){ return list.map(x => ({ ...x, qualityScore: qualityScore(x, preferred) })); }

const GENERIC_EN_QUERY_TERMS = new Set([
  'exact','precise','path','paths','sha','commit','timestamp','stack','config','command','commands','which','file','files','line','lines','number','source','first','traceback','log','logs','root','cause','answer','please','show','tell','what','where','why','how','does','did','the','that','this','with','from','into','flow'
]);
const GENERIC_CJK_QUERY_TERMS = new Set([
  '精确','准确','精确回答','源码','回源','路径','命令','配置','时间戳','堆栈','报错','根因','哪个文件','哪一行','哪行','日志','回答','到底','原因','问题','怎么','为何','为什么','继续推进'
]);
function uniqueStrings(list=[]) { return [...new Set(list.filter(Boolean))]; }
function extractQueryTerms(text='') {
  const raw = String(text || '').trim();
  if (!raw) return [];
  const en = (raw.toLowerCase().match(/[a-z0-9][a-z0-9._/-]{2,}/g) || [])
    .filter(term => !GENERIC_EN_QUERY_TERMS.has(term));
  const cjk = (raw.match(/[\u4e00-\u9fff]{2,8}/g) || [])
    .filter(term => !GENERIC_CJK_QUERY_TERMS.has(term));
  return uniqueStrings([...en, ...cjk]).slice(0, 8);
}
function recordSearchText(rec={}) {
  return [rec.title, rec.summary, rec.text, rec.subject, rec.attribute, rec.value, ...(rec.tags || [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}
function escapeRegex(text='') {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function looksOpaqueToken(value='') {
  const s = String(value || '').trim();
  if (!s) return false;
  if (/\s/.test(s)) return false;
  if (/[\u4e00-\u9fff]/.test(s)) return false;
  if (!/^[a-z0-9._:-]+$/i.test(s)) return false;
  return s.length >= 12;
}
function fieldMatchesTerm(text='', term='') {
  const hay = String(text || '').toLowerCase();
  const needle = String(term || '').toLowerCase().trim();
  if (!hay || !needle) return false;
  if (/^[a-z0-9._/-]{3,}$/i.test(needle)) {
    const safe = escapeRegex(needle);
    return new RegExp(`(^|[^a-z0-9])${safe}([^a-z0-9]|$)`, 'i').test(hay);
  }
  return hay.includes(needle);
}
function queryScore(rec, terms=[]) {
  if (!terms.length) return 0;
  const title = String(rec?.title || '').toLowerCase();
  const summary = String(rec?.summary || rec?.text || '').toLowerCase();
  const metaParts = [rec?.subject, rec?.attribute, ...(rec?.tags || [])];
  if (!looksOpaqueToken(rec?.value)) metaParts.push(rec?.value);
  const meta = metaParts.filter(Boolean).join(' ').toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (fieldMatchesTerm(title, term)) score += 8;
    if (fieldMatchesTerm(summary, term)) score += 6;
    if (fieldMatchesTerm(meta, term)) score += 4;
  }
  return score;
}
function pickPreciseScoped({ facts, threads, payload={}, preferred=[] }) {
  const queryTerms = extractQueryTerms(payload?.prompt || payload?.query || '');
  const diagnostics = {
    queryTerms,
    anchorMode: queryTerms.length ? 'query-anchored' : 'fallback-quality',
    matchedFacts: 0,
    matchedThreads: 0,
    anchorMiss: false,
    fallbackReason: queryTerms.length ? null : 'no-informative-query-terms',
  };
  if (!queryTerms.length) {
    return {
      facts: pickFacts(facts, payload.maxFacts ?? 2, ['confirmed'], preferred),
      threads: pickThreads(threads, payload.maxThreads ?? 1, ['active'], preferred),
      diagnostics,
    };
  }
  const rankedFacts = attachQuality(facts.filter(f => f.status === 'confirmed'), preferred)
    .map(rec => ({ ...rec, queryScore: queryScore(rec, queryTerms), searchText: undefined }))
    .filter(rec => rec.queryScore > 0)
    .sort((a, b) => b.queryScore - a.queryScore || b.qualityScore - a.qualityScore || Number(b.confidence || 0) - Number(a.confidence || 0));
  const rankedThreads = attachQuality(threads.filter(t => t.status === 'active'), preferred)
    .map(rec => ({ ...rec, queryScore: queryScore(rec, queryTerms), searchText: undefined }))
    .filter(rec => rec.queryScore > 0)
    .sort((a, b) => b.queryScore - a.queryScore || b.qualityScore - a.qualityScore || String(b.updatedAt).localeCompare(String(a.updatedAt)));
  diagnostics.matchedFacts = rankedFacts.length;
  diagnostics.matchedThreads = rankedThreads.length;
  if (!rankedFacts.length && !rankedThreads.length) {
    diagnostics.anchorMiss = true;
    diagnostics.fallbackReason = 'no-query-anchored-records';
    return { facts: [], threads: [], diagnostics };
  }
  return {
    facts: rankedFacts.slice(0, payload.maxFacts ?? 2),
    threads: rankedThreads.slice(0, payload.maxThreads ?? 1),
    diagnostics,
  };
}
function pickFacts(facts, limit, modes=['confirmed'], preferred=[]){
  return attachQuality(facts.filter(f => modes.includes(f.status)), preferred).sort((a,b)=> b.qualityScore - a.qualityScore || Number(b.confidence||0)-Number(a.confidence||0)).slice(0, limit);
}
function pickThreads(threads, limit, modes=['active'], preferred=[]){
  return attachQuality(threads.filter(t => modes.includes(t.status)), preferred).sort((a,b)=> b.qualityScore - a.qualityScore || String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, limit);
}
function pickContinuity(items, limit, preferred=[]){
  return attachQuality(items, preferred).sort((a,b)=> b.qualityScore - a.qualityScore || String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, limit);
}
function short(text,max){ return String(text||'').replace(/\n+/g,' ').slice(0,max); }
function buildSourceFirstPolicy(selected){
  const escalation = String(selected?.escalation || '');
  const sourceFirst = selected?.scene === 'precise' || escalation === 'source-first' || escalation.startsWith('source-');
  if (!sourceFirst) return null;
  const status = selected?.sourceFirstStatus || null;
  const lines = [
    '## Source-First Policy',
    '- This is a precise/source-first scene: verify against sourceRefs before answering.',
    '- Do not treat digest snippets or continuity notes as authority.',
    '- Prefer exact file/summary/memory references and call out missing source coverage instead of guessing.',
  ];
  if (status) {
    lines.push(`- Status: ${status.satisfied ? 'source-backed context available' : 'source backing insufficient, escalate before answering'}.`);
    lines.push(`- Trusted support: facts=${status.trustedFacts}, threads=${status.trustedThreads}, dropped=${status.droppedCount}.`);
  }
  if (selected?.recallPlan) {
    lines.push(`- Recall plan: ${selected.recallPlan.strategy}.`);
    if (selected.recallPlan.queryTerms?.length) lines.push(`- Query anchors: ${selected.recallPlan.queryTerms.join(', ')}.`);
    if (selected.recallPlan.actions?.length) lines.push(`- Next source steps: ${selected.recallPlan.actions.map(a => a.kind).join(' -> ')}.`);
  }
  if (selected?.scene === 'precise') {
    lines.push('- For exact paths, line numbers, commands, timestamps, SHAs, or root-cause claims: escalate to source immediately.');
  }
  return { kind: 'policy', priority: 0, text: lines.join('\n'), sourceRefs: [] };
}
function buildBlocks(selected){
  const blocks=[];
  const policyBlock = buildSourceFirstPolicy(selected);
  if (policyBlock) blocks.push(policyBlock);
  if(selected.facts.length) blocks.push({kind:'facts',priority:1,text:'## Stable Facts\n'+selected.facts.map(f=>`- ${f.text}`).join('\n'), sourceRefs:selected.facts.flatMap(x => x.sourceRefs || [])});
  if(selected.threads.length) blocks.push({kind:'threads',priority:2,text:'## Active Threads\n'+selected.threads.map(t=>`- ${t.title}: ${t.summary}`).join('\n'), sourceRefs:selected.threads.flatMap(x => x.sourceRefs || [])});
  if(selected.continuity.length) blocks.push({kind:'continuity',priority:3,text:'## Working Continuity\n'+selected.continuity.map(c=>`- ${c.focus}`).join('\n'), sourceRefs:selected.continuity.flatMap(x => x.sourceRefs || [])});
  if(selected.digests.length) blocks.push({kind:'digests',priority:4,text:'## Digest Snippets\n'+selected.digests.map(d=>`- [${d.type}] ${d.snippet}...`).join('\n'), sourceRefs:selected.digests.flatMap(x => x.sourceRefs || [])});
  return blocks.sort((a,b)=>a.priority-b.priority).map(b => ({ ...b, estTokens: estTokens(b.text), coverage: refBreakdown(b.sourceRefs || []) }));
}
function fitBlocks(blocks,maxChars,maxTokens){
  const included=[], omitted=[]; let usedChars=0, usedTokens=0;
  for(const block of blocks){
    const sizeChars=block.text.length+(included.length?2:0); const sizeTokens=block.estTokens;
    if(usedChars+sizeChars<=maxChars && usedTokens+sizeTokens<=maxTokens){ included.push(block); usedChars+=sizeChars; usedTokens+=sizeTokens; }
    else omitted.push({kind:block.kind, chars:block.text.length, estTokens:block.estTokens});
  }
  return {included, omitted, usedChars, usedTokens};
}
function coverageSummary(records){ return refBreakdown(records.flatMap(r => r.sourceRefs || [])); }
function uniqueRefs(refs=[]) { return [...new Set(refs.filter(Boolean))]; }
function buildRecallPlan(selected, payload={}) {
  const sourceFirstRequired = selected?.scene === 'precise' || String(selected?.escalation || '').startsWith('source-');
  if (!sourceFirstRequired) return null;
  const queryTerms = uniqueStrings(selected?.selectorDiagnostics?.queryTerms || extractQueryTerms(payload?.prompt || payload?.query || '')).slice(0, 8);
  const candidateRefs = uniqueRefs([
    ...(selected?.facts || []).flatMap(x => x.sourceRefs || []),
    ...(selected?.threads || []).flatMap(x => x.sourceRefs || []),
  ].filter(isTrustedSourceRef)).slice(0, 8);
  const refStats = refBreakdown(candidateRefs);
  const actions = [];
  if (refStats.sum > 0) actions.push({ kind: 'expand-summaries-first', refs: candidateRefs.filter(r => String(r).startsWith('sum:')).slice(0, 3) });
  if (refStats.file > 0) actions.push({ kind: 'inspect-files', refs: candidateRefs.filter(r => String(r).startsWith('file:')).slice(0, 3) });
  if (refStats.mem > 0) actions.push({ kind: 'recall-durable-memory', refs: candidateRefs.filter(r => String(r).startsWith('mem:')).slice(0, 3) });
  if (actions.length === 0) actions.push({ kind: 'search-sources-by-query', queryTerms, preferredSourceKinds: ['sum', 'file', 'mem'] });
  return {
    strategy: selected?.escalation === 'source-required' ? 'recover-source-before-answer' : 'verify-selected-sources-before-answer',
    anchorMode: selected?.selectorDiagnostics?.anchorMode || (queryTerms.length ? 'query-anchored' : 'fallback-quality'),
    anchorMiss: !!selected?.selectorDiagnostics?.anchorMiss,
    queryTerms,
    candidateRefs,
    availableSources: { sum: refStats.sum, file: refStats.file, mem: refStats.mem },
    actions,
    reason: selected?.selectorDiagnostics?.fallbackReason || (selected?.escalation === 'source-required' ? 'insufficient-source-backing' : 'source-first-verification'),
  };
}
function sceneBudget(scene, payload={}) {
  const inputChars = Number(payload?.maxPromptChars || 1200);
  const inputTokens = Number(payload?.maxPromptTokens || Math.ceil(inputChars / 4));
  const defaults = {
    chat: { chars: Math.min(inputChars, 900), tokens: Math.min(inputTokens, 220) },
    task: { chars: Math.min(inputChars, 1400), tokens: Math.min(inputTokens, 320) },
    precise: { chars: Math.min(inputChars, 700), tokens: Math.min(inputTokens, 180) },
    heartbeat: { chars: Math.min(inputChars, 850), tokens: Math.min(inputTokens, 220) },
    narrative: { chars: Math.min(inputChars, 1600), tokens: Math.min(inputTokens, 360) },
    session: { chars: Math.min(inputChars, 1200), tokens: Math.min(inputTokens, 300) },
  };
  return defaults[scene] || { chars: inputChars, tokens: inputTokens };
}
function adjustBudgetBySourceMix(selected, budget) {
  const mix = selected?.runtimeSourceMix || summarizeSourceMix(selected);
  const scene = selected?.scene || 'chat';
  const adjusted = { ...budget, originalChars: budget.chars, originalTokens: budget.tokens, reason: 'unchanged', profile: 'default' };
  if (scene === 'precise') return { ...adjusted, reason: 'precise-source-first', profile: 'source-first' };
  if (mix.coverageQuality === 'artifact-heavy' || mix.artifactPressure >= 0.25) {
    adjusted.chars = Math.max(160, Math.floor(budget.chars * 0.56));
    adjusted.tokens = Math.max(64, Math.floor(budget.tokens * 0.6));
    adjusted.reason = 'tighten-artifact-heavy-mix';
    adjusted.profile = 'artifact-heavy-tight';
  } else if (mix.coverageQuality === 'session-heavy' || mix.derivedPressure >= 0.55 || mix.sessionPressure >= 0.45) {
    adjusted.chars = Math.max(200, Math.floor(budget.chars * 0.74));
    adjusted.tokens = Math.max(76, Math.floor(budget.tokens * 0.76));
    adjusted.reason = 'tighten-session-heavy-mix';
    adjusted.profile = 'session-heavy-tight';
  } else if (mix.coverageQuality === 'mixed-derived') {
    adjusted.chars = Math.max(220, Math.floor(budget.chars * 0.7));
    adjusted.tokens = Math.max(80, Math.floor(budget.tokens * 0.72));
    adjusted.reason = 'tighten-derived-heavy-mix';
    adjusted.profile = 'derived-tight';
  } else if (mix.coverageQuality === 'trusted-clean' && mix.authorityScore >= 0.85 && scene !== 'heartbeat') {
    adjusted.chars = Math.min(budget.chars, Math.floor(budget.chars * 1.05));
    adjusted.tokens = Math.min(budget.tokens, Math.floor(budget.tokens * 1.05));
    adjusted.reason = 'trusted-clean-keep-budget';
    adjusted.profile = 'trusted-clean';
  } else {
    adjusted.reason = 'mixed-keep-budget';
    adjusted.profile = 'mixed';
  }
  return adjusted;
}
function sliceSessionSelected(selected, currentPack, variant='task') {
  const out = { ...selected, facts: [...(selected.facts || [])], threads: [...(selected.threads || [])], continuity: [...(selected.continuity || [])], digests: [...(selected.digests || [])] };
  const primaryId = currentPack?.primaryThreadId || currentPack?.threadBindings?.primaryThreadId || null;
  if (primaryId) out.threads.sort((a, b) => (b.id === primaryId) - (a.id === primaryId));
  if (variant === 'brief') {
    out.facts = out.facts.slice(0, 3); out.threads = out.threads.slice(0, 1); out.continuity = out.continuity.slice(0, 1); out.digests = []; out.rationale = [...(out.rationale || []), 'session-brief-slice'];
  } else if (variant === 'handoff') {
    out.facts = out.facts.slice(0, 4); out.threads = out.threads.slice(0, 2); out.continuity = out.continuity.slice(0, 2);
    const capsule = currentPack?.handoffDraft || currentPack?.promptHint || '';
    if (capsule) {
      const cleanRefs = (currentPack?.sourceRefs || []).filter(isTrustedSourceRef);
      out.digests = [{ type: 'handoff', snippet: short(capsule, 500), sourceRefs: cleanRefs }, ...out.digests.slice(0, 1)];
    }
    out.rationale = [...(out.rationale || []), 'session-handoff-slice'];
  } else out.rationale = [...(out.rationale || []), 'session-task-slice'];
  out.packVariant = variant;
  return out;
}
function filterBySourceDiscipline(selected, scene){
  const dropped = [];
  function filterItems(kind, items, minTrusted, forceDrop = false) {
    const kept = [];
    for (const item of items) {
      const trusted = trustedRefCount(item.sourceRefs || []);
      if (forceDrop || trusted < minTrusted) dropped.push({ kind, id: item.id || item.type || item.focus || item.title, trustedRefs: trusted, reason: forceDrop ? `${scene}-disallow` : 'insufficient-trusted-sources' });
      else kept.push(item);
    }
    return kept;
  }
  if (scene === 'precise') {
    selected.facts = filterItems('facts', selected.facts, 1, false);
    selected.threads = filterItems('threads', selected.threads, 1, false);
    selected.continuity = filterItems('continuity', selected.continuity, 99, true);
    selected.digests = filterItems('digests', selected.digests, 99, true);
    if (selected.facts.length === 0 && selected.threads.length === 0) selected.escalation = 'source-required';
  } else if (scene === 'session') {
    selected.facts = filterItems('facts', selected.facts, 1, false);
    selected.threads = filterItems('threads', selected.threads, 1, false);
    selected.continuity = filterItems('continuity', selected.continuity, 1, false);
    selected.digests = selected.digests.filter(item => { const breakdown = refBreakdown(item.sourceRefs || []); const ok = breakdown.trustedRefs >= 1 && breakdown.artifact === 0; if (!ok) dropped.push({ kind: 'digests', id: item.type, trustedRefs: breakdown.trustedRefs, artifactRefs: breakdown.artifact, reason: 'session-digest-requires-clean-sources' }); return ok; });
  } else if (scene === 'chat') {
    selected.facts = filterItems('facts', selected.facts, 1, false);
    selected.threads = filterItems('threads', selected.threads, 1, false);
    selected.continuity = filterItems('continuity', selected.continuity, 1, false);
    selected.digests = [];
    dropped.push({ kind: 'digests', id: 'all', trustedRefs: 0, reason: 'chat-disallow-digests' });
  } else if (scene === 'heartbeat') {
    selected.facts = filterItems('facts', selected.facts, 1, false);
    selected.threads = filterItems('threads', selected.threads, 1, false);
    selected.continuity = filterItems('continuity', selected.continuity, 1, false);
    selected.digests = selected.digests.filter(item => { const breakdown = refBreakdown(item.sourceRefs || []); const ok = breakdown.trustedRefs >= 1 && breakdown.artifact === 0; if (!ok) dropped.push({ kind: 'digests', id: item.type, trustedRefs: breakdown.trustedRefs, artifactRefs: breakdown.artifact, reason: 'heartbeat-digest-requires-clean-sources' }); return ok; });
  } else {
    selected.facts = filterItems('facts', selected.facts, 1, false);
    selected.threads = filterItems('threads', selected.threads, 1, false);
    selected.continuity = filterItems('continuity', selected.continuity, 1, false);
    selected.digests = selected.digests.filter(item => { const breakdown = refBreakdown(item.sourceRefs || []); const ok = breakdown.trustedRefs >= 2 && breakdown.artifact === 0; if (!ok) dropped.push({ kind: 'digests', id: item.type, trustedRefs: breakdown.trustedRefs, artifactRefs: breakdown.artifact, reason: 'task-digest-requires-clean-sources' }); return ok; });
  }
  selected.coverageGuard = { droppedCount: dropped.length, dropped };
  return selected;
}

export function selectRuntimeContext({ root, payload, paths = null }) {
  const compilerDir = compilerDirFrom(root, paths);
  const digestsDir = path.join(compilerDir, 'digests');
  const packsDir = path.join(compilerDir, 'session-packs');
  const manifestsDir = path.join(digestsDir, 'manifests');
  const latestIndexPath = path.join(digestsDir, 'latest-index.json');

  const scene = String(payload?.scene||'chat');
  const date = payload?.date||new Date().toISOString().slice(0,10);
  const weekLabel = payload?.week || isoWeekLabel(date) || isoWeekLabel() || '1970-W01';
  const budgetProfile = sceneBudget(scene, payload);
  const maxPromptChars = budgetProfile.chars;
  const maxPromptTokens = budgetProfile.tokens;
  const preferredSourcePrefixes = Array.isArray(payload?.preferredSourcePrefixes) ? payload.preferredSourcePrefixes : [];

  const facts = readJsonl(path.join(compilerDir,'facts.jsonl'));
  const threads = readJsonl(path.join(compilerDir,'threads.jsonl'));
  const continuity = readJsonl(path.join(compilerDir,'continuity.jsonl'));
  const today = readTextIfExists(path.join(digestsDir,'today',`${date}.md`));
  const week = readTextIfExists(path.join(digestsDir,'week',`${weekLabel}.md`));
  const narrative = readTextIfExists(path.join(digestsDir,'narrative','current.md'));
  const todayManifest = loadLatestManifest(manifestsDir, latestIndexPath, 'today', `memory/compiler/digests/today/${date}.md`);
  const weekManifest = loadLatestManifest(manifestsDir, latestIndexPath, 'week', `memory/compiler/digests/week/${weekLabel}.md`);
  const narrativeManifest = loadLatestManifest(manifestsDir, latestIndexPath, 'narrative', 'memory/compiler/digests/narrative/current.md');
  const currentPack = readJsonIfExists(path.join(packsDir, 'current.json'));

  let selected={scene, facts:[], threads:[], continuity:[], digests:[], escalation:'none', rationale:[], preferredSourcePrefixes};
  if(scene==='chat'){ selected.facts=pickFacts(facts,payload.maxFacts??5,['confirmed'],preferredSourcePrefixes); selected.threads=pickThreads(threads,payload.maxThreads??3,['active'],preferredSourcePrefixes); selected.continuity=pickContinuity(continuity,payload.maxContinuity??1,preferredSourcePrefixes); if(today && todayManifest) selected.digests.push({type:'today',snippet:short(today,payload.maxChars??450),sourceRefs:todayManifest.sourceRefs||[]}); selected.rationale.push('prefer-short-continuity'); }
  else if(scene==='task'){ selected.facts=pickFacts(facts,payload.maxFacts??6,['confirmed'],preferredSourcePrefixes); selected.threads=pickThreads(threads,payload.maxThreads??2,['active'],preferredSourcePrefixes); selected.continuity=pickContinuity(continuity,payload.maxContinuity??2,preferredSourcePrefixes); if(today && todayManifest) selected.digests.push({type:'today',snippet:short(today,payload.maxChars??300),sourceRefs:todayManifest.sourceRefs||[]}); selected.escalation='lcm-on-demand'; selected.rationale.push('prefer-working-continuity','promote-source-expansion-when-needed'); }
  else if(scene==='precise'){
    const preciseScoped = pickPreciseScoped({ facts, threads, payload, preferred: preferredSourcePrefixes.length ? preferredSourcePrefixes : ['sum:','file:','mem:'] });
    selected.facts = preciseScoped.facts;
    selected.threads = preciseScoped.threads;
    selected.continuity = [];
    selected.digests = [];
    selected.selectorDiagnostics = preciseScoped.diagnostics;
    selected.escalation = 'source-first';
    if (preciseScoped.diagnostics?.anchorMode === 'query-anchored') selected.rationale.push('precise-query-anchored-selection');
    if (preciseScoped.diagnostics?.anchorMiss) selected.rationale.push('precise-anchor-miss');
    selected.rationale.push('avoid-digest-authority','force-source-verification','precise-scene-source-first');
  }
  else if(scene==='heartbeat'){ selected.facts=pickFacts(facts,payload.maxFacts??3,['confirmed'],preferredSourcePrefixes); selected.threads=pickThreads(threads,payload.maxThreads??5,['active','stale','blocked'],preferredSourcePrefixes); selected.continuity=pickContinuity(continuity,payload.maxContinuity??2,preferredSourcePrefixes); if(today && todayManifest) selected.digests.push({type:'today',snippet:short(today,payload.maxChars??180),sourceRefs:todayManifest.sourceRefs||[]}); if(week && weekManifest) selected.digests.push({type:'week',snippet:short(week,payload.maxChars??180),sourceRefs:weekManifest.sourceRefs||[]}); selected.escalation='summarize-then-decide'; selected.rationale.push('heartbeat-needs-signal-not-bloat'); }
  else if(scene==='narrative'){ selected.facts=pickFacts(facts,payload.maxFacts??8,['confirmed'],preferredSourcePrefixes); selected.threads=pickThreads(threads,payload.maxThreads??5,['active'],preferredSourcePrefixes); selected.continuity=pickContinuity(continuity,payload.maxContinuity??3,preferredSourcePrefixes); if(narrative && narrativeManifest) selected.digests.push({type:'narrative',snippet:short(narrative,payload.maxChars??600),sourceRefs:narrativeManifest.sourceRefs||[]}); selected.rationale.push('narrative-mode'); }
  else if(scene==='session'){
    const requestedSessionKey = payload?.sessionKey ? String(payload.sessionKey) : null;
    const currentPackUsable = !!(currentPack
      && (!currentPack.expiresAt || new Date(currentPack.expiresAt).getTime() > Date.now())
      && (!requestedSessionKey || String(currentPack.sessionKey || '') === requestedSessionKey));
    if (currentPackUsable) {
      selected = { ...currentPack.selected, scene: 'session', preferredSourcePrefixes, rationale: [...(currentPack.selected?.rationale || []), 'session-pack-hot-state'], packId: currentPack.id, packFocus: currentPack.focus, escalation: currentPack.selected?.escalation || 'lcm-on-demand', primaryThreadId: currentPack.primaryThreadId || null, secondaryThreadIds: currentPack.secondaryThreadIds || [] };
      selected = sliceSessionSelected(selected, currentPack, String(payload?.packVariant || 'task'));
    } else {
      selected.facts=pickFacts(facts,payload.maxFacts??6,['confirmed'],preferredSourcePrefixes); selected.threads=pickThreads(threads,payload.maxThreads??3,['active'],preferredSourcePrefixes); selected.continuity=pickContinuity(continuity,payload.maxContinuity??2,preferredSourcePrefixes); if (requestedSessionKey && currentPack) selected.rationale.push('session-pack-miss'); selected.rationale.push('session-fallback');
    }
  } else throw new Error(`Unsupported scene: ${scene}`);

  selected = filterBySourceDiscipline(selected, scene);
  selected.sourceKindContract = sceneSourceKindContract(scene);
  selected.runtimeSourceMix = summarizeSourceMix(selected);
  if (scene !== 'precise' && (['artifact-heavy', 'session-heavy', 'mixed-derived'].includes(selected.runtimeSourceMix.coverageQuality) || selected.runtimeSourceMix.authorityScore < Number(selected.sourceKindContract?.minAuthorityScore || 0) || selected.runtimeSourceMix.artifactPressure >= 0.25)) {
    const sourceLeanTag = selected.runtimeSourceMix.coverageQuality === 'artifact-heavy'
      ? 'source-leaning+artifact-first'
      : selected.runtimeSourceMix.coverageQuality === 'session-heavy'
        ? 'source-leaning+session-cross-check'
        : 'source-leaning';
    selected.escalation = selected.escalation === 'none' ? sourceLeanTag : `${selected.escalation}+${sourceLeanTag}`;
    selected.rationale.push(`runtime-source-mix-tightened:${selected.runtimeSourceMix.coverageQuality}`);
  }
  selected.sourceFirstStatus = {
    required: scene === 'precise' || String(selected.escalation || '').startsWith('source-'),
    trustedFacts: selected.facts.filter(item => trustedRefCount(item.sourceRefs || []) >= 1).length,
    trustedThreads: selected.threads.filter(item => trustedRefCount(item.sourceRefs || []) >= 1).length,
    droppedCount: selected.coverageGuard?.droppedCount || 0,
  };
  selected.sourceFirstStatus.satisfied = !selected.sourceFirstStatus.required || (selected.sourceFirstStatus.trustedFacts + selected.sourceFirstStatus.trustedThreads) > 0;
  selected.recallPlan = buildRecallPlan(selected, payload);
  const blocks = buildBlocks(selected);
  const adjustedBudget = adjustBudgetBySourceMix(selected, { chars: maxPromptChars, tokens: maxPromptTokens });
  const budget = fitBlocks(blocks, adjustedBudget.chars, adjustedBudget.tokens);
  selected.promptBlocks=budget.included.map(b=>b.text); selected.omittedBlocks=budget.omitted; selected.usedPromptChars=budget.usedChars; selected.maxPromptChars=adjustedBudget.chars; selected.usedPromptTokens=budget.usedTokens; selected.maxPromptTokens=adjustedBudget.tokens;
  selected.coverage = { facts: coverageSummary(selected.facts), threads: coverageSummary(selected.threads), continuity: coverageSummary(selected.continuity), digests: coverageSummary(selected.digests) };
  selected.runtimeSourceMix = summarizeSourceMix(selected);
  selected.blockCoverage = budget.included.map(b => ({ kind: b.kind, coverage: b.coverage, estTokens: b.estTokens }));
  selected.budgetProfile = { scene, maxPromptChars: adjustedBudget.chars, maxPromptTokens: adjustedBudget.tokens, requestedPromptChars: maxPromptChars, requestedPromptTokens: maxPromptTokens, usedPromptChars: budget.usedChars, usedPromptTokens: budget.usedTokens, omittedKinds: budget.omitted.map(x => x.kind), sourceMixQuality: selected.runtimeSourceMix.coverageQuality, supportingKinds: selected.runtimeSourceMix.supportingKinds, authorityScore: selected.runtimeSourceMix.authorityScore, trustedRatio: selected.runtimeSourceMix.trustedRatio, budgetReason: adjustedBudget.reason, budgetProfileName: adjustedBudget.profile };
  return { ok: true, selected };
}

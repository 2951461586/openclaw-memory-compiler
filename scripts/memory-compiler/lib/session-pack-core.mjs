import { uniq, hashId } from './common.mjs';
import { assessSourceRefs, isAllowedSourceRef } from './source-discipline.mjs';

function topStrings(items, max=4) {
  return [...new Set((items || []).filter(Boolean).map(x => String(x).trim()).filter(Boolean))].slice(0, max);
}
export function buildThreadBindings(selected) {
  const related = new Set((selected.continuity || []).flatMap(x => x.relatedThreads || []).filter(Boolean));
  const threads = [...(selected.threads || [])];
  threads.sort((a, b) => {
    const aRel = related.has(a.id) ? 1 : 0;
    const bRel = related.has(b.id) ? 1 : 0;
    return bRel - aRel || Number(b.priority || 0) - Number(a.priority || 0);
  });
  const primary = threads[0] || null;
  const secondary = threads.slice(1, 4).map(t => t.id);
  return {
    primaryThreadId: primary?.id || null,
    primaryThreadTitle: primary?.title || null,
    secondaryThreadIds: secondary,
    relatedThreadIds: [...new Set(threads.filter(t => related.has(t.id)).map(t => t.id))],
  };
}
export function buildHandoffDraft({ focus, decisions, risks, nextActions, threadBindings, selected }) {
  const lines = [
    `Focus: ${focus}`,
    threadBindings.primaryThreadTitle ? `Primary thread: ${threadBindings.primaryThreadTitle}` : null,
    decisions.length ? `Decisions: ${decisions.join(' | ')}` : null,
    risks.length ? `Open risks: ${risks.join(' | ')}` : null,
    nextActions.length ? `Next actions: ${nextActions.join(' | ')}` : null,
    selected.escalation ? `Escalation: ${selected.escalation}` : null,
  ].filter(Boolean);
  return lines.join('\n');
}
export function buildSessionPack({ selected, payload, generatedAt }) {
  const allRefs = uniq([
    ...(selected.facts || []).flatMap(x => x.sourceRefs || []),
    ...(selected.threads || []).flatMap(x => x.sourceRefs || []),
    ...(selected.continuity || []).flatMap(x => x.sourceRefs || []),
    ...(selected.digests || []).flatMap(x => x.sourceRefs || []),
    ...(payload.sessionKey ? [`session:${payload.sessionKey}`] : []),
  ]).filter(isAllowedSourceRef);
  const discipline = assessSourceRefs(allRefs);
  const ttlHours = Number(payload.ttlHours || 6);
  const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000).toISOString();
  const focus = selected.continuity?.[0]?.focus || selected.threads?.[0]?.title || selected.facts?.[0]?.text || 'continue-current-session';
  const decisions = topStrings(selected.continuity.flatMap(x => x.decisions || []), 5);
  const risks = topStrings(selected.continuity.flatMap(x => x.risks || []), 5);
  const nextActions = topStrings([ ...selected.continuity.flatMap(x => x.nextActions || []), ...selected.threads.map(x => x.nextStepHint).filter(Boolean) ], 6);
  const threadBindings = buildThreadBindings(selected);
  const unresolvedRisks = risks;
  const promptHint = [ `Focus: ${focus}`, decisions.length ? `Decisions: ${decisions.join(' | ')}` : null, nextActions.length ? `Next: ${nextActions.join(' | ')}` : null, `Escalation: ${selected.escalation || 'none'}` ].filter(Boolean).join('\n');
  const handoffDraft = buildHandoffDraft({ focus, decisions, risks: unresolvedRisks, nextActions, threadBindings, selected });
  return {
    id: hashId('sessionpack', [payload.sessionKey || 'current', focus, generatedAt]),
    kind: 'session-continuity-pack',
    sessionKey: payload.sessionKey || null,
    scene: payload.scene || 'task',
    focus,
    decisions,
    risks,
    unresolvedRisks,
    nextActions,
    threadBindings,
    primaryThreadId: threadBindings.primaryThreadId,
    secondaryThreadIds: threadBindings.secondaryThreadIds,
    selected,
    sourceRefs: allRefs,
    sourceDiscipline: { trustedRefs: discipline.trustedRefs, totalRefs: discipline.totalRefs, artifactRefs: discipline.artifactRefs, ok: discipline.hasTrusted && !discipline.artifactOnly },
    generatedAt,
    expiresAt,
    status: 'active',
    lifecycleState: 'active',
    promptHint,
    handoffDraft,
  };
}

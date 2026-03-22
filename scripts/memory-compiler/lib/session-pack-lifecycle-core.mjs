import fs from 'fs';
import path from 'path';
import { readJsonl, appendJsonl, ensureParent } from './jsonl-store.mjs';
import { nowIso, hashId } from './common.mjs';
import { transitionSessionPack } from './session-pack-state.mjs';
import { buildSessionPack } from './session-pack-core.mjs';
import { selectRuntimeContext } from './runtime-selector-core.mjs';
import { compilerDirFrom } from './plugin-paths.mjs';

function readJsonIfExists(p) { try { return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; } catch { return null; } }

export function applySessionPackLifecycle({ root, payload, paths = null }) {
  const compilerDir = compilerDirFrom(root, paths);
  const packsDir = path.join(compilerDir, 'session-packs');
  const currentPath = path.join(packsDir, 'current.json');
  const historyPath = path.join(packsDir, 'history.jsonl');
  const handoffsDir = path.join(packsDir, 'handoffs');
  const action = String(payload?.action || 'build');
  const current = readJsonIfExists(currentPath);

  function clearCurrent() { if (fs.existsSync(currentPath)) fs.unlinkSync(currentPath); }
  function writeCurrent(pack) { ensureParent(currentPath); fs.writeFileSync(currentPath, JSON.stringify(pack, null, 2) + '\n'); }
  function archiveLifecycle(pack, event, extra = {}) {
    const archived = { ...pack, lifecycleEvent: event, lifecycleAt: nowIso(), archivedId: hashId('packevt', [pack.id || 'pack', event, nowIso(), Math.random().toString(36).slice(2)]), ...extra };
    appendJsonl(historyPath, archived);
    return archived;
  }
  function buildHandoffArtifact(pack, reason, extra = {}) {
    fs.mkdirSync(handoffsDir, { recursive: true });
    const stamp = nowIso().replace(/[:.]/g, '-');
    const id = hashId('handoff', [pack.id || 'pack', reason || 'handoff', stamp]);
    const jsonPath = path.join(handoffsDir, `${id}.json`);
    const mdPath = path.join(handoffsDir, `${id}.md`);
    const handoff = {
      id, kind: 'session-handoff-capsule', packId: pack.id || null, sessionKey: extra.sessionKey || pack.sessionKey || null, reason,
      focus: pack.focus || null, primaryThreadId: pack.primaryThreadId || pack.threadBindings?.primaryThreadId || null,
      primaryThreadTitle: pack.threadBindings?.primaryThreadTitle || null, decisions: pack.decisions || [], unresolvedRisks: pack.unresolvedRisks || pack.risks || [],
      nextActions: pack.nextActions || [], handoffSummary: extra.handoffSummary || pack.handoffSummary || pack.handoffDraft || pack.promptHint || null,
      sourceRefs: pack.sourceRefs || [], generatedAt: nowIso(), status: extra.status || pack.status || 'active',
    };
    fs.writeFileSync(jsonPath, JSON.stringify(handoff, null, 2) + '\n');
    const md = [ `# Session Handoff — ${handoff.id}`, '', handoff.focus ? `## Focus\n- ${handoff.focus}` : null, handoff.primaryThreadTitle ? `## Primary Thread\n- ${handoff.primaryThreadTitle}` : null, handoff.decisions.length ? `## Decisions\n${handoff.decisions.map(x => `- ${x}`).join('\n')}` : null, handoff.unresolvedRisks.length ? `## Unresolved Risks\n${handoff.unresolvedRisks.map(x => `- ${x}`).join('\n')}` : null, handoff.nextActions.length ? `## Next Actions\n${handoff.nextActions.map(x => `- ${x}`).join('\n')}` : null, handoff.handoffSummary ? `## Summary\n${handoff.handoffSummary}` : null, handoff.sourceRefs.length ? `## Source Refs\n${handoff.sourceRefs.map(x => `- ${x}`).join('\n')}` : null ].filter(Boolean).join('\n\n');
    fs.writeFileSync(mdPath, md + '\n');
    return { id, jsonPath, mdPath, payload: handoff };
  }

  let result;
  if (action === 'build' || action === 'refresh') {
    if (current && current.status === 'active' && action === 'refresh' && payload.onlyIfMissing === true) {
      result = { ok: true, action, skipped: true, reason: 'active-pack-exists', packId: current.id };
    } else {
      const selected = selectRuntimeContext({ root, paths, payload: {
        scene: payload.scene || 'task', date: payload.date, week: payload.week, maxPromptChars: payload.maxPromptChars || 1200, maxPromptTokens: payload.maxPromptTokens || 300,
        maxFacts: payload.maxFacts || 6, maxThreads: payload.maxThreads || 3, maxContinuity: payload.maxContinuity || 3, preferredSourcePrefixes: payload.preferredSourcePrefixes || ['sum:', 'file:', 'mem:']
      } }).selected;
      const pack = buildSessionPack({ selected, payload, generatedAt: nowIso() });
      writeCurrent(pack);
      appendJsonl(path.join(packsDir, 'history.jsonl'), pack);
      result = { ok: true, action, packId: pack.id, pack };
    }
  } else if (action === 'finalize' || action === 'rollover') {
    if (!current) result = { ok: true, action, skipped: true, reason: 'no-current-pack' };
    else {
      const finalized = { ...transitionSessionPack(current, action === 'rollover' ? 'rolled-over' : 'finalized', { at: nowIso(), reason: payload.reason || action, eventType: payload.eventType || null }), finalizedAt: nowIso(), finalizeReason: payload.reason || action, handoffSummary: payload.handoffSummary || current.handoffDraft || current.promptHint || null, endedByEvent: payload.eventType || null };
      const handoff = buildHandoffArtifact(finalized, action, { sessionKey: payload.sessionKey || finalized.sessionKey || null, status: finalized.status, handoffSummary: finalized.handoffSummary });
      const archived = archiveLifecycle({ ...finalized, handoffId: handoff.id, handoffJsonPath: handoff.jsonPath, handoffMarkdownPath: handoff.mdPath }, action, { sessionKey: payload.sessionKey || finalized.sessionKey || null });
      clearCurrent();
      result = { ok: true, action, packId: finalized.id, archivedId: archived.archivedId, clearedCurrent: true, status: finalized.status, handoffId: handoff.id, handoffJsonPath: handoff.jsonPath, handoffMarkdownPath: handoff.mdPath };
    }
  } else if (action === 'expire') {
    if (!current) result = { ok: true, action, skipped: true, reason: 'no-current-pack' };
    else {
      const expired = payload.force === true || (current.expiresAt && new Date(current.expiresAt).getTime() <= Date.now());
      if (!expired) result = { ok: true, action, skipped: true, reason: 'not-expired', packId: current.id, expiresAt: current.expiresAt };
      else {
        const archived = archiveLifecycle({ ...transitionSessionPack(current, 'expired', { at: nowIso(), reason: payload.reason || 'ttl-expired', eventType: payload.eventType || null }), expiredAt: nowIso(), expireReason: payload.reason || 'ttl-expired' }, 'expire', { sessionKey: payload.sessionKey || current.sessionKey || null });
        clearCurrent();
        result = { ok: true, action, packId: current.id, archivedId: archived.archivedId, clearedCurrent: true, status: 'expired' };
      }
    }
  } else if (action === 'handoff') {
    const target = current || readJsonl(historyPath).slice(-1)[0] || null;
    if (!target) result = { ok: true, action, skipped: true, reason: 'no-pack-available' };
    else {
      const handoff = buildHandoffArtifact(target, payload.reason || 'manual-handoff', { sessionKey: payload.sessionKey || target.sessionKey || null, status: target.status || 'active', handoffSummary: payload.handoffSummary || target.handoffDraft || target.promptHint || null });
      result = { ok: true, action, packId: target.id || null, handoffId: handoff.id, handoffJsonPath: handoff.jsonPath, handoffMarkdownPath: handoff.mdPath };
    }
  } else if (action === 'history') {
    let items = readJsonl(historyPath).slice().reverse();
    if (payload?.sessionKey) items = items.filter(x => x.sessionKey === payload.sessionKey);
    if (payload?.status) items = items.filter(x => x.status === payload.status);
    const limit = Number(payload?.limit || 20);
    if (limit > 0) items = items.slice(0, limit);
    result = { ok: true, action, total: items.length, items };
  } else {
    throw new Error(`Unsupported action: ${action}`);
  }
  return result;
}

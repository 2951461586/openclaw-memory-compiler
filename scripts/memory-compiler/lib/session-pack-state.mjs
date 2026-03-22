export const SESSION_PACK_STATES = ['active', 'finalized', 'rolled-over', 'expired', 'archived'];

const ALLOWED = {
  active: new Set(['finalized', 'rolled-over', 'expired']),
  finalized: new Set(['archived']),
  'rolled-over': new Set(['archived']),
  expired: new Set(['archived']),
  archived: new Set([]),
};

export function transitionSessionPack(pack, nextState, meta = {}) {
  const current = pack?.lifecycleState || pack?.status || 'active';
  if (!SESSION_PACK_STATES.includes(nextState)) throw new Error(`unsupported-session-pack-state:${nextState}`);
  if (current !== nextState && !(ALLOWED[current] || new Set()).has(nextState)) {
    throw new Error(`invalid-session-pack-transition:${current}->${nextState}`);
  }
  return {
    ...pack,
    status: nextState,
    lifecycleState: nextState,
    lifecycleUpdatedAt: meta.at,
    lifecycleReason: meta.reason || null,
    endedByEvent: meta.eventType || pack?.endedByEvent || null,
  };
}

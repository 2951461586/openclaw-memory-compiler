import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';

const SUM_ID_RE = /^sum_[0-9a-f]{8,}$/i;
let lcmDb = null;
let lcmDbReady = null;
const summaryExistsCache = new Map();

function homeDir() {
  return process.env.HOME || '/root';
}

function resolveLcmDbPath() {
  const raw = String(process.env.MEMORY_COMPILER_LCM_DB_PATH || '').trim();
  if (raw) return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
  return path.join(homeDir(), '.openclaw', 'lcm.db');
}

function getLcmDb() {
  if (lcmDbReady !== null) return lcmDb;
  const dbPath = resolveLcmDbPath();
  if (!fs.existsSync(dbPath)) {
    lcmDbReady = false;
    lcmDb = null;
    return null;
  }
  try {
    lcmDb = new DatabaseSync(dbPath, { readonly: true });
    lcmDbReady = true;
    return lcmDb;
  } catch {
    lcmDbReady = false;
    lcmDb = null;
    return null;
  }
}

export function isCanonicalSumId(summaryId) {
  return SUM_ID_RE.test(String(summaryId || ''));
}

export function summaryExists(summaryId) {
  const id = String(summaryId || '');
  if (!isCanonicalSumId(id)) return false;
  if (summaryExistsCache.has(id)) return summaryExistsCache.get(id);
  const db = getLcmDb();
  if (!db) {
    summaryExistsCache.set(id, false);
    return false;
  }
  let exists = false;
  try {
    exists = !!db.prepare('select 1 as ok from summaries where summary_id = ? limit 1').get(id);
  } catch {
    exists = false;
  }
  summaryExistsCache.set(id, exists);
  return exists;
}

export function isTrustedRef(ref) {
  const s = String(ref || '');
  if (s.startsWith('file:')) return s.length > 'file:'.length;
  if (s.startsWith('mem:')) return s.length > 'mem:'.length;
  if (s.startsWith('sum:')) return summaryExists(s.slice('sum:'.length));
  return false;
}

export function isAllowedSourceRef(ref) {
  const s = String(ref || '');
  if (s.startsWith('sum:')) return summaryExists(s.slice('sum:'.length));
  if (s.startsWith('msg:')) return s.length > 'msg:'.length;
  if (s.startsWith('session:')) return s.length > 'session:'.length;
  if (s.startsWith('file:')) return s.length > 'file:'.length;
  if (s.startsWith('mem:')) return s.length > 'mem:'.length;
  if (s.startsWith('artifact:')) return s.length > 'artifact:'.length;
  return false;
}

export function assessSourceRefs(refs = []) {
  const result = {
    totalRefs: refs.length,
    trustedRefs: 0,
    artifactRefs: 0,
    otherRefs: 0,
    hasTrusted: false,
    artifactOnly: false,
  };
  for (const ref of refs) {
    if (isTrustedRef(ref)) result.trustedRefs++;
    else if (String(ref).startsWith('artifact:')) result.artifactRefs++;
    else result.otherRefs++;
  }
  result.hasTrusted = result.trustedRefs > 0;
  result.artifactOnly = result.totalRefs > 0 && result.trustedRefs === 0 && result.artifactRefs > 0;
  return result;
}

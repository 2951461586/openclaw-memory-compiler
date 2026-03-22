import crypto from 'crypto';

export function nowIso() {
  return new Date().toISOString();
}

export function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[`~!@#$%^&*()+=\[\]{};:'"\\|,.<>/?！？、，。；：“”‘’【】（）《》\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'item';
}

export function hashId(prefix, parts) {
  const hash = crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 12);
  return `${prefix}_${hash}`;
}

export function uniq(arr) {
  return [...new Set((arr || []).filter(Boolean))];
}

export function normalizeText(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function mergeConfidence(a, b) {
  const aa = Number.isFinite(a) ? a : 0;
  const bb = Number.isFinite(b) ? b : 0;
  return Math.max(aa, bb);
}

export function chooseStatus(existing, incoming) {
  const priority = ['disputed', 'confirmed', 'inferred', 'stale'];
  const ex = priority.indexOf(existing);
  const inc = priority.indexOf(incoming);
  if (ex === -1) return incoming;
  if (inc === -1) return existing;
  return priority[Math.min(ex, inc)];
}

export function isoWeekLabel(input) {
  const base = input ? new Date(input) : new Date();
  if (Number.isNaN(base.getTime())) return null;
  const date = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

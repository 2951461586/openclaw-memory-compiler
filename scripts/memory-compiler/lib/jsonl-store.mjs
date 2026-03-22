import fs from 'fs';
import path from 'path';

export function ensureParent(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8');
  if (!raw.trim()) return [];
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, idx) => {
      try {
        return JSON.parse(line);
      } catch (err) {
        throw new Error(`${path.basename(filePath)} line ${idx + 1}: ${err.message}`);
      }
    });
}

export function writeJsonl(filePath, records) {
  ensureParent(filePath);
  const tmp = `${filePath}.tmp`;
  const body = records.map((r) => JSON.stringify(r)).join('\n');
  fs.writeFileSync(tmp, body + (body ? '\n' : ''));
  fs.renameSync(tmp, filePath);
}

export function appendJsonl(filePath, record) {
  ensureParent(filePath);
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`);
}

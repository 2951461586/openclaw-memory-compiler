#!/usr/bin/env node
import path from 'node:path';
import { readJsonl, writeJsonl } from './lib/jsonl-store.mjs';
import { printResult } from './lib/io.mjs';
import { hashId } from './lib/common.mjs';

const root = process.cwd();
const factsPath = path.join(root, 'memory', 'compiler', 'facts.jsonl');
const facts = readJsonl(factsPath);
const seen = new Map();
let changed = 0;

for (const fact of facts) {
  const key = fact.id || '';
  if (!seen.has(key)) {
    seen.set(key, 1);
    continue;
  }
  const newId = hashId('fact', [fact.scope || '', fact.subject || '', fact.attribute || '', fact.value ?? '', fact.text || '', String(seen.get(key) + 1)]);
  seen.set(key, seen.get(key) + 1);
  fact.repairedFromId = fact.id;
  fact.id = newId;
  changed++;
}

writeJsonl(factsPath, facts);
printResult({ ok: true, changed, total: facts.length, path: factsPath });

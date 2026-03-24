#!/usr/bin/env node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { printResult, readJsonInput } from './lib/io.mjs';
import { nowIso } from './lib/common.mjs';

function usage() {
  console.error('Usage: node plugins/memory-compiler/scripts/memory-compiler/export-lcm-summaries.mjs <config.json | ->');
  process.exit(2);
}
function firstMeaningfulLine(text) {
  return String(text || '').split(/\n+/).map(x => x.trim()).find(Boolean) || '';
}
function summarizeText(text, max = 220) {
  const compact = String(text || '').replace(/\s+/g, ' ').trim();
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact;
}
function parseJsonArray(text) {
  try {
    const arr = JSON.parse(String(text || '[]'));
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
function sqlIn(column, values, params) {
  if (!Array.isArray(values) || !values.length) return '1=1';
  const marks = values.map(() => '?').join(', ');
  params.push(...values);
  return `${column} IN (${marks})`;
}

const arg = process.argv[2];
if (!arg) usage();
const cfg = readJsonInput(arg === '-' ? null : arg);
const dbPath = cfg?.dbPath || path.join(process.env.HOME || os.homedir(), '.openclaw', 'lcm.db');
if (!fs.existsSync(dbPath)) throw new Error(`LCM db not found: ${dbPath}`);
const db = new DatabaseSync(dbPath, { readonly: true });
const limit = Math.max(1, Number(cfg?.limit || 10));
const params = [];
const where = [];
if (cfg?.conversationId != null) { where.push('s.conversation_id = ?'); params.push(Number(cfg.conversationId)); }
if (cfg?.sessionId) { where.push('c.session_id = ?'); params.push(String(cfg.sessionId)); }
if (cfg?.since) { where.push('s.created_at >= ?'); params.push(String(cfg.since)); }
if (cfg?.kinds?.length) where.push(sqlIn('s.kind', cfg.kinds.map(String), params));
if (cfg?.summaryIds?.length) where.push(sqlIn('s.summary_id', cfg.summaryIds.map(String), params));
const sql = `
  select s.summary_id, s.kind, s.depth, s.conversation_id, c.session_id,
         s.created_at, s.earliest_at, s.latest_at, s.descendant_count,
         s.content,
         json_group_array(sm.message_id) as message_ids
  from summaries s
  join conversations c on c.conversation_id = s.conversation_id
  left join summary_messages sm on sm.summary_id = s.summary_id
  where ${where.length ? where.join(' and ') : '1=1'}
  group by s.summary_id
  order by s.created_at desc
  limit ?
`;
params.push(limit);
const rows = db.prepare(sql).all(...params);
const summaries = rows.map((row) => {
  const content = String(row.content || '');
  const firstLine = firstMeaningfulLine(content);
  const threadSummary = summarizeText(content, Number(cfg?.summaryChars || 260));
  return {
    id: row.summary_id,
    kind: row.kind,
    depth: row.depth,
    conversationId: row.conversation_id,
    sessionId: row.session_id,
    createdAt: row.created_at,
    earliestAt: row.earliest_at,
    latestAt: row.latest_at,
    descendantCount: row.descendant_count,
    scope: cfg?.scope || 'project',
    messageIds: parseJsonArray(row.message_ids).map(String),
    threadTitle: firstLine || `LCM summary ${row.summary_id}`,
    threadSummary,
    summary: threadSummary,
    focus: `Imported LCM summary ${row.summary_id}${firstLine ? `: ${firstLine}` : ''}`,
    nextActions: ['Use source-first recall when exact claims depend on this summary.'],
    relatedThreads: [`lcm-conversation:${row.conversation_id}`]
  };
});
printResult({
  ok: true,
  generatedAt: nowIso(),
  dbPath,
  filters: {
    conversationId: cfg?.conversationId ?? null,
    sessionId: cfg?.sessionId ?? null,
    since: cfg?.since ?? null,
    kinds: cfg?.kinds || null,
    summaryIds: cfg?.summaryIds || null,
    limit,
  },
  summaries,
});

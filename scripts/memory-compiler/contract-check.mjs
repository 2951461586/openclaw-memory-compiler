#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { printResult } from './lib/io.mjs';
import { readJsonl } from './lib/jsonl-store.mjs';

import { resolveCompilerRuntime, compilerDirFrom } from './lib/plugin-paths.mjs';

const runtime = resolveCompilerRuntime();
const root = runtime.workspaceDir;
const compilerDir = compilerDirFrom(root, runtime);
const schemasDir = runtime.schemasDir;
const TRUSTED_PREFIXES = ['sum:', 'msg:', 'session:', 'file:', 'mem:', 'artifact:'];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function isDateTime(value) {
  if (value == null) return false;
  const ts = Date.parse(String(value));
  return Number.isFinite(ts);
}
function validateType(value, schema) {
  if (!schema) return true;
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  return types.some((type) => {
    if (type === 'null') return value === null;
    if (type === 'string') return typeof value === 'string';
    if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
    if (type === 'integer') return Number.isInteger(value);
    if (type === 'boolean') return typeof value === 'boolean';
    if (type === 'array') return Array.isArray(value);
    if (type === 'object') return value && typeof value === 'object' && !Array.isArray(value);
    return true;
  });
}
function resolveRef(schema, ref) {
  if (!ref || !String(ref).startsWith('#/$defs/')) return null;
  const parts = String(ref).replace(/^#\/\$defs\//, '').split('/').filter(Boolean);
  let cur = schema?.$defs || null;
  for (const part of parts) {
    cur = cur?.[part];
    if (!cur) return null;
  }
  return cur;
}
function validateAgainstSchema(record, schema, label, rootSchema = schema) {
  const errors = [];
  if (schema?.$ref) {
    const resolved = resolveRef(rootSchema, schema.$ref);
    if (!resolved) return [`${label}: unresolved ref ${schema.$ref}`];
    return validateAgainstSchema(record, resolved, label, rootSchema);
  }
  const props = schema?.properties || {};
  for (const req of schema?.required || []) {
    if (!(req in record)) errors.push(`${label}: missing required field ${req}`);
  }
  if (schema?.additionalProperties === false && record && typeof record === 'object' && !Array.isArray(record)) {
    for (const key of Object.keys(record)) {
      if (!props[key]) errors.push(`${label}: unexpected field ${key}`);
    }
  }
  for (const [key, prop] of Object.entries(props)) {
    if (!(key in record) || record[key] === undefined) continue;
    const value = record[key];
    const effectiveProp = prop?.$ref ? resolveRef(rootSchema, prop.$ref) : prop;
    if (prop?.$ref && !effectiveProp) {
      errors.push(`${label}: unresolved ref for ${key}: ${prop.$ref}`);
      continue;
    }
    if (!validateType(value, effectiveProp)) {
      errors.push(`${label}: invalid type for ${key}`);
      continue;
    }
    if (effectiveProp?.const != null && value !== effectiveProp.const) errors.push(`${label}: invalid const for ${key}`);
    if (effectiveProp?.enum && value != null && !effectiveProp.enum.includes(value)) errors.push(`${label}: invalid enum for ${key}`);
    if (effectiveProp?.minLength != null && typeof value === 'string' && value.length < effectiveProp.minLength) errors.push(`${label}: ${key} shorter than minLength`);
    if (effectiveProp?.minimum != null && typeof value === 'number' && value < effectiveProp.minimum) errors.push(`${label}: ${key} below minimum`);
    if (effectiveProp?.maximum != null && typeof value === 'number' && value > effectiveProp.maximum) errors.push(`${label}: ${key} above maximum`);
    if (effectiveProp?.format === 'date-time' && value != null && !isDateTime(value)) errors.push(`${label}: invalid date-time for ${key}`);
    const effectiveTypes = Array.isArray(effectiveProp?.type) ? effectiveProp.type : [effectiveProp?.type];
    if (effectiveTypes.includes('array')) {
      if (effectiveProp.minItems != null && Array.isArray(value) && value.length < effectiveProp.minItems) errors.push(`${label}: ${key} below minItems`);
    }
    if (effectiveTypes.includes('object') && value && typeof value === 'object' && !Array.isArray(value) && effectiveProp?.properties) {
      errors.push(...validateAgainstSchema(value, effectiveProp, `${label}.${key}`, rootSchema));
    }
  }
  return errors;
}
function validateSourceRefs(record, label, requireNonEmpty = false) {
  const refs = Array.isArray(record.sourceRefs) ? record.sourceRefs : [];
  const errors = [];
  if (requireNonEmpty && refs.length === 0) errors.push(`${label}: sourceRefs empty`);
  for (const ref of refs) {
    if (!TRUSTED_PREFIXES.some(prefix => String(ref).startsWith(prefix))) {
      errors.push(`${label}: invalid sourceRef prefix ${ref}`);
    }
  }
  return errors;
}

const factsSchema = readJson(path.join(schemasDir, 'facts.schema.json'));
const threadsSchema = readJson(path.join(schemasDir, 'threads.schema.json'));
const continuitySchema = readJson(path.join(schemasDir, 'continuity.schema.json'));
const reviewSchema = readJson(path.join(schemasDir, 'review-item.schema.json'));
const runtimeProbeSchema = readJson(path.join(schemasDir, 'runtime-probe.schema.json'));
const runtimeProbeTrendSchema = readJson(path.join(schemasDir, 'runtime-probe-trend.schema.json'));
const acceptanceReviewGovernanceSchema = readJson(path.join(schemasDir, 'acceptance-review-governance.schema.json'));

const checks = [
  { name: 'facts', path: path.join(compilerDir, 'facts.jsonl'), schema: factsSchema, requireSourceRefs: true, kind: 'jsonl' },
  { name: 'threads', path: path.join(compilerDir, 'threads.jsonl'), schema: threadsSchema, requireSourceRefs: true, kind: 'jsonl' },
  { name: 'continuity', path: path.join(compilerDir, 'continuity.jsonl'), schema: continuitySchema, requireSourceRefs: false, kind: 'jsonl' },
  { name: 'review-queue', path: path.join(compilerDir, 'review-queue.jsonl'), schema: reviewSchema, requireSourceRefs: false, kind: 'jsonl' },
  { name: 'runtime-probe', path: path.join(compilerDir, 'reports', 'runtime-probe.latest.json'), schema: runtimeProbeSchema, requireSourceRefs: false, kind: 'json' },
  { name: 'runtime-probe-trend', path: path.join(compilerDir, 'reports', 'runtime-probe-trend.latest.json'), schema: runtimeProbeTrendSchema, requireSourceRefs: false, kind: 'json' },
  { name: 'acceptance-review-governance', path: path.join(compilerDir, 'reports', 'acceptance-review-governance.latest.json'), schema: acceptanceReviewGovernanceSchema, requireSourceRefs: false, kind: 'json' },
];

const summary = [];
const errors = [];
for (const check of checks) {
  const records = !fs.existsSync(check.path)
    ? []
    : check.kind === 'json'
      ? [readJson(check.path)]
      : readJsonl(check.path);
  let countErrors = 0;
  records.forEach((record, idx) => {
    const label = `${check.name}[${idx + 1}]`;
    const recordErrors = [
      ...validateAgainstSchema(record, check.schema, label),
      ...validateSourceRefs(record, label, check.requireSourceRefs),
    ];
    countErrors += recordErrors.length;
    errors.push(...recordErrors);
  });
  summary.push({ name: check.name, total: records.length, errors: countErrors, path: check.path });
}

const out = path.join(compilerDir, 'reports', 'contract-check.latest.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
const report = { ok: errors.length === 0, checkedAt: new Date().toISOString(), version: fs.existsSync(path.join(compilerDir, '.contract-version')) ? fs.readFileSync(path.join(compilerDir, '.contract-version'), 'utf8').trim() : null, summary, errors };
fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
printResult({ ok: report.ok, out, version: report.version, summary, errorCount: errors.length, errors: errors.slice(0, 50) });

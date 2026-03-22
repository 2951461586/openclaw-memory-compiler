#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { printResult } from './lib/io.mjs';

const root = process.cwd();
const reportsDir = path.join(root, 'memory', 'compiler', 'reports');
fs.mkdirSync(reportsDir, { recursive: true });

const contract = {
  minAuthorityScore: 0.58,
  sourceKinds: {
    sum: { authorityWeight: 0.93 },
    file: { authorityWeight: 0.96 },
    mem: { authorityWeight: 0.84 },
    session: { authorityWeight: 0.42 },
    msg: { authorityWeight: 0.72 },
    artifact: { authorityWeight: 0.18 },
    other: { authorityWeight: 0.12 },
  },
};
const weights = Object.fromEntries(Object.entries(contract.sourceKinds).map(([k, v]) => [k, Number(v.authorityWeight || 0)]));
const byBlock = {
  facts: { totalRefs: 2, trustedRefs: 2, sum: 1, file: 1, mem: 0, session: 0, msg: 0, artifact: 0, other: 0 },
  threads: { totalRefs: 1, trustedRefs: 1, sum: 1, file: 0, mem: 0, session: 0, msg: 0, artifact: 0, other: 0 },
  continuity: { totalRefs: 1, trustedRefs: 1, sum: 0, file: 0, mem: 0, session: 1, msg: 0, artifact: 0, other: 0 },
  digests: { totalRefs: 1, trustedRefs: 1, sum: 1, file: 0, mem: 0, session: 0, msg: 0, artifact: 0, other: 0 },
};

function oldScore(mix) {
  const totals = ['facts','threads','continuity','digests'].reduce((acc, key) => {
    const part = mix[key] || {};
    for (const [kind, value] of Object.entries(part)) acc[kind] = (acc[kind] || 0) + Number(value || 0);
    return acc;
  }, {});
  const allRefs = Object.entries(totals).reduce((sum, [, value]) => sum + Number(value || 0), 0);
  const trustedSupport = Number(totals.sum || 0) + Number(totals.file || 0) + Number(totals.mem || 0);
  const weightedTrusted = ['sum', 'file', 'mem'].reduce((sum, kind) => sum + (Number(totals[kind] || 0) * Number(weights[kind] || 0)), 0);
  const weightedDerived = ['session', 'msg', 'artifact', 'other'].reduce((sum, kind) => sum + (Number(totals[kind] || 0) * Number(weights[kind] || 0)), 0);
  return {
    totals,
    allRefs,
    trustedRatio: allRefs > 0 ? Number((trustedSupport / allRefs).toFixed(3)) : 0,
    authorityScore: allRefs > 0 ? Number(((weightedTrusted + weightedDerived) / allRefs).toFixed(3)) : 0,
    supportingKinds: ['sum', 'file', 'mem', 'session', 'msg'].filter(kind => Number(totals[kind] || 0) > 0),
  };
}

function newScore(mix) {
  const refKinds = ['sum', 'file', 'mem', 'session', 'msg', 'artifact', 'other'];
  const totals = ['facts','threads','continuity','digests'].reduce((acc, key) => {
    const part = mix[key] || {};
    acc.totalRefs += Number(part.totalRefs || 0);
    acc.trustedRefs += Number(part.trustedRefs || 0);
    for (const kind of refKinds) acc[kind] += Number(part[kind] || 0);
    return acc;
  }, { totalRefs: 0, trustedRefs: 0, sum: 0, file: 0, mem: 0, session: 0, msg: 0, artifact: 0, other: 0 });
  const actualRefTotal = refKinds.reduce((sum, kind) => sum + Number(totals[kind] || 0), 0);
  const trustedSupport = Number(totals.sum || 0) + Number(totals.file || 0) + Number(totals.mem || 0);
  return {
    totals,
    actualRefTotal,
    trustedRatio: actualRefTotal > 0 ? Number((trustedSupport / actualRefTotal).toFixed(3)) : 0,
    authorityScore: actualRefTotal > 0 ? Number((refKinds.reduce((sum, kind) => sum + (Number(totals[kind] || 0) * Number(weights[kind] || 0)), 0) / actualRefTotal).toFixed(3)) : 0,
    supportingKinds: ['sum', 'file', 'mem'].filter(kind => Number(totals[kind] || 0) > 0),
  };
}

const before = oldScore(byBlock);
const after = newScore(byBlock);
const report = {
  ok: true,
  generatedAt: new Date().toISOString(),
  evidenceCase: 'trusted refs + one session continuity ref + aggregate counters present',
  byBlock,
  before,
  after,
  delta: {
    trustedRatio: Number((after.trustedRatio - before.trustedRatio).toFixed(3)),
    authorityScore: Number((after.authorityScore - before.authorityScore).toFixed(3)),
    supportingKindsRemoved: before.supportingKinds.filter(kind => !after.supportingKinds.includes(kind)),
  },
  interpretation: [
    'before counted aggregate totalRefs/trustedRefs as if they were source kinds, diluting trusted ratio and authority score',
    'after only counts actual source-kind refs, reducing conservative noise',
    'session-derived continuity still contributes to derived pressure but no longer pollutes supportingKinds',
  ],
  evidencePaths: [
    'plugins/memory-compiler/scripts/memory-compiler/lib/runtime-selector-core.mjs',
    'memory/compiler/reports/runtime-source-mix-before-after.latest.json',
  ],
};
const out = path.join(reportsDir, 'runtime-source-mix-before-after.latest.json');
fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
printResult({ ...report, out });

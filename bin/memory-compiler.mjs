#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const pluginRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const configModule = await import(pathToFileURL(path.join(pluginRoot, 'src', 'config.ts')).href);
const commands = await import(pathToFileURL(path.join(pluginRoot, 'src', 'commands.ts')).href);
const { normalizePluginConfig } = configModule;

function usage() {
  console.error(`Usage: memory-compiler <doctor|status|refresh|verify|runtime|handoff|review-triage|review-apply|scheduler-run|scheduler-plan|scheduler-drain|pipeline-run|trigger-execute|digest-compile|hook-dispatch|migrate|acceptance-smoke|acceptance-review-governance|burn-in-run|burn-in-trend|compiler-metrics|import-real-sources|import-durable-memory-batch|operator-review-blocking-triage|orphan-digest|rebuild-replay|runtime-probe|runtime-probe-trend|source-audit|source-backlinks|source-discipline-check|source-kind-diagnostics|fact-arbitrate|fact-dedupe|fact-reconcile|fact-repair-ids|ingest-normalize|runtime-source-mix-before-after|source-discipline-enforce|thread-cluster-apply|thread-lifecycle> [json-file|-]\n`);
  process.exit(2);
}

function readPayload(arg) {
  if (!arg) return {};
  const raw = arg === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(arg, 'utf8');
  return raw.trim() ? JSON.parse(raw) : {};
}

const command = process.argv[2];
if (!command) usage();
const payload = readPayload(process.argv[3]);
const config = normalizePluginConfig({ enabled: true, ...(payload.pluginConfig || {}) });

let result;
if (command === 'doctor') result = await commands.memoryCompilerDoctor(config, payload);
else if (command === 'status') result = await commands.memoryCompilerStatus(config);
else if (command === 'refresh') result = await commands.memoryCompilerRefresh(config, payload);
else if (command === 'verify') result = await commands.memoryCompilerVerify(config, payload);
else if (command === 'runtime') result = await commands.memoryCompilerRuntime(config, payload);
else if (command === 'handoff') result = await commands.memoryCompilerHandoff(config, String(payload.sessionKey || ''), String(payload.reason || 'cli-handoff'));
else if (command === 'review-triage') result = await commands.memoryCompilerReviewTriage(config, payload);
else if (command === 'review-apply') result = await commands.memoryCompilerReviewApply(config, payload);
else if (command === 'scheduler-run') result = await commands.memoryCompilerSchedulerRun(config, payload);
else if (command === 'scheduler-plan') result = await commands.memoryCompilerSchedulerPlan(config, payload);
else if (command === 'scheduler-drain') result = await commands.memoryCompilerSchedulerDrain(config, payload);
else if (command === 'pipeline-run') result = await commands.memoryCompilerPipelineRun(config, payload);
else if (command === 'trigger-execute') result = await commands.memoryCompilerTriggerExecute(config, payload);
else if (command === 'digest-compile') result = await commands.memoryCompilerDigestCompile(config, payload);
else if (command === 'hook-dispatch') result = await commands.memoryCompilerHookDispatch(config, payload);
else if (command === 'migrate') result = await commands.memoryCompilerMigrate(config);
else if (command === 'acceptance-smoke') result = await commands.memoryCompilerAcceptanceSmoke(config, payload);
else if (command === 'acceptance-review-governance') result = await commands.memoryCompilerAcceptanceReviewGovernance(config, payload);
else if (command === 'burn-in-run') result = await commands.memoryCompilerBurnInRun(config, payload);
else if (command === 'burn-in-trend') result = await commands.memoryCompilerBurnInTrend(config, payload);
else if (command === 'compiler-metrics') result = await commands.memoryCompilerCompilerMetrics(config, payload);
else if (command === 'import-real-sources') result = await commands.memoryCompilerImportRealSources(config, payload);
else if (command === 'import-durable-memory-batch') result = await commands.memoryCompilerImportDurableMemoryBatch(config, payload);
else if (command === 'operator-review-blocking-triage') result = await commands.memoryCompilerOperatorReviewBlockingTriage(config, payload);
else if (command === 'orphan-digest') result = await commands.memoryCompilerOrphanDigest(config, payload);
else if (command === 'rebuild-replay') result = await commands.memoryCompilerRebuildReplay(config, payload);
else if (command === 'runtime-probe') result = await commands.memoryCompilerRuntimeProbe(config, payload);
else if (command === 'runtime-probe-trend') result = await commands.memoryCompilerRuntimeProbeTrend(config, payload);
else if (command === 'source-audit') result = await commands.memoryCompilerSourceAudit(config, payload);
else if (command === 'source-backlinks') result = await commands.memoryCompilerSourceBacklinks(config, payload);
else if (command === 'source-discipline-check') result = await commands.memoryCompilerSourceDisciplineCheck(config, payload);
else if (command === 'source-kind-diagnostics') result = await commands.memoryCompilerSourceKindDiagnostics(config, payload);
else if (command === 'fact-arbitrate') result = await commands.memoryCompilerFactArbitrate(config, payload);
else if (command === 'fact-dedupe') result = await commands.memoryCompilerFactDedupe(config, payload);
else if (command === 'fact-reconcile') result = await commands.memoryCompilerFactReconcile(config, payload);
else if (command === 'fact-repair-ids') result = await commands.memoryCompilerFactRepairIds(config, payload);
else if (command === 'ingest-normalize') result = await commands.memoryCompilerIngestNormalize(config, payload);
else if (command === 'runtime-source-mix-before-after') result = await commands.memoryCompilerRuntimeSourceMixBeforeAfter(config, payload);
else if (command === 'source-discipline-enforce') result = await commands.memoryCompilerSourceDisciplineEnforce(config, payload);
else if (command === 'thread-cluster-apply') result = await commands.memoryCompilerThreadClusterApply(config, payload);
else if (command === 'thread-lifecycle') result = await commands.memoryCompilerThreadLifecycle(config, payload);
else usage();

process.stdout.write(JSON.stringify(result, null, 2) + '\n');

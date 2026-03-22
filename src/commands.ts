import fs from "node:fs";
import path from "node:path";
import type { MemoryCompilerPluginConfig } from "./config.ts";
import { initializeMemoryCompilerLayout } from "./init.ts";
import { readStatusSnapshot, refreshControlPlane, verifyControlPlane } from "./control-plane.ts";
import { buildRuntimeContext, runSessionLifecycle } from "./runtime.ts";
import { inspectWorkspaceMigration } from "./migrate.ts";
import { resolveMemoryCompilerPaths } from "./paths.ts";
import { runPluginScript } from "./plugin-script.ts";
import { runWorkspaceScript } from "./workspace-script.ts";
import { buildCoreRuntimeArgs } from "./core/runtime-args.ts";
import { readCompilerStatusEntry } from "./core/status-entry.ts";
import { triageReviewQueueEntry, applyReviewDecisionsEntry } from "./core/review-entry.ts";
import { planSchedulerEntry, runSchedulerEventEntry, drainSchedulerQueueEntry } from "./core/scheduler-entry.ts";
import { runPipelineEntry, triggerExecuteEntry, compileDigestEntry } from "./core/pipeline-entry.ts";

function init(config: MemoryCompilerPluginConfig) {
  initializeMemoryCompilerLayout(config);
  return resolveMemoryCompilerPaths(config);
}

function runScriptByMode<T = any>(config: MemoryCompilerPluginConfig, script: string, payload: Record<string, unknown> = {}): T {
  const paths = init(config);
  return runPluginScript<T>(paths, script, payload);
}

function exists(filePath: string) {
  try { return fs.existsSync(filePath); } catch { return false; }
}

function maybeReadJson<T = any>(filePath: string): T | null {
  try {
    return exists(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf8")) as T : null;
  } catch {
    return null;
  }
}

function relativePathOrSelf(base: string, filePath: string) {
  try {
    return path.relative(base, filePath) || ".";
  } catch {
    return filePath;
  }
}

function buildLegacyCompatSummary(config: MemoryCompilerPluginConfig, paths: ReturnType<typeof resolveMemoryCompilerPaths>) {
  const legacyScriptsPath = path.join(paths.workspaceDir, "scripts", "memory-compiler");
  const legacyDocsPath = path.join(paths.workspaceDir, "reports", "openclaw-memory-compiler");
  const legacyBridgePath = path.join(paths.workspaceDir, "plugins", "memory-compiler-bridge");
  const runtimeDataPath = path.join(paths.workspaceDir, "memory", "compiler");
  const docsDirStillLegacyDefault = relativePathOrSelf(paths.workspaceDir, paths.docsDir) === "reports/openclaw-memory-compiler";

  const surfaces = [
    {
      key: "legacy-scripts",
      title: "workspace scripts/memory-compiler",
      path: legacyScriptsPath,
      exists: exists(legacyScriptsPath),
      category: "shrink-convert",
      operatorState: exists(legacyScriptsPath) ? "compat-archive-only" : "absent",
      retirement: "ready",
      destructiveReady: true,
      reasons: exists(legacyScriptsPath)
        ? ["workspace script fallback has been removed; any remaining scripts/memory-compiler content is retirement-only residue"]
        : ["workspace scripts fallback is already absent"],
    },
    {
      key: "legacy-docs",
      title: "workspace reports/openclaw-memory-compiler",
      path: legacyDocsPath,
      exists: exists(legacyDocsPath),
      category: "demote-primary",
      operatorState: docsDirStillLegacyDefault ? "still-default" : (exists(legacyDocsPath) ? "compat-mirror" : "absent"),
      configuredPath: paths.docsDir,
      retirement: docsDirStillLegacyDefault ? "blocked" : (exists(legacyDocsPath) ? "defer" : "ready"),
      destructiveReady: !docsDirStillLegacyDefault && !exists(legacyDocsPath),
      reasons: docsDirStillLegacyDefault
        ? [`docsDir still points at ${relativePathOrSelf(paths.workspaceDir, paths.docsDir)}`]
        : exists(legacyDocsPath)
          ? ["legacy docs/contracts directory still exists; retire only after fixtures/evidence no longer rely on it"]
          : ["docs/contracts are no longer pointing at the legacy workspace path"],
    },
    {
      key: "compat-bridge",
      title: "plugins/memory-compiler-bridge",
      path: legacyBridgePath,
      exists: exists(legacyBridgePath),
      category: "shrink-convert",
      operatorState: exists(legacyBridgePath) ? "compat-only" : "absent",
      retirement: exists(legacyBridgePath) ? "defer" : "ready",
      destructiveReady: !exists(legacyBridgePath),
      reasons: exists(legacyBridgePath)
        ? ["compatibility bridge is still present; retire only after all nodes/configs stop depending on bridge injection"]
        : ["compatibility bridge path is already absent"],
    },
    {
      key: "runtime-data",
      title: "memory/compiler runtime data",
      path: runtimeDataPath,
      exists: exists(runtimeDataPath),
      category: "keep",
      operatorState: "active-runtime-root",
      retirement: "keep",
      destructiveReady: false,
      reasons: ["memory/compiler is the active runtime/data root and is not a legacy deletion target"],
    },
  ];

  const blocking = surfaces.filter((item) => item.retirement === "blocked");
  const deferred = surfaces.filter((item) => item.retirement === "defer");
  const overall = blocking.length > 0
    ? "not-ready"
    : deferred.length > 0
      ? "preflight-only"
      : "ready-for-manual-retirement";
  const nextActions: string[] = [];
  if (blocking.some((item) => item.key === "legacy-scripts")) nextActions.push("switch operators/nodes to plugin-preferred before retiring workspace scripts");
  if (blocking.some((item) => item.key === "legacy-docs")) nextActions.push("move docsDir/config/fixtures away from reports/openclaw-memory-compiler before deleting the legacy docs path");
  if (!docsDirStillLegacyDefault) nextActions.push("keep plugin docs authoritative and treat reports/openclaw-memory-compiler as compatibility-only evidence during retirement preflight");
  if (deferred.some((item) => item.key === "compat-bridge")) nextActions.push("confirm no node config still enables memory-compiler-bridge before retiring the bridge");
  if (deferred.some((item) => item.key === "legacy-scripts")) nextActions.push("keep scripts/memory-compiler archive-biased: wrappers/compat only, no new primary operator flows");
  nextActions.push("do not delete memory/compiler as part of legacy cleanup");

  const summaryText = blocking.length > 0
    ? `legacy retirement blocked by: ${blocking.map((item) => item.key).join(", ")}`
    : deferred.length > 0
      ? `legacy retirement still in preflight: ${deferred.map((item) => item.key).join(", ")}`
      : "legacy workspace surfaces are no longer blocking manual retirement preflight";

  return {
    overall,
    summaryText,
    destructiveReady: overall === "ready-for-manual-retirement",
    blockingKeys: blocking.map((item) => item.key),
    deferredKeys: deferred.map((item) => item.key),
    buckets: {
      keep: surfaces.filter((item) => item.category === "keep").map((item) => item.key),
      shrinkConvert: surfaces.filter((item) => item.category === "shrink-convert").map((item) => item.key),
      demotePrimary: surfaces.filter((item) => item.category === "demote-primary").map((item) => item.key),
    },
    safeNow: [
      "treat plugin docs as the authoritative default docs/contracts surface",
      "treat reports/openclaw-memory-compiler as compatibility-only evidence during retirement preflight",
      "treat scripts/memory-compiler as compat/archive-biased, not primary ownership",
      "leave memory/compiler in place as the active runtime/data root",
    ],
    unsafeNow: [
      "do not delete memory/compiler",
      ...(exists(legacyScriptsPath) ? ["scripts/memory-compiler can be archived/removed once any out-of-band local operators stop pointing at it"] : []),
      ...(blocking.some((item) => item.key === "legacy-docs") || deferred.some((item) => item.key === "legacy-docs") ? ["do not delete reports/openclaw-memory-compiler yet"] : []),
      ...(deferred.some((item) => item.key === "compat-bridge") ? ["do not delete plugins/memory-compiler-bridge until all node configs stop depending on it"] : []),
    ],
    surfaces,
    nextActions,
  };
}

export async function memoryCompilerDoctor(config: MemoryCompilerPluginConfig) {
  const paths = init(config);
  const pkgPath = path.join(paths.pluginRoot, "package.json");
  const manifestPath = path.join(paths.pluginRoot, "openclaw.plugin.json");
  const readmePath = path.join(paths.pluginRoot, "README.md");
  const migrationPath = path.join(paths.pluginRoot, "MIGRATION.md");
  const layoutPath = path.join(paths.dataDir, "plugin-layout.json");
  const contractVersionPath = path.join(paths.dataDir, ".contract-version");
  const verifyPath = path.join(paths.reportsDir, "control-plane-verify.latest.json");
  const runtimeProbePath = path.join(paths.reportsDir, "runtime-probe.latest.json");
  const pkg = maybeReadJson<any>(pkgPath);
  const manifest = maybeReadJson<any>(manifestPath);
  const status = maybeReadJson<any>(paths.controlPlaneStatusPath);
  const verify = maybeReadJson<any>(verifyPath);
  const runtimeProbe = maybeReadJson<any>(runtimeProbePath);

  const userGatewayUnitPath = process.env.HOME
    ? path.join(process.env.HOME, ".config", "systemd", "user", "openclaw-gateway.service")
    : null;
  const checks = [
    { name: "package-json-present", ok: !!pkg, path: pkgPath },
    { name: "plugin-manifest-present", ok: !!manifest, path: manifestPath },
    { name: "readme-present", ok: exists(readmePath), path: readmePath },
    { name: "migration-doc-present", ok: exists(migrationPath), path: migrationPath },
    { name: "cli-bin-present", ok: typeof pkg?.bin?.["memory-compiler"] === "string", bin: pkg?.bin || null },
    { name: "openclaw-extension-present", ok: Array.isArray(pkg?.openclaw?.extensions) && pkg.openclaw.extensions.length >= 1, extensions: pkg?.openclaw?.extensions || [] },
    { name: "workspace-dir-present", ok: exists(paths.workspaceDir), path: paths.workspaceDir },
    { name: "data-dir-present", ok: exists(paths.dataDir), path: paths.dataDir },
    { name: "reports-dir-present", ok: exists(paths.reportsDir), path: paths.reportsDir },
    { name: "runtime-dir-present", ok: exists(paths.runtimeDir), path: paths.runtimeDir },
    { name: "layout-meta-present", ok: exists(layoutPath), path: layoutPath },
    { name: "contract-version-present", ok: exists(contractVersionPath), path: contractVersionPath },
  ];
  const failed = checks.filter((x) => !x.ok);
  const warnings: string[] = [];
  if (config.controlPlaneMode !== "plugin-preferred") warnings.push("controlPlaneMode is pinned to plugin-preferred; non-plugin execution is no longer supported");
  if (!exists(paths.sessionStatePath)) warnings.push("sessionStatePath is missing; session lifecycle / handoff flows will have reduced continuity context");
  if (!exists(paths.workingBufferPath)) warnings.push("workingBufferPath is missing; optional, but recommended for long-running / compaction-heavy work");
  if (!status) warnings.push("control-plane status snapshot not built yet; run migrate -> refresh -> verify after install");
  if (!verify) warnings.push("control-plane verify report not present yet; run verify after first refresh");
  if (!runtimeProbe) warnings.push("runtime-probe report not present yet; optional, but recommended before claiming runtime readiness");
  if (userGatewayUnitPath && exists(userGatewayUnitPath)) warnings.push("openclaw-gateway is commonly installed as a systemd --user service on Linux; check it with `systemctl --user status openclaw-gateway.service`, not the system-wide `systemctl status`");

  const legacyCompat = buildLegacyCompatSummary(config, paths);
  const gatewayScopeHint = {
    present: !!userGatewayUnitPath && exists(userGatewayUnitPath),
    serviceName: "openclaw-gateway.service",
    recommendedScope: "systemd --user",
    recommendedCommand: "systemctl --user status openclaw-gateway.service",
    avoidCommand: "systemctl status openclaw-gateway.service",
    reason: "On Linux hosts where OpenClaw gateway is installed as a user unit, the system-wide systemctl scope can falsely look inactive while the user service is actually running.",
    unitPath: userGatewayUnitPath,
  };
  const nextActions = [
    ...(gatewayScopeHint.present ? [{
      title: "check gateway service in the correct systemd scope",
      command: gatewayScopeHint.recommendedCommand,
      recommended: true,
      note: `Avoid ${gatewayScopeHint.avoidCommand}; ${gatewayScopeHint.reason}`,
    }] : []),
    { title: "inspect install surface", command: "node ./bin/memory-compiler.mjs doctor -", recommended: true },
    { title: "inspect migration/layout status", command: "node ./bin/memory-compiler.mjs migrate -", recommended: true },
    { title: "build control-plane snapshot", command: "node ./bin/memory-compiler.mjs refresh - <<'JSON'\n{\n  \"pluginConfig\": {\n    \"enabled\": true,\n    \"controlPlaneMode\": \"plugin-preferred\"\n  }\n}\nJSON", recommended: !status },
    { title: "verify trusted operator status", command: "node ./bin/memory-compiler.mjs verify - <<'JSON'\n{\n  \"pluginConfig\": {\n    \"enabled\": true,\n    \"controlPlaneMode\": \"plugin-preferred\"\n  }\n}\nJSON", recommended: !verify },
    { title: "inspect legacy retirement readiness", command: "node ./bin/memory-compiler.mjs doctor -", recommended: true, note: legacyCompat.summaryText },
  ];

  return {
    ok: failed.length === 0,
    generatedAt: new Date().toISOString(),
    plugin: {
      id: manifest?.id || "memory-compiler",
      version: manifest?.version || pkg?.version || null,
      kind: manifest?.kind || null,
      pluginRoot: paths.pluginRoot,
      cliBin: pkg?.bin?.["memory-compiler"] || null,
    },
    mode: config.controlPlaneMode,
    workspaceDir: paths.workspaceDir,
    paths: {
      dataDir: paths.dataDir,
      reportsDir: paths.reportsDir,
      runtimeDir: paths.runtimeDir,
      docsDir: paths.docsDir,
      sessionStatePath: paths.sessionStatePath,
      workingBufferPath: paths.workingBufferPath,
      dailyMemoryDir: paths.dailyMemoryDir,
      statusPath: paths.controlPlaneStatusPath,
      overviewPath: paths.controlPlaneOverviewPath,
    },
    gatewayScopeHint,
    checks,
    failedCount: failed.length,
    failed,
    warnings,
    legacyCompat,
    controlPlane: {
      statusPresent: !!status,
      verifyPresent: !!verify,
      runtimeProbePresent: !!runtimeProbe,
      trustLevel: verify?.trustLevel || null,
      operatorVerdict: verify?.operatorVerdict || null,
    },
    nextActions,
  };
}

export async function memoryCompilerStatus(config: MemoryCompilerPluginConfig) {
  const paths = init(config);
  const status = await readCompilerStatusEntry(paths);
  return {
    ok: true,
    workspaceDir: paths.workspaceDir,
    statusPath: paths.controlPlaneStatusPath,
    overviewPath: paths.controlPlaneOverviewPath,
    status,
    ...status,
  };
}

export async function memoryCompilerRefresh(config: MemoryCompilerPluginConfig, payload: Record<string, unknown> = {}) {
  init(config);
  return refreshControlPlane(config, payload);
}

export async function memoryCompilerVerify(config: MemoryCompilerPluginConfig, payload: Record<string, unknown> = {}) {
  init(config);
  return verifyControlPlane(config, payload);
}

export async function memoryCompilerRuntime(config: MemoryCompilerPluginConfig, payload: Record<string, unknown> = {}) {
  init(config);
  return buildRuntimeContext(config, payload);
}

export async function memoryCompilerHandoff(config: MemoryCompilerPluginConfig, sessionKey: string, reason?: string) {
  init(config);
  return runSessionLifecycle(config, sessionKey, reason || "manual-handoff");
}

export async function memoryCompilerReviewTriage(config: MemoryCompilerPluginConfig, payload: Record<string, unknown> = {}) {
  const paths = init(config);
  return triageReviewQueueEntry(config, paths, payload);
}

export async function memoryCompilerReviewApply(config: MemoryCompilerPluginConfig, payload: Record<string, unknown> = {}) {
  const paths = init(config);
  return applyReviewDecisionsEntry(config, paths, payload);
}

export async function memoryCompilerMigrate(config: MemoryCompilerPluginConfig) {
  init(config);
  return inspectWorkspaceMigration(config);
}

export async function memoryCompilerSchedulerRun(config: MemoryCompilerPluginConfig, payload: Record<string, unknown> = {}) {
  const paths = init(config);
  return runSchedulerEventEntry(config, paths, payload);
}

export async function memoryCompilerSchedulerPlan(config: MemoryCompilerPluginConfig, payload: Record<string, unknown> = {}) {
  const paths = init(config);
  return planSchedulerEntry(config, paths, payload);
}

export async function memoryCompilerSchedulerDrain(config: MemoryCompilerPluginConfig, payload: Record<string, unknown> = {}) {
  const paths = init(config);
  return drainSchedulerQueueEntry(config, paths, payload);
}

export async function memoryCompilerPipelineRun(config: MemoryCompilerPluginConfig, payload: Record<string, unknown> = {}) {
  const paths = init(config);
  return runPipelineEntry(config, paths, payload);
}

export async function memoryCompilerTriggerExecute(config: MemoryCompilerPluginConfig, payload: Record<string, unknown> = {}) {
  const paths = init(config);
  return triggerExecuteEntry(config, paths, payload);
}

export async function memoryCompilerDigestCompile(config: MemoryCompilerPluginConfig, payload: Record<string, unknown> = {}) {
  const paths = init(config);
  return compileDigestEntry(config, paths, payload);
}

export async function memoryCompilerHookDispatch(config: MemoryCompilerPluginConfig, payload: Record<string, unknown> = {}) {
  return runScriptByMode(config, "hook-dispatch.mjs", payload);
}

export async function memoryCompilerAcceptanceSmoke(config: MemoryCompilerPluginConfig, payload: Record<string, unknown> = {}) {
  return runScriptByMode(config, "acceptance-smoke.mjs", payload);
}

export async function memoryCompilerAcceptanceReviewGovernance(config: MemoryCompilerPluginConfig, payload: Record<string, unknown> = {}) {
  return runScriptByMode(config, "acceptance-review-governance.mjs", payload);
}

export async function memoryCompilerBurnInRun(config: MemoryCompilerPluginConfig, payload: Record<string, unknown> = {}) {
  return runScriptByMode(config, "burn-in-run.mjs", payload);
}

export async function memoryCompilerBurnInTrend(config: MemoryCompilerPluginConfig, payload: Record<string, unknown> = {}) {
  return runScriptByMode(config, "burn-in-trend.mjs", payload);
}

export async function memoryCompilerCompilerMetrics(config: MemoryCompilerPluginConfig, payload: Record<string, unknown> = {}) {
  return runScriptByMode(config, "compiler-metrics.mjs", payload);
}

export async function memoryCompilerImportRealSources(config: MemoryCompilerPluginConfig, payload: Record<string, unknown> = {}) {
  return runScriptByMode(config, "import-real-sources.mjs", payload);
}

export async function memoryCompilerImportDurableMemoryBatch(config: MemoryCompilerPluginConfig, payload: Record<string, unknown> = {}) {
  return runScriptByMode(config, "import-durable-memory-batch.mjs", payload);
}

export async function memoryCompilerOperatorReviewBlockingTriage(config: MemoryCompilerPluginConfig, payload: Record<string, unknown> = {}) {
  return runScriptByMode(config, "operator-review-blocking-triage.mjs", payload);
}

export async function memoryCompilerOrphanDigest(config: MemoryCompilerPluginConfig, payload: Record<string, unknown> = {}) {
  return runScriptByMode(config, "orphan-digest.mjs", payload);
}

export async function memoryCompilerRebuildReplay(config: MemoryCompilerPluginConfig, payload: Record<string, unknown> = {}) {
  return runScriptByMode(config, "rebuild-replay.mjs", payload);
}

export async function memoryCompilerRuntimeProbe(config: MemoryCompilerPluginConfig, payload: Record<string, unknown> = {}) {
  return runScriptByMode(config, "runtime-probe.mjs", payload);
}

export async function memoryCompilerRuntimeProbeTrend(config: MemoryCompilerPluginConfig, payload: Record<string, unknown> = {}) {
  return runScriptByMode(config, "runtime-probe-trend.mjs", payload);
}

export async function memoryCompilerSourceAudit(config: MemoryCompilerPluginConfig, payload: Record<string, unknown> = {}) {
  return runScriptByMode(config, "source-audit.mjs", payload);
}

export async function memoryCompilerSourceBacklinks(config: MemoryCompilerPluginConfig, payload: Record<string, unknown> = {}) {
  return runScriptByMode(config, "source-backlinks.mjs", payload);
}

export async function memoryCompilerSourceDisciplineCheck(config: MemoryCompilerPluginConfig, payload: Record<string, unknown> = {}) {
  return runScriptByMode(config, "source-discipline-check.mjs", payload);
}

export async function memoryCompilerSourceKindDiagnostics(config: MemoryCompilerPluginConfig, payload: Record<string, unknown> = {}) {
  return runScriptByMode(config, "source-kind-diagnostics.mjs", payload);
}

export async function memoryCompilerFactArbitrate(config: MemoryCompilerPluginConfig, payload: Record<string, unknown> = {}) {
  return runScriptByMode(config, "fact-arbitrate.mjs", payload);
}

export async function memoryCompilerFactDedupe(config: MemoryCompilerPluginConfig, payload: Record<string, unknown> = {}) {
  return runScriptByMode(config, "fact-dedupe.mjs", payload);
}

export async function memoryCompilerFactReconcile(config: MemoryCompilerPluginConfig, payload: Record<string, unknown> = {}) {
  return runScriptByMode(config, "fact-reconcile.mjs", payload);
}

export async function memoryCompilerFactRepairIds(config: MemoryCompilerPluginConfig, payload: Record<string, unknown> = {}) {
  return runScriptByMode(config, "fact-repair-ids.mjs", payload);
}

export async function memoryCompilerIngestNormalize(config: MemoryCompilerPluginConfig, payload: Record<string, unknown> = {}) {
  return runScriptByMode(config, "ingest-normalize.mjs", payload);
}

export async function memoryCompilerRuntimeSourceMixBeforeAfter(config: MemoryCompilerPluginConfig, payload: Record<string, unknown> = {}) {
  return runScriptByMode(config, "runtime-source-mix-before-after.mjs", payload);
}

export async function memoryCompilerSourceDisciplineEnforce(config: MemoryCompilerPluginConfig, payload: Record<string, unknown> = {}) {
  return runScriptByMode(config, "source-discipline-enforce.mjs", payload);
}

export async function memoryCompilerThreadClusterApply(config: MemoryCompilerPluginConfig, payload: Record<string, unknown> = {}) {
  return runScriptByMode(config, "thread-cluster-apply.mjs", payload);
}

export async function memoryCompilerThreadLifecycle(config: MemoryCompilerPluginConfig, payload: Record<string, unknown> = {}) {
  return runScriptByMode(config, "thread-lifecycle.mjs", payload);
}

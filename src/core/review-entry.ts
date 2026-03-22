import type { MemoryCompilerPluginConfig } from "../config.ts";
import type { MemoryCompilerPaths } from "../paths.ts";
import { importPluginScriptCoreModule, importPluginScriptModule } from "../plugin-module.ts";
import { buildCoreRuntimeArgs } from "./runtime-args.ts";

export async function triageReviewQueueEntry(
  _config: MemoryCompilerPluginConfig,
  paths: MemoryCompilerPaths,
  payload: Record<string, unknown> = {},
) {
  const mod = await importPluginScriptCoreModule<any>("review-triage-core.mjs");
  return mod.triageReviewQueue({ root: paths.workspaceDir, paths, ...payload });
}

export async function applyReviewDecisionsEntry(
  _config: MemoryCompilerPluginConfig,
  paths: MemoryCompilerPaths,
  payload: Record<string, unknown> = {},
) {
  const mod = await importPluginScriptModule<any>("review-apply.mjs");
  return mod.applyReviewDecisions(payload, buildCoreRuntimeArgs(paths));
}

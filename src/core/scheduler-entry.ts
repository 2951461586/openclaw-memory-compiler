import type { MemoryCompilerPluginConfig } from "../config.ts";
import type { MemoryCompilerPaths } from "../paths.ts";
import { importPluginScriptModule } from "../plugin-module.ts";
import { buildCoreRuntimeArgs } from "./runtime-args.ts";

export async function planSchedulerEntry(
  _config: MemoryCompilerPluginConfig,
  paths: MemoryCompilerPaths,
  payload: Record<string, unknown> = {},
) {
  const mod = await importPluginScriptModule<any>("scheduler-plan.mjs");
  return mod.planScheduler(payload, buildCoreRuntimeArgs(paths));
}

export async function runSchedulerEventEntry(
  _config: MemoryCompilerPluginConfig,
  paths: MemoryCompilerPaths,
  payload: Record<string, unknown> = {},
) {
  const mod = await importPluginScriptModule<any>("scheduler-run.mjs");
  return mod.runSchedulerEvent(payload, buildCoreRuntimeArgs(paths));
}

export async function drainSchedulerQueueEntry(
  _config: MemoryCompilerPluginConfig,
  paths: MemoryCompilerPaths,
  payload: Record<string, unknown> = {},
) {
  const mod = await importPluginScriptModule<any>("scheduler-drain.mjs");
  return mod.drainSchedulerQueue(payload, buildCoreRuntimeArgs(paths));
}

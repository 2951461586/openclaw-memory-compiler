import type { MemoryCompilerPluginConfig } from "../config.ts";
import type { MemoryCompilerPaths } from "../paths.ts";
import { importPluginScriptModule } from "../plugin-module.ts";
import { buildCoreRuntimeArgs } from "./runtime-args.ts";

export async function runPipelineEntry(
  _config: MemoryCompilerPluginConfig,
  paths: MemoryCompilerPaths,
  payload: Record<string, unknown> = {},
) {
  const mod = await importPluginScriptModule<any>("pipeline-run.mjs");
  return mod.runPipeline(payload, buildCoreRuntimeArgs(paths));
}

export async function triggerExecuteEntry(
  _config: MemoryCompilerPluginConfig,
  paths: MemoryCompilerPaths,
  payload: Record<string, unknown> = {},
) {
  const mod = await importPluginScriptModule<any>("trigger-execute.mjs");
  return mod.triggerExecute(payload, buildCoreRuntimeArgs(paths));
}

export async function compileDigestEntry(
  _config: MemoryCompilerPluginConfig,
  paths: MemoryCompilerPaths,
  payload: Record<string, unknown> = {},
) {
  const mod = await importPluginScriptModule<any>("digest-compiler.mjs");
  return mod.compileDigest(payload, buildCoreRuntimeArgs(paths));
}

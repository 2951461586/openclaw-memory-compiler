import type { MemoryCompilerPluginConfig } from "../config.ts";
import type { MemoryCompilerPaths } from "../paths.ts";
import { importPluginScriptCoreModule } from "../plugin-module.ts";

export async function generateRuntimeBridgeContextEntry(
  _config: MemoryCompilerPluginConfig,
  paths: MemoryCompilerPaths,
  payload: Record<string, unknown>,
) {
  const runtimeModule = await importPluginScriptCoreModule<any>("runtime-bridge-core.mjs");
  return runtimeModule.generateRuntimeBridgeContext({ root: paths.workspaceDir, payload, paths });
}

export async function applySessionPackLifecycleEntry(
  _config: MemoryCompilerPluginConfig,
  paths: MemoryCompilerPaths,
  payload: Record<string, unknown>,
) {
  const lifecycleModule = await importPluginScriptCoreModule<any>("session-pack-lifecycle-core.mjs");
  return lifecycleModule.applySessionPackLifecycle({ root: paths.workspaceDir, payload: { ...payload, paths }, paths });
}

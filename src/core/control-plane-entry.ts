import type { MemoryCompilerPluginConfig } from "../config.ts";
import type { MemoryCompilerPaths } from "../paths.ts";
import { importPluginScriptCoreModule } from "../plugin-module.ts";

async function importControlPlaneModule(_config: MemoryCompilerPluginConfig, _paths: MemoryCompilerPaths) {
  return importPluginScriptCoreModule<any>("control-plane-core.mjs");
}

export async function refreshControlPlaneEntry(
  config: MemoryCompilerPluginConfig,
  paths: MemoryCompilerPaths,
  payload: Record<string, unknown> = {},
) {
  const mod = await importControlPlaneModule(config, paths);
  if (typeof mod.refreshControlPlane === "function") {
    return mod.refreshControlPlane({ root: paths.workspaceDir, payload, paths });
  }
  return { ok: false, reason: "refreshControlPlane-export-missing", workspaceDir: paths.workspaceDir };
}

export async function verifyControlPlaneEntry(
  _config: MemoryCompilerPluginConfig,
  paths: MemoryCompilerPaths,
  payload: Record<string, unknown> = {},
) {
  const mod = await importPluginScriptCoreModule<any>("control-plane-core.mjs");
  if (typeof mod.verifyControlPlane === "function") {
    return mod.verifyControlPlane({ root: paths.workspaceDir, payload, paths });
  }
  return { ok: false, reason: "verifyControlPlane-export-missing", workspaceDir: paths.workspaceDir };
}

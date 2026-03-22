import fs from "node:fs";
import type { MemoryCompilerPluginConfig } from "./config.ts";
import { resolveMemoryCompilerPaths } from "./paths.ts";
import { refreshControlPlaneEntry, verifyControlPlaneEntry } from "./core/control-plane-entry.ts";

export async function refreshControlPlane(config: MemoryCompilerPluginConfig, payload: Record<string, unknown> = {}) {
  const paths = resolveMemoryCompilerPaths(config);
  return refreshControlPlaneEntry(config, paths, payload);
}

export async function verifyControlPlane(config: MemoryCompilerPluginConfig, payload: Record<string, unknown> = {}) {
  const paths = resolveMemoryCompilerPaths(config);
  return verifyControlPlaneEntry(config, paths, payload);
}

export async function readStatusSnapshot(config: MemoryCompilerPluginConfig, options: { refresh?: boolean } = {}) {
  const paths = resolveMemoryCompilerPaths(config);
  if (options.refresh) {
    await refreshControlPlane(config, {});
  }
  const status = fs.existsSync(paths.controlPlaneStatusPath)
    ? JSON.parse(fs.readFileSync(paths.controlPlaneStatusPath, "utf8"))
    : null;
  return {
    ok: true,
    workspaceDir: paths.workspaceDir,
    statusPath: paths.controlPlaneStatusPath,
    overviewPath: paths.controlPlaneOverviewPath,
    status,
  };
}

import path from "node:path";
import os from "node:os";
import type { MemoryCompilerPluginConfig } from "./config.ts";

export interface MemoryCompilerPaths {
  workspaceDir: string;
  dataDir: string;
  reportsDir: string;
  runtimeDir: string;
  docsDir: string;
  sessionStatePath: string;
  workingBufferPath: string;
  dailyMemoryDir: string;
  controlPlaneStatusPath: string;
  controlPlaneOverviewPath: string;
  schemasDir: string;
  pluginRoot: string;
}

function resolveRelativeToWorkspace(workspaceDir: string, candidate: string): string {
  return path.isAbsolute(candidate) ? candidate : path.resolve(workspaceDir, candidate);
}

function resolvePathCandidate(workspaceDir: string, pluginRoot: string, candidate: string): string {
  if (path.isAbsolute(candidate)) return candidate;
  if (candidate.startsWith("plugin:")) return path.resolve(pluginRoot, candidate.slice("plugin:".length));
  return path.resolve(workspaceDir, candidate);
}

function resolveRelativeToPluginRoot(pluginRoot: string, candidate: string): string {
  return path.isAbsolute(candidate) ? candidate : path.resolve(pluginRoot, candidate);
}

export function resolveWorkspaceDir(explicit?: string): string {
  if (explicit?.trim()) return explicit.trim();
  const home = process.env.HOME?.trim() || os.homedir() || "";
  if (home) return path.join(home, ".openclaw", "workspace");
  return process.cwd();
}

export function resolvePluginRoot(): string {
  return path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
}

export function resolveMemoryCompilerPaths(config: MemoryCompilerPluginConfig): MemoryCompilerPaths {
  const workspaceDir = resolveWorkspaceDir(config.workspaceDir);
  const pluginRoot = resolvePluginRoot();
  const dataDir = resolveRelativeToWorkspace(workspaceDir, config.dataDir);
  const reportsDir = resolveRelativeToWorkspace(workspaceDir, config.reportsDir);
  const runtimeDir = resolveRelativeToWorkspace(workspaceDir, config.runtimeDir);
  const docsDir = resolvePathCandidate(workspaceDir, pluginRoot, config.docsDir);
  const sessionStatePath = resolveRelativeToWorkspace(workspaceDir, config.sessionStatePath);
  const workingBufferPath = resolveRelativeToWorkspace(workspaceDir, config.workingBufferPath);
  const dailyMemoryDir = resolveRelativeToWorkspace(workspaceDir, config.dailyMemoryDir);
  const schemasDir = resolveRelativeToPluginRoot(pluginRoot, "contracts/schemas");
  return {
    workspaceDir,
    dataDir,
    reportsDir,
    runtimeDir,
    docsDir,
    sessionStatePath,
    workingBufferPath,
    dailyMemoryDir,
    controlPlaneStatusPath: path.join(dataDir, "control-plane", "status.json"),
    controlPlaneOverviewPath: path.join(dataDir, "control-plane", "overview.md"),
    schemasDir,
    pluginRoot,
  };
}

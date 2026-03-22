import fs from "node:fs";
import path from "node:path";
import type { MemoryCompilerPluginConfig } from "./config.ts";
import { resolveMemoryCompilerPaths } from "./paths.ts";

export function initializeMemoryCompilerLayout(config: MemoryCompilerPluginConfig) {
  const paths = resolveMemoryCompilerPaths(config);
  const dirs = [
    paths.dataDir,
    paths.runtimeDir,
    paths.reportsDir,
    path.join(paths.dataDir, "control-plane"),
    path.join(paths.dataDir, "source-links"),
    path.join(paths.dataDir, "session-packs"),
    path.join(paths.dataDir, "session-packs", "handoffs"),
    path.join(paths.dataDir, "digests"),
    path.join(paths.dataDir, "digests", "today"),
    path.join(paths.dataDir, "digests", "week"),
    path.join(paths.dataDir, "digests", "narrative"),
    path.join(paths.dataDir, "digests", "manifests"),
    path.join(paths.dataDir, "imports"),
    path.join(paths.reportsDir, "archives"),
  ];
  for (const dir of dirs) fs.mkdirSync(dir, { recursive: true });

  const contractVersionPath = path.join(paths.dataDir, ".contract-version");
  if (!fs.existsSync(contractVersionPath)) {
    fs.writeFileSync(contractVersionPath, "plugin-shell.v1\n");
  }

  const metaPath = path.join(paths.dataDir, "plugin-layout.json");
  const meta = {
    plugin: "memory-compiler",
    initializedAt: new Date().toISOString(),
    workspaceDir: paths.workspaceDir,
    dataDir: paths.dataDir,
    runtimeDir: paths.runtimeDir,
    reportsDir: paths.reportsDir,
    docsDir: paths.docsDir,
    sessionStatePath: paths.sessionStatePath,
    workingBufferPath: paths.workingBufferPath,
    dailyMemoryDir: paths.dailyMemoryDir,
  };
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n");

  return { ok: true, paths, metaPath };
}

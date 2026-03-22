import fs from "node:fs";
import path from "node:path";
import type { MemoryCompilerPluginConfig } from "./config.ts";
import { resolveMemoryCompilerPaths } from "./paths.ts";
import { initializeMemoryCompilerLayout } from "./init.ts";

function exists(p: string) {
  try { return fs.existsSync(p); } catch { return false; }
}

export function inspectWorkspaceMigration(config: MemoryCompilerPluginConfig) {
  const paths = resolveMemoryCompilerPaths(config);
  initializeMemoryCompilerLayout(config);

  const legacy = {
    scriptsDir: path.join(paths.workspaceDir, "scripts", "memory-compiler"),
    bridgePluginDir: path.join(paths.workspaceDir, "plugins", "memory-compiler-bridge"),
    reportsDocsDir: path.join(paths.workspaceDir, "reports", "openclaw-memory-compiler"),
    compilerDataDir: path.join(paths.workspaceDir, "memory", "compiler"),
    sessionStatePath: path.join(paths.workspaceDir, "SESSION-STATE.md"),
    workingBufferPath: path.join(paths.workspaceDir, "memory", "working-buffer.md"),
  };

  const result = {
    ok: true,
    mode: "plugin-preferred",
    workspaceDir: paths.workspaceDir,
    pluginDataDir: paths.dataDir,
    pluginReportsDir: paths.reportsDir,
    pluginDocsDir: paths.docsDir,
    pluginRuntimeDir: paths.runtimeDir,
    compat: {
      legacyScriptsPresent: exists(legacy.scriptsDir),
      legacyBridgePresent: exists(legacy.bridgePluginDir),
      legacyDocsPresent: exists(legacy.reportsDocsDir),
      legacyDataPresent: exists(legacy.compilerDataDir),
      sessionStatePresent: exists(legacy.sessionStatePath),
      workingBufferPresent: exists(legacy.workingBufferPath),
      workspaceScriptFallbackSupported: false,
      bridgeRequiredByPlugin: false,
    },
    migrationPlan: [
      "Initialize plugin-owned runtime/data/report directories.",
      "Keep reading existing memory/compiler data in place unless operator explicitly relocates dataDir.",
      "Use plugin entry as the only supported runtime/control-plane boundary.",
      "Migrate high-value wrappers first: runtime bridge, session lifecycle, control-plane status/verify/refresh, imports.",
      "Treat scripts/memory-compiler and memory-compiler-bridge as retirement residue / compat evidence only.",
    ],
    nonDestructive: true,
  };

  const out = path.join(paths.dataDir, "migration-status.json");
  fs.writeFileSync(out, JSON.stringify(result, null, 2) + "\n");
  return { ...result, out };
}

import type { MemoryCompilerPaths } from "../paths.ts";

export function buildCoreRuntimeArgs(paths: MemoryCompilerPaths) {
  return {
    workspaceDir: paths.workspaceDir,
    dataDir: paths.dataDir,
    runtimeDir: paths.runtimeDir,
    reportsDir: paths.reportsDir,
    docsDir: paths.docsDir,
    schemasDir: paths.schemasDir,
    sessionStatePath: paths.sessionStatePath,
    workingBufferPath: paths.workingBufferPath,
    dailyMemoryDir: paths.dailyMemoryDir,
    controlPlaneDir: `${paths.dataDir}/control-plane`,
    sessionPacksDir: `${paths.dataDir}/session-packs`,
    sourceLinksDir: `${paths.dataDir}/source-links`,
    importsDir: `${paths.dataDir}/imports`,
    reportArchivesDir: `${paths.reportsDir}/archives`,
    scriptBase: `${paths.pluginRoot}/scripts/memory-compiler`,
    pluginRoot: paths.pluginRoot,
    root: paths.workspaceDir,
  };
}

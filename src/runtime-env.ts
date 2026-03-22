import type { MemoryCompilerPaths } from "./paths.ts";

export function buildMemoryCompilerEnv(paths: MemoryCompilerPaths, extraEnv: Record<string, string> = {}) {
  return {
    ...process.env,
    MEMORY_COMPILER_WORKSPACE_DIR: paths.workspaceDir,
    MEMORY_COMPILER_DATA_DIR: paths.dataDir,
    MEMORY_COMPILER_RUNTIME_DIR: paths.runtimeDir,
    MEMORY_COMPILER_REPORTS_DIR: paths.reportsDir,
    MEMORY_COMPILER_DOCS_DIR: paths.docsDir,
    MEMORY_COMPILER_SCHEMAS_DIR: paths.schemasDir,
    MEMORY_COMPILER_SESSION_STATE_PATH: paths.sessionStatePath,
    MEMORY_COMPILER_WORKING_BUFFER_PATH: paths.workingBufferPath,
    MEMORY_COMPILER_DAILY_MEMORY_DIR: paths.dailyMemoryDir,
    ...extraEnv,
  };
}

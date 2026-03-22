import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

export function runScript(runtime, script, inputPath = null) {
  const scriptPath = path.join(runtime.scriptBase, script);
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`plugin-owned script not found: ${scriptPath}`);
  }
  const args = [scriptPath];
  if (inputPath) args.push(inputPath);
  const stdout = execFileSync('node', args, {
    cwd: runtime.workspaceDir,
    encoding: 'utf8',
    env: {
      ...process.env,
      MEMORY_COMPILER_WORKSPACE_DIR: runtime.workspaceDir,
      MEMORY_COMPILER_DATA_DIR: runtime.dataDir,
      MEMORY_COMPILER_RUNTIME_DIR: runtime.runtimeDir,
      MEMORY_COMPILER_REPORTS_DIR: runtime.reportsDir,
      MEMORY_COMPILER_DOCS_DIR: runtime.docsDir,
      MEMORY_COMPILER_SCHEMAS_DIR: runtime.schemasDir,
      MEMORY_COMPILER_SESSION_STATE_PATH: runtime.sessionStatePath,
      MEMORY_COMPILER_WORKING_BUFFER_PATH: runtime.workingBufferPath,
      MEMORY_COMPILER_DAILY_MEMORY_DIR: runtime.dailyMemoryDir,
    },
  });
  return JSON.parse(stdout);
}

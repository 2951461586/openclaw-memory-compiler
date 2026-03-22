import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { MemoryCompilerPaths } from "./paths.ts";
import { buildMemoryCompilerEnv } from "./runtime-env.ts";

function tempJson(name: string, obj: unknown) {
  const p = path.join(os.tmpdir(), `memory-compiler-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(p, JSON.stringify(obj ?? {}, null, 2));
  return p;
}

export function runPluginScript<T = any>(paths: MemoryCompilerPaths, script: string, payload: Record<string, unknown> = {}): T {
  const scriptPath = path.join(paths.pluginRoot, "scripts", "memory-compiler", script);
  const tmpPath = tempJson(path.basename(script, ".mjs"), payload);
  const args = [scriptPath, tmpPath];
  try {
    const stdout = execFileSync("node", args, {
      cwd: paths.workspaceDir,
      encoding: "utf8",
      env: buildMemoryCompilerEnv(paths),
    });
    return JSON.parse(stdout) as T;
  } finally {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  }
}

export function maybeReadJson<T = any>(filePath: string): T | null {
  try {
    return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf8")) as T : null;
  } catch {
    return null;
  }
}

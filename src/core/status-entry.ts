import type { MemoryCompilerPaths } from "../paths.ts";
import { importPluginScriptModule } from "../plugin-module.ts";
import { buildCoreRuntimeArgs } from "./runtime-args.ts";

export async function readCompilerStatusEntry(paths: MemoryCompilerPaths) {
  const mod = await importPluginScriptModule<any>("compiler-status.mjs");
  return mod.readCompilerStatus(buildCoreRuntimeArgs(paths));
}

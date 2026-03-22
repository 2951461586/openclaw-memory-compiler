import path from "node:path";
import { pathToFileURL } from "node:url";

const moduleCache = new Map<string, Promise<any>>();
const pluginRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const pluginScriptRoot = path.join("scripts", "memory-compiler");

function resolvePluginModulePath(relPath: string): string {
  const clean = relPath.replace(/^\/+/, "");
  return path.join(pluginRoot, clean);
}

function resolvePluginScriptRelPath(relPath: string): string {
  const clean = relPath.replace(/^\/+/, "");
  return path.join(pluginScriptRoot, clean);
}

export async function importPluginModule<T = any>(relPath: string): Promise<T> {
  const absPath = resolvePluginModulePath(relPath);
  const specifier = pathToFileURL(absPath).href;
  if (!moduleCache.has(specifier)) {
    moduleCache.set(specifier, import(specifier));
  }
  return moduleCache.get(specifier) as Promise<T>;
}

export async function importPluginScriptModule<T = any>(relPath: string): Promise<T> {
  return importPluginModule<T>(resolvePluginScriptRelPath(relPath));
}

export async function importPluginScriptCoreModule<T = any>(relPath: string): Promise<T> {
  return importPluginScriptModule<T>(path.join("lib", relPath.replace(/^\/+/, "")));
}

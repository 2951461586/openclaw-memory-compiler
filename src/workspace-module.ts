import path from "node:path";

const moduleCache = new Map<string, Promise<any>>();
const workspaceScriptRoot = path.join("scripts", "memory-compiler");

export function resolveWorkspaceModulePath(workspaceDir: string, relPath: string): string {
  const base = workspaceDir.replace(/\/+$/, "");
  const rel = relPath.replace(/^\/+/, "");
  return `${base}/${rel}`;
}

function resolveWorkspaceScriptRelPath(relPath: string): string {
  const clean = relPath.replace(/^\/+/, "");
  return path.join(workspaceScriptRoot, clean);
}

export function pathToFileUrl(absPath: string): string {
  const normalized = absPath.replace(/\\/g, "/");
  return `file://${normalized.startsWith("/") ? "" : "/"}${normalized}`;
}

export async function importWorkspaceModule<T = any>(workspaceDir: string, relPath: string): Promise<T> {
  const absPath = resolveWorkspaceModulePath(workspaceDir, relPath);
  const specifier = pathToFileUrl(absPath);
  if (!moduleCache.has(specifier)) {
    moduleCache.set(specifier, import(specifier));
  }
  return moduleCache.get(specifier) as Promise<T>;
}

export async function importWorkspaceScriptModule<T = any>(workspaceDir: string, relPath: string): Promise<T> {
  return importWorkspaceModule<T>(workspaceDir, resolveWorkspaceScriptRelPath(relPath));
}

export async function importWorkspaceScriptCoreModule<T = any>(workspaceDir: string, relPath: string): Promise<T> {
  return importWorkspaceScriptModule<T>(workspaceDir, path.join("lib", relPath.replace(/^\/+/, "")));
}

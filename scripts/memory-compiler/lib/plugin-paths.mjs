import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const scriptBase = path.resolve(__dirname, '..');
const pluginRoot = path.resolve(scriptBase, '..', '..');

function trim(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveMaybe(base, value, fallback) {
  const raw = trim(value) || fallback;
  if (!raw) return base;
  return path.isAbsolute(raw) ? raw : path.resolve(base, raw);
}

function resolveMaybeWithPlugin(base, pluginBase, value, fallback) {
  const raw = trim(value) || fallback;
  if (!raw) return base;
  if (path.isAbsolute(raw)) return raw;
  if (raw.startsWith('plugin:')) return path.resolve(pluginBase, raw.slice('plugin:'.length));
  return path.resolve(base, raw);
}

export function resolveCompilerRuntime(overrides = {}) {
  const home = trim(process.env.HOME) || os.homedir() || '';
  const workspaceDir = resolveMaybe(process.cwd(), overrides.workspaceDir || process.env.MEMORY_COMPILER_WORKSPACE_DIR, home ? path.join(home, '.openclaw', 'workspace') : process.cwd());
  const dataDir = resolveMaybe(workspaceDir, overrides.dataDir || process.env.MEMORY_COMPILER_DATA_DIR, 'memory/compiler');
  const reportsDir = resolveMaybe(workspaceDir, overrides.reportsDir || process.env.MEMORY_COMPILER_REPORTS_DIR, path.relative(workspaceDir, path.join(dataDir, 'reports')));
  const runtimeDir = resolveMaybe(workspaceDir, overrides.runtimeDir || process.env.MEMORY_COMPILER_RUNTIME_DIR, path.relative(workspaceDir, dataDir));
  const docsDir = resolveMaybeWithPlugin(workspaceDir, pluginRoot, overrides.docsDir || process.env.MEMORY_COMPILER_DOCS_DIR, 'plugin:docs');
  const sessionStatePath = resolveMaybe(workspaceDir, overrides.sessionStatePath || process.env.MEMORY_COMPILER_SESSION_STATE_PATH, 'SESSION-STATE.md');
  const workingBufferPath = resolveMaybe(workspaceDir, overrides.workingBufferPath || process.env.MEMORY_COMPILER_WORKING_BUFFER_PATH, 'memory/working-buffer.md');
  const dailyMemoryDir = resolveMaybe(workspaceDir, overrides.dailyMemoryDir || process.env.MEMORY_COMPILER_DAILY_MEMORY_DIR, 'memory');
  const schemasDir = resolveMaybe(pluginRoot, overrides.schemasDir || process.env.MEMORY_COMPILER_SCHEMAS_DIR, 'contracts/schemas');
  return {
    pluginRoot,
    scriptBase,
    workspaceDir,
    root: workspaceDir,
    dataDir,
    runtimeDir,
    reportsDir,
    docsDir,
    schemasDir,
    sessionStatePath,
    workingBufferPath,
    dailyMemoryDir,
    controlPlaneDir: path.join(dataDir, 'control-plane'),
    sessionPacksDir: path.join(dataDir, 'session-packs'),
    sourceLinksDir: path.join(dataDir, 'source-links'),
    importsDir: path.join(dataDir, 'imports'),
    reportArchivesDir: path.join(reportsDir, 'archives'),
  };
}

export function compilerDirFrom(root, paths = null) {
  return paths?.dataDir || path.join(root, 'memory', 'compiler');
}

export function reportsDirFrom(root, paths = null) {
  return paths?.reportsDir || path.join(compilerDirFrom(root, paths), 'reports');
}

export function docsDirFrom(root, paths = null) {
  return paths?.docsDir || path.join(pluginRoot, 'docs');
}

export function sessionStatePathFrom(root, paths = null) {
  return paths?.sessionStatePath || path.join(root, 'SESSION-STATE.md');
}

export function workingBufferPathFrom(root, paths = null) {
  return paths?.workingBufferPath || path.join(root, 'memory', 'working-buffer.md');
}

export function dailyMemoryDirFrom(root, paths = null) {
  return paths?.dailyMemoryDir || path.join(root, 'memory');
}

export function schemasDirFrom(_root, paths = null) {
  return paths?.schemasDir || path.join(pluginRoot, 'contracts', 'schemas');
}

export function ensureCompilerRuntime(paths = resolveCompilerRuntime()) {
  const dirs = [
    paths.dataDir,
    paths.reportsDir,
    paths.controlPlaneDir,
    paths.sessionPacksDir,
    path.join(paths.sessionPacksDir, 'handoffs'),
    paths.sourceLinksDir,
    paths.importsDir,
    paths.reportArchivesDir,
  ];
  for (const dir of dirs) fs.mkdirSync(dir, { recursive: true });
  return { ok: true, created: dirs };
}

export function pathToFileHref(absPath) {
  return pathToFileURL(absPath).href;
}

export function isDirectCli(metaUrl) {
  if (!process.argv[1]) return false;
  return metaUrl === pathToFileURL(path.resolve(process.argv[1])).href;
}

export type SceneHint = "chat" | "task" | "precise" | "session" | "heartbeat";
export type ControlPlaneMode = "plugin-preferred";

export interface MemoryCompilerPluginConfig {
  enabled: boolean;
  workspaceDir?: string;
  dataDir: string;
  reportsDir: string;
  runtimeDir: string;
  docsDir: string;
  sessionStatePath: string;
  workingBufferPath: string;
  dailyMemoryDir: string;
  sceneHint?: SceneHint;
  maxPromptChars?: number;
  maxPromptTokens?: number;
  maxReviewItems?: number;
  includeReviewTriage: boolean;
  preferredSourcePrefixes: string[];
  injectSourceDispatchSystemInstruction: boolean;
  enableRuntimeBridge: boolean;
  enableSessionLifecycle: boolean;
  enableControlPlane: boolean;
  controlPlaneMode: ControlPlaneMode;
}

const DEFAULT_PREFERRED_SOURCE_PREFIXES = ["sum:", "file:", "mem:"];

export function normalizePluginConfig(raw: Record<string, unknown>): MemoryCompilerPluginConfig {
  const sceneHint =
    raw.sceneHint === "chat" || raw.sceneHint === "task" || raw.sceneHint === "precise" || raw.sceneHint === "session" || raw.sceneHint === "heartbeat"
      ? (raw.sceneHint as SceneHint)
      : undefined;

  return {
    enabled: raw.enabled === true,
    workspaceDir: typeof raw.workspaceDir === "string" && raw.workspaceDir.trim() ? raw.workspaceDir.trim() : undefined,
    dataDir: typeof raw.dataDir === "string" && raw.dataDir.trim() ? raw.dataDir.trim() : "memory/compiler",
    reportsDir: typeof raw.reportsDir === "string" && raw.reportsDir.trim() ? raw.reportsDir.trim() : "memory/compiler/reports",
    runtimeDir: typeof raw.runtimeDir === "string" && raw.runtimeDir.trim() ? raw.runtimeDir.trim() : "memory/compiler",
    docsDir: typeof raw.docsDir === "string" && raw.docsDir.trim() ? raw.docsDir.trim() : "plugin:docs",
    sessionStatePath: typeof raw.sessionStatePath === "string" && raw.sessionStatePath.trim() ? raw.sessionStatePath.trim() : "SESSION-STATE.md",
    workingBufferPath: typeof raw.workingBufferPath === "string" && raw.workingBufferPath.trim() ? raw.workingBufferPath.trim() : "memory/working-buffer.md",
    dailyMemoryDir: typeof raw.dailyMemoryDir === "string" && raw.dailyMemoryDir.trim() ? raw.dailyMemoryDir.trim() : "memory",
    sceneHint,
    maxPromptChars: typeof raw.maxPromptChars === "number" ? raw.maxPromptChars : undefined,
    maxPromptTokens: typeof raw.maxPromptTokens === "number" ? raw.maxPromptTokens : undefined,
    maxReviewItems: typeof raw.maxReviewItems === "number" ? raw.maxReviewItems : undefined,
    includeReviewTriage: raw.includeReviewTriage !== false,
    preferredSourcePrefixes: Array.isArray(raw.preferredSourcePrefixes) && raw.preferredSourcePrefixes.length
      ? (raw.preferredSourcePrefixes as string[])
      : DEFAULT_PREFERRED_SOURCE_PREFIXES,
    injectSourceDispatchSystemInstruction: raw.injectSourceDispatchSystemInstruction !== false,
    enableRuntimeBridge: raw.enableRuntimeBridge !== false,
    enableSessionLifecycle: raw.enableSessionLifecycle !== false,
    enableControlPlane: raw.enableControlPlane !== false,
    controlPlaneMode: "plugin-preferred",
  };
}

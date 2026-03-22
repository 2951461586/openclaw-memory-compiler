import type { MemoryCompilerPluginConfig } from "./config.ts";
import { resolveMemoryCompilerPaths } from "./paths.ts";
import { applySessionPackLifecycleEntry, generateRuntimeBridgeContextEntry } from "./core/runtime-entry.ts";

function isInternalReflectionSessionKey(sessionKey: unknown): boolean {
  return typeof sessionKey === "string" && sessionKey.trim().startsWith("temp:memory-reflection");
}

function buildSourceDispatchSystemInstruction(dispatch: any): string {
  const primary = dispatch?.primary;
  if (!primary?.tool) return "";
  const blocking = dispatch?.blocking === true;
  const fallbackLines = Array.isArray(dispatch?.fallbacks)
    ? dispatch.fallbacks.slice(0, 3).map((step: any, index: number) => `${index + 1}. ${step.tool} ${JSON.stringify(step.params || {})}`)
    : [];
  return [
    "<source-dispatch-instruction>",
    "When answering this run, treat source dispatch as executable guidance, not optional commentary.",
    `Dispatch contract: ${dispatch.contractVersion || "source-dispatch.v1"}`,
    `Blocking: ${blocking ? "yes" : "no"}`,
    `Primary tool call: ${primary.tool} ${JSON.stringify(primary.params || {})}`,
    primary.reason ? `Primary reason: ${primary.reason}` : null,
    fallbackLines.length ? "Fallbacks:" : null,
    ...fallbackLines,
    blocking
      ? "Blocking rule: before giving any exact factual answer, execute the primary tool call first; if it fails, try fallbacks in order before answering."
      : "Non-blocking rule: prefer the primary tool call before answering exact factual questions.",
    "</source-dispatch-instruction>",
  ].filter(Boolean).join("\n");
}

export async function buildRuntimeContext(config: MemoryCompilerPluginConfig, payload: Record<string, unknown>) {
  const paths = resolveMemoryCompilerPaths(config);
  const result = await Promise.resolve(
    generateRuntimeBridgeContextEntry(config, paths, {
      ...payload,
      paths,
      // Allow per-call overrides (payload) to win over config defaults.
      sceneHint: (payload as any)?.sceneHint ?? config.sceneHint,
      maxPromptChars: (payload as any)?.maxPromptChars ?? config.maxPromptChars,
      maxPromptTokens: (payload as any)?.maxPromptTokens ?? config.maxPromptTokens,
      maxReviewItems: (payload as any)?.maxReviewItems ?? config.maxReviewItems,
      includeReviewTriage: (payload as any)?.includeReviewTriage ?? config.includeReviewTriage,
      preferredSourcePrefixes: (payload as any)?.preferredSourcePrefixes ?? config.preferredSourcePrefixes,
    }),
  );

  const prependContext = typeof result?.prependContext === "string" ? result.prependContext : "";
  const sourceDispatch = result?.sourceDispatch || null;

  // Preserve the operator-facing runtime bridge shape (scene/diagnostics/budgets/etc.)
  // while also optionally injecting a system instruction block for strict source dispatch.
  return {
    ...(result && typeof result === "object" ? result : {}),
    ok: result?.ok === true,
    prependContext,
    prependSystemContext: config.injectSourceDispatchSystemInstruction
      ? buildSourceDispatchSystemInstruction(sourceDispatch)
      : "",
    sourceDispatch,
    paths,
  };
}

export async function runSessionLifecycle(config: MemoryCompilerPluginConfig, sessionKey: string, reason = "plugin-session-end") {
  if (!sessionKey || isInternalReflectionSessionKey(sessionKey)) return null;
  const paths = resolveMemoryCompilerPaths(config);
  await Promise.resolve(applySessionPackLifecycleEntry(config, paths, { action: "handoff", sessionKey, reason }));
  await Promise.resolve(applySessionPackLifecycleEntry(config, paths, { action: "finalize", sessionKey, reason }));
  return { ok: true, sessionKey, reason };
}
